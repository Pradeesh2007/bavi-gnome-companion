// prefs.js
//
// Preferences window (runs in a separate process, not inside the Shell). Every control writes straight to
// the extension's GSettings keys; the running extension reacts to the changes immediately.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GITHUB_URL, SUPPORT_URL} from './lib/links.js';
import {MAX_NAME_LENGTH, NAME_PLACEHOLDER, normalizeName, storedName, whoLabel} from './lib/name.js';

/** Opens a web link with GTK's launcher API (no shell commands). On failure a toast says so; the copy button remains. */
function openLink(window, url) {
    const fail = e => window.add_toast(new Adw.Toast({
        title: `Could not open the link (${e?.message ?? e}). You can copy it with the button next to it.`,
        timeout: 6,
    }));
    try {
        Gtk.UriLauncher.new(url).launch(window, null, (launcher, result) => {
            try {
                launcher.launch_finish(result);
            } catch (e) {
                let dismissed = false;
                try {
                    dismissed = e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED);
                } catch (_) {
                    // not a Gtk.DialogError: report it
                }
                if (!dismissed)
                    fail(e);
            }
        });
    } catch (e) {
        fail(e);
    }
}

function copyLink(window, url) {
    try {
        Gdk.Display.get_default().get_clipboard().set_text(url);
        window.add_toast(new Adw.Toast({title: 'Link copied.', timeout: 2}));
    } catch (e) {
        window.add_toast(new Adw.Toast({title: `Could not copy the link: ${e?.message ?? e}`, timeout: 4}));
    }
}

