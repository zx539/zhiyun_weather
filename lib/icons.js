import Gio from 'gi://Gio';

const CUSTOM_ICONS = new Set(['weather-sleet-symbolic', 'weather-hail-symbolic',
    'weather-haze-symbolic', 'weather-dust-symbolic', 'weather-hot-symbolic', 'weather-cold-symbolic']);
const cache = new Map();
const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('icons');

export function setWeatherIcon(actor, name) {
    if (CUSTOM_ICONS.has(name)) {
        if (!cache.has(name)) {
            const file = directory.get_child(`${name}.svg`);
            cache.set(name, new Gio.FileIcon({file}));
        }
        actor.gicon = cache.get(name);
    } else {
        actor.gicon = null;
        actor.icon_name = name;
    }
}
