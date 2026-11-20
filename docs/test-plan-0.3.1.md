# Release 0.3.1 test plan: GNOME Shell 51.1 nested session

**Nothing in this plan has been run.** Use only the isolated nested session; do not touch your live session. Send back, per row: pass/fail, what you saw, and for any failure
`bash tools/nested-ctl.sh errors` and `bash tools/nested-ctl.sh logs 200`.

## 0. Setup and automated checks
```bash
cd ~/Projects/extention/desktop-companion          # your project directory
find . -name __pycache__ -type d -exec rm -rf {} + # before any audit
# real tests (plain Node / Python)
for t in walk geometry model name intake dropdetect policy; do node tests/$t.test.mjs | tail -1; done; python3 tests/test_assets.py | tail -1
# mocked tests
node tests/controller.test.mjs | tail -1
for t in service dialog prefs dropzone disposer walkassets; do node --import ./tests/mocks/register.mjs tests/$t.test.mjs 2>&1 | tail -1; done
# static
for f in tools/*.sh; do bash -n "$f" && echo "ok $f"; done
glib-compile-schemas --strict --dry-run schemas && echo "schema ok"
bash tools/package.sh                                # then audit the ZIP (needs: pip install shexli, in a venv)
shexli dist/*.zip
# runtime (leave open): --debug turns on the gated diagnostic lines ("backpack: ready", "dropzone: ...")
bash tools/nested-test.sh --debug
# second terminal
bash tools/nested-ctl.sh status ; bash tools/nested-ctl.sh logs 200 ; bash tools/nested-ctl.sh errors
```
Expected from `shexli dist/*.zip`: **1 error (EGO-M-004, the tool does not know GNOME 51) and 1 manual-review item (EGO-A-005, clipboard)**. Anything else is new.

## A. Startup and lifecycle (real Shell)
| # | Test | Expected | Result |
|---|---|---|---|
| A1 | Startup log | `started: ... floor: sprite box bottom H of H` (the two numbers equal); `walking animation: 7/10/25 frames ...`; `backpack: ready (0/12 slots ...)`; no `JS ERROR`; no `desktop-companion ... failed` | |
| A2 | `enabled #1; live:` line | my arithmetic: `signals=6 timeouts=2 callbacks=9 actors=1` (report what you see) | |
| A3 | `ctl cycle 25 2` then `ctl leakcheck` | counters zero after disable, no `Spurious clutter_actor_allocate` warnings, no errors | |
| A4 | Disable the extension within one second of enabling (`ctl disable` right after `ctl enable`) a few times | no errors from the asynchronous loads (backpack or walking assets) after disable | |
| A5 | Change settings while enabled (`ctl set quiet-mode true`, then `false`; `ctl set character-name "'Mika'"` and `"''"`) | takes effect; after `cycle` there is no doubled effect (each change is logged once) | |
| A6 | Open the backpack at once after enabling | either the list or "Loading the backpack..." that turns into the list; no error | |

## B. Grounding (the main thing to judge by eye)
Look at her feet against the bottom edge of the nested monitor. Take screenshots if you can and send them.
| # | Test | Expected | Result |
|---|---|---|---|
| B1 | Standing, home bottom-left (default) | the soles touch the bottom edge of the work area, no gap | |
| B2 | Standing, home bottom-right (`ctl set home-corner "'bottom-right'"`) | same | |
| B3 | Idle for 30 s | gentle breathing only; the soles never lift (compare with 0.3.0, where she bobbed up 3 px) | |
| B4 | Walking right, walking left (wait for roams; `Super+Alt+B` summon works too) | feet on the floor line the whole time, no hover, no sinking below the screen | |
| B5 | Start-walking, loop, stop-walking transitions | no vertical jump at the joins; the stop ends exactly on the idle pose at the same floor line | |
| B6 | Scaling: `ctl set character-height 120`, `240`, `360`, `480` | the floor line holds at every size (`started:`-style numbers: re-enable to log `floor: ...`) | |
| B7 | Work area change (resize the nested window if your runner allows, or watch the first panel resize in the log: `work area changed to ...`) | she re-lands on the new floor | |
| B8 | Repeated roaming for 5 minutes | no drift upwards, no unnatural bouncing | |
| B9 | Say what still looks wrong | specifically: where do the feet still slide, forward or backward, in which part of the cycle | |

