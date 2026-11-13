// Unit tests for lib/character/walk.js (pure logic). Real tests: no mocks, plain Node.
// Run: node tests/walk.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateManifest, planWalk, WalkAnimator, groundSpeed, cycleMs} from '../lib/character/walk.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };
const real = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../assets/walk/walk.json', import.meta.url)), 'utf8'));

// A synthetic manifest with arbitrary frame counts (the code must not depend on 7/10/25).
function synth(start, loop, stop, extra = {}) {
    const frames = n => Array.from({length: n}, (_, i) => ({x: 2 + i * 10, y: 12, dy: 0}));
    return {
        version: 1, frame: {width: 10, height: 20}, atlas: {image: 'a.png', width: 2000, height: 40}, figure: {left: 1, right: 9},
        motion: {strideHeights: 0.56, minScale: 0.55, maxScale: 1.45},
        sequences: {start: {frameMs: 93, travelFrames: start, frames: frames(start)}, loop: {frameMs: 93, frames: frames(loop)},
                    stop: {frameMs: 93, travelFrames: Math.max(1, Math.floor(stop / 2)), frames: frames(stop)}}, ...extra,
    };
}

// Plays an animator to the end, recording [sequence, index] per frame and phases.
function play(lengths, cycles, {stopAtTick = null} = {}) {
    const frames = [], phases = [];
    const a = new WalkAnimator(lengths, cycles, {onFrame: (s, i) => frames.push([s, i]), onPhase: p => phases.push(p)});
    a.begin();
    let ticks = 0;
    while (!a.done && ticks < 10000) {
        if (stopAtTick === ticks) a.requestStop();
        a.tick(); ticks++;
    }
    return {frames, phases, ticks, a};
}

test('the shipped manifest is valid and has the expected sequences', () => {
    const v = validateManifest(real);
    assert.deepEqual(v.errors, []); assert.equal(v.ok, true);
    assert.equal(real.sequences.start.frames.length, 7); assert.equal(real.sequences.loop.frames.length, 10); assert.equal(real.sequences.stop.frames.length, 25);
    assert.equal(real.sequences.start.frameMs, 93);
});

test('manifest validation rejects broken manifests', () => {
    const bad = (mutate, re) => { const m = structuredClone(real); mutate(m); const v = validateManifest(m); assert.equal(v.ok, false); assert.match(v.errors.join('|'), re); };
    assert.equal(validateManifest(null).ok, false);
    bad(m => { m.version = 2; }, /version/);
    bad(m => { delete m.sequences.loop; }, /loop/);
    bad(m => { m.sequences.loop.frames = [m.sequences.loop.frames[0]]; }, /at least 2/);
    bad(m => { m.sequences.start.frames = []; }, /start.frames/);
    bad(m => { m.sequences.stop.frameMs = 5; }, /frameMs/);
    bad(m => { m.sequences.stop.travelFrames = 99; }, /travelFrames/);
    bad(m => { m.sequences.start.frames[0].dy = -1; }, /dy/);
    bad(m => { m.sequences.start.frames[0].x = 99999; }, /outside the atlas/);
    bad(m => { m.sequences.start.frames[0].dy = m.sequences.start.frames[0].y + 5; }, /outside the atlas/);
    bad(m => { m.atlas.image = '../x.png'; }, /plain file name/);
    bad(m => { m.motion.strideHeights = 9; }, /strideHeights/);
    bad(m => { m.figure.right = m.figure.left; }, /figure/);
});

test('animator plays start, N loop cycles, stop, in order, for the real frame counts', () => {
    const {frames, phases, a} = play({start: 7, loop: 10, stop: 25}, 3);
    const expected = [];
    for (let i = 0; i < 7; i++) expected.push(['start', i]);
    for (let c = 0; c < 3; c++) for (let i = 0; i < 10; i++) expected.push(['loop', i]);
    for (let i = 0; i < 25; i++) expected.push(['stop', i]);
    assert.deepEqual(frames, expected);
    assert.deepEqual(phases, ['start', 'loop', 'stop', 'done']);       // the loop phase fires once, not per cycle
    assert.equal(a.done, true); assert.equal(a.sequence, null);
});

test('animator does not depend on frame counts (3/4/5, 1/2/1, 40/12/60)', () => {
    for (const [s, l, p] of [[3, 4, 5], [1, 2, 1], [40, 12, 60]]) {
        for (const cycles of [0, 1, 4]) {
            const {frames} = play({start: s, loop: l, stop: p}, cycles);
            assert.equal(frames.length, s + cycles * l + p, `${s}/${l}/${p} x${cycles}`);
            assert.deepEqual(frames[0], ['start', 0]); assert.deepEqual(frames.at(-1), ['stop', p - 1]);
        }
    }
});

