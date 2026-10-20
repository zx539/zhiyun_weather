import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {weatherAppearance, weatherIcon, weatherKind, isNight} from '../lib/conditions.mjs';
import {WEATHER_CASES} from './weather-cases.mjs';

test('weather icons and backgrounds share a complete condition classification', () => {
    for (const {weather, kind, night = false} of WEATHER_CASES) {
        const appearance = weatherAppearance(weather, night);
        assert.equal(appearance.kind, kind, weather);
        assert.equal(appearance.icon, weatherIcon(weather, night));
        assert.match(appearance.className, /^[a-z-]+$/);
        assert.ok(existsSync(new URL(`../icons/${appearance.icon}.svg`, import.meta.url)) ||
            existsSync(`/usr/share/icons/Adwaita/symbolic/status/${appearance.icon}.svg`), appearance.icon);
    }
    for (const value of [null, undefined, '', {}, 'background: red;'])
        assert.equal(weatherKind(value), 'unknown');
});

test('mixed precipitation and severe weather take precedence over generic descriptions', () => {
    for (const [weather, expected] of [
        ['雷阵雨伴有冰雹', 'storm'], ['雨夹雪', 'sleet'], ['雨雪天气', 'sleet'],
        ['阵雨夹冰雹', 'hail'], ['中到大雪', 'snow'], ['特大暴雨', 'rain'],
        ['强浓雾', 'fog'], ['严重霾', 'haze'], ['浮尘', 'dust'], ['龙卷风', 'tornado'],
        ['晴间多云', 'cloudy'], ['少云', 'cloudy'],
    ]) assert.equal(weatherKind(weather), expected, weather);
});

test('night appearance uses China time and preserves rainy/snowy conditions', () => {
    assert.equal(isNight(Date.parse('2026-10-20T05:59:00+08:00')), true);
    assert.equal(isNight(Date.parse('2026-10-20T06:00:00+08:00')), false);
    assert.equal(isNight(Date.parse('2026-10-20T18:00:00+08:00')), true);
    assert.equal(weatherIcon('晴', true), 'weather-clear-night-symbolic');
    assert.equal(weatherIcon('多云', true), 'weather-few-clouds-night-symbolic');
    assert.equal(weatherIcon('雨', true), weatherIcon('雨', false));
    assert.equal(weatherAppearance('未知', true).className, 'unknown');
});
