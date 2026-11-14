// lib/backpack/clipboard.js
//
// Reads the clipboard ONCE, when the user presses "Paste" in the backpack window. There is no polling, no clipboard
// monitoring and no background reading anywhere in the extension. Shell-facing (St.Clipboard), so it is kept apart
// from the pure classifier in intake.js.
//
// Files copied in a file manager appear as text/uri-list (GTK/Files also offers x-special/gnome-copied-files);
// selected text appears as text. Only those types are read; images and other data are ignored.

import St from 'gi://St';

import {parseCopiedFiles} from './intake.js';

const URI_LIST = 'text/uri-list';
const COPIED_FILES = 'x-special/gnome-copied-files';

function readContent(clipboard, mimetype) {
    return new Promise((resolve, reject) => {
        clipboard.get_content(St.ClipboardType.CLIPBOARD, mimetype, (_clipboard, bytes) => {
            try {
                resolve(bytes ? new TextDecoder('utf-8').decode(bytes.get_data()) : null);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function readText(clipboard) {
    return new Promise(resolve => {
        clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(typeof text === 'string' ? text : null));
    });
}

/** @returns {Promise<{uriList: ?string, text: ?string}>} raw strings for classifyPayload() */
export async function readClipboardPayload() {
    const clipboard = St.Clipboard.get_default();
    const types = clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
    let uriList = null;
    if (types.includes(URI_LIST)) {
        uriList = await readContent(clipboard, URI_LIST);
    } else if (types.includes(COPIED_FILES)) {
        const raw = await readContent(clipboard, COPIED_FILES);
        uriList = raw === null ? null : parseCopiedFiles(raw).join('\n');
    }
    const text = uriList !== null && uriList.trim() !== '' ? null : await readText(clipboard);
    return {uriList, text};
}
