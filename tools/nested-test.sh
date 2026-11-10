#!/usr/bin/env bash
# tools/nested-test.sh [--dry-run] [--keep-temp] [--min-mem-mb N] [--max-minutes N]
#
# Launches an isolated nested GNOME Shell (devkit) that loads ONLY this extension.
#
# Before launching it refuses unless all of the following hold:
#   - not root; a graphical session is present; required commands exist
#   - the installed gnome-shell lists --devkit, --wayland and --no-x11 in its --help
#   - enough free RAM, acceptable swap use and acceptable memory pressure
#   - isolation is demonstrated for settings, user data/config paths and the D-Bus session
# It never touches your live GNOME session, settings or extensions, and only ever signals the
# process it started itself.
#
# --dry-run   run every check and build the temporary environment, print the launch command, then
#             clean up WITHOUT launching anything. Run this first.
# --keep-temp keep the temporary directory afterwards (for debugging)
# --debug     start the Shell with DESKTOP_COMPANION_DEBUG=1 (read-only diagnostics, see
#             docs/investigation-stale-root-warnings.md); required for `nested-ctl.sh stalecheck`
# --debug-trace   level 2: also log the JS stack at the moment Clutter warns about our root
# --debug-core    level 3: also trap at that moment so systemd-coredump keeps a NATIVE backtrace.
#             This writes a core file into the system coredump store (outside the temp directory).
set -u
export LC_ALL=C

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

DRY_RUN=0
KEEP_TEMP=0
DEBUG_LEVEL=0
MIN_AVAIL_MB=1200
MAX_SWAP_PCT=60
MAX_PSI_AVG10="10.0"
MAX_MINUTES=30

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --keep-temp) KEEP_TEMP=1 ;;
        --debug) [ "$DEBUG_LEVEL" -ge 1 ] || DEBUG_LEVEL=1 ;;
        --debug-trace) [ "$DEBUG_LEVEL" -ge 2 ] || DEBUG_LEVEL=2 ;;
        --debug-core) DEBUG_LEVEL=3 ;;
        --min-mem-mb) shift; MIN_AVAIL_MB="${1:-}" ;;
        --max-minutes) shift; MAX_MINUTES="${1:-}" ;;
        -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done
case "$MIN_AVAIL_MB" in ''|*[!0-9]*) echo "--min-mem-mb needs a whole number" >&2; exit 2 ;; esac
case "$MAX_MINUTES" in ''|*[!0-9]*) echo "--max-minutes needs a whole number" >&2; exit 2 ;; esac

# --- state used by cleanup ------------------------------------------------------------------
REAL_HOME="$HOME"
REAL_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
LIVE_BUS="${DBUS_SESSION_BUS_ADDRESS:-}"
TMP_BASE="${TMPDIR:-/tmp}"
T=""
RUN_PID=""
TAIL_PID=""
LIVE_HASH_BEFORE=""

live_enabled_hash() {
    gsettings get org.gnome.shell enabled-extensions 2>/dev/null | sha256sum | cut -d' ' -f1
}

cleanup() {
    local rc=$?
    trap - EXIT INT TERM HUP
    [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
    if [ -n "$RUN_PID" ] && kill -0 "$RUN_PID" 2>/dev/null; then
        echo "Stopping the nested session (only the process this script started, PID $RUN_PID)..."
        kill -TERM "$RUN_PID" 2>/dev/null
        for _ in $(seq 1 40); do
            kill -0 "$RUN_PID" 2>/dev/null || break
            sleep 0.5
        done
        kill -0 "$RUN_PID" 2>/dev/null && kill -KILL "$RUN_PID" 2>/dev/null
    fi
    if [ -n "$T" ] && [ -d "$T" ]; then
        if [ "$KEEP_TEMP" -eq 1 ]; then
            echo "Keeping temporary directory: $T"
        else
            case "$T" in
                "$TMP_BASE"/desktop-companion-test.*) rm -rf -- "$T"; echo "Removed temporary directory." ;;
                *) echo "Not removing unexpected path: $T" ;;
            esac
        fi
    fi
    if [ -n "$LIVE_HASH_BEFORE" ]; then
        if [ "$(live_enabled_hash)" = "$LIVE_HASH_BEFORE" ]; then
            echo "Live session check: your enabled-extensions setting is unchanged."
        else
            echo "WARNING: your live enabled-extensions setting differs from before the test." >&2
            echo "         Something other than this script may have changed it; please inspect it." >&2
        fi
    fi
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

