# Desktop Companion: release 0.3.0 (Bavi)

Bavi, a native GNOME Shell 51 desktop companion drawn from four reference poses (front, right, left, back): idle, pointer look,
roaming with turns, click reaction, right-click menu, summon shortcut, Quiet/Focus/Pause/Hide controls, a backpack and a
preferences window.

**What is new in 0.3.0** (details: `docs/release-0.3.0.md`)

* **Walking that stays on the floor.** The walk now advances her exactly as far as her planted foot moves in the drawings
  (measured from the frames), instead of a constant speed. Roaming walks are snapped to whole walking cycles so her feet do not slide.
* **Optional character name.** A fresh installation has no name. Set, change or clear one in the preferences window.
* **Paste into the backpack.** Copy a file in your file manager, a link or some text, then press **Paste** in the backpack. Dropping
  items directly onto the character is **not possible** in GNOME Shell 51.1 (a Shell actor cannot receive drops); the reasons, with source
  references, are in `docs/drag-and-drop-investigation.md`.
* **Support and GitHub links** in the preferences window (and below).

Earlier releases: 0.2.1 walking animation and backpack window fix (`docs/release-0.2.1.md`); 0.2 backpack and notebook: 12 permanent
slots, a 24 h pocket, files (by reference), notes and links, search, open/reveal/copy/remove (`docs/release-0.2.md`); 0.1 character
foundation (`docs/release-0.1.md`).

**Nothing in 0.3.0 has been verified on a real GNOME Shell by the author of this code.** Node/Python tests (real) and mocked tests are
in `tests/`; the GNOME Shell 51.1 steps are in `docs/test-plan-0.3.0.md`. Walking assets: `assets/walk/`, rebuilt by
`tools/build-walk-assets.py` from `art-source/walking/` (your approved frames, never modified).

## Project tree

```
desktop-companion/
├── metadata.json                 uuid desktop-companion@pradeesh2007.github.io, shell-version ["51"]
├── extension.js                  enable()/disable() lifecycle, settings wiring
├── prefs.js                      preferences window
├── assets/                       bavi_front/right/left/back.png, bavi_head.png
├── stylesheet.css                placeholder look
├── schemas/
│   └── org.gnome.shell.extensions.desktop-companion.gschema.xml   one key: hidden (test control)
├── lib/
│   ├── disposer.js               signals, timers and cleanup callbacks for one enable cycle
│   ├── debug.js                  read-only diagnostics, active only with DESKTOP_COMPANION_DEBUG=1..3
│   ├── environment.js            Shell integration (work area, chrome, pointer, overview, keybinding)
│   ├── menu.js                   right-click context menu
│   ├── name.js                   optional character name: validation and neutral wording (pure)
│   ├── links.js                  the GitHub and support URLs
│   ├── backpack/                 model.js (pure), store.js, portal.js, service.js, dialog.js, intake.js (pure), clipboard.js
│   └── character/
│       ├── actor.js              view: sprite actors, walk layer (clip + atlas), gestures
│       ├── controller.js         behaviour: idle, look, roam, walking root motion, click, summon, modes
│       ├── walk.js               walking logic (pure): manifest, root motion, planner, frame state machine
│       └── walkassets.js         loads and validates assets/walk
├── art-source/                   approved 720x1280 walking frames + 270x480 runtime copies (not shipped)
├── tests/                        real: walk, model, name, intake, assets; mocked: controller, service, dialog, prefs
├── tools/
│   ├── common.sh                 shared definitions
│   ├── package.sh                builds dist/<uuid>.shell-extension.zip (never installs or launches)
│   ├── install.sh                optional live install/uninstall (never enables the extension)
│   ├── nested-test.sh            isolated nested-session runner (checks first, --dry-run available)
│   ├── nested-inner.sh           internal: runs inside the private D-Bus session
│   └── nested-ctl.sh             control script for the running isolated session
└── docs/
    ├── release-0.3.0.md          this release: links, naming, paste, foot-grounded walking
    ├── drag-and-drop-investigation.md   why dropping onto the character cannot work in Shell 51.1
    ├── test-plan-0.3.0.md        GNOME Shell 51.1 test steps
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

## Save and run on your Arch machine

1. Unzip `desktop-companion-phase0.zip` somewhere in your home directory, for example `~/projects/`:
   ```
   unzip desktop-companion-phase0.zip -d ~/projects/
   cd ~/projects/desktop-companion
   ```
2. Review the source first (it is plain text). Nothing runs until you run a script.
3. Check the scripts parse, without running anything:
   ```
   for f in tools/*.sh; do bash -n "$f" && echo "ok $f"; done
   ```
4. Dry run of the isolated test (checks only, does not launch):
   ```
   bash tools/nested-test.sh --dry-run
   ```
5. Launch the isolated session and follow `docs/test-plan-0.1.md`:
   ```
   bash tools/nested-test.sh
   ```

You do **not** need `tools/install.sh` for Phase 0. The test runner installs a private copy into a temporary
directory and enables only that copy inside the nested session.

## Packaging (optional, does not install or launch)

```
bash tools/package.sh
```
Writes `dist/desktop-companion@pradeesh2007.github.io.shell-extension.zip`. It tells you whether
`gnome-extensions pack` worked without the `zip` executable or whether the Python fallback was used.

## Installing into your live session (optional, later)

```
bash tools/install.sh              # copies files, does not enable
gnome-extensions enable desktop-companion@pradeesh2007.github.io   # only after the nested tests pass; on Wayland log out and in first
```

## Removal

```
gnome-extensions disable desktop-companion@pradeesh2007.github.io   # if you enabled it
bash tools/install.sh --uninstall                                    # removes only the extension directory
```
The nested test runner removes its own temporary directory automatically. `test-logs/` and `dist/` inside the
project can be deleted by hand.

## Known limitations

* Never executed or tested on GNOME Shell 51.1 yet; see `docs/architecture.md` for the list of unverified assumptions.
* Primary monitor only; no monitor-scale handling beyond what the layout manager provides.
* Lock screen and Overview behaviour are not tested and not claimed.
* The `hidden` GSettings key exists only to make hide/show scriptable in the isolated session.
* The isolation is demonstrated for settings, data/config paths and the D-Bus session before launch, and verified for
  enabled extensions after launch. See the header of `tools/nested-test.sh` for exactly what is checked and what can
  only be verified after launch.

## Enjoying Bavi?

Bavi is an independently developed open-source project, made one small detail at a time. If she makes your desktop a little more
enjoyable, you are warmly invited to support her continued development with a coffee. It is entirely optional, and simply using
and sharing the project is already appreciated.

[☕ Buy Me a Coffee](https://buymeacoffee.com/pradeeshkuamr)

You can also explore the source code, follow development and contribute on GitHub:

[View Bavi on GitHub](https://github.com/Pradeesh2007/bavi-gnome-companion)

The same two links are in the extension's preferences window.
