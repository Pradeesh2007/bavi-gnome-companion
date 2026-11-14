// Real tests (plain Node) for lib/backpack/intake.js. Run: node tests/intake.test.mjs
import assert from 'node:assert/strict';
import {classifyPayload, parseUriList, parseCopiedFiles, MAX_ITEMS, MAX_INPUT_CHARS} from '../lib/backpack/intake.js';
import {LIMITS} from '../lib/backpack/model.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };

test('uri-list: file URIs become file items; comments and blank lines are ignored', () => {
    const r = classifyPayload({uriList: '# copied\r\nfile:///home/u/a%20b.txt\r\n\r\nfile:///home/u/c.pdf\r\n'});
    assert.deepEqual(r.items, [{kind: 'file', uri: 'file:///home/u/a%20b.txt'}, {kind: 'file', uri: 'file:///home/u/c.pdf'}]); assert.deepEqual(r.rejected, []);
});

test('uri-list: http(s) addresses become links; other schemes are rejected with a reason', () => {
    const r = classifyPayload({uriList: 'https://example.org/x\nhttp://a.b\njavascript:alert(1)\ndata:text/html,hi\nftp://x.y/f\nsmb://host/share\nnot a uri'});
    assert.deepEqual(r.items.map(i => i.kind), ['link', 'link']);
    assert.equal(r.rejected.length, 5); assert.match(r.rejected[0].reason, /"javascript:"/); assert.match(r.rejected[4].reason, /Not a file or link/);
});

test('text: a single http(s) address is a link, anything else is a note (trimmed)', () => {
    assert.deepEqual(classifyPayload({text: '  https://example.org/path?q=1#x \n'}).items, [{kind: 'link', url: 'https://example.org/path?q=1#x'}]);
    assert.deepEqual(classifyPayload({text: ' remember the milk\nand eggs '}).items, [{kind: 'text', text: 'remember the milk\nand eggs'}]);
    assert.deepEqual(classifyPayload({text: 'see https://example.org for details'}).items.map(i => i.kind), ['text']);
    assert.deepEqual(classifyPayload({text: 'https://'}).items.map(i => i.kind), ['text']);            // not a valid link: kept as text, not dropped
    assert.deepEqual(classifyPayload({text: 'javascript:alert(1)'}).items.map(i => i.kind), ['text']); // plain text, never a link, never run
});

test('empty and whitespace-only input yields nothing (and no error)', () => {
    for (const p of [{}, {text: ''}, {text: ' \n\t'}, {uriList: ''}, {uriList: '# only a comment'}, {uriList: null, text: null}]) {
        const r = classifyPayload(p); assert.deepEqual(r.items, [], JSON.stringify(p)); }
});

test('uri-list wins over text when both are present; text is the fallback when the list has nothing usable', () => {
    assert.equal(classifyPayload({uriList: 'file:///a', text: 'a'}).items[0].kind, 'file');
    assert.equal(classifyPayload({uriList: '# nothing', text: 'hello'}).items[0].kind, 'text');
});

test('binary-looking text, oversized input and over-long notes are rejected, not truncated', () => {
    assert.match(classifyPayload({text: 'a\u0000b'}).rejected[0].reason, /binary/);
    assert.match(classifyPayload({text: 'x'.repeat(MAX_INPUT_CHARS + 1)}).rejected[0].reason, /too large/);
    const r = classifyPayload({text: 'x'.repeat(LIMITS.text + 1)}); assert.deepEqual(r.items, []); assert.match(r.rejected[0].reason, /too long/);
    assert.equal(classifyPayload({text: 'x'.repeat(LIMITS.text)}).items.length, 1);
});

test('at most MAX_ITEMS items are considered', () => {
    const list = Array.from({length: MAX_ITEMS + 5}, (_, i) => `file:///f${i}`).join('\n');
    const r = classifyPayload({uriList: list}); assert.equal(r.items.length, MAX_ITEMS); assert.equal(r.rejected.length, 5);
});

test('gnome-copied-files: the copy/cut line is ignored (files are only referenced, never moved)', () => {
    assert.deepEqual(parseCopiedFiles('cut\nfile:///a\nfile:///b\n'), ['file:///a', 'file:///b']);
    assert.deepEqual(parseCopiedFiles('copy\r\nfile:///a'), ['file:///a']);
    assert.deepEqual(parseUriList('x\n#c\n\n y '), ['x', 'y']);
});

test('nothing in the classifier executes or fetches anything (it returns data only)', () => {
    const r = classifyPayload({uriList: 'file:///home/u/run.sh\nhttps://example.org/'});
    assert.ok(r.items.every(i => typeof i === 'object' && !('run' in i)));
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
