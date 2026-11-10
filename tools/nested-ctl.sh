#!/usr/bin/env bash
# tools/nested-ctl.sh <command> [args]
#
# Controls the isolated nested session started by tools/nested-test.sh. It sources that session's
# environment inside THIS process only (your terminal is not modified) and refuses to run if the
# nested D-Bus address equals your live one or the nested Shell is not running.
#
# Commands:
#   status                 extension state, hidden flag, enabled list, nested Shell memory (RSS)
#   hide | show            set the 'hidden' GSettings key in the ISOLATED settings
#   set KEY VALUE          set any extension key in the ISOLATED settings (for example: set quiet-mode true)
#   get [KEY]              read one key, or every key, from the ISOLATED settings
#   disable | enable       gnome-extensions disable/enable on the ISOLATED Shell
#   cycle N [DELAY_SEC]    N disable/enable cycles (default delay 2 s), then a leak check
#   leakcheck              inspect the log for resources left after the last disable
#   logs [N]               last N extension log lines (default 40)
#   errors                 log lines that look like Shell/JS errors
#   stalecheck             regression test for stale root actors (needs: nested-test.sh --debug)
#   traces                 JS stacks captured when Clutter warned (needs: nested-test.sh --debug-trace)
#   gsettings ARGS...      run gsettings against the ISOLATED settings (for example reduced-motion tests)
#   launch CMD [ARGS...]   start a Wayland application inside the nested session
#   memory                 nested Shell resident memory (RSS)
set -u
ORIG_LC_ALL="${LC_ALL-__unset__}"   # applications started by `launch` must keep your real locale
export LC_ALL=C

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

die() { echo "nested-ctl: $*" >&2; exit 1; }

case "${1:-}" in
    ""|-h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

LIVE_BUS="${DBUS_SESSION_BUS_ADDRESS:-}"
POINTER="$ROOT_DIR/test-logs/last-session"
[ -f "$POINTER" ] || die "no session found. Start one with: bash tools/nested-test.sh"
T="$(sed -n 's/^T=//p' "$POINTER")"
LOG="$(sed -n 's/^LOG=//p' "$POINTER")"
[ -n "$T" ] && [ -f "$T/session.env" ] || die "the last session's temporary directory is gone. Start a new one."
SHELL_PID="$(cat "$T/shell.pid" 2>/dev/null)"
[ -n "$SHELL_PID" ] && kill -0 "$SHELL_PID" 2>/dev/null || die "the nested Shell is not running."
[ "$(ps -o comm= -p "$SHELL_PID" 2>/dev/null)" = "gnome-shell" ] || die "PID $SHELL_PID is not a gnome-shell process."

# shellcheck disable=SC1090,SC1091
source "$T/session.env"
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ "$DBUS_SESSION_BUS_ADDRESS" != "$LIVE_BUS" ] \
    || die "refusing: the nested D-Bus address is missing or equals your live session bus."

PFX='\[desktop-companion\]'
count_log() { grep -c "$PFX $1" "$LOG" 2>/dev/null || true; }
rss_mb() { echo $(( $(ps -o rss= -p "$SHELL_PID" 2>/dev/null | tr -d ' ') / 1024 )); }

wait_for_count() { # pattern, minimum count, timeout seconds
    local i
    for ((i = 0; i < $3 * 5; i++)); do
        [ "$(count_log "$1")" -ge "$2" ] && return 0
        sleep 0.2
    done
    return 1
}

