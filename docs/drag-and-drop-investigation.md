# Drag-and-drop onto the character: investigation (GNOME Shell 51.1, Wayland)

**Result: dropping files or text from another application onto a Shell actor is not possible with the APIs GNOME Shell 51.1
exposes to extensions. It was not implemented, and nothing in this release pretends otherwise.** The smallest viable alternative
(explicit Paste) is built; see `release-0.3.0.md`.

Method: the exact `51.1` tags of `gnome-shell` and `mutter` were cloned and read (github.com/GNOME). This is source reading, not a runtime
test: I could not run GNOME Shell. File and line numbers below refer to those tags.

## What the Shell gives an extension

| Question | Finding | Source |
|---|---|---|
| How do actors normally receive drops? | `acceptDrop` / `handleDragOver` on `actor._delegate`, called by `_Draggable`, which only handles drags that **started inside the Shell** (Dash icons, window previews, ...) | `js/ui/dnd.js:413-422` |
| What happens for a drag from another app? | The only consumer is `XdndHandler`, which connects exactly three `Meta.Dnd` signals and calls only `handleDragOver` on the actor under the pointer. It never calls `acceptDrop` and never reads data. | `js/ui/xdndHandler.js:21-23, 114-116` |
| Which signals does mutter offer? | `Meta.Dnd` defines only `dnd-enter`, `dnd-position-change`, `dnd-leave`. There is **no drop signal**. | `mutter src/compositor/meta-dnd.c:69-85` |
| When are they emitted on Wayland? | `dnd-enter` when a client drag starts (`meta_dnd_wayland_handle_begin_modal`), `dnd-position-change` on every pointer motion of the drag, `dnd-leave` when the drag grab ends (release **or** Escape: the same signal) | `src/wayland/meta-wayland-data-device.c:851, 575, 481` |
| What does mutter do when the button is released and **no client surface** is under the pointer (a Shell actor over the desktop)? | It cancels the drag (`success = FALSE`) and unsets the DND selection. Only a client surface that accepted, or a source offering `application/x-rootwindow-drop` (used by some Qt/KDE sources, not by GTK or GNOME Files), gets a successful drop. | `meta-wayland-data-device.c:629-647, 687, 735` |
| Is the dragged data readable? | The DND selection exists during the drag (`META_SELECTION_DND`, set at 914) but is dropped at release; there is no signal to read it at drop time. | `meta-wayland-data-device.c:914, 646, 735` |

## Consequence for the requirement

A file or text dragged from Files (or any GTK/GNOME application) onto Bavi would, on release, be **cancelled by the compositor**: the
source application shows a failed drop and nothing is delivered to the extension. An extension can observe that *a* drag started, where
the pointer is, and that it ended, but cannot learn whether it was dropped or cancelled, and gets no data at drop time.

## Alternatives considered

1. **Infer a drop** from `dnd-leave` + pointer over the character + button released, and read the DND selection at the last motion event.
   Not implemented: it depends on heuristics (release vs Escape, button state timing at the signal), the source application would still
   show a cancelled drag (the icon flies back), the original would be treated as "not moved", and it has no supported-API guarantee.
   Technically conceivable, not reliable, so rejected. It can be built later **only if you explicitly want an experimental mode**.
2. **A separate helper window** (a small GTK client process that is a real Wayland surface and can accept drops, placed over the
   character by the extension). It would work in principle, but it needs a second process, window placement and stacking tricks the Shell
   does not guarantee, input-region handling and its own lifecycle. That is an architectural change and was not started without your decision.
3. **Explicit Paste** (implemented): the user copies a file/text/link and presses Paste in the backpack. No polling, no monitoring; the
   clipboard is read once, on that click, through `St.Clipboard` (`get_mimetypes`, `get_content`, `get_text`, all present in 51.1).
   The "Add file..." portal chooser remains the other way to add files.

## Requirements of the brief that are therefore not met as written

* "Drag a local file from Files onto Bavi" / "drag text onto Bavi": **not possible**; replaced by Paste.
* "Bavi gives a small reaction": implemented for Paste (same reaction as a click, never interrupts a walk).
* Full backpack, validation, storage by reference, no execution, no clipboard monitoring: implemented in the shared receiving path.

---

# Update for 0.3.1: reinvestigation and the inference design

The 0.3.0 conclusion was re-checked against the same exact `51.1` tags (nothing was taken on trust), this time also looking for any supported hook
that could make the interaction possible. This is source reading only: **none of it has been run on a real GNOME Shell.**

