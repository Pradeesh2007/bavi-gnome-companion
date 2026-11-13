// MOCKED tests of lib/character/controller.js + lib/character/walk.js.
// The controller and walk logic are the real code; the actor, environment, Disposer and clock are fakes written for
// this file (tests/controller.test.mjs). They verify state handling and timing logic, NOT Clutter/St behaviour.
// Run: node tests/controller.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CharacterController, DEFAULT_CONFIG} from '../lib/character/controller.js';

const real = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../assets/walk/walk.json', import.meta.url)), 'utf8'));
const FRAME = real.sequences.start.frameMs;      // 93

// ---- fakes ----------------------------------------------------------------------------------------------------
class Clock {
    constructor() { this.now = 1_000_000; this.timers = new Map(); this.nextId = 1; }
    add(ms, cb, repeat) { const id = this.nextId++; this.timers.set(id, {at: this.now + ms, ms, cb, repeat}); return id; }
    cancel(id) { this.timers.delete(id); }
    advance(ms) {
        const end = this.now + ms;
        for (;;) {
            let next = null;
            for (const [id, t] of this.timers) if (t.at <= end && (!next || t.at < next.t.at || (t.at === next.t.at && id < next.id))) next = {id, t};
            if (!next) break;
            this.now = next.t.at;
            if (next.t.repeat) next.t.at += next.t.ms; else this.timers.delete(next.id);
            next.t.cb();
        }
        this.now = end;
    }
    get repeating() { return [...this.timers.values()].filter(t => t.repeat).map(t => t.ms); }
}
class FakeDisposer {
    constructor(clock) { this.clock = clock; this.callbacks = []; this.disposed = false; }
    once(ms, cb) { return this.clock.add(ms, cb, false); }
    repeat(ms, cb) { return this.clock.add(ms, cb, true); }
    cancel(id) { if (id) this.clock.cancel(id); }
    add(cb) { this.callbacks.push(cb); }
    dispose() { this.disposed = true; for (const cb of this.callbacks.reverse()) cb(); this.clock.timers.clear(); }
}
const MODES = {linear: t => t, in: t => t * t, out: t => 1 - (1 - t) * (1 - t), 'in-out': t => t};
class FakeActor {
    constructor(clock, {walkReady = true} = {}) {
        this.clock = clock; this.walkReady = walkReady; this.height = 240; this.width = 86;
        this.x = 0; this.tx = null; this.y = 0; this.log = []; this.frames = []; this.pose = 'right'; this.walking = false; this.visible = true;
    }
    _t(ev) { this.log.push(ev); }
    setHeight(px) { this.height = px; this.width = Math.round(px * 173 / 480); }
    setBounds() {} setPosition() {} setCharacterVisible(v) { this.visible = v; }
    setPose(p) { this.pose = p; this._t(['pose', p]); }
    getTranslationX() { if (!this.tx) return this.x; const t = Math.min(1, (this.clock.now - this.tx.start) / this.tx.dur); return this.tx.from + (this.tx.to - this.tx.from) * MODES[this.tx.mode](t); }
    easeTranslationX(to, dur, mode) { const from = this.getTranslationX(); this.tx = {from, to, dur, start: this.clock.now, mode}; this._t(['easeX', Math.round(to), dur, mode]); }
    easeTranslationY() {} setTranslationY(v) { this.y = v; }
    setTranslationX(v) { this.x = v; this.tx = null; }
    stopAnimations() { this.x = this.getTranslationX(); this.tx = null; }
    beginWalk(d) { this.walkDir = d; this._t(['beginWalk', d]); }
    showWalkFrame(seq, i) { this.walking = true; this.frames.push({seq, i, at: this.clock.now, x: this.getTranslationX()}); }
    endWalk() { if (!this.walking) return; this.walking = false; this._t(['endWalk']); }
}
const makeEnv = (over = {}) => ({
    animations: true, overview: false, pointer: [900, 500],
    animationsEnabled() { return this.animations; }, overviewVisible() { return this.overview; },
    getWorkArea() { return {x: 0, y: 0, width: 1920, height: 1080}; }, getPointer() { return this.pointer; }, watchWorkArea() {},
    ...over,
});
function setup({walk = real, walkReady = true, config = {}} = {}) {
    const clock = new Clock(), disposer = new FakeDisposer(clock), actor = new FakeActor(clock, {walkReady}), env = makeEnv();
    Date.now = () => clock.now;
    Math.random = () => 0.5;
    const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
    const c = new CharacterController({actor, environment: env, disposer, walk});
    c.start({...DEFAULT_CONFIG, ...config});
    return {clock, disposer, actor, env, c, logs, restore: () => { console.log = origLog; }};
}
// Runs until the animator has produced `n` frames or the limit passes.
const runUntil = (clock, pred, limitMs = 60000, step = 31) => { for (let t = 0; t < limitMs && !pred(); t += step) clock.advance(step); return pred(); };
const seqOf = frames => frames.map(f => `${f.seq[0]}${f.i}`);