do_leakcheck() {
    local last enables disables
    enables="$(count_log 'enabled #')"
    disables="$(count_log 'disabled #')"
    last="$(grep "$PFX disabled #" "$LOG" | tail -n 1)"
    echo "enable log lines: $enables, disable log lines: $disables"
    if [ -z "$last" ]; then
        echo "No 'disabled' line in the log yet; run: bash tools/nested-ctl.sh disable"
        return 1
    fi
    echo "last disable line: $last"
    local spurious distinct
    spurious="$(grep -c 'Spurious clutter_actor_allocate.*desktop-companion-root' "$LOG" 2>/dev/null || true)"
    distinct="$(grep -o 'actor 0x[0-9a-f]*/desktop-companion-root' "$LOG" 2>/dev/null | sort -u | grep -c . || true)"
    echo "Clutter 'Spurious allocate' warnings naming desktop-companion-root: ${spurious:-0} lines, ${distinct:-0} distinct actors"
    if ! printf '%s\n' "$last" | grep -q 'live: signals=0 timeouts=0 callbacks=0 actors=0$'; then
        echo "RESULT: FAIL (counters are not all zero after disable)"
        return 1
    fi
    if [ "${spurious:-0}" -gt 0 ]; then
        echo "RESULT: COUNTERS PASS, BUT stale root actors were still being allocated by Clutter (see warnings above)"
        return 1
    fi
    echo "RESULT: PASS (the extension's own counters report zero live signals, timers, callbacks and actors; no stale-actor warnings)"
    return 0
}

