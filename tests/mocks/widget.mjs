// Generic stand-in for GTK/libadwaita widgets used by prefs.js (records properties, children, handlers, css classes).
export class W {
    constructor(props = {}) {
        this.children = []; this.suffixes = []; this.handlers = {}; this.css = new Set(props.css_classes ?? []); this.activatableWidget = null; this.toasts = [];
        this._text = props.text ?? ''; this.sensitive = true;
        Object.assign(this, props);
    }
    get text() { return this._text; } set text(v) { this._text = v; }
    add(c) { this.children.push(c); } add_suffix(c) { this.suffixes.push(c); } set_activatable_widget(w) { this.activatableWidget = w; }
    connect(n, f) { (this.handlers[n] ??= []).push(f); return 1; } emit(n, ...a) { for (const f of this.handlers[n] ?? []) f(...a); }
    add_css_class(c) { this.css.add(c); } remove_css_class(c) { this.css.delete(c); }
    set_text(t) { this._text = t; this.emit('changed'); } get_text() { return this._text; }
    set_default_size() {} set_size_request() {} set_halign() {}
    add_toast(t) { this.toasts.push(t); }
    * walk() { yield this; for (const c of [...this.children, ...this.suffixes]) yield* c.walk(); }
}
