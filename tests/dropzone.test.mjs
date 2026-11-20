// MOCKED tests of lib/dropzone.js with the real intake, service (Gio stand-ins), drop decision logic and summary wording.
// The Shell (Main.xdndHandler, DND), Meta.Selection, the pointer and the actor are stand-ins written for this file. These tests prove OUR logic
// (one decision per drag, escape vs release, caps, storage rules, cleanup). They do NOT prove that GNOME Shell 51.1 delivers the events or the
// data as assumed: that is exactly what docs/test-plan-0.3.1.md asks you to check. Run: node --import ./tests/mocks/register.mjs tests/dropzone.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setXdnd} from './mocks/main.mjs';
import Meta from './mocks/meta.mjs';
import {BackpackService} from '../lib/backpack/service.js';
import {DropZone, MAX_PAYLOAD_BYTES, MESSAGES} from '../lib/dropzone.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bavi-dz-'));
const tick = () => new Promise(r => setImmediate(r));
const realNow = Date.now; let clock = 1_000_000; const advance = ms => { clock += ms; };
const quiet = fn => { const e = console.error, l = console.log; console.error = console.log = () => {}; try { return fn(); } finally { console.error = e; console.log = l; } };

class FakeXdnd { constructor() { this.h = new Map(); this.n = 1; } connect(s, f) { const id = this.n++; this.h.set(id, {s, f}); return id; } disconnect(id) { this.h.delete(id); } emit(s) { for (const {s: n, f} of [...this.h.values()]) if (n === s) f(); } get size() { return this.h.size; } }
class FakeDisposer { constructor() { this.repeats = new Map(); this.callbacks = []; this.n = 1; } connect(o, s, f) { const id = o.connect(s, f); this.callbacks.push(() => o.disconnect(id)); return id; }
    repeat(ms, cb) { const id = this.n++; this.repeats.set(id, cb); return id; } once() { return this.n++; } cancel(id) { this.repeats.delete(id); } add(cb) { this.callbacks.push(cb); }
    tickRepeats() { for (const cb of [...this.repeats.values()]) cb(); } dispose() { for (const cb of this.callbacks.reverse()) cb(); this.callbacks = []; this.repeats.clear(); } }
class FakeActor { constructor() { this.target = null; this.ready = false; this.inside = true; this.glowLog = []; }
    setDragTarget(f) { this.target = f; } setDropReady(v) { this.ready = v; this.glowLog.push(v); } containsPoint() { return this.inside; } }
class FakeSelection {
    constructor() { this.mimes = []; this.payloads = {}; this.delay = false; this.transfers = []; }
    get_mimetypes() { return [...this.mimes]; }
    transfer_async(type, mime, max, out, cancellable, cb) {
        this.transfers.push({type, mime, max, cancellable});
        const finish = () => { const data = Buffer.from(this.payloads[mime] ?? '', 'utf8');
            if (cancellable?.cancelled) return cb(this, {error: new Error('cancelled')});
            if (data.length > max) return cb(this, {error: new Error('payload too large')}); out.chunks.push(data); cb(this, {}); };
        if (this.delay) this.pending = finish; else setImmediate(finish);
    }
    transfer_finish(r) { if (r.error) throw r.error; return true; }
}

async function setup({enabled = true, ownMain = true} = {}) {
    Date.now = () => clock; clock += 10_000;
    const xdnd = new FakeXdnd(); if (ownMain) setXdnd(xdnd);
    const selection = new FakeSelection(); const pointer = {x: 10, y: 10, mods: 0};
    globalThis.global = {get_pointer: () => [pointer.x, pointer.y, pointer.mods], display: {get_selection: () => selection}};
    const service = new BackpackService({disposer: {repeat() { return 1; }}, dataDir: tmp(), getExpiryHours: () => 24, createLaunchContext: () => null, onChanged() {}});
    await service.start();
    const actor = new FakeActor(), disposer = new FakeDisposer(), msgs = [], state = {received: 0, hold: []}; let on = enabled;
    const zone = new DropZone({actor, service, disposer, isEnabled: () => on, onReceived: () => { state.received++; }, onDragState: a => state.hold.push(a), showMessage: (t, e) => msgs.push({t, e})});
    const started = zone.start();
    return {xdnd, selection, pointer, service, actor, disposer, msgs, state, zone, started, setEnabled: v => { on = v; },
        begin() { xdnd.emit('drag-begin'); }, hover() { return actor.target?.(xdnd, 5, 5); }, end(buttonUp = true, over = true) { pointer.mods = buttonUp ? 0 : 256; actor.inside = over; xdnd.emit('drag-end'); }};
}
const stored = t => { const s = t.service.snapshot(); return [...s.backpack, ...s.pocket]; };