export default class DesktopCompanionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;   // keep the Gio.Settings object alive as long as the window
        window.set_default_size(560, 720);

        // The character has no name unless the user chose one; wording stays neutral until then.
        const currentName = () => storedName(settings.get_string('character-name'));
        const page = new Adw.PreferencesPage({title: currentName() || 'Companion', icon_name: 'preferences-system-symbolic'});
        window.add(page);

        // Avatar
        const avatarGroup = new Adw.PreferencesGroup();
        const avatar = Gtk.Picture.new_for_filename(`${this.path}/assets/bavi_head.png`);
        avatar.set_size_request(140, 140);
        avatar.set_halign(Gtk.Align.CENTER);
        avatarGroup.add(avatar);
        page.add(avatarGroup);

        const switchRow = (group, title, subtitle, key) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            return row;
        };

        // Controls
        const controls = new Adw.PreferencesGroup({title: 'Controls'});
        page.add(controls);
        const nameRows = [];   // [row, text builder]: subtitles that mention the character, refreshed when the name changes
        const named = (row, build) => { nameRows.push([row, build]); row.subtitle = build(whoLabel(currentName())); return row; };
        named(switchRow(controls, 'Hide', '', 'hidden'), who => `Hide ${who} and stop all activity.`);
        named(switchRow(controls, 'Pause', '', 'paused'), who => `Freeze ${who} in place.`);
        switchRow(controls, 'Quiet mode', 'Stay at home, no roaming or bobbing. Clicks still get a reaction.', 'quiet-mode');
        switchRow(controls, 'Focus mode', 'Stay at home, facing away, completely still.', 'focus-mode');

        // Behaviour
        const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
        page.add(behaviour);
        switchRow(behaviour, 'Roam occasionally', 'Walk away from home now and then and come back.', 'roaming');
        switchRow(behaviour, 'Look toward the pointer', 'Turn toward the pointer when it is near.', 'pointer-look');

        // Appearance
        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearance);

        const heightRow = new Adw.SpinRow({
            title: 'Height',
            subtitle: 'Logical pixels on screen.',
            adjustment: new Gtk.Adjustment({
                lower: 120, upper: 480, step_increment: 10, page_increment: 40,
                value: settings.get_int('character-height'),
            }),
        });
        settings.bind('character-height', heightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(heightRow);

        const corners = ['bottom-left', 'bottom-right'];
        const cornerRow = new Adw.ComboRow({
            title: 'Home position',
            subtitle: 'Corner of the primary monitor that is home.',
            model: new Gtk.StringList({strings: ['Bottom left', 'Bottom right']}),
            selected: Math.max(0, corners.indexOf(settings.get_string('home-corner'))),
        });
        cornerRow.connect('notify::selected', () => {
            settings.set_string('home-corner', corners[cornerRow.selected]);
        });
        appearance.add(cornerRow);

        // Shortcuts
        const shortcutRow = (group, title, key) => {
            const row = new Adw.EntryRow({title, show_apply_button: true});
            row.set_text(settings.get_strv(key)[0] ?? '');
            row.connect('apply', () => {
                const text = row.get_text().trim();
                const [ok] = Gtk.accelerator_parse(text);
                if (ok) {
                    row.remove_css_class('error');
                    settings.set_strv(key, [text]);
                } else {
                    row.add_css_class('error');
                }
            });
            group.add(row);
        };

        const keys = new Adw.PreferencesGroup({
            title: 'Shortcuts',
            description: 'Write the accelerator the way the current value is written. Summon makes the character come to the ' +
                'pointer and shows it if it is hidden or paused. The backpack shortcut works even while it is hidden.',
        });
        page.add(keys);
        shortcutRow(keys, 'Summon', 'summon-shortcut');
        shortcutRow(keys, 'Open the backpack', 'backpack-shortcut');

        // Backpack
        const backpackGroup = new Adw.PreferencesGroup({
            title: 'Backpack',
            description: 'Items in the backpack\u2019s 12 slots stay until you remove them. Items in the pocket disappear ' +
                'after this time. Changing it affects items added from now on. Files are only referenced: removing ' +
                'an item never deletes the file.',
        });
        page.add(backpackGroup);
        const expiryRow = new Adw.SpinRow({
            title: 'Pocket lifetime',
            subtitle: 'Hours before a pocket item disappears.',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 168, step_increment: 1, page_increment: 12,
                value: settings.get_int('pocket-expiry-hours'),
            }),
        });
        settings.bind('pocket-expiry-hours', expiryRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        backpackGroup.add(expiryRow);

        // Character name (optional). The entry always starts empty so its placeholder is visible; the current name is
        // shown in the row above it. Names are validated by lib/name.js. Rows use plain text, never markup.
        const nameGroup = new Adw.PreferencesGroup({
            title: 'Character name',
            description: 'Optional. You can give your companion a name; it is used in the backpack and character-facing text. ' +
                'You can change or clear it at any time. Nothing depends on having a name.',
        });
        page.add(nameGroup);
        const nameStatus = new Adw.ActionRow({title: 'Current name', use_markup: false});
        nameGroup.add(nameStatus);
        const nameInput = new Adw.ActionRow({title: 'Name', use_markup: false, activatable: false});
        const nameEntry = new Gtk.Entry({
            placeholder_text: NAME_PLACEHOLDER, max_length: MAX_NAME_LENGTH, width_chars: 22, valign: Gtk.Align.CENTER,
        });
        const setButton = new Gtk.Button({label: 'Set Name', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        const clearButton = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
        nameInput.add_suffix(nameEntry);
        nameInput.add_suffix(setButton);
        nameInput.add_suffix(clearButton);
        nameGroup.add(nameInput);

        const showNameError = message => {
            nameInput.subtitle = message ?? '';
            if (message)
                nameEntry.add_css_class('error');
            else
                nameEntry.remove_css_class('error');
        };
        const refreshNames = () => {
            const name = currentName();
            nameStatus.subtitle = name || 'No name set';
            clearButton.sensitive = name !== '';
            page.title = name || 'Companion';
            for (const [row, build] of nameRows)
                row.subtitle = build(whoLabel(name));
        };
        const setName = () => {
            const result = normalizeName(nameEntry.get_text());
            if (!result.ok) {
                showNameError(result.message);
                return;
            }
            showNameError(null);
            settings.set_string('character-name', result.name);
            nameEntry.set_text('');
        };
        setButton.connect('clicked', setName);
        nameEntry.connect('activate', setName);
        nameEntry.connect('changed', () => showNameError(null));
        clearButton.connect('clicked', () => {
            showNameError(null);
            nameEntry.set_text('');
            settings.set_string('character-name', '');
        });
        settings.connect('changed::character-name', refreshNames);
        refreshNames();

        // Support
        const supportGroup = new Adw.PreferencesGroup({
            title: 'Support',
            description: 'This is an independently developed open-source project. If it makes your desktop a little more ' +
                'enjoyable, consider supporting its continued development with a coffee. No pressure at all; using it is ' +
                'already appreciated.',
        });
        page.add(supportGroup);
        const linkRow = (title, subtitle, url, buttonLabel, suggested) => {
            const row = new Adw.ActionRow({title, subtitle, use_markup: false});
            const open = new Gtk.Button({
                label: buttonLabel, valign: Gtk.Align.CENTER, css_classes: suggested ? ['suggested-action'] : [],
                tooltip_text: url,
            });
            open.connect('clicked', () => openLink(window, url));
            const copy = new Gtk.Button({
                icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: 'Copy link',
            });
            copy.connect('clicked', () => copyLink(window, url));
            row.add_suffix(copy);
            row.add_suffix(open);
            row.set_activatable_widget(open);
            supportGroup.add(row);
        };
        linkRow('\u2615 Buy me a coffee', 'Support the continued development of this project.', SUPPORT_URL, 'Buy Me a Coffee', true);
        linkRow('Source code on GitHub', 'Explore the code, follow development and contribute.', GITHUB_URL, 'View on GitHub', false);
    }
}
