import assert from 'node:assert/strict';
import test from 'node:test';
import {WeatherEngine, HOUR, MINUTE, freshState, readState, parseWeather,
    reportTimestamp, monthKey, liveStatus, validForecast} from '../lib/core.mjs';
import {RefreshSchedule} from '../lib/schedule.mjs';
import {CITY, NOW, liveResponse, forecastResponse} from './fixtures.mjs';

function harness(options = {}) {
    let clock = NOW;
    const calls = [];
    const saves = [];
    const engine = new WeatherEngine({state: options.state ?? null,
        now: () => clock, changed: () => {},
        lookupKey: options.lookupKey ?? (async () => 'test-credential-not-for-network'),
        sleep: async ms => { clock += ms; },
        save: options.save ?? (state => saves.push(structuredClone(state))),
        fetch: async (kind, city) => {
            calls.push({kind, city, at: clock, reserved: engine.usage()});
            if (options.fetch) return options.fetch(kind, city);
            return kind === 'live' ? liveResponse(city) : forecastResponse(city);
        },
    });
    engine.configure(CITY, options.budget ?? 4500);
    return {engine, calls, saves, advance: ms => { clock += ms; }};
}

test('parses documented live and four-day forecast contracts, including normalized cache', () => {
    const live = parseWeather(liveResponse(), 'live', CITY);
    assert.equal(live.temperature, 18);
    assert.equal(live.humidity, 42);
    assert.equal(parseWeather(forecastResponse(), 'forecast', CITY).casts.length, 4);
    const state = freshState();
    state.city = CITY;
    state.live = {value: live, fetchedAt: NOW};
    assert.deepEqual(readState(state).live, state.live);
    assert.throws(() => parseWeather({status: '0', infocode: '10001'}, 'live', CITY), /Key/);
    assert.throws(() => parseWeather(liveResponse(), 'live', '310101'), /adcode/);
    const missing = liveResponse();
    missing.lives[0].temperature = '';
    assert.throws(() => parseWeather(missing, 'live', CITY), /不完整/);
});

test('rejects invalid timestamps and refuses damaged quota records', () => {
    assert.equal(reportTimestamp('2026-02-31 12:00:00'), null);
    assert.equal(reportTimestamp('not a date'), null);
    assert.throws(() => readState({version: 1, ledger: {'2026-10': -1}}), /额度/);
    assert.throws(() => readState({version: 1}), /损坏/);
    assert.equal(reportTimestamp('2026-10-20 12:00:00'), NOW);
});

test('construction and configuration perform no fetch or credential lookup', async () => {
    let keyReads = 0;
    const {engine, calls} = harness({lookupKey: async () => { keyReads++; return 'key'; }});
    engine.configure('310101', 4500);
    await Promise.resolve();
    assert.equal(calls.length, 0);
    assert.equal(keyReads, 0);
});

test('two requests are reserved durably before dispatch, spaced, and counted without credentials', async () => {
    const {engine, calls, saves} = harness();
    assert.equal(await engine.refresh(), true);
    assert.deepEqual(calls.map(call => call.kind), ['live', 'forecast']);
    assert.deepEqual(calls.map(call => call.reserved), [1, 2]);
    assert.ok(calls[1].at - calls[0].at >= 1000);
    assert.equal(engine.usage(), 2);
    assert.equal(saves[0].ledger['2026-10'], 1);
    assert.ok(!JSON.stringify(saves).includes('test-credential'));
    assert.equal(await engine.refresh(), false);
    assert.equal(calls.length, 2);
});

test('budget limits count failed requests and can stop between live and forecast', async () => {
    const {engine, calls} = harness({budget: 1, fetch: async () => { throw new Error('离线'); }});
    await engine.refresh();
    assert.equal(engine.usage(), 1);
    assert.equal(calls.length, 1);
    assert.match(engine.state.errors.forecast, /预算/);
    await engine.refresh('scheduled');
    assert.equal(calls.length, 1);
});

test('storage failure prevents dispatch', async () => {
    const {engine, calls} = harness({save: () => { throw new Error('disk full'); }});
    assert.equal(await engine.refresh(), false);
    assert.equal(calls.length, 0);
});

test('no Key means no requests or quota consumption', async () => {
    const {engine, calls} = harness({lookupKey: async () => null});
    await engine.refresh();
    assert.equal(calls.length, 0);
    assert.equal(engine.usage(), 0);
    assert.match(engine.message, /Key/);
});

test('partial failure preserves prior data, updates the other source, backs off and recovers', async () => {
    let fail = false;
    const h = harness({fetch: async kind => {
        if (fail && kind === 'forecast') throw new Error('暂时失败');
        return kind === 'live' ? liveResponse() : forecastResponse();
    }});
    await h.engine.refresh();
    const cached = h.engine.state.forecast;
    h.advance(30 * MINUTE);
    fail = true;
    await h.engine.refresh('scheduled');
    assert.deepEqual(h.engine.state.forecast, cached);
    assert.ok(h.engine.state.live.fetchedAt > cached.fetchedAt);
    assert.match(h.engine.state.errors.forecast, /失败/);
    assert.equal(h.engine.delay(30 * MINUTE), 60 * MINUTE);
    h.advance(60 * MINUTE);
    fail = false;
    await h.engine.refresh('scheduled');
    assert.equal(h.engine.state.errors.forecast, '');
    assert.equal(h.engine.state.failures, 0);
});

