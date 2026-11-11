// Unit tests for lib/backpack/model.js (pure logic, runs with plain Node: `node tests/model.test.mjs`).
import assert from 'node:assert/strict';
import {
    Inventory, InventoryError, SLOT_COUNT, POCKET_LIMIT, LIMITS, normalizeLink, linkHost,
    formatRemaining, openBlockReason, previewText,
} from '../lib/backpack/model.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof InventoryError && e.code === code, `expected InventoryError ${code}`);
const NOW = 1_700_000_000_000, DAY = 86_400_000;
const file = (n, extra = {}) => ({path: `/home/u/f${n}.txt`, title: `f${n}.txt`, size: 10, contentType: 'text/plain', ...extra});

test('slots fill lowest-first and the 13th item is refused with a clear message', () => {
    const inv = new Inventory();
    for (let i = 0; i < SLOT_COUNT; i++) assert.equal(inv.addFile(file(i), 'backpack', NOW, DAY).slot, i);
    assert.throws(() => inv.addFile(file(99), 'backpack', NOW, DAY), e => e.code === 'slots-full' && /12 of 12/.test(e.message));
    assert.equal(inv.counts().backpack, 12);
});

test('a removed slot is reused', () => {
    const inv = new Inventory();
    const a = inv.addFile(file(1), 'backpack', NOW, DAY); inv.addFile(file(2), 'backpack', NOW, DAY);
    inv.remove(a.id);
    assert.equal(inv.addFile(file(3), 'backpack', NOW, DAY).slot, 0);
});

test('pocket items expire exactly at expiresAt and not before', () => {
    const inv = new Inventory();
    const it = inv.addText({text: 'hello'}, 'pocket', NOW, DAY);
    assert.equal(it.expiresAt, NOW + DAY);
    assert.equal(inv.hasExpired(NOW + DAY - 1), false);
    assert.deepEqual(inv.purgeExpired(NOW + DAY - 1), []);
    assert.equal(inv.hasExpired(NOW + DAY), true);
    assert.equal(inv.purgeExpired(NOW + DAY).length, 1);
    assert.equal(inv.counts().pocket, 0);
});

test('backpack items never expire', () => {
    const inv = new Inventory(); inv.addText({text: 'x'}, 'backpack', NOW, DAY);
    assert.equal(inv.hasExpired(NOW + 1000 * DAY), false);
});

test('keep moves a pocket item to a free slot and stops it expiring; full backpack refuses', () => {
    const inv = new Inventory();
    const p = inv.addLink({url: 'https://example.org'}, 'pocket', NOW, DAY);
    const kept = inv.keep(p.id);
    assert.equal(kept.slot, 0); assert.equal(kept.expiresAt, null);
    throwsCode(() => inv.keep(p.id), 'not-in-pocket');
    for (let i = 1; i < SLOT_COUNT; i++) inv.addFile(file(i), 'backpack', NOW, DAY);
    const q = inv.addFile(file(50), 'pocket', NOW, DAY);
    throwsCode(() => inv.keep(q.id), 'slots-full');
    assert.equal(inv.get(q.id).slot, null);          // unchanged after the failed keep
});

test('pocket limit', () => {
    const inv = new Inventory();
    for (let i = 0; i < POCKET_LIMIT; i++) inv.addFile(file(i), 'pocket', NOW, DAY);
    throwsCode(() => inv.addFile(file(77), 'pocket', NOW, DAY), 'pocket-full');
});

test('failed adds do not consume ids or change state', () => {
    const inv = new Inventory();
    throwsCode(() => inv.addText({text: '   '}, 'backpack', NOW, DAY), 'empty');
    throwsCode(() => inv.addLink({url: 'ftp://x.y'}, 'backpack', NOW, DAY), 'bad-link');
    assert.equal(inv.addText({text: 'a'}, 'backpack', NOW, DAY).id, 1);
    assert.equal(inv.counts().backpack, 1);
});

