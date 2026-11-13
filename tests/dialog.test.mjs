// MOCKED tests of lib/backpack/dialog.js (+ the real service, model and store logic on Gio/GLib stand-ins).
// The St, Clutter, Pango and ModalDialog stand-ins in tests/mocks are STRICT: an unknown constructor property throws
// "No property <x> on <Class>" like GObject does, which is how the reported "No property vertical on StBoxLayout" failure
// is reproduced. They prove the dialog code builds and behaves; they do NOT prove how the real Shell renders it.
// Run: node --import ./tests/mocks/register.mjs tests/dialog.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import St, {state as stState} from './mocks/st.mjs';
import Clutter from './mocks/clutter.mjs';
import {ModalDialog, instances} from './mocks/modaldialog.mjs';
import {BackpackService} from '../lib/backpack/service.js';
import {BackpackUI} from '../lib/backpack/dialog.js';

const errors = [];
const realError = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); };
const realLog = console.log;

class FakeDisposer { repeat() { return 1; } once() { return 1; } cancel() {} }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bavi-ui-'));
function make({hours = 24} = {}) {
    errors.length = 0; instances.length = 0;
    const service = new BackpackService({disposer: new FakeDisposer(), dataDir: tmp(), getExpiryHours: () => hours, createLaunchContext: () => null, onChanged: () => ui.refresh()});
    service.start();
    const ui = new BackpackUI({service, environment: {currentTime: () => 0}, getExpiryHours: () => hours});
    return {service, ui, dialog: () => instances.at(-1)};
}
const all = d => [...d.contentLayout.walk()];
const buttons = d => all(d).filter(x => x._class === 'StButton');
const labels = d => all(d).filter(x => x._class === 'StLabel').map(x => x.clutter_text.text);
const entries = d => all(d).filter(x => x._class === 'StEntry');          // [0] is always the search box
const formEntries = d => entries(d).slice(1);                               // [title, text-or-link] of an open form
const tick = () => new Promise(r => setImmediate(r));                      // lets async button handlers (_run) finish
const click = (d, label) => { const b = buttons(d).find(x => x.label === label); assert.ok(b, `no row button "${label}"; have: ${buttons(d).map(x => x.label).join(', ')}`); b.emit('clicked'); };
const footer = d => d.buttons.map(b => b.label);
const status = d => { const s = all(d).find(x => x._class === 'StLabel' && /bavi-status/.test(x.style_class ?? '')); return s?.visible ? s.clutter_text.text : null; };
const noErrors = () => assert.deepEqual(errors, []);

let passed = 0; const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the strict stand-in reproduces the reported failure, and orientation is the accepted form', () => {
    assert.throws(() => new St.BoxLayout({vertical: true}), /No property vertical on StBoxLayout/);
    assert.doesNotThrow(() => new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'x'}));
    assert.throws(() => new St.Label({nonsense: 1}), /No property nonsense on StLabel/);
});

test('opening the backpack builds the dialog without any error (the reported failure)', () => {
    const t = make(); t.ui.open();
    noErrors(); const d = t.dialog();
    assert.equal(instances.length, 1); assert.equal(d.state, 0 /* OPENED */); assert.deepEqual(d.openArgs, []);
    assert.equal(d.styleClass, 'bavi-dialog'); assert.equal(d.initialFocus, entries(d)[0].clutter_text);
    assert.ok(labels(d).includes('Bavi\u2019s backpack'));
    assert.deepEqual(footer(d), ['Add file\u2026', 'Add note', 'Add link', 'Adding to: Backpack', 'Close']);
    const text = labels(d);
    assert.ok(text.includes('Backpack \u2014 0 of 12 slots') && text.includes('Pocket \u2014 0 of 12 \u00b7 items disappear after 24 h'));
});

test('close and reopen works repeatedly (Close button, then Escape)', () => {
    const t = make();
    for (let round = 0; round < 3; round++) {
        t.ui.open(); noErrors(); const d = t.dialog(); assert.equal(d.destroyed, false);
        if (round % 2 === 0) d.press('Close'); else assert.ok(d.pressKey(Clutter.KEY_Escape));
        assert.equal(d.destroyed, true, `round ${round} closed and destroyed`);
    }
    assert.equal(instances.length, 3); noErrors();
});

test('opening while already open just refreshes (no second dialog)', () => {
    const t = make(); t.ui.open(); t.ui.open(); assert.equal(instances.length, 1); noErrors();
});

