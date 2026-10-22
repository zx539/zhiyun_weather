import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import * as Credentials from './secret.js';

export function fillPreferencesWindow(window, settings, credentials = Credentials) {
    const {lookupKey, storeKey, clearKey} = credentials;
    const cancellable = new Gio.Cancellable();
    window.set_default_size(660, 720);
    const page = new Adw.PreferencesPage({title: '知云天气', icon_name: 'weather-clear-symbolic'});
    window.add(page);
    const cityGroup = new Adw.PreferencesGroup({title: '城市',
        description: '填写六位行政区划编码。保存配置不会联网，请稍后在顶栏手动刷新。'});
    page.add(cityGroup);
    const city = new Adw.EntryRow({title: '城市 adcode', text: settings.get_string('city'),
        show_apply_button: true});
    city.connect('apply', () => {
        const value = city.text.trim();
        if (value && !/^\d{6}$/.test(value)) {
            window.add_toast(new Adw.Toast({title: '请输入六位数字 adcode，或留空清除城市'}));
            return;
        }
        settings.set_string('city', value);
        window.add_toast(new Adw.Toast({title: '城市已保存，请在顶栏手动刷新'}));
    });
    cityGroup.add(city);
    const codes = new Adw.ActionRow({title: '查找城市编码', subtitle: '高德官方行政区划编码表'});
    codes.add_suffix(new Gtk.LinkButton({label: '打开', uri: 'https://lbs.amap.com/api/webservice/download',
        valign: Gtk.Align.CENTER}));
    cityGroup.add(codes);

    const keyGroup = new Adw.PreferencesGroup({title: '高德 Web 服务 Key',
        description: 'Key 保存到持久密钥环，重启后仍保留。输入框不回显已保存的 Key，请以密钥环状态为准。仅支持无需额外数字签名的 Web 服务 Key。'});
    page.add(keyGroup);
    const entry = new Adw.PasswordEntryRow({title: '输入或替换 Key'});
    keyGroup.add(entry);
    const status = new Adw.ActionRow({title: '密钥环状态', subtitle: '正在检查…'});
    const save = new Gtk.Button({label: '保存', valign: Gtk.Align.CENTER});
    const remove = new Gtk.Button({label: '删除', valign: Gtk.Align.CENTER});
    const recheck = new Gtk.Button({label: '重新检查', valign: Gtk.Align.CENTER});
    status.add_suffix(recheck);
    status.add_suffix(remove);
    status.add_suffix(save);
    keyGroup.add(status);
    const bump = () => settings.set_int('credential-revision', (settings.get_int('credential-revision') + 1) % 2_000_000_000);
    let statusRevision = 0;
    const updateStatus = async () => {
        const revision = ++statusRevision;
        try {
            const key = await lookupKey(cancellable);
            if (!cancellable.is_cancelled() && revision === statusRevision)
                status.subtitle = key ? '已保存 Key（持久密钥环）；刷新时读取' : '尚未配置 Key';
        } catch (error) {
            if (!cancellable.is_cancelled() && revision === statusRevision)
                status.subtitle = error.safeMessage ?? '密钥环暂不可用，请解锁后重新检查';
        }
    };
    recheck.connect('clicked', () => void updateStatus());
    window.connect('notify::is-active', () => { if (window.is_active) void updateStatus(); });
    save.connect('clicked', async () => {
        const value = entry.text.trim();
        if (!/^[a-zA-Z0-9]{16,128}$/.test(value)) {
            window.add_toast(new Adw.Toast({title: '请输入有效的高德 Web 服务 Key'}));
            return;
        }
        statusRevision++;
        save.sensitive = remove.sensitive = recheck.sensitive = false;
        try {
            if (!await storeKey(value, cancellable)) throw new Error('save failed');
            if (cancellable.is_cancelled()) return;
            entry.text = '';
            bump();
            window.add_toast(new Adw.Toast({title: 'Key 已持久保存并校验，请在顶栏手动刷新'}));
        } catch (error) {
            if (!cancellable.is_cancelled()) window.add_toast(new Adw.Toast({
                title: error.safeMessage ?? '保存失败，请解锁 GNOME 密钥环后重试'}));
        } finally {
            if (!cancellable.is_cancelled()) { save.sensitive = remove.sensitive = recheck.sensitive = true; void updateStatus(); }
        }
    });
    remove.connect('clicked', async () => {
        statusRevision++;
        save.sensitive = remove.sensitive = recheck.sensitive = false;
        try {
            await clearKey(cancellable);
            if (cancellable.is_cancelled()) return;
            entry.text = '';
            bump();
        } catch {
            if (!cancellable.is_cancelled()) window.add_toast(new Adw.Toast({title: '删除失败，请检查密钥环'}));
        } finally {
            if (!cancellable.is_cancelled()) { save.sensitive = remove.sensitive = recheck.sensitive = true; void updateStatus(); }
        }
    });
    void updateStatus();

    const refreshGroup = new Adw.PreferencesGroup({title: '刷新与预算',
        description: '仅定时或手动请求。启用后等待完整间隔；休眠恢复不刷新、不补发。失败后延长自动刷新间隔，最多为设定间隔的八倍。'});
    page.add(refreshGroup);
    const interval = new Adw.SpinRow({title: '自动刷新间隔', subtitle: '分钟，默认 30',
        adjustment: new Gtk.Adjustment({lower: 15, upper: 1440, step_increment: 15, page_increment: 60})});
    settings.bind('refresh-minutes', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
    refreshGroup.add(interval);
    const budget = new Adw.SpinRow({title: '自然月本地请求预算', subtitle: '默认 4,500，最多 5,000；每轮通常两次请求',
        adjustment: new Gtk.Adjustment({lower: 1, upper: 5000, step_increment: 100, page_increment: 500})});
    settings.bind('monthly-budget', budget, 'value', Gio.SettingsBindFlags.DEFAULT);
    refreshGroup.add(budget);
    const usage = new Adw.ActionRow({title: '本地使用估计',
        subtitle: `${settings.get_string('usage-month') || '尚未请求'}：${settings.get_int('usage-count')} 次`});
    refreshGroup.add(usage);
    const ids = ['usage-month', 'usage-count'].map(key => settings.connect(`changed::${key}`, () => {
        usage.subtitle = `${settings.get_string('usage-month')}：${settings.get_int('usage-count')} 次`;
    }));
    refreshGroup.add(new Adw.ActionRow({title: '以高德控制台为准',
        subtitle: '本地按北京时间自然月计数，失败尝试也计入；达到预算后暂停请求。'}));
    const about = new Adw.PreferencesGroup({title: '数据与隐私',
        description: '数据来源：高德天气。请求只发往高德 HTTPS 接口，携带 Key 和城市 adcode。缓存与计数存放在本机用户数据目录；禁用扩展不删除缓存或密钥。实况与预报发布时间均按北京时间展示。'});
    page.add(about);
    about.add(new Adw.ActionRow({title: '日历天气',
        subtitle: '启用期间替换 GNOME 日历天气区域，禁用后恢复；不改变 GNOME 天气应用的数据源。'}));
    window.connect('close-request', () => {
        cancellable.cancel();
        entry.text = '';
        for (const id of ids) settings.disconnect(id);
        return false;
    });
}
