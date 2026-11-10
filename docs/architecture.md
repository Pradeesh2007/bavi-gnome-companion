# Desktop Companion: Phase 0 architecture

> **Release 0.1 note:** the lifecycle, disposer and cleanup design below still apply unchanged. The actor and controller sections describe the Phase 0 placeholder; release 0.1 replaces them with sprite poses and the roaming state machine (see `docs/release-0.1.md`).

Status: Phase 0 prototype source. **Nothing in this document has been run on a GNOME Shell yet.**
Statements marked *(source)* come from the installed GNOME Shell 51.1 JavaScript read by the probe
scripts; statements marked *(unverified)* are assumptions that the nested tests must confirm.

## Scope

One placeholder character (an `St.Widget`) on the primary monitor that bobs while idle, glides between
two bounded positions, reacts visibly to one click, can be hidden and shown, and is fully cleaned up on
`disable()`. No artwork, storage, reminders, double-click, right-click, hover or drag.

## Layers and files

| Layer | File | Responsibility |
|---|---|---|
| Lifecycle | `extension.js` | `enable()` builds one object graph under a fresh `Disposer`; `disable()` disposes it. Logs cycle numbers and live-resource counters. |
| Resource ownership | `lib/disposer.js` | Tracks signal connections, GLib timeouts and cleanup callbacks; releases them in a fixed order; keeps process-wide live counters. |
| Shell integration | `lib/environment.js` | The only file that touches `Main`, `global` and `St.Settings`: work area, change signals, chrome add/remove, animation settings. |
| View | `lib/character/actor.js` | Builds and destroys the actors; small drawing primitives; no decisions. |
| Behaviour | `lib/character/controller.js` | Idle, move, click reaction and hide/show; no Shell or Clutter imports; every timer through the `Disposer`. |
| Presentation | `stylesheet.css` | Placeholder look and the "reacting" colour inversion. |
| Test control | `schemas/…gschema.xml` | One boolean key, `hidden`, so hide/show can be driven by script in the isolated session. Not a final preference. |

Dependencies point downward only: `extension.js` → controller, actor, environment, disposer;
the controller knows the actor and environment only by their method names.

## Actor structure and why

```
Main.layoutManager uiGroup
└─ root  (St.Widget, not reactive, no layout, sized to the primary work area, added with addChrome)
   └─ character  (St.Widget, reactive, 56x72, carries the ClickGesture)
```

* `root` is what the layout manager sees. With `trackFullscreen: true` the layout manager is expected to
  toggle its visibility when a window on its monitor is fullscreen *(source: `layout.js` lines ~184, 282,
  983–989 reference `trackFullscreen` and `monitor.inFullscreen`; the exact body was not read)*.
* The user-level hide/show toggles the `character` child, not `root`, so it cannot conflict with the layout
  manager's own visibility handling *(unverified assumption that the layout manager writes `root.visible`)*.
* The character's coordinates are relative to `root`, which covers the work area. That keeps the two bounded
  positions inside the work area by construction.

## Lifecycle and cleanup

`enable()` creates one `Disposer` and passes it to everything that owns resources. `disable()` calls
`dispose()`, which releases in this order:

1. all pending timeouts (so no callback fires during teardown),
2. all signal connections, newest first,
3. cleanup callbacks, newest first: controller stop (cancels timers, removes transitions), then actor destroy.

`CharacterActor.destroy()` order: remove transitions → remove the click action → `removeChrome(root)` →
`root.destroy()` (which destroys the character). It is idempotent and safe on a partially built instance.

Re-enabling creates a new `Disposer` and new actors; the old graph is unreachable and already destroyed. An
`enable()` call while already enabled is ignored with a log line.

Leak evidence: `extension.js` logs, on every enable and disable,
`live: signals=… timeouts=… callbacks=… actors=…`. After `disable()` all four must be `0`. Expected right after
a normal `enable()`: `signals=4 callbacks=2 actors=1`, with `timeouts` 2 while visible and 0 while hidden.
These counters prove the extension's own bookkeeping, not external leaks; `tools/nested-ctl.sh cycle` also
prints the nested Shell's resident memory before and after as a coarse external indicator.

## Behaviour (controller)

* `idle`: a repeating 900 ms timer eases `translation_y` between 0 and −4 px. Skipped when animations are off.
* After 4 s idle: `moving` to the other anchor over 1.8 s. Anchor A is bottom-left, B bottom-right of the
  primary work area, 24 px from the edges. If the work area is narrower than the character the anchors collapse
  into one position (still bounded).
