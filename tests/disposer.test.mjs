// Tests of the REAL lib/disposer.js (the cleanup helper behind every signal, timer and callback of the extension), with a
// minimal GLib stand-in for timers. They prove the helper's own behaviour: every connected signal is disconnected on dispose(),
// repeated enable/disable cycles leave nothing behind, disposing twice is safe, and one failing disconnect does not stop
// the rest. They do NOT prove anything about the real GNOME Shell. Run: node --import ./tests/mocks/register.mjs tests/disposer.test.mjs
import assert from 'node:assert/strict';
import GLib from 'gi://GLib';
import {Disposer, liveCounts} from '../lib/disposer.js';

const timers = new Map(); globalThis.__glibTimers = timers;
GLib._timers = timers;
GLib.timeout_add = (priority, ms, cb) => { const id = timers.size + 1 + Math.floor(Math.random() * 1e6); timers.set(id, cb); return id; };

class FakeObject {
    constructor() { this.handlers = new Map(); this.next = 1; this.failDisconnect = false; }
    connect(name, fn) { const id = this.next++; this.handlers.set(id, {name, fn}); return id; }
    disconnect(id) { if (this.failDisconnect) throw new Error('boom'); if (!this.handlers.delete(id)) throw new Error('unknown handler id'); }
}
const quiet = fn => { const real = console.error; const seen = []; console.error = (...a) => seen.push(a.join(' ')); try { return [fn(), seen]; } finally { console.error = real; } };
let passed = 0; const tests = []; const test = (n, f) => tests.push([n, f]);

test('dispose() disconnects every signal it connected, runs callbacks newest first, and releases timers', () => {
    const settings = new FakeObject(); const order = []; const d = new Disposer('t');
    d.connect(settings, 'changed', () => {}); d.connect(settings, 'changed::name', () => {});
    d.add(() => order.push('first'), 'first'); d.add(() => order.push('second'), 'second'); d.once(1000, () => {}); d.repeat(100, () => true);
    assert.equal(settings.handlers.size, 2); assert.deepEqual(liveCounts(), {signals: 2, timeouts: 2, callbacks: 2});
    const released = d.dispose();
    assert.equal(settings.handlers.size, 0); assert.deepEqual(order, ['second', 'first']);
    assert.deepEqual(liveCounts(), {signals: 0, timeouts: 0, callbacks: 0}); assert.equal(released.signals, 2);
});

test('25 enable/disable cycles leave no handler on the long-lived settings object and no live counters', () => {
    const settings = new FakeObject();                              // lives across cycles like the extension's GSettings
    for (let cycle = 0; cycle < 25; cycle++) {
        const d = new Disposer(`cycle ${cycle}`);
        d.connect(settings, 'changed', () => {}); d.repeat(200, () => true); d.add(() => {}, 'x');
        assert.equal(settings.handlers.size, 1, `exactly one handler while enabled (cycle ${cycle})`);
        d.dispose();
        assert.equal(settings.handlers.size, 0, `no handler left after disable (cycle ${cycle})`);
    }
    assert.deepEqual(liveCounts(), {signals: 0, timeouts: 0, callbacks: 0});
});

test('explicit handler ids, as extension.js now keeps them, disconnect exactly once and never twice', () => {
    const settings = new FakeObject(); const ids = [settings.connect('changed', () => {}), settings.connect('changed::character-name', () => {})];
    for (const id of ids) settings.disconnect(id); assert.equal(settings.handlers.size, 0);
    assert.throws(() => settings.disconnect(ids[0]), /unknown handler id/);   // a second disconnect is an error: teardown must clear the ids (extension.js does)
});

test('disposing twice is harmless, and using a disposed Disposer fails loudly', () => {
    const d = new Disposer('t'); d.connect(new FakeObject(), 'x', () => {}); d.dispose(); assert.doesNotThrow(() => d.dispose());
    assert.throws(() => d.connect(new FakeObject(), 'x', () => {}), /after dispose/);
});

test('one failing disconnect is reported but does not stop the others', () => {
    const bad = new FakeObject(), good = new FakeObject(); const d = new Disposer('t'); d.connect(bad, 'a', () => {}); d.connect(good, 'b', () => {}); bad.failDisconnect = true;
    const [, seen] = quiet(() => d.dispose()); assert.equal(good.handlers.size, 0); assert.ok(seen.some(l => /failed to disconnect 'a'/.test(l))); assert.deepEqual(liveCounts(), {signals: 0, timeouts: 0, callbacks: 0});
});

for (const [name, fn] of tests) {
    let error = null; try { fn(); } catch (e) { error = e; }
    if (error) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; console.log(`ok   ${name}`); }
}
console.log(`\n${passed}/${tests.length} passed (real lib/disposer.js; GLib timers and GObject signals are stand-ins)`);
