#!/usr/bin/env bash
# tools/nested-inner.sh <temp-dir>
# Internal: started by nested-test.sh INSIDE `dbus-run-session`, with the isolated environment already
# exported. Do not run this directly.
#
# It starts the nested Shell, waits for it, verifies at runtime that only the test extension is
# enabled and none of your live extensions are present, and aborts the nested Shell if not.
set -u
export LC_ALL=C

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

T="${1:-}"
[ -n "$T" ] && [ -d "$T" ] || { echo "[inner] missing temp dir argument" >&2; exit 2; }
[ "${GSETTINGS_BACKEND:-}" = "keyfile" ] && [ "${XDG_DATA_HOME:-}" = "$T/data" ] \
    || { echo "[inner] isolated environment is not active; refusing to start" >&2; exit 2; }

SHELL_PID=""
stop_shell() {
    if [ -n "$SHELL_PID" ] && kill -0 "$SHELL_PID" 2>/dev/null; then
        kill -TERM "$SHELL_PID" 2>/dev/null
        for _ in $(seq 1 40); do
            kill -0 "$SHELL_PID" 2>/dev/null || break
            sleep 0.5
        done
        kill -0 "$SHELL_PID" 2>/dev/null && kill -KILL "$SHELL_PID" 2>/dev/null
    fi
}
trap stop_shell EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# Environment file used by nested-ctl.sh to talk to THIS session only.
{
    echo "export DBUS_SESSION_BUS_ADDRESS='$DBUS_SESSION_BUS_ADDRESS'"
    echo "export HOME='$HOME'"
    echo "export XDG_CONFIG_HOME='$XDG_CONFIG_HOME'"
    echo "export XDG_DATA_HOME='$XDG_DATA_HOME'"
    echo "export XDG_CACHE_HOME='$XDG_CACHE_HOME'"
    echo "export XDG_STATE_HOME='$XDG_STATE_HOME'"
    echo "export XDG_DATA_DIRS='$XDG_DATA_DIRS'"
    echo "export GSETTINGS_BACKEND=keyfile"
    echo "export GSETTINGS_SCHEMA_DIR='$T/data/gnome-shell/extensions/$UUID/schemas'"
} > "$T/session.env"

echo "[inner] starting: gnome-shell --devkit --wayland --no-x11"
gnome-shell --devkit --wayland --no-x11 &
SHELL_PID=$!
echo "$SHELL_PID" > "$T/shell.pid"

bus_has_name() {
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner "$1" 2>/dev/null | grep -q true
}

echo "[inner] waiting for org.gnome.Shell on the isolated bus (up to 90 s)"
ready=0
for _ in $(seq 1 180); do
    kill -0 "$SHELL_PID" 2>/dev/null || { echo "[inner] gnome-shell exited before becoming ready" >&2; exit 1; }
    if bus_has_name org.gnome.Shell; then ready=1; break; fi
    sleep 0.5
done
[ "$ready" -eq 1 ] || { echo "[inner] timed out waiting for org.gnome.Shell" >&2; exit 1; }

echo "[inner] waiting for the extension to appear in the enabled list (up to 40 s)"
found=0
for _ in $(seq 1 80); do
    kill -0 "$SHELL_PID" 2>/dev/null || { echo "[inner] gnome-shell exited" >&2; exit 1; }
    if gnome-extensions list --enabled 2>/dev/null | grep -Fxq "$UUID"; then found=1; break; fi
    sleep 0.5
done

ENABLED="$(gnome-extensions list --enabled 2>/dev/null)"
ALL_LISTED="$(gnome-extensions list 2>/dev/null)"
echo "[inner] enabled extensions on the isolated Shell:"
printf '%s\n' "${ENABLED:-<none>}" | sed 's/^/[inner]   /'

violation=""
[ "$found" -eq 1 ] || violation="the test extension did not become enabled"
if [ -n "$ENABLED" ] && [ "$ENABLED" != "$UUID" ]; then
    violation="enabled extensions other than the test extension are present"
fi
if [ -s "$T/live-uuids.txt" ]; then
    # Any of your live extension names appearing anywhere in the isolated Shell's list is a violation.
    leaked="$(printf '%s\n' "$ALL_LISTED" | grep -Fxf "$T/live-uuids.txt" | grep -Fxv "$UUID" || true)"
    if [ -n "$leaked" ]; then
        violation="extensions from your live session are visible to the isolated Shell"
    fi
fi
if [ -n "$violation" ]; then
    echo "[inner] ISOLATION VIOLATION: $violation. Aborting the nested Shell." >&2
    exit 3
fi

echo "[inner] runtime isolation verified: only $UUID is enabled; no live extension names are visible."
echo "[inner] READY. Use tools/nested-ctl.sh from another terminal."
echo "[inner] extension info:"
gnome-extensions info "$UUID" 2>&1 | sed 's/^/[inner]   /'

wait "$SHELL_PID"
echo "[inner] nested gnome-shell exited with status $?"
SHELL_PID=""
