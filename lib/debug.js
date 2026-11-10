// lib/debug.js
//
// Diagnostics for the "Spurious clutter_actor_allocate ... desktop-companion-root" investigation
// (see docs/investigation-stale-root-warnings.md). Active ONLY when the Shell process has
// DESKTOP_COMPANION_DEBUG set (tools/nested-test.sh sets it):
//   1  (--debug)        log every root's lifecycle, membership in the layout manager's tracking list,
//                       and a forced-GC survivor report
//   2  (--debug-trace)  also intercept Clutter warnings that name our root and log the JS stack that
//                       is running when Clutter emits them
//   3  (--debug-core)   also trap (SIGTRAP) at that moment so systemd-coredump captures the NATIVE
//                       call stack of whoever called clutter_actor_allocate on the destroyed root
//
// Everything is observational: it never changes the order or content of the extension's cleanup, and
// it does nothing at all when the variable is unset.
//
// Deliberate, documented exceptions for debug builds only:
//   * trackedCount()/isTracked() read the private Main.layoutManager._trackedActors field.
//   * The Clutter log handler (levels 2 and 3) is installed once and stays installed after disable(),
//     because the stale-actor warnings we are hunting arrive after disable().

import GLib from 'gi://GLib';
import System from 'system';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LEVEL = GLib.getenv('DESKTOP_COMPANION_DEBUG');
export const DEBUG = LEVEL === '1' || LEVEL === '2' || LEVEL === '3';
const TRACE = LEVEL === '2' || LEVEL === '3';
const CORE = LEVEL === '3';

const PREFIX = '[desktop-companion][debug]';
const log = (...args) => console.log(PREFIX, ...args);

let sequence = 0;
const records = new Map();   // id -> {ref: WeakRef, addr, destroyed}
let rawFormatLogged = false;
let probeInstalled = false;

/** Native pointer of a GObject wrapper, as printed by Clutter in its warnings (0x5648...). */
function nativeAddress(object) {
    const text = String(object);
    const match = /native@(0x[0-9a-f]+)/.exec(text);
    if (!match && !rawFormatLogged) {
        rawFormatLogged = true;
        log('could not parse a native address from:', text.slice(0, 160));
    }
    return match ? match[1] : '?';
}

/** Total number of chrome records the layout manager tracks. Informational only (other Shell parts change it too). */
function trackedCount() {
    try {
        return Main.layoutManager._trackedActors.length;
    } catch (e) {
        return -1;
    }
}

/** Exact test: is THIS actor still in the layout manager's tracking list? */
function isTracked(actor) {
    try {
        return Main.layoutManager._trackedActors.some(data => data.actor === actor);
    } catch (e) {
        return '?';
    }
}

/** Call right after the root actor was added to the chrome. Returns an id for the later calls. */
export function rootCreated(root) {
    if (!DEBUG)
        return 0;
    const id = ++sequence;
    const addr = nativeAddress(root);
    records.set(id, {ref: new WeakRef(root), addr, destroyed: false});
    log(`root#${id} created native=${addr} tracked=${trackedCount()} self-tracked=${isTracked(root)}`);
    return id;
}

export function rootBeforeRemove(id, root) {
    if (!DEBUG || !id)
        return;
    let inStage = '?';
    let parentIsUiGroup = '?';
    try {
        inStage = root.get_stage() !== null;
        parentIsUiGroup = root.get_parent() === Main.layoutManager.uiGroup;
    } catch (e) {
        inStage = `error:${e.message}`;
    }
    log(`root#${id} before-removeChrome in-stage=${inStage} parent-is-uiGroup=${parentIsUiGroup} tracked=${trackedCount()} self-tracked=${isTracked(root)}`);
}

export function rootAfterRemove(id, root) {
    if (!DEBUG || !id)
        return;
    let parent = '?';
    try {
        parent = root.get_parent() === null ? 'null' : 'set';
    } catch (e) {
        parent = `error:${e.message}`;
    }
    log(`root#${id} after-removeChrome parent=${parent} tracked=${trackedCount()} self-tracked=${isTracked(root)}`);
}

export function rootDestroyed(id) {
    if (!DEBUG || !id)
        return;
    const record = records.get(id);
    if (record)
        record.destroyed = true;
    log(`root#${id} destroyed tracked=${trackedCount()}`);
}

/**
 * Forces a JS garbage collection and reports how many previously destroyed roots are still
 * referenced from JS. A WeakRef only reports JS reachability: a native object kept alive by Clutter or
 * the Shell after its wrapper was collected is NOT detected. If this reports 0 while warnings still name
 * destroyed roots, no JS code (ours or the Shell's) holds them and the holder is native.
 */
export function gcCheck() {
    if (!DEBUG)
        return;
    System.gc();
    const alive = [];
    for (const [id, record] of records) {
        if (record.destroyed && record.ref.deref() !== undefined)
            alive.push(`#${id}(${record.addr})`);
    }
    log(`gc-check destroyed-roots-still-referenced=${alive.length} ${alive.join(' ')}`.trimEnd());
}

/**
 * Levels 2 and 3 only. Intercepts Clutter warnings that name our root, prints them through the default
 * handler first (so stalecheck still sees them), then logs the JS stack and, at level 3, traps.
 * Installed once; idempotent.
 */
export function installWarningProbe() {
    if (!TRACE || probeInstalled)
        return;
    probeInstalled = true;
    const flags = GLib.LogLevelFlags.LEVEL_WARNING | GLib.LogLevelFlags.FLAG_RECURSION;
    GLib.log_set_handler('Clutter', flags, (domain, level, message) => {
        try {
            GLib.log_default_handler(domain, level, message, null);
        } catch (e) {
            // nothing sensible to do; keep going so the stack is still logged
        }
        if (!message || !message.includes('desktop-companion-root'))
            return;
        const stack = String(new Error().stack).split('\n').filter(Boolean).slice(0, 12).join(' <- ');
        log(`clutter-warning-intercepted js-stack=${stack || '(empty)'}`);
        if (CORE) {
            log('trapping now so systemd-coredump records the native call stack');
            System.breakpoint();
        }
    });
    log(`warning probe installed (level ${LEVEL})`);
}
