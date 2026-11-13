// lib/character/walk.js
//
// Pure logic of the walking animation. Imports nothing (no Shell, GLib or Clutter), so it runs under plain
// Node (tests/walk.test.mjs). It has three parts:
//
//   validateManifest()  checks assets/walk/walk.json (written by tools/build-walk-assets.py)
//   planWalk()          turns a distance into a movement plan that keeps feet and ground speed in step
//   WalkAnimator        the frame state machine: start sequence -> loop cycles -> stop sequence
//
// The three sequences are independent lists in the manifest; nothing here knows how many frames they hold.
//
// Frame time: every sequence has its own `frameMs` (initial value 93 ms). One tick of the animator = one
// frame. Movement is NOT done here: lib/character/controller.js moves the actor using the plan, so frame
// playback and movement calculations stay separate.
//
// Foot sliding: a full walk cycle covers `strideHeights` x character height. Ground speed is therefore
// v0 = stride / cycle time, and the start and stop sequences cover (v0 x their travel time / 2), because
// the body accelerates (ease-in) from 0 to v0 and decelerates (ease-out) from v0 to 0. A walk of any length
// is then planned as start + N whole cycles + stop; all distances are multiplied by one factor `scale` so the
// plan lands exactly on the target. scale = 1 means no sliding; its distance from 1 is the sliding fraction.

