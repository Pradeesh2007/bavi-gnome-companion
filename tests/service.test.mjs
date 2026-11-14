// Tests lib/backpack/{store,service}.js against hand-written stand-ins for Gio/GLib (tests/mocks).
// They check OUR logic (persistence, rollback, expiry, import, open safety). They do NOT prove that the real Gio
// behaves like the stand-ins: that is what the nested session tests are for.
// Run: node --import ./tests/mocks/register.mjs tests/service.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BackpackService} from '../lib/backpack/service.js';
import {InventoryError} from '../lib/backpack/model.js';
import Gio, {launched} from './mocks/gio.mjs';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bavi-test-'));
class FakeDisposer { constructor() { this.timers = []; } repeat(ms, cb) { this.timers.push({ms, cb}); return 1; } }
const make = (dir, opts = {}) => {
    const disposer = new FakeDisposer(); let changed = 0;
    const svc = new BackpackService({disposer, dataDir: dir, getExpiryHours: () => opts.hours ?? 24,
        createLaunchContext: () => null, onChanged: () => { changed++; }});
    svc.start();
    return {svc, disposer, changes: () => changed};
};
const codeOf = fn => { try { fn(); } catch (e) { return e.code; } return null; };

test('first start creates nothing until something is saved; add + reload persists', () => {
    const dir = tmp(); const {svc} = make(dir);
    assert.equal(fs.existsSync(`${dir}/inventory.json`), false);
    svc.addText({text: 'remember the milk'}, 'backpack'); svc.addLink({url: 'https://example.org'}, 'pocket');
    assert.equal((fs.statSync(`${dir}/inventory.json`).mode & 0o777), 0o600);
    const again = make(dir).svc.snapshot();
    assert.equal(again.backpack.length, 1); assert.equal(again.pocket.length, 1); assert.equal(again.backpack[0].text, 'remember the milk');
});

test('pocket lifetime follows the setting (and is clamped), existing items keep theirs', () => {
    const dir = tmp(); const a = make(dir, {hours: 2}).svc;
    const it = a.addText({text: 'x'}, 'pocket'); assert.ok(Math.abs((it.expiresAt - it.createdAt) - 2 * 3600_000) < 5);
    const b = make(dir, {hours: 999}).svc; const it2 = b.addText({text: 'y'}, 'pocket');
    assert.equal(it2.expiresAt - it2.createdAt, 168 * 3600_000);
    assert.equal(b.snapshot().pocket.find(i => i.id === it.id).expiresAt, it.expiresAt);
});

test('expired pocket items are removed at start, by the sweep timer and when the list is read', () => {
    const dir = tmp(); const {svc} = make(dir);
    svc.addText({text: 'a'}, 'pocket'); svc.addText({text: 'keep me'}, 'backpack');
    const file = `${dir}/inventory.json`; const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.items.find(i => i.slot === null).expiresAt = Date.now() - 1000; fs.writeFileSync(file, JSON.stringify(data));
    const {svc: s2, disposer} = make(dir);                       // start() sweeps
    assert.equal(s2.snapshot().pocket.length, 0); assert.equal(s2.snapshot().backpack.length, 1);
    s2.addText({text: 'b'}, 'pocket'); const d2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    d2.items.find(i => i.slot === null).expiresAt = Date.now() - 1; fs.writeFileSync(file, JSON.stringify(d2));
    const {svc: s3, disposer: dis3, changes} = make(dir);        // swept at start already; add again then use the timer
    s3.addText({text: 'c'}, 'pocket'); s3._inv.search('');       // in-memory item
    s3._inv._items.find(i => i.slot === null).expiresAt = Date.now() - 1;
    assert.equal(dis3.timers.length, 1); dis3.timers[0].cb();
    assert.equal(s3.snapshot().pocket.length, 0); assert.equal(changes(), 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).items.filter(i => i.slot === null).length, 0);
});

test('full backpack: clear error, nothing written', () => {
    const dir = tmp(); const {svc} = make(dir);
    for (let i = 0; i < 12; i++) svc.addText({text: `n${i}`}, 'backpack');
    const before = fs.readFileSync(`${dir}/inventory.json`, 'utf8');
    assert.equal(codeOf(() => svc.addText({text: 'one too many'}, 'backpack')), 'slots-full');
    assert.equal(fs.readFileSync(`${dir}/inventory.json`, 'utf8'), before);
});

