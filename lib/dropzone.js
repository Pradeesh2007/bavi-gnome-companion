// lib/dropzone.js
//
// Lets the user drag a file, text or a web link from another application onto the character and release it to store it in the
// backpack. EXPERIMENTAL and not verified on a real GNOME Shell: read docs/drag-and-drop-investigation.md first.
//
// GNOME Shell 51.1 / mutter 51.1 cannot deliver a real drop to a Shell actor, so this assembles the interaction from the pieces
// that do exist (all read from the 51.1 sources, none of it run on a real session by the author):
//   hover     the Shell's XdndHandler calls `actor._delegate.handleDragOver(source, ...)` on the actor under the pointer for drags
//             from other applications; actor.setDragTarget() installs that hook on the character.
//   data      `global.display.get_selection()` is a Meta.Selection; while a drag is in progress its SELECTION_DND holds the source's
//             offers. It is read ONCE per drag, while the pointer hovers the character, with a byte cap, only for text/uri-list or
//             plain text, and only into memory (never executed, never written).
//   drop      a release over the compositor cancels the drag and unsets the data, and an Escape ends it the same way, so the drop is
//             INFERRED by lib/dropdetect.js (pointer over her + primary button released). The source application will show the
//             drag as cancelled; the item is stored anyway. Storage goes through the same intake/service as Paste and the chooser.
// Nothing here polls or monitors the clipboard: it only reacts to drags the user is performing.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {classifyPayload} from './backpack/intake.js';
import {summariseReceive} from './backpack/summary.js';
import {InventoryError} from './backpack/model.js';
import {DropTracker} from './dropdetect.js';
import {debugLog, errorLog} from './log.js';

export const MAX_PAYLOAD_BYTES = 256 * 1024;      // a 24-entry file list or a 20 000-character note is far below this
const URI_LIST = 'text/uri-list';
const TEXT_TYPES = ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING', 'STRING'];
const LEAVE_CHECK_MS = 100;

export const MESSAGES = Object.freeze({
    notReady: 'Hold it over me for a moment before letting go. (Paste in the backpack always works.)',
    unsupported: 'I can only keep files, text and web links.',
    unreadable: 'I could not read what you dragged. Try Paste in the backpack instead.',
});

export class DropZone {
    /**
     * @param {object} p
     * @param {import('./character/actor.js').CharacterActor} p.actor
     * @param {import('./backpack/service.js').BackpackService} p.service
     * @param {import('./disposer.js').Disposer} p.disposer
     * @param {() => boolean} p.isEnabled the "accept drops onto the character" setting
     * @param {() => void} p.onReceived something was stored (the character acknowledges)
     * @param {(active: boolean) => void} p.onDragState an external drag started or ended (roaming waits meanwhile)
     * @param {(text: string, isError: boolean) => void} p.showMessage feedback for the user
     */
    constructor({actor, service, disposer, isEnabled, onReceived, onDragState, showMessage}) {
        this._actor = actor;
        this._service = service;
        this._disposer = disposer;
        this._isEnabled = isEnabled;
        this._onReceived = onReceived;
        this._onDragState = onDragState;
        this._showMessage = showMessage;
        this._tracker = new DropTracker();
        this._xdnd = null;
        this._destroyed = false;
        this._leaveTimer = 0;
        this._cancellable = null;
        this._payload = null;          // null | {state: 'pending'} | {state: 'ready', uriList, text} | {state: 'unsupported'|'failed'}
        this._dragId = 0;
    }

    /** @returns {boolean} false when the Shell offers no external-drag handler (the feature is then simply unavailable) */
    start() {
        this._xdnd = Main.xdndHandler ?? null;
        if (!this._xdnd) {
            debugLog('dropzone: Main.xdndHandler is not available; drops onto the character are disabled');
            return false;
        }
        // The Meta.Selection API is public C API, but no Shell JS file uses it, so check that GJS really exposes it.
        if (typeof Meta.SelectionType?.SELECTION_DND === 'undefined' || typeof global.display?.get_selection !== 'function') {
            errorLog('dropzone: Meta.Selection is not available to extensions here; drops onto the character are disabled');
            return false;
        }
        this._disposer.connect(this._xdnd, 'drag-begin', () => this._onBegin());
        this._disposer.connect(this._xdnd, 'drag-end', () => this._onEnd());
        this._actor.setDragTarget((source) => this._onHover(source));
        this._disposer.add(() => this.destroy(), 'destroy drop zone');
        return true;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._abortPrefetch();
        this._stopLeaveTimer();
        this._actor.setDragTarget(null);
        this._actor.setDropReady(false);
        this._onDragState(false);
        this._payload = null;
    }

    // --- drag lifecycle ---

    _onBegin() {
        if (this._destroyed || !this._isEnabled())
            return;
        this._dragId = this._tracker.begin();
        this._payload = null;
        this._abortPrefetch();
        this._onDragState(true);
        debugLog(`dropzone: external drag #${this._dragId} began`);
    }

