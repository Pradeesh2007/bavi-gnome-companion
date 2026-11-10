# Release 0.1 test plan (isolated nested session)

Run every command from the project directory. Nothing here has been run yet; write the result next to each item.
Everything uses the isolated session; `tools/nested-ctl.sh set KEY VALUE` changes only the isolated settings.

Preparation: `bash tools/nested-test.sh --dry-run`, then `bash tools/nested-test.sh --debug-trace` (leave it open), and in a
second terminal `bash tools/nested-ctl.sh status`.

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Startup | log: `enabled #1; live: signals=5 … callbacks=4 … actors=1` and `started: height=240 home=bottom-left`; **no `JS ERROR`** (`ctl errors`) | |
| 2 | Appearance | Bavi (blue jacket, navy hair) stands at the bottom-left, about 240 px tall, facing right, sharp and undistorted; no magenta edge | |
| 3 | Idle | slow gentle bob | |
| 4 | Pointer look | move the mouse near her: she turns to front when it is above her, left when it is to her left, right when to her right; far away she faces her home direction | |
| 5 | Roaming | within about 10 s: log `walking …`; she turns through front, glides right with small hops, `arrived`; later walks home | |
| 6 | Click | click her: front pose and a jump; log `click`. Click while she is walking: she stops at her current spot (not a jump to a target) | |
| 7 | Right-click menu | menu opens with Come here, Go home, Pause, Quiet mode, Focus mode, Roam occasionally, Hide, Settings. Clicking outside closes it. If it does not open, send `ctl errors` | |
| 8 | Menu actions | Pause freezes her; Quiet mode sends her home and keeps her still; Focus mode shows her back; Hide hides her (`ctl show` brings her back with `bash tools/nested-ctl.sh set hidden false`) | |
| 9 | Settings keys | `set quiet-mode true` / `false`, `set roaming false`, `set pointer-look false`, `set character-height 360` (she resizes, stays at the bottom), `set home-corner bottom-right` (she moves to the right and faces left) | |
| 10 | Hide | `hide`: she disappears, log `hidden…`; no `walking` lines for 30 s; `show` brings her back | |
| 11 | Summon | focus the nested window and press `Super+Alt+B`: she walks to the pointer and jumps; log `summon`. If nothing happens look for `keybinding … could not be registered` in the log | |
| 12 | Overview | press `Super` in the nested window: she disappears while the Overview is open and returns after it closes (log `overview shown/hidden`) | |
| 13 | Fullscreen | `bash tools/nested-ctl.sh launch gnome-terminal`, press F11: she hides in fullscreen and returns afterwards | |
| 14 | Reduced motion | `bash tools/nested-ctl.sh gsettings set org.gnome.desktop.interface enable-animations false`, then `ctl disable` and `ctl enable`: log says `animations=false`; no bob or hops; moves are instant; the click reaction has no jump. Restore with `… true` | |
| 15 | Preferences | menu → Settings (or `gnome-extensions prefs desktop-companion@pradeesh2007.github.io`): the window opens with the avatar, switches, height, home position and shortcut; changing a switch changes her behaviour at once. The window may open on your real desktop but only edits the isolated settings | |
| 16 | Lifecycle | `ctl cycle 25 2` then `ctl leakcheck`: counters all zero after disable, RSS stable | |
| 17 | Stale-actor check | `ctl cycle 60 1` then `ctl stalecheck` (needs `--debug`): see `docs/investigation-stale-root-warnings.md` | |

Send back: pass/fail for each row, `ctl errors`, `ctl logs 200`, and for any failure the exact log lines and what you saw.
