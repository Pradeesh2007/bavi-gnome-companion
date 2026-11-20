# GNOME Extensions audit (shexli) for release 0.3.1

Tool: **shexli 0.2.1** (static analyzer for GNOME Shell extension reviews, from PyPI; installed in an isolated virtual environment). It was run by the author of this
code against the real project; the output below is verbatim. A static audit says nothing about whether the extension *works*, and a clean audit would not prove it either.

## Results

| Finding (as you reported it) | Before (0.3.0 tree) | After (0.3.1 ZIP) | What was done |
|---|---|---|---|
| **EGO-M-004** error, `shell-version` | error | **still reported (error)** | Not a metadata problem: see below. Not "fixed", deliberately. |
| **EGO-A-005** manual review, clipboard | manual review | **still reported (manual review)** | Kept on purpose: explicit Paste and Copy. Disclosed in `metadata.json`. See below. |
| **EGO-A-004** warning, ungated logging in `service.js` | 7 calls | **resolved** | Logging classified and moved to `lib/log.js`. |
| **EGO-X-004** warning, synchronous file reads | 2 sites | **resolved** | `store.js` and `walkassets.js` now read asynchronously with cancellation. |
| **EGO-L-003** warning, signals not disconnected | 2 sites | **resolved** | Settings handlers keep their ids and are disconnected in `disable()`. |
| EGO-P-006 warning, compiled schema in the ZIP (new, ZIP only) | present in the 0.3.0 ZIP | **resolved** | `package.sh` validates the schema but no longer ships `gschemas.compiled`. |
| EGO-P-005 error, `__pycache__` (my sandbox only) | in my source tree | gone | An artefact of running Python tests in the sandbox; not shipped. Delete `__pycache__` folders before auditing a source tree. |
| EGO-P-006 / P-007 on the **source directory** (`tools/install.sh`, `tests/` "not reachable") | warnings | still reported on the directory | Dev-only files that are **not in the submission ZIP**; they appear only when scanning the whole project directory. |

**Not audit-clean:** the packaged ZIP still has **1 error (EGO-M-004) and 1 manual-review item (EGO-A-005)**.

## Final output on the packaged ZIP (verbatim)

```text
shexli: issues_found (2 findings, 1 errors, 0 warnings)

EGO-A-005  manual_review
Direct clipboard access via `St.Clipboard.get_default()` requires reviewer scrutiny.

  --> dist/desktop-companion@pradeesh2007.github.io.shell-extension.zip:lib/backpack/clipboard.js:37
  |
  | St.Clipboard.get_default()
  |

  = also: dist/desktop-companion@pradeesh2007.github.io.shell-extension.zip:lib/backpack/dialog.js:439

  = rule: extensions should not access the clipboard directly
  = help: Review Guidelines
    https://gjs.guide/extensions/review-guidelines/review-guidelines.html#clipboard-access-must-be-declared

EGO-M-004  error
Field `shell-version` contains invalid values, more than one development release, or implausible future releases.

  --> dist/desktop-companion@pradeesh2007.github.io.shell-extension.zip:metadata.json

  = rule: metadata shell-version must only include plausible stable releases and at most one development release
  = help: metadata.json must be well-formed
    https://gjs.guide/extensions/review-guidelines/review-guidelines.html#metadata-json-must-be-well-formed
```

## EGO-M-004: why it is reported and why it is not "fixed"
* The metadata is `"shell-version": ["51"]`: a plain major version, valid, exactly the project's target (GNOME Shell 51.1).
* The rule is implemented in the tool (`analyzer/rules/metadata.py`) as: any entry with a major version **greater than 50** is an "implausible future release"
  (`if major > 50: future.append(raw)`). shexli 0.2.1 was written before GNOME 51 existed, so it cannot accept the project's only version.
* GNOME 51 is real and stable: the upstream `gnome-shell` and `mutter` repositories carry the tags `51.0` and `51.1` (and `50.0` to `50.6`).
* The only ways to make the tool pass would be to claim support for a GNOME version the extension was never tested on (for example adding `"50"`), or to remove 51
  (the version it is built for). Both would be false, so neither was done. `pip` offered no newer shexli (0.2.1 is the only release), and no upstream was reachable to check
  whether the bound was raised.
