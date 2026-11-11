// prefs.js
//
// Preferences window (runs in a separate process, not inside the Shell). Every control writes straight to
// the extension's GSettings keys; the running extension reacts to the changes immediately.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DesktopCompanionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;   // keep the Gio.Settings object alive as long as the window
        window.set_default_size(560, 720);

        const page = new Adw.PreferencesPage({title: 'Bavi', icon_name: 'preferences-system-symbolic'});
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
        switchRow(controls, 'Hide', 'Hide Bavi and stop all her activity.', 'hidden');
        switchRow(controls, 'Pause', 'Freeze her where she is.', 'paused');
        switchRow(controls, 'Quiet mode', 'Stay at home, no roaming or bobbing. She still reacts to clicks.', 'quiet-mode');
        switchRow(controls, 'Focus mode', 'Stay at home with her back to you, completely still.', 'focus-mode');

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
            subtitle: 'Corner of the primary monitor where she lives.',
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
            description: 'Write the accelerator the way the current value is written. Summon makes Bavi come to the ' +
                'pointer and shows her if she is hidden or paused. The backpack shortcut works even while she is hidden.',
        });
        page.add(keys);
        shortcutRow(keys, 'Summon Bavi', 'summon-shortcut');
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
    }
}
