import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Rsvg from 'gi://Rsvg?version=2.0';
import {drawWeatherScene} from '../lib/artwork.mjs';
import {weatherAppearance} from '../lib/conditions.mjs';
import {WEATHER_CASES} from './weather-cases.mjs';

function check(condition, message) { if (!condition) throw new Error(message); }
const directory = GLib.dir_make_tmp('zhiyun-weather-artwork-XXXXXX');
const file = Gio.File.new_for_path(`${directory}/render.png`);
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
let frames = 0;
try {
    for (const testCase of WEATHER_CASES) {
        const hashes = [];
        for (const foreground of [[0.16, 0.17, 0.2], [0.91, 0.93, 0.96]]) {
            for (const phase of [0, 0.3, 0.7]) {
                const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 360, 128);
                const cr = new Cairo.Context(surface);
                try { drawWeatherScene(cr, 360, 128, {...testCase, phase, foreground}); }
                finally { cr.$dispose(); }
                surface.writeToPNG(file.get_path());
                const [, bytes] = file.load_contents(null);
                check(bytes.length > 300, `empty scene: ${testCase.kind}`);
                hashes.push(GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes));
                frames++;
            }
        }
        if (testCase.kind !== 'unknown')
            check(hashes[0] !== hashes[1], `scene did not move: ${testCase.kind}`);
    }
    for (const name of ['sleet', 'hail', 'haze', 'dust', 'hot', 'cold']) {
        const handle = Rsvg.Handle.new_from_file(root.get_child(`icons/weather-${name}-symbolic.svg`).get_path());
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 32, 32);
        const cr = new Cairo.Context(surface);
        try {
            const viewport = new Rsvg.Rectangle({x: 0, y: 0, width: 32, height: 32});
            check(handle.render_document(cr, viewport), `failed to render icon: ${name}`);
        } finally { cr.$dispose(); }
    }
    // A zero-size actor during allocation must be harmless.
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
    const cr = new Cairo.Context(surface);
    try { drawWeatherScene(cr, 0, 0); } finally { cr.$dispose(); }
    print(`Cairo artwork passed: ${frames} frames across dark/light palettes, mixed-weather scenes, six custom SVG icons. No display or API required.`);
} finally {
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
