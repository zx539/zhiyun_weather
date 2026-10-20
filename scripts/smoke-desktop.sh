#!/usr/bin/env bash
# Runs a separate headless Shell, not the user's running desktop.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
for program in gnome-shell dbus-run-session gsettings gjs python3 timeout; do
    command -v "$program" >/dev/null
done
glib-compile-schemas --strict schemas
smoke_root=$(mktemp -d /tmp/rational-weather-desktop-XXXXXX)
export XDG_RUNTIME_DIR="$smoke_root/runtime"
export XDG_DATA_HOME="$smoke_root/data"
export XDG_CONFIG_HOME="$smoke_root/config"
export XDG_CACHE_HOME="$smoke_root/cache"
export RATIONAL_WEATHER_SMOKE_REPORT="$smoke_root/result.json"
export GSETTINGS_BACKEND=keyfile
export GNOME_SHELL_SESSION_MODE=user
export LIBGL_ALWAYS_SOFTWARE=1
unset DISPLAY WAYLAND_DISPLAY
mkdir -m 700 -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
smoke_extension="$XDG_DATA_HOME/gnome-shell/extensions/rational-weather-smoke@local"
mkdir -p "$smoke_extension/tests"
cp extension.js "$smoke_extension/subject.js"
cp tests/shell-smoke.js "$smoke_extension/extension.js"
cp prefs.js stylesheet.css "$smoke_extension/"
cp -R lib schemas icons "$smoke_extension/"
cp tests/gtk-smoke.mjs tests/fixtures.mjs tests/weather-cases.mjs "$smoke_extension/tests/"
python3 - "$smoke_extension/metadata.json" <<'PY'
import json, pathlib, sys
metadata = json.loads(pathlib.Path('metadata.json').read_text())
metadata['uuid'] = 'rational-weather-smoke@local'
metadata['name'] = '知云天气 · 隔离验证'
pathlib.Path(sys.argv[1]).write_text(json.dumps(metadata))
PY
gsettings set org.gnome.shell enabled-extensions "['rational-weather-smoke@local']"
gsettings set org.gnome.shell disable-user-extensions false
printf '隔离测试日志：%s/shell.log\n' "$smoke_root"
status=0
timeout 60s dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --virtual-monitor=1280x900 >"$smoke_root/shell.log" 2>&1 || status=$?
python3 - "$RATIONAL_WEATHER_SMOKE_REPORT" "$smoke_root/shell.log" "$status" <<'PY'
import json, pathlib, sys
report, log = map(pathlib.Path, sys.argv[1:3])
if not report.exists():
    print(log.read_text(errors='replace')[-10000:])
    raise SystemExit(f'未完成桌面验证（进程状态 {sys.argv[3]}）。日志保留在 {log}')
result = json.loads(report.read_text())
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if result.get('passed') and sys.argv[3] == '0' else 1)
PY
