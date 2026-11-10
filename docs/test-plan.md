# Phase 0 manual test plan

All tests run in the **isolated nested session**. Run the commands from the project directory.
Nothing here has been run yet; record the actual result next to each item.

Not covered and not claimed: lock screen, Overview, multiple monitors, monitor scaling, performance.

## 0. Preparation

1. Close heavy applications (browsers, IDEs). Check: `free -h`.
2. Dry run (no launch, only checks and cleanup):
   ```
   bash tools/nested-test.sh --dry-run
   ```
   Pass: it ends with "--dry-run given: all checks passed; nothing was launched." If it prints
   `REFUSING TO LAUNCH` or `ISOLATION NOT DEMONSTRATED`, stop and send me the output.
3. Launch (terminal 1, leave it open):
   ```
   bash tools/nested-test.sh
   ```
4. In terminal 2 (same project directory):
   ```
   bash tools/nested-ctl.sh status
   ```

## T1. Startup

* Terminal 1 shows `[inner] runtime isolation verified: only desktop-companion@pradeesh2007.github.io is enabled`.
* `status` shows the extension enabled and `hidden = false`.
* `bash tools/nested-ctl.sh logs` contains `started at A` and `enabled #1; live: signals=4 timeouts=2 callbacks=2 actors=1`.
* `bash tools/nested-ctl.sh errors` shows no `JS ERROR` or `CRITICAL` lines that mention the extension.
  Pass / fail: ______

## T2. Visibility and position

* A navy rounded rectangle with a teal border (about 56x72) is visible near the **bottom-left** of the nested screen,
  24 px from the left and bottom edges of the work area.
  Pass / fail: ______

## T3. Idle animation

* Watch for 10 s while it rests: it bobs up and down by a few pixels with a slow rhythm.
  Pass / fail: ______

## T4. Movement between two bounded positions

* About 4 s after start the log shows `moving A -> B`; the character glides right over about 2 s, then
  `arrived at B`; about 4 s later `moving B -> A`. Run `bash tools/nested-ctl.sh logs 20`.
* It never leaves the work area and never overlaps the screen edge (24 px margin).
  Pass / fail: ______

## T5. Single-click reaction

* Click the character once: it jumps and turns cream with a blush border for about 0.75 s; the log shows `click`.
* Click it five times quickly: no error, it ends in the normal colour and resting pose within about a second.
  Pass / fail: ______
* Optional reduced-motion check (isolated settings only):
  ```
  bash tools/nested-ctl.sh gsettings set org.gnome.desktop.interface enable-animations false
  ```
  Expect: no bobbing, instant moves, click = colour change only. Restore with `... enable-animations true`.
  Whether the Shell picks this up in the nested session is itself unverified. Pass / fail / n.a.: ______

## T6. Hide and show

* `bash tools/nested-ctl.sh hide`: the character disappears; log shows `hidden; timers and animations stopped`.
* Wait 15 s: **no** `moving` / `arrived` lines appear while hidden.
* `bash tools/nested-ctl.sh logs 5` then `bash tools/nested-ctl.sh status`: `hidden = true`.
* `bash tools/nested-ctl.sh show`: it reappears at the bottom-left or bottom-right rest position and resumes idling;
  log shows `shown`.
  Pass / fail: ______

## T7. Fullscreen behaviour

* Start an application inside the nested session (use any Wayland app you have, for example):
  ```
  bash tools/nested-ctl.sh launch gnome-terminal
  ```
  (`gnome-text-editor` also works; both support F11 for fullscreen. Revision 2 of `nested-ctl.sh` keeps your real locale for launched apps; revision 1 forced the C locale and made gnome-terminal exit with status 8.)
* Focus the app window in the nested window and press F11.
  Expected: the character is hidden while the app is fullscreen and visible again when you leave fullscreen.
* Also check that a click on the visible character still works after leaving fullscreen.
  Pass / fail: ______ (this directly tests the `trackFullscreen` assumption)

## T8. Disable and re-enable

* `bash tools/nested-ctl.sh disable`: the character disappears; the log shows
  `disabled #1; released: …; live: signals=0 timeouts=0 callbacks=0 actors=0`.
* `bash tools/nested-ctl.sh enable`: exactly **one** character appears (not two); log shows `enabled #2` with `actors=1`.
* `bash tools/nested-ctl.sh logs 10` and `errors`: no errors.
  Pass / fail: ______

## T9. Repeated cycles and cleanup

* ```
  bash tools/nested-ctl.sh cycle 25 2
  ```
  Expected: `cycle i/25 done` for each cycle, then `RESULT: PASS` from the leak check, and the RSS before/after
  lines within a few MiB of each other.
* Repeat with `cycle 50 1` if the first run is clean.
* `bash tools/nested-ctl.sh errors`: nothing new that mentions the extension. Revision 2 also lists `Clutter-WARNING` lines;
  `leakcheck` now reports how many `Spurious clutter_actor_allocate … desktop-companion-root` warnings are in the log (expected 0).
* After the cycles, re-enable: `bash tools/nested-ctl.sh enable`, confirm one character, click it once.
  Pass / fail: ______

## T9b. Stale-actor regression test (r3, needs `--debug`)

Start the session with `bash tools/nested-test.sh --debug-trace` (r4; `--debug` also works), then run, in order:
```
bash tools/nested-ctl.sh cycle 30 3
bash tools/nested-ctl.sh cycle 60 0.3
bash tools/nested-ctl.sh stalecheck
```
Expected: `RESULT: PASS`. Any `Spurious clutter_actor_allocate … desktop-companion-root` warning, or a root that is still in
the layout manager's tracking list after `removeChrome` (exact membership test in r4), is a **fail**. The global tracked count
is informational only. See
`docs/investigation-stale-root-warnings.md` for how to read the output and the extra pointer-on-character run.
Pass / fail: ______

## T10. Actor and timer cleanup, final check

* `bash tools/nested-ctl.sh disable` then `bash tools/nested-ctl.sh leakcheck`: `RESULT: PASS`.
* With the extension disabled, watch the log for 15 s: no further `moving` / `arrived` / `click` lines.
  Pass / fail: ______

## End the test

Close the nested window or press Ctrl+C in terminal 1. The runner removes its temporary directory and states whether
your live `enabled-extensions` setting is unchanged. The log is kept in `test-logs/`.

## What to send back

* The full output of `bash tools/nested-test.sh --dry-run`.
* The log file from `test-logs/` (or the output of `bash tools/nested-ctl.sh logs 200` and `errors`).
* The pass / fail line for each test above, plus anything that looked wrong on screen.
