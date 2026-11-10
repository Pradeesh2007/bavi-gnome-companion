#!/usr/bin/env bash
# tools/package.sh
# Builds dist/<uuid>.shell-extension.zip. It only reads the project and writes into dist/.
# It does not install anything, does not touch your desktop settings and does not start a Shell.
#
# Primary method: `gnome-extensions pack`. If that fails, a Python zipfile fallback builds an
# equivalent bundle (this also answers whether pack works here without the `zip` executable).
set -u
export LC_ALL=C

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OUT_DIR="$ROOT_DIR/dist"
ZIP="$OUT_DIR/$UUID.shell-extension.zip"
mkdir -p "$OUT_DIR" || exit 1

method=""
if have gnome-extensions; then
    echo "Trying: gnome-extensions pack"
    if (cd "$ROOT_DIR" && gnome-extensions pack --force \
            --out-dir "$OUT_DIR" \
            --schema "schemas/$SCHEMA_ID.gschema.xml" \
            --extra-source lib \
            --extra-source assets \
            .); then
        method="gnome-extensions pack"
    else
        echo "gnome-extensions pack failed (exit status $?); trying the Python fallback."
    fi
else
    echo "gnome-extensions not found; trying the Python fallback."
fi

if [ -z "$method" ]; then
    have python3 || { echo "python3 not found; cannot build the zip." >&2; exit 1; }
    have glib-compile-schemas || { echo "glib-compile-schemas not found." >&2; exit 1; }
    STAGE="$(mktemp -d "${TMPDIR:-/tmp}/desktop-companion-pack.XXXXXXXX")" || exit 1
    trap 'rm -rf -- "$STAGE"' EXIT
    copy_runtime "$STAGE/ext" || exit 1
    glib-compile-schemas "$STAGE/ext/schemas" || exit 1
    rm -f "$ZIP"
    python3 - "$STAGE/ext" "$ZIP" <<'PY' || exit 1
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for base, _dirs, files in os.walk(src):
        for name in sorted(files):
            full = os.path.join(base, name)
            z.write(full, os.path.relpath(full, src))
PY
    method="python3 zipfile fallback"
fi

echo
echo "Built with: $method"
echo "Bundle: $ZIP"
if have unzip; then
    echo
    echo "Contents:"
    unzip -l "$ZIP" | sed 's/^/  /'
fi
