# Release 0.3.1 (candidate)

Chosen version: **0.3.1**, a candidate rather than a finished release. The scope is a fix (grounding), an experimental feature (drops onto the character) and extension-review
hardening; nothing here has been run on a real GNOME Shell, so it should not be called complete until `docs/test-plan-0.3.1.md` has been run. The 0.3.0 history is unchanged
(`docs/release-0.3.0.md`).

## Verification status (read this first)
| Level | What | Result |
|---|---|---|
| **Real GNOME Shell 51.1 runtime** | **nothing.** The author of this code had no GNOME Shell. Grounding, drops, clipboard, lifecycle and asynchronous loading are all unverified in the Shell. | **not performed** |
| **Automated tests of real project logic** (plain Node/Python, no mocks) | `walk` 17, `geometry` 5, `model` 16, `name` 10, `intake` 9, `dropdetect` 8 (incl. summary wording), `policy` 8 (source rules: clipboard, network, exec, URLs, I/O, logging), `test_assets.py` 22 (pixel checks of the atlas and sole alignment) | all pass |
| **Mocked tests** (real project code, fake environment) | `controller` 24, `service` 23, `dialog` 22, `prefs` 11, `dropzone` 14 (fake Shell, Meta.Selection, actor), `disposer` 5 (real Disposer, fake GLib/GObject), `walkassets` 3 | all pass |
| **Static checks** | syntax of every JS/shell/Python file, `glib-compile-schemas --strict`, valid JSON, packaging (`tools/package.sh`), `shexli` 0.2.1 on the ZIP | pass, except the two `shexli` items below |
| **Audit** | `shexli` on the packaged ZIP: **1 error (EGO-M-004, a tool limitation) and 1 manual-review item (EGO-A-005, clipboard)** | **not audit-clean**; see `docs/audit-0.3.1.md` |

A passing mocked test is not proof of GNOME Shell compatibility, and a passing static audit is not proof that the extension works.

## 1. Why she floated, and what changed
Measured, not guessed:
| Suspect | Measurement | Verdict |
|---|---|---|
| Transparent padding under the soles in the artwork | idle sprites: 0-1 empty rows under the sole; walk frames after their baseline offsets: 478.1 to 479.4 of 479 | **not the cause** (artwork untouched) |
| Walk-frame baseline offsets | all frames within 1.3 px of the frame bottom; the standing frames (offset 0) end on the same row as the idle sprite | correct |
| Actor placement | `controller.js`: `baseY = area.height - h - MARGIN` with `MARGIN = 24`, a constant meant for the **side** edges, also applied to the **floor** | **main cause**: a 24 px gap, 10% of her height at 240 px, 20% at 120 px |
| Idle bob | `translation_y` of up to 3 px every 1.8 s | **second cause**: her feet left the floor while standing |
| Frame-to-frame foot sliding during the walk | already addressed in 0.3.0 (root motion from the measured foot travel) | unchanged |

Changes:
* `lib/character/geometry.js` (pure): `layoutBounds()` with `SIDE_MARGIN = 24` for the sides and `FLOOR_INSET = 0`: the sprite box is flush with the bottom of the work area (the visible
  desktop floor), recomputed on height and work-area changes.
* Idle "bob" is replaced by **breathing about the feet**: `scale_y` 1 to 1.008 with the pivot at the soles, so they never move; stopping an animation resets the scale.
* The `started:` log line now reports `floor: sprite box bottom N of M` so the nested run can check it numerically.
* No arbitrary offset and no artwork change. Left/right, scaling and work-area changes use the same function.
* Remaining (not changed): the click reaction and the 0.1 glide fallback (used only without walking assets or for very short walks) still hop by design.
Tests: `geometry.test.mjs`, four new controller tests (corners, heights 120 to 480, work-area change, no vertical translation while standing or walking), asset checks. **The four controller tests fail on the 0.3.0 controller** (it places the box 24 px above the floor) and pass now.

