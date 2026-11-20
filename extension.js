// extension.js
//
// Lifecycle only. enable() builds one object graph owned by a fresh Disposer; disable() disposes it.
// Nothing is kept at module level except the cycle counter used for log messages.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Disposer, liveCounts} from './lib/disposer.js';
import {Environment} from './lib/environment.js';
import {CharacterActor, liveActorCount} from './lib/character/actor.js';
import {CharacterController} from './lib/character/controller.js';
import {loadWalkAssets} from './lib/character/walkassets.js';
import {errorLog} from './lib/log.js';
import {CompanionMenu} from './lib/menu.js';
import {BackpackService} from './lib/backpack/service.js';
import {BackpackUI} from './lib/backpack/dialog.js';
import {DropZone} from './lib/dropzone.js';
import {storedName} from './lib/name.js';
import * as debug from './lib/debug.js';

const log = (...args) => console.log('[desktop-companion]', ...args);

let enableCount = 0;

function formatLive() {
    const c = liveCounts();
    return `signals=${c.signals} timeouts=${c.timeouts} callbacks=${c.callbacks} actors=${liveActorCount()}`;
}

/** Reads the controller configuration from GSettings. */
function readConfig(settings) {
    return {
        hidden: settings.get_boolean('hidden'),
        paused: settings.get_boolean('paused'),
        quiet: settings.get_boolean('quiet-mode'),
        focus: settings.get_boolean('focus-mode'),
        roaming: settings.get_boolean('roaming'),
        pointerLook: settings.get_boolean('pointer-look'),
        height: settings.get_int('character-height'),
        corner: settings.get_string('home-corner'),
    };
}

export default class DesktopCompanionExtension extends Extension {
    enable() {
        if (this._disposer) {
            log('enable() called while already enabled; ignoring');
            return;
        }

        debug.installWarningProbe();
        debug.gcCheck();
        enableCount += 1;
        this._cycle = enableCount;
        const disposer = new Disposer(`cycle ${this._cycle}`);
        this._disposer = disposer;

        try {
            const settings = this.getSettings();
            const environment = new Environment(disposer);
            const config = readConfig(settings);

            let controller = null;
            let menu = null;
            let backpackUI = null;

            // Backpack (release 0.2): the service owns storage and the expiry timer, the UI owns the dialog.
            // Cleanup callbacks run newest first, so the window is destroyed before the service.
            const getExpiryHours = () => settings.get_int('pocket-expiry-hours');
            const backpack = new BackpackService({
                disposer,
                dataDir: GLib.build_filenamev([GLib.get_user_data_dir(), 'desktop-companion']),
                getExpiryHours,
                createLaunchContext: () => environment.createLaunchContext(),
                onChanged: () => backpackUI?.refresh(),
            });
            disposer.add(() => backpack.destroy(), 'destroy backpack service');
            backpackUI = new BackpackUI({service: backpack, environment, getExpiryHours, getName: () => storedName(settings.get_string('character-name')), onReceived: () => controller?.acknowledge()});
            disposer.add(() => backpackUI.destroy(), 'destroy backpack window');
            const actor = new CharacterActor({
                environment,
                disposer,
                assetDir: `${this.path}/assets`,
                height: config.height,
                onClick: () => controller?.handleClick(),
                onSecondaryClick: () => menu?.open(),
            });
            controller = new CharacterController({actor, environment, disposer});

            const summonNow = () => {
                if (settings.get_boolean('hidden'))
                    settings.set_boolean('hidden', false);
                if (settings.get_boolean('paused'))
                    settings.set_boolean('paused', false);
                controller.summon();
            };

            menu = new CompanionMenu({
                sourceActor: actor.sourceActor,
                getState: () => ({
                    'paused': settings.get_boolean('paused'),
                    'quiet-mode': settings.get_boolean('quiet-mode'),
                    'focus-mode': settings.get_boolean('focus-mode'),
                    'roaming': settings.get_boolean('roaming'),
                }),
                actions: {
                    // Opened a moment later so the context menu has released its own grab first.
                    backpack: () => disposer.once(120, () => backpackUI.open()),
                    summon: summonNow,
                    home: () => controller.returnHome(),
                    set: (key, value) => settings.set_boolean(key, value),
                    settings: () => this.openPreferences(),
                },
            });
            disposer.add(() => menu.destroy(), 'destroy context menu');

            // The walking assets are read asynchronously. Until they arrive (or if they are missing or invalid) she glides as in 0.1.
            // Shutting down cancels the read and makes a late result harmless.
            const assetLoad = new Gio.Cancellable();
            let alive = true;
            disposer.add(() => {
                alive = false;
                assetLoad.cancel();
            }, 'cancel walking asset load');
            loadWalkAssets(`${this.path}/assets/walk`, assetLoad).then(walk => {
                if (!alive || !walk)
                    return;
                actor.attachWalkAssets(walk, disposer);
                controller.setWalk(walk.manifest);
            }).catch(e => errorLog('attaching the walking assets failed:', e));

            // Experimental: drag a file/text/link onto the character (see docs/drag-and-drop-investigation.md).
            const dropZone = new DropZone({
                actor, service: backpack, disposer,
                isEnabled: () => settings.get_boolean('drop-onto-character'),
                onReceived: () => controller.acknowledge(),
                onDragState: active => controller.holdForDrag(active),
                showMessage: (text, isError) => actor.showBubble(text, isError),
            });
            dropZone.start();

            backpack.start();
            controller.start(config);
            // Settings handlers: ids are kept and disconnected explicitly in _teardown() (called by disable()), so a repeated
            // enable/disable never accumulates duplicate callbacks.
            this._settings = settings;
            this._settingsSignalIds = [
                settings.connect('changed', () => controller.configure(readConfig(settings))),
                settings.connect('changed::character-name', () => backpackUI.refreshTitle()),
            ];
            environment.addKeybinding('summon-shortcut', settings, summonNow);
            environment.addKeybinding('backpack-shortcut', settings, () => backpackUI.open());

            log(`enabled #${this._cycle}; live: ${formatLive()}`);
        } catch (e) {
            console.error('[desktop-companion] enable() failed; cleaning up:', e);
            this._teardown();
            throw e;
        }
    }

    disable() {
        this._teardown();
    }

    _teardown() {
        const disposer = this._disposer;
        if (!disposer)
            return;
        this._disposer = null;
        if (this._settings) {
            for (const id of this._settingsSignalIds ?? [])
                this._settings.disconnect(id);
        }
        this._settingsSignalIds = null;
        this._settings = null;
        const released = disposer.dispose();
        log(`disabled #${this._cycle}; released: signals=${released.signals} ` +
            `timeouts=${released.timeouts} callbacks=${released.callbacks}; live: ${formatLive()}`);
    }
}