test('add note: empty note shows the error and keeps the form; a real note is saved and listed', () => {
    const t = make(); t.ui.open(); const d = t.dialog();
    d.press('Add note'); assert.deepEqual(footer(d), ['Cancel', 'Save to backpack']);
    const [title, body] = formEntries(d); assert.equal(body.clutter_text.single_line_mode, false); assert.equal(body.clutter_text.line_wrap, true); assert.equal(body.clutter_text.activatable, false);
    d.press('Save to backpack'); assert.equal(status(d), 'The note is empty.'); assert.deepEqual(footer(d), ['Cancel', 'Save to backpack']);
    title.set_text('Shopping'); body.set_text('milk\neggs'); d.press('Save to backpack');
    assert.deepEqual(footer(d), ['Add file\u2026', 'Add note', 'Add link', 'Adding to: Backpack', 'Close']);
    assert.equal(status(d), 'Note saved to the backpack.'); assert.ok(labels(d).some(l => l.startsWith('Note') && l.includes('Shopping')));
    assert.equal(t.service.snapshot().backpack[0].text, 'milk\neggs'); noErrors();
});

test('add link: bad links give a clear error; a valid link saves (button and Enter)', () => {
    const t = make(); t.ui.open(); const d = t.dialog(); d.press('Add link');
    const [, url] = formEntries(d);
    for (const bad of ['example.org', 'ftp://x.y', 'javascript:alert(1)']) { url.set_text(bad); d.press('Save to backpack'); assert.match(status(d), /http/, bad); }
    url.set_text('https://example.org/a'); d.press('Save to backpack'); assert.equal(t.service.snapshot().backpack.length, 1);
    d.press('Add link'); formEntries(d)[1].set_text('https://example.net'); formEntries(d)[1].clutter_text.emit('activate');
    assert.equal(t.service.snapshot().backpack.length, 2); noErrors();
});

test('destination toggle sends new items to the pocket, which shows when they expire', () => {
    const t = make(); t.ui.open(); const d = t.dialog();
    d.press('Adding to: Backpack'); assert.ok(footer(d).includes('Adding to: Pocket (24 h)'));
    d.press('Add note'); formEntries(d)[1].set_text('temporary'); d.press('Save to pocket');
    assert.equal(t.service.snapshot().pocket.length, 1); assert.ok(labels(d).some(l => /expires in (24 h|23 h 59 min)/.test(l))); noErrors();
});

test('row buttons per kind; Keep moves a pocket item; links and files are removed at once, notes need a second click', async () => {
    const t = make(); const f = path.join(tmp(), 'a.txt'); fs.writeFileSync(f, 'x');
    t.service._mutate(inv => inv.addFile({path: f}, 'backpack', Date.now(), 1000));
    t.service.addLink({url: 'https://example.org'}, 'backpack'); t.service.addText({title: 'N', text: 'body'}, 'backpack'); t.service.addText({title: 'P', text: 'pocket note'}, 'pocket');
    t.ui.open(); const d = t.dialog();
    assert.deepEqual(buttons(d).map(b => b.label), ['Open', 'Reveal', 'Remove', 'Open', 'Copy', 'Remove', 'View', 'Copy', 'Remove', 'View', 'Copy', 'Keep', 'Remove']);
    click(d, 'Keep'); await tick(); assert.equal(t.service.snapshot().pocket.length, 0); assert.equal(t.service.snapshot().backpack.length, 4);
    assert.match(status(d), /Moved to the backpack/);
    const removes = () => buttons(d).filter(b => /Remove/.test(b.label));
    removes()[0].emit('clicked'); await tick(); assert.equal(t.service.snapshot().backpack.length, 3); assert.match(status(d), /file itself was not touched/); assert.ok(fs.existsSync(f));
    removes()[0].emit('clicked'); await tick(); assert.equal(t.service.snapshot().backpack.length, 2);       // the link
    removes()[0].emit('clicked'); await tick(); assert.equal(t.service.snapshot().backpack.length, 2);       // note: first click only asks
    assert.ok(buttons(d).some(b => b.label === 'Really remove?'));
    click(d, 'Really remove?'); await tick(); assert.equal(t.service.snapshot().backpack.length, 1); noErrors();
});

test('search filters both sections live and shows "No matches."', () => {
    const t = make(); t.service.addText({title: 'Shopping', text: 'milk'}, 'backpack'); t.service.addLink({url: 'https://example.org'}, 'pocket'); t.service.addText({title: 'Other', text: 'zzz'}, 'backpack');
    t.ui.open(); const d = t.dialog(); const search = entries(d)[0];
    search.set_text('milk'); assert.ok(labels(d).some(l => l.includes('Shopping'))); assert.ok(!labels(d).some(l => l.includes('Other')));
    search.set_text('nothing like this'); assert.equal(labels(d).filter(l => l === 'No matches.').length, 2);
    search.set_text(''); assert.ok(labels(d).some(l => l.includes('Other'))); noErrors();
});

