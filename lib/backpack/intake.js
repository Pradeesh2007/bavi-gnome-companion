// lib/backpack/intake.js
//
// Turns received data (the clipboard contents the user chose to paste; the same pipeline a drag-and-drop would use)
// into backpack candidates. Pure logic, no imports besides the model, so it runs under plain Node.
//
//   files      text/uri-list (or x-special/gnome-copied-files) with file:// URIs -> {kind: 'file', uri}
//   links      http:// and https:// URIs, or a single-line http(s) text           -> {kind: 'link', url}
//   notes      any other text                                                    -> {kind: 'text', text}
//
// Nothing is executed or fetched. Other URI schemes (javascript:, data:, ftp:, smb:, ...) are rejected, binary-looking
// text is rejected, and sizes are capped. Storage limits (12 slots, pocket 12, 20 000-character notes) are enforced later
// by the existing model, never here.

import {normalizeLink, LIMITS, InventoryError} from './model.js';

export const MAX_ITEMS = 24;                  // 12 slots + 12 pocket: more can never be stored anyway
export const MAX_INPUT_CHARS = 200000;        // refuse absurd payloads before looking at them

/** Lines of a text/uri-list: comments (#) and blanks ignored. */
export function parseUriList(text) {
    return String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'));
}

/** x-special/gnome-copied-files: first line "copy" or "cut", then one URI per line. The action is ignored (files are only referenced). */
export function parseCopiedFiles(text) {
    const lines = parseUriList(text);
    if (lines.length && /^(copy|cut)$/i.test(lines[0]))
        lines.shift();
    return lines;
}

function schemeOf(uri) {
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri);
    return m ? m[1].toLowerCase() : '';
}

/**
 * @param {{uriList?: ?string, text?: ?string}} payload raw strings read from the clipboard
 * @returns {{items: object[], rejected: {what: string, reason: string}[]}}
 */
export function classifyPayload({uriList = null, text = null}) {
    const items = [];
    const rejected = [];
    const reject = (what, reason) => rejected.push({what: String(what).slice(0, 80), reason});

    for (const raw of [uriList, text]) {
        if (typeof raw === 'string' && raw.length > MAX_INPUT_CHARS) {
            reject('clipboard', 'The clipboard content is too large.');
            return {items, rejected};
        }
    }

    if (typeof uriList === 'string' && uriList.trim() !== '') {
        for (const uri of uriList.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))) {
            if (items.length >= MAX_ITEMS) {
                reject(uri, `Only the first ${MAX_ITEMS} items are considered.`);
                continue;
            }
            const scheme = schemeOf(uri);
            if (scheme === 'file') {
                items.push({kind: 'file', uri});
            } else if (scheme === 'http' || scheme === 'https') {
                try {
                    items.push({kind: 'link', url: normalizeLink(uri)});
                } catch (e) {
                    reject(uri, e instanceof InventoryError ? e.message : 'Not a usable link.');
                }
            } else {
                reject(uri, scheme ? `"${scheme}:" addresses are not supported (only files and http/https links).` : 'Not a file or link address.');
            }
        }
        if (items.length || rejected.length)
            return {items, rejected};
    }

    if (typeof text === 'string') {
        if (/\u0000/.test(text)) {
            reject('clipboard', 'The clipboard text looks like binary data, so it was not stored.');
            return {items, rejected};
        }
        const trimmed = text.trim();
        if (trimmed === '')
            return {items, rejected};
        if (!/\s/.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
            try {
                items.push({kind: 'link', url: normalizeLink(trimmed)});
                return {items, rejected};
            } catch (e) {
                // an http(s)-looking but invalid link is stored as an ordinary note below
            }
        }
        if (trimmed.length > LIMITS.text) {
            reject('text', `The text is too long for a note (${trimmed.length} of ${LIMITS.text} characters). Nothing was changed.`);
            return {items, rejected};
        }
        items.push({kind: 'text', text: trimmed});
    }
    return {items, rejected};
}
