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