test('duplicates are rejected for files and links, with the right hint', () => {
    const inv = new Inventory();
    inv.addFile(file(1), 'backpack', NOW, DAY); inv.addLink({url: 'https://a.b/c'}, 'pocket', NOW, DAY);
    throwsCode(() => inv.addFile(file(1), 'pocket', NOW, DAY), 'duplicate');
    assert.throws(() => inv.addLink({url: 'https://a.b/c'}, 'backpack', NOW, DAY), e => /Use Keep/.test(e.message));
    inv.addText({text: 'same'}, 'backpack', NOW, DAY); inv.addText({text: 'same'}, 'backpack', NOW, DAY);   // notes may repeat
});

test('link validation', () => {
    assert.equal(normalizeLink('  https://example.org/a?b=c#d '), 'https://example.org/a?b=c#d');
    for (const bad of ['example.org', 'javascript:alert(1)', 'file:///etc/passwd', 'http://', 'https:///x', 'ftp://a.b', 'https://a b.c', 'https://a.b/\nx'])
        assert.throws(() => normalizeLink(bad), InventoryError, bad);
    assert.throws(() => normalizeLink(`https://a.b/${'x'.repeat(LIMITS.url)}`), e => e.code === 'too-long');
    assert.equal(linkHost('https://user@www.example.org:8080/p'), 'www.example.org');
    assert.equal(linkHost('http://[::1]:3000/'), '[::1]');
});

test('titles: derived, trimmed, limited', () => {
    const inv = new Inventory();
    assert.equal(inv.addLink({url: 'https://www.example.org/x'}, 'backpack', NOW, DAY).title, 'www.example.org');
    assert.equal(inv.addFile({path: '/a/b/report.pdf'}, 'backpack', NOW, DAY).title, 'report.pdf');
    const t = inv.addText({text: `first line\n${'y'.repeat(200)}`}, 'backpack', NOW, DAY).title;
    assert.ok(t.length <= 60 && t.endsWith('…'));
    assert.equal(inv.addText({title: '  My   note ', text: 'z'}, 'backpack', NOW, DAY).title, 'My note');
    throwsCode(() => inv.addText({title: 'x'.repeat(121), text: 'z'}, 'backpack', NOW, DAY), 'too-long');
    throwsCode(() => inv.addText({text: 'x'.repeat(LIMITS.text + 1)}, 'backpack', NOW, DAY), 'too-long');
});

test('search: all terms, case-insensitive, over title/path/url/text/kind', () => {
    const inv = new Inventory();
    inv.addFile({path: '/docs/Tax Return 2025.pdf', title: 'Tax Return 2025.pdf'}, 'backpack', NOW, DAY);
    inv.addText({title: 'Shopping', text: 'milk eggs bread'}, 'pocket', NOW, DAY);
    inv.addLink({url: 'https://news.example.org/tax'}, 'backpack', NOW, DAY);
    const names = r => [...r.backpack, ...r.pocket].map(i => i.title);
    assert.equal(names(inv.search('tax')).length, 2);
    assert.deepEqual(names(inv.search('TAX return')), ['Tax Return 2025.pdf']);
    assert.deepEqual(names(inv.search('eggs')), ['Shopping']);
    assert.deepEqual(names(inv.search('note')), ['Shopping']);
    assert.deepEqual(names(inv.search('link')), ['news.example.org']);
    assert.equal(names(inv.search('')).length, 3);
    assert.equal(names(inv.search('nothing like this')).length, 0);
});

test('JSON round trip keeps everything; ids continue after reload', () => {
    const inv = new Inventory();
    inv.addFile(file(1), 'backpack', NOW, DAY); inv.addText({text: 'n'}, 'pocket', NOW, DAY); inv.addLink({url: 'https://a.b'}, 'backpack', NOW, DAY);
    const {inventory, dropped} = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    assert.equal(dropped, 0);
    assert.deepEqual(inventory.toJSON(), inv.toJSON());
    assert.equal(inventory.addText({text: 'm'}, 'backpack', NOW, DAY).id, 4);
});

