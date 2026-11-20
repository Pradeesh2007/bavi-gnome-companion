// Source-policy tests (plain Node, no mocks): they scan the shipped JavaScript and fail if a privacy/safety rule of the project is broken.
// They check what the CODE contains. They cannot prove runtime behaviour. Run: node tests/policy.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const shipped = ['extension.js', 'prefs.js', ...walk(path.join(root, 'lib')).map(f => path.relative(root, f))].filter(f => f.endsWith('.js'));
const src = Object.fromEntries(shipped.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');       // ignore comments when looking for API use
const code = Object.fromEntries(Object.entries(src).map(([f, t]) => [f, strip(t)]));
const filesWith = re => Object.keys(code).filter(f => re.test(code[f]));

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };

test('clipboard access exists only in the two explicit, user-triggered places: the Paste reader and the Copy button', () => {
    assert.deepEqual(filesWith(/St\.Clipboard(?![A-Za-z])/).sort(), ['lib/backpack/clipboard.js', 'lib/backpack/dialog.js']);
    assert.equal((code['lib/backpack/dialog.js'].match(/St\.Clipboard(?![A-Za-z])/g) ?? []).length, 1, 'dialog.js: exactly one use (the Copy button, a WRITE)');
    assert.match(code['lib/backpack/dialog.js'], /_copy\(text, message\) \{\s*try \{\s*St\.Clipboard\.get_default\(\)\.set_text\(/);
    assert.ok(!/get_mimetypes|St\.Clipboard[^;]*\.get_(text|content)\(/.test(code['lib/backpack/dialog.js']), 'dialog.js never READS the clipboard itself (St.Entry.get_text reads the note form)');
});

test('the clipboard is READ only through readClipboardPayload(), and that is called from exactly one place: the Paste button handler', () => {
    const callers = filesWith(/readClipboardPayload\(/).filter(f => f !== 'lib/backpack/clipboard.js');
    assert.deepEqual(callers, ['lib/backpack/dialog.js']); assert.equal((code['lib/backpack/dialog.js'].match(/readClipboardPayload\(/g) ?? []).length, 1);
    assert.match(code['lib/backpack/dialog.js'], /async _paste\(\) \{[\s\S]*?await readClipboardPayload\(\)/);
    assert.match(code['lib/backpack/dialog.js'], /label: 'Paste', action: \(\) => this\._paste\(\)/);
});

test('no clipboard monitoring or polling: no owner-changed signal, no timers or signal handlers in the clipboard reader', () => {
    assert.deepEqual(filesWith(/owner-changed|owner_changed/), []);
    for (const re of [/timeout_add|\.repeat\(|\.once\(|\.connect\(|setInterval|setTimeout/]) assert.ok(!re.test(code['lib/backpack/clipboard.js']), 'clipboard.js has no timers or signal handlers');
});

test('the drag payload (Meta.Selection) is touched only by the drop zone', () => {
    assert.deepEqual(filesWith(/get_selection\(|SelectionType|transfer_async/), ['lib/dropzone.js']);
});

test('nothing in the extension talks to the network or runs programs (no sockets, HTTP, subprocesses, spawn, eval)', () => {
    assert.deepEqual(filesWith(/gi:\/\/Soup|SocketClient|SocketConnection|NetworkMonitor|\bfetch\(|XMLHttpRequest|WebSocket/), []);
    assert.deepEqual(filesWith(/Subprocess|spawn_|GLib\.spawn|\.spawn\(|Gio\.Subprocess|\beval\(|new Function\(/), []);
});

test('external URLs are opened only by the preferences window, through Gtk.UriLauncher, and only the two project links', () => {
    assert.deepEqual(filesWith(/UriLauncher/), ['prefs.js']);
    const urls = new Set(Object.values(src).flatMap(t => t.match(/https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}[^\s'"`)]*/g) ?? []).filter(u => !/example\.|www\.gnome|gnome\.org|github\.com\/GNOME|w3\.org/.test(u)));
    assert.deepEqual([...urls].sort(), ['https://buymeacoffee.com/pradeeshkuamr', 'https://github.com/Pradeesh2007/bavi-gnome-companion']);
});

test('synchronous reads are gone: no load_contents( or other blocking file reads in the shipped code (writes are the small atomic save only)', () => {
    assert.deepEqual(filesWith(/\.load_contents\(|\.load_bytes\(|read_all\(|GLib\.file_get_contents|Gio\.File\.new_for_path\([^)]*\)\.read\(/), []);
    assert.ok(/load_contents_async/.test(code['lib/backpack/store.js']) && /load_contents_async/.test(code['lib/character/walkassets.js']));
});

test('production logging goes through lib/log.js: only errorLog (genuine failures) and debugLog (gated) in the backpack service', () => {
    assert.ok(!/console\./.test(code['lib/backpack/service.js']), 'service.js has no direct console calls');
    assert.match(src['lib/log.js'], /if \(DEBUG\)/);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