let passed = 0; const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const orig = {now: Date.now, random: Math.random, log: console.log};
const range = (n, f = i => i) => Array.from({length: n}, (_, i) => f(i));
const targetOf = logs => { const m = logs.map(l => /walking (\d+) -> (\d+)/.exec(l)).filter(Boolean); return m.length ? [Number(m[0][1]), Number(m[0][2])] : null; };

test('roam walk: start(7) -> whole loop cycles -> stop(25), in order, one frame time each, ends on the target and idles', () => {
    const t = setup();
    assert.ok(runUntil(t.clock, () => t.actor.frames.length > 0), 'walk started');
    assert.deepEqual(t.actor.log.find(e => e[0] === 'beginWalk'), ['beginWalk', 'right']);
    assert.ok(runUntil(t.clock, () => t.actor.frames.length > 0 && !t.actor.walking), 'walk ended');
    const f = t.actor.frames, [from, target] = targetOf(t.logs);
    const loops = f.filter(x => x.seq === 'loop').length;
    assert.ok(loops >= 10 && loops % 10 === 0, `loop frames ${loops}`);
    assert.deepEqual(f.map(x => `${x.seq}${x.i}`), [...range(7, i => `start${i}`), ...range(loops, i => `loop${i % 10}`), ...range(25, i => `stop${i}`)]);
    for (let i = 1; i < f.length; i++) assert.equal(f[i].at - f[i - 1].at, FRAME, `frame ${i} lasted ${f[i].at - f[i - 1].at} ms`);
    assert.ok(Math.abs(t.actor.x - target) < 0.51, `ended at ${t.actor.x}, target ${target}`);
    for (let i = 1; i < f.length; i++) assert.ok(f[i].x >= f[i - 1].x - 1e-6, 'never moves backwards');
    assert.equal(t.c._phase, 'idle'); assert.ok(t.logs.some(l => /arrived at/.test(l)));
    assert.ok(!t.clock.repeating.includes(FRAME), 'frame timer is gone after the walk');
    assert.equal(t.actor.log.filter(e => e[0] === 'pose' && e[1] !== 'right').length, 0, 'no pose changes while walking');
});

test('movement and animation agree: loop distance per cycle stays within 20% of the stride (little foot sliding)', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.length > 0 && !t.actor.walking);
    const f = t.actor.frames, stride = real.motion.strideHeights * 240;
    const loopF = f.filter(x => x.seq === 'loop');
    const cycleStarts = loopF.filter(x => x.i === 0);
    for (let k = 1; k < cycleStarts.length; k++) {
        const d = cycleStarts[k].x - cycleStarts[k - 1].x;
        assert.ok(Math.abs(d / stride - 1) <= 0.2, `cycle ${k}: ${d.toFixed(1)} px vs stride ${stride.toFixed(1)}`);
    }
});

test('left-facing walk (home bottom-right): mirrored direction, moves left, same frame logic', () => {
    const t = setup({config: {corner: 'bottom-right'}});
    runUntil(t.clock, () => t.actor.frames.length > 0 && !t.actor.walking);
    assert.deepEqual(t.actor.log.find(e => e[0] === 'beginWalk'), ['beginWalk', 'left']);
    const f = t.actor.frames; for (let i = 1; i < f.length; i++) assert.ok(f[i].x <= f[i - 1].x + 1e-6);
    assert.equal(f.filter(x => x.seq === 'start').length, 7); assert.equal(f.filter(x => x.seq === 'stop').length, 25);
});

