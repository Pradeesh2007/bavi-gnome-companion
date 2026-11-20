// lib/backpack/service.js
//
// Everything the backpack does except drawing it: keeps the Inventory (model.js) in memory, writes it
// through the InventoryStore after EVERY change, removes expired pocket items, imports files through the
// portal, and opens / reveals items. No Shell imports (the Shell-specific launch context comes in as a
// function), so the logic stays separate from lib/backpack/dialog.js.
//
// Rules this file enforces:
//   * a change that cannot be saved is rolled back (memory and disk never disagree) and reported
//   * nothing is ever executed: files are opened only through the default handler of their content type and
//     only after model.openBlockReason() approved them; links must be http(s)
//   * referenced files are never copied, modified or deleted
//   * data is never logged (only item ids, kinds and counts)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Inventory, InventoryError, openBlockReason} from './model.js';
import {InventoryStore} from './store.js';
import {FileChooserPortal} from './portal.js';
import {debugLog, errorLog} from '../log.js';


const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const FILE_ATTRS = 'standard::type,standard::size,standard::content-type,standard::display-name,unix::mode';

function pocketLifetimeMs(hours) {
    const h = Math.min(168, Math.max(1, Math.round(Number(hours) || 24)));
    return h * 60 * 60 * 1000;
}

export class BackpackService {
    /**
     * @param {object} params
     * @param {import('../disposer.js').Disposer} params.disposer owns the expiry timer
     * @param {string} params.dataDir directory for inventory.json
     * @param {() => number} params.getExpiryHours pocket lifetime in hours (GSettings)
     * @param {() => ?Gio.AppLaunchContext} params.createLaunchContext Shell launch context factory
     * @param {() => void} params.onChanged called when the inventory changed without a user action (expiry)
     */
    constructor({disposer, dataDir, getExpiryHours, createLaunchContext, onChanged}) {
        this._disposer = disposer;
        this._dataDir = dataDir;
        this._getExpiryHours = getExpiryHours;
        this._createLaunchContext = createLaunchContext;
        this._onChanged = onChanged;
        this._store = null;
        this._inv = new Inventory();
        this._unavailable = null;
        this._portal = new FileChooserPortal();
        this._destroyed = false;
        this._loading = false;
        this._cancellable = null;
        this._loaded = null;
    }

    /**
     * Starts loading the inventory (asynchronously) and the expiry sweep. Never throws, never rejects.
     * Until it finishes the service is "loading": reads show nothing and changes are refused with a clear message.
     * @returns {Promise<void>} resolves when loading has finished (or was cancelled by destroy())
     */
    start() {
        this._loading = true;
        this._cancellable = new Gio.Cancellable();
        this._disposer.repeat(SWEEP_INTERVAL_MS, () => {
            if (this._sweep() > 0)
                this._onChanged?.();
        });
        this._loaded = this._load();
        return this._loaded;
    }

    async _load() {
        let loaded = null;
        let failure = null;
        try {
            this._store = new InventoryStore(this._dataDir);
            loaded = await this._store.load(this._cancellable);
        } catch (e) {
            failure = e;
        }
        if (this._destroyed)
            return;                                   // shut down while reading: nothing may be touched any more
        this._loading = false;
        if (failure) {
            this._inv = new Inventory();
            this._unavailable = `The backpack storage could not be opened (${failure.message}).`;
            errorLog('backpack storage failed:', failure);
        } else {
            this._inv = loaded.inventory;
            this._unavailable = loaded.unavailable;
            for (const notice of loaded.notices)
                errorLog(`backpack: ${notice}`);
            if (this._unavailable)
                errorLog(`backpack: unavailable: ${this._unavailable}`);
        }

        let expired = 0;
        try {
            expired = this._sweep();
        } catch (e) {
            errorLog('backpack: first expiry sweep failed:', e);
        }
        const c = this._inv.counts();
        debugLog(`backpack: ready (${c.backpack}/${c.slots} slots, pocket ${c.pocket}, ${expired} expired removed)`);
        this._onChanged?.();
    }

    destroy() {
        this._destroyed = true;
        this._cancellable?.cancel();
        this._portal.cancel();
    }

    // --- reading ---

    get unavailableReason() {
        return this._unavailable;
    }

    get storagePath() {
        return this._store?.path ?? null;
    }

    /** Expired items are removed first, so the UI never shows an item past its time. */
    snapshot(query = '') {
        if (!this._destroyed) {
            try {
                if (this._sweep() > 0)
                    this._onChanged?.();
            } catch (e) {
                errorLog('backpack: expiry sweep failed:', e);
            }
        }
        const {backpack, pocket} = this._inv.search(query);
        return {counts: this._inv.counts(), backpack, pocket, unavailable: this._unavailable, loading: this._loading, now: Date.now()};
    }

