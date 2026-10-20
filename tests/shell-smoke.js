// Installed only by scripts/smoke-desktop.sh into an isolated GNOME session.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import RationalWeather from './subject.js';
import {parseWeather, liveStatus, HOUR, chinaDate} from './lib/core.mjs';
import {liveResponse, forecastResponse, CITY} from './tests/fixtures.mjs';
import {WEATHER_CASES} from './tests/weather-cases.mjs';

function check(condition, message) { if (!condition) throw new Error(message); }
function texts(actor) {
    return [actor.text ?? '', ...actor.get_children().flatMap(texts)].filter(Boolean);
}

export default class DesktopSmoke extends RationalWeather {
    enable() {
        // Let Shell finish startup before testing actor insertion and removal.
        this._testTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._testTimer = null;
            void this._run();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _run() {
        const report = Gio.File.new_for_path(GLib.getenv('RATIONAL_WEATHER_SMOKE_REPORT'));
        const original = Main.panel.statusArea.dateMenu._weatherItem;
        const parent = original.get_parent();
        const position = parent.get_children().indexOf(original);
        let result;
        try {
            super.enable();
            check(!this._service.fatal, this._service.fatal);
            check(!original.get_parent(), 'original calendar actor still attached');
            check(this._calendar.get_parent() === parent, 'custom calendar actor not inserted');
            check(this._temperature.text === '--°', 'empty state temperature incorrect');
            check(texts(this._details).some(t => t.includes('请设置城市')), 'configuration hint missing');
            // Prevent all real requests, including accidental UI-triggered ones.
            this._service._lookupKey = async () => { throw new Error('unexpected key lookup'); };
            this._service._fetch = async () => { throw new Error('unexpected network'); };
            this._settings.set_string('city', CITY);
            this._service.configure();
            const now = Date.now();
            const published = new Date(now + 8 * HOUR).toISOString().slice(0, 19).replace('T', ' ');
            const live = liveResponse();
            const forecast = forecastResponse();
            live.lives[0].reporttime = published;
            forecast.forecasts[0].reporttime = published;
            forecast.forecasts[0].casts.forEach((day, index) => {
                day.date = chinaDate(now + index * 24 * HOUR);
            });
            this._service.engine.state.live = {value: parseWeather(live, 'live', CITY), fetchedAt: now};
            this._service.engine.state.forecast = {value: parseWeather(forecast, 'forecast', CITY), fetchedAt: now};
            this._render();
            check(this._temperature.text === '18°', 'panel temperature not rendered');
            check(texts(this._details).includes('四天预报'), 'forecast details missing');
            check(texts(this._calendarBox).some(t => t.includes('18°')), 'calendar temperature missing');
            check(this._scene?.appearance.kind === 'clear', 'weather background missing');
            check(!this._scene.animating, 'background animated while menu was closed');
            const count = this._service.engine.usage();
            this._indicator.menu.open();
            this._calendar.emit('clicked');
            check(this._service.engine.usage() === count, 'opening UI consumed quota');
            for (const {weather, kind} of WEATHER_CASES) {
                const previous = this._scene;
                this._service.engine.state.live.value.weather = weather;
                this._render();
                check(this._scene.appearance.kind === kind, `incorrect scene for ${weather}`);
                if (previous !== this._scene) check(!previous.animating, 'old background animation leaked');
                check(this._panel.style_class.includes(`rw-panel--${this._scene.appearance.className}`),
                    'panel and background styles diverged');
            }
            this._indicator.menu.close();
            check(!this._scene.animating, 'background continued animating after closing menu');
            const stale = this._service.engine.state.live;
            stale.fetchedAt = now - 4 * HOUR;
            check(liveStatus(stale, now).hidden, 'stale fixture not hidden');
            this._render();
            check(this._temperature.text === '--°', 'stale temperature still shown as current');
            check(texts(this._details).some(t => t.includes('历史缓存')), 'stale details warning missing');
            check(this._scene.appearance.kind === 'unknown', 'stale weather kept an active scene');

            const child = Gio.Subprocess.new(['gjs', '-m', `${this.path}/tests/gtk-smoke.mjs`], Gio.SubprocessFlags.NONE);
            await new Promise((resolve, reject) => child.wait_check_async(null, (process, res) => {
                try { process.wait_check_finish(res); resolve(); } catch (error) { reject(error); }
            }));
            super.disable();
            check(original.get_parent() === parent, 'original calendar actor not restored');
            check(parent.get_children().indexOf(original) === position, 'original calendar position changed');
            check(!Main.panel.statusArea[this.uuid], 'panel indicator leaked after disable');
            super.enable();
            super.disable();
            check(original.get_parent() === parent, 'repeated enable/disable failed');
            result = {passed: true, checks: ['empty state', 'current weather', 'four-day forecast',
                'calendar replacement', 'menu opens without requests', 'stale state', 'GTK settings',
                'all weather backgrounds', 'background stop/cleanup', 'calendar restore', 'repeated enable/disable']};
        } catch (error) {
            result = {passed: false, error: `${error.message}\n${error.stack}`};
            try { super.disable(); } catch { /* Preserve the first failure. */ }
        }
        report.replace_contents(new TextEncoder().encode(JSON.stringify(result, null, 2)), null, false,
            Gio.FileCreateFlags.PRIVATE, null);
        global.context.terminate();
    }

    disable() {
        if (this._testTimer) GLib.source_remove(this._testTimer);
        this._testTimer = null;
        super.disable();
    }
}
