// lib/backpack/dialog.js
//
// The backpack window. Shell-facing (third module besides lib/environment.js and lib/menu.js): it uses the
// Shell's ModalDialog and St widgets and talks to lib/backpack/service.js for all data.
//
// Views (one dialog, content swapped):
//   list       search box, "Backpack" and "Pocket" sections, per-item buttons, footer with Add file / note / link
//   note-form  title + text, Save / Cancel
//   link-form  title + link, Save / Cancel
//   note-view  full text of one note, Copy / Back
//
// Notes on behaviour that came from design decisions:
//   * The Shell's modal grab blocks input to other windows, so "Add file" closes the dialog while the portal's
//     file chooser (a separate window) is open and reopens it with a result message afterwards.
//   * The search entry lives outside the swapped content, so typing never destroys the focused widget.
//   * Removing a NOTE asks for a second click (a note's text exists nowhere else). Files and links are only
//     references, so they are removed directly.
//   * Only the ModalDialog / St API names below are assumptions about Shell 51 (see docs/release-0.2.md).

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {formatRemaining, previewText, InventoryError, SLOT_COUNT, POCKET_LIMIT} from './model.js';

const log = (...args) => console.log('[desktop-companion]', ...args);

const KIND_LABEL = {file: 'File', text: 'Note', link: 'Link'};

export class BackpackUI {
    /**
     * @param {object} params
     * @param {import('./service.js').BackpackService} params.service
     * @param {import('../environment.js').Environment} params.environment
     * @param {() => number} params.getExpiryHours
     */
    constructor({service, environment, getExpiryHours}) {
        this._service = service;
        this._environment = environment;
        this._getExpiryHours = getExpiryHours;
        this._destroyed = false;

        this._dialog = null;
        this._dialogState = null;     // {destroyed: boolean} for the current dialog
        this._view = 'list';
        this._query = '';
        this._destination = 'backpack';
        this._status = null;          // {text, error}
        this._confirmId = null;       // note whose removal awaits a second click
        this._noteId = null;
        this._form = null;            // {title, body} entries of a form view
        this._search = null;
        this._statusLabel = null;
        this._countLabel = null;
        this._body = null;
    }

    /** Opens the backpack (or refreshes it when already open). */
    open(options = {}) {
        if (this._destroyed)
            return;
        if (options.status)
            this._status = options.status;
        if (this._dialog) {
            this._render();
            return;
        }

        try {
            const dialog = new ModalDialog.ModalDialog({styleClass: 'bavi-dialog', destroyOnClose: true});
            const state = {destroyed: false};
            dialog.connect('destroy', () => {
                state.destroyed = true;
                if (this._dialog === dialog)
                    this._forgetDialog();
            });
            this._dialog = dialog;
            this._dialogState = state;
            this._view = 'list';
            this._confirmId = null;
            this._buildFrame();
            this._render();
            dialog.setInitialKeyFocus(this._search.clutter_text);
            if (!dialog.open(this._environment.currentTime())) {
                log('backpack: the dialog could not take the Shell grab');
                this._teardownDialog(true);
                return;
            }
            log('backpack opened');
        } catch (e) {
            console.error('[desktop-companion] could not open the backpack:', e);
            this._teardownDialog(true);
        }
    }

    /** Called by the service when items expired while the window was open. */
    refresh() {
        if (this._dialog && this._view === 'list')
            this._renderList();
    }

    close() {
        this._teardownDialog(false);
    }

    destroy() {
        this._destroyed = true;
        this._teardownDialog(true);
    }

    // --- frame ---------------------------------------------------------------------------------

