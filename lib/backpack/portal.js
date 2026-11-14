// lib/backpack/portal.js
//
// File selection through the xdg-desktop-portal FileChooser (org.freedesktop.portal.FileChooser.OpenFile).
// Gtk cannot be loaded inside the Shell process, so the dialog is shown by the portal in its own process.
//
// Protocol (from the xdg-desktop-portal documentation, not yet seen working on this machine):
//   1. compute the Request object path  /org/freedesktop/portal/desktop/request/<sender>/<token>
//      where <sender> is our unique bus name without the leading ':' and with '.' replaced by '_'
//   2. subscribe to org.freedesktop.portal.Request.Response on that path BEFORE calling OpenFile
//   3. call OpenFile(parent_window '', title, {handle_token, multiple}) ; it returns the request handle
//   4. Response(response uint32, results a{sv}): 0 = chosen (results.uris), 1 = cancelled, 2 = other
//
// One request at a time. cancel() unsubscribes and asks the portal to close the dialog.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const FILE_CHOOSER = 'org.freedesktop.portal.FileChooser';
const REQUEST = 'org.freedesktop.portal.Request';

const log = (...args) => console.log('[desktop-companion]', ...args);

export class FileChooserPortal {
    constructor() {
        this._pending = null;   // {subscription, handle, cancellable, settle}
        this._counter = 0;
        this._destroyed = false;
    }

    get busy() {
        return this._pending !== null;
    }

    /**
     * Shows the chooser. Resolves to an array of file:// URIs, or null when the user cancelled.
     * Rejects with an Error whose message is meant for the user.
     */
    chooseFiles(title) {
        if (this._destroyed)
            return Promise.reject(new Error('The extension is shutting down.'));
        if (this._pending)
            return Promise.reject(new Error('A file chooser is already open.'));

        const bus = Gio.DBus.session;
        const sender = bus.get_unique_name().substring(1).replace(/\./g, '_');
        this._counter += 1;
        const token = `bavi_${Date.now()}_${this._counter}`;
        const expectedPath = `${PORTAL_PATH}/request/${sender}/${token}`;

        return new Promise((resolve, reject) => {
            const pending = {subscription: 0, handle: expectedPath, cancellable: new Gio.Cancellable(), settled: false};
            this._pending = pending;

            const settle = (fn, value) => {
                if (pending.settled)
                    return;
                pending.settled = true;
                if (pending.subscription)
                    bus.signal_unsubscribe(pending.subscription);
                pending.subscription = 0;
                if (this._pending === pending)
                    this._pending = null;
                fn(value);
            };
            pending.settle = settle;

            const subscribe = path => bus.signal_subscribe(
                PORTAL_NAME, REQUEST, 'Response', path, null, Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, parameters) => {
                    let code;
                    let results;
                    try {
                        [code, results] = parameters.recursiveUnpack();
                    } catch (e) {
                        settle(reject, new Error(`The file chooser gave an unreadable answer: ${e.message}`));
                        return;
                    }
                    if (code === 0)
                        settle(resolve, Array.isArray(results?.uris) ? results.uris : []);
                    else if (code === 1)
                        settle(resolve, null);
                    else
                        settle(reject, new Error('The file chooser was closed without a result.'));
                });
            pending.subscription = subscribe(expectedPath);

            const options = {
                handle_token: new GLib.Variant('s', token),
                multiple: new GLib.Variant('b', true),
            };
            bus.call(
                PORTAL_NAME, PORTAL_PATH, FILE_CHOOSER, 'OpenFile',
                new GLib.Variant('(ssa{sv})', ['', title, options]),
                new GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, -1, pending.cancellable,
                (source, result) => {
                    try {
                        const [handle] = source.call_finish(result).recursiveUnpack();
                        if (handle !== expectedPath && !pending.settled) {
                            // Older portals pick their own handle: listen on it instead.
                            log(`file chooser handle differs from the expected one (${handle}); resubscribing`);
                            if (pending.subscription)
                                bus.signal_unsubscribe(pending.subscription);
                            pending.handle = handle;
                            pending.subscription = subscribe(handle);
                        }
                    } catch (e) {
                        if (pending.settled)
                            return;
                        settle(reject, new Error(describeError(e)));
                    }
                });
        });
    }

    /** Closes a pending request (used on shutdown). The promise of chooseFiles() is left unresolved. */
    cancel() {
        this._destroyed = true;
        const pending = this._pending;
        if (!pending)
            return;
        this._pending = null;
        pending.settled = true;
        const bus = Gio.DBus.session;
        if (pending.subscription)
            bus.signal_unsubscribe(pending.subscription);
        pending.subscription = 0;
        pending.cancellable.cancel();
        bus.call(PORTAL_NAME, pending.handle, REQUEST, 'Close', null, null,
            Gio.DBusCallFlags.NO_AUTO_START, -1, null,
            (source, result) => {
                try {
                    source.call_finish(result);
                } catch (e) {
                    // The request may already be gone; nothing to do.
                }
            });
    }
}

function describeError(e) {
    const text = String(e?.message ?? e);
    if (/ServiceUnknown|NameHasNoOwner|not activatable|UnknownMethod/i.test(text))
        return 'The file chooser portal (xdg-desktop-portal) is not available.';
    return `The file chooser failed: ${text}`;
}
