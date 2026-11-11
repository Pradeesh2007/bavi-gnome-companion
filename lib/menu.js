// lib/menu.js
//
// Right-click context menu for Bavi, built on the Shell's own PopupMenu. This is the second Shell-facing
// module (with lib/environment.js). The menu and its items are created each time it is opened and destroyed
// the next time it opens or when the extension is disabled; the item signals live on objects that are
// destroyed with the menu, so they need no separate disconnect.

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const log = (...args) => console.log('[desktop-companion]', ...args);

export class CompanionMenu {
    /**
     * @param {object} params
     * @param {import('gi://St').Widget} params.sourceActor widget the menu points at
     * @param {() => Object<string, boolean>} params.getState current boolean values by GSettings key
     * @param {{backpack: Function, summon: Function, home: Function, set: Function, settings: Function}} params.actions
     */
    constructor({sourceActor, getState, actions}) {
        this._source = sourceActor;
        this._getState = getState;
        this._actions = actions;
        this._menu = null;
        this._manager = null;
        this._destroyed = false;
    }

    open() {
        if (this._destroyed)
            return;
        try {
            this._teardown();
            this._build();
            this._menu.open();
            log('menu opened');
        } catch (e) {
            console.error('[desktop-companion] could not open the menu:', e);
            this._teardown();
        }
    }

    destroy() {
        this._destroyed = true;
        this._teardown();
    }

    _build() {
        const state = this._getState();
        const actions = this._actions;

        const menu = new PopupMenu.PopupMenu(this._source, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        const manager = new PopupMenu.PopupMenuManager(this._source);
        manager.addMenu(menu);
        this._menu = menu;
        this._manager = manager;

        menu.addAction('Backpack…', () => actions.backpack());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Come here', () => actions.summon());
        menu.addAction('Go home', () => actions.home());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const addSwitch = (label, key) => {
            const item = new PopupMenu.PopupSwitchMenuItem(label, !!state[key]);
            item.connect('toggled', (_item, value) => actions.set(key, value));
            menu.addMenuItem(item);
        };
        addSwitch('Pause', 'paused');
        addSwitch('Quiet mode', 'quiet-mode');
        addSwitch('Focus mode', 'focus-mode');
        addSwitch('Roam occasionally', 'roaming');

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Hide', () => actions.set('hidden', true));
        menu.addAction('Settings', () => actions.settings());
    }

    _teardown() {
        const menu = this._menu;
        const manager = this._manager;
        this._menu = null;
        this._manager = null;
        if (manager && menu) {
            try {
                manager.removeMenu(menu);
            } catch (e) {
                console.error('[desktop-companion] menu manager cleanup failed:', e);
            }
        }
        if (menu) {
            try {
                menu.destroy();
            } catch (e) {
                console.error('[desktop-companion] menu destroy failed:', e);
            }
        }
    }
}
