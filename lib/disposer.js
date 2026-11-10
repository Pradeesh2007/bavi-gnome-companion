// lib/disposer.js
//
// Owns every resource an enable() cycle creates that must be released in disable():
// signal connections, GLib timeouts and arbitrary cleanup callbacks.
//
// Release order in dispose():
//   1. timeouts   (so no timer callback can fire while things are torn down)
//   2. signals    (so no handler can fire into half-destroyed objects)
//   3. callbacks  (last registered runs first, e.g. controller stop before actor destroy)
//
// Process-wide counters of live resources survive enable()/disable() cycles because ES modules stay
// loaded. After every disable() they must be back to zero; extension.js logs them for leak checks.

import GLib from 'gi://GLib';

const LOG_PREFIX = '[desktop-companion]';

const LIVE = {signals: 0, timeouts: 0, callbacks: 0};

export function liveCounts() {
    return {...LIVE};
}

export class Disposer {
    constructor(name = 'disposer') {
        this._name = name;
        this._disposed = false;
        this._signals = [];          // {object, id, signalName}
        this._timeouts = new Set();  // GLib source ids that are still pending
        this._callbacks = [];        // {callback, label}
    }

    get disposed() {
        return this._disposed;
    }

    /** Connects a GObject signal and remembers how to disconnect it. Returns the handler id. */
    connect(object, signalName, handler) {
        this._assertActive('connect');
        const id = object.connect(signalName, handler);
        this._signals.push({object, id, signalName});
        LIVE.signals++;
        return id;
    }

    /** Runs callback once after delayMs. Returns a source id usable with cancel(). */
    once(delayMs, callback) {
        this._assertActive('once');
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._forgetTimeout(id);
            try {
                callback();
            } catch (e) {
                console.error(`${LOG_PREFIX} one-shot timer callback failed:`, e);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        LIVE.timeouts++;
        return id;
    }

    /** Runs callback every intervalMs until cancel() or dispose(). Returns a source id. */
    repeat(intervalMs, callback) {
        this._assertActive('repeat');
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            try {
                callback();
            } catch (e) {
                console.error(`${LOG_PREFIX} repeating timer callback failed; stopping this timer:`, e);
                this._forgetTimeout(id);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._timeouts.add(id);
        LIVE.timeouts++;
        return id;
    }

    /** Cancels a pending timer. Safe to call with an id that already fired or was cancelled. */
    cancel(id) {
        if (!id || !this._timeouts.has(id))
            return;
        this._forgetTimeout(id);
        GLib.Source.remove(id);
    }

    /** Registers a cleanup callback to run during dispose(). */
    add(callback, label = 'cleanup') {
        this._assertActive('add');
        this._callbacks.push({callback, label});
        LIVE.callbacks++;
    }

    /** Releases everything. Idempotent. Returns how many of each kind were released. */
    dispose() {
        const released = {signals: 0, timeouts: 0, callbacks: 0};
        if (this._disposed)
            return released;
        this._disposed = true;

        for (const id of [...this._timeouts]) {
            this._timeouts.delete(id);
            GLib.Source.remove(id);
            LIVE.timeouts--;
            released.timeouts++;
        }

        const signals = this._signals;
        this._signals = [];
        for (const {object, id, signalName} of signals.reverse()) {
            try {
                object.disconnect(id);
            } catch (e) {
                console.error(`${LOG_PREFIX} failed to disconnect '${signalName}':`, e);
            }
            LIVE.signals--;
            released.signals++;
        }

        const callbacks = this._callbacks;
        this._callbacks = [];
        for (const {callback, label} of callbacks.reverse()) {
            try {
                callback();
            } catch (e) {
                console.error(`${LOG_PREFIX} cleanup '${label}' failed:`, e);
            }
            LIVE.callbacks--;
            released.callbacks++;
        }

        return released;
    }

    _forgetTimeout(id) {
        if (this._timeouts.delete(id))
            LIVE.timeouts--;
    }

    _assertActive(what) {
        if (this._disposed)
            throw new Error(`${this._name}: ${what}() called after dispose()`);
    }
}