## Final technical conclusion
1. **A real drop onto a Shell actor is impossible in GNOME Shell 51.1 / mutter 51.1 (Wayland).** Confirmed again: `Meta.Dnd` has no drop signal;
   the Shell's `XdndHandler` only calls `handleDragOver`; at button release with no client surface under the pointer mutter cancels the drag and unsets
   the DND selection (`meta-wayland-data-device.c:629-647`), and Escape does the same (`drag_grab_key`, lines 664-693). The source application is told the
   drag was cancelled.
2. **What an extension *can* observe with supported mechanisms:**

| Mechanism | What it gives | Source (51.1) |
|---|---|---|
| `Main.xdndHandler` signals `drag-begin` / `drag-end` | a drag from another application started / ended (ended = release **or** cancel) | `js/ui/xdndHandler.js:38, 51` |
| `actor._delegate.handleDragOver(source, ...)` | called for the reactive actor under the pointer on every motion of the external drag, i.e. hover over the character | `xdndHandler.js:114-116` |
| `DND.dragMonitors[i].dragMotion` | the same motion events for any actor (not used: the actor hook is enough) | `xdndHandler.js:104-105` |
| `global.display.get_selection()` + `Meta.Selection.transfer_async(SELECTION_DND, mimetype, maxSize, output, ...)` | the source's offered types and, while the drag is in progress, its data into a stream, with a **maximum size** | `mutter src/meta/display.h:273`, `meta-selection.h:54`, `meta-selection-source.h:30`; Wayland sources are read through `meta_wayland_data_source_send` (the same path `St.Clipboard` uses) |
| `global.get_pointer()` | pointer position and button mask | used throughout `js/ui` |
| a drop event | **does not exist** | `meta-dnd.c` defines three signals only |

3. **Therefore the closest technically sound alternative is drop inference** (implemented, experimental): hover is detected through the Shell's own hook, the
   data is read once while she is hovered (capped, only `text/uri-list` or plain text), and a drop is *inferred* when the drag ends with the pointer over her and the primary
   button released (still held = Escape = cancel; unknown state = no drop). Logic: `lib/dropdetect.js`; Shell part: `lib/dropzone.js`.
4. It is **not a real drop**: the source application always shows the drag as cancelled (for example Files snaps the icon back). Originals are never moved or deleted by
   it, because the drag really is cancelled; a text drag leaves the text where it was. It only reads data; it never writes to the source.

## What is NOT verified (the nested-session test must settle each)
* That GJS exposes `global.display.get_selection()` and `Meta.SelectionType.SELECTION_DND`: no Shell JS file uses them. `DropZone.start()` checks at runtime and disables itself if absent.
* That a source application serves its data to the compositor *during* the drag, while no target has accepted it (GTK and Qt should; Firefox, Chromium/Electron, XWayland clients are unknown).
* That the primary-button bit is already cleared in `global.get_pointer()` when `drag-end` fires on release (the inference depends on it; `unknown` is treated as "no drop").
* Which mime types real applications offer (Files: `text/uri-list`; browsers: link and text types). Only `text/uri-list` and four plain-text types are read.
* XWayland/X11 drags (`meta-xwayland-dnd.c` was not analysed; they may not reach these hooks).
* How the 250 ms hover window behaves with real pointer speeds.

If the inference proves unreliable the setting `drop-onto-character` can be turned off (preferences, or `ctl gsettings`), and **Paste** in the backpack remains the dependable path. Two heavier
alternatives were considered and not started: a separate GTK helper window as a real Wayland drop target (needs a second process and window placement the Shell does not guarantee), and
treating `application/x-rootwindow-drop` sources specially (only some Qt/KDE sources offer it).

## What was built, and safety rules
* Hover glow on her, a short message bubble for feedback, a small acknowledgement reaction, roaming held while any external drag is in progress (a walk already under way finishes).
* Payload: at most 256 KiB, read once per drag, into memory only, never executed; classified by `intake.js` (files by `file://` reference regardless of extension or MIME type, `http(s)` links,
  text as a note); other schemes, binary text and over-long text are rejected with a reason.
* Storage: the existing service and limits (12 slots, pocket 12, expiry, duplicate checks, atomic save). **Full backpack:** the item goes to the pocket with an explicit message
  ("press Keep to move it"); if the pocket is full too nothing is stored and nothing is replaced. One drag yields at most one decision, so it cannot be stored twice.
* Cleanup: both Shell signals are disconnected, the actor hook removed, the leave timer and any unfinished read cancelled, the glow cleared and the roaming hold released on disable.
