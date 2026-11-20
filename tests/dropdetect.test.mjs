// Real tests (plain Node) for lib/dropdetect.js and lib/backpack/summary.js. Run: node tests/dropdetect.test.mjs
import assert from 'node:assert/strict';
import {DropTracker, HOVER_STALE_MS} from '../lib/dropdetect.js';
import {summariseReceive} from '../lib/backpack/summary.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };
const T0 = 10_000;

test('hover, then release over her with the button up: one drop', () => {
    const t = new DropTracker(); t.begin(); assert.deepEqual(t.hover(T0), {first: true}); assert.deepEqual(t.hover(T0 + 30), {first: false});
    assert.deepEqual(t.end({now: T0 + 60, buttonDown: false, overTarget: true}), {drop: true, reason: 'released-over-target'});
});

test('Escape (button still held) is a cancel, never a drop', () => {
    const t = new DropTracker(); t.begin(); t.hover(T0); assert.deepEqual(t.end({now: T0 + 20, buttonDown: true, overTarget: true}), {drop: false, reason: 'cancelled'});
});

test('an unknown button state is treated as "not a drop"', () => {
    for (const unknown of [null, undefined]) { const t = new DropTracker(); t.begin(); t.hover(T0); assert.equal(t.end({now: T0 + 20, buttonDown: unknown, overTarget: true}).reason, 'unknown-button-state'); }
});

test('a drag that never hovered her, or whose pointer left, is not a drop', () => {
    const a = new DropTracker(); a.begin(); assert.equal(a.end({now: T0, buttonDown: false, overTarget: false}).reason, 'not-over-target');
    const b = new DropTracker(); b.begin(); b.hover(T0); assert.equal(b.end({now: T0 + HOVER_STALE_MS + 1, buttonDown: false, overTarget: true}).reason, 'not-over-target', 'stale hover');
    const c = new DropTracker(); c.begin(); c.hover(T0); assert.equal(c.end({now: T0 + 20, buttonDown: false, overTarget: false}).reason, 'not-over-target', 'pointer no longer over her');
});

test('expire() reports the pointer leaving, and a new hover starts fresh', () => {
    const t = new DropTracker(); t.begin(); t.hover(T0); assert.equal(t.expire(T0 + 100), false); assert.equal(t.expire(T0 + HOVER_STALE_MS + 1), true); assert.equal(t.hovering, false);
    assert.equal(t.expire(T0 + 1000), false); assert.deepEqual(t.hover(T0 + 1100), {first: true});
});

test('one drag gives at most one decision (no double processing), and each drag has its own id', () => {
    const t = new DropTracker(); const id1 = t.begin(); t.hover(T0);
    assert.equal(t.end({now: T0 + 10, buttonDown: false, overTarget: true}).drop, true);
    assert.equal(t.end({now: T0 + 11, buttonDown: false, overTarget: true}).reason, 'no-drag'); assert.equal(t.hover(T0 + 12).first, false);
    const id2 = t.begin(); assert.equal(id2, id1 + 1);
});

test('events outside a drag are ignored', () => {
    const t = new DropTracker(); assert.deepEqual(t.hover(T0), {first: false}); assert.equal(t.expire(T0 + 9999), false); assert.equal(t.end({now: T0, buttonDown: false}).reason, 'no-drag');
});

test('summary wording: success, pocket fallback, full, rejections, clipboard hint', () => {
    const f = {kind: 'file'}, n = {kind: 'text'}, l = {kind: 'link'};
    assert.deepEqual(summariseReceive({added: [f, n, n], skipped: []}, [], 'backpack'), {text: 'Added 1 file and 2 notes to the backpack.', error: false});
    assert.match(summariseReceive({added: [{...l, viaPocket: true}], skipped: []}, [], 'backpack').text, /backpack is full, so 1 link went into the pocket.*press Keep to move it/);
    const full = summariseReceive({added: [], skipped: [{name: 'x', reason: 'The pocket is full (12 items).', code: 'pocket-full'}]}, [], 'backpack'); assert.equal(full.error, true); assert.match(full.text, /unchanged where it came from/);
    assert.match(summariseReceive({added: [], skipped: [{name: 'a', reason: 'r', code: 'slots-full'}]}, [], 'backpack', {clipboardHint: true}).text, /still on your clipboard/);
    const many = summariseReceive({added: [f], skipped: [1, 2, 3, 4].map(i => ({name: `s${i}`, reason: 'no'}))}, [{what: 'r', reason: 'bad'}], 'pocket');
    assert.match(many.text, /Added 1 file to the pocket\./); assert.match(many.text, /and 2 more skipped/); assert.equal(many.error, false);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
