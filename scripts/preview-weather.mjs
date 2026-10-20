// Render the production Cairo scene code without a running GNOME desktop.
import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Rsvg from 'gi://Rsvg?version=2.0';
import {drawWeatherScene} from '../lib/artwork.mjs';
import {weatherAppearance} from '../lib/conditions.mjs';
import {WEATHER_CASES} from '../tests/weather-cases.mjs';

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
GLib.mkdir_with_parents(root.get_child('dist').get_path(), 0o755);
function text(cr, content, x, y, size, color) {
    const layout = PangoCairo.create_layout(cr);
    layout.set_text(content, -1);
    layout.set_font_description(Pango.FontDescription.from_string(`Sans ${size}`));
    cr.setSourceRGB(...color);
    cr.moveTo(x, y);
    PangoCairo.show_layout(cr, layout);
}
for (const theme of ['dark', 'light']) {
    const dark = theme === 'dark';
    const ink = dark ? [0.91, 0.93, 0.96] : [0.14, 0.17, 0.21];
    const muted = dark ? [0.52, 0.57, 0.65] : [0.43, 0.47, 0.53];
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1128, 1044);
    const cr = new Cairo.Context(surface);
    try {
        cr.setSourceRGB(...(dark ? [0.07, 0.08, 0.10] : [0.96, 0.97, 0.98]));
        cr.paint();
        text(cr, '知云天气', 30, 17, 22, ink);
        text(cr, '天气背景预览 · 与插件共用绘图代码 · 非桌面截图', 30, 57, 11, muted);
        WEATHER_CASES.forEach((item, index) => {
            const x = 24 + index % 3 * 368;
            const y = 100 + Math.floor(index / 3) * 156;
            cr.save();
            cr.translate(x, y);
            const appearance = weatherAppearance(item.weather, item.night);
            drawWeatherScene(cr, 344, 132, {...appearance, phase: 0.3, foreground: ink});
            const asset = root.get_child(`icons/${appearance.icon}.svg`);
            const path = asset.query_exists(null) ? asset.get_path() :
                `/usr/share/icons/Adwaita/symbolic/status/${appearance.icon}.svg`;
            const handle = Rsvg.Handle.new_from_file(path);
            cr.save();
            cr.translate(18, 24);
            cr.pushGroup();
            handle.render_document(cr, new Rsvg.Rectangle({x: 0, y: 0, width: 24, height: 24}));
            const mask = cr.popGroup();
            cr.setSourceRGB(...ink);
            cr.mask(mask);
            cr.restore();
            text(cr, '18°', 54, 10, 36, ink);
            text(cr, `${item.weather}${item.night ? ' · 夜间' : ''}`, 18, 78, 12, ink);
            text(cr, appearance.kind, 18, 104, 9, muted);
            cr.restore();
        });
    } finally { cr.$dispose(); }
    const output = root.get_child(`dist/weather-preview-${theme}.png`).get_path();
    surface.writeToPNG(output);
    print(output);
}
