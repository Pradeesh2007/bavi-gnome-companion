# Desktop Companion: release 0.3.1 (Bavi)

Bavi is a native GNOME Shell 51 desktop companion, drawn from four reference poses (front, right, left, back). Today she idles, looks
at your pointer, roams and walks with frame-by-frame animation, reacts to clicks, has a right-click menu, a summon shortcut,
Quiet/Focus/Pause/Hide controls, a backpack for files, notes and links, and a preferences window.

> **Status: release candidate, not yet verified on a real GNOME Shell.** The author of this code could not run GNOME Shell. Node and
> Python tests (some real, some mocked) pass; the GNOME Shell 51.1 steps are in [`docs/test-plan-0.3.1.md`](docs/test-plan-0.3.1.md).

## What is new in 0.3.1

Details: [`docs/release-0.3.1.md`](docs/release-0.3.1.md).

* **She stands on the floor.** Found by measurement: the artwork was fine, but the code kept a 24 px gap under her (the side margin was also
  applied to the bottom) and the idle "bob" lifted her feet every 1.8 s. The sprite box now sits flush on the bottom of the work area and
  idle breathing scales her about her feet.
* **Drag onto her (experimental).** Real drops onto a Shell actor are impossible in GNOME Shell 51.1, so a drop is *inferred* from the
  supported drag hooks (pointer over her + primary button released). It can be switched off in preferences. **Paste in the backpack is the
  reliable path.** Evidence and limits: [`docs/drag-and-drop-investigation.md`](docs/drag-and-drop-investigation.md).
* **Extension-review fixes.** Backpack and walking assets now load asynchronously (cancelled on disable), logging is split into genuine errors
  and gated debug output, settings signals are disconnected explicitly, and the compiled schema is no longer packaged. The clipboard use is
  explained and disclosed in the metadata. Results of the `shexli` audit: [`docs/audit-0.3.1.md`](docs/audit-0.3.1.md).
* **Documentation:** a planned hybrid animation architecture ([`docs/architecture-animation-roadmap.md`](docs/architecture-animation-roadmap.md)) and the
  Future Features section below.

## Release history

* **0.3.0** foot-contact root motion for the walk, an optional character name (none by default), Paste into the backpack, the support and
  GitHub links ([`docs/release-0.3.0.md`](docs/release-0.3.0.md)).
* **0.2.1** walking animation and the backpack window fix ([`docs/release-0.2.1.md`](docs/release-0.2.1.md)).
* **0.2** backpack and notebook: 12 permanent slots, a pocket with expiry, files by reference, notes and links, search
  ([`docs/release-0.2.md`](docs/release-0.2.md)).
* **0.1** character foundation ([`docs/release-0.1.md`](docs/release-0.1.md)).

## Future Features

> These are **ideas and plans, not features of the current release.** None of them is promised, scheduled or guaranteed; some may change
> or never happen. They are listed so you can see where Bavi might go, and you are welcome to tell the project what you would enjoy most.

### Character interaction and personality (planned / under consideration)

* Drag and drop Bavi around the desktop
* Turning animations
* Blinking eyes
* Sitting
* Opening her backpack while receiving dragged files
* Click reactions (beyond the simple jump she has today)
* Looking around
* Stretching
* Sneezing
* Thinking
* Waving hands
* Angry expressions and reactions
* Dressing and outfit customization

### Movement and environment (future possibilities)

* Flying
* Climbing windows
* Building and customizing a home for Bavi

### Productivity and assistance (future possibilities)

* Reminders
* Notifications: handling and presenting desktop notifications
* Recommendations
* AI assistant integrations

### And more (under consideration)

* More character animations
* More interactions and personality features
* Additional desktop utilities and companion capabilities

*Technical direction:* the character is planned to move towards a hybrid of frame-by-frame PNG animation, separately animated parts
(including layered hair), procedural effects (subtle breathing, blinking) and, much later, skeletal animation. That design is documented in
[`docs/architecture-animation-roadmap.md`](docs/architecture-animation-roadmap.md). It is **not** part of the current code.

## Project tree