case "$1" in
    status)
        echo "nested Shell PID: $SHELL_PID, RSS: $(rss_mb) MiB"
        gnome-extensions info "$UUID" 2>&1
        echo "hidden = $(gsettings get "$SCHEMA_ID" hidden 2>&1)"
        echo "enabled extensions:"
        gnome-extensions list --enabled 2>&1 | sed 's/^/  /'
        echo "log: $LOG"
        ;;
    set)     [ $# -ge 3 ] || die "usage: set KEY VALUE"; gsettings set "$SCHEMA_ID" "$2" "$3" && echo "$2=$3" ;;
    get)     if [ $# -ge 2 ]; then gsettings get "$SCHEMA_ID" "$2"; else gsettings list-recursively "$SCHEMA_ID"; fi ;;
    hide)    gsettings set "$SCHEMA_ID" hidden true && echo "hidden=true" ;;
    show)    gsettings set "$SCHEMA_ID" hidden false && echo "hidden=false" ;;
    disable) gnome-extensions disable "$UUID" && echo "disable requested" ;;
    enable)  gnome-extensions enable "$UUID" && echo "enable requested" ;;
    cycle)
        n="${2:-10}"
        delay="${3:-2}"
        case "$n" in ''|*[!0-9]*) die "N must be a whole number" ;; esac
        echo "nested Shell RSS before: $(rss_mb) MiB"
        for ((i = 1; i <= n; i++)); do
            d0="$(count_log 'disabled #')"
            e0="$(count_log 'enabled #')"
            gnome-extensions disable "$UUID" || die "disable failed on cycle $i"
            wait_for_count 'disabled #' $((d0 + 1)) 15 || die "no 'disabled' log line within 15 s on cycle $i"
            sleep "$delay"
            gnome-extensions enable "$UUID" || die "enable failed on cycle $i"
            wait_for_count 'enabled #' $((e0 + 1)) 15 || die "no 'enabled' log line within 15 s on cycle $i"
            sleep "$delay"
            echo "cycle $i/$n done"
        done
        echo "nested Shell RSS after: $(rss_mb) MiB"
        echo "Now disabling once more for the final leak check."
        d0="$(count_log 'disabled #')"
        gnome-extensions disable "$UUID"
        wait_for_count 'disabled #' $((d0 + 1)) 15 || die "no final 'disabled' log line"
        do_leakcheck
        echo "Re-enable when you are done: bash tools/nested-ctl.sh enable"
        ;;
    leakcheck) do_leakcheck ;;
    logs)    grep "$PFX" "$LOG" | tail -n "${2:-40}" ;;
    errors)  grep -E 'JS ERROR|Gjs-CRITICAL|CRITICAL|Clutter-WARNING|Spurious|Source ID|desktop-companion.*(failed|error)' "$LOG" | tail -n 60 ;;
    memory)  echo "nested Shell RSS: $(rss_mb) MiB" ;;
    stalecheck)
        grep -q '\[desktop-companion\]\[debug\]' "$LOG" \
            || die "no debug lines in the log. Start the session with: bash tools/nested-test.sh --debug"
        awk '
        function ts(line) { if (match(line, /[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/)) return substr(line, RSTART, RLENGTH); return "?" }
        function rootid(line) { match(line, /root#[0-9]+/); return substr(line, RSTART + 5, RLENGTH - 5) }
        function tracked(line) { match(line, /tracked=-?[0-9]+/); return substr(line, RSTART + 8, RLENGTH - 8) + 0 }
        function selft(line) { if (match(line, /self-tracked=[a-z?]+/)) return substr(line, RSTART + 13, RLENGTH - 13); return "?" }
        /\[desktop-companion\]\[debug\] root#[0-9]+ created native=/ {
            n = rootid($0); match($0, /native=0x[0-9a-f]+/); a = substr($0, RSTART + 7, RLENGTH - 7)
            cur[a] = n; created_at[n] = ts($0); tracked_created[n] = tracked($0); self_created[n] = selft($0); nroots++
        }
        /\[desktop-companion\]\[debug\] root#[0-9]+ after-removeChrome/ { n = rootid($0); tracked_after[n] = tracked($0); self_after[n] = selft($0); have_after[n] = 1 }
        /\[desktop-companion\]\[debug\] root#[0-9]+ destroyed/ { n = rootid($0); destroyed[n] = 1; destroyed_at[n] = ts($0) }
        /\[desktop-companion\]\[debug\] gc-check/ { lastgc = $0 }
        /Spurious clutter_actor_allocate.*desktop-companion-root/ {
            match($0, /actor 0x[0-9a-f]+/); a = substr($0, RSTART + 6, RLENGTH - 6); n = cur[a]; total++
            if (n == "") { unknown++; printf("  warning %s: %s -> no logged root has that address\n", ts($0), a) }
            else if (destroyed[n]) { stale++; printf("  warning %s: %s -> root#%s (created %s, destroyed %s)\n", ts($0), a, n, created_at[n], destroyed_at[n]) }
            else { live++; printf("  warning %s: %s -> root#%s, which is NOT destroyed\n", ts($0), a, n) }
        }
        END {
            bad = 0; info = 0
            for (n in have_after) {
                if (self_created[n] != "true") { bad++; printf("  root#%s: was not in the layout manager tracking list right after addChrome (self-tracked=%s)\n", n, self_created[n]) }
                if (self_after[n] != "false") { bad++; printf("  root#%s: STILL in the layout manager tracking list after removeChrome (self-tracked=%s)\n", n, self_after[n]) }
                if (tracked_after[n] != tracked_created[n] - 1) { info++ }
            }
            printf("roots created: %d\n", nroots)
            printf("Clutter spurious-allocate warnings naming desktop-companion-root: %d (on destroyed roots: %d, unknown address: %d, on roots not destroyed: %d)\n", total, stale, unknown, live)
            printf("roots still tracked after removeChrome (exact membership test): %d\n", bad)
            printf("roots whose GLOBAL tracked count differs from created-1 (informational; other Shell chrome changes it too): %d\n", info)
            if (lastgc != "") { sub(/^.*gc-check /, "", lastgc); printf("last gc-check (informational): %s\n", lastgc) }
            if (total > 0 || bad > 0) { print "RESULT: FAIL (stale root actors detected)"; exit 1 }
            print "RESULT: PASS (no stale-root warnings; every root left the layout manager tracking list)"
        }' "$LOG"
        ;;
    traces)
        grep -n 'clutter-warning-intercepted\|probe installed\|trapping now' "$LOG" | cut -c1-600 \
            || echo "no intercepted warnings in the log (needs: nested-test.sh --debug-trace)"
        ;;
    gsettings) shift; gsettings "$@" ;;
    launch)
        shift
        [ $# -gt 0 ] || die "usage: launch CMD [ARGS...]"
        disp="$(grep -o "Using Wayland display name '[^']*'" "$LOG" | tail -n 1 | sed "s/.*'\(.*\)'/\1/")"
        [ -n "$disp" ] || die "could not find the nested Wayland display name in the log."
        echo "launching '$*' on nested display $disp"
        if [ "$ORIG_LC_ALL" = "__unset__" ]; then
            env -u LC_ALL WAYLAND_DISPLAY="$disp" "$@" &
        else
            env LC_ALL="$ORIG_LC_ALL" WAYLAND_DISPLAY="$disp" "$@" &
        fi
        ;;
    *) die "unknown command '$1' (try --help)" ;;
esac
