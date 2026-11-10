# Investigation: `Spurious clutter_actor_allocate … desktop-companion-root`

Status: **root cause not established.** The cleanup implementation is unchanged in r4. r3 added read-only
diagnostics and a regression test; r4 corrects one diagnostic and adds a way to capture the caller. Nothing in r3/r4 has
been run by me. Statements are tagged **[evidence]**
(seen in logs or source), **[review]** (read from our code) or **[hypothesis]**.

Source note: the `layout.js` facts below are the four points reported from the installed 51.1 source
(`removeChrome`, `_untrackActor`, the `destroy` callback registered by `_trackActor`, and the
`Meta.LaterType.BEFORE_REDRAW` scheduling in `_queueUpdateRegions`) plus line hits from the earlier probe
(`layout.js:983–989`, `1016`, `1049`, `1065`). The full excerpt text was not part of the message this analysis
was written from, so no statement below depends on lines I have not seen.

## 0. Round 2 (r4): what the new run settles and what it does not

Run: 15 enable/disable cycles, 1 s delay, `--debug`. Roots live about 1.2 s each; cycle period about 2.3 s.

| Warning | Root | Destroyed | Warned | Lag after destroy |
|---|---|---|---|---|
| 18:56:57.251 | #4 | 18:56:55.153 | 18:56:57.251 | 2.10 s |
| 18:56:57.255 | #3 | 18:56:52.883 | 18:56:57.255 | 4.37 s |
| 18:57:08.360 | #9 | 18:57:06.727 | 18:57:08.360 | 1.63 s |

**Settled (evidence):**

1. **The holder is native, not JS.** The warning prints a valid name and type for each root, so the native object was still alive.
   `gc-check` reported 0 destroyed roots still referenced from JS at every enable, including the enable that happened
   between #3/#4 being destroyed and being warned about (enable #5, about 1 s earlier). A JS reference held by our code
   *or by Shell JS* (for example an entry in `layoutManager._trackedActors`) would keep the wrapper reachable and make
   `gc-check` non-zero. So hypotheses H1 (stale Shell JS tracking record) and H3 (JS-side retention) are **eliminated as
   the holder**. What remains is C/Clutter/St-side state that still references the destroyed actor.