    /** Called by the Shell while an external drag hovers the character. Always lets the event continue to other handlers. */
    _onHover(source) {
        if (this._destroyed || !this._isEnabled() || source !== this._xdnd || !this._tracker.active)
            return DND.DragMotionResult.CONTINUE;
        const {first} = this._tracker.hover(Date.now());
        if (first) {
            this._actor.setDropReady(true);
            if (this._leaveTimer === 0)
                this._leaveTimer = this._disposer.repeat(LEAVE_CHECK_MS, () => this._checkLeave());
            if (this._payload === null)
                this._prefetch(this._dragId);
        }
        return DND.DragMotionResult.CONTINUE;
    }

    _checkLeave() {
        if (this._destroyed)
            return;
        if (this._tracker.expire(Date.now()))
            this._actor.setDropReady(false);
    }

    _onEnd() {
        if (this._destroyed || !this._tracker.active)
            return;
        let buttonDown = null;
        let over;
        try {
            const [x, y, mods] = global.get_pointer();
            buttonDown = (mods & Clutter.ModifierType.BUTTON1_MASK) !== 0;
            over = this._actor.containsPoint(x, y);
        } catch (e) {
            errorLog('dropzone: could not read the pointer state:', e);
        }
        const decision = this._tracker.end({now: Date.now(), buttonDown, overTarget: over});
        this._stopLeaveTimer();
        this._actor.setDropReady(false);
        this._onDragState(false);
        debugLog(`dropzone: drag #${this._dragId} ended: ${decision.reason} (button down: ${buttonDown}, over her: ${over})`);
        const payload = this._payload;
        this._payload = null;
        if (!decision.drop || !payload || payload.state === 'pending')
            this._abortPrefetch();                      // nothing will use an unfinished read: cancel it
        if (!decision.drop)
            return;
        this._deliver(payload);
    }

    _stopLeaveTimer() {
        if (this._leaveTimer) {
            this._disposer.cancel(this._leaveTimer);
            this._leaveTimer = 0;
        }
    }

    // --- reading the in-flight data (once per drag, capped) ---

    _abortPrefetch() {
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    async _prefetch(dragId) {
        this._payload = {state: 'pending'};
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        try {
            const selection = global.display.get_selection();
            const offered = selection.get_mimetypes(Meta.SelectionType.SELECTION_DND) ?? [];
            debugLog(`dropzone: the source offers: ${offered.slice(0, 12).join(', ') || 'no types'}`);
            const mime = offered.includes(URI_LIST) ? URI_LIST : TEXT_TYPES.find(t => offered.includes(t));
            if (!mime) {
                debugLog(`dropzone: nothing usable offered (${offered.slice(0, 8).join(', ') || 'no types'})`);
                this._settle(dragId, {state: 'unsupported'});
                return;
            }
            const out = Gio.MemoryOutputStream.new_resizable();
            await new Promise((resolve, reject) => {
                selection.transfer_async(Meta.SelectionType.SELECTION_DND, mime, MAX_PAYLOAD_BYTES, out, cancellable, (source, result) => {
                    try {
                        source.transfer_finish(result);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            out.close(null);
            const text = new TextDecoder('utf-8').decode(out.steal_as_bytes().get_data());
            this._settle(dragId, mime === URI_LIST ? {state: 'ready', uriList: text, text: null} : {state: 'ready', uriList: null, text});
        } catch (e) {
            if (!cancellable.is_cancelled()) {
                debugLog(`dropzone: could not read the dragged data: ${e.message}`);
                this._settle(dragId, {state: 'failed'});
            }
        }
    }

    /** Stores a prefetch result unless the drag it belonged to is over or the zone was destroyed. */
    _settle(dragId, payload) {
        if (!this._destroyed && dragId === this._dragId && this._payload?.state === 'pending')
            this._payload = payload;
    }

    // --- storing ---

    _deliver(payload) {
        try {
            if (!payload || payload.state === 'pending') {
                this._showMessage(MESSAGES.notReady, true);
                return;
            }
            if (payload.state === 'failed') {
                this._showMessage(MESSAGES.unreadable, true);
                return;
            }
            const {items, rejected} = payload.state === 'ready' ? classifyPayload({uriList: payload.uriList, text: payload.text}) : {items: [], rejected: []};
            if (items.length === 0 && rejected.length === 0) {
                this._showMessage(MESSAGES.unsupported, true);
                return;
            }
            const result = items.length
                ? this._service.receive(items, 'backpack', {pocketFallback: true})
                : {added: [], skipped: []};
            const summary = summariseReceive(result, rejected, 'backpack');
            this._showMessage(summary.text, summary.error);
            if (result.added.length)
                this._onReceived();
        } catch (e) {
            if (e instanceof InventoryError) {
                this._showMessage(e.message, true);
            } else {
                errorLog('dropzone: storing the dropped item failed:', e);
                this._showMessage(MESSAGES.unreadable, true);
            }
        }
    }
}