let passed = 0; const tests = []; const test = (n, f) => tests.push([n, f]);

test('unavailable APIs disable the feature cleanly (no handler, no crash)', async () => {
    const t = await setup({ownMain: false}); setXdnd(null); const z2 = new DropZone({actor: new FakeActor(), service: t.service, disposer: new FakeDisposer(), isEnabled: () => true, onReceived() {}, onDragState() {}, showMessage() {}});
    assert.equal(quiet(() => z2.start()), false);
    const saved = Meta.SelectionType; Meta.SelectionType = undefined; setXdnd(new FakeXdnd());
    const z3 = new DropZone({actor: new FakeActor(), service: t.service, disposer: new FakeDisposer(), isEnabled: () => true, onReceived() {}, onDragState() {}, showMessage() {}});
    assert.equal(quiet(() => z3.start()), false); Meta.SelectionType = saved;
});

test('a file dropped on her is stored by reference; the original is untouched; she reacts and says so', async () => {
    const t = await setup(); const f = path.join(tmp(), 'any.weird-ext'); fs.writeFileSync(f, 'original'); const mtime = fs.statSync(f).mtimeMs;
    t.selection.mimes = ['text/uri-list', 'application/x-whatever']; t.selection.payloads['text/uri-list'] = `file://${f}\r\n`;
    assert.equal(t.started, true); t.begin(); assert.deepEqual(t.state.hold, [true]); t.hover(); assert.equal(t.actor.ready, true); await tick(); await tick();
    assert.equal(t.selection.transfers.length, 1); assert.equal(t.selection.transfers[0].mime, 'text/uri-list'); assert.equal(t.selection.transfers[0].type, Meta.SelectionType.SELECTION_DND); assert.equal(t.selection.transfers[0].max, MAX_PAYLOAD_BYTES);
    t.end(); assert.deepEqual(t.msgs, [{t: 'Added 1 file to the backpack.', e: false}]); assert.equal(t.state.received, 1); assert.equal(t.actor.ready, false); assert.deepEqual(t.state.hold, [true, false]);
    const [item] = stored(t); assert.equal(item.kind, 'file'); assert.equal(item.path, f); assert.equal(fs.readFileSync(f, 'utf8'), 'original'); assert.equal(fs.statSync(f).mtimeMs, mtime);
});

test('every file type is accepted by content, not by extension or MIME type of the file (pdf, zip, source, no extension, odd extension)', async () => {
    const dir = tmp(); const names = ['a.pdf', 'b.png', 'c.mp4', 'd.zip', 'e.rs', 'f.txt', 'noext', 'g.unknown-ext-123']; const files = names.map(n => { const p = path.join(dir, n); fs.writeFileSync(p, n); return p; });
    const t = await setup(); t.selection.mimes = ['text/uri-list']; t.selection.payloads['text/uri-list'] = files.map(p => `file://${p}`).join('\r\n');
    t.begin(); t.hover(); await tick(); await tick(); t.end();
    assert.equal(stored(t).length, 8); assert.equal(t.msgs[0].t, 'Added 8 files to the backpack.'); for (const p of files) assert.equal(fs.existsSync(p), true);
});

test('selected text becomes a note; an http(s) link (as text or in a uri-list) becomes a link', async () => {
    const t = await setup();
    t.selection.mimes = ['text/plain;charset=utf-8', 'text/html']; t.selection.payloads['text/plain;charset=utf-8'] = 'remember the milk';
    t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t)[0].kind, 'text'); assert.equal(stored(t)[0].text, 'remember the milk');
    t.selection.payloads['text/plain;charset=utf-8'] = 'https://example.org/page?x=1'; t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t).find(i => i.kind === 'link').url, 'https://example.org/page?x=1');
    t.selection.mimes = ['text/uri-list', 'text/plain']; t.selection.payloads['text/uri-list'] = 'https://example.net/a\r\n'; t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t).filter(i => i.kind === 'link').length, 2);
});

