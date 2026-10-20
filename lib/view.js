import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {chinaDate, liveStatus, validForecast, weatherIcon, weatherAppearance, isNight, monthKey} from './core.mjs';
import {setWeatherIcon} from './icons.js';
import {WeatherScene} from './scene.js';

export function column(style = '') {
    return new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
        style_class: style, x_expand: true});
}

function label(text, style = '', wrap = false) {
    const actor = new St.Label({text, style_class: style, x_expand: true});
    if (wrap) {
        actor.clutter_text.line_wrap = true;
        actor.clutter_text.ellipsize = 0;
    }
    return actor;
}

function row(left, right, style = '', iconName = null) {
    const box = new St.BoxLayout({style_class: `rw-row ${style}`});
    if (iconName) box.add_child(icon(iconName, 16));
    box.add_child(label(left, 'rw-muted'));
    const value = label(right);
    value.x_expand = false;
    box.add_child(value);
    return box;
}

function icon(name, size = 20) {
    const actor = new St.Icon({icon_size: size,
        y_align: Clutter.ActorAlign.CENTER});
    setWeatherIcon(actor, name);
    return actor;
}

function temp(value) { return value === null || value === undefined ? '—' : `${value}°`; }
function wind(direction, power) {
    return `${direction ? `${direction.replace(/风$/, '')}风` : '风向未知'}  ${power ? `${power.replace(/级$/, '')}级` : '风力未知'}`;
}
function dayTitle(day, now) {
    const offset = Math.round((Date.parse(`${day.date}T00:00:00+08:00`) -
        Date.parse(`${chinaDate(now)}T00:00:00+08:00`)) / 86_400_000);
    const short = offset === 0 ? '今天' : offset === 1 ? '明天' : `周${'一二三四五六日'[Number(day.week) - 1] ?? '?'}`;
    return `${short}  ${day.date.slice(5)}`;
}
function timeText(entry) {
    if (!entry) return '尚无数据';
    const fetched = new Date(entry.fetchedAt + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
    return `发布 ${entry.value.reporttime}\n获取 ${fetched}（北京时间）`;
}

export function snapshot(service, now = Date.now()) {
    const engine = service?.engine;
    const state = engine?.state;
    const live = state?.live;
    const forecast = state?.forecast;
    const status = liveStatus(live, now);
    const appearance = weatherAppearance(status.hidden ? '' : live.value.weather, isNight(now));
    const days = validForecast(forecast, now);
    const configured = /^\d{6}$/.test(engine?.city ?? '');
    const location = live?.value ?? forecast?.value;
    const message = service?.fatal || engine?.displayMessage ||
        (!configured ? '请设置城市和 Web 服务 Key' :
            engine.usage() >= engine.budget ? '本月本地请求预算已用完' : '');
    return {now, date: chinaDate(now), live, forecast, status, days, configured, appearance,
        city: location?.city || (configured ? engine.city : '未设置城市'),
        province: location?.province || '',
        errors: state?.errors ?? {}, message, busy: engine?.busy ?? false,
        count: engine?.usage() ?? 0, budget: engine?.budget ?? 4500,
        month: monthKey(now),
        panelTemp: status.hidden ? '--°' : `${live.value.temperature}°${status.stale ? ' ·' : ''}`,
        panelIcon: appearance.icon};
}

export function paintDetails(box, data) {
    box.destroy_all_children();
    let scene = null;
    box.add_child(row(data.city, data.province, 'rw-heading'));
    if (data.message) box.add_child(label(data.message, 'rw-status', true));
    if (!data.live) {
        box.add_child(label('暂无实况数据', 'rw-muted'));
    } else {
        const live = data.live.value;
        const content = column('rw-hero-content');
        const hero = new St.BoxLayout({style_class: 'rw-hero'});
        hero.add_child(icon(weatherIcon(live.weather, isNight(data.now)), 28));
        hero.add_child(label(temp(live.temperature), 'rw-temperature'));
        content.add_child(hero);
        content.add_child(label(live.weather, 'rw-condition'));
        scene = new WeatherScene(content, data.appearance);
        box.add_child(scene.actor);
        if (data.status.hidden) box.add_child(label('以上为历史缓存，已停止作为当前温度展示', 'rw-status', true));
        else if (data.status.stale) box.add_child(label('实况数据已过期', 'rw-status'));
        box.add_child(row('湿度', live.humidity === null ? '—' : `${live.humidity}%`));
        box.add_child(row('风向 / 风力', wind(live.winddirection, live.windpower)));
        box.add_child(label(timeText(data.live), 'rw-caption', true));
    }
    if (data.errors.live) box.add_child(label(`实况更新失败：${data.errors.live}`, 'rw-status', true));
    box.add_child(label('四天预报', 'rw-section-title'));
    if (!data.days.length) box.add_child(label('暂无有效日期的预报', 'rw-muted'));
    for (const day of data.days) {
        const card = column('rw-forecast-card');
        card.add_child(label(dayTitle(day, data.now), 'rw-day-title'));
        card.add_child(row(`白天  ${day.dayweather || '—'}`, temp(day.daytemp), '', weatherIcon(day.dayweather)));
        card.add_child(label(wind(day.daywind, day.daypower), 'rw-caption'));
        card.add_child(row(`夜间  ${day.nightweather || '—'}`, temp(day.nighttemp), '', weatherIcon(day.nightweather, true)));
        card.add_child(label(wind(day.nightwind, day.nightpower), 'rw-caption'));
        box.add_child(card);
    }
    if (data.forecast) box.add_child(label(timeText(data.forecast), 'rw-caption', true));
    if (data.errors.forecast) box.add_child(label(`预报更新失败：${data.errors.forecast}`, 'rw-status', true));
    box.add_child(label(`数据来源：高德天气\n${data.month} 本地请求 ${data.count} / ${data.budget}`, 'rw-caption', true));
    return scene;
}

export function paintCalendar(box, data) {
    box.destroy_all_children();
    box.add_child(row('知云天气', data.city, 'rw-calendar-title'));
    if (!data.status.hidden) {
        box.add_child(row(`${data.live.value.weather}${data.status.stale ? ' · 已过期' : ''}`, data.panelTemp, '', data.panelIcon));
    } else {
        box.add_child(label(data.configured ? '暂无有效实况' : '请设置城市', 'rw-muted'));
    }
    if (data.days.length) {
        const grid = new St.BoxLayout({style_class: 'rw-calendar-days', x_expand: true});
        for (const day of data.days) {
            const cell = column('rw-calendar-day');
            cell.add_child(label(dayTitle(day, data.now).split('  ')[0], 'rw-caption'));
            cell.add_child(icon(weatherIcon(day.dayweather)));
            cell.add_child(label(`${temp(day.daytemp)} / ${temp(day.nighttemp)}`, 'rw-small'));
            grid.add_child(cell);
        }
        box.add_child(grid);
    }
    const note = data.message || (data.errors.live || data.errors.forecast ? '部分数据更新失败' :
        data.status.stale ? '实况已过期' : '');
    if (note) box.add_child(label(note, 'rw-caption', true));
    box.add_child(label('高德天气 · 点击查看详情', 'rw-caption'));
}