    // --- changing (each call saves; failures roll back and throw InventoryError) ---

    addText(fields, destination) {
        return this._mutate(inv => inv.addText(fields, destination, Date.now(), this._pocketMs()));
    }

    addLink(fields, destination) {
        return this._mutate(inv => inv.addLink(fields, destination, Date.now(), this._pocketMs()));
    }

    keep(id) {
        return this._mutate(inv => inv.keep(id));
    }

    remove(id) {
        return this._mutate(inv => inv.remove(id));
    }

    /**
     * Opens the file chooser and adds the chosen files to `destination`.
     * @returns {Promise<{cancelled: boolean, added: object[], skipped: {name: string, reason: string}[]}>}
     * @throws {InventoryError} when the chooser cannot be used
     */
    async importFiles(destination) {
        this._guard();
        let uris;
        try {
            uris = await this._portal.chooseFiles('Add files to the backpack');
        } catch (e) {
            throw new InventoryError('portal', e.message);
        }
        if (this._destroyed)
            return {cancelled: true, added: [], skipped: []};
        if (uris === null)
            return {cancelled: true, added: [], skipped: []};

        const result = this._addUris(uris, destination);
        debugLog(`backpack: import finished: ${result.added.length} added, ${result.skipped.length} skipped`);
        return {cancelled: false, ...result};
    }

    /**
     * Stores received items (see intake.js: pasted or dropped files, links and text) with the same rules as every other way
     * in: existing slot and pocket limits, duplicate checks, atomic saves. Nothing is ever replaced or discarded.
     * @param {{kind: string, uri?: string, url?: string, text?: string}[]} items
     * @param {'backpack'|'pocket'} destination
     * @param {{pocketFallback?: boolean}} [options] when the backpack has no free slot, store the item in the pocket instead
     *   (the item is marked `viaPocket`); used for drops, where the source cannot be asked again
     * @returns {{added: object[], skipped: {name: string, reason: string, code: ?string}[]}}
     */
    receive(items, destination, {pocketFallback = false} = {}) {
        this._guard();
        const added = [];
        const skipped = [];
        const ordered = [...items.filter(i => i.kind === 'file'), ...items.filter(i => i.kind !== 'file')];
        for (const item of ordered) {
            const name = item.kind === 'file' ? this._nameOf(item.uri) : (item.kind === 'link' ? item.url : 'text').slice(0, 80);
            try {
                added.push(this._storeOne(item, name, destination, pocketFallback));
            } catch (e) {
                skipped.push({name, reason: e instanceof InventoryError ? e.message : String(e?.message ?? e), code: e?.code ?? null});
                if (!(e instanceof InventoryError))
                    errorLog('backpack: storing received data failed:', e);
            }
        }
        debugLog(`backpack: received ${items.length} item(s): ${added.length} stored, ${skipped.length} skipped`);
        return {added, skipped};
    }

    _nameOf(uri) {
        return GLib.uri_unescape_string(uri.split('/').pop() ?? uri, null) ?? uri;
    }

    _storeOne(item, name, destination, pocketFallback) {
        const put = where => {
            if (item.kind === 'file') {
                const info = this._describe(item.uri, name);
                return this._mutate(inv => inv.addFile(info, where, Date.now(), this._pocketMs()));
            }
            if (item.kind === 'link')
                return this._mutate(inv => inv.addLink({url: item.url}, where, Date.now(), this._pocketMs()));
            return this._mutate(inv => inv.addText({text: item.text}, where, Date.now(), this._pocketMs()));
        };
        try {
            return put(destination);
        } catch (e) {
            if (pocketFallback && destination === 'backpack' && e instanceof InventoryError && e.code === 'slots-full')
                return {...put('pocket'), viaPocket: true};
            throw e;
        }
    }

    /** Adds file:// URIs by reference (never copies, moves or deletes the file). */
    _addUris(uris, destination) {
        return this.receive(uris.map(uri => ({kind: 'file', uri})), destination);
    }

    // --- using items ---