test('Escape (button still held) stores nothing and says nothing; releasing elsewhere, or never hovering, stores nothing', async () => {
    const t = await setup(); t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'x';
    t.begin(); t.hover(); await tick(); await tick(); t.end(false, true); assert.equal(stored(t).length, 0); assert.deepEqual(t.msgs, []); assert.equal(t.actor.ready, false);
    t.begin(); t.hover(); await tick(); await tick(); t.end(true, false); assert.equal(stored(t).length, 0);
    t.begin(); t.end(true, true); assert.equal(stored(t).length, 0); assert.equal(t.selection.transfers.length, 2, 'no data was requested for a drag that never hovered her');
    t.begin(); t.hover(); await tick(); await tick(); advance(1000); t.end(true, true); assert.equal(stored(t).length, 0, 'a stale hover is not a drop');
});

test('releasing before the data was read gives a clear message and stores nothing', async () => {
    const t = await setup(); t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'slow'; t.selection.delay = true;
    t.begin(); t.hover(); t.end(); assert.equal(stored(t).length, 0); assert.deepEqual(t.msgs, [{t: MESSAGES.notReady, e: true}]); assert.equal(t.selection.transfers[0].cancellable.cancelled, true, 'the unfinished read was cancelled');
});

test('unsupported or unreadable payloads: clear message, nothing stored, backpack untouched', async () => {
    const t = await setup(); t.service.addText({text: 'existing'}, 'backpack'); const before = JSON.stringify(stored(t));
    t.selection.mimes = ['image/png', 'application/x-thing']; t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.deepEqual(t.msgs.at(-1), {t: MESSAGES.unsupported, e: true});
    t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'x'.repeat(MAX_PAYLOAD_BYTES + 1); t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.deepEqual(t.msgs.at(-1), {t: MESSAGES.unreadable, e: true});
    t.selection.payloads['text/plain'] = 'a\u0000b'; t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.match(t.msgs.at(-1).t, /binary data/);
    t.selection.mimes = ['text/uri-list']; t.selection.payloads['text/uri-list'] = 'javascript:alert(1)\nsmb://h/s'; t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.match(t.msgs.at(-1).t, /Skipped javascript:alert\(1\)/);
    assert.equal(JSON.stringify(stored(t)), before); assert.equal(t.state.received, 0);
});

test('full backpack: the item goes to the pocket with an explicit message; with the pocket full too nothing is replaced or discarded', async () => {
    const t = await setup(); for (let i = 0; i < 12; i++) t.service.addText({text: `b${i}`}, 'backpack');
    t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'one more';
    t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.match(t.msgs.at(-1).t, /backpack is full, so 1 note went into the pocket/); assert.equal(t.service.snapshot().pocket.length, 1); assert.equal(t.msgs.at(-1).e, false);
    for (let i = 0; i < 11; i++) t.service.addText({text: `p${i}`}, 'pocket'); const before = JSON.stringify(stored(t));
    t.selection.payloads['text/plain'] = 'and another'; t.begin(); t.hover(); await tick(); await tick(); t.end();
    assert.equal(t.msgs.at(-1).e, true); assert.match(t.msgs.at(-1).t, /pocket is full/); assert.match(t.msgs.at(-1).t, /unchanged where it came from/); assert.equal(JSON.stringify(stored(t)), before);
});

test('several files: partial acceptance is reported item by item', async () => {
    const dir = tmp(); const a = path.join(dir, 'a'), b = path.join(dir, 'b'); fs.writeFileSync(a, '1'); fs.writeFileSync(b, '2'); fs.mkdirSync(path.join(dir, 'folder'));
    const t = await setup(); t.selection.mimes = ['text/uri-list']; t.selection.payloads['text/uri-list'] = [a, path.join(dir, 'folder'), b, path.join(dir, 'gone')].map(p => `file://${p}`).join('\n');
    t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t).length, 2); assert.match(t.msgs[0].t, /Added 2 files to the backpack\.\nSkipped folder: .*not a regular file.*\nSkipped gone: .*no longer at/); assert.equal(t.msgs[0].e, false);
});

