#!/usr/bin/env bash
# tools/common.sh
# Shared definitions for the scripts in tools/. Source this file; do not execute it.

UUID="desktop-companion@pradeesh2007.github.io"
SCHEMA_ID="org.gnome.shell.extensions.desktop-companion"
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TOOLS_DIR/.." && pwd)"

# Files and directories that make up the installed extension (tools/ and docs/ are not installed).
RUNTIME_ITEMS=(metadata.json extension.js prefs.js stylesheet.css lib schemas assets)

have() { command -v "$1" >/dev/null 2>&1; }

# copy_runtime <destination-dir>: copies the runtime files, removing any stale compiled schema.
copy_runtime() {
    local dest="$1" item
    mkdir -p "$dest" || return 1
    for item in "${RUNTIME_ITEMS[@]}"; do
        if [ ! -e "$ROOT_DIR/$item" ]; then
            echo "missing project item: $item" >&2
            return 1
        fi
        cp -R "$ROOT_DIR/$item" "$dest/" || return 1
    done
    rm -f "$dest/schemas/gschemas.compiled"
}
