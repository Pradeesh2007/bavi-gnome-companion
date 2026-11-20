// lib/character/walkassets.js
//
// Loads assets/walk/walk.json (written by tools/build-walk-assets.py), validates it with lib/character/walk.js and checks
// that the atlas image exists. Asynchronous (Gio, cancellable) so the Shell's main loop is never blocked by file reads.
//
// Never rejects: a missing or invalid walking asset set only disables the walking animation (the character then glides as
// in 0.1) and the reason is logged. A cancelled load (the extension was disabled) resolves to null without logging.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {validateManifest} from './walk.js';
import {debugLog, errorLog} from '../log.js';

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED);
}

function readFile(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (source, result) => {
            try {
                resolve(source.load_contents_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function exists(file, cancellable) {
    return new Promise(resolve => {
        file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                source.query_info_finish(result);
                resolve(true);
            } catch (e) {
                resolve(false);
            }
        });
    });
}

/**
 * @param {string} dir absolute path of the extension's assets/walk directory
 * @param {?Gio.Cancellable} cancellable cancelled on shutdown
 * @returns {Promise<?{manifest: object, atlasPath: string}>} null when the assets are unusable (or the load was cancelled)
 */
export async function loadWalkAssets(dir, cancellable = null) {
    try {
        const [, contents] = await readFile(Gio.File.new_for_path(`${dir}/walk.json`), cancellable);
        const manifest = JSON.parse(new TextDecoder('utf-8').decode(contents));
        const {ok, errors} = validateManifest(manifest);
        if (!ok) {
            errorLog(`walking animation disabled: invalid walk.json (${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '; ...' : ''})`);
            return null;
        }
        const atlasPath = `${dir}/${manifest.atlas.image}`;
        if (!await exists(Gio.File.new_for_path(atlasPath), cancellable)) {
            if (cancellable?.is_cancelled())
                return null;
            errorLog(`walking animation disabled: ${atlasPath} is missing`);
            return null;
        }
        const s = manifest.sequences;
        debugLog(`walking animation: ${s.start.frames.length}/${s.loop.frames.length}/${s.stop.frames.length} frames ` +
            `(start/loop/stop), ${s.start.frameMs}/${s.loop.frameMs}/${s.stop.frameMs} ms per frame`);
        return {manifest, atlasPath};
    } catch (e) {
        if (isCancelled(e) || cancellable?.is_cancelled())
            return null;
        errorLog(`walking animation disabled: could not load assets from ${dir} (${e.message})`);
        return null;
    }
}