test('in-flight refresh is exclusive; city changes discard old responses but retain quota', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const {engine, calls} = harness({fetch: () => pending});
    const first = engine.refresh();
    await Promise.resolve();
    assert.equal(await engine.refresh(), false);
    assert.equal(calls.length, 1);
    engine.configure('310101', 4500);
    release(liveResponse());
    await first;
    assert.equal(engine.state.live, null);
    assert.equal(engine.state.forecast, null);
    assert.equal(engine.usage(), 1);
    assert.equal(calls.length, 1);
});

test('disable discards pending responses and emits no follow-up request', async () => {
    let release;
    const {engine, calls} = harness({fetch: () => new Promise(resolve => { release = resolve; })});
    const task = engine.refresh();
    await Promise.resolve();
    engine.stop();
    release(liveResponse());
    await task;
    assert.equal(engine.state.live, null);
    assert.equal(calls.length, 1);
});

test('month counters persist independently and use the Shanghai month boundary', async () => {
    const state = freshState();
    state.ledger['2026-10'] = 4500;
    const h = harness({state});
    await h.engine.refresh('scheduled');
    assert.equal(h.calls.length, 0);
    h.advance(Date.parse('2026-11-01T00:00:00+08:00') - NOW);
    await h.engine.refresh('scheduled');
    assert.equal(h.engine.usage(), 2);
    assert.equal(h.engine.state.ledger['2026-10'], 4500);
    const restored = readState(h.saves.at(-1));
    assert.equal(restored.ledger['2026-11'], 2);
    assert.equal(monthKey(Date.parse('2026-10-31T16:00:00Z')), '2026-11');
});

test('live expiration considers fetch and source times; forecast filters past dates', () => {
    const value = parseWeather(liveResponse(), 'live', CITY);
    const entry = {value, fetchedAt: NOW};
    assert.deepEqual(liveStatus(entry, NOW), {hidden: false, stale: false});
    assert.deepEqual(liveStatus(entry, NOW + HOUR + 1), {hidden: false, stale: true});
    assert.equal(liveStatus(entry, NOW + 3 * HOUR + 1).hidden, true);
    assert.equal(liveStatus({...entry, fetchedAt: NOW + 4 * HOUR}, NOW + 4 * HOUR).hidden, true);
    const forecast = {value: parseWeather(forecastResponse(), 'forecast', CITY)};
    assert.equal(validForecast(forecast, NOW + 2 * 24 * HOUR).length, 2);
    assert.equal(validForecast(forecast, NOW + 4 * 24 * HOUR).length, 0);
});

test('schedule waits full interval initially and after suspend/long stall without catch-up', () => {
    const interval = 30 * MINUTE;
    const schedule = new RefreshSchedule(interval, NOW, 0);
    assert.equal(schedule.tick(NOW + 15_000, 15_000), false);
    const resumedWall = NOW + 8 * HOUR;
    assert.equal(schedule.tick(resumedWall, 30_000), false);
    for (let elapsed = 15_000; elapsed < interval; elapsed += 15_000)
        assert.equal(schedule.tick(resumedWall + elapsed, 30_000 + elapsed), false);
    assert.equal(schedule.tick(resumedWall + interval, 30_000 + interval), true);
    // A long pause even when both clocks advance also skips the deadline.
    assert.equal(schedule.tick(resumedWall + interval + 2 * HOUR, 30_000 + interval + 2 * HOUR), false);
});

test('cancel clears the loading notice and discards pending work without forgetting quota', async () => {
    let release;
    const {engine, calls} = harness({fetch: () => new Promise(resolve => { release = resolve; })});
    const task = engine.refresh();
    await Promise.resolve();
    assert.equal(engine.message, '正在更新…');
    engine.cancel();
    release(liveResponse());
    await task;
    assert.equal(engine.displayMessage, '');
    assert.equal(engine.busy, false);
    assert.equal(engine.state.live, null);
    assert.equal(engine.usage(), 1);
    assert.equal(calls.length, 1);
});

test('budget and cooldown notices expire when their blocking conditions disappear', async () => {
    const h = harness({budget: 2});
    await h.engine.refresh();
    assert.match(h.engine.displayMessage, /预算/);
    h.advance(Date.parse('2026-11-01T00:00:00+08:00') - NOW);
    assert.equal(h.engine.displayMessage, '');
    h.engine.configure(CITY, 4500);
    await h.engine.refresh();
    await h.engine.refresh();
    assert.match(h.engine.displayMessage, /60 秒/);
    h.advance(MINUTE);
    assert.equal(h.engine.displayMessage, '');
});
