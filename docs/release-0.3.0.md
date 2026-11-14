# Release 0.3.0 (candidate)

## Verification status (read this first)
| Level | What | Result |
|---|---|---|
| **Real GNOME Shell 51.1** | **nothing.** No GNOME Shell was available to the author of this code. Every Shell-side behaviour below is unverified until you run `docs/test-plan-0.3.0.md` | not run |
| **Real, plain Node/Python (no GNOME, no mocks)** | `walk.test.mjs` 17, `model.test.mjs` 16, `name.test.mjs` 10, `intake.test.mjs` 9, `test_assets.py` 19 (pixel checks of the shipped atlas) | all pass |
| **Mocked (real project code, fake environment)** | `controller.test.mjs` 19, `service.test.mjs` 20 (Gio/GLib stand-ins), `dialog.test.mjs` 22 (strict St/Clutter/ModalDialog/clipboard stand-ins), `prefs.test.mjs` 10 (GTK/libadwaita stand-ins) | all pass |
| **Static** | syntax of every JS/shell/Python file, `glib-compile-schemas --strict`, packaging (`tools/package.sh`) | pass |

API names were checked against the real **51.1 tags of gnome-shell and mutter** (and GTK 4.24 / libadwaita 1.10 for the preferences window).
That is source reading, not runtime proof.

## 1. Support and GitHub links
* README: "Enjoying Bavi?" section (friendly, optional) with the exact URLs.
* Preferences window: **Support** group with a prominent **Buy Me a Coffee** button (coffee emoji in the row title) and a **View on GitHub**
  button, each with a copy-link button. Links are opened with `Gtk.UriLauncher` (no shell commands, no browser lookup); a failure shows a toast
  and the copy button still works. No popups, no prompts, nothing opened or written just by opening the window.
* `metadata.json` now has `"url"` (the GitHub repository, shown by the Extensions app).
* URLs live only in `lib/links.js`: `https://buymeacoffee.com/pradeeshkuamr` and `https://github.com/Pradeesh2007/bavi-gnome-companion`.

## 2. Optional character name
* New setting `character-name` (string, default `''`). **A fresh installation has no name** and nothing is shown in its place.
  There was no name setting in any earlier release, so there is no stored name to carry over for existing installations; they start unnamed too.
* Preferences window, group **Character name**: an entry with the placeholder exactly `Enter Name (Eg. Bavi)`, **Set Name**, **Clear**, and a row
  showing the current name or "No name set". The entry always starts empty so the placeholder is visible; Enter also sets the name.
* Validation (`lib/name.js`): trimmed, NFC-normalised, runs of spaces collapsed, empty rejected, at most 32 characters (code points), control,
  invisible, direction-control, private-use and malformed characters rejected. Names are plain text (markup disabled on the rows that show them).
  A stored value that fails validation (for example set with `gsettings`) is treated as unnamed.