test('click during the loop: the current cycle finishes, the stop sequence plays, and only then does she react', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 3));
    const before = t.actor.frames.length; t.c.handleClick();
    assert.notEqual(t.c._phase, 'reacting'); assert.ok(t.actor.walking, 'still walking');
    runUntil(t.clock, () => t.c._phase === 'reacting');
    const after = t.actor.frames.slice(before - 1).map(x => `${x.seq}${x.i}`);
    assert.deepEqual(after, ['loop3', ...range(6, i => `loop${i + 4}`), ...range(25, i => `stop${i}`)]);
    const events = t.actor.log.map(e => e.join(':')), endAt = events.indexOf('endWalk'), frontAt = events.lastIndexOf('pose:front');
    assert.ok(endAt >= 0 && frontAt > endAt, 'reaction pose only after the walk layer was hidden');
    assert.equal(t.actor.log.filter(e => e[0] === 'endWalk').length, 1);
});

test('click during the start sequence: loop is skipped, stop follows the start sequence', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'start' && x.i === 2));
    t.c.handleClick();
    runUntil(t.clock, () => t.c._phase === 'reacting');
    assert.equal(t.actor.frames.filter(x => x.seq === 'loop').length, 0);
    assert.deepEqual(t.actor.frames.map(x => `${x.seq}${x.i}`), [...range(7, i => `start${i}`), ...range(25, i => `stop${i}`)]);
});

test('an interrupted walk never overshoots the work area and never moves backwards', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 5));
    t.c.handleClick(); runUntil(t.clock, () => t.c._phase === 'reacting');
    const [, target] = targetOf(t.logs), f = t.actor.frames;
    for (let i = 1; i < f.length; i++) assert.ok(f[i].x >= f[i - 1].x - 1e-6);
    assert.ok(t.actor.x <= target + 0.51 && t.actor.x >= f[0].x);
});

test('walking requested during the stop sequence: the stop finishes, then a new walk begins (no overlap)', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'stop' && x.i === 5));
    t.c.summon();                                       // pointer at x=900
    assert.ok(t.actor.walking, 'stop continues');
    runUntil(t.clock, () => t.actor.frames.filter(x => x.seq === 'start' && x.i === 0).length === 2);
    const f = t.actor.frames, secondStart = f.map((x, i) => (x.seq === 'start' && x.i === 0 ? i : -1)).filter(i => i >= 0)[1];
    assert.deepEqual(f[secondStart - 1] && `${f[secondStart - 1].seq}${f[secondStart - 1].i}`, 'stop24');
    assert.ok(f[secondStart].at - f[secondStart - 1].at >= FRAME);
    const iEnd = t.actor.log.findIndex(e => e[0] === 'endWalk'), iBegin = t.actor.log.map(e => e[0]).lastIndexOf('beginWalk');
    assert.ok(iEnd >= 0 && iBegin > iEnd, 'walk layer hidden between the two walks');
});

test('several requests while stopping: the latest wins and the reaction runs exactly once', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 2));
    t.c.handleClick(); t.c.handleClick(); t.c.handleClick();
    runUntil(t.clock, () => t.c._phase === 'reacting');
    assert.equal(t.actor.log.filter(e => e[0] === 'endWalk').length, 1);
    assert.equal(t.actor.log.filter(e => e[0] === 'pose' && e[1] === 'front').length, 1);
});

test('soft config change (quiet) mid-walk: stops gracefully first, then applies', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 4));
    t.c.configure({...DEFAULT_CONFIG, quiet: true});
    assert.ok(t.actor.walking);
    runUntil(t.clock, () => !t.actor.walking);
    assert.equal(t.actor.frames.filter(x => x.seq === 'stop').length, 25);
    assert.equal(t.c._phase, 'idle'); assert.equal(t.c._cfg.quiet, true);
    assert.ok(!t.clock.repeating.includes(1800), 'no idle bob in quiet mode');
});

test('hiding mid-walk halts immediately (nothing visible to animate): layer hidden, timers cancelled', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 4));
    t.c.configure({...DEFAULT_CONFIG, hidden: true});
    assert.equal(t.actor.walking, false); assert.ok(!t.clock.repeating.includes(FRAME));
    const n = t.actor.frames.length; t.clock.advance(5000); assert.equal(t.actor.frames.length, n, 'no frames after halt');
});