## 2. Dropping onto the character (experimental)
Final conclusion (details and evidence: `docs/drag-and-drop-investigation.md`): **a real drop onto a Shell actor is not possible in GNOME Shell 51.1 / mutter 51.1.** It was reinvestigated, not assumed.
Built instead, from the supported pieces only (the Shell's `handleDragOver` hook, `drag-begin`/`drag-end`, `Meta.Selection` with a size cap, `global.get_pointer()`): **drop inference**.
* While an external drag hovers her she glows; the dragged data (`text/uri-list` or plain text, at most 256 KiB) is read once, into memory.
* A drop is inferred only if the drag ends with the pointer over her and the primary button released (held = Escape = cancel; unknown = no drop). One decision per drag.
* Storage reuses the existing intake and service: files by reference (any extension or type, never copied, moved, renamed, deleted or executed), selected text as a note, `http(s)` as a link, the existing limits, expiry and duplicate checks.
  **Full backpack:** the item goes to the pocket with an explicit message; with the pocket full nothing is stored and nothing is replaced. Multiple files: partial acceptance is reported per item.
* Feedback: a message bubble above her, an acknowledgement reaction on success; roaming is held while any external drag is in progress.
* Setting `drop-onto-character` (default on, preferences switch "Accept drags onto the character (experimental)"). Paste in the backpack remains the dependable fallback and is unchanged.
* **Not real drag-and-drop:** the source application always shows the drag as cancelled. Not verified: that GJS exposes `Meta.Selection`, that sources serve data during the drag, that the button bit is cleared at `drag-end`, XWayland sources, browser mime types.
  `DropZone.start()` checks the API at runtime and disables itself if it is missing.
Mocked tests cover: hover, release, Escape, release elsewhere, never hovered, stale hover, release before the data is read, unsupported/oversized/binary/rejected payloads, every file type by content, text, links, full backpack, partial acceptance, one-decision-per-drag, repeated drags, the setting off, disabling mid-drag, 25 enable/disable cycles.
They are **not** real drag-and-drop verification.

## 3. Extension-review (shexli) fixes
Full account in `docs/audit-0.3.1.md`. Summary:
* **Logging (EGO-A-004):** `lib/log.js`: genuine failures always (`errorLog`), operational chatter only with `DESKTOP_COMPANION_DEBUG` (`debugLog`). Nothing was silenced that a user needs.
* **Synchronous I/O (EGO-X-004):** the backpack file and the walking assets are read asynchronously with cancellation. New explicit *loading* state in the service and window. The atomic save, `mkdir` and per-file `query_info` stay synchronous (documented, small).
* **Signals (EGO-L-003):** the settings handlers are connected with stored ids and disconnected in `disable()`; the Disposer's behaviour verified by a real test (25 cycles); `prefs.js` disconnects on close.
* **Compiled schema (EGO-P-006, ZIP only):** no longer shipped (validated only); the Shell's installers compile it.
* **`shell-version` (EGO-M-004):** unchanged `["51"]`; the error is the tool's hard-coded limit (major > 50), not a metadata problem. Not worked around.
* **Clipboard (EGO-A-005):** kept (Paste reads, Copy writes, both on click), scoped, verified by `policy.test.mjs`, and declared in the metadata description.

## 4. Clipboard behaviour and disclosure
* **Paste** reads the clipboard once, only when pressed. **Copy** writes only when pressed. No monitoring, polling or change listener; no network or process APIs in the extension; no default shortcut touches the clipboard.
* `metadata.json` description (345 characters): "Bavi, an animated anime desktop companion with a small backpack for files, notes and links. Privacy: the clipboard is read only when you press Paste in the backpack (and written only when you press Copy); it is never monitored or polled, and nothing is sent anywhere. Items you drag over the character are read only while you hold them over her."
* README has a "Privacy and clipboard behaviour" section.

## 5. Documentation
`README.md` (0.3.1 overview, kept 0.3.0 history, **Future Features** section with every requested idea labelled as planned or under consideration, corrected stale sections and code fences, support and GitHub links kept),
`docs/release-0.3.1.md`, `docs/test-plan-0.3.1.md`, `docs/drag-and-drop-investigation.md` (0.3.0 text kept, 0.3.1 update appended), `docs/audit-0.3.1.md`, `docs/architecture-animation-roadmap.md` (the hybrid animation plan; **not implemented**).

## 6. Files changed since the delivered 0.3.0 (exact diff)
New (16): `docs/architecture-animation-roadmap.md`, `docs/audit-0.3.1.md`, `docs/release-0.3.1.md`, `docs/test-plan-0.3.1.md`, `lib/backpack/summary.js`, `lib/character/geometry.js`, `lib/dropdetect.js`, `lib/dropzone.js`, `lib/log.js`,
`tests/{disposer,dropdetect,dropzone,geometry,policy,walkassets}.test.mjs`, `tests/mocks/{dnd,main,meta}.mjs`.
Changed (23): `README.md`, `docs/drag-and-drop-investigation.md`, `extension.js`, `metadata.json` (0.3.1, version 6, new description), `prefs.js`, `schemas/*.gschema.xml` (key `drop-onto-character`), `stylesheet.css`, `lib/backpack/{dialog,service,store}.js`,
`lib/character/{actor,controller,walkassets}.js`, `tools/package.sh`, `tests/{controller,dialog,prefs,service}.test.mjs`, `tests/test_assets.py`, `tests/mocks/{clutter,gio,glib,loader}.mjs`.
Unchanged: the 42 approved frames (SHA-256 checked), the idle sprites, `assets/walk/*`, `lib/character/walk.js`, `menu.js`, `environment.js`, `disposer.js`, `lib/backpack/{model,intake,portal,clipboard}.js`.

## 7. Expected counters (my arithmetic from the code, not an observation)
`enabled #N; live:` right after enable: `signals=6 timeouts=2 callbacks=9 actors=1` (signals: environment 2, gestures 2, drop zone 2; the settings handlers are no longer Disposer-tracked; callbacks gained the
asset-load cancel and the drop-zone teardown; the 0.5 s texture preload now starts when the asynchronous asset load completes, so it is not yet counted at that line). All zero after `disable()`.

## 8. Known limitations
Everything in section 2's "not verified" list; click latency while walking (up to about one cycle plus the stop sequence); remaining walk skating where the drawings are unevenly spaced (`docs/release-0.3.0.md` section 4);
the synchronous save; the dev-only `tools/install.sh` and `tests/` warnings if the whole project directory is audited; `shexli` 0.2.1 not knowing GNOME 51.