test('a failing save rolls the change back and reports it', () => {
    const dir = tmp(); const {svc} = make(dir);
    svc.addText({text: 'safe'}, 'backpack');
    svc._store.save = () => { throw new Error('disk full'); };
    assert.equal(codeOf(() => svc.addText({text: 'lost'}, 'backpack')), 'save-failed');
    assert.equal(svc.snapshot().backpack.length, 1);
    assert.equal(codeOf(() => svc.remove(svc.snapshot().backpack[0].id)), 'save-failed');
    assert.equal(svc.snapshot().backpack.length, 1);       // removal rolled back too
});

test('corrupt JSON is set aside, not overwritten; empty inventory used', () => {
    const dir = tmp(); fs.writeFileSync(`${dir}/inventory.json`, '{ not json');
    const {svc} = make(dir);
    assert.equal(svc.snapshot().backpack.length, 0); assert.equal(svc.unavailableReason, null);
    const kept = fs.readdirSync(dir).filter(n => n.startsWith('inventory.json.corrupt-'));
    assert.equal(kept.length, 1); assert.equal(fs.readFileSync(`${dir}/${kept[0]}`, 'utf8'), '{ not json');
    svc.addText({text: 'works after'}, 'backpack'); assert.equal(svc.snapshot().backpack.length, 1);
});

test('partially invalid file: valid items kept, original preserved as a copy', () => {
    const dir = tmp(); const good = {id: 1, kind: 'text', title: 't', createdAt: 1, slot: 0, expiresAt: null, text: 'x'};
    const raw = JSON.stringify({version: 1, nextId: 3, items: [good, {id: 2, kind: 'nope'}]}); fs.writeFileSync(`${dir}/inventory.json`, raw);
    const {svc} = make(dir);
    assert.equal(svc.snapshot().backpack.length, 1);
    const kept = fs.readdirSync(dir).filter(n => n.includes('.corrupt-')); assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(`${dir}/${kept[0]}`, 'utf8'), raw);
});

test('a NEWER format file is never touched; changes are refused with the reason', () => {
    const dir = tmp(); const raw = JSON.stringify({version: 99, items: []}); fs.writeFileSync(`${dir}/inventory.json`, raw);
    const {svc} = make(dir);
    assert.match(svc.unavailableReason, /newer version of this extension/);
    assert.equal(codeOf(() => svc.addText({text: 'x'}, 'backpack')), 'unavailable');
    assert.equal(fs.readFileSync(`${dir}/inventory.json`, 'utf8'), raw);
});

test('unusable storage directory: the service still starts and says why', () => {
    const dir = tmp(); fs.writeFileSync(`${dir}/blocker`, 'file'); const {svc} = make(`${dir}/blocker/sub`);
    assert.match(svc.unavailableReason, /could not be opened/);
});

test('import: chosen files are added by reference; folders, missing and duplicates are skipped with reasons; originals untouched', async () => {
    const dir = tmp(); const {svc} = make(dir);
    const a = `${dir}/a b.txt`, folder = `${dir}/folder`; fs.writeFileSync(a, 'hello'); fs.mkdirSync(folder);
    svc._portal.chooseFiles = async () => [`file://${encodeURI(a)}`, `file://${folder}`, `file://${dir}/gone.txt`, `file://${encodeURI(a)}`];
    const r = await svc.importFiles('backpack');
    assert.equal(r.cancelled, false); assert.equal(r.added.length, 1); assert.equal(r.skipped.length, 3);
    assert.match(r.skipped[0].reason, /not a regular file/); assert.match(r.skipped[1].reason, /no longer at/); assert.match(r.skipped[2].reason, /already in the backpack/);
    assert.equal(r.added[0].path, a); assert.equal(r.added[0].title, 'a b.txt'); assert.equal(fs.readFileSync(a, 'utf8'), 'hello');
    svc._portal.chooseFiles = async () => null;
    assert.deepEqual(await svc.importFiles('backpack'), {cancelled: true, added: [], skipped: []});
    svc._portal.chooseFiles = async () => { throw new Error('The file chooser portal (xdg-desktop-portal) is not available.'); };
    await assert.rejects(svc.importFiles('backpack'), e => e.code === 'portal' && /not available/.test(e.message));
});

