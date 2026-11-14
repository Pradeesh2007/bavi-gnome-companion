// STRICT stand-ins for the St widgets used by lib/backpack/dialog.js. A constructor property that the real class does
// not have throws "No property <x> on <Class>", exactly like GObject in GJS; that is how the reported
// "No property vertical on StBoxLayout" failure is reproduced. The property lists were taken from the St sources
// (st-box-layout.c: only `orientation`; st-scroll-view.c; st-button.c; st-entry.c; st-label.c) plus Clutter.Actor/St.Widget.
const ACTOR = ['x_expand', 'y_expand', 'x_align', 'y_align', 'visible', 'opacity', 'name', 'reactive', 'clip_to_allocation'];
const WIDGET = [...ACTOR, 'style_class', 'style', 'can_focus', 'track_hover', 'hover'];
const PROPS = {
    Widget: WIDGET,
    BoxLayout: [...WIDGET, 'orientation'],              // NOTE: no 'vertical'
    Label: [...WIDGET, 'text'],
    Entry: [...WIDGET, 'text', 'hint_text'],
    Button: [...WIDGET, 'label', 'button_mask', 'checked', 'toggle_mode'],
    ScrollView: [...WIDGET, 'overlay_scrollbars', 'hscrollbar_policy', 'vscrollbar_policy'],
};

class ClutterText {
    constructor() { this.text = ''; this.line_wrap = false; this.ellipsize = 0; this.single_line_mode = true; this.handlers = {}; this.focused = false; this.activatable = true; }
    connect(name, fn) { (this.handlers[name] ??= []).push(fn); return 1; }
    emit(name) { for (const fn of this.handlers[name] ?? []) fn(); }
    get_text() { return this.text; }
    set_text(t) { this.text = t; this.emit('text-changed'); }
    set_activatable(v) { this.activatable = v; }
    set_line_wrap(v) { this.line_wrap = v; } set_ellipsize(v) { this.ellipsize = v; } set_single_line_mode(v) { this.single_line_mode = v; }   // C-API setters exist on Clutter.Text too
    grab_key_focus() { this.focused = true; }
    connectObject() {} disconnectObject() {}
}

class Actor {
    constructor(className, params = {}) {
        this._class = `St${className}`; this.children = []; this.handlers = {}; this.parent = null; this.destroyed = false; this.visible = true;
        for (const [key, value] of Object.entries(params)) {
            if (!PROPS[className].includes(key))
                throw new Error(`No property ${key} on ${this._class}`);
            this[key] = value;
        }
    }
    add_child(c) { if (c.destroyed) throw new Error('adding a destroyed actor'); c.parent = this; this.children.push(c); }
    set_child(c) { this.add_child(c); }
    destroy_all_children() { for (const c of this.children) c.destroy(); this.children = []; }
    destroy() { if (this.destroyed) return; this.destroyed = true; for (const c of this.children) c.destroy(); this.children = []; this.emit('destroy'); }
    connect(name, fn) { (this.handlers[name] ??= []).push(fn); return 1; }
    emit(name, ...a) { for (const fn of this.handlers[name] ?? []) fn(...a); }
    show() { this.visible = true; } hide() { this.visible = false; }
    * walk() { yield this; for (const c of this.children) yield* c.walk(); }
}

class Widget extends Actor { constructor(p) { super('Widget', p); } }
class BoxLayout extends Actor { constructor(p) { super('BoxLayout', p); } }
class ScrollView extends Actor { constructor(p) { super('ScrollView', p); } }
class Label extends Actor {
    constructor(p) { super('Label', p); }
    get clutter_text() { return (this._ct ??= new ClutterText()); }
    get text() { return this.clutter_text.text; }
    set text(v) { this.clutter_text.text = v; }
    get_text() { return this.text; }
}
class Entry extends Actor {
    constructor(p) { super('Entry', p); }
    get clutter_text() { return (this._ct ??= new ClutterText()); }
    get text() { return this.clutter_text.text; }
    set text(v) { this.clutter_text.text = v; }
    get_text() { return this.clutter_text.get_text(); } set_text(t) { this.clutter_text.set_text(t); }
}
class Button extends Actor { constructor(p) { super('Button', p); } }

// St.Clipboard stand-in with the 51.1 API shape: get_mimetypes(type), get_content(type, mimetype, cb(clipboard, bytes)),
// get_text(type, cb(clipboard, text)), set_text(type, text). Callbacks run asynchronously like the real ones.
const clipboard = {
    text: null, mimetypes: [], content: {}, plain: null, reads: 0,
    set_text(type, text) { this.text = text; this.type = type; },
    get_mimetypes() { this.reads++; return [...this.mimetypes]; },
    get_content(type, mime, cb) { this.reads++; const data = this.content[mime]; setImmediate(() => cb(this, data === undefined ? null : {get_data: () => new TextEncoder().encode(data)})); },
    get_text(type, cb) { this.reads++; setImmediate(() => cb(this, this.plain)); },
    reset() { this.mimetypes = []; this.content = {}; this.plain = null; this.reads = 0; },
};
export const state = {clipboard};
export default {
    Widget, BoxLayout, ScrollView, Label, Entry, Button,
    PolicyType: {ALWAYS: 0, AUTOMATIC: 1, NEVER: 2, EXTERNAL: 3},
    ClipboardType: {PRIMARY: 0, CLIPBOARD: 1},
    Clipboard: {get_default: () => clipboard},
};