test('one drag is stored at most once, even if the end event repeats; later drags work; the same item twice is a duplicate, not a second entry', async () => {
    const t = await setup(); const f = path.join(tmp(), 'x.txt'); fs.writeFileSync(f, 'x'); t.selection.mimes = ['text/uri-list']; t.selection.payloads['text/uri-list'] = `file://${f}`;
    t.begin(); t.hover(); await tick(); await tick(); t.end(); t.end(); t.xdnd.emit('drag-end'); assert.equal(stored(t).length, 1); assert.equal(t.msgs.length, 1);
    t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t).length, 1); assert.match(t.msgs.at(-1).t, /already in the backpack/);
});

test('with the setting off nothing is tracked, highlighted, read or held; turning it on works without a restart', async () => {
    const t = await setup({enabled: false}); t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'x';
    t.begin(); t.hover(); await tick(); t.end(); assert.equal(t.actor.glowLog.length, 0); assert.equal(t.selection.transfers.length, 0); assert.deepEqual(t.state.hold, []); assert.equal(stored(t).length, 0);
    t.setEnabled(true); t.begin(); t.hover(); await tick(); await tick(); t.end(); assert.equal(stored(t).length, 1);
});

test('hover by something that is not an external drag is ignored; the glow follows the pointer leaving', async () => {
    const t = await setup(); t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'x'; t.begin();
    assert.equal(t.actor.target({}, 1, 1), 3); assert.equal(t.actor.ready, false, 'a source other than the Shell xdnd handler is ignored');
    t.hover(); assert.equal(t.actor.ready, true); advance(400); t.disposer.tickRepeats(); assert.equal(t.actor.ready, false, 'pointer left: glow off'); assert.equal(t.disposer.repeats.size, 1, 'one leave timer while hovered');
    t.hover(); assert.equal(t.actor.ready, true); t.end(false, true); assert.equal(t.disposer.repeats.size, 0, 'leave timer removed at the end of the drag');
});

test('disabling the extension mid-drag: read cancelled, handlers and hook removed, glow off, hold released, late events ignored', async () => {
    const t = await setup(); t.selection.mimes = ['text/plain']; t.selection.payloads['text/plain'] = 'x'; t.selection.delay = true;
    t.begin(); t.hover(); assert.equal(t.xdnd.size, 2); assert.equal(t.actor.ready, true);
    t.disposer.dispose(); assert.equal(t.xdnd.size, 0, 'both Shell signals disconnected'); assert.equal(t.actor.target, null); assert.equal(t.actor.ready, false); assert.equal(t.state.hold.at(-1), false);
    assert.equal(t.selection.transfers[0].cancellable.cancelled, true); t.selection.pending?.(); await tick(); t.xdnd.emit('drag-end'); assert.equal(stored(t).length, 0); assert.deepEqual(t.msgs, []);
});

test('25 enable/disable cycles leave no handler on the Shell object', async () => {
    const xdnd = new FakeXdnd(); setXdnd(xdnd); const selection = new FakeSelection(); globalThis.global = {get_pointer: () => [0, 0, 0], display: {get_selection: () => selection}};
    for (let i = 0; i < 25; i++) { const d = new FakeDisposer(); const z = new DropZone({actor: new FakeActor(), service: {}, disposer: d, isEnabled: () => true, onReceived() {}, onDragState() {}, showMessage() {}}); z.start(); assert.equal(xdnd.size, 2); d.dispose(); assert.equal(xdnd.size, 0); }
});

for (const [name, fn] of tests) {
    let error = null; try { await fn(); } catch (e) { error = e; }
    Date.now = realNow;
    if (error) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; console.log(`ok   ${name}`); }
}
console.log(`\n${passed}/${tests.length} passed (MOCKED Shell/Meta.Selection/actor; real dropzone.js, dropdetect.js, intake.js, service.js)`);