test('removing a file item never deletes the file', () => {
    const dir = tmp(); const {svc} = make(dir); const f = `${dir}/keep.txt`; fs.writeFileSync(f, 'data');
    svc._inv.addFile({path: f, title: 'keep.txt'}, 'backpack', Date.now(), 1000); svc._store.save(svc._inv);
    svc.remove(svc.snapshot().backpack[0].id); assert.equal(fs.readFileSync(f, 'utf8'), 'data');
});

test('open: documents and links go to the default handler; scripts, executables, missing files are refused', async () => {
    const dir = tmp(); const {svc} = make(dir); launched.length = 0;
    const doc = `${dir}/doc.txt`, script = `${dir}/run.sh`, bin = `${dir}/tool`; fs.writeFileSync(doc, 'd'); fs.writeFileSync(script, '#!/bin/sh'); fs.writeFileSync(bin, 'ELF', {mode: 0o755});
    const add = p => svc._mutate(inv => inv.addFile({path: p}, 'backpack', Date.now(), 1000));
    const [d, s, b] = [add(doc), add(script), add(bin)]; const l = svc.addLink({url: 'https://example.org/x'}, 'backpack');
    assert.equal(await svc.openItem(d.id), 'Opened the file.'); assert.deepEqual(launched, [`file://${doc}`]);
    assert.equal(await svc.openItem(l.id), 'Opened the link.'); assert.equal(launched.at(-1), 'https://example.org/x');
    for (const item of [s, b]) await assert.rejects(svc.openItem(item.id), e => e.code === 'blocked');
    assert.equal(launched.length, 2);                                   // nothing launched for refused files
    fs.rmSync(doc); await assert.rejects(svc.openItem(d.id), e => e.code === 'missing' && /no longer at/.test(e.message));
    const note = svc.addText({text: 'n'}, 'backpack'); await assert.rejects(svc.openItem(note.id), InventoryError);
});

test('reveal falls back to the folder when the file manager call fails; missing file and folder -> error', async () => {
    const dir = tmp(); const {svc} = make(dir); launched.length = 0;
    const f = `${dir}/r.txt`; fs.writeFileSync(f, 'x'); const it = svc._mutate(inv => inv.addFile({path: f}, 'backpack', Date.now(), 1000));
    svc._showItems = async () => { throw new Error('no file manager'); };
    assert.match(await svc.revealItem(it.id), /folder/); assert.equal(launched.at(-1), `file://${dir}`);
    svc._showItems = async () => {}; assert.match(await svc.revealItem(it.id), /file manager/);
    fs.rmSync(dir, {recursive: true}); await assert.rejects(svc.revealItem(it.id), e => e.code === 'missing');
});

test('after destroy(): pending portal cancelled, mutations refused', () => {
    const dir = tmp(); const {svc} = make(dir); let cancelled = false; svc._portal.cancel = () => { cancelled = true; };
    svc.destroy(); assert.equal(cancelled, true); assert.equal(codeOf(() => svc.addText({text: 'x'}, 'backpack')), 'closed');
});

test('receive: files are stored by reference (original untouched), notes and links are stored, with the right kinds', () => {
    const dir = tmp(); const {svc} = make(dir); const f = path.join(dir, 'doc.txt'); fs.writeFileSync(f, 'precious'); const before = fs.statSync(f);
    const r = svc.receive([{kind: 'file', uri: `file://${f}`}, {kind: 'link', url: 'https://example.org/a'}, {kind: 'text', text: 'remember the milk'}], 'backpack');
    assert.deepEqual(r.skipped, []); assert.deepEqual(r.added.map(i => i.kind), ['file', 'link', 'text']);
    assert.equal(svc.snapshot().backpack.length, 3);
    const file = svc.snapshot().backpack.find(i => i.kind === 'file'); assert.equal(file.path, f); assert.equal(file.slot !== null, true);
    assert.equal(fs.readFileSync(f, 'utf8'), 'precious'); assert.equal(fs.statSync(f).mtimeMs, before.mtimeMs); assert.equal(fs.existsSync(f), true);
    assert.equal(make(dir).svc.snapshot().backpack.length, 3, 'persisted');
});

