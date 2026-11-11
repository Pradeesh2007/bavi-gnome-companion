# Release 0.2 test plan (isolated nested session)

Run from the project directory. Nothing here has been run. `tools/nested-ctl.sh set KEY VALUE` changes only the isolated settings.
Preparation: `bash tools/nested-test.sh --debug-trace` (leave open), second terminal for `ctl`.
Data file of the isolated session: `D=$(ls -td /tmp/desktop-companion-test.* | head -1)/data/desktop-companion; ls -l $D`.
First run the logic tests (they need only Node):
`node tests/model.test.mjs && node --import ./tests/mocks/register.mjs tests/service.test.mjs`

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Startup | log `backpack: ready (0/12 slots, pocket 0, 0 expired removed)`, `enabled #1; live: signals=5 timeouts=2 callbacks=7 actors=1` (expected, not observed), no `JS ERROR`, no `keybinding … could not be registered` | |
| 2 | Open from the menu | right-click her → **Backpack…** (first entry): the window opens, log `backpack opened`, the search box has the cursor; **Esc** closes it | |
| 3 | Open by shortcut | `Super+Alt+I` in the nested window opens it; also after `ctl hide` | |
| 4 | Add a note | Add note, type title + two lines of text, Save: back in the list, message `Note saved to the backpack.`, the row shows in Backpack; `ls -l $D` shows `inventory.json` with `-rw-------` | |
| 5 | Note form keeps your text on error | Add note, leave empty, Save: error `The note is empty.`, you stay in the form | |
| 6 | Add links | `https://example.org` saves; `example.org`, `ftp://x.y`, `javascript:alert(1)` each give a clear error and keep the form open | |
| 7 | Pocket | click **Adding to** so it says Pocket (24 h), add a note: it appears under Pocket with `expires in 23 h 59 min` (or similar) | |
| 8 | Keep | **Keep** on a pocket item: it moves to Backpack, no expiry text | |
| 9 | Remove | note: first click turns into `Really remove?`, second removes; link and file: removed at once | |
| 10 | Search | type part of a title/URL/note word: both sections filter live; a word that matches nothing shows `No matches.`; clearing restores all | |
| 11 | View / Copy | note View shows the full text, Back/Esc returns; Copy then paste somewhere in the nested session gives the text | |
| 12 | Add file | **Add file…**: the window closes, a file chooser appears (say on which display), choose two files: the window reopens with `Added 2 files…`; cancel shows no message | |
| 13 | Open a file | **Open** on a `.txt`: it opens in your default app (say where it appeared and whether it was the nested or real session) | |
| 14 | Refuse programs | `printf '#!/bin/sh\n' > /tmp/t.sh`, add it, **Open**: refused with `Bavi does not open programs…`; log `refused to open file`; **Reveal** still works | |
| 15 | Reveal / missing file | Reveal shows the file in the file manager; `mv` a stored file away, then Open: message `The file is no longer at …`; Remove works and the (moved) file is untouched | |
| 16 | Full backpack | add 12 notes: the 13th gives `The backpack is full (12 of 12 slots)…`; Pocket accepts it until 12 items, then `The pocket is full` | |
| 17 | Persistence | `ctl disable`, `ctl enable`, open: everything is still there | |
| 18 | Expiry | add a pocket note; `ctl disable`; run `python3 - "$D/inventory.json" <<'P'` / `import json,sys` / `p=sys.argv[1]; d=json.load(open(p))` / `for i in d['items']:` / `    if i['slot'] is None: i['expiresAt']=1000` / `json.dump(d,open(p,'w'),indent=2)` / `P` (one line per segment, ending with a line containing only `P`); `ctl enable`: log `1 expired pocket item(s) removed`, the pocket note is gone, backpack items remain | |
| 19 | Corrupt file | `ctl disable`; `echo '{bad' > $D/inventory.json`; `ctl enable`: log says it was kept as `inventory.json.corrupt-…`, the backpack opens empty, `ls $D` shows the backup | |
| 20 | Settings | `ctl set pocket-expiry-hours 2`, add a pocket item: `expires in 1 h 59 min` (existing items unchanged); `ctl set backpack-shortcut "['<Super><Alt>j']"` then `Super+Alt+J` opens it | |
| 21 | Preferences | menu → Settings: new **Shortcuts** group (two rows) and **Backpack** group (Pocket lifetime) are present and work | |
| 22 | Disable while open | open the backpack, then `ctl disable`: no errors, the dialog disappears, the nested desktop still accepts clicks | |
| 23 | Lifecycle | `ctl cycle 25 2` then `ctl leakcheck`: counters zero after disable | |
| 24 | 0.1 rows | repeat the unfinished rows of `docs/test-plan-0.1.md` (2 to 15) because 0.2 contains the same character code | |

Send back per row: pass/fail, what you saw, and for failures the exact log lines (`ctl errors`, `ctl logs 200`).
