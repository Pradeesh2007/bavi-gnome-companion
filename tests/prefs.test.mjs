// MOCKED tests of prefs.js (GTK, libadwaita, Gdk and the extension base class are stand-ins in tests/mocks).
// They verify our logic: placeholder wording, Set/Clear/validation, neutral wording, exact link targets.
// They do NOT prove how the real preferences window looks or behaves. Run: node --import ./tests/mocks/register.mjs tests/prefs.test.mjs
import assert from 'node:assert/strict';
import Prefs from '../prefs.js';
import Adw from './mocks/adw.mjs';
import Gtk, {launches} from './mocks/gtk.mjs';
import {clip} from './mocks/gdk.mjs';
import {W} from './mocks/widget.mjs';

class FakeSettings {
    constructor(v = {}) { this.v = {'character-name': '', 'hidden': false, 'paused': false, 'quiet-mode': false, 'focus-mode': false, 'roaming': true, 'pointer-look': true, 'character-height': 240, 'home-corner': 'bottom-left',
        'pocket-expiry-hours': 24, 'summon-shortcut': ['<Super><Alt>b'], 'backpack-shortcut': ['<Super><Alt>i'], ...v}; this.h = {}; this.writes = []; }
    get_string(k) { return this.v[k]; } set_string(k, x) { this.v[k] = x; this.writes.push([k, x]); this.emit(`changed::${k}`); }
    get_boolean(k) { return this.v[k]; } get_int(k) { return this.v[k]; } get_strv(k) { return this.v[k]; } set_strv(k, x) { this.v[k] = x; }
    bind() {} connect(n, f) { (this.h[n] ??= []).push(f); return 1; } emit(n) { for (const f of this.h[n] ?? []) f(); }
}
function open(values) {
    globalThis.__settings = new FakeSettings(values); launches.length = 0; clip.copied = null;
    const window = new W(); const prefs = new Prefs(); prefs.fillPreferencesWindow(window);
    const page = window.children[0]; const all = [...window.walk()];
    const byClass = (C, pred) => all.filter(x => x instanceof C && (!pred || pred(x)));
    return {window, page, settings: globalThis.__settings, all,
        entry: byClass(Gtk.Entry)[0], button: label => byClass(Gtk.Button, b => b.label === label)[0], row: title => byClass(Adw.ActionRow, r => r.title === title)[0],
        switchRow: title => byClass(Adw.SwitchRow, r => r.title === title)[0]};
}
let passed = 0; const tests = []; const test = (n, f) => tests.push([n, f]);

test('fresh settings: no name is assigned or shown; the placeholder is exactly "Enter Name (Eg. Bavi)"; the entry starts empty', () => {
    const p = open(); assert.equal(p.settings.get_string('character-name'), '');
    assert.equal(p.entry.placeholder_text, 'Enter Name (Eg. Bavi)'); assert.equal(p.entry.get_text(), ''); assert.equal(p.entry.max_length, 32);
    assert.equal(p.row('Current name').subtitle, 'No name set'); assert.equal(p.page.title, 'Companion'); assert.equal(p.button('Clear').sensitive, false);
    assert.equal(p.settings.writes.length, 0, 'opening the window writes nothing');
    const text = p.all.flatMap(x => [x.title, x.subtitle, x.description, x.label]).filter(Boolean).join('|'); assert.ok(!/Bavi/.test(text), 'no fabricated name in any label');
});

test('Set Name trims, saves, shows the name, enables Clear, empties the entry and updates the wording', () => {
    const p = open(); p.entry.set_text('  Mika  '); p.button('Set Name').emit('clicked');
    assert.deepEqual(p.settings.writes, [['character-name', 'Mika']]); assert.equal(p.row('Current name').subtitle, 'Mika'); assert.equal(p.page.title, 'Mika');
    assert.equal(p.entry.get_text(), ''); assert.equal(p.button('Clear').sensitive, true); assert.equal(p.switchRow('Hide').subtitle, 'Hide Mika and stop all activity.');
    assert.equal(p.entry.placeholder_text, 'Enter Name (Eg. Bavi)', 'the placeholder is still there when the entry is empty');
});

test('Enter in the entry sets the name', () => {
    const p = open(); p.entry.set_text('Rin'); p.entry.emit('activate'); assert.equal(p.settings.get_string('character-name'), 'Rin');
});

