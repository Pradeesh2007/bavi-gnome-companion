// lib/character/walkassets.js
//
// Loads assets/walk/walk.json (written by tools/build-walk-assets.py), validates it with lib/character/walk.js
// and checks that the atlas image exists. Never throws: a missing or invalid walking asset set only disables the
// walking animation (Bavi then glides as in 0.1) and the reason is logged.

import Gio from 'gi://Gio';

import {validateManifest} from './walk.js';

const log = (...args) => console.log('[desktop-companion]', ...args);

/**
 * @param {string} dir absolute path of the extension's assets/walk directory
 * @returns {?{manifest: object, atlasPath: string}} null when the assets are unusable
 */
export function loadWalkAssets(dir) {
    try {
        const file = Gio.File.new_for_path(`${dir}/walk.json`);
        const [, contents] = file.load_contents(null);
        const manifest = JSON.parse(new TextDecoder('utf-8').decode(contents));
        const {ok, errors} = validateManifest(manifest);
        if (!ok) {
            log(`walking animation disabled: invalid walk.json (${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '; ...' : ''})`);
            return null;
        }
        const atlasPath = `${dir}/${manifest.atlas.image}`;
        if (!Gio.File.new_for_path(atlasPath).query_exists(null)) {
            log(`walking animation disabled: ${atlasPath} is missing`);
            return null;
        }
        const s = manifest.sequences;
        log(`walking animation: ${s.start.frames.length}/${s.loop.frames.length}/${s.stop.frames.length} frames ` +
            `(start/loop/stop), ${s.start.frameMs}/${s.loop.frameMs}/${s.stop.frameMs} ms per frame`);
        return {manifest, atlasPath};
    } catch (e) {
        log(`walking animation disabled: could not load assets from ${dir} (${e.message})`);
        return null;
    }
}