* **Unverified:** whether extensions.gnome.org's own server-side check accepts `"51"` (not reachable from the sandbox). The expectation is that it does, since 51 is current.
* To confirm independently: `gnome-extensions pack` followed by a normal EGO upload, or rerun shexli once it learns about GNOME 51.

## EGO-A-005: clipboard (kept, scoped, disclosed)
Two sites, both user-triggered and necessary:

* `lib/backpack/clipboard.js:37` **reads** the clipboard once, only when the user presses **Paste** in the backpack (`dialog.js` `_paste()`).
* `lib/backpack/dialog.js:439` **writes** to the clipboard only when the user presses **Copy** on a note or link.

Neither was removed: removing them would delete features, not fix a risk. What was verified (`tests/policy.test.mjs`, real Node, scans the shipped source):

* no clipboard monitoring: no `owner-changed` signal anywhere, no timers or signal handlers in `clipboard.js`;
* the reader has exactly one caller (the Paste handler); `St.Clipboard` appears only in those two files;
* no network or process-spawning API anywhere in the extension (so nothing can send clipboard data out), and no default keyboard shortcut touches the clipboard;
* disclosure: the `metadata.json` description says the clipboard is read only when Paste is pressed (written only on Copy), never monitored or polled, and nothing is sent anywhere.

The tool keeps this as a **manual review** item by design (it cannot read the declaration); the guideline it links is "Clipboard access must be declared".

## EGO-A-004: logging (`lib/log.js`)
All seven calls in `service.js` were classified, none simply deleted:

| Kind | Examples | Now |
|---|---|---|
| genuine failure or data problem | storage could not be opened, a save failed and the change was rolled back, expiry sweep failed, an unexpected exception while storing, a corrupt inventory file set aside, a newer-format file left untouched | `errorLog` (always on) |
| operational chatter | "ready (n slots)", "opened link/file", "import finished", "received n items", "expired removed" | `debugLog` (only when `DESKTOP_COMPANION_DEBUG` is 1, 2 or 3, the same switch as `lib/debug.js`; `tools/nested-test.sh --debug` sets it) |

`service.js` no longer contains direct `console.*` calls. Operational lines in other files were left as they are (not flagged; no unrelated refactoring).
Consequence: log lines such as `backpack: ready ...` now require `--debug` in the nested runner; the test plan says so.

## EGO-X-004: synchronous file I/O
* `lib/backpack/store.js` `load()` is now asynchronous (`load_contents_async`, cancellable). The service starts in a **loading** state: the window shows "Loading the backpack...", reads show nothing, changes are refused with a clear message,
  and finishing the load notifies the UI. `destroy()` cancels the read, and a result arriving after shutdown touches nothing.
* `lib/character/walkassets.js` is asynchronous (read and existence check). The actor and controller are created without walking assets and receive them when they arrive (`attachWalkAssets`, `setWalk`);
  until then, or if the assets are missing, invalid or the load is cancelled, she **glides as in 0.1** (never a broken walk). Disable cancels the load and ignores a late result.
* **Not changed, deliberately:** the atomic write in `store.save()` stays synchronous (a few KB; the change-or-roll-back step must be atomic), the `mkdir` of the data directory, and the file `query_info` calls when storing a dropped or pasted file.
  These are small local metadata operations, but a blocked disk would still stall them. This is a remaining (unflagged) risk, not an oversight.

## EGO-L-003: signals
* The generic `Disposer` **does** disconnect every signal it registers (`dispose()` in `lib/disposer.js`). The checker recognises explicit `obj.disconnect(id)` calls in `disable()`, not a custom helper.
* Verified with a test of the real `Disposer` over 25 enable/disable cycles (no handler left on a long-lived settings object, double dispose safe, one failing disconnect does not stop the rest).
* The two settings handlers in `extension.js` are now stored and disconnected explicitly in the teardown that `disable()` calls (and the ids are cleared, so a double disconnect cannot happen).
* Reviewed other connections: `menu.js` and `dialog.js` connect to widgets destroyed with their owner; `prefs.js` runs in its own process and now disconnects on window close; the drop zone's two Shell signals go through the `Disposer` and are checked by test.
