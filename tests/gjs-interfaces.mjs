// Introspection only: checks installed GNOME/GTK API shapes without a display.
import Adw from 'gi://Adw';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';
import {setWeatherIcon} from '../lib/icons.js';
import {snapshot} from '../lib/view.js';
import {parseWeather, HOUR} from '../lib/core.mjs';
import {CITY, NOW, liveResponse} from './fixtures.mjs';
import {WEATHER_CASES} from './weather-cases.mjs';

function properties(type, names) {
    const actual = new Set(type.list_properties().map(property => property.name));
    for (const name of names)
        if (!actual.has(name)) throw new Error(`${type.name} property unavailable: ${name}`);
}
properties(St.BoxLayout, ['orientation', 'x-expand', 'style-class']);
properties(St.Button, ['child', 'accessible-name', 'can-focus']);
properties(St.ScrollView, ['child', 'hscrollbar-policy', 'vscrollbar-policy', 'overlay-scrollbars']);
properties(St.Icon, ['icon-name', 'icon-size', 'gicon']);
properties(St.Settings, ['enable-animations', 'high-contrast']);
properties(Clutter.Timeline, ['actor', 'duration', 'repeat-count']);
for (const method of ['get_context', 'get_surface_size', 'queue_repaint'])
    if (typeof St.DrawingArea.prototype[method] !== 'function') throw new Error(`DrawingArea API missing: ${method}`);
for (const method of ['start', 'stop', 'is_playing', 'get_progress'])
    if (typeof Clutter.Timeline.prototype[method] !== 'function') throw new Error(`Timeline API missing: ${method}`);
properties(St.Label, ['text']);
properties(Adw.EntryRow, ['text', 'show-apply-button']);
properties(Adw.PasswordEntryRow, ['text']);
properties(Adw.SpinRow, ['value', 'adjustment', 'subtitle']);
properties(Gtk.Adjustment, ['lower', 'upper', 'step-increment']);
for (const [type, signal] of [[Adw.EntryRow, 'apply'], [Gtk.Button, 'clicked'],
    [Adw.PreferencesWindow, 'close-request']]) {
    // list_properties above initializes the class and its signals.
    type.list_properties();
    if (!GObject.signal_lookup(signal, type.$gtype)) throw new Error(`Signal unavailable: ${signal}`);
}
if (typeof Clutter.Actor.prototype.get_n_children !== 'function' ||
    typeof Meta.Context.prototype.terminate !== 'function') throw new Error('Shell actor/context API unavailable');
for (const name of ['sleet', 'hail', 'haze', 'dust', 'hot', 'cold']) {
    const actor = {};
    setWeatherIcon(actor, `weather-${name}-symbolic`);
    if (!(actor.gicon instanceof Gio.FileIcon) || !actor.gicon.get_file().query_exists(null))
        throw new Error(`Bundled icon could not be resolved: ${name}`);
    setWeatherIcon(actor, 'weather-clear-symbolic');
    if (actor.gicon !== null || actor.icon_name !== 'weather-clear-symbolic')
        throw new Error('Switching from a bundled icon back to a theme icon failed');
}
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const theme = new St.Theme();
theme.load_stylesheet(root.get_child('stylesheet.css'));
const engine = {city: CITY, budget: 4500, usage: () => 0, state: {
    live: {value: parseWeather(liveResponse(), 'live', CITY), fetchedAt: NOW}, errors: {},
}};
for (const {weather, kind} of WEATHER_CASES) {
    engine.state.live.value.weather = weather;
    const view = snapshot({engine}, NOW);
    if (view.appearance.kind !== kind || view.panelIcon !== view.appearance.icon)
        throw new Error(`Weather view/icon mismatch: ${weather}`);
}
const expired = snapshot({engine}, NOW + 4 * HOUR);
if (expired.appearance.kind !== 'unknown' || expired.panelTemp !== '--°')
    throw new Error('Expired weather retained an active background');
if (snapshot({fatal: 'broken cache'}, NOW).appearance.kind !== 'unknown')
    throw new Error('Missing data retained an active background');
print('GNOME 50 interface checks passed (introspection only, not a rendered UI test).');