## C. Drag onto the character (experimental; needs real sources inside the nested session)
A drag from an application of your real desktop cannot reach the nested Shell, so start the sources inside it:
```bash
bash tools/nested-ctl.sh launch nautilus ~/Documents        # files
bash tools/nested-ctl.sh launch gnome-text-editor            # text (any Wayland text app works)
bash tools/nested-ctl.sh launch firefox                      # links, if installed
```
With `--debug` the log shows each step: `dropzone: external drag #N began`, `the source offers: ...`, `drag #N ended: <reason> (button down: ..., over her: ...)`.
| # | Test | Expected | Result |
|---|---|---|---|
| C1 | Drag any file from Files, hover her (she glows), release | log: `ended: released-over-target (button down: false, over her: true)`; a bubble `Added 1 file to the backpack.`; she reacts; the file appears in the backpack; the **source file is unchanged** (check `stat`, size, existence). The drag icon in Files will look cancelled: expected | |
| C2 | Files of several types: PDF, image, video, audio, ZIP, source file, a text file, a file with no extension, one with a strange extension | all stored (no extension allowlist); report any that are not | |
| C3 | Several files at once | `Added N files`; partial acceptance is listed (try including a folder: skipped with a reason) | |
| C4 | Select text in the editor and drag it onto her | a **note** is stored with that text | |
| C5 | Drag a link from the browser (address bar or a link on a page) | a **link** is stored (report which mime types the log says the browser offered) | |
| C6 | Hover her but press **Escape**, then release the mouse elsewhere | nothing stored, no message; the log reason is `cancelled` or `not-over-target` | |
| C7 | Release elsewhere (not over her) | nothing stored | |
| C8 | Fill the 12 slots, then drag another item | goes to the **pocket** with the message `The backpack is full, so ... went into the pocket ...`; with the pocket also full: nothing stored, nothing replaced, message `...unchanged where it came from` | |
| C9 | Drag the same file twice | the second says it is already in the backpack; no duplicate | |
| C10 | Drag something unsupported (an image dragged out of a browser, if it offers no uri-list/text) | `I can only keep files, text and web links.`; nothing stored | |
| C11 | Repeated drags in a row, quickly | each stored once; no stuck glow; no stuck roaming (she walks again afterwards) | |
| C12 | She is walking when the drag starts | the walk finishes normally; no new roam starts until the drag ends | |
| C13 | `ctl set drop-onto-character false`, drag again | nothing happens (no glow, no hold, no read); `true` works again without a restart | |
| C14 | Disable the extension (`ctl disable`) **while holding a drag over her** | no errors; glow gone; `ctl enable` works afterwards | |
| C15 | If nothing works: copy the `dropzone:` log lines | tell me: did `began` appear, did the source offer types, what was the reason at the end, was `button down` true or false on a normal release? These decide whether the inference can work | |

## D. Clipboard (Paste and Copy)
| # | Test | Expected | Result |
|---|---|---|---|
| D1 | Copy text anywhere, open the backpack, press **Paste** | a note; message; she acknowledges | |
| D2 | Copy a file in Files, **Paste** | a file reference; the file untouched; "cut" never moves anything | |
| D3 | Open and close the backpack, wait a minute, copy things | nothing is read or stored until you press Paste (`ctl logs 200` shows no clipboard activity) | |
| D4 | **Copy** on a note and on a link, paste in another app | the exact text | |
| D5 | Read the extension description (`ctl status` or the Extensions app) | it states that the clipboard is read only on Paste (written only on Copy), never monitored, nothing sent anywhere | |

## E. Regression
Backpack (open from the menu, close, reopen, Esc), add note/link/file, search, Keep/Remove, the footer destination toggle, shortcuts `Super+Alt+B` (summon) and `Super+Alt+I` (backpack), the name entry
(placeholder exactly `Enter Name (Eg. Bavi)`), the support and GitHub links in Settings, reduced motion (`ctl gsettings set org.gnome.desktop.interface enable-animations false`, then back to `true`), hide/show,
the walking animation (start, loop, stop, interrupt by click, summon during the stop).
