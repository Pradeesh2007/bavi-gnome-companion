// Unit tests for lib/character/walk.js (pure logic). Real tests: no mocks, plain Node.
// Run: node tests/walk.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateManifest, planWalk, WalkAnimator, rootMotion, cycleMs} from '../lib/character/walk.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };
const real = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../assets/walk/walk.json', import.meta.url)), 'utf8'));

// A synthetic manifest with arbitrary frame counts (the code must not depend on 7/10/25).
function synth(start, loop, stop, extra = {}) {
    const frames = n => Array.from({length: n}, (_, i) => ({x: 2 + i * 10, y: 12, dy: 0}));
    const travel = n => Array.from({length: n}, (_, i) => 2 + (i % 3));
    return {
        version: 1, frame: {width: 10, height: 20}, atlas: {image: 'a.png', width: 2000, height: 40}, figure: {left: 1, right: 9},
        motion: {footLock: {start: 1, loop: 0.7, stop: 1}, minScale: 0.55, maxScale: 1.45},
        sequences: {start: {frameMs: 93, frames: frames(start), footTravel: travel(start)}, loop: {frameMs: 93, frames: frames(loop), footTravel: travel(loop)},
                    stop: {frameMs: 93, frames: frames(stop), footTravel: travel(stop)}}, ...extra,
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
    bad(m => { m.sequences.loop.frames = [m.sequences.loop.frames[0]]; m.sequences.loop.footTravel = [1]; }, /at least 2/);
    bad(m => { m.sequences.start.frames = []; m.sequences.start.footTravel = []; }, /start.frames/);
    bad(m => { m.sequences.stop.frameMs = 5; }, /frameMs/);
    bad(m => { m.sequences.start.frames[0].dy = -1; }, /dy/);
    bad(m => { m.sequences.start.frames[0].x = 99999; }, /outside the atlas/);
    bad(m => { m.sequences.start.frames[0].dy = m.sequences.start.frames[0].y + 5; }, /outside the atlas/);
    bad(m => { m.atlas.image = '../x.png'; }, /plain file name/);
    bad(m => { m.figure.right = m.figure.left; }, /figure/);
    bad(m => { m.motion.footLock.loop = 1.5; }, /footLock.loop/);
    bad(m => { delete m.motion.footLock; }, /footLock/);
    bad(m => { m.sequences.loop.footTravel.pop(); }, /footTravel/);
    bad(m => { m.sequences.stop.footTravel[3] = -1; }, /footTravel/);
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

const sumOf = a => a.reduce((x, y) => x + y, 0);

test('root motion: blend keeps the distance, footLock 1 follows the art, footLock 0 is constant speed', () => {
    const raw = real.sequences.loop.footTravel, m1 = structuredClone(real), m0 = structuredClone(real);
    m1.motion.footLock.loop = 1; m0.motion.footLock.loop = 0;
    assert.deepEqual(rootMotion(m1).loop.map(v => +v.toFixed(9)), raw.map(v => +v.toFixed(9)));
    const flat = rootMotion(m0).loop; assert.ok(flat.every(v => Math.abs(v - flat[0]) < 1e-9));
    for (const lock of [0, 0.3, 0.7, 1]) { const m = structuredClone(real); m.motion.footLock.loop = lock; assert.ok(Math.abs(sumOf(rootMotion(m).loop) - sumOf(raw)) < 1e-9); }
    assert.ok(rootMotion(real).loop.every(v => v >= 0));
});

test('the measured stride is about 0.43 x character height and nothing in the planner assumes a frame count', () => {
    const stride = sumOf(rootMotion(real).loop) / real.frame.height;
    assert.ok(stride > 0.40 && stride < 0.46, `stride ${stride}`);
    const m = synth(5, 6, 9); assert.equal(validateManifest(m).ok, true);
    const p = planWalk({distance: 400, height: 100, manifest: m}); assert.ok(p && Number.isInteger(p.cycles));
});

test('foot contact (regression guard): planted-foot drift of the shipped manifest is far below the 0.2.1 model, measured on the art', () => {
    // Reference = tools/analyze-foot-contact.py output (how far the figure must advance per frame for the planted foot to stay put).
    const analysis = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../art-source/walk-foot-contact.json', import.meta.url)), 'utf8'));
    const ratio = real.frame.height / 1280, disp = 240 / real.frame.height;                    // source px -> runtime px; runtime px -> display px at 240 px height
    const ideal = analysis.loop.track.map(v => Math.max(0, v ?? 0) * ratio);
    const peak = dx => { let worst = 0; const n = dx.length; for (let st = 0; st < n; st++) { let c = 0; for (let len = 1; len <= 5; len++) { c += dx[(st + len - 1) % n] - ideal[(st + len - 1) % n]; worst = Math.max(worst, Math.abs(c)); } } return worst * disp; };
    const shipped = peak(rootMotion(real).loop);
    const v021 = peak(Array(10).fill(0.56 * real.frame.height / 10));                         // what 0.2.1 did: constant speed, stride estimated at 0.56 x height
    const constant = peak(Array(10).fill(ideal.reduce((a, b) => a + b, 0) / 10));
    assert.ok(v021 > 25, `0.2.1 model drift ${v021.toFixed(1)}`);                             // the reported "floating" problem, measured
    assert.ok(shipped <= 12.5, `shipped drift ${shipped.toFixed(1)} px`);
    assert.ok(shipped < constant && shipped < 0.5 * v021, `shipped ${shipped.toFixed(1)} vs constant ${constant.toFixed(1)} vs 0.2.1 ${v021.toFixed(1)}`);
    // the manifest data must agree with the analysis it was built from
    assert.ok(Math.abs(real.sequences.loop.footTravel.reduce((a, b) => a + b, 0) - ideal.reduce((a, b) => a + b, 0)) < 0.5);
});

test('exact walks: distances add up to the requested distance, with whole cycles, scale inside the limits', () => {
    for (const height of [120, 240, 480]) for (let d = 60; d <= 2000; d += 37) {
        const p = planWalk({distance: d, height, manifest: real, exact: true});
        if (!p) continue;
        assert.ok(Number.isInteger(p.cycles) && p.cycles >= 0);
        assert.ok(Math.abs(p.total - d) < 1e-6, `d=${d} h=${height}`);
        assert.ok(p.scale >= real.motion.minScale && p.scale <= real.motion.maxScale);
    }
});

test('snapped (roaming) walks: scale is exactly 1 (no sliding), distance within half a cycle, never beyond the room', () => {
    const h = 240, motion = rootMotion(real), k = h / real.frame.height, dLoop = sumOf(motion.loop) * k;
    for (let d = 200; d <= 1800; d += 11) {
        const p = planWalk({distance: d, height: h, manifest: real, exact: false});
        assert.ok(p, `d=${d}`); assert.equal(p.scale, 1);
        assert.ok(Math.abs(p.total - d) <= dLoop / 2 + 1e-6, `d=${d} total=${p.total}`);
        const limited = planWalk({distance: d, height: h, manifest: real, exact: false, maxTotal: d - 1});
        if (limited) assert.ok(limited.total <= d - 1 + 1e-6);
    }
});

test('very short walks are refused (glide fallback); exact walks that would need too much stretching too', () => {
    const h = 240;
    assert.equal(planWalk({distance: 10, height: h, manifest: real}), null);
    assert.equal(planWalk({distance: 10, height: h, manifest: real, exact: false}), null);
    assert.equal(planWalk({distance: 0, height: h, manifest: real}), null);
    const base = (sumOf(rootMotion(real).start) + sumOf(rootMotion(real).stop)) * h / real.frame.height;
    assert.equal(planWalk({distance: base * 0.3, height: h, manifest: real}), null);
    assert.ok(planWalk({distance: base, height: h, manifest: real}).cycles === 0);
});

test('frame time is configurable: it changes speed, not the distances the walk covers', () => {
    const m = structuredClone(real); for (const q of Object.values(m.sequences)) q.frameMs = 60;
    const a = planWalk({distance: 900, height: 240, manifest: real}), b = planWalk({distance: 900, height: 240, manifest: m});
    assert.equal(a.cycles, b.cycles); assert.ok(Math.abs(a.total - b.total) < 1e-9);
    assert.equal(cycleMs(m), 600); assert.equal(cycleMs(real), 930);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
