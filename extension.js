// extension.js
//
// Lifecycle only. enable() builds one object graph owned by a fresh Disposer; disable() disposes it.
// Nothing is kept at module level except the cycle counter used for log messages.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Disposer, liveCounts} from './lib/disposer.js';
import {Environment} from './lib/environment.js';
import {CharacterActor, liveActorCount} from './lib/character/actor.js';
import {CharacterController} from './lib/character/controller.js';
import {CompanionMenu} from './lib/menu.js';
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
                    summon: summonNow,
                    home: () => controller.returnHome(),
                    set: (key, value) => settings.set_boolean(key, value),
                    settings: () => this.openPreferences(),
                },
            });
            disposer.add(() => menu.destroy(), 'destroy context menu');

            controller.start(config);
            disposer.connect(settings, 'changed', () => controller.configure(readConfig(settings)));
            environment.addKeybinding('summon-shortcut', settings, summonNow);

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
        const released = disposer.dispose();
        log(`disabled #${this._cycle}; released: signals=${released.signals} ` +
            `timeouts=${released.timeouts} callbacks=${released.callbacks}; live: ${formatLive()}`);
    }
}
