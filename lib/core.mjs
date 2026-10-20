// Pure domain logic. This module runs in both GJS and Node. No credentials persist here.
export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const VALID_CITY = /^\d{6}$/;
const BUDGET_MESSAGE = '本月本地请求预算已用完';
const COOLDOWN_MESSAGE = '手动刷新至少间隔 60 秒';

export function chinaDate(now) {
    return new Date(now + 8 * HOUR).toISOString().slice(0, 10);
}

export function monthKey(now) {
    return chinaDate(now).slice(0, 7);
}

export function reportTimestamp(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))
        return null;
    const time = Date.parse(`${text.replace(' ', 'T')}+08:00`);
    // Reject dates such as February 31 that Date.parse would normalize.
    if (!Number.isFinite(time) || new Date(time + 8 * HOUR).toISOString().slice(0, 19).replace('T', ' ') !== text)
        return null;
    return time;
}

function field(value) {
    return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

function number(value, low, high) {
    if (value === '' || value === null || value === undefined)
        return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= low && result <= high ? result : null;
}

export function apiError(code) {
    const errors = {
        '10001': 'Key 无效，请检查 Web 服务 Key',
        '10003': '高德调用额度已耗尽',
        '10004': '请求过于频繁',
        '10005': 'IP 白名单不允许此请求',
        '10007': '数字签名校验失败，请检查 Key 安全配置',
        '10009': 'Key 平台不匹配，需要 Web 服务 Key',
        '10010': 'IP 访问限制',
        '10014': 'QPS 超限',
        '10012': 'Key 权限不足',
        '10016': '高德服务暂时繁忙',
        '10020': 'Key 请求速率超限',
        '10021': '账号请求速率超限',
        '10044': '账号或接口额度受限',
    };
    return errors[String(code)] ?? '高德接口返回错误，请检查控制台配置';
}

export function parseWeather(body, kind, city) {
    if (!body || String(body.status) !== '1' || String(body.infocode) !== '10000')
        throw new Error(apiError(body?.infocode));
    const rows = kind === 'live' ? body.lives : body.forecasts;
    const row = Array.isArray(rows) ? rows.find(item => item?.adcode === city) : null;
    if (!row || !field(row.city))
        throw new Error('接口未返回所选城市的数据，请检查 adcode');
    const base = {city: field(row.city), province: field(row.province),
        adcode: city, reporttime: field(row.reporttime)};
    if (reportTimestamp(base.reporttime) === null)
        throw new Error('接口数据缺少有效发布时间');
    if (kind === 'live') {
        const temperature = number(row.temperature, -100, 70);
        if (temperature === null || !field(row.weather))
            throw new Error('实况数据不完整');
        return {...base, temperature, weather: field(row.weather),
            humidity: number(row.humidity, 0, 100),
            winddirection: field(row.winddirection), windpower: field(row.windpower)};
    }
    const casts = (Array.isArray(row.casts) ? row.casts : []).slice(0, 4).map(day => ({
        date: field(day.date), week: field(day.week),
        dayweather: field(day.dayweather), nightweather: field(day.nightweather),
        daytemp: number(day.daytemp, -100, 70), nighttemp: number(day.nighttemp, -100, 70),
        daywind: field(day.daywind), nightwind: field(day.nightwind),
        daypower: field(day.daypower), nightpower: field(day.nightpower),
    })).filter(day => reportTimestamp(`${day.date} 00:00:00`) !== null);
    if (!casts.length)
        throw new Error('接口未返回有效预报');
    return {...base, casts};
}

export function freshState() {
    return {version: 1, city: '', live: null, forecast: null,
        errors: {live: '', forecast: ''}, ledger: {}, lastManual: 0, failures: 0};
}

export function readState(value) {
    if (value === null)
        return freshState();
    if (!value || value.version !== 1 || !value.ledger || typeof value.ledger !== 'object' || Array.isArray(value.ledger))
        throw new Error('本地缓存或额度记录损坏，请检查数据文件');
    const result = freshState();
    for (const [month, count] of Object.entries(value.ledger)) {
        if (!/^\d{4}-\d{2}$/.test(month) || !Number.isSafeInteger(count) || count < 0)
            throw new Error('本地额度记录损坏，已暂停请求');
        result.ledger[month] = count;
    }
    result.city = VALID_CITY.test(value.city) ? value.city : '';
    for (const kind of ['live', 'forecast']) {
        const entry = value[kind];
        if (entry && Number.isFinite(entry.fetchedAt) && entry.value?.adcode === result.city) {
            try {
                const response = {status: '1', infocode: '10000',
                    [kind === 'live' ? 'lives' : 'forecasts']: [entry.value]};
                result[kind] = {value: parseWeather(response, kind, result.city), fetchedAt: entry.fetchedAt};
            } catch { /* Invalid weather is disposable; the ledger is not. */ }
        }
        result.errors[kind] = typeof value.errors?.[kind] === 'string'
            ? value.errors[kind].slice(0, 150) : '';
    }
    result.lastManual = Number.isFinite(value.lastManual) ? value.lastManual : 0;
    result.failures = Number.isInteger(value.failures) ? Math.max(0, Math.min(value.failures, 5)) : 0;
    return result;
}

export function liveStatus(entry, now) {
    if (!entry)
        return {hidden: true, stale: false};
    const report = reportTimestamp(entry.value.reporttime);
    const age = Math.max(0, now - entry.fetchedAt);
    const sourceAge = report === null ? Infinity : Math.max(0, now - report);
    return {hidden: age > 3 * HOUR || sourceAge > 3 * HOUR,
        stale: age > HOUR || sourceAge > HOUR};
}

export function validForecast(entry, now) {
    const today = chinaDate(now);
    return (entry?.value.casts ?? []).filter(day => day.date >= today);
}

export {weatherIcon, weatherAppearance, isNight} from './conditions.mjs';

// No automatic I/O in the constructor or configure(). Only refresh() fetches.
export class WeatherEngine {
    constructor({state, now, save, fetch, lookupKey, sleep, changed}) {
        Object.assign(this, {state: readState(state), now, save, fetch, lookupKey, sleep, changed});
        this.city = '';
        this.budget = 4500;
        this.busy = false;
        this.stopped = false;
        this.generation = 0;
        this.message = '';
        this.lastRequest = -Infinity;
    }

    configure(city, budget) {
        this.cancel();
        this.city = city;
        this.budget = budget;
        this.message = '';
        if (this.state.city !== city) {
            Object.assign(this.state, {city, live: null, forecast: null,
                errors: {live: '', forecast: ''}, failures: 0});
        }
        this.changed();
    }

    cancel() { this.generation++; this.message = ''; }
    stop() { this.stopped = true; this.cancel(); }
    usage() { return this.state.ledger[monthKey(this.now())] ?? 0; }
    delay(interval) { return interval * Math.min(8, 2 ** this.state.failures); }
    get displayMessage() {
        if (this.message === BUDGET_MESSAGE && this.usage() < this.budget) return '';
        if (this.message === COOLDOWN_MESSAGE && this.now() - this.state.lastManual >= MINUTE) return '';
        return this.message;
    }

    persist() {
        try { this.save(this.state); } catch {
            throw new Error('无法保存缓存或额度记录，已暂停本次请求');
        }
    }

    async refresh(source = 'manual') {
        if (this.stopped || this.busy) return false;
        const notify = message => { this.message = message; this.changed(); return false; };
        if (!VALID_CITY.test(this.city)) return notify('请在设置中填写六位城市 adcode');
        if (this.usage() >= this.budget) return notify(BUDGET_MESSAGE);
        if (source === 'manual' && this.now() - this.state.lastManual < MINUTE)
            return notify(COOLDOWN_MESSAGE);
        const generation = this.generation;
        const current = () => !this.stopped && generation === this.generation;
        this.busy = true;
        this.message = '正在更新…';
        this.changed();
        let failures = 0;
        try {
            const key = await this.lookupKey();
            if (!current()) return false;
            if (!key) return notify('请先在设置中保存 Web 服务 Key，然后手动刷新');
            if (source === 'manual') this.state.lastManual = this.now();
            for (const kind of ['live', 'forecast']) {
                const wait = 1000 - (this.now() - this.lastRequest);
                if (wait > 0) await this.sleep(wait);
                if (!current()) return false;
                if (this.usage() >= this.budget) {
                    this.state.errors[kind] = '本月本地请求预算已用完';
                    continue;
                }
                const month = monthKey(this.now());
                this.state.ledger[month] = this.usage() + 1;
                this.persist(); // Durably reserve before dispatch, including failed requests.
                this.lastRequest = this.now();
                try {
                    const body = await this.fetch(kind, this.city, key);
                    if (!current()) return false;
                    const value = parseWeather(body, kind, this.city);
                    this.state[kind] = {value, fetchedAt: this.now()};
                    this.state.errors[kind] = '';
                } catch (error) {
                    if (!current()) return false;
                    this.state.errors[kind] = error.safeMessage ??
                        (error instanceof SyntaxError ? '接口响应不是有效 JSON' :
                            error.message && !error.message.includes('://') ? error.message : '请求失败');
                    failures++;
                }
                this.persist();
                this.changed();
            }
            this.state.failures = failures ? Math.min(5, this.state.failures + 1) : 0;
            this.persist();
            this.message = failures ? '部分数据更新失败，已保留缓存' :
                this.usage() >= this.budget ? BUDGET_MESSAGE : '';
            return failures === 0;
        } catch (error) {
            if (current()) this.message = error.safeMessage ?? '无法读取密钥环或保存数据，请检查设置';
            return false;
        } finally {
            this.busy = false;
            if (!this.stopped) this.changed();
        }
    }
}
