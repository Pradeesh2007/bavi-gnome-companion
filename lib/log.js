// lib/log.js
//
// Minimal logging for modules that must stay free of Shell imports.
//
//   errorLog(...)  GENUINE failures and data problems (a storage failure, a change rolled back, a corrupt file set aside,
//                  an unexpected exception). Always on: a user reporting a problem needs these.
//   debugLog(...)  operational chatter (counts, "opened", "ready"). Only when DESKTOP_COMPANION_DEBUG is set (1, 2 or 3,
//                  the same switch as lib/debug.js; tools/nested-test.sh --debug sets it inside the isolated session).

import GLib from 'gi://GLib';

const PREFIX = '[desktop-companion]';
const LEVEL = GLib.getenv('DESKTOP_COMPANION_DEBUG');

export const DEBUG = LEVEL === '1' || LEVEL === '2' || LEVEL === '3';

export function debugLog(...args) {
    if (DEBUG)
        console.log(PREFIX, ...args);
}

export function errorLog(...args) {
    console.error(PREFIX, ...args);
}
