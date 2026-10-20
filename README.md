# 知云天气

这是一个面向 Fedora 44 / GNOME 50 的个人 GNOME Shell 扩展：顶栏和 GNOME 日历下方共用高德天气 Web Service 的实况与四天预报缓存。

## 安装

在项目目录中运行：

```bash
gnome-extensions install --force dist/rational-weather@local.shell-extension.zip
```

第一次安装后注销并重新登录，让 GNOME 发现新扩展，然后运行：

```bash
gnome-extensions enable rational-weather@local
gnome-extensions prefs rational-weather@local
```

更新已加载的 JavaScript 后也建议注销重新登录。可运行 `bash scripts/package.sh` 重新生成安装包。

首次使用打开扩展设置：填写高德行政区划 `adcode`、保存自己的 Web 服务 Key，然后回到顶栏手动刷新。Key 只写入 GNOME 密钥环，不会写入源码、GSettings、缓存或日志。

## 行为约定

- 顶栏图标与轻量底色随天气变化；展开面板显示日光、云层、雨线、雾带、雪花或雷暴等对应背景。四天预报的白天和夜间也显示各自的天气图标。
- 背景动画只在展开面板可见时运行，关闭面板和禁用扩展会停止并清理动画；遵循 GNOME 的动画开关，高对比度模式不绘制背景。装饰完全在本地绘制，不增加天气 API 请求。
- 晴天和多云在北京时间 18:00–06:00 使用月亮图标和夜间配色。这是固定的界面昼夜规则，不是日出日落预报。
- 启用后先显示本地缓存；首次定时刷新在完整间隔后进行。保存设置、打开菜单、切换城市和从休眠恢复不会发请求。
- 默认每 30 分钟刷新；实况和预报串行请求，二者请求开始至少间隔一秒；手动刷新至少间隔 60 秒，任务不会重叠。
- 每个自然月默认最多保守计入 4,500 次请求；失败尝试也计入。达到预算后暂停请求，实际额度以高德控制台为准。
- 失败时保留对应缓存。实况超过一小时标记过期，超过三小时不再作为当前温度显示；预报按日期过滤过去日期。
- GNOME 日历天气区域使用 GNOME 50 的私有 actor 结构替换，禁用扩展时恢复原 actor。GNOME Shell 大版本升级后需要重新验证。

## 数据源

接口为 `https://restapi.amap.com/v3/weather/weatherInfo`。`extensions=base` 返回实况，`extensions=all` 返回四天按白天／夜间划分的预报。项目不向墨迹天气发起请求，也不绕过网页访问限制。

## 开发检查

```bash
bash scripts/check.sh
```

检查包含 Node 单元测试、GJS 导入和无真实 API 请求的缓存/额度冒烟测试。真实接口和活跃 GNOME Shell 中的 UI、密钥环交互需要在你的桌面会话中验证。

### 隔离桌面验证

```bash
npm run smoke:desktop
```

此命令在 `/tmp` 创建独立的 XDG 目录、设置文件、D-Bus 会话和无头 GNOME Shell，不安装或启用你当前桌面的扩展。使用模拟天气和模拟密钥，不向高德发送请求、不读取你的真实 Key。验证空状态、天气详情、日历替换、过期提示、设置页输入与绑定、禁用恢复和重复启停。日志和 JSON 结果保留在脚本打印的临时目录中。

运行需要 GNOME 50、GTK 4、libadwaita 和允许创建本地套接字的环境。受限沙箱可能无法启动隔离 D-Bus；此时脚本会失败并保留日志，这不代表桌面验证已经通过。若已有可用显示会话，也可单独运行 `gjs -m tests/gtk-smoke.mjs` 验证设置页；它使用内存设置和模拟密钥。

### 验证状态

0.3.0 包含天气分类、背景动画和自带的特殊天气图标。自动检查覆盖逻辑、真实 GJS 服务文件读写及调度、GNOME/GTK 属性与信号、深浅主题的 Cairo 绘制和 SVG 图标解析。隔离桌面验证脚本已增加天气切换、关闭面板停止动画和禁用清理检查；当前开发沙箱禁止 D-Bus 套接字，这些界面集成检查仍需在本机运行。

### 天气背景预览

```bash
npm run preview:weather
```

使用与插件相同的 Cairo 绘图代码，在无显示环境下生成 `dist/weather-preview-dark.png` 和 `dist/weather-preview-light.png`，覆盖晴、云、雨、雾、雪、雷暴、雨夹雪、冰雹、霾、沙尘、大风、冷热及夜间效果。预览是静态绘图样本，温度为演示数据，不是 GNOME 桌面截图。

缓存和请求记录位于 `${XDG_DATA_HOME:-~/.local/share}/rational-weather/state.json`，文件权限为 `0600`。缓存或额度记录损坏时暂停请求，避免丢失计数后继续消耗额度。
