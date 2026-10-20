// Requires a display. Runs with a memory settings backend and fake credentials.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {fillPreferencesWindow} from '../lib/preferences.js';

function check(condition, message) { if (!condition) throw new Error(message); }
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);
const source = Gio.SettingsSchemaSource.new_from_directory(
    Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.rational-weather', true)});
function descendants(widget) {
    const items = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        items.push(...descendants(child));
    return items;
}
function idle() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}
let failure = null;
const app = new Adw.Application({application_id: 'local.rationalweather.SettingsSmoke',
    flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app});
    let stored = null;
    const credentials = {
        lookupKey: async () => stored,
        storeKey: async key => { stored = key; return true; },
        clearKey: async () => { stored = null; return true; },
    };
    try { fillPreferencesWindow(window, settings, credentials); } catch (error) {
        failure = error; app.quit(); return;
    }
    window.present();
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        void (async () => {
            try {
                const widgets = descendants(window);
                const city = widgets.find(w => w instanceof Adw.EntryRow && w.title === '城市 adcode');
                const key = widgets.find(w => w instanceof Adw.PasswordEntryRow);
                check(city && key, 'configuration rows missing');
                city.text = '110101';
                city.emit('apply');
                check(settings.get_string('city') === '110101', 'city apply failed');
                city.text = 'bad-code';
                city.emit('apply');
                check(settings.get_string('city') === '110101', 'invalid city accepted');
                const save = widgets.find(w => w instanceof Gtk.Button && w.label === '保存');
                const remove = widgets.find(w => w instanceof Gtk.Button && w.label === '删除');
                check(save && remove, 'credential actions missing');
                key.text = '0123456789abcdef0123456789abcdef';
                save.emit('clicked');
                await idle();
                check(stored === '0123456789abcdef0123456789abcdef', 'credential save failed');
                check(key.text === '', 'credential field not cleared');
                check(settings.get_int('credential-revision') === 1, 'credential revision not notified');
                remove.emit('clicked');
                await idle();
                check(stored === null, 'credential deletion failed');
                check(settings.get_int('credential-revision') === 2, 'credential deletion not notified');
                const interval = widgets.find(w => w instanceof Adw.SpinRow && w.title === '自动刷新间隔');
                const budget = widgets.find(w => w instanceof Adw.SpinRow && w.title === '自然月本地请求预算');
                check(interval.value === 30 && budget.value === 4500, 'settings defaults not bound');
                interval.value = 60;
                budget.value = 4000;
                check(settings.get_int('refresh-minutes') === 60, 'interval binding failed');
                check(settings.get_int('monthly-budget') === 4000, 'budget binding failed');
                print('GTK preferences smoke passed: real widgets, city validation, simulated credential save/delete, settings bindings.');
            } catch (error) { failure = error; } finally { window.close(); app.quit(); }
        })();
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
if (failure) throw failure;
