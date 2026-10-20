import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {drawWeatherScene} from './artwork.mjs';

// A small decorative layer. No frame callbacks remain active while the menu is closed.
export class WeatherScene {
    constructor(content, appearance) {
        this.appearance = appearance;
        this._active = false;
        this._disposed = false;
        this._phase = 0;
        this._lastFrame = -Infinity;
        this.actor = new St.Widget({layout_manager: new Clutter.BinLayout(),
            style_class: `rw-scene rw-scene--${appearance.className}`,
            x_expand: true, clip_to_allocation: true, reactive: false});
        this._drawing = new St.DrawingArea({x_expand: true, y_expand: true, reactive: false});
        this.actor.add_child(this._drawing);
        this.actor.add_child(content);
        this._settings = St.Settings.get();
        this._settingsIds = ['enable-animations', 'high-contrast'].map(property =>
            this._settings.connect(`notify::${property}`, () => this._sync()));
        this._timeline = new Clutter.Timeline({actor: this.actor, duration: 12_000, repeat_count: -1});
        this._frameId = this._timeline.connect('new-frame', () => {
            const now = GLib.get_monotonic_time();
            if (now - this._lastFrame < 80_000) return; // At most ~12 drawing updates/second.
            this._lastFrame = now;
            this._phase = this._timeline.get_progress();
            this._drawing.queue_repaint();
        });
        this._drawing.connect('repaint', () => this._paint());
        this.actor.connect('notify::mapped', () => this._sync());
        this.actor.connect('destroy', () => this._dispose());
        this._sync();
    }

    setActive(active) {
        this._active = active;
        this._sync();
    }

    get animating() { return !this._disposed && this._timeline.is_playing(); }

    _sync() {
        if (this._disposed) return;
        const contrast = this._settings.high_contrast;
        if (contrast) this.actor.add_style_class_name('rw-scene-high-contrast');
        else this.actor.remove_style_class_name('rw-scene-high-contrast');
        const running = this._active && this.actor.mapped && this._settings.enable_animations &&
            !contrast && this.appearance.kind !== 'unknown';
        if (running && !this._timeline.is_playing()) {
            this._lastFrame = -Infinity;
            this._timeline.start();
        } else if (!running && this._timeline.is_playing())
            this._timeline.stop();
        this._drawing.queue_repaint();
    }

    _paint() {
        if (this._disposed) return;
        const cr = this._drawing.get_context();
        try {
            if (this._settings.high_contrast) return;
            const [width, height] = this._drawing.get_surface_size();
            const color = this._drawing.get_theme_node().get_foreground_color();
            drawWeatherScene(cr, width, height, {...this.appearance, phase: this._phase,
                foreground: [color.red / 255, color.green / 255, color.blue / 255]});
        } finally { cr.$dispose(); }
    }

    _dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._timeline.stop();
        this._timeline.disconnect(this._frameId);
        for (const id of this._settingsIds) this._settings.disconnect(id);
    }

    destroy() {
        if (this._disposed) return;
        this._dispose();
        this.actor.destroy();
    }
}
