// Exercise the actual GJS service, filesystem, cancellables and GLib scheduler.
// The only replaced boundaries are credential lookup and remote weather data.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {WeatherService} from '../lib/service.js';
import {monthKey, MINUTE} from '../lib/core.mjs';
import {CITY, liveResponse, forecastResponse} from './fixtures.mjs';

function check(condition, message) { if (!condition) throw new Error(message); }
const root = GLib.dir_make_tmp('rational-weather-service-XXXXXX');
const schemaDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas');
const source = Gio.SettingsSchemaSource.new_from_directory(schemaDirectory.get_path(),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.rational-weather', true)});
settings.set_string('city', CITY);
settings.set_int('monthly-budget', 4500);

class TestService extends WeatherService {
    async _lookupKey() { return 'isolated-test-key'; }
    async _fetch(kind, city) {
        this.calls ??= [];
        this.calls.push({kind, city});
        if (this.hold) return this.hold;
        return kind === 'live' ? liveResponse(city) : forecastResponse(city);
    }
}

const services = [];
function makeService(subdirectory = 'normal') {
    const service = new TestService(settings, () => {}, {dataDirectory: `${root}/${subdirectory}`});
    services.push(service);
    check(!service.fatal, service.fatal);
    return service;
}
function removeTree(file) {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const entries = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let entry;
        while ((entry = entries.next_file(null))) removeTree(file.get_child(entry.get_name()));
        entries.close(null);
    }
    file.delete(null);
}

try {
    const service = makeService();
    check(!service.calls, 'construction fetched data');
    check(service.schedule.interval === 30 * MINUTE, 'incorrect initial interval');
    const originalDeadline = service.schedule.deadline;
    check(originalDeadline > GLib.get_monotonic_time() / 1000, 'initial deadline already due');

    await service.refresh();
    check(service.calls.length === 2, 'full refresh did not issue two calls');
    check(service.engine.usage() === 2, 'service usage is incorrect');
    check(settings.get_int('usage-count') === 2, 'usage settings mirror did not update');
    const deadlineAfterRequest = service.schedule.deadline;
    await service.refresh();
    check(service.calls.length === 2, 'cooldown sent more requests');
    check(service.schedule.deadline === deadlineAfterRequest, 'cooldown postponed automatic request');
    const [, bytes] = service.file.load_contents(null);
    const text = new TextDecoder().decode(bytes);
    check(!text.includes('isolated-test-key'), 'credential leaked into cache');
    check(JSON.parse(text).live.value.temperature === 18, 'actual service persistence failed');
    const mode = service.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
    check((mode & 0o777) === 0o600, 'actual service cache is not private');

    service.destroy();
    const restored = makeService();
    check(restored.engine.usage() === 2, 'usage reset on service restart');
    check(restored.engine.state.live?.value.temperature === 18, 'cached weather not restored');
    check(!restored.calls, 'restart triggered network');
    // A stale mirror must update even if no request is sent in the new month.
    settings.set_string('usage-month', '2000-01');
    settings.set_int('usage-count', 4000);
    restored._syncUsage();
    check(settings.get_string('usage-month') === monthKey(Date.now()), 'usage month stayed stale');
    check(settings.get_int('usage-count') === 2, 'usage count stayed stale');

    settings.set_string('city', '310101');
    restored.configure();
    check(restored.engine.state.live === null && restored.engine.state.forecast === null, 'old city remained visible');
    check(restored.engine.usage() === 2, 'city switch reset budget');
    check(!restored.calls, 'configure triggered network');

    const suspended = makeService('suspend');
    let release;
    suspended.hold = new Promise(resolve => { release = resolve; });
    const request = suspended.refresh();
    await Promise.resolve();
    check(suspended.calls.length === 1, 'pending request not dispatched');
    suspended._setSuspended(true);
    release(liveResponse('310101'));
    await request;
    check(suspended.engine.message === '', 'cancelled loading notice remained');
    check(suspended.engine.state.live === null, 'cancelled data committed');
    check(suspended.calls.length === 1, 'suspend dispatched forecast');
    await suspended.refresh();
    check(suspended.calls.length === 1, 'manual request ran while suspended');
    suspended._setSuspended(false);
    check(suspended.calls.length === 1, 'resume triggered request');
    check(suspended.schedule.deadline - GLib.get_monotonic_time() / 1000 > 29 * MINUTE,
        'resume did not wait a full interval');
    check(suspended.engine.usage() === 1, 'cancelled request lost quota accounting');

    const corruptDirectory = `${root}/corrupt`;
    GLib.mkdir_with_parents(corruptDirectory, 0o700);
    const corruptFile = Gio.File.new_for_path(`${corruptDirectory}/state.json`);
    corruptFile.replace_contents(new TextEncoder().encode('{broken'), null, false, Gio.FileCreateFlags.PRIVATE, null);
    const corrupt = new TestService(settings, () => {}, {dataDirectory: corruptDirectory});
    services.push(corrupt);
    check(Boolean(corrupt.fatal), 'corrupt ledger not blocked');
    await corrupt.refresh();
    check(!corrupt.calls, 'corrupt ledger permitted a request');
    print('GJS service passed: actual persistence, restart, cooldown, usage mirror, city change, suspend/resume and damaged ledger. No real API or keyring calls.');
} finally {
    for (const service of services) service.destroy();
    removeTree(Gio.File.new_for_path(root));
}
