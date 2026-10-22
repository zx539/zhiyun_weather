#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
glib-compile-schemas --strict --dry-run schemas
for source in extension.js prefs.js lib/*.js lib/*.mjs tests/*.mjs tests/*.js scripts/*.mjs; do
    node --check "$source"
done
for script in scripts/*.sh; do
    bash -n "$script"
done
npm test
glib-compile-schemas --strict schemas
GSETTINGS_BACKEND=memory gjs -m tests/gjs-smoke.mjs
GSETTINGS_BACKEND=memory gjs -m tests/gjs-service.mjs
gjs -m tests/gjs-credentials.mjs
gjs -m tests/gjs-artwork.mjs
# Fedora 44 ships Shell/Mutter typelibs in these private locations.
GI_TYPELIB_PATH="/usr/lib64/gnome-shell:/usr/lib64/mutter-18${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}" \
LD_LIBRARY_PATH="/usr/lib64/gnome-shell:/usr/lib64/mutter-18${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    gjs -m tests/gjs-interfaces.mjs