test('empty, over-long and unsafe names are rejected with a message and nothing is saved; typing clears the error', () => {
    const p = open();
    for (const [text, re] of [['   ', /type a name/], ['x'.repeat(40), /at most 32/], ['a\u202eb', /not allowed/], ['a\u0000b', /not allowed/]]) {
        p.entry.set_text(text); p.button('Set Name').emit('clicked');
        assert.match(p.row('Name').subtitle, re, JSON.stringify(text)); assert.ok(p.entry.css.has('error'));
        p.entry.set_text('ok'); assert.equal(p.row('Name').subtitle, ''); assert.ok(!p.entry.css.has('error'));
    }
    assert.equal(p.settings.writes.length, 0);
});

test('change the name, then clear it: the character returns to unnamed wording', () => {
    const p = open({'character-name': 'Mika'}); assert.equal(p.row('Current name').subtitle, 'Mika'); assert.equal(p.button('Clear').sensitive, true);
    p.entry.set_text('Rin'); p.button('Set Name').emit('clicked'); assert.equal(p.settings.get_string('character-name'), 'Rin');
    p.button('Clear').emit('clicked'); assert.equal(p.settings.get_string('character-name'), ''); assert.equal(p.row('Current name').subtitle, 'No name set');
    assert.equal(p.button('Clear').sensitive, false); assert.equal(p.switchRow('Hide').subtitle, 'Hide the character and stop all activity.'); assert.equal(p.page.title, 'Companion');
});

test('a name stored with an invalid value (edited outside the window) is treated as unnamed', () => {
    const p = open({'character-name': 'x\u202ey'}); assert.equal(p.row('Current name').subtitle, 'No name set'); assert.equal(p.page.title, 'Companion');
});

test('names are shown as plain text (markup is disabled on the rows that display them)', () => {
    const p = open({'character-name': '<b>&Mika</b>'}); // a stored value this odd is rejected by validation (still plain text if it were not)
    assert.equal(p.row('Current name').use_markup, false); assert.equal(p.row('Name').use_markup, false);
    const q = open(); q.entry.set_text('<b>Mika</b>'); q.button('Set Name').emit('clicked'); assert.equal(q.row('Current name').subtitle, '<b>Mika</b>'); assert.equal(q.row('Current name').use_markup, false);
});

test('support links: exact URLs, coffee button is the prominent one, opened through Gtk.UriLauncher', () => {
    const p = open(); const coffee = p.button('Buy Me a Coffee'), gh = p.button('View on GitHub');
    assert.ok(coffee.css.has('suggested-action')); assert.ok(!gh.css.has('suggested-action')); assert.match(p.row('\u2615 Buy me a coffee').title, /^\u2615/);
    coffee.emit('clicked'); gh.emit('clicked');
    assert.deepEqual(launches.map(l => l.uri), ['https://buymeacoffee.com/pradeeshkuamr', 'https://github.com/Pradeesh2007/bavi-gnome-companion']);
    assert.equal(coffee.tooltip_text, 'https://buymeacoffee.com/pradeeshkuamr');
    assert.equal(p.row('Source code on GitHub').activatableWidget, gh);
});

test('copy buttons copy the exact URLs; a launcher failure shows a toast, a dismissed dialog does not', () => {
    const p = open(); const copies = p.all.filter(x => x instanceof Gtk.Button && x.icon_name === 'edit-copy-symbolic');
    copies[0].emit('clicked'); assert.equal(clip.copied, 'https://buymeacoffee.com/pradeeshkuamr'); copies[1].emit('clicked'); assert.equal(clip.copied, 'https://github.com/Pradeesh2007/bavi-gnome-companion');
    p.button('Buy Me a Coffee').emit('clicked'); launches.at(-1).cb({fail: Object.assign(new Error('no handler'), {matches: () => false})});
    assert.match(p.window.toasts.at(-1).title, /Could not open the link/);
    const n = p.window.toasts.length; p.button('View on GitHub').emit('clicked'); launches.at(-1).cb({fail: Object.assign(new Error('dismissed'), {matches: () => true})}); assert.equal(p.window.toasts.length, n);
});

test('no advertisements or prompts: nothing is opened or written just by opening the window', () => {
    const p = open(); assert.equal(launches.length, 0); assert.equal(p.settings.writes.length, 0); assert.equal(p.window.toasts.length, 0);
});

for (const [name, fn] of tests) {
    let error = null; try { fn(); } catch (e) { error = e; }
    if (error) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; console.log(`ok   ${name}`); }
}
console.log(`\n${passed}/${tests.length} passed (MOCKED GTK/libadwaita/Gdk; real prefs.js, name.js, links.js)`);
