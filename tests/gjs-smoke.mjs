import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Secret from 'gi://Secret';
import {WeatherEngine, parseWeather} from '../lib/core.mjs';
import {WeatherService} from '../lib/service.js';
import {lookupKey, storeKey, clearKey} from '../lib/secret.js';
import {CITY, NOW, liveResponse, forecastResponse} from './fixtures.mjs';

function check(condition, message) { if (!condition) throw new Error(message); }
const directory = GLib.dir_make_tmp('rational-weather-check-XXXXXX');
const file = Gio.File.new_for_path(`${directory}/state.json`);
const source = Gio.SettingsSchemaSource.new_from_directory(
    Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.rational-weather', true)});
check(settings.get_int('monthly-budget') === 4500, 'wrong budget default');
check(settings.get_int('refresh-minutes') === 30, 'wrong interval default');
check(Soup.MessageFlags.NO_REDIRECT !== undefined, 'Soup redirect flag unavailable');
check(typeof Secret.password_lookup === 'function', 'Secret lookup unavailable');
check(typeof WeatherService === 'function' && typeof lookupKey === 'function' &&
    typeof storeKey === 'function' && typeof clearKey === 'function', 'GJS imports failed');
let clock = NOW;
const engine = new WeatherEngine({state: null, now: () => clock, changed: () => {},
    save: state => file.replace_contents(new TextEncoder().encode(JSON.stringify(state)), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null),
    lookupKey: async () => 'test-only-no-network',
    fetch: async kind => kind === 'live' ? liveResponse() : forecastResponse(),
    sleep: async ms => { clock += ms; }});
engine.configure(CITY, 4500);
await engine.refresh();
check(engine.usage() === 2, 'GJS request count mismatch');
const [, bytes] = file.load_contents(null);
const saved = JSON.parse(new TextDecoder().decode(bytes));
check(saved.live.value.temperature === 18, 'GJS cache failed');
check(!new TextDecoder().decode(bytes).includes('test-only'), 'credential leaked');
const info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
check((info.get_attribute_uint32('unix::mode') & 0o777) === 0o600, 'cache permissions not private');
check(parseWeather(forecastResponse(), 'forecast', CITY).casts.length === 4, 'GJS parser failed');
file.delete(null);
Gio.File.new_for_path(directory).delete(null);
print('GJS smoke passed: imports, schema, parser, request accounting, private persistence (no real API or keyring calls).');
