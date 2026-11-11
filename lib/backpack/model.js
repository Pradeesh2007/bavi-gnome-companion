// lib/backpack/model.js
//
// Pure data model of Bavi's backpack. It imports nothing (no Shell, GLib or Gio), so it can be unit
// tested with plain Node (tests/model.test.mjs). Storage is in store.js, the Shell UI in dialog.js.
//
// Concepts
//   backpack  12 permanent slots. An item in a slot never expires.
//   pocket    temporary holding area (at most POCKET_LIMIT items). Every pocket item has an `expiresAt`
//             time stamp; when it passes the item is removed from the inventory. "Keep" moves a pocket
//             item into a free slot.
//   item      one of three kinds:
//               file  a REFERENCE to a local file (path, size, content type). The file itself is never
//                     copied, changed or deleted by Bavi.
//               text  a note (title + text)
//               link  an http(s) link
//
// Item shape (all kinds):  {id, kind, title, createdAt, slot, expiresAt, ...kind fields}
//   slot       0..SLOT_COUNT-1 for backpack items, null for pocket items
//   expiresAt  null for backpack items, milliseconds since the epoch for pocket items
//   file:  path (absolute), size (number|null), contentType (string|null)
//   text:  text
//   link:  url
//
// Every function that can fail throws InventoryError with a stable `code` and a message that is written
// for the user (the UI shows it as is).

export const SCHEMA_VERSION = 1;
export const SLOT_COUNT = 12;
export const POCKET_LIMIT = 12;
export const LIMITS = Object.freeze({title: 120, text: 20000, url: 2048, path: 4096});

const KINDS = ['file', 'text', 'link'];

export class InventoryError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InventoryError';
        this.code = code;
    }
}

// --- helpers --------------------------------------------------------------------------------------

/** Validates an http(s) link. Returns the trimmed link or throws InventoryError('bad-link'|'empty'|'too-long'). */
export function normalizeLink(input) {
    const url = typeof input === 'string' ? input.trim() : '';
    if (!url)
        throw new InventoryError('empty', 'The link is empty.');
    if (url.length > LIMITS.url)
        throw new InventoryError('too-long', `The link is too long (${url.length} of ${LIMITS.url} characters).`);
    if (/[\s\u0000-\u001f\u007f]/.test(url))
        throw new InventoryError('bad-link', 'A link cannot contain spaces or control characters.');
    if (!/^https?:\/\/[^/?#]+/i.test(url))
        throw new InventoryError('bad-link', 'Links must start with http:// or https:// and name a site.');
    return url;
}

/** Host part of an http(s) link, used as the default title. */
export function linkHost(url) {
    const m = /^https?:\/\/(?:[^/?#@]*@)?(\[[^\]]+\]|[^/?#:]+)/i.exec(url);
    return m ? m[1] : url;
}

function basename(path) {
    const parts = path.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
}

function shorten(text, max) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** One-line preview of a text for list rows. */
export function previewText(text, max = 80) {
    return shorten(String(text ?? ''), max);
}

function resolveTitle(title, fallback) {
    const t = (typeof title === 'string' ? title : '').replace(/\s+/g, ' ').trim();
    if (t.length > LIMITS.title)
        throw new InventoryError('too-long', `The title is too long (${t.length} of ${LIMITS.title} characters).`);
    return t || fallback;
}

/** "3 h 20 min", "12 min", "less than a minute", "expired". */
export function formatRemaining(ms) {
    if (!(ms > 0))
        return 'expired';
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1)
        return 'less than a minute';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0)
        return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// --- opening files: what Bavi refuses to hand to the desktop ---------------------------------------
// Bavi never executes anything. Opening goes through the desktop's default handler for the file type, so
// programs, launchers and scripts that could be run by a handler are refused. "Reveal" is always allowed.

const BLOCKED_EXTENSIONS = new Set([
    'desktop', 'sh', 'bash', 'zsh', 'fish', 'csh', 'run', 'appimage', 'bin', 'elf', 'so', 'exe', 'msi',
    'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'lnk', 'application',
]);

const BLOCKED_TYPES = new Set([
    'application/x-executable', 'application/x-pie-executable', 'application/x-sharedlib',
    'application/x-desktop', 'application/x-shellscript', 'application/x-ms-dos-executable',
    'application/vnd.microsoft.portable-executable', 'application/x-msdownload', 'application/x-msi',
    'application/vnd.appimage', 'application/x-appimage', 'application/x-java-archive',
    'application/x-ms-shortcut', 'application/x-bat', 'application/x-executable-script',
]);

/**
 * Returns a user-facing reason when Bavi must not open this file, or null when it may.
 * @param {{path: string, contentType: ?string, mode: ?number}} file mode = unix permission bits (may be 0/null)
 */
export function openBlockReason({path, contentType, mode}) {
    const ext = (/\.([^./]+)$/.exec(path) ?? [])[1]?.toLowerCase();
    const type = contentType ?? '';
    if ((ext && BLOCKED_EXTENSIONS.has(ext)) || BLOCKED_TYPES.has(type)) {
        return 'Bavi does not open programs, launchers or scripts. Use Reveal to find the file in your file manager.';
    }
    const executableBit = ((mode ?? 0) & 0o111) !== 0;
    const genericBinary = type === '' || type === 'application/octet-stream' || type.startsWith('application/x-');
    if (executableBit && genericBinary)
        return 'This file is marked executable, so Bavi will not open it. Use Reveal to find it in your file manager.';
    return null;
}

// --- loading ---------------------------------------------------------------------------------------

function isStr(v, max) {
    return typeof v === 'string' && v.length <= max;
}

/** Returns a clean copy of a stored item, or null when it is not valid. Unknown fields are dropped. */
function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const {id, kind, title, createdAt, slot, expiresAt} = raw;
    if (!Number.isInteger(id) || id < 1 || !KINDS.includes(kind))
        return null;
    if (!isStr(title, LIMITS.title) || title === '' || !Number.isFinite(createdAt))
        return null;

    const inBackpack = slot !== null && slot !== undefined;
    if (inBackpack) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT)
            return null;
        if (expiresAt !== null && expiresAt !== undefined)
            return null;
    } else if (!Number.isFinite(expiresAt)) {
        return null;
    }

    const item = {
        id, kind, title, createdAt,
        slot: inBackpack ? slot : null,
        expiresAt: inBackpack ? null : expiresAt,
    };

    if (kind === 'file') {
        if (!isStr(raw.path, LIMITS.path) || !raw.path.startsWith('/'))
            return null;
        item.path = raw.path;
        item.size = Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : null;
        item.contentType = typeof raw.contentType === 'string' ? raw.contentType.slice(0, 120) : null;
    } else if (kind === 'text') {
        if (!isStr(raw.text, LIMITS.text) || raw.text.trim() === '')
            return null;
        item.text = raw.text;
    } else {
        try {
            if (normalizeLink(raw.url) !== raw.url)
                return null;
        } catch (e) {
            return null;
        }
        item.url = raw.url;
    }
    return item;
}

