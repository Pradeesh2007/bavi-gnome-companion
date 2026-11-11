# Release 0.2: backpack and notebook

**What has and has not been checked.**
* Checked here (Node, no GNOME): the whole inventory logic (`tests/model.test.mjs`, 16 tests) and the storage/service logic
  against hand-written stand-ins for `Gio`/`GLib` (`tests/service.test.mjs`, 14 tests). Every JS file passes a syntax check
  and the schema compiles with `glib-compile-schemas --strict`.
* **Not checked: anything that runs inside GNOME Shell**, the real Gio/GLib behaviour, the portal, the dialog, the menu entry,
  the preferences rows and the stylesheet. The stand-ins prove my logic, not that Gio behaves like them.
* Nothing from your 0.1.0 test run beyond the log in the last message is known; 0.2 contains the 0.1 character code unchanged
  (plus the menu entry, two Environment helpers and two extra keybinding/timer registrations).

## What it does
| Item | Behaviour |
|---|---|
| Backpack | 12 permanent slots; items stay until removed |
| Pocket | temporary area, 24 h by default (setting `pocket-expiry-hours`, 1 to 168), at most 12 items; expired items are removed when the extension starts, every 10 minutes, and whenever the list is read |
| Items | **file** (a reference to a local file), **note** (title + text, up to 20 000 characters), **link** (`http://` or `https://` only) |
| Keep | moves a pocket item into the lowest free slot; it no longer expires |
| Search | every word must occur (case-insensitive) in title, path, link, note text or kind (`file`, `note`, `link`) |
| Open / Reveal / Copy / Remove | files: Open (default app) and Reveal (file manager); links: Open and Copy; notes: View and Copy; Remove for all |
| Full backpack | a clear message (`The backpack is full (12 of 12 slots)…`); nothing is written; same for a full pocket |
| Duplicates | the same file path or link twice is refused (with "use Keep" when the first copy is in the pocket) |
| Where to open it | right-click menu → **Backpack…**, or the shortcut `<Super><Alt>i` (works while Bavi is hidden) |

## Design choices I made (you did not specify them; each is easy to change)
1. **Files are referenced, never copied.** Removing an item never touches the file. If the file moves or disappears, Open says
   so and you can remove the item.
2. **Notes and links use the same 12 slots and the same pocket as files.** HANDOFF section 2 lists "12 slots" and a
   "temporary pocket" without saying whether notes count; I did not build a separate notebook store.
3. **Pocket limit is 12 items** (the handoff gives no number; an unbounded pocket would be unbounded storage).
4. **New items go where you choose** with the "Adding to: Backpack / Pocket" button in the footer; nothing is routed silently.
5. **Removing a note asks for a second click** (its text exists nowhere else). Files and links are removed at once.
6. **Notes are plain text and cannot be edited** (delete and add again). No folders (a chosen folder is skipped with a reason).
7. **Shortcut `<Super><Alt>i`** is my pick; if it is taken, the log says `keybinding 'backpack-shortcut' could not be registered`.
8. **Double-click on Bavi is not wired.** The single-click gesture is unverified (0.1 test plan row 6) and I will not stack a second
   gesture on it before that is known.

## Safety rules implemented (and tested against the stand-ins)
* **Nothing is executed.** Files open only through the desktop's default handler for their content type. Refused: extensions
  `desktop sh bash zsh fish csh run appimage bin elf so exe msi bat cmd com scr ps1 vbs jar lnk application`, content types of
  executables/launchers/scripts, and files with an execute bit whose type is generic binary. Reveal is always allowed. Links must be
  `http(s)`; `file:`, `javascript:` and other schemes are rejected when saving.
* **No clipboard monitoring.** Copy only writes to the clipboard when you press Copy.
* **No data in the log**: only ids, kinds and counts.
* **Every change is saved at once, atomically** (`replace_contents` with `REPLACE_DESTINATION`, mode 0600). If saving fails the change is
  rolled back and the error shown. Stored data that cannot be read is renamed `inventory.json.corrupt-<time>` (never overwritten);
  invalid single items are left out and the original file is copied aside; a file from a **newer** format is not touched and the
  backpack reports itself unavailable instead of overwriting it.
* **Storage:** `<XDG data dir>/desktop-companion/inventory.json`, versioned (`"version": 1`). In the nested session the data dir is
  the temporary one, so your real data is not involved.

## Files
`lib/backpack/model.js` pure logic · `store.js` JSON file · `portal.js` FileChooser portal · `service.js` orchestration, expiry
timer, open/reveal · `dialog.js` the window (Shell ModalDialog + St). Changed: `extension.js`, `lib/environment.js`
(`currentTime`, `createLaunchContext`), `lib/menu.js` (Backpack… item), `prefs.js` (backpack rows; the shortcut row is now a helper;
the "Example: <Super><Alt>b" text was removed from the description because it is unknown whether libadwaita parses it as markup),
schema (+`backpack-shortcut`, +`pocket-expiry-hours`), `stylesheet.css`, `metadata.json` (0.2.0, version 3).

Expected live counters right after `enable()` (changed from 0.1): `signals=5 timeouts=2 callbacks=7 actors=1`
(+1 expiry timer, +service, +window, +second keybinding). All zero after `disable()`. These numbers are my expectation from reading the
code, not an observation.

## Unverified Shell/GJS assumptions (the nested test must settle each)
1. `ModalDialog` from `resource:///org/gnome/shell/ui/modalDialog.js`: constructor options `styleClass`/`destroyOnClose`,
   `contentLayout`, `setButtons([{label, action, key}])`, `setInitialKeyFocus()`, `open(timestamp)` returning false when the grab fails,
   `close()`, the `destroy` signal, Escape via a button's `key`.
2. St: `St.ScrollView` (`set_child`, `overlay_scrollbars`, policies), `St.Entry.clutter_text` (`set_single_line_mode(false)`,
   `set_line_wrap`, `set_activatable(false)`, `text-changed`, `activate`), `St.Button` `clicked`, `St.Clipboard`
   (`get_default().set_text(St.ClipboardType.CLIPBOARD, …)`), `destroy_all_children()`, Pango ellipsis through `clutter_text`.
3. Multi-line note entry: Enter inserts a newline and the scroll area follows the cursor. Uncertain.
4. CSS properties used in `stylesheet.css` (`min-width`, `height`, `spacing`, `border-radius`, rgba colours) and that the stylesheet is loaded.
5. `global.create_app_launch_context(0, -1)` and `Gio.AppInfo.launch_default_for_uri_async`.
6. Portal: the request path and `Response` signal as described in `portal.js`; `recursiveUnpack()` of `(ua{sv})` gives `[0, {uris: [...]}]`.
   In the nested session the portal service may run on the host (known tooling limit, HANDOFF section 1), so the chooser window may
   appear on your real desktop; it only returns file names.
7. `org.freedesktop.FileManager1.ShowItems` for Reveal (falls back to opening the folder).
8. `Gio.File.replace_contents` with a `Uint8Array`, `TextDecoder`/`TextEncoder` in the Shell process, `GLib.mkdir_with_parents`.
9. Opening the dialog 120 ms after a menu click is enough for the context menu to release its grab.
10. The shell's modal grab is released by `close()` so the portal window can take input (the reason "Add file" closes the dialog first).

## Known limitations
No double-click or drag-and-drop; no editing of notes; no reaction animation when an item is stored (no art); no notification when pocket
items expire; English only; primary monitor only; the 0.1 limitations (procedural walk, stale-actor warnings) are unchanged.
