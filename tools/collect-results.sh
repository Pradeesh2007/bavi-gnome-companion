#!/usr/bin/env bash
# tools/collect-results.sh [LOGFILE]
#
# Read-only. Gathers the evidence for docs/test-plan-0.1.md into ONE text file you can paste or attach.
#  * If a nested session is still running it also runs the safe read-only ctl commands (status, get, leakcheck, stalecheck).
#  * Otherwise it works from the newest log in test-logs/ (or the LOGFILE you give).
# It changes nothing: it only reads logs and prints. The report is written to test-logs/results-<timestamp>.txt
# and also printed. It cannot see what was on your screen: fill in the checklist at the end by hand.
set -u
export LC_ALL=C
# shellcheck source=common.sh

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

LOG="${1:-}"
[ -n "$LOG" ] || LOG="$(ls -t "/home/pradeesh/Projects/extention/desktop-companion"/test-logs/nested-*.log 2>/dev/null | head -n 1)"
[ -n "$LOG" ] && [ -f "$LOG" ] || { echo "No log found. Run a nested test first (bash tools/nested-test.sh) or pass a log path." >&2; exit 1; }

mkdir -p "/home/pradeesh/Projects/extention/desktop-companion/test-logs"
OUT="/home/pradeesh/Projects/extention/desktop-companion/test-logs/results-$(date +%Y%m%d-%H%M%S).txt"

PFX='\[desktop-companion\]'
count() { grep -c -E "$1" "$LOG" 2>/dev/null || true; }
first() { grep -m1 -E "$1" "$LOG" 2>/dev/null | cut -c1-220; }

report() {
echo "=== desktop-companion 0.1.0 results report ==="
echo "generated: $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
echo "log file : $LOG ($(wc -l < "$LOG") lines)"
echo

echo "=== A. Session still running? (read-only ctl) ==="
if bash "$TOOLS_DIR/nested-ctl.sh" status >/tmp/.dc_status.$$ 2>&1; then
    cat /tmp/.dc_status.$$
    echo "--- settings ---";   bash "$TOOLS_DIR/nested-ctl.sh" get 2>&1 | head -n 20
    echo "--- leakcheck ---";  bash "$TOOLS_DIR/nested-ctl.sh" leakcheck 2>&1
    if grep -q '\[desktop-companion\]\[debug\]' "$LOG"; then
        echo "--- stalecheck ---"; bash "$TOOLS_DIR/nested-ctl.sh" stalecheck 2>&1
        echo "--- traces ---";     bash "$TOOLS_DIR/nested-ctl.sh" traces 2>&1 | head -n 20
    fi
else
    echo "(no running nested session; analysing the log file only)"
fi
rm -f /tmp/.dc_status.$$
echo

echo "=== B. Evidence per test-plan row, counted from the log ==="
printf '%-4s %-34s %s\n' "row" "what" "evidence in the log"
printf '%-4s %-34s %s\n' "1" "startup" "enabled lines: $(count "$PFX enabled #"), 'started:' lines: $(count "$PFX started:")"
printf '%-4s %-34s %s\n' "" "" "first: $(first "$PFX started:")"
printf '%-4s %-34s %s\n' "5" "roaming (walks / arrivals)" "walking: $(count "$PFX walking"), arrived: $(count "$PFX arrived")"
printf '%-4s %-34s %s\n' "6" "clicks" "click lines: $(count "$PFX click")"
printf '%-4s %-34s %s\n' "7" "right-click menu opened" "menu opened: $(count "$PFX menu opened"), could-not-open: $(count 'could not open the menu')"
printf '%-4s %-34s %s\n' "8,9,10" "settings/mode changes" "config changed lines: $(count "$PFX config changed")"
printf '%-4s %-34s %s\n' "11" "summon" "summon lines: $(count "$PFX summon"), keybinding warnings: $(count 'keybinding .* could not be registered')"
printf '%-4s %-34s %s\n' "" "return home" "returning home: $(count "$PFX returning home")"
printf '%-4s %-34s %s\n' "12" "overview hide/show" "shown: $(count "$PFX overview shown"), hidden: $(count "$PFX overview hidden")"
printf '%-4s %-34s %s\n' "13" "work area changes" "work area changed: $(count "$PFX work area changed")"
printf '%-4s %-34s %s\n' "14" "reduced motion" "'animations=false' starts: $(count 'animations=false'), 'animations=true' starts: $(count 'animations=true')"
printf '%-4s %-34s %s\n' "16" "lifecycle" "enabled: $(count "$PFX enabled #"), disabled: $(count "$PFX disabled #")"
printf '%-4s %-34s %s\n' "" "" "last disable: $(grep -E "$PFX disabled #" "$LOG" | tail -n 1 | cut -c1-200)"
printf '%-4s %-34s %s\n' "15" "preferences window" "not logged by the Shell; judge it on screen"
echo

echo "=== C. Problems found in the log ==="
echo "JS errors / TypeErrors / extension errors:"
grep -n -E 'JS ERROR|TypeError|ReferenceError|desktop-companion.*(failed|error)|could not open the menu|enable\(\) failed' "$LOG" | cut -c1-260 | head -n 40
[ "$(grep -c -E 'JS ERROR|TypeError|ReferenceError|desktop-companion.*(failed|error)|could not open the menu|enable\(\) failed' "$LOG")" -eq 0 ] && echo "  (none)"
echo
echo "Clutter warnings naming our actors (stale-actor issue):  $(count 'Spurious clutter_actor_allocate.*desktop-companion-root')"
echo "Other Clutter/Gjs warnings or criticals (first 15):"
grep -n -E 'Clutter-(WARNING|CRITICAL)|Gjs-CRITICAL|St-(WARNING|CRITICAL)|Gtk-CRITICAL' "$LOG" | grep -v 'desktop-companion-root' | cut -c1-240 | head -n 15
echo "Stylesheet/image problems (first 10):"
grep -n -i -E 'background-image|could not (load|open|find).*png|Failed to load|St-WARNING' "$LOG" | cut -c1-240 | head -n 10
echo

echo "=== D. Last 120 extension log lines ==="
grep -E "$PFX" "$LOG" | tail -n 120 | cut -c1-240
echo

echo "=== E. Checklist to fill in by hand (what you SAW; copy this block and edit) ==="
cat <<'EOT'
row | test                    | pass/fail | what I saw / exact problem
 1  | startup                 |           |
 2  | appearance (sharp? edge? size) |    |
 3  | idle bob                |           |
 4  | pointer look            |           |
 5  | roaming + turn via front|           |
 6  | click (and click while walking) |   |
 7  | right-click menu opens/closes |     |
 8  | menu actions work       |           |
 9  | settings keys (height, corner, quiet, roam...) | |
10  | hide / show             |           |
11  | summon shortcut         |           |
12  | overview hides her      |           |
13  | fullscreen              |           |
14  | reduced motion          |           |
15  | preferences window      |           |
16  | 25 enable/disable cycles|           |
17  | stalecheck (only if run)|           |
EOT
}

report > "$OUT" 2>&1
cat "$OUT"
echo
echo "Report saved to: $OUT"
