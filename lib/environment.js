// lib/environment.js
//
// Shell integration for the character. Everything here is based on APIs seen in the installed
// GNOME Shell 51.1 source (see docs/release-0.1.md for the exact references and what is still
// unverified). lib/menu.js is the only other module that talks to Shell UI code.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const log = (...args) => console.log('[desktop-companion]', ...args);

export class Environment {
    /** @param {import('./disposer.js').Disposer} disposer owns every connection and registration made here */
    constructor(disposer) {
        this._disposer = disposer;
    }

    /** Work area of the primary monitor in stage coordinates: {x, y, width, height}. */
    getWorkArea() {
        const rect = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    }

    /** Calls callback whenever monitors or work areas change. */
    watchWorkArea(callback) {
        this._disposer.connect(Main.layoutManager, 'monitors-changed', callback);
        this._disposer.connect(global.display, 'workareas-changed', callback);
    }

    /**
     * Adds actor to the Shell chrome below menus and popups. trackFullscreen asks the layout
     * manager to hide it while a window is fullscreen on its monitor.
     */
    addChrome(actor) {
        Main.layoutManager.addChrome(actor, {trackFullscreen: true});
    }

    removeChrome(actor) {
        Main.layoutManager.removeChrome(actor);
    }

    /** False when the user disabled animations or asked for reduced motion. */
    animationsEnabled() {
        const settings = St.Settings.get();
        return settings.enable_animations && settings.reducedMotion !== St.ReducedMotion.REDUCE;
    }

    /** Pointer position in stage coordinates: [x, y]. */
    getPointer() {
        const [x, y] = global.get_pointer();
        return [x, y];
    }

    /** True while the Overview is visible (including its animation). */
    overviewVisible() {
        return Main.overview.visible;
    }

    /**
     * Registers a global keybinding whose accelerator is stored in `settings` under `name`
     * (a GSettings key of type 'as'). Removed automatically by the disposer.
     */
    addKeybinding(name, settings, handler) {
        const action = Main.wm.addKeybinding(
            name, settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, handler);
        if (action === Meta.KeyBindingAction.NONE) {
            log(`keybinding '${name}' could not be registered (accelerator unusable or already taken)`);
            return;
        }
        this._disposer.add(() => Main.wm.removeKeybinding(name), `remove keybinding ${name}`);
    }
}