test('view a note, Copy it, go back with Back and with Escape', () => {
    const t = make(); t.service.addText({title: 'Idea', text: 'line one\nline two'}, 'backpack'); t.ui.open(); const d = t.dialog();
    click(d, 'View'); assert.deepEqual(footer(d), ['Copy', 'Back']); assert.ok(labels(d).includes('line one\nline two'));
    d.press('Copy'); assert.equal(stState.clipboard.text, 'line one\nline two');
    d.press('Back'); assert.ok(footer(d).includes('Close')); click(d, 'View'); assert.ok(d.pressKey(Clutter.KEY_Escape)); assert.ok(footer(d).includes('Close'));
    click(d, 'Copy'); noErrors();
});

test('Add file: the dialog is closed while the portal chooser is open (modal grab released), then reopens with the result', async () => {
    const t = make(); t.ui.open(); const first = t.dialog(); let closedDuringImport = null;
    t.service.importFiles = async dest => { closedDuringImport = first.destroyed; assert.equal(dest, 'backpack'); return {cancelled: false, added: [{id: 1}], skipped: [{name: 'x.sh', reason: 'nope'}]}; };
    first.press('Add file\u2026'); await new Promise(r => setImmediate(r));
    assert.equal(closedDuringImport, true); assert.equal(instances.length, 2);
    assert.match(status(t.dialog()), /Added 1 file to the backpack\.\nSkipped x\.sh: nope/);
    t.service.importFiles = async () => ({cancelled: true, added: [], skipped: []});
    t.dialog().press('Add file\u2026'); await new Promise(r => setImmediate(r)); assert.equal(instances.length, 3); assert.equal(status(t.dialog()), null);
    delete t.service.importFiles;                                   // back to the real service; only the portal itself fails
    t.service._portal.chooseFiles = async () => { throw new Error('The file chooser portal (xdg-desktop-portal) is not available.'); };
    t.dialog().press('Add file\u2026'); await new Promise(r => setImmediate(r)); assert.match(status(t.dialog()), /not available/); noErrors();
});

test('a message from an earlier session is not shown when the backpack is opened again', () => {
    const t = make(); t.ui.open(); t.dialog().press('Add note'); formEntries(t.dialog())[1].set_text('x'); t.dialog().press('Save to backpack');
    assert.equal(status(t.dialog()), 'Note saved to the backpack.'); t.dialog().press('Close');
    t.ui.open(); assert.equal(status(t.dialog()), null); noErrors();
});

test('a dialog that cannot take the Shell grab is cleaned up without throwing, and a later open works', () => {
    const t = make(); const real = ModalDialog.prototype.open; ModalDialog.prototype.open = () => false;
    const logs = []; console.log = (...a) => logs.push(a.join(' '));
    try { t.ui.open(); } finally { ModalDialog.prototype.open = real; console.log = realLog; }
    assert.ok(logs.some(l => /could not take the Shell grab/.test(l))); assert.equal(instances.at(-1).destroyed, true); noErrors();
    t.ui.open(); assert.equal(t.dialog().destroyed, false);
});

test('destroy() while open closes and destroys the dialog; open() afterwards does nothing', () => {
    const t = make(); t.ui.open(); const d = t.dialog(); t.ui.destroy();
    assert.equal(d.destroyed, true); t.ui.open(); assert.equal(instances.length, 1); noErrors();
});

test('an error inside the dialog build is caught and logged, not thrown into the Shell', () => {
    const t = make(); const real = t.service.snapshot; t.service.snapshot = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => t.ui.open()); assert.ok(errors.some(e => /could not open the backpack/.test(e)) && errors.some(e => /boom/.test(e)));
    t.service.snapshot = real; errors.length = 0; t.ui.open(); assert.equal(t.dialog().destroyed, false); noErrors();
});

for (const [name, fn] of tests) {
    let error = null;
    try { await fn(); } catch (e) { error = e; }
    console.log = realLog;
    if (error) { process.exitCode = 1; realLog(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; realLog(`ok   ${name}`); }
}
console.error = realError;
realLog(`\n${passed}/${tests.length} passed (MOCKED St/Clutter/Pango/ModalDialog/Gio; real dialog.js, service.js, model.js)`);
