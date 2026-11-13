# Release 0.2.1 test plan: GNOME Shell 51.1 nested session

Nothing in this plan has been run. Use only the isolated nested session; do not touch your live session.

## Setup
```bash
cd ~/Projects/extention/desktop-companion          # your project directory
node tests/walk.test.mjs && node tests/model.test.mjs
node --import ./tests/mocks/register.mjs tests/service.test.mjs
node --import ./tests/mocks/register.mjs tests/dialog.test.mjs
node tests/controller.test.mjs
python3 tests/test_assets.py                        # needs python3, Pillow, numpy
bash tools/nested-test.sh --debug-trace             # leave this terminal open (nested Shell)
# second terminal:
bash tools/nested-ctl.sh status ; bash tools/nested-ctl.sh logs 200 ; bash tools/nested-ctl.sh errors
```
Send back per row: pass/fail, what you saw, and for failures `ctl errors` and `ctl logs 200`.

## A. Backpack window (the reported failure)
| # | Test | Expected | Result |
|---|---|---|---|
| A1 | Right-click Bavi, choose **Backpack…** | the window appears; log has `backpack opened`; **no** `could not open the backpack`, no `No property vertical` | |
| A2 | Press **Close**, open it again from the menu, repeat 3 times | opens every time, no errors in `ctl errors` | |
| A3 | Open, press **Esc** (nothing focused in a form) | window closes; opens again fine | |
| A4 | Open, **Add note**, empty Save | error `The note is empty.`, form stays; then type text, Save: back in the list with `Note saved to the backpack.` | |
| A5 | **Add link** with `example.org` then `https://example.org` | first gives an error mentioning http://, second saves | |
| A6 | Close and reopen after A4/A5 | the old `...saved...` message is **not** shown again | |
| A7 | Type in the search box | the list filters live; clearing restores it | |
| A8 | **Adding to:** button, add a note | it appears under Pocket with `expires in …` | |
| A9 | Remaining rows of `docs/test-plan-0.2.md` (rows 8 to 24) | as written there | |

## B. Walking animation
| # | Test | Expected | Result |
|---|---|---|---|
| B1 | Startup | log: `walking animation: 7/10/25 frames (start/loop/stop), 93/93/93 ms per frame`; `enabled #1; live: … timeouts=3 …` (3 only for 0.5 s); no `JS ERROR`; no `walking animation disabled` | |
| B2 | Watch the first roam (about 6 s after start) | log `walking A -> B (animated: start 7 + N x loop 10 + stop 25 frames, scale …)`; she starts from the idle pose without a visible pop, walks, slows and stops, then returns to idle without a pop; `arrived at B` | |
| B3 | Look closely | no green marks, no flicker, feet look planted, no sideways or vertical jump at the start/loop/stop joins; say where you see any | |
| B4 | Left-facing walk (`ctl set home-corner "'bottom-right'"` then wait) | she walks mirrored (left); the idle sprite and first walk frame line up | |
| B5 | Click her while she is walking | she keeps walking to the end of the current cycle, plays the stop sequence, then reacts (up to about 3 s later) | |
| B6 | Summon (`Super+Alt+B`) while she is in the stop sequence | the stop finishes, then she walks to the pointer; no frames overlap | |
| B7 | Summon from far away and from very close | far: animated walk; very close: log says `glide` and she glides as in 0.1 | |
| B8 | `ctl set quiet-mode true` mid-walk | she stops gracefully first, then goes quiet | |
| B9 | `ctl hide` mid-walk | she vanishes at once, no errors; `ctl show` brings her back idle | |
| B10 | Reduced motion: `bash tools/nested-ctl.sh gsettings set org.gnome.desktop.interface enable-animations false` (runs inside the isolated session only; set it back to `true` afterwards) | no walk frames, she appears at the target; log `animations off: no walk` | |
| B11 | `ctl cycle 25 2` then `ctl leakcheck` | all counters zero after disable; no `Spurious clutter_actor_allocate` warnings (compare with 0.1 findings) | |
| B12 | Leave it roaming for 10 minutes; note `bash tools/nested-ctl.sh memory` at start, after 1 minute and after 10 minutes | memory flat after the first minute | |
| B13 | Tuning: change `frameMs` to 70 in `assets/walk/walk.json`, restart | faster cadence and proportionally faster ground speed; say whether feet slide | |