export const MANIFEST_VERSION = 1;
export const SEQUENCES = ['start', 'loop', 'stop'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => Number.isInteger(v);

/**
 * Validates a parsed manifest. Returns {ok, errors}. Never throws.
 * Required shape: see docs/release-0.2.1.md.
 */
export function validateManifest(m) {
    const errors = [];
    const err = text => errors.push(text);
    if (m === null || typeof m !== 'object')
        return {ok: false, errors: ['manifest is not an object']};
    if (m.version !== MANIFEST_VERSION)
        err(`unsupported manifest version ${m.version} (expected ${MANIFEST_VERSION})`);

    const fr = m.frame;
    if (!fr || !(isInt(fr.width) && fr.width > 0) || !(isInt(fr.height) && fr.height > 0))
        err('frame.width and frame.height must be positive integers');
    const at = m.atlas;
    if (!at || typeof at.image !== 'string' || !at.image || at.image.includes('/') || at.image.includes('..'))
        err('atlas.image must be a plain file name');
    if (!at || !(isInt(at.width) && at.width > 0) || !(isInt(at.height) && at.height > 0))
        err('atlas.width and atlas.height must be positive integers');
    if (!m.figure || !isNum(m.figure.left) || !isNum(m.figure.right) || !(m.figure.right > m.figure.left))
        err('figure.left and figure.right must be numbers with right > left');
    const mo = m.motion;
    if (!mo || !isNum(mo.strideHeights) || !(mo.strideHeights > 0.1 && mo.strideHeights < 3))
        err('motion.strideHeights must be a number between 0.1 and 3');
    if (!mo || !isNum(mo.minScale) || !isNum(mo.maxScale) || !(mo.minScale > 0.2 && mo.minScale <= 1 && mo.maxScale >= 1 && mo.maxScale < 3))
        err('motion.minScale must be in (0.2, 1] and motion.maxScale in [1, 3)');

    for (const name of SEQUENCES) {
        const s = m.sequences?.[name];
        if (!s) {
            err(`sequence "${name}" is missing`);
            continue;
        }
        if (!isNum(s.frameMs) || s.frameMs < 20 || s.frameMs > 1000)
            err(`${name}.frameMs must be between 20 and 1000`);
        if (!Array.isArray(s.frames) || s.frames.length < (name === 'loop' ? 2 : 1)) {
            err(`${name}.frames must list at least ${name === 'loop' ? 2 : 1} frame(s)`);
            continue;
        }
        if (name !== 'loop' && !(isInt(s.travelFrames) && s.travelFrames >= 1 && s.travelFrames <= s.frames.length))
            err(`${name}.travelFrames must be an integer between 1 and ${s.frames.length}`);
        s.frames.forEach((f, i) => {
            if (!f || !isNum(f.x) || !isNum(f.y) || !isNum(f.dy) || f.dy < 0) {
                err(`${name}.frames[${i}] needs numeric x, y and dy >= 0`);
                return;
            }
            if (fr && at && (f.x < 0 || f.y - f.dy < 0 || f.x + fr.width > at.width || f.y + fr.height > at.height))
                err(`${name}.frames[${i}] lies outside the atlas (or its offset would show outside it)`);
        });
    }
    return {ok: errors.length === 0, errors};
}

/** Cycle time of the loop sequence in ms. */
export function cycleMs(manifest) {
    const s = manifest.sequences.loop;
    return s.frames.length * s.frameMs;
}

/** Nominal ground speed in px per ms at character height `height`. */
export function groundSpeed(manifest, height) {
    return (manifest.motion.strideHeights * height) / cycleMs(manifest);
}

/**
 * Plans a walk of `distance` px (>= 0) for a character `height` px tall.
 * Returns null when the distance is too short for the animation (the caller falls back to a plain glide).
 *
 * @returns {{cycles: number, scale: number, speed: number,
 *            start: {distance: number, ms: number}, loop: {distance: number, ms: number},
 *            stop: {distance: number, ms: number}}}
 *   speed = loop ground speed in px per ms. Distances already include `scale`.
 */
export function planWalk({distance, height, manifest}) {
    if (!(distance > 0) || !(height > 0))
        return null;
    const {start, loop, stop} = manifest.sequences;
    const v0 = groundSpeed(manifest, height);
    const startMs = start.travelFrames * start.frameMs;
    const stopMs = stop.travelFrames * stop.frameMs;
    const dStart = v0 * startMs / 2;
    const dStop = v0 * stopMs / 2;
    const stride = manifest.motion.strideHeights * height;
    const base = dStart + dStop;

    const cycles = Math.max(0, Math.round((distance - base) / stride));
    const nominal = base + cycles * stride;
    const scale = distance / nominal;
    if (scale < manifest.motion.minScale || scale > manifest.motion.maxScale)
        return null;
    const loopMs = cycles * loop.frames.length * loop.frameMs;
    return {
        cycles,
        scale,
        speed: v0 * scale,
        start: {distance: dStart * scale, ms: startMs},
        loop: {distance: cycles * stride * scale, ms: loopMs},
        stop: {distance: dStop * scale, ms: stopMs},
    };
}

/**
 * Frame state machine. One tick() advances one frame. Calls:
 *   onFrame(sequence, index)   a new frame must be shown
 *   onPhase(phase)             'start' | 'loop' | 'stop' began; 'done' after the last stop frame was shown for
 *                              one frame time
 * Interruption: requestStop() lets the current loop cycle finish (or the start sequence), then plays the stop
 * sequence; it never jumps from the middle of a cycle.
 */
export class WalkAnimator {
    /**
     * @param {{start: number, loop: number, stop: number}} lengths frame counts of the sequences
     * @param {number} cycles whole loop cycles to play before stopping (0 = start straight into stop)
     * @param {{onFrame: Function, onPhase: Function}} handlers
     */
    constructor(lengths, cycles, {onFrame, onPhase}) {
        this._len = lengths;
        this._cycles = Math.max(0, Math.floor(cycles));
        this._onFrame = onFrame;
        this._onPhase = onPhase;
        this._seq = null;
        this._index = 0;
        this._cycle = 0;
        this._stopRequested = false;
        this._done = false;
    }

    get sequence() {
        return this._seq;
    }

    get index() {
        return this._index;
    }

    get done() {
        return this._done;
    }

    /** True once a stop was requested or the stop sequence has begun. */
    get stopping() {
        return this._stopRequested || this._seq === 'stop';
    }

    get cyclesPlanned() {
        return this._cycles;
    }

    /** Shows the first start frame. */
    begin() {
        if (this._seq !== null || this._done)
            return;
        this._enter('start');
    }

    /** Ask for a stop at the next safe point. Safe to call repeatedly and in any state. */
    requestStop() {
        if (this._done || this._seq === null || this._seq === 'stop' || this._stopRequested)
            return;
        this._stopRequested = true;
        if (this._seq === 'start')
            this._cycles = 0;
        else
            this._cycles = Math.min(this._cycles, this._cycle + 1);
    }

    /** Frames still to be ticked before the stop sequence's first frame is shown (0 when already stopping). */
    framesUntilStop() {
        if (this._seq === 'start')
            return (this._len.start - this._index) + this._cycles * this._len.loop;
        if (this._seq === 'loop')
            return (this._len.loop - this._index) + (this._cycles - this._cycle - 1) * this._len.loop;
        return 0;
    }

    tick() {
        if (this._done || this._seq === null)
            return;
        if (this._seq === 'start') {
            if (this._index + 1 < this._len.start)
                this._show(this._index + 1);
            else
                this._enter(this._cycles > 0 ? 'loop' : 'stop');
        } else if (this._seq === 'loop') {
            if (this._index + 1 < this._len.loop) {
                this._show(this._index + 1);
            } else {
                this._cycle += 1;
                this._enter(this._cycle < this._cycles ? 'loop' : 'stop', this._cycle < this._cycles);
            }
        } else if (this._index + 1 < this._len.stop) {
            this._show(this._index + 1);
        } else {
            this._seq = null;
            this._done = true;
            this._onPhase('done');
        }
    }

    _show(index) {
        this._index = index;
        this._onFrame(this._seq, index);
    }

    /** Starts a sequence at frame 0. `sameCycleRun` keeps the phase quiet when a loop cycle just repeats. */
    _enter(seq, sameCycleRun = false) {
        this._seq = seq;
        if (seq === 'loop' && !sameCycleRun)
            this._cycle = 0;
        this._index = 0;
        if (!sameCycleRun)
            this._onPhase(seq);
        this._onFrame(seq, 0);
    }
}