test('loop wraps seamlessly: after the last loop frame comes loop frame 0 again (no stop in between)', () => {
    const {frames} = play({start: 2, loop: 4, stop: 2}, 3);
    const loop = frames.filter(f => f[0] === 'loop').map(f => f[1]);
    assert.deepEqual(loop, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
});

test('zero cycles goes from the start sequence straight into the stop sequence', () => {
    const {frames} = play({start: 3, loop: 4, stop: 2}, 0);
    assert.deepEqual(frames.map(f => f[0]), ['start', 'start', 'start', 'stop', 'stop']);
});

test('requestStop during the loop finishes the current cycle first, never jumping from the middle of a cycle', () => {
    for (let stopAt = 7; stopAt < 7 + 10 * 4; stopAt++) {      // every tick inside the 4 planned cycles
        const {frames} = play({start: 7, loop: 10, stop: 25}, 4, {stopAtTick: stopAt});
        const firstStop = frames.findIndex(f => f[0] === 'stop');
        assert.deepEqual(frames[firstStop - 1], ['loop', 9], `stop requested at tick ${stopAt}`);   // always leaves from the last loop frame
        assert.equal(frames.slice(firstStop).length, 25);
        assert.deepEqual(frames.slice(firstStop).map(f => f[1]), [...Array(25).keys()]);
    }
});

test('requestStop during the start sequence skips the loop and plays the stop sequence after the start sequence', () => {
    for (let stopAt = 0; stopAt < 7; stopAt++) {
        const {frames} = play({start: 7, loop: 10, stop: 25}, 5, {stopAtTick: stopAt});
        assert.equal(frames.filter(f => f[0] === 'loop').length, 0);
        assert.deepEqual(frames.slice(0, 7).map(f => f[0]), Array(7).fill('start'));
        assert.equal(frames.length, 7 + 25);
    }
});

test('requestStop during or after the stop sequence changes nothing and is safe to repeat', () => {
    const base = play({start: 7, loop: 10, stop: 25}, 2).frames;
    const late = play({start: 7, loop: 10, stop: 25}, 2, {stopAtTick: 7 + 20 + 5}).frames;
    assert.deepEqual(late, base);
    const a = new WalkAnimator({start: 2, loop: 2, stop: 2}, 1, {onFrame() {}, onPhase() {}});
    a.requestStop(); a.begin(); a.requestStop(); a.requestStop(); while (!a.done) a.tick(); a.requestStop(); a.tick(); a.tick();
    assert.equal(a.done, true);
});

test('framesUntilStop equals the real number of ticks until the first stop frame', () => {
    for (const cycles of [0, 1, 3]) {
        for (let at = 0; at < 7 + cycles * 10; at++) {
            const frames = [];
            const a = new WalkAnimator({start: 7, loop: 10, stop: 25}, cycles, {onFrame: (s, i) => frames.push([s, i]), onPhase() {}});
            a.begin();
            for (let t = 0; t < at; t++) a.tick();
            const predicted = a.framesUntilStop();
            let ticks = 0; while (a.sequence !== 'stop') { a.tick(); ticks++; }
            assert.equal(ticks, predicted, `cycles ${cycles}, after ${at} ticks`);
        }
    }
});

test('planner: distances add up exactly to the requested distance, with whole cycles', () => {
    for (const height of [120, 240, 480]) for (let d = 60; d <= 2000; d += 37) {
        const p = planWalk({distance: d, height, manifest: real});
        if (!p) continue;
        assert.ok(Number.isInteger(p.cycles) && p.cycles >= 0);
        assert.ok(Math.abs(p.start.distance + p.loop.distance + p.stop.distance - d) < 1e-6, `d=${d} h=${height}`);
        assert.ok(p.scale >= real.motion.minScale && p.scale <= real.motion.maxScale);
        assert.equal(p.start.ms, 7 * 93); assert.equal(p.loop.ms, p.cycles * 10 * 93); assert.equal(p.stop.ms, 12 * 93);
    }
});

test('planner: sliding is small for normal roaming distances, and very short walks are refused', () => {
    const h = 240, stride = real.motion.strideHeights * h;
    for (let d = 450; d <= 1800; d += 13) {
        const p = planWalk({distance: d, height: h, manifest: real});
        assert.ok(p, `d=${d}`); assert.ok(Math.abs(p.scale - 1) <= 0.2, `scale ${p.scale} at d=${d}`);
    }
    assert.equal(planWalk({distance: 10, height: h, manifest: real}), null);          // far too short: glide fallback
    assert.equal(planWalk({distance: 0, height: h, manifest: real}), null);
    assert.ok(stride > 100);
});

test('planner: ground speed matches stride per cycle, and the loop speed carries the scale', () => {
    const h = 300, v0 = groundSpeed(real, h);
    assert.ok(Math.abs(v0 - real.motion.strideHeights * h / cycleMs(real)) < 1e-12);
    const p = planWalk({distance: 900, height: h, manifest: real});
    assert.ok(Math.abs(p.speed - v0 * p.scale) < 1e-12);
    assert.ok(Math.abs(p.loop.distance - p.speed * p.loop.ms) < 1e-6);                 // loop covers speed x time
    // the existing roaming speed was 0.6 x height per second; the animation implies about the same
    assert.ok(Math.abs(v0 * 1000 / h - 0.6) < 0.05);
});

test('planner follows the manifest timing (frame time is configurable, no hard-coded 93 ms)', () => {
    const m = structuredClone(real); for (const s of Object.values(m.sequences)) s.frameMs = 60;
    const p = planWalk({distance: 900, height: 240, manifest: m});
    assert.equal(p.start.ms, 7 * 60); assert.equal(p.stop.ms, 12 * 60); assert.equal(p.loop.ms, p.cycles * 10 * 60);
    const faster = groundSpeed(m, 240), normal = groundSpeed(real, 240);
    assert.ok(Math.abs(faster / normal - 93 / 60) < 1e-9);                             // shorter frames = proportionally faster ground speed
    assert.equal(validateManifest(synth(5, 6, 9)).ok, true);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
