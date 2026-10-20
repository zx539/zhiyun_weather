import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {WeatherEngine, MINUTE, monthKey} from './core.mjs';
import {RefreshSchedule} from './schedule.mjs';
import {lookupKey} from './secret.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function safeError(message) {
    const error = new Error(message);
    error.safeMessage = message;
    return error;
}

export class WeatherService {
    constructor(settings, changed, {dataDirectory = null} = {}) {
        this.settings = settings;
        this.changed = changed;
        this.alive = true;
        this.suspended = false;
        this.cancellables = new Set();
        this.waits = new Map();
        this.session = new Soup.Session({timeout: 20, user_agent: 'ZhiyunWeather/0.3.0'});
        const directory = dataDirectory ?? GLib.build_filenamev([GLib.get_user_data_dir(), 'rational-weather']);
        this.file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'state.json']));
        let state = null;
        try {
            if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
                throw new Error('directory');
            try {
                const [, bytes] = this.file.load_contents(null);
                if (bytes.length > 2_000_000) throw new Error('oversized');
                state = JSON.parse(decoder.decode(bytes));
                if (state === null) throw new Error('invalid state');
            } catch (error) {
                if (!error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) throw error;
            }
            this.engine = new WeatherEngine({state, now: () => Date.now(),
                save: value => this._save(value), fetch: (...args) => this._fetch(...args),
                lookupKey: () => this._lookupKey(), sleep: ms => this._sleep(ms),
                changed: () => { if (this.alive) this.changed(); }});
            // configure() may notify; views are installed by the extension afterwards.
            this.configure();
        } catch {
            this.fatal = '无法读取或保存本地数据，已停止请求。请检查 ~/.local/share/rational-weather/state.json 的权限及内容。';
        }
    }

    _save(state) {
        this.file.replace_contents(encoder.encode(JSON.stringify(state)), null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        // replace_contents preserves an existing file's mode; make the cache private on every write.
        try {
            this.file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            throw new Error('无法设置本地缓存权限');
        }
        this._syncUsage();
    }

    _syncUsage() {
        const month = monthKey(Date.now());
        const count = this.engine?.state.ledger[month] ?? 0;
        this.settings.set_int('usage-count', count);
        this.settings.set_string('usage-month', month);
    }

    async _lookupKey() {
        const cancellable = new Gio.Cancellable();
        this.cancellables.add(cancellable);
        try { return await lookupKey(cancellable); } finally { this.cancellables.delete(cancellable); }
    }

    async _fetch(kind, city, key) {
        const extension = kind === 'live' ? 'base' : 'all';
        const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}&city=${city}&extensions=${extension}&output=JSON`;
        const message = Soup.Message.new('GET', url);
        // A redirect must never forward a credential-bearing URL.
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        const cancellable = new Gio.Cancellable();
        this.cancellables.add(cancellable);
        try {
            const bytes = await new Promise((resolve, reject) => {
                this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                    try { resolve(session.send_and_read_finish(result)); } catch { reject(safeError('网络请求失败或超时')); }
                });
            });
            if (message.status_code !== 200)
                throw safeError(`天气接口 HTTP 错误（${message.status_code}）`);
            if (bytes.get_size() > 1_000_000) throw safeError('接口响应过大');
            try { return JSON.parse(decoder.decode(bytes.get_data())); } catch {
                throw safeError('接口返回的数据不是有效 JSON');
            }
        } finally { this.cancellables.delete(cancellable); }
    }

    _sleep(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(ms), () => {
                this.waits.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this.waits.set(id, resolve);
        });
    }

    _cancel() {
        for (const cancellable of this.cancellables) cancellable.cancel();
        for (const [id, resolve] of this.waits) { GLib.source_remove(id); resolve(); }
        this.waits.clear();
    }

    configure() {
        if (!this.engine || !this.alive) return;
        this.engine.configure(this.settings.get_string('city'), this.settings.get_int('monthly-budget'));
        this._cancel();
        this._resetSchedule();
        try { this.engine.persist(); } catch {
            this.fatal = '无法保存本地数据，已暂停请求，请检查数据目录权限。';
            this.changed();
            return;
        }
        this.fatal = null;
        if (this.started) this.start();
        this.changed();
    }

    _resetSchedule() {
        const interval = this.engine.delay(this.settings.get_int('refresh-minutes') * MINUTE);
        this.schedule = new RefreshSchedule(interval, Date.now(), GLib.get_monotonic_time() / 1000);
    }

    start() {
        this.started = true;
        if (!this.alive || !this.engine || this.fatal || this.timer) return;
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            if (!this.suspended && this.schedule.tick(Date.now(), GLib.get_monotonic_time() / 1000))
                void this.refresh('scheduled');
            this._syncUsage();
            this.changed(); // Expiration is evaluated without fetching.
            return GLib.SOURCE_CONTINUE;
        });
        try {
            this.bus = Gio.DBus.system;
            this.sleepSignal = this.bus.signal_subscribe('org.freedesktop.login1',
                'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1',
                null, Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _interface, _signal, params) => {
                    this._setSuspended(params.deep_unpack()[0]);
                });
        } catch { /* Clock discontinuity guard still prevents catch-up. */ }
    }

    _setSuspended(suspended) {
        this.suspended = suspended;
        this.engine.cancel();
        this._cancel();
        this._resetSchedule();
        this.changed();
    }

    async refresh(source = 'manual') {
        if (!this.alive || this.suspended || this.fatal || !this.engine || this.engine.busy) return;
        const generation = this.engine.generation;
        const lastRequest = this.engine.lastRequest;
        await this.engine.refresh(source);
        if (!this.alive) return;
        // Rejected manual clicks must not push the automatic deadline back.
        // A cancelled old task must not overwrite a new configuration/resume deadline.
        if (generation === this.engine.generation &&
            (source === 'scheduled' || lastRequest !== this.engine.lastRequest))
            this._resetSchedule();
        this.changed();
    }

    destroy() {
        if (!this.alive) return;
        this.alive = false;
        this.engine?.stop();
        if (this.timer) GLib.source_remove(this.timer);
        if (this.sleepSignal) this.bus.signal_unsubscribe(this.sleepSignal);
        this.timer = this.sleepSignal = null;
        this._cancel();
        this.session.abort();
    }
}