test('receive into the pocket uses the pocket lifetime and the pocket limit', () => {
    const dir = tmp(); const {svc} = make(dir, {hours: 2});
    const r = svc.receive([{kind: 'text', text: 'temp'}], 'pocket'); assert.equal(r.added[0].slot, null);
    assert.ok(Math.abs((r.added[0].expiresAt - r.added[0].createdAt) - 2 * 3600_000) < 5);
    for (let i = 0; i < 11; i++) svc.receive([{kind: 'text', text: `t${i}`}], 'pocket');
    const full = svc.receive([{kind: 'text', text: 'one too many'}], 'pocket'); assert.equal(full.added.length, 0); assert.equal(full.skipped[0].code, 'pocket-full');
});

test('receive with a full backpack: nothing is replaced or discarded, the reason is explicit, and the code says why', () => {
    const dir = tmp(); const {svc} = make(dir);
    for (let i = 0; i < 12; i++) svc.addText({text: `n${i}`}, 'backpack');
    const before = fs.readFileSync(`${dir}/inventory.json`, 'utf8');
    const r = svc.receive([{kind: 'text', text: 'new'}, {kind: 'link', url: 'https://example.org'}], 'backpack');
    assert.equal(r.added.length, 0); assert.deepEqual(r.skipped.map(x => x.code), ['slots-full', 'slots-full']); assert.match(r.skipped[0].reason, /12 of 12 slots/);
    assert.equal(fs.readFileSync(`${dir}/inventory.json`, 'utf8'), before);
    assert.equal(svc.snapshot().backpack.length, 12);
});

test('receive: a partly accepted batch stores what fits and reports the rest; duplicates, folders and missing files are skipped', () => {
    const dir = tmp(); const {svc} = make(dir); const f = path.join(dir, 'a.txt'); fs.writeFileSync(f, 'x'); fs.mkdirSync(path.join(dir, 'folder'));
    for (let i = 0; i < 11; i++) svc.addText({text: `n${i}`}, 'backpack');
    const items = [{kind: 'file', uri: `file://${f}`}, {kind: 'file', uri: `file://${path.join(dir, 'folder')}`}, {kind: 'file', uri: `file://${dir}/gone.txt`}, {kind: 'text', text: 'second one'}];
    const r = svc.receive(items, 'backpack');
    assert.equal(r.added.length, 1); assert.deepEqual(r.skipped.map(x => x.code), ['not-a-file', 'missing', 'slots-full']);
    assert.equal(svc.receive([{kind: 'file', uri: `file://${f}`}], 'pocket').skipped[0].code, 'duplicate');
    assert.equal(svc.snapshot().backpack.length, 12);
});

test('receive: a failing save rolls everything back; unavailable and shut-down services refuse', () => {
    const dir = tmp(); const {svc} = make(dir); svc.addText({text: 'safe'}, 'backpack');
    svc._store.save = () => { throw new Error('disk full'); };
    const r = svc.receive([{kind: 'text', text: 'lost?'}], 'backpack'); assert.equal(r.skipped[0].code, 'save-failed'); assert.equal(svc.snapshot().backpack.length, 1);
    const d2 = tmp(); fs.writeFileSync(`${d2}/inventory.json`, JSON.stringify({version: 99, items: []})); assert.equal(codeOf(() => make(d2).svc.receive([{kind: 'text', text: 'x'}], 'backpack')), 'unavailable');
    const s3 = make(tmp()).svc; s3.destroy(); assert.equal(codeOf(() => s3.receive([{kind: 'text', text: 'x'}], 'backpack')), 'closed');
});

test('receive: over-long notes are refused whole (never truncated)', () => {
    const {svc} = make(tmp()); const r = svc.receive([{kind: 'text', text: 'x'.repeat(20001)}], 'backpack');
    assert.equal(r.added.length, 0); assert.equal(r.skipped[0].code, 'too-long'); assert.equal(svc.snapshot().backpack.length, 0);
});

for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${e.stack}`); }
}
console.log(`\n${passed}/${tests.length} passed`);
