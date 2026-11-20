// lib/backpack/store.js
//
// Persistence of the inventory as one versioned JSON file: <dataDir>/inventory.json (mode 0600, because
// notes can be personal). Plain Gio, no Shell imports.
//
//   load()  asynchronous (Gio load_contents_async, cancellable): the Shell's main loop is never blocked by reading the file.
//           Never throws for bad content. A file that cannot be parsed or has no valid structure is renamed
//           to inventory.json.corrupt-<time> (nothing is ever overwritten or discarded silently) and an empty
//           inventory is used. A file written by a NEWER format version is left untouched and the store
//           reports `unavailable`, so a newer Bavi's data is never overwritten by an older one.
//   save()  atomic: Gio.File.replace_contents with REPLACE_DESTINATION (temporary file + rename).
//           Throws the underlying GLib.Error; service.js turns it into a user message and rolls back.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Inventory, InventoryError} from './model.js';

const FILE_NAME = 'inventory.json';

export class InventoryStore {
    /** @param {string} dir directory that holds inventory.json (created when needed) */
    constructor(dir) {
        this._dir = dir;
        this._file = Gio.File.new_for_path(`${dir}/${FILE_NAME}`);
    }

    get path() {
        return this._file.get_path();
    }

    /**
     * @param {?Gio.Cancellable} cancellable cancels the read (shutdown); the returned promise then rejects with a CANCELLED error
     * @returns {Promise<{inventory: Inventory, unavailable: ?string, notices: string[]}>}
     *   unavailable: reason text when the stored data must not be modified (otherwise null)
     */
    async load(cancellable = null) {
        const notices = [];
        // Creating the (tiny, usually existing) data directory is a single metadata call and stays synchronous.
        if (GLib.mkdir_with_parents(this._dir, 0o700) !== 0)
            throw new Error(`cannot create ${this._dir}`);

        let text;
        try {
            const [, contents] = await this._readAsync(cancellable);
            text = new TextDecoder('utf-8').decode(contents);
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
                return {inventory: new Inventory(), unavailable: null, notices};
            throw e;
        }

        let parsed;
        try {
            parsed = Inventory.fromJSON(JSON.parse(text));
        } catch (e) {
            if (e instanceof InventoryError && e.code === 'newer-version')
                return {inventory: new Inventory(), unavailable: e.message, notices};
            const backup = this._setAside();
            notices.push(`inventory.json could not be read (${e.message}); it was kept as ${backup}`);
            return {inventory: new Inventory(), unavailable: null, notices};
        }

        if (parsed.dropped > 0) {
            const backup = this._setAside(true);
            notices.push(`${parsed.dropped} invalid item(s) were left out of the inventory; the original file was ` +
                `kept as ${backup}`);
        }
        return {inventory: parsed.inventory, unavailable: null, notices};
    }

    _readAsync(cancellable) {
        return new Promise((resolve, reject) => {
            this._file.load_contents_async(cancellable, (file, result) => {
                try {
                    resolve(file.load_contents_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Writes the inventory atomically. Deliberately synchronous: a change is committed or rolled back as one step
     * (service._mutate), the file is small (a few KB) and the write is a temporary file plus rename. @throws {GLib.Error}
     */
    save(inventory) {
        const json = JSON.stringify(inventory.toJSON(), null, 2);
        this._file.replace_contents(
            new TextEncoder().encode(json), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null);
    }

    /** Keeps the current file under a new name (copy when `copy`, otherwise rename). Returns the new name. */
    _setAside(copy = false) {
        const name = `${FILE_NAME}.corrupt-${Date.now()}`;
        const target = Gio.File.new_for_path(`${this._dir}/${name}`);
        if (copy)
            this._file.copy(target, Gio.FileCopyFlags.NONE, null, null);
        else
            this._file.move(target, Gio.FileCopyFlags.NONE, null, null);
        return name;
    }
}