    _buildFrame() {
        const layout = this._dialog.contentLayout;

        const header = new St.BoxLayout({x_expand: true, style_class: 'bavi-header'});
        header.add_child(new St.Label({
            text: 'Bavi\u2019s backpack', style_class: 'bavi-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        }));
        this._countLabel = new St.Label({style_class: 'bavi-count', y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._countLabel);
        layout.add_child(header);

        this._search = new St.Entry({hint_text: 'Search the backpack and pocket', can_focus: true, x_expand: true, style_class: 'bavi-entry'});
        this._search.clutter_text.connect('text-changed', () => {
            this._query = this._search.get_text();
            this._confirmId = null;
            if (this._view === 'list')
                this._renderList();
        });
        this._query = '';
        layout.add_child(this._search);

        this._statusLabel = new St.Label({style_class: 'bavi-status', x_expand: true, visible: false});
        this._statusLabel.clutter_text.set_line_wrap(true);
        this._statusLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        layout.add_child(this._statusLabel);

        this._body = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'bavi-body'});
        layout.add_child(this._body);
    }

    _forgetDialog() {
        this._dialog = null;
        this._dialogState = null;
        this._search = null;
        this._statusLabel = null;
        this._countLabel = null;
        this._body = null;
        this._form = null;
    }

    /**
     * Closes the dialog. `immediate` also destroys it right away (used on shutdown and after errors);
     * otherwise destroyOnClose removes it when its fade-out ends.
     */
    _teardownDialog(immediate) {
        const dialog = this._dialog;
        const state = this._dialogState;
        this._forgetDialog();
        if (!dialog || state.destroyed)
            return;
        try {
            dialog.close();
        } catch (e) {
            console.error('[desktop-companion] closing the backpack failed:', e);
        }
        if (immediate && !state.destroyed) {
            try {
                dialog.destroy();
            } catch (e) {
                console.error('[desktop-companion] destroying the backpack failed:', e);
            }
        }
    }

    // --- views ---------------------------------------------------------------------------------

    _showView(view, noteId = null) {
        this._view = view;
        this._noteId = noteId;
        this._confirmId = null;
        this._render();
    }

    _render() {
        if (!this._dialog)
            return;
        this._body.destroy_all_children();
        this._form = null;
        this._search.visible = this._view === 'list';
        this._updateStatus();

        if (this._view === 'note-form' || this._view === 'link-form')
            this._renderForm(this._view === 'note-form');
        else if (this._view === 'note-view')
            this._renderNote();
        else
            this._renderList();
        this._renderButtons();
    }

    _renderList() {
        if (!this._dialog)
            return;
        const snap = this._service.snapshot(this._query);
        this._body.destroy_all_children();
        const c = snap.counts;
        this._countLabel.text = `${c.backpack}/${SLOT_COUNT} slots \u00b7 pocket ${c.pocket}/${POCKET_LIMIT}`;

        if (snap.unavailable) {
            this._setStatus(snap.unavailable, true);
            return;
        }

        const scroll = new St.ScrollView({
            style_class: 'bavi-scroll', x_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        const list = new St.BoxLayout({vertical: true, x_expand: true});
        scroll.set_child(list);
        this._body.add_child(scroll);

        const searching = this._query.trim() !== '';
        const section = (title, items, emptyText, now) => {
            list.add_child(new St.Label({text: title, style_class: 'bavi-section'}));
            if (items.length === 0) {
                list.add_child(new St.Label({text: searching ? 'No matches.' : emptyText, style_class: 'bavi-empty'}));
                return;
            }
            for (const item of items)
                list.add_child(this._buildRow(item, now));
        };
        section(`Backpack \u2014 ${c.backpack} of ${SLOT_COUNT} slots`, snap.backpack,
            'Empty. Add a file, note or link, or keep something from the pocket.', snap.now);
        section(`Pocket \u2014 ${c.pocket} of ${POCKET_LIMIT} \u00b7 items disappear after ${this._getExpiryHours()} h`,
            snap.pocket, 'Empty. Things you put here are temporary.', snap.now);
    }

    _buildRow(item, now) {
        const row = new St.BoxLayout({x_expand: true, style_class: 'bavi-row'});

        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({text: `${KIND_LABEL[item.kind]}  \u00b7  ${item.title}`, style_class: 'bavi-row-title'});
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        text.add_child(title);

        let detail;
        if (item.kind === 'file')
            detail = item.path;
        else if (item.kind === 'link')
            detail = item.url;
        else
            detail = previewText(item.text, 90);
        if (item.slot === null)
            detail += `   \u2014   expires in ${formatRemaining(item.expiresAt - now)}`;
        const sub = new St.Label({text: detail, style_class: 'bavi-row-sub'});
        sub.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
        text.add_child(sub);
        row.add_child(text);

        const buttons = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style_class: 'bavi-row-buttons'});
        const add = (label, handler) => {
            const button = new St.Button({label, style_class: 'button bavi-button', can_focus: true, reactive: true});
            button.connect('clicked', handler);
            buttons.add_child(button);
        };

        if (item.kind === 'file') {
            add('Open', () => this._run(() => this._service.openItem(item.id)));
            add('Reveal', () => this._run(() => this._service.revealItem(item.id)));
        } else if (item.kind === 'link') {
            add('Open', () => this._run(() => this._service.openItem(item.id)));
            add('Copy', () => this._copy(item.url, 'Link copied.'));
        } else {
            add('View', () => this._showView('note-view', item.id));
            add('Copy', () => this._copy(item.text, 'Note copied.'));
        }
        if (item.slot === null)
            add('Keep', () => this._run(() => {
                this._service.keep(item.id);
                return 'Moved to the backpack.';
            }));

        const confirming = this._confirmId === item.id;
        add(confirming ? 'Really remove?' : 'Remove', () => {
            if (item.kind === 'text' && !confirming) {
                this._confirmId = item.id;
                this._renderList();
                return;
            }
            this._run(() => {
                this._service.remove(item.id);
                return item.kind === 'file' ? 'Removed from the backpack. The file itself was not touched.' : 'Removed.';
            });
        });
        row.add_child(buttons);
        return row;
    }

    _renderForm(isNote) {
        const title = new St.Entry({hint_text: 'Title (optional)', can_focus: true, x_expand: true, style_class: 'bavi-entry'});
        this._body.add_child(title);

        let main;
        if (isNote) {
            main = new St.Entry({hint_text: 'Write your note here', can_focus: true, x_expand: true, style_class: 'bavi-entry'});
            const ct = main.clutter_text;
            ct.set_single_line_mode(false);
            ct.set_line_wrap(true);
            ct.set_activatable(false);
            const scroll = new St.ScrollView({
                style_class: 'bavi-note-scroll', x_expand: true, overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            scroll.set_child(main);
            this._body.add_child(scroll);
        } else {
            main = new St.Entry({hint_text: 'https://\u2026', can_focus: true, x_expand: true, style_class: 'bavi-entry'});
            this._body.add_child(main);
            main.clutter_text.connect('activate', () => this._saveForm());
        }
        this._form = {title, main, isNote};
        (isNote ? title : main).clutter_text.grab_key_focus();
    }

    _renderNote() {
        const snap = this._service.snapshot('');
        const note = [...snap.backpack, ...snap.pocket].find(i => i.id === this._noteId);
        if (!note) {
            this._showView('list');
            return;
        }
        this._body.add_child(new St.Label({text: note.title, style_class: 'bavi-section'}));
        const scroll = new St.ScrollView({
            style_class: 'bavi-note-scroll', x_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        const label = new St.Label({text: note.text, style_class: 'bavi-note-text', x_expand: true});
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        scroll.set_child(label);
        this._body.add_child(scroll);
    }

    _renderButtons() {
        const destLabel = this._destination === 'backpack'
            ? 'Adding to: Backpack' : `Adding to: Pocket (${this._getExpiryHours()} h)`;
        let buttons;
        if (this._view === 'note-form' || this._view === 'link-form') {
            buttons = [
                {label: 'Cancel', action: () => this._showView('list'), key: Clutter.KEY_Escape},
                {label: this._destination === 'backpack' ? 'Save to backpack' : 'Save to pocket', action: () => this._saveForm()},
            ];
        } else if (this._view === 'note-view') {
            const note = this._service.snapshot('');
            const item = [...note.backpack, ...note.pocket].find(i => i.id === this._noteId);
            buttons = [
                {label: 'Copy', action: () => item && this._copy(item.text, 'Note copied.')},
                {label: 'Back', action: () => this._showView('list'), key: Clutter.KEY_Escape},
            ];
        } else {
            buttons = [
                {label: 'Add file\u2026', action: () => this._addFiles()},
                {label: 'Add note', action: () => this._showView('note-form')},
                {label: 'Add link', action: () => this._showView('link-form')},
                {label: destLabel, action: () => {
                    this._destination = this._destination === 'backpack' ? 'pocket' : 'backpack';
                    this._renderButtons();
                }},
                {label: 'Close', action: () => this.close(), key: Clutter.KEY_Escape},
            ];
        }
        this._dialog.setButtons(buttons);
    }

    // --- actions -------------------------------------------------------------------------------

    _setStatus(text, error = false) {
        this._status = text ? {text, error} : null;
        this._updateStatus();
    }

    _updateStatus() {
        const label = this._statusLabel;
        if (!label)
            return;
        label.visible = this._status !== null;
        label.text = this._status?.text ?? '';
        label.style_class = this._status?.error ? 'bavi-status bavi-status-error' : 'bavi-status';
    }

    _errorText(e) {
        if (e instanceof InventoryError)
            return e.message;
        console.error('[desktop-companion] backpack action failed:', e);
        return `Unexpected error: ${e?.message ?? e}`;
    }

    /** Runs an action (sync or async) that returns a confirmation text; shows the result or the error. */
    async _run(action) {
        this._confirmId = null;
        try {
            const message = await action();
            this._setStatus(message ?? '', false);
        } catch (e) {
            this._setStatus(this._errorText(e), true);
        }
        if (this._dialog && this._view === 'list')
            this._renderList();
    }

    _copy(text, message) {
        try {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
            this._setStatus(message, false);
        } catch (e) {
            this._setStatus(`Could not copy: ${e.message}`, true);
        }
    }

    _saveForm() {
        const form = this._form;
        if (!form)
            return;
        try {
            const fields = {title: form.title.get_text()};
            const placed = this._destination === 'backpack' ? 'the backpack' : 'the pocket';
            if (form.isNote) {
                fields.text = form.main.get_text();
                this._service.addText(fields, this._destination);
                this._status = {text: `Note saved to ${placed}.`, error: false};
            } else {
                fields.url = form.main.get_text();
                this._service.addLink(fields, this._destination);
                this._status = {text: `Link saved to ${placed}.`, error: false};
            }
            this._showView('list');
        } catch (e) {
            this._setStatus(this._errorText(e), true);   // stay in the form so nothing typed is lost
        }
    }

    async _addFiles() {
        const destination = this._destination;
        // Release the Shell's modal grab: otherwise the portal's chooser window could not receive input.
        this._teardownDialog(false);
        let status;
        try {
            const result = await this._service.importFiles(destination);
            status = this._summarise(result, destination);
        } catch (e) {
            status = {text: this._errorText(e), error: true};
        }
        if (this._destroyed)
            return;
        this.open({status});
    }

    _summarise(result, destination) {
        if (result.cancelled)
            return null;
        const place = destination === 'backpack' ? 'the backpack' : 'the pocket';
        const parts = [];
        if (result.added.length)
            parts.push(`Added ${result.added.length} file${result.added.length === 1 ? '' : 's'} to ${place}.`);
        for (const s of result.skipped.slice(0, 3))
            parts.push(`Skipped ${s.name}: ${s.reason}`);
        if (result.skipped.length > 3)
            parts.push(`\u2026and ${result.skipped.length - 3} more skipped.`);
        if (parts.length === 0)
            return null;
        return {text: parts.join('\n'), error: result.added.length === 0};
    }
}