test('fromJSON: invalid items are dropped and counted, never trusted', () => {
    const good = {id: 1, kind: 'text', title: 't', createdAt: NOW, slot: 0, expiresAt: null, text: 'x'};
    const data = {version: 1, nextId: 2, items: [
        good,
        {...good, id: 1},                                  // duplicate id
        {...good, id: 2},                                  // duplicate slot
        {...good, id: 3, slot: 99},                        // slot out of range
        {...good, id: 4, slot: 1, expiresAt: NOW},         // slot AND expiry
        {...good, id: 5, slot: null, expiresAt: null},     // pocket without expiry
        {id: 6, kind: 'file', title: 'f', createdAt: NOW, slot: 2, expiresAt: null, path: 'relative/path'},
        {id: 7, kind: 'link', title: 'l', createdAt: NOW, slot: 3, expiresAt: null, url: 'javascript:alert(1)'},
        {id: 8, kind: 'weird', title: 'w', createdAt: NOW, slot: 4, expiresAt: null},
        null, 'x', 5,
    ]};
    const {inventory, dropped} = Inventory.fromJSON(data);
    assert.equal(dropped, 11); assert.equal(inventory.counts().backpack, 1);
    assert.equal(inventory.addText({text: 'n'}, 'backpack', NOW, DAY).id, 2);   // dropped items do not advance nextId: max(declared 2, kept max 1 + 1)
});

test('fromJSON: structural errors and newer versions', () => {
    throwsCode(() => Inventory.fromJSON(null), 'invalid');
    throwsCode(() => Inventory.fromJSON([]), 'invalid');
    throwsCode(() => Inventory.fromJSON({items: []}), 'invalid');
    throwsCode(() => Inventory.fromJSON({version: 1}), 'invalid');
    throwsCode(() => Inventory.fromJSON({version: 2, items: []}), 'newer-version');
});

test('open safety: programs, launchers, scripts and executable binaries are refused', () => {
    for (const p of ['/a/x.desktop', '/a/x.sh', '/a/x.AppImage', '/a/setup.exe', '/a/x.jar', '/a/x.run'])
        assert.ok(openBlockReason({path: p, contentType: 'text/plain', mode: 0o644}), p);
    assert.ok(openBlockReason({path: '/a/prog', contentType: 'application/x-executable', mode: 0o644}));
    assert.ok(openBlockReason({path: '/a/prog', contentType: 'application/x-pie-executable', mode: 0o755}));
    assert.ok(openBlockReason({path: '/a/blob', contentType: 'application/octet-stream', mode: 0o755}));
    assert.ok(openBlockReason({path: '/a/blob', contentType: null, mode: 0o700}));
    for (const [p, t, m] of [['/a/n.txt', 'text/plain', 0o644], ['/a/n.txt', 'text/plain', 0o755], ['/a/p.pdf', 'application/pdf', 0o755],
                             ['/a/i.png', 'image/png', 0o644], ['/a/b.bin2', 'application/octet-stream', 0o644]])
        assert.equal(openBlockReason({path: p, contentType: t, mode: m}), null, `${p} ${t} ${m.toString(8)}`);
});

test('formatting helpers', () => {
    assert.equal(formatRemaining(0), 'expired'); assert.equal(formatRemaining(30_000), 'less than a minute');
    assert.equal(formatRemaining(12 * 60_000), '12 min'); assert.equal(formatRemaining(3 * 3_600_000), '3 h');
    assert.equal(formatRemaining(3 * 3_600_000 + 20 * 60_000), '3 h 20 min');
    assert.equal(previewText('a\n\n b   c', 80), 'a b c'); assert.equal(previewText('x'.repeat(100), 10).length, 10);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