test('Overview mid-walk halts immediately and she idles afterwards', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 2));
    t.env.overview = true; t.clock.advance(600);
    assert.equal(t.actor.walking, false); const n = t.actor.frames.length;
    t.env.overview = false; t.clock.advance(1000);
    assert.equal(t.c._phase, 'idle'); assert.equal(t.actor.frames.length, n);
});

test('animations disabled (reduced motion): no walk frames, she arrives at once and idles', () => {
    const t = setup(); t.env.animations = false;
    runUntil(t.clock, () => t.logs.some(l => /animations off/.test(l)));
    const [, target] = targetOf(t.logs);
    assert.equal(t.actor.frames.length, 0); assert.ok(Math.abs(t.actor.x - target) < 0.51, `x ${t.actor.x} vs logged ${target}`); assert.equal(t.c._phase, 'idle');
});

test('no walk assets (or walkReady false): 0.1 glide fallback, no frames', () => {
    for (const opts of [{walk: null}, {walkReady: false}]) {
        const t = setup(opts);
        runUntil(t.clock, () => t.logs.some(l => /arrived at/.test(l)));
        assert.equal(t.actor.frames.length, 0); assert.ok(t.logs.some(l => /glide/.test(l)));
        assert.equal(t.c._phase, 'idle');
    }
});

test('very short walks use the glide fallback instead of a distorted animation', () => {
    const t = setup(); t.env.pointer = [165, 500];      // target 54: 30 px from home
    t.clock.advance(100); t.c.summon();
    runUntil(t.clock, () => t.logs.some(l => /summon/.test(l)) && t.logs.some(l => /glide/.test(l)));
    assert.equal(t.actor.frames.length, 0);
});

test('shutdown mid-walk: all timers gone, no callbacks afterwards', () => {
    const t = setup();
    runUntil(t.clock, () => t.actor.frames.some(x => x.seq === 'loop' && x.i === 4));
    t.disposer.dispose();
    assert.equal(t.clock.timers.size, 0); const n = t.actor.frames.length, e = t.actor.log.length;
    t.clock.advance(20000); assert.equal(t.actor.frames.length, n); assert.equal(t.actor.log.length, e);
});

test('works with other frame counts and frame times (3/4/5 frames, 60 ms): nothing assumes 7/10/25/93', () => {
    const m = structuredClone(real);
    const frames = n => range(n, i => ({x: 2 + i * 10, y: 12, dy: 0}));
    m.sequences = {start: {frameMs: 60, travelFrames: 3, frames: frames(3)}, loop: {frameMs: 60, frames: frames(4)}, stop: {frameMs: 60, travelFrames: 2, frames: frames(5)}};
    const t = setup({walk: m});
    runUntil(t.clock, () => t.actor.frames.length > 0 && !t.actor.walking);
    const f = t.actor.frames, loops = f.filter(x => x.seq === 'loop').length;
    assert.equal(f.filter(x => x.seq === 'start').length, 3); assert.equal(f.filter(x => x.seq === 'stop').length, 5); assert.ok(loops % 4 === 0 && loops > 0);
    for (let i = 1; i < f.length; i++) assert.equal(f[i].at - f[i - 1].at, 60);
    assert.ok(Math.abs(t.actor.x - targetOf(t.logs)[1]) < 0.51);
});

test('repeated walks leave nothing behind: timers and animator state return to the idle baseline', () => {
    const t = setup(); const baseline = t.clock.timers.size;
    for (let k = 0; k < 4; k++) { t.c.returnHome(); runUntil(t.clock, () => !t.actor.walking && t.c._phase === 'idle', 30000); t.c._decide('roam'); runUntil(t.clock, () => !t.actor.walking && t.c._phase === 'idle' && t.actor.frames.length > 0, 30000); }
    assert.ok(t.clock.timers.size <= baseline + 1, `timers ${t.clock.timers.size} vs baseline ${baseline}`);
    assert.ok(!t.clock.repeating.includes(FRAME)); assert.equal(t.c._anim, null); assert.equal(t.c._walkRun, null);
});

for (const [name, fn] of tests) {
    let error = null;
    try { await fn(); } catch (e) { error = e; }
    Date.now = orig.now; Math.random = orig.random; console.log = orig.log;      // restore BEFORE printing
    if (error) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; console.log(`ok   ${name}`); }
}
console.log(`\n${passed}/${tests.length} passed (MOCKED actor/environment/Disposer/clock; real controller.js and walk.js)`);