refuse() {
    echo >&2
    echo "REFUSING TO LAUNCH: $*" >&2
    exit 1
}

unsafe() {
    echo >&2
    echo "ISOLATION NOT DEMONSTRATED: $1" >&2
    echo "Remaining unsafe if launched anyway: $2" >&2
    echo "Nothing was launched. Nothing outside the temporary directory was changed." >&2
    exit 1
}

echo "== 1. Basic requirements =="
[ "$(id -u)" -ne 0 ] || refuse "do not run this as root."
[ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] || refuse "no graphical session detected (WAYLAND_DISPLAY and DISPLAY are unset); the devkit window needs one."
[ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ] || refuse "XDG_RUNTIME_DIR is not set to an existing directory."
for cmd in gnome-shell dbus-run-session gdbus gsettings glib-compile-schemas gjs gnome-extensions timeout mktemp sha256sum awk sed seq ps; do
    have "$cmd" || refuse "required command not found: $cmd"
done
for f in nested-inner.sh nested-ctl.sh; do
    [ -f "$TOOLS_DIR/$f" ] || refuse "missing $TOOLS_DIR/$f"
done
echo "ok"

echo
echo "== 2. Installed gnome-shell supports the options this runner uses =="
HELP="$(timeout 15 gnome-shell --help 2>&1)"
for opt in --devkit --wayland --no-x11; do
    printf '%s\n' "$HELP" | grep -q -- "$opt" || refuse "the installed 'gnome-shell --help' does not list $opt; the command line would be invalid."
    echo "  gnome-shell --help lists $opt"
done
if ! { have mutter-devkit || { have pacman && pacman -Q mutter-devkit >/dev/null 2>&1; }; }; then
    refuse "mutter-devkit does not appear to be installed (pacman -Q mutter-devkit failed and the command is not on PATH)."
fi
echo "  mutter-devkit present"
echo "  Command that will be used inside the isolated session: gnome-shell --devkit --wayland --no-x11"

echo
echo "== 3. Memory and swap gate =="
MEM_KB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
SWAP_TOTAL_KB="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
SWAP_FREE_KB="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
MEM_MB=$(( ${MEM_KB:-0} / 1024 ))
SWAP_USED_PCT=0
if [ "${SWAP_TOTAL_KB:-0}" -gt 0 ]; then
    SWAP_USED_PCT=$(( (SWAP_TOTAL_KB - SWAP_FREE_KB) * 100 / SWAP_TOTAL_KB ))
fi
PSI_AVG10=""
if [ -r /proc/pressure/memory ]; then
    PSI_AVG10="$(awk '/^some/ { for (i = 1; i <= NF; i++) if ($i ~ /^avg10=/) { sub("avg10=", "", $i); print $i } }' /proc/pressure/memory)"
fi
echo "  MemAvailable: ${MEM_MB} MiB (minimum required: ${MIN_AVAIL_MB} MiB)"
echo "  Swap used: ${SWAP_USED_PCT}% (maximum allowed: ${MAX_SWAP_PCT}%)"
echo "  Memory pressure (PSI some avg10): ${PSI_AVG10:-unavailable} (maximum allowed: ${MAX_PSI_AVG10})"
RES_PROBLEM=""
[ "$MEM_MB" -ge "$MIN_AVAIL_MB" ] || RES_PROBLEM="${RES_PROBLEM}only ${MEM_MB} MiB RAM available; "
[ "$SWAP_USED_PCT" -le "$MAX_SWAP_PCT" ] || RES_PROBLEM="${RES_PROBLEM}swap is ${SWAP_USED_PCT}% used; "
if [ -n "$PSI_AVG10" ] && awk -v a="$PSI_AVG10" -v b="$MAX_PSI_AVG10" 'BEGIN { exit !(a > b) }'; then
    RES_PROBLEM="${RES_PROBLEM}memory pressure is high (avg10=${PSI_AVG10}); "