// --- inventory -------------------------------------------------------------------------------------

export class Inventory {
    constructor() {
        this._items = [];
        this._nextId = 1;
    }

    /**
     * Builds an inventory from parsed JSON.
     * @returns {{inventory: Inventory, dropped: number}} `dropped` = stored items that were invalid and left out
     * @throws {InventoryError} 'invalid' (not an inventory) or 'newer-version' (written by a newer Bavi)
     */
    static fromJSON(data) {
        if (data === null || typeof data !== 'object' || Array.isArray(data))
            throw new InventoryError('invalid', 'The inventory file does not contain a JSON object.');
        if (!Number.isInteger(data.version) || data.version < 1)
            throw new InventoryError('invalid', 'The inventory file has no valid version number.');
        if (data.version > SCHEMA_VERSION) {
            throw new InventoryError('newer-version',
                `The inventory was written by a newer Bavi (format ${data.version}); this version understands ` +
                `format ${SCHEMA_VERSION}. It was left untouched.`);
        }
        if (!Array.isArray(data.items))
            throw new InventoryError('invalid', 'The inventory file has no item list.');

        const inventory = new Inventory();
        const ids = new Set();
        const slots = new Set();
        let dropped = 0;
        let maxId = 0;
        for (const raw of data.items) {
            const item = sanitizeItem(raw);
            if (!item || ids.has(item.id) || (item.slot !== null && slots.has(item.slot))) {
                dropped++;
                continue;
            }
            ids.add(item.id);
            if (item.slot !== null)
                slots.add(item.slot);
            maxId = Math.max(maxId, item.id);
            inventory._items.push(item);
        }
        const declared = Number.isInteger(data.nextId) && data.nextId >= 1 ? data.nextId : 1;
        inventory._nextId = Math.max(declared, maxId + 1);
        return {inventory, dropped};
    }

    toJSON() {
        return {version: SCHEMA_VERSION, nextId: this._nextId, items: this._items.map(item => ({...item}))};
    }

    get(id) {
        const item = this._items.find(i => i.id === id);
        return item ? {...item} : null;
    }

    counts() {
        const backpack = this._items.filter(i => i.slot !== null).length;
        return {backpack, pocket: this._items.length - backpack, slots: SLOT_COUNT, pocketLimit: POCKET_LIMIT};
    }

    // --- adding ---

    addFile({path, title, size = null, contentType = null}, destination, now, pocketMs) {
        if (typeof path !== 'string' || !path.startsWith('/') || path.length > LIMITS.path)
            throw new InventoryError('bad-file', 'That is not a usable local file path.');
        this._rejectDuplicate('file', 'path', path);
        const base = {
            kind: 'file',
            title: resolveTitle(title, basename(path)),
            path,
            size: Number.isFinite(size) && size >= 0 ? size : null,
            contentType: typeof contentType === 'string' ? contentType : null,
        };
        return this._insert(base, destination, now, pocketMs);
    }

