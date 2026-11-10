# Desktop Companion: release 0.1 (Bavi)

Bavi, a native GNOME Shell 51 desktop companion drawn from four reference poses (front, right, left, back): idle, pointer look,
roaming with turns, click reaction, right-click menu, summon shortcut, Quiet/Focus/Pause/Hide controls and a preferences window.
See `docs/release-0.1.md` for scope and limitations and `docs/test-plan-0.1.md` for the tests.

**Nothing in this bundle has been run on GNOME Shell. There is no commit hash and no test result yet.**

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
│   └── character/
│       ├── actor.js              view: sprite actors, gestures, drawing primitives
│       └── controller.js         behaviour: idle, look, roam, click, summon, modes
├── tools/
│   ├── common.sh                 shared definitions
│   ├── package.sh                builds dist/<uuid>.shell-extension.zip (never installs or launches)
│   ├── install.sh                optional live install/uninstall (never enables the extension)
│   ├── nested-test.sh            isolated nested-session runner (checks first, --dry-run available)
│   ├── nested-inner.sh           internal: runs inside the private D-Bus session
│   └── nested-ctl.sh             control script for the running isolated session
└── docs/
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