fi
if [ -n "$RES_PROBLEM" ]; then
    echo >&2
    echo "Largest memory users right now (process name and resident size only):" >&2
    ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -n 8 | awk '{ printf "  %6.0f MiB  %s\n", $1 / 1024, $2 }' >&2
    echo >&2
    echo "How to free resources and retry:" >&2
    echo "  1. Close web browsers, IDEs, chat apps and video players (they are usually the biggest users)." >&2
    echo "  2. Optionally close extra GNOME windows, then check with: free -h" >&2
    echo "  3. Run this script again. Thresholds can be changed with --min-mem-mb, but a nested Shell" >&2
    echo "     on a machine that is already swapping heavily may freeze your desktop." >&2
    refuse "insufficient resources: ${RES_PROBLEM%; }."
fi
echo "ok"

echo
echo "== 4. Temporary isolated environment =="
T="$(mktemp -d "$TMP_BASE/desktop-companion-test.XXXXXXXX")" || refuse "could not create a temporary directory."
chmod 700 "$T"
mkdir -p "$T/home" "$T/config/glib-2.0/settings" "$T/data/gnome-shell/extensions" "$T/cache" "$T/state"
EXT_DIR="$T/data/gnome-shell/extensions/$UUID"
copy_runtime "$EXT_DIR" || refuse "could not copy the extension into the temporary directory."
glib-compile-schemas "$EXT_DIR/schemas" || refuse "glib-compile-schemas failed on the temporary copy."
cat > "$T/config/glib-2.0/settings/keyfile" <<KEYFILE
[org/gnome/shell]
enabled-extensions=['$UUID']
disable-user-extensions=false
welcome-dialog-last-shown-version='99.0'
KEYFILE
if [ -d "$REAL_DATA_HOME/gnome-shell/extensions" ]; then
    ls -1 "$REAL_DATA_HOME/gnome-shell/extensions" > "$T/live-uuids.txt" 2>/dev/null
else
    : > "$T/live-uuids.txt"
fi
echo "  temporary directory: $T"
echo "  isolated extension copy: $EXT_DIR"

ISO_ENV=(env
    HOME="$T/home"
    XDG_CONFIG_HOME="$T/config"
    XDG_DATA_HOME="$T/data"
    XDG_CACHE_HOME="$T/cache"
    XDG_STATE_HOME="$T/state"
    XDG_DATA_DIRS="/usr/local/share:/usr/share"
    GSETTINGS_BACKEND=keyfile
    GNOME_SHELL_SESSION_MODE=user)
if [ "$DEBUG_LEVEL" -ge 1 ]; then
    ISO_ENV+=(DESKTOP_COMPANION_DEBUG="$DEBUG_LEVEL")
    echo "  debug diagnostics: ON, level $DEBUG_LEVEL (DESKTOP_COMPANION_DEBUG inside the isolated session only)"
fi
iso() { "${ISO_ENV[@]}" "$@"; }

LIVE_HASH_BEFORE="$(live_enabled_hash)"
LIVE_COUNT="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null | grep -o "'[^']*'" | grep -c .)"
echo "  live session: ${LIVE_COUNT} extensions in enabled-extensions (read only; fingerprint recorded)"

echo
echo "== 5. Isolation checks (all must pass before anything is launched) =="

# 5a. Settings: with the isolated environment, GSettings must read OUR keyfile, not your dconf.
GOT="$(iso gsettings get org.gnome.shell enabled-extensions 2>&1)"
EXPECT="['$UUID']"
echo "  isolated GSettings enabled-extensions = $GOT"
[ "$GOT" = "$EXPECT" ] || unsafe "the isolated GSettings backend did not return only the test extension (got: $GOT)." \
    "the nested Shell could read your real dconf settings and load your 29 extensions."

# 5b. Paths: GLib (used by the Shell for extension and data lookup) must resolve inside the temp dir.
GJS_PATHS="$(iso gjs -c 'const GLib = imports.gi.GLib; print(GLib.get_user_data_dir()); print(GLib.get_user_config_dir()); print(GLib.get_system_data_dirs().join(":"));' 2>&1)"
GJS_DATA="$(printf '%s\n' "$GJS_PATHS" | sed -n '1p')"
GJS_CONF="$(printf '%s\n' "$GJS_PATHS" | sed -n '2p')"
GJS_SYS="$(printf '%s\n' "$GJS_PATHS" | sed -n '3p')"
echo "  GLib user data dir   = $GJS_DATA"
echo "  GLib user config dir = $GJS_CONF"
echo "  GLib system data dirs = $GJS_SYS"
[ "$GJS_DATA" = "$T/data" ] || unsafe "GLib user data dir is '$GJS_DATA', not the temporary directory." \
    "the nested Shell could discover extensions in your real ~/.local/share."