* `click`: jump 28 px up (160 ms) and down (240 ms) plus the `desktop-companion-reacting` style class for about
  0.75 s. With animations off or reduced motion it is the colour change only (600 ms).
* `hidden`: cancels every timer, removes transitions, snaps to the resting pose, hides the character. Showing
  restarts idle.
* Work-area or monitor change: stop animations, finish any move at its target, recompute anchors, re-place.
* Movement and reaction steps are scheduled with timers sized to the animation durations; the code does not rely
  on animation completion callbacks.

## Shell APIs used and their evidence

| API | Used for | Evidence |
|---|---|---|
| `Extension` from `resource:///org/gnome/shell/extensions/extension.js` | base class, `getSettings()` | *(source)* `extensions/extension.js` line 7; `getSettings()` is standard base API *(unverified in the lines read)* |
| `Main.layoutManager.addChrome(actor, params)` | add `root` below popups | *(source)* `layout.js:878`: adds to `uiGroup`, below `top_window_group` |
| `{trackFullscreen: true}` | hide in fullscreen | *(source)* `layout.js:184,282,983`; default is `false` |
| `Main.layoutManager.removeChrome(actor)` | leave chrome | *(source)* `layout.js:938` exists; body not read *(unverified: assumed to untrack and remove from `uiGroup` without destroying)* |
| `Main.layoutManager.getWorkAreaForMonitor(i)`, `primaryIndex` | bounds | *(source)* `layout.js:1001`, `breakManager.js:1471` |
| `Main.layoutManager` signal `monitors-changed` | re-layout | *(source)* `layout.js:193,641` |
| `global.display` signal `workareas-changed` | re-layout | *(source)* `layout.js:103` |
| `St.Settings.get().enable_animations`, `.reducedMotion`, `St.ReducedMotion.REDUCE` | motion preference | *(source)* `animationUtils.js:28-30`, `boxpointer.js:86-87` |
| `Clutter.ClickGesture`, `'recognize'`, `actor.add_action()` | single click | *(source)* `appDisplay.js:2480-2487`, typelib has `ClickGesture` |
| `actor.ease({...})` | animation | *(source)* added in `environment.js:351`; parameters used: `x`, `y`, `translation_y`, `duration`, `mode` *(unverified in the lines read)* |
| `Clutter.AnimationMode.EASE_*_QUAD` | easing | typelib enum values confirmed |
| `actor.remove_all_transitions()`, `remove_action()`, `destroy()` | cleanup | typelib methods confirmed |
| `St.Widget.set_no_layout(true)` | container with fixed children | *(source)* used on `uiGroup`, `layout.js:219` |
| `St.Widget` methods `add_style_class_name`, `remove_style_class_name` | reaction look | typelib methods confirmed |

## Unverified assumptions (to be settled by the nested tests)

1. `trackFullscreen` hides `root` in fullscreen and shows it again afterwards, on the monitor it covers.
2. The layout manager toggles `root.visible`, so the character-level hide is independent of it.
3. `removeChrome` followed by `destroy()` leaves no stale tracking data (watch the log for errors).
4. `ClickGesture` fires `'recognize'` for a normal primary-button click on a reactive `St.Widget` in chrome,
   and a non-reactive full-size `root` does not swallow input meant for windows below it.
5. `stylesheet.css` is loaded automatically for the extension (standard behaviour; not seen in the source read).
6. `this.getSettings()` finds the compiled schema in the extension directory (`schemas/gschemas.compiled` is built
   by the test runner and by `tools/install.sh`).
7. `console.log` / `console.error` from an extension reach the nested Shell's output (and the journal in a live session).
8. In the nested session: the keyfile GSettings backend change notifications drive `changed::hidden`;
   `gnome-extensions list --enabled` prints one UUID per line; `GNOME_SHELL_SESSION_MODE=user` is honoured.
9. `gnome-shell --devkit --wayland --no-x11` is accepted. The runner checks that these three options appear in
   `gnome-shell --help` but cannot check their combined behaviour before launch.

## Not covered in Phase 0

Lock screen, Overview, multiple monitors, monitor scale changes, keyboard shortcut, pointer tracking, drag,
double-click, right-click, persistence, packaging for extensions.gnome.org.