    addText({title, text}, destination, now, pocketMs) {
        const body = String(text ?? '').replace(/\r\n?/g, '\n');
        if (body.trim() === '')
            throw new InventoryError('empty', 'The note is empty.');
        if (body.length > LIMITS.text) {
            throw new InventoryError('too-long',
                `The note is too long (${body.length} of ${LIMITS.text} characters).`);
        }
        const base = {kind: 'text', title: resolveTitle(title, shorten(body, 60)), text: body};
        return this._insert(base, destination, now, pocketMs);
    }

    addLink({title, url}, destination, now, pocketMs) {
        const clean = normalizeLink(url);
        this._rejectDuplicate('link', 'url', clean);
        const base = {kind: 'link', title: resolveTitle(title, linkHost(clean)), url: clean};
        return this._insert(base, destination, now, pocketMs);
    }

    // --- changing ---

    /** Moves a pocket item into the lowest free slot (it no longer expires). */
    keep(id) {
        const item = this._items.find(i => i.id === id);
        if (!item)
            throw new InventoryError('not-found', 'That item is no longer in the backpack.');
        if (item.slot !== null)
            throw new InventoryError('not-in-pocket', 'That item is already in the backpack.');
        const slot = this._freeSlot();
        if (slot === null) {
            throw new InventoryError('slots-full',
                `The backpack is full (${SLOT_COUNT} of ${SLOT_COUNT} slots). Remove an item to make room.`);
        }
        item.slot = slot;
        item.expiresAt = null;
        return {...item};
    }

    /** Removes an item from the inventory (never touches a referenced file). Returns the removed item. */
    remove(id) {
        const index = this._items.findIndex(i => i.id === id);
        if (index < 0)
            throw new InventoryError('not-found', 'That item is no longer in the backpack.');
        const [item] = this._items.splice(index, 1);
        return item;
    }

    hasExpired(now) {
        return this._items.some(i => i.slot === null && i.expiresAt <= now);
    }

    /** Removes pocket items whose expiry time has passed. Returns the removed items. */
    purgeExpired(now) {
        const removed = this._items.filter(i => i.slot === null && i.expiresAt <= now);
        if (removed.length)
            this._items = this._items.filter(i => !removed.includes(i));
        return removed;
    }

    // --- reading ---

    /**
     * Items matching the query (every whitespace-separated term must appear, case-insensitive, in the
     * title, path, link, note text or kind). An empty query matches everything.
     * @returns {{backpack: object[], pocket: object[]}} backpack by slot; pocket newest first
     */
    search(query = '') {
        const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const matches = item => {
            if (!terms.length)
                return true;
            const hay = [item.title, item.path, item.url, item.text, item.kind === 'text' ? 'note' : item.kind]
                .filter(Boolean).join('\n').toLowerCase();
            return terms.every(t => hay.includes(t));
        };
        const found = this._items.filter(matches).map(i => ({...i}));
        return {
            backpack: found.filter(i => i.slot !== null).sort((a, b) => a.slot - b.slot),
            pocket: found.filter(i => i.slot === null).sort((a, b) => b.createdAt - a.createdAt),
        };
    }

    // --- internals ---

    _freeSlot() {
        const used = new Set(this._items.filter(i => i.slot !== null).map(i => i.slot));
        for (let s = 0; s < SLOT_COUNT; s++) {
            if (!used.has(s))
                return s;
        }
        return null;
    }

    _rejectDuplicate(kind, field, value) {
        const existing = this._items.find(i => i.kind === kind && i[field] === value);
        if (!existing)
            return;
        const noun = kind === 'file' ? 'file' : 'link';
        if (existing.slot !== null)
            throw new InventoryError('duplicate', `That ${noun} is already in the backpack.`);
        throw new InventoryError('duplicate',
            `That ${noun} is already in the pocket. Use Keep to move it to the backpack.`);
    }

    _insert(base, destination, now, pocketMs) {
        if (!Number.isFinite(now))
            throw new InventoryError('bad-argument', 'Internal error: no current time.');
        let slot = null;
        let expiresAt = null;
        if (destination === 'backpack') {
            slot = this._freeSlot();
            if (slot === null) {
                throw new InventoryError('slots-full',
                    `The backpack is full (${SLOT_COUNT} of ${SLOT_COUNT} slots). Remove an item first, ` +
                    'or put this one in the pocket.');
            }
        } else if (destination === 'pocket') {
            if (this._items.filter(i => i.slot === null).length >= POCKET_LIMIT) {
                throw new InventoryError('pocket-full',
                    `The pocket is full (${POCKET_LIMIT} items). Keep or remove something first.`);
            }
            if (!(pocketMs > 0))
                throw new InventoryError('bad-argument', 'Internal error: invalid pocket lifetime.');
            expiresAt = now + pocketMs;
        } else {
            throw new InventoryError('bad-argument', `Internal error: unknown destination "${destination}".`);
        }
        const item = {id: this._nextId, ...base, createdAt: now, slot, expiresAt};
        this._nextId += 1;
        this._items.push(item);
        return {...item};
    }
}