[ "$GJS_CONF" = "$T/config" ] || unsafe "GLib user config dir is '$GJS_CONF', not the temporary directory." \
    "the nested Shell could read or write your real ~/.config."
case ":$GJS_SYS:" in
    *":$REAL_HOME/"*|*":$REAL_DATA_HOME"*) unsafe "a system data directory points inside your home directory." \
        "extensions or schemas from your home directory could be loaded." ;;
esac

# 5c. Extension directory contents: exactly our UUID, no overlap with your live extension names.
FOUND="$(ls -1 "$T/data/gnome-shell/extensions")"
[ "$FOUND" = "$UUID" ] || unsafe "temporary extension directory contains: $FOUND" "unexpected extensions could load."
echo "  temporary user extension directory contains only: $FOUND"

# 5d. D-Bus: a separate session bus with no Shell on it, and a different address from the live bus.
BUS_PROBE="$(timeout 30 "${ISO_ENV[@]}" dbus-run-session -- bash -c \
    'printf "%s\n" "$DBUS_SESSION_BUS_ADDRESS"; gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell' 2>&1)"
NESTED_BUS="$(printf '%s\n' "$BUS_PROBE" | sed -n '1p')"
HAS_SHELL="$(printf '%s\n' "$BUS_PROBE" | sed -n '2p')"
echo "  isolated bus address differs from live bus: $([ -n "$NESTED_BUS" ] && [ "$NESTED_BUS" != "$LIVE_BUS" ] && echo yes || echo NO)"
echo "  org.gnome.Shell already owned on isolated bus: $HAS_SHELL"
[ -n "$NESTED_BUS" ] && [ "$NESTED_BUS" != "$LIVE_BUS" ] || unsafe "dbus-run-session did not give a separate bus address." \
    "the nested Shell could talk to your live session services."
case "$HAS_SHELL" in
    *false*) : ;;
    *) unsafe "the isolated bus reported an unexpected result for org.gnome.Shell: $HAS_SHELL" "bus separation is unconfirmed." ;;
esac

echo "  all pre-launch isolation checks passed"
echo
echo "  Still only verifiable after launch (the session verifies this itself and aborts on failure):"
echo "    - that the nested Shell honours GNOME_SHELL_SESSION_MODE=user and enables only the test extension"
echo "    - that gnome-extensions on the isolated bus lists none of your ${LIVE_COUNT} live extensions as enabled"

LOG_DIR="$ROOT_DIR/test-logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/nested-$STAMP.log"

RUN_CMD=(timeout --signal=TERM --kill-after=15 "${MAX_MINUTES}m"
    "${ISO_ENV[@]}" dbus-run-session -- bash "$TOOLS_DIR/nested-inner.sh" "$T")

echo
echo "== 6. Launch =="
echo "  command: ${RUN_CMD[*]}"
echo "  log file: $LOG"
echo "  maximum lifetime: ${MAX_MINUTES} minutes"
if [ "$DRY_RUN" -eq 1 ]; then
    echo
    echo "--dry-run given: all checks passed; nothing was launched. Cleaning up."
    exit 0
fi

if [ "$DEBUG_LEVEL" -ge 3 ]; then
    ulimit -c unlimited 2>/dev/null || echo "  note: could not raise the core size limit; a core dump may not be written."
    echo "  --debug-core: the nested Shell will be trapped at the first warning naming our root."
    echo "  Afterwards inspect it with:  coredumpctl list gnome-shell   then   coredumpctl gdb -1   and type: bt"
fi
printf 'T=%s\nLOG=%s\n' "$T" "$LOG" > "$LOG_DIR/last-session"
: > "$LOG"
tail -n 0 -F "$LOG" 2>/dev/null &
TAIL_PID=$!

echo
echo "Starting the nested session. A development window should appear."
echo "In ANOTHER terminal, from the project directory, use:"
echo "  bash tools/nested-ctl.sh status"
echo "  bash tools/nested-ctl.sh --help"
echo "Close the nested window or press Ctrl+C here to end the test."
echo

"${RUN_CMD[@]}" >> "$LOG" 2>&1 &
RUN_PID=$!
wait "$RUN_PID"
RC=$?
RUN_PID=""
echo
echo "Nested session ended (exit status $RC). Log saved at: $LOG"
exit 0
