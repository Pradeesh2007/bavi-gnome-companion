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
// Foot contact (release 0.3.0): the art is "in place" (the figure does not travel inside the frame), so the actor
// must carry her forward exactly as fast as her planted foot moves backwards inside the frame, or the foot skates.
// tools/analyze-foot-contact.py measures that backward motion for every frame (`footTravel`, in runtime px, stored in
// the manifest). rootMotion() turns it into the distance the actor advances while each frame is shown:
//     dx[i] = (1 - footLock) * mean + footLock * footTravel[i]
// footLock 1 follows the art exactly (feet planted, body speed varies like the drawings); 0 is constant speed (smooth
// body, feet skate where the drawings are unevenly spaced). Per-sequence value in motion.footLock.
// planWalk() builds a walk of start + N whole loop cycles + stop. A random roaming walk is SNAPPED to the nearest
// whole-cycle distance (scale exactly 1, so no sliding at all); a walk to an exact target (summon, home) is stretched by
// one factor `scale`, which is then the sliding fraction.

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
    if (!mo || !isNum(mo.minScale) || !isNum(mo.maxScale) || !(mo.minScale > 0.2 && mo.minScale <= 1 && mo.maxScale >= 1 && mo.maxScale < 3))
        err('motion.minScale must be in (0.2, 1] and motion.maxScale in [1, 3)');
    for (const name of SEQUENCES) {
        const lock = mo?.footLock?.[name];
        if (!isNum(lock) || lock < 0 || lock > 1)
            err(`motion.footLock.${name} must be a number between 0 and 1`);
    }

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
        if (!Array.isArray(s.footTravel) || s.footTravel.length !== s.frames.length || !s.footTravel.every(v => isNum(v) && v >= 0))
            err(`${name}.footTravel must list one non-negative number per frame`);
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

/**
 * Distance (runtime px, i.e. in units of the 480-px-high frame) the figure advances while each frame is shown.
 * @returns {{start: number[], loop: number[], stop: number[]}}
 */
export function rootMotion(manifest) {
    const out = {};
    for (const name of SEQUENCES) {
        const ft = manifest.sequences[name].footTravel;
        const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
        const lock = manifest.motion.footLock[name];
        out[name] = ft.map(v => (1 - lock) * mean + lock * v);
    }
    return out;
}

const sum = a => a.reduce((x, y) => x + y, 0);

/**
 * Plans a walk of about `distance` px (>= 0) for a character `height` px tall.
 * Returns null when the walk is too short for the animation (the caller then glides as in 0.1).
 *
 * @param {boolean} exact true: the walk must end exactly `distance` away (stretched by `scale`, which is the sliding
 *   fraction); false: the distance is snapped to the nearest whole-cycle walk (scale 1, no sliding) and the caller
 *   must use `total` as the real distance.
 * @param {number} maxTotal snapped walks never exceed this distance (room left in the work area)
 * @returns {{cycles: number, scale: number, total: number, k: number, stopDistance: number}}
 *   k = pixels per runtime pixel (character height / frame height); the actor advances dx[i] * k * scale per frame.
 */
export function planWalk({distance, height, manifest, exact = true, maxTotal = Infinity}) {
    if (!(distance > 0) || !(height > 0))
        return null;
    const motion = rootMotion(manifest);
    const k = height / manifest.frame.height;
    const dStart = sum(motion.start) * k;
    const dLoop = sum(motion.loop) * k;
    const dStop = sum(motion.stop) * k;
    if (!(dLoop > 0))
        return null;
    const base = dStart + dStop;
    let cycles = Math.max(0, Math.round((distance - base) / dLoop));
    if (!exact)
        while (cycles > 0 && base + cycles * dLoop > maxTotal + 1e-6)
            cycles -= 1;
    const nominal = base + cycles * dLoop;
    if (!exact && nominal > maxTotal + 1e-6)
        return null;
    if (!(nominal > 0))
        return null;
    const scale = exact ? distance / nominal : 1;
    if (scale < manifest.motion.minScale || scale > manifest.motion.maxScale)
        return null;
    if (!exact && distance < base * 0.5)
        return null;
    return {cycles, scale, total: nominal * scale, k, stopDistance: dStop * scale};
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
