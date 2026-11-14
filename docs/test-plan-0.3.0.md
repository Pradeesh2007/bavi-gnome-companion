# Release 0.3.0 test plan: GNOME Shell 51.1 nested session

Nothing in this plan has been run. Use only the isolated nested session; do not touch your live session.

## Setup
```bash
cd ~/Projects/extention/desktop-companion
node tests/walk.test.mjs && node tests/model.test.mjs && node tests/name.test.mjs && node tests/intake.test.mjs
node tests/controller.test.mjs
for t in service dialog prefs; do node --import ./tests/mocks/register.mjs tests/$t.test.mjs; done
python3 tests/test_assets.py                        # needs python3, Pillow, numpy
bash tools/nested-test.sh --debug-trace             # leave open (nested Shell)
# second terminal:   bash tools/nested-ctl.sh status | logs 200 | errors | memory | gsettings ...
```
Send back per row: pass/fail, what you saw, and for failures `ctl errors` and `ctl logs 200`.

## A. Links (preferences window: right-click Bavi, Settings)
| # | Test | Expected | Result |
|---|---|---|---|
| A1 | Open Settings | a **Support** group with a coffee row and a GitHub row; nothing opens by itself | |
| A2 | Click **Buy Me a Coffee** | your browser opens `https://buymeacoffee.com/pradeeshkuamr` (say which session/display it opened in) | |
| A3 | Click **View on GitHub** | opens `https://github.com/Pradeesh2007/bavi-gnome-companion` | |
| A4 | The copy-link buttons | paste somewhere: the exact URL; a failure to open shows a toast and no error in `ctl errors` | |

## B. Character name
| # | Test | Expected | Result |
|---|---|---|---|
| B1 | Fresh settings: `ctl gsettings get org.gnome.shell.extensions.desktop-companion character-name` | `''`; Settings shows "No name set"; the page title is "Companion"; the backpack title is "Backpack" | |
| B2 | Click into the name entry | the placeholder reads exactly `Enter Name (Eg. Bavi)` | |
| B3 | Type `  Mika  `, press **Set Name** (and try Enter) | saved as `Mika`; the row shows Mika; Clear becomes enabled; the backpack title becomes `Mika's backpack` (also while the backpack is open) | |
| B4 | `bash tools/nested-ctl.sh disable`, then `enable` (the isolated session's settings persist; a real logout/reboot cannot be tested here) | the name is still there | |
| B5 | Try an empty name, 40 characters, and a name with a pasted invisible/control character | each is rejected with a message; nothing saved | |
| B6 | Change the name to `Rin`, then **Clear** | the setting returns to `''`, wording is neutral again, she keeps working | |
| B7 | With no name, use the menu, backpack, roaming, click | everything works; no fabricated name appears anywhere | |

## C. Paste into the backpack (and the drag-and-drop limitation)
| # | Test | Expected | Result |
|---|---|---|---|
| C1 | Select text in any app, copy it, open the backpack, press **Paste** | a note is added; message `Added 1 note to the backpack.`; she gives her small reaction | |
| C2 | Copy an `https://` address as text, **Paste** | a **link** is added | |
| C3 | In Files, copy a file (Ctrl+C), **Paste** | a file entry (by reference); the original file is unchanged (check name, size, `stat`) | |
| C4 | In Files, **cut** a file (Ctrl+X), **Paste** | stored as a reference; the file is NOT moved or deleted | |
| C5 | Fill the 12 slots, then **Paste** again | clear message: full, nothing replaced, still on the clipboard; switching the destination to Pocket lets it in | |
| C6 | Copy `javascript:alert(1)` as text | stored as a plain note (never a link, never run); copying a `smb://` or `ftp://` file-manager location is skipped with a reason | |
| C7 | Empty clipboard / an image in the clipboard | message that there is nothing to add; nothing stored | |
| C8 | Open and close the backpack without pressing Paste | no clipboard access (nothing in `ctl logs` mentions a paste) | |
| C9 | **Drag a file from Files and release it on Bavi** | expected from the source analysis: the drag is cancelled (the file icon snaps back) and nothing is stored. Please report exactly what you see, including whether anything reacts | |

## D. Walking: ground contact
Run with `--debug-trace`. Watch from the first roam (about 6 s after start). `bash tools/nested-ctl.sh set home-corner "'bottom-right'"` for the mirrored direction.
| # | Test | Expected | Result |
|---|---|---|---|
| D1 | Log line of a roam | `walking A -> B (animated: start 7 + N x loop 10 + stop 25 frames, scale 1.00)` (roams are snapped, scale 1.00) | |
| D2 | Feet during the loop | look planted; say where they still slide (which phase, how far in pixels at 240 px height, forwards or backwards) | |
| D3 | Start and stop transitions | no jump from the idle pose to the first frame; the stop ends exactly on the idle pose; she does not creep after stopping | |
| D4 | Body speed | not "stop and go": say if it pulses (the footLock trade-off) | |
| D5 | Tune: set `motion.footLock.loop` to 0.5 and to 0.9 in `assets/walk/walk.json`, restart | 0.5: smoother body, more skating; 0.9: planted feet, pulsing body. Tell me which looks best | |
| D6 | Different distances | summon from near (about 300 px) and far (about 1200 px) to the pointer: log shows `scale` (1.0 means no stretching) and arrival at the pointer position | |
| D7 | Interrupt: click while walking; summon during the stop sequence | finishes the cycle, plays the stop, then reacts / walks again, no glitch | |
| D8 | `ctl cycle 25 2` then `ctl leakcheck` | counters zero after disable; compare `enabled #1; live:` with `signals=6 timeouts=3 callbacks=7 actors=1` | |

## E. Regression
Backpack from the menu (open, close, reopen, Esc), add note/link/file, search, Keep/Remove, shortcuts `Super+Alt+B` (summon) and `Super+Alt+I` (backpack),
reduced motion (`ctl gsettings set org.gnome.desktop.interface enable-animations false`, set back to `true` afterwards), hide/show.