* Use: the backpack title is `<Name>'s backpack` or just `Backpack`; the Hide/Pause rows and the preferences page title use the name or neutral
  wording ("the character", "Companion"). Messages from the backpack, the settings descriptions and the file chooser title no longer say "Bavi".
  Nothing else depends on a name. Internal identifiers, the UUID, file names and the README keep "Bavi" (the project and the developer's example).
* The name is stored in GSettings (dconf): local, survives restarts, no new dependency.

## 3. Dropping onto the character: not possible; Paste instead
See `docs/drag-and-drop-investigation.md` (evidence from the 51.1 sources). In short: GNOME Shell 51.1 / mutter 51.1 deliver no drop to a Shell
actor (no drop signal; a release over the compositor cancels the drag and unsets the data).

**Built instead: Paste** (backpack window, footer). When pressed it reads the clipboard once and classifies it (`lib/backpack/intake.js`, pure):
`text/uri-list` or `x-special/gnome-copied-files` with `file://` URIs -> files (stored **by reference**; the original is never copied, moved,
renamed or deleted, and a "cut" changes nothing); `http(s)` addresses -> links; a single-line http(s) text -> link; any other text -> note;
other schemes (`javascript:`, `data:`, `ftp:`, `smb:` ...), binary-looking text and over-size/over-long data are rejected with a reason.
It then uses the same service as every other way in (`service.receive()`): 12 slots, pocket 12, pocket expiry, duplicate checks, atomic save with rollback.
* **Full backpack / pocket:** nothing is replaced or discarded; the message names the limit and says the content is still on the clipboard; the
  destination button lets you try the pocket. Partly accepted batches store what fits and list the rest.
* **Feedback:** a message in the window (success or failure) and, when something was stored, the character gives her small click reaction
  (never while walking).
* **No clipboard monitoring:** the clipboard is read only inside the Paste click handler (tested: no read happens on open or afterwards).
* **Executables:** nothing is executed. References to program/script files can be stored, like with "Add file...", but they are never opened (Reveal only).
* Limits of Paste: only text and file lists are read (not images); very large clipboards are refused; a dropped item is not available as such.

## 4. Walking: grounded feet
What was wrong (measured on the approved frames with `tools/analyze-foot-contact.py`, read only):
* The planted foot moves backwards inside the frame by **about 0.43 x character height per cycle**, not the 0.56 estimated in 0.2.1
  (which came from the shoe separation). 0.2.1 therefore moved her about 30% faster than her own foot: she skated.
* Start sequence: she needs to advance only about 0.10 x height (0.2.1 assumed about 2.7 x that); stop sequence about 0.38 x height.
* **The drawings are unevenly spaced** (the artwork itself): in loop frames 5-7 the front foot stays at the same x inside the frame
  (about 522, 518, 516 px) and then moves 58, 109 and 103 px in frames 8-10 (source pixels). Any constant-speed movement makes that foot slide
  forward and then snap back. Stop frames 5-8 also show an inconsistent planted-foot motion (the tracker reports 89, 31, -12, -10 px).
* Baseline: the per-frame sole offsets from 0.2.1 were checked and are correct (the planted foot is the lowest foot in every frame); the vertical
  alignment is not the cause of the floating look.

What changed:
* `walk.json` has a measured `footTravel` per frame (runtime px) and `motion.footLock` (start 1.0, loop 0.7, stop 1.0). While frame *i* is shown the
  actor advances `(1 - footLock) * mean + footLock * footTravel[i]`; movement is now per-frame "root motion" instead of eased phases.
* The distances of the start, loop and stop sequences come from the data (no more guessed stride or travel frames).
* **Roaming walks are snapped to whole walking cycles** (scale exactly 1, no stretching); summon and return-home keep the exact target (stretched by
  `scale`, the only case that still slides, within 0.55..1.45, otherwise the 0.1 glide).
* An interrupted walk still finishes the current cycle, plays the stop sequence and stays inside the work area.

Measured effect (my tracker as the reference, display pixels at 240 px character height, worst window of up to 5 frames): planted-foot drift
**29.2 px (0.2.1) -> 20.7 px (constant speed at the measured stride) -> 11.0 px (shipped footLock 0.7)**. Guarded by `walk.test.mjs`. It is an estimate
from my own measurement, not an observation of the Shell.
* **It is not zero.** Because the drawings are unevenly spaced, a perfect foot lock (footLock 1) makes the body speed vary like the drawings
  (almost stopping for two frames, then 2x speed); 0.7 is a compromise. Tune `motion.footLock.loop` in `assets/walk/walk.json` (0.5 = smoother body,
  more skating; 0.9 = planted feet, pulsing body) after watching it.
* Ground speed implied by the art at 93 ms per frame and 240 px height is about 110 px/s (0.46 x height per second) instead of 0.6: she walks more slowly
  than in 0.2.1. A faster walk needs a shorter `frameMs` (cadence and speed scale together).
* **What would fix the rest: the art.** Frames loop05 to loop07 (planted front foot not travelling) and loop08 to loop10 (travelling 2x), and stop frames
  5 to 8, are where the spacing is uneven. Re-spacing those frames in the artwork would allow a footLock of 1 without a pulsing body.
  I did not touch the artwork.
* A contact shadow under her feet is a separate way to anchor a sprite to the desktop; not added (new visual element, not requested).

## 5. Files changed since the delivered 0.2.1 (exact diff)
Changed (19): `README.md`, `extension.js`, `prefs.js`, `metadata.json` (0.3.0, version 5, `url`), `schemas/org.gnome.shell.extensions.desktop-companion.gschema.xml`
(key `character-name`, neutral descriptions), `assets/walk/walk.json` (footTravel, footLock; no strideHeights/travelFrames), `lib/character/controller.js`
(root motion, snapped roams, `acknowledge()`), `lib/character/walk.js`, `lib/backpack/dialog.js` (name-aware title, Paste), `lib/backpack/service.js`
(`receive()`, shared `_addUris`), `lib/backpack/model.js` and `lib/backpack/portal.js` (neutral wording), `tools/build-walk-assets.py`,
`tests/{controller,dialog,service,walk}.test.mjs`, `tests/test_assets.py`, `tests/mocks/{gio,loader,st}.mjs`.
New (16): `lib/name.js`, `lib/links.js`, `lib/backpack/intake.js`, `lib/backpack/clipboard.js`, `tools/analyze-foot-contact.py`, `art-source/walk-foot-contact.json`,
`tests/{name,intake,prefs}.test.mjs`, `tests/mocks/{adw,gdk,gtk,extprefs,widget}.mjs`, `docs/{release-0.3.0,drag-and-drop-investigation}.md`
(and `docs/test-plan-0.3.0.md`).
Unchanged: `lib/character/actor.js`, `menu.js`, `environment.js`, `disposer.js`, backpack `store.js`, `assets/walk/walk.png` (byte-identical), the 42 approved
frames (SHA-256 verified), the idle sprites.

## 6. Expected counters (my expectation, not an observation)
`enabled #N; live:` right after enable: `signals=6 timeouts=3 callbacks=7 actors=1` (one more signal than 0.2.1: `changed::character-name`;
the third timeout is the 0.5 s texture preload). All zero after `disable()`.

## 7. Known limitations / unverified
Everything in the Shell: real appearance of the walk and the foot contact (the main thing to judge), whether the clipboard calls return what the mocks
assume (`St.Clipboard.get_mimetypes/get_content/get_text` with `text/uri-list`), the preferences window layout (the entry and two buttons inside one row),
`Gtk.UriLauncher` in the prefs process, the footer now holding six buttons, the walk start-up texture load. Click latency while walking is up to
about one cycle plus the stop sequence (about 3 s). Paste cannot read images. Names longer than 32 characters are refused, not shortened.
