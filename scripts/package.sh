#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
bash scripts/check.sh
mkdir -p dist
archive="$PWD/dist/rational-weather@local.shell-extension.zip"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
cp metadata.json extension.js prefs.js stylesheet.css README.md "$stage/"
cp -R lib schemas icons "$stage/"
rm -f -- "$archive"
(cd -- "$stage" && zip -qr "$archive" metadata.json extension.js prefs.js stylesheet.css README.md lib schemas icons)
printf '已生成：%s\n' "$archive"
