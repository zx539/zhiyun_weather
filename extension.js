import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {WeatherService} from './lib/service.js';
import {column, snapshot, paintDetails, paintCalendar} from './lib/view.js';
import {setWeatherIcon} from './lib/icons.js';

export default class RationalWeather extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._settings = this.getSettings();
        this._indicator = new PanelMenu.Button(0.5, '知云天气');
        const panel = new St.BoxLayout({style_class: 'rw-panel'});
        this._panel = panel;
        this._icon = new St.Icon({icon_name: 'weather-severe-alert-symbolic', style_class: 'system-status-icon'});
        this._temperature = new St.Label({text: '--°', y_align: Clutter.ActorAlign.CENTER});
        panel.add_child(this._icon);
        panel.add_child(this._temperature);
        this._indicator.add_child(panel);

        const content = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._details = column('rw-details');
        const scroll = new St.ScrollView({style_class: 'rw-scroll vfade',
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true, x_expand: true, child: this._details});
        content.add_child(scroll);
        this._indicator.menu.addMenuItem(content);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._refreshItem = this._indicator.menu.addAction('刷新天气', () => void this._service.refresh());
        this._indicator.menu.addAction('设置', () => this.openPreferences());
        this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            this._render();
            this._scene?.setActive(open);
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        this._installCalendar();
        this._service = new WeatherService(this._settings, () => this._render());
        this._signals = ['city', 'monthly-budget', 'refresh-minutes', 'credential-revision'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._service.configure()));
        this._service.start();
        this._render();
    }

    _installCalendar() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        const original = dateMenu?._weatherItem;
        const parent = original?.get_parent();
        if (!parent) {
            this._calendarWarning = '日历天气区域不可用，顶栏功能仍可使用';
            return;
        }
        this._originalWeather = original;
        this._calendarParent = parent;
        this._calendarIndex = parent.get_children().indexOf(original);
        this._calendarBox = column('weather-box rw-calendar');
        this._calendar = new St.Button({style_class: 'weather-button',
            can_focus: true, x_expand: true, child: this._calendarBox,
            accessible_name: '知云天气，查看详情'});
        this._calendar.connect('clicked', () => {
            Main.panel.closeCalendar();
            this._indicator.menu.open();
        });
        parent.remove_child(original);
        parent.insert_child_at_index(this._calendar, this._calendarIndex);
    }

    _render() {
        if (!this._service || !this._indicator) return;
        const data = snapshot(this._service);
        if (this._calendarWarning) data.message = [data.message, this._calendarWarning].filter(Boolean).join('；');
        const signature = JSON.stringify({...data, now: undefined});
        if (signature === this._signature) return;
        this._signature = signature;
        this._temperature.text = data.panelTemp;
        setWeatherIcon(this._icon, data.panelIcon);
        this._panel.style_class = `rw-panel rw-panel--${data.appearance.className}`;
        this._indicator.accessible_name = `知云天气 ${data.city} ${data.panelTemp} ${data.message}`;
        this._refreshItem.setSensitive(!data.busy && !this._service.fatal && data.count < data.budget);
        this._refreshItem.label.text = data.busy ? '正在更新…' : '刷新天气';
        this._scene?.destroy();
        this._scene = paintDetails(this._details, data);
        this._scene?.setActive(this._indicator.menu.isOpen);
        if (this._calendarBox) paintCalendar(this._calendarBox, data);
    }

    disable() {
        for (const id of this._signals ?? []) this._settings.disconnect(id);
        this._signals = null;
        this._service?.destroy();
        this._service = null;
        this._scene?.destroy();
        this._scene = null;
        if (this._calendar) {
            const parent = this._calendar.get_parent() ?? this._calendarParent;
            if (this._calendar.get_parent()) this._calendar.get_parent().remove_child(this._calendar);
            this._calendar.destroy();
            if (parent && !this._originalWeather.get_parent())
                parent.insert_child_at_index(this._originalWeather,
                    Math.min(this._calendarIndex, parent.get_n_children()));
        }
        this._calendar = this._calendarBox = this._originalWeather = this._calendarParent = null;
        this._indicator?.destroy();
        this._indicator = this._details = this._icon = this._temperature = this._refreshItem = this._panel = null;
        this._settings = this._signature = this._calendarWarning = null;
    }
}
