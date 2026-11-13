// Stand-in for resource:///org/gnome/shell/ui/modalDialog.js, matching what the current Shell source defines:
// constructor params (shellReactive, styleClass, actionMode, shouldFadeIn, shouldFadeOut, destroyOnClose), contentLayout
// (an St.BoxLayout with VERTICAL orientation), setButtons([{label, action, key, default}]), setInitialKeyFocus(actor),
// open() with NO arguments returning a boolean, close(), destroy(), 'destroy'/'closed' signals.
// Simplification: the real dialog destroys itself after its fade-out; here destruction is immediate on close.
import St from './st.mjs';
import Clutter from './clutter.mjs';

export const State = {OPENED: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, FADED_OUT: 4};
const ALLOWED = ['shellReactive', 'styleClass', 'actionMode', 'shouldFadeIn', 'shouldFadeOut', 'destroyOnClose'];
export const instances = [];

export class ModalDialog {
    constructor(params = {}) {
        for (const k of Object.keys(params))
            if (!ALLOWED.includes(k)) throw new Error(`Unknown ModalDialog parameter ${k}`);
        this._destroyOnClose = params.destroyOnClose ?? true;
        this.contentLayout = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this.state = State.CLOSED; this.buttons = []; this.handlers = {}; this.destroyed = false; this.openArgs = null; this.initialFocus = null;
        this.styleClass = params.styleClass; instances.push(this);
    }
    connect(name, fn) { (this.handlers[name] ??= []).push(fn); return 1; }
    emit(name) { for (const fn of this.handlers[name] ?? []) fn(); }
    setButtons(buttons) { for (const b of buttons) if (typeof b.label !== 'string' || typeof b.action !== 'function') throw new Error('bad button'); this.buttons = buttons; }
    setInitialKeyFocus(actor) { if (!actor) throw new Error('no actor'); this.initialFocus = actor; }
    open(...args) { this.openArgs = args; if (this.state === State.OPENED) return true; this.state = State.OPENED; return true; }
    close() { if (this.state === State.CLOSED || this.state === State.CLOSING) return; this.state = State.CLOSED; this.emit('closed'); if (this._destroyOnClose) this.destroy(); }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.contentLayout.destroy(); this.emit('destroy'); }
    press(label) { const b = this.buttons.find(x => x.label === label); if (!b) throw new Error(`no dialog button "${label}" (have: ${this.buttons.map(x => x.label).join(', ')})`); b.action(); }
    pressKey(key) { const b = this.buttons.find(x => x.key === key); if (b) b.action(); return !!b; }
}
