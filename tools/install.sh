#!/usr/bin/env bash
# tools/install.sh [--uninstall] [--yes]
#
# Copies the runtime files into your user extension directory and compiles the schema there.
# It NEVER enables the extension, never changes GSettings/dconf and never starts or restarts a Shell.
#
# For Phase 0 you do not need this script: tools/nested-test.sh installs a private copy into a
# temporary directory. Installing into your live session only makes the extension available; on
# Wayland a new extension version is picked up after logging out and in.
#
# --uninstall removes only the directory <data-home>/gnome-shell/extensions/<uuid>.
set -u
export LC_ALL=C

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

UNINSTALL=0
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --uninstall) UNINSTALL=1 ;;
        --yes) ASSUME_YES=1 ;;
        -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

if [ "$(id -u)" -eq 0 ]; then
    echo "Refusing to run as root." >&2
    exit 1
fi

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"

confirm() {
    [ "$ASSUME_YES" -eq 1 ] && return 0
    printf '%s [y/N] ' "$1"
    read -r answer
    [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}

if [ "$UNINSTALL" -eq 1 ]; then
    if [ ! -d "$DEST" ]; then
        echo "Nothing to remove: $DEST does not exist."
        exit 0
    fi
    echo "This will remove: $DEST"
    echo "It will not change any GNOME settings. If the extension is listed as enabled, disable it first:"
    echo "  gnome-extensions disable $UUID"
    confirm "Remove it?" || { echo "Cancelled."; exit 1; }
    case "$DEST" in
        */gnome-shell/extensions/"$UUID") rm -rf -- "$DEST" ;;
        *) echo "Unexpected path, not removing: $DEST" >&2; exit 1 ;;
    esac
    echo "Removed."
    exit 0
fi

have glib-compile-schemas || { echo "glib-compile-schemas not found." >&2; exit 1; }

echo "This will copy the extension to: $DEST"
echo "It will not enable the extension or change any GNOME settings."
[ -e "$DEST" ] && echo "An existing copy there will be replaced."
confirm "Install?" || { echo "Cancelled."; exit 1; }

case "$DEST" in
    */gnome-shell/extensions/"$UUID") rm -rf -- "$DEST" ;;
    *) echo "Unexpected path: $DEST" >&2; exit 1 ;;
esac
copy_runtime "$DEST" || exit 1
glib-compile-schemas "$DEST/schemas" || exit 1

echo "Installed to $DEST (not enabled)."
echo "To remove it later: bash tools/install.sh --uninstall"