    /** Opens a file (default handler, never executes) or a link. Resolves to a short confirmation. */
    async openItem(id) {
        this._guard();
        const item = this._inv.get(id);
        if (!item)
            throw new InventoryError('not-found', 'That item is no longer in the backpack.');
        if (item.kind === 'link') {
            await this._launch(item.url);
            debugLog(`backpack: opened link #${id}`);
            return 'Opened the link.';
        }
        if (item.kind !== 'file')
            throw new InventoryError('bad-argument', 'Notes are read in the backpack, not opened.');

        const file = Gio.File.new_for_path(item.path);
        const info = this._queryExisting(file, item.path);
        const reason = openBlockReason({
            path: item.path,
            contentType: info.get_content_type(),
            mode: info.has_attribute('unix::mode') ? info.get_attribute_uint32('unix::mode') : 0,
        });
        if (reason) {
            debugLog(`backpack: refused to open file #${id} (program, launcher or script)`);
            throw new InventoryError('blocked', reason);
        }
        await this._launch(file.get_uri());
        debugLog(`backpack: opened file #${id}`);
        return 'Opened the file.';
    }

    /** Shows a file in the file manager (falls back to opening its folder). */
    async revealItem(id) {
        this._guard();
        const item = this._inv.get(id);
        if (!item || item.kind !== 'file')
            throw new InventoryError('not-found', 'That item is not a file in the backpack.');
        const file = Gio.File.new_for_path(item.path);
        if (file.query_exists(null)) {
            try {
                await this._showItems(file.get_uri());
                return 'Showed the file in your file manager.';
            } catch (e) {
                debugLog(`backpack: file manager reveal failed (${e.message}); trying the folder`);
            }
        }
        const parent = file.get_parent();
        if (parent && parent.query_exists(null)) {
            await this._launch(parent.get_uri());
            return 'Opened the folder that held the file.';
        }
        throw new InventoryError('missing', `The file is no longer at ${item.path}.`);
    }

    // --- internals ---

    _pocketMs() {
        return pocketLifetimeMs(this._getExpiryHours());
    }

    _guard() {
        if (this._destroyed)
            throw new InventoryError('closed', 'The extension is shutting down.');
        if (this._loading)
            throw new InventoryError('loading', 'The backpack is still loading. Please try again in a moment.');
        if (this._unavailable)
            throw new InventoryError('unavailable', this._unavailable);
    }

    /** Applies `fn` to the inventory and saves; on a save failure restores the previous state. */
    _mutate(fn) {
        this._guard();
        const before = JSON.stringify(this._inv.toJSON());
        const result = fn(this._inv);   // throws InventoryError before changing anything
        try {
            this._store.save(this._inv);
        } catch (e) {
            this._inv = Inventory.fromJSON(JSON.parse(before)).inventory;
            errorLog('backpack: saving failed, change rolled back:', e);
            throw new InventoryError('save-failed', `Could not save the backpack (${e.message}). Nothing was changed.`);
        }
        return result;
    }

    /** Removes expired pocket items. Returns how many were removed. */
    _sweep() {
        if (this._loading || this._unavailable || !this._inv.hasExpired(Date.now()))
            return 0;
        const removed = this._mutate(inv => inv.purgeExpired(Date.now()));
        if (removed.length)
            debugLog(`backpack: ${removed.length} expired pocket item(s) removed`);
        return removed.length;
    }

    _describe(uri, name) {
        const file = Gio.File.new_for_uri(uri);
        const path = file.get_path();
        if (!path)
            throw new InventoryError('not-local', `${name} is not a local file.`);
        const info = this._queryExisting(file, path);
        return {
            path,
            title: info.get_display_name(),
            size: info.get_size(),
            contentType: info.get_content_type(),
        };
    }

    /** query_info that turns the common failures into messages; requires a regular file. */
    _queryExisting(file, path) {
        let info;
        try {
            info = file.query_info(FILE_ATTRS, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
                throw new InventoryError('missing',
                    `The file is no longer at ${path} (it was moved or deleted outside the backpack). ` +
                    'Remove it from the backpack if you do not need it.');
            }
            throw new InventoryError('unreadable', `Cannot read ${path}: ${e.message}`);
        }
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            throw new InventoryError('not-a-file', `${path} is not a regular file (folders are not supported).`);
        return info;
    }

    _launch(uri) {
        return new Promise((resolve, reject) => {
            const context = this._createLaunchContext?.() ?? null;
            Gio.AppInfo.launch_default_for_uri_async(uri, context, null, (_source, result) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(result);
                    resolve();
                } catch (e) {
                    reject(new InventoryError('launch-failed', `Could not open it: ${e.message}`));
                }
            });
        });
    }

    _showItems(uri) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                'org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
                'org.freedesktop.FileManager1', 'ShowItems',
                new GLib.Variant('(ass)', [[uri], '']), null,
                Gio.DBusCallFlags.NONE, 10000, null,
                (source, result) => {
                    try {
                        source.call_finish(result);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }
}
