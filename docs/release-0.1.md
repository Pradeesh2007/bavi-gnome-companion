# Release 0.1: character foundation (built from four reference images)

**Nothing here has been run on GNOME Shell.** The logic was simulated with mocks in a sandbox; every Shell, Clutter, St and
GTK call is untested on your machine. Statements tagged *(source)* come from the Shell 51.1 JavaScript read earlier,
*(typelib)* from the typelib probe, *(unverified)* are assumptions the nested test must confirm.

## Assets used
Resized from your four approved images (magenta edge halo removed) to 480 px tall, in `assets/`:

| File | Source image | Used for |
|---|---|---|
| `bavi_front.png` | `bavi_idle_front` | looking at you, turning, click and greeting reaction |
| `bavi_right.png` | `bavi_ref_l34` as uploaded (it faces right) | facing/looking/walking right |
| `bavi_left.png` | the same image mirrored | facing/looking/walking left |
| `bavi_back.png` | `bavi_ref_back` | **Focus mode** (her back to you) |
| `bavi_head.png` | `bavi_ref_head_neutral` | avatar in the preferences window |

## What is in 0.1
| Spec item | Status |
|---|---|
| Native extension, enable/disable lifecycle, no leaks by construction | Built on the Phase 0 `Disposer` |
| Character actor | Built: four PNG poses, one visible at a time |
| Idle | Built: slow bob (skipped when animations are off or in quiet/focus mode) |
| Walking | **Procedural**: a linear glide with small hops. There are no walk frames yet |
| Turning | Built: through the front pose (about 0.2 s) |
| Home position and bounded roaming | Built: bottom-left or bottom-right of the primary work area; roams up to 55% of the width, then returns home |
| Pointer interaction | Look toward the pointer (front / left / right), click reaction, right-click menu |
| Summon shortcut | Built: `<Super><Alt>b` by default; walks to the pointer, greets, goes home later |
| Quiet, Focus, Pause, Hide controls | Built (menu, preferences, GSettings) |
| Reduced motion | Built: no bob/hops, instant moves, reaction without a jump |
| Fullscreen | `trackFullscreen` from Phase 0 |
| Overview | The character hides while `Main.overview.visible`; checked by a 5 Hz heartbeat |
| Basic settings | Built: preferences window |
| Multi-monitor | Partial: primary monitor only; re-anchors when monitors or work areas change |
| Wave, sit (throne), sleep | **Not possible yet**: no art for them |
| Double-click, drag | **Not built**: the double-click target (the companion interface) does not exist yet, and the drag gesture API has not been verified |
| Keyboard Escape handling | Not applicable (no interface window yet) |

Design choices I made that you did not specify (easy to change): Focus mode shows her back; the right-click menu entries
(Come here, Go home, Pause, Quiet mode, Focus mode, Roam occasionally, Hide, Settings); default height 240 px;
default shortcut `<Super><Alt>b`; click reaction = turn to front plus a 28 px jump.

## Behaviour summary
* **Idle:** holds a pose, bobs gently, looks at the pointer when it is within about half the screen width.
* **Roaming:** about 6 s after start, then every 20 to 45 s at home: turn through front, glide to a point at least 15% of the
  width away, dwell 6 to 14 s, glide home. A click, summon or mode change interrupts a walk at its exact position.
* **Click:** front pose and a hop, then idle with a 12 s dwell before roaming resumes.
* **Hidden:** no timers at all. **Paused:** frozen. **Quiet:** goes home and stays still (still looks and reacts).
  **Focus:** goes home, shows her back, ignores the pointer (clicks still get a reaction).

## Settings (GSettings keys, schema `org.gnome.shell.extensions.desktop-companion`)
`hidden`, `paused`, `quiet-mode`, `focus-mode`, `roaming`, `pointer-look`, `character-height` (120 to 480),
`home-corner` (bottom-left or bottom-right), `summon-shortcut` (accelerator list).

## Architecture (changes since Phase 0)
* `lib/character/actor.js`: sprite actors (see its header). `lib/character/controller.js`: the state machine, no Shell imports.
* `lib/environment.js`: adds pointer, Overview and keybinding calls. `lib/menu.js`: the context menu.
* `extension.js`: reads GSettings into a config object, wires the menu, the shortcut and the `changed` signal.
* `prefs.js`: preferences window. `lib/disposer.js` and `lib/debug.js` are unchanged from r4.
* Expected live counters right after `enable()`: `signals=5` (two gestures, two work-area signals, settings) and
  `callbacks=4` (actor, controller, menu, keybinding), `actors=1`; all zero after `disable()`.

## Shell APIs used and their evidence
| API | Evidence |
|---|---|
| `Main.layoutManager.addChrome/removeChrome`, work area, `monitors-changed`, `workareas-changed` | *(source)* Phase 0 |
| `global.get_pointer()` | *(source)* used in `altTab.js`, `messageTray.js`, `panel.js` and others |
| `Main.overview.visible` | *(source)* `overview.js:133` getter |
| `Main.wm.addKeybinding(name, settings, flags, modes, handler)`, `removeKeybinding`, `Meta.KeyBindingAction.NONE` | *(source)* `windowManager.js:1106-1116`; flag and mode enums *(typelib)* |
| `Clutter.ClickGesture` with constructor properties, `'recognize'`, `add_action`, `remove_action` | *(source)* `appDisplay.js:2974-2979`; `required-button` property *(typelib)* |
| `this.openPreferences()` | *(source)* `extensions/extension.js:26` |
| `ease({translation_x/translation_y})` | works for `translation_y` in the Phase 0 run; `translation_x` *(unverified)* |

## Unverified assumptions (the nested test must confirm each)
1. An inline `background-image: url("file://…")` plus `background-size: Wpx Hpx` style on a `St.Widget` draws the PNGs.
2. `Clutter.BUTTON_PRIMARY` and `Clutter.BUTTON_SECONDARY` exist and a primary gesture does not fire for the right button.
3. The `PopupMenu` API calls in `lib/menu.js` (`PopupMenu`, `PopupMenuManager.addMenu/removeMenu`, `PopupSwitchMenuItem`,
   `PopupSeparatorMenuItem`, `addAction`, `addMenuItem`, `menu.actor`) are correct for 51 and the menu closes on an outside click.
4. `translation_x` eases linearly and `remove_all_transitions()` leaves the actor where the estimate says (the controller
   snaps to its own estimate after interrupting a walk).
5. The summon accelerator registers (a conflicting accelerator is logged, not fatal).
6. The preferences window (`prefs.js`, Libadwaita rows, `Gtk.accelerator_parse`) opens and its bindings work.
7. Whether the Overview draws above or below the chrome is not known; the heartbeat hides her either way.

## Known limitations
* Walking has no leg animation (a glide with hops); sitting, sleeping and waving are absent until their art exists.
* Pose changes are instant (no cross-fade).
* The clickable area is the whole sprite rectangle, including transparent corners.
* Menu and preferences strings are English only (no gettext yet).
* Primary monitor only.
* Resolution: sprites are 480 px tall; above that height they would be upscaled.
* **The stale-actor warnings from the Phase 0 investigation are not resolved.** 0.1 uses the same root/chrome lifecycle, so the
  same `Spurious clutter_actor_allocate … desktop-companion-root` warnings may appear after repeated enable/disable.
  The `--debug`, `--debug-trace` and `--debug-core` tools and `stalecheck` still apply.