```text
desktop-companion/
├── metadata.json                 uuid desktop-companion@pradeesh2007.github.io, shell-version ["51"], url
├── extension.js                  enable()/disable() lifecycle, settings wiring
├── prefs.js                      preferences window
├── assets/                       bavi_front/right/left/back.png, bavi_head.png
├── stylesheet.css                backpack window, drop glow and message bubble
├── schemas/
│   └── org.gnome.shell.extensions.desktop-companion.gschema.xml   user settings (shortcuts, name, pocket lifetime, drop switch, ...)
├── lib/
│   ├── log.js                    errorLog (genuine failures) and debugLog (gated by DESKTOP_COMPANION_DEBUG)
│   ├── dropdetect.js             decides whether an external drag ended as a drop on the character (pure)
│   ├── dropzone.js               experimental: hover, capped payload read and inferred drop onto the character
│   ├── disposer.js               signals, timers and cleanup callbacks for one enable cycle
│   ├── debug.js                  read-only diagnostics, active only with DESKTOP_COMPANION_DEBUG=1..3
│   ├── environment.js            Shell integration (work area, chrome, pointer, overview, keybinding)
│   ├── menu.js                   right-click context menu
│   ├── name.js                   optional character name: validation and neutral wording (pure)
│   ├── links.js                  the GitHub and support URLs
│   ├── backpack/                 model.js, intake.js, summary.js (pure); store.js, portal.js, service.js, dialog.js, clipboard.js
│   └── character/
│       ├── geometry.js           where she stands: the floor is the bottom of the work area (pure)
│       ├── actor.js              view: sprite actors, walk layer (clip + atlas), gestures
│       ├── controller.js         behaviour: idle, look, roam, walking root motion, click, summon, modes
│       ├── walk.js               walking logic (pure): manifest, root motion, planner, frame state machine
│       └── walkassets.js         loads and validates assets/walk
├── art-source/                   approved 720x1280 walking frames + 270x480 runtime copies (not shipped)
├── tests/                        real: walk, geometry, model, name, intake, dropdetect, policy, assets; mocked: controller, service, dialog, prefs, dropzone, disposer, walkassets
├── tools/
│   ├── common.sh                 shared definitions
│   ├── package.sh                builds dist/<uuid>.shell-extension.zip (never installs or launches)
│   ├── install.sh                optional live install/uninstall (never enables the extension)
│   ├── nested-test.sh            isolated nested-session runner (checks first, --dry-run available)
│   ├── nested-inner.sh           internal: runs inside the private D-Bus session
│   └── nested-ctl.sh             control script for the running isolated session
└── docs/
    ├── release-0.3.1.md          this release: grounding fix, drops onto the character (experimental), audit fixes
    ├── test-plan-0.3.1.md        GNOME Shell 51.1 test steps for this release
    ├── audit-0.3.1.md            shexli results and what each finding led to
    ├── architecture-animation-roadmap.md   planned hybrid animation architecture (design only, not implemented)
    ├── drag-and-drop-investigation.md      drag-and-drop on Shell 51.1: evidence, conclusion and the inference design
    ├── release-0.3.0.md          links, naming, paste, foot-contact root motion
    ├── test-plan-0.3.0.md        GNOME Shell 51.1 test steps for 0.3.0
    ├── release-0.2.1.md          walking animation, backpack fix, state flow, timing, tuning (foot contact superseded by 0.3.0)
    ├── test-plan-0.2.1.md        GNOME Shell 51.1 test steps
    ├── release-0.2.md            backpack scope, design choices, safety rules, unverified APIs
    ├── test-plan-0.2.md          release 0.2 tests
    ├── release-0.1.md            scope, assets, APIs, limitations
    ├── test-plan-0.1.md          release 0.1 tests
    ├── architecture.md           Phase 0 architecture (lifecycle design still applies)
    ├── investigation-stale-root-warnings.md
    └── test-plan.md              Phase 0 tests (historical)
```

## Quick start: isolated test on Arch (never touches your live session)

1. Get the project directory (for example unzip the release ZIP into `~/projects/`) and review the source; nothing runs until you run a script.
2. Check that the scripts parse, without running anything:

   ```bash
   for f in tools/*.sh; do bash -n "$f" && echo "ok $f"; done
   ```

3. Dry run (checks only, does not launch):

   ```bash
   bash tools/nested-test.sh --dry-run
   ```

4. Launch the isolated nested session (add `--debug` to see the gated diagnostic lines) and follow
   [`docs/test-plan-0.3.1.md`](docs/test-plan-0.3.1.md):

   ```bash
   bash tools/nested-test.sh --debug
   ```

You do **not** need `tools/install.sh` for testing. The runner installs a private copy into a temporary directory and enables only that
copy inside the nested session.

## Packaging (optional, does not install or launch)

```bash
bash tools/package.sh
```

Writes `dist/desktop-companion@pradeesh2007.github.io.shell-extension.zip`. It reports whether `gnome-extensions pack` worked or the
Python fallback was used. The package contains the extension only (no tests, no source art) and no compiled schema: the Shell's installer
compiles schemas itself.

## Installing into your live session (optional, later)

```bash
bash tools/install.sh              # copies files, does not enable
gnome-extensions enable desktop-companion@pradeesh2007.github.io   # only after the nested tests pass; on Wayland log out and in first
```

## Removal

```bash
gnome-extensions disable desktop-companion@pradeesh2007.github.io   # if you enabled it
bash tools/install.sh --uninstall                                    # removes only the extension directory
```

The nested test runner removes its own temporary directory automatically. `test-logs/` and `dist/` inside the project can be deleted by hand.

## Privacy and clipboard behaviour

* **Paste** reads the clipboard **once, when you press the button** in the backpack window. **Copy** (on a note or link) writes to the clipboard
  when you press it. There is no clipboard monitoring, polling or change listener, and nothing is sent anywhere (the extension makes no network
  connections). `tests/policy.test.mjs` checks these rules on the source.
* **Dragging** an item over the character makes her read that drag's data (text or a file list, capped at 256 KiB) while it is held over her. That is
  the drag you are performing, not the clipboard.
* Files are stored by reference: they are never copied, moved, renamed, deleted or executed.
* This is declared in the extension description (`metadata.json`).

## Known limitations

* Not verified on a real GNOME Shell 51.1 by the author of this code. See the test plans and `docs/architecture.md` for the assumptions.
* Drops onto the character are inferred, experimental and may not work; the source application will show the drag as cancelled.
* Primary monitor only; no monitor-scale handling beyond what the layout manager provides.
* Lock screen and Overview behaviour are not tested and not claimed.
* The `hidden` GSettings key exists to make hide/show scriptable in the isolated session.
* The static auditor `shexli` 0.2.1 reports an error for `shell-version: ["51"]` because it does not know GNOME 51 yet; see `docs/audit-0.3.1.md`.

## Enjoying Bavi?

Bavi is an independently developed open-source project, made one small detail at a time. If she makes your desktop a little more
enjoyable, you are warmly invited to support her continued development with a coffee. It is entirely optional, and simply using
and sharing the project is already appreciated.

[☕ Buy Me a Coffee](https://buymeacoffee.com/pradeeshkuamr)

You can also explore the source code, follow development and contribute on GitHub:

[View Bavi on GitHub](https://github.com/Pradeesh2007/bavi-gnome-companion)

The same two links are in the extension's preferences window.