2. **The warnings are not synchronous with our teardown.** They arrive 1.6 to 4.4 s after destruction, while a later root
   (#5, #10) is alive or the stage is otherwise active. Nothing in our code runs at those times for the old roots: timers
   and signals are gone and no controller log line appears.
3. **Two stale roots were processed 4 ms apart, newest first** (#4 then #3), while older ones (#1, #2) and newer ones
   (#5-#8) were not hit. That looks like a list that accumulates some, not all, destroyed roots and is flushed in one
   pass. **[hypothesis]** the order is consistent with a prepend-style list; it does not prove one.
4. **Only 3 of 15 roots are affected (20%)** although every cycle destroys a root in the same state (idle, a bob
   transition in flight). Whatever decides this is not visible in our logs.
5. **GC is not the trigger.** `System.gc()` runs at each enable (every ~2.3 s) and most roots are never warned about.

**Tracking mismatch `root#1: after removeChrome = 13, expected 14`: a measurement artefact, with reasons:**

* The metric is the *global* length of the layout manager's tracking list, compared across the root's whole lifetime.
  `root#1` is the first root of the session and lived for minutes, during which other Shell chrome came and went (startup
  and test activity). The 15 short-lived roots lived 1.2 s and all matched.
* The direction is wrong for a cleanup bug. Our `removeChrome` removes at most one record; a leak of our record would make the
  count **higher** than expected, not lower. A count that is **one lower** than expected means a record belonging to
  something else was removed in the same interval.
* r4 replaces the check with an exact one: `layoutManager._trackedActors.some(d => d.actor === root)` logged as
  `self-tracked=` right after `addChrome` (must be `true`) and right after `removeChrome` (must be `false`). The global count
  stays as an informational line. If `self-tracked=true` ever appears after `removeChrome`, that is a genuine cleanup defect
  and `stalecheck` fails.

**Not settled (and not guessed):** which native object holds the destroyed root, and which of our operations leaves work
pending on it. Everything below that could be a guess is deliberately left unfixed.

### Complete lifecycle trace (ours, in execution order)

| # | Operation | Location | Pending/deferred native work it can leave | Verdict |
|---|---|---|---|---|
| 1 | `new St.Widget` (root), `set_no_layout(true)` | `actor.js:48-49` | none yet | - |
| 2 | `new St.Widget` (character), `set_size`, `root.add_child` | `actor.js:54-60` | relayout on root (not yet in stage: nothing queued on a stage) | - |
| 3 | `new Clutter.ClickGesture`, `add_action` | `actor.js:62-63` | gesture registered on the character | removed at teardown (`actor.js:135`) |
| 4 | `Main.layoutManager.addChrome(root, {trackFullscreen: true})` | `environment.js:32-34` | `uiGroup.add_child`, sibling reorder, tracking record, visibility update, queued region update (`Meta.LaterType.BEFORE_REDRAW`) | Shell-owned |
| 5 | `root.set_position/set_size`, `character.set_position` | `actor.js` `setBounds`/`setPosition`, via `controller.js` `_refreshGeometry` | relayout on root | done ~1 s before teardown |
| 6 | `character.ease({translation_y})` every 0.9 s | `controller.js` `_bobTick` | implicit transition (translation only, no relayout) | in flight at teardown, removed at `actor.js:133` (and `controller.js:119`) |
| 7 | teardown: timers, signals | `disposer.js:97-121` | none | complete |
| 8 | `character.remove_all_transitions()` | `controller.js:119`, `actor.js:133` | stops the in-flight transition | before destroy |
| 9 | `character.remove_action(gesture)` | `actor.js:135` | - | before destroy |
| 10 | `root.remove_all_transitions()` | `actor.js:140` | none (root never has any) | - |
| 11 | `removeChrome(root)` | `actor.js:143` | Shell: `uiGroup.remove_child` + `_untrackActor` (record removed, signals disconnected, region update queued) | before destroy |
| 12 | `root.destroy()` | `actor.js:147` | Clutter: unparent children, dispose | last |

Re-check of the questions asked: no pending allocation/relayout *of ours* survives (5 happened a second earlier); no callback of
ours can schedule allocation after teardown begins (steps 7-12 are the only activity); the order remove-then-destroy is correct;
the Shell tracking relationship is gone after step 11 (to be confirmed exactly by `self-tracked=false`); no lifecycle callback
of ours acts on a destroyed actor (every handler is disconnected or guarded by `_disposed`).

### Next experiments (each answers one question; none changes cleanup)

```
# E1  repeat the run with the exact membership check and a larger sample
bash tools/nested-test.sh --debug-trace
bash tools/nested-ctl.sh cycle 60 1
bash tools/nested-ctl.sh stalecheck
bash tools/nested-ctl.sh traces

# E2  are transitions involved?  (animations off: no ease() is ever called)
bash tools/nested-ctl.sh gsettings set org.gnome.desktop.interface enable-animations false
bash tools/nested-ctl.sh cycle 60 1     # confirm the log says animations=false at each 'started at'
bash tools/nested-ctl.sh stalecheck
bash tools/nested-ctl.sh gsettings set org.gnome.desktop.interface enable-animations true
```

* E1 `traces`: if the captured JS stack contains Shell frames (for example `layout.js`), that file and function are the caller.
  If it contains only the handler, the caller is native code.
* E2: warnings persisting with animations off rule transitions out; warnings vanishing implicate the transition path.
* E3 (decisive, native): `bash tools/nested-test.sh --debug-core`, run `cycle 60 1` until the Shell traps, then
  `coredumpctl list gnome-shell` and `coredumpctl gdb -1`, and type `bt`. The first frames above the trap are the native call
  chain that called `clutter_actor_allocate` on the destroyed root. This writes a core file into the system coredump store
  and ends the nested Shell; it does not affect your live session. A backtrace without debug symbols still names exported
  functions.

Decision rule after the data: a fix is justified only when a stack (JS or native) or the E2 result identifies the holder.
Until then no cleanup change is proposed.

## 1. What the log shows

* **[evidence]** The warning names `desktop-companion-root [StWidget]` only; never the character child.
* **[evidence]** Four bursts: 15:33:50.651 (6 lines), 15:33:58.081 (1), 15:34:22.643 (5), 15:34:53.123 (3).
* **[evidence]** Six distinct addresses appear in the same millisecond at 15:33:50.651. Distinct addresses cannot be
  the same object, so at least six `desktop-companion-root` actors existed at that instant after being removed from
  the stage. They were not freed immediately after `disable()`.
* **[evidence]** The 15:34:22.643 burst lists five of those same six addresses, 32 s later; `0x5648f0fc01d0` appears in
  all four bursts over 63 s. That favours the same objects surviving rather than later actors reusing freed memory,
  but allocator address reuse is not excluded by the log alone.
* **[evidence]** No JS error, no `TypeError`, no `Source ID … not found`. `live:` counters were all zero after every
  disable. Nested Shell RSS 351 → 352 MiB over 25 cycles.
* **[evidence]** Cycle timing: disable happens about 2 s after enable, i.e. during idle (bob only), not during a move.
* **[hypothesis, unconfirmed]** The warnings were absent in earlier cycles and in the first minutes; what changed at
  15:33:50 is not visible in the log.

## 2. Review of our code against the checklist

All locations in this section are in the Phase 0 source as delivered in r2; r3/r4 only add log calls, which shifts `actor.js`
line numbers by 2 to 6 lines (the lifecycle table in section 0 uses the r4 numbers).

| Check | Verdict | Location |
|---|---|---|
| Actor removed before it is destroyed? | Yes: `removeChrome(root)` then `root.destroy()` | `lib/character/actor.js` `destroy()`: `removeChrome` line 138, `destroy` line 141 |
| Destroyed while a transition runs? | No: `remove_all_transitions()` on character (129) and root (136) precede destruction. Transitions only ever exist on `character` | `actor.js:129,136`; `controller.js:119,207` |
| Timer or callback referencing the old actor? | No. `Disposer.dispose()` removes all timeouts first, then signals, then callbacks; the controller stop callback runs before the actor destroy callback (LIFO) | `lib/disposer.js` `dispose()` lines 97–135; registration order `actor.js:49`, `controller.js:54` |
| Child actors that outlive the root? | No: `character` is a child of `root`, destroyed with it; our references are nulled | `actor.js:141–145` |
| `removeChrome()` more than once? | No: guarded by `_destroyed` and `_chromeAdded` | `actor.js:124–126,137–139` |
| Signals not disconnected? | None found. Connected: gesture `recognize` (`actor.js:61`), `monitors-changed` and `workareas-changed` (`environment.js:24–25`), settings `changed::hidden` (`extension.js:48`); all go through `Disposer.connect` and are released in step 2 | `disposer.js:112–121` |
| Actor operations after disable begins? | Only the intended cleanup. After `_disposed` is set, `Disposer.cancel()` is a no-op for ids already released, and the controller's guard flags (`_disposed`) stop every handler. `extension.js` drops `_disposer` before calling `dispose()` | `controller.js:114–121`; `extension.js:63–70` |
| Lingering JS references? | None found: arrays in the `Disposer` are replaced before iteration, `extension.js` keeps no reference to actor/controller | `disposer.js:106–111,123`; `extension.js:23–57` |

**[review]** I found no defect in the delivered code against these checks. That does not prove the code is innocent;
it means the cause is not visible by reading it, so I am not going to guess a change.

## 3. Does the `destroy` signal run before or after our removal?

* **[review]** Our `removeChrome(root)` (`actor.js:138`) runs first. Per the Shell source summary it calls
  `uiGroup.remove_child(actor)` then `_untrackActor(actor)`, and `_untrackActor` disconnects the signals that
  `_trackActor` connected, including the `destroy` callback.
* **[review]** Therefore at `root.destroy()` (`actor.js:141`) the Shell's `destroy` callback is no longer connected and
  `_untrackActor` does not run a second time. Even if it were still connected, a second call would normally find no
  record and return; that early return is **[hypothesis]** until the `_findActor` lines are checked.
* **[review]** The opposite order (Shell's `destroy` callback first) can only occur if the actor is destroyed without
  `removeChrome`, which our code never does.

## 4. Can the deferred `_updateRegions()` produce this warning?

* **[evidence]** `_queueUpdateRegions()` schedules `_updateRegions()` with `Meta.LaterType.BEFORE_REDRAW`, so it runs
  after `removeChrome` returns, in the next frame.
* **[evidence]** `_untrackActor` removes the tracked record synchronously, before the deferred callback exists. At the
  time `_updateRegions()` runs, our root is no longer in the tracked list, so the callback has no way to reach it.
* **[evidence, context unseen]** An earlier probe showed `layout.js:1065` as `if (!actorData.affectsStruts)` inside the
  region update; our root has `affectsStruts: false`, so even a still-tracked root would be skipped there.
* **[hypothesis]** Conclusion: the deferred `_updateRegions()` is **unlikely** to be the producer. It could only matter
  if a stale tracking record survived, in which case the other iterating paths (`_updateFullscreen` at
  `layout.js:1049`, `_updateVisibility` at 983–989, which uses `findIndexForActor`'s `get_transformed_*` calls at
  `layout.js:1016`) would be the more likely carriers than the region update.

## 5. Hypotheses and what each predicts

| # | Hypothesis | Predicts | Check |
|---|---|---|---|
| H1 | The layout manager keeps a stale tracked record for some roots | `Main.layoutManager._trackedActors.length` does not return to baseline after `removeChrome` for the affected roots | `stalecheck`: tracking count per root |
| H2 | The destroyed native actor is kept alive by Clutter state (pending relayout, pointer focus/event chain, gesture bookkeeping) and is allocated later | Tracking count OK; warnings name destroyed roots; may correlate with the pointer resting on the character or with disable during pending work | `stalecheck` plus the three runs in section 7 |
| H3 | A JS-side reference keeps the wrappers alive | `gc-check` reports destroyed roots still referenced | `gc-check` line at each enable |
| H4 | The warning is emitted when old wrappers are finalized by a GC | Warnings appear right after a forced `gc-check` and cluster with GC | compare `gc-check` and warning timestamps |
| H5 | Disabling while a deferred relayout is queued for the root | More warnings with very short delays between disable and the preceding enable | stress run `cycle 60 0.3` vs `cycle 30 3` |

## 6. What r3 adds (observational only)

* `lib/debug.js`, active only when the Shell process has `DESKTOP_COMPANION_DEBUG=1`
  (set by `bash tools/nested-test.sh --debug`). It logs, per root: creation with its **native address** (the
  same `0x5648…` value Clutter prints), the layout manager's tracked-actor count before and after `removeChrome`,
  whether the root was still in the stage and parented to `uiGroup` at that moment, destruction, and a
  forced-GC survivor report at each `enable()`.
* Hooks in `actor.js` (three log calls in `destroy()`, one after creation) and `extension.js` (the GC report). The
  order of cleanup operations is byte-for-byte the same; the only difference in `destroy()` is the three added lines.
* `bash tools/nested-ctl.sh stalecheck`: parses the log and maps every Clutter warning to the logged root that owned
  that address.
* Limits: `trackedCount()` reads the private `Main.layoutManager._trackedActors`; `String(actor)` is assumed to
  contain `native@0x…` (the debug module logs the raw text once if not); `WeakRef` only sees JS reachability, not
  native objects kept alive by Clutter; if a warning address was reused by a later live root the mapping can be
  ambiguous.

## 7. Regression test (`stalecheck`) and the runs to make

`stalecheck` **fails** if either:

1. any `Spurious clutter_actor_allocate … desktop-companion-root` warning is present (any such warning is by definition
   about an actor that is no longer a descendant of the stage), or
2. for any root, the layout manager's tracked count after `removeChrome` is not exactly one less than right after
   `addChrome`.

The `gc-check` line is informational. This test checks the Shell's behaviour, not only our counters.

Runs (all in the isolated session):

```
bash tools/nested-test.sh --debug
bash tools/nested-ctl.sh cycle 30 3        # slow cycles, pointer away from the character
bash tools/nested-ctl.sh cycle 60 0.3      # fast cycles (tests H5)
bash tools/nested-ctl.sh stalecheck
# then once more with the mouse pointer resting on the character during  cycle 30 3   (tests H2/pointer)
bash tools/nested-ctl.sh stalecheck
```

Send back: the full `stalecheck` output of each run and
`grep -n -E 'debug\]|Spurious|gc-check' test-logs/nested-*.log | tail -n 300`.

## 8. Candidate fixes (NOT applied; each needs its hypothesis confirmed first)

* If H1: the cause is in how the root is registered or tracked; the fix will be at the registration site
  (`environment.js:32–34`) or a missing untrack, decided after seeing which roots keep records.
* If H2 and it correlates with pointer position: release pointer/focus involvement before removal (for example make
  the character non-reactive and let one frame pass) in `actor.js` `destroy()`; if it correlates with pending
  relayouts: avoid destroying the root in the same turn as its last geometry change. Both change cleanup and need your
  approval after the data arrives.
* If H3: find and drop the retaining reference; the diagnostics log the root id so it can be traced.
* If H4: nothing to fix in the extension, but then the test threshold must stay at zero warnings and the warning
  needs reporting upstream with the evidence.

No Clutter warning is suppressed, no delay is added and no threshold is changed in any of these.
