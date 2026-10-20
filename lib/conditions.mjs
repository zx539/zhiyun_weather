// One vocabulary shared by panel icons, forecast icons and decorative backgrounds.
const ICONS = {
    clear: 'weather-clear-symbolic',
    cloudy: 'weather-few-clouds-symbolic',
    overcast: 'weather-overcast-symbolic',
    rain: 'weather-showers-symbolic',
    storm: 'weather-storm-symbolic',
    sleet: 'weather-sleet-symbolic',
    snow: 'weather-snow-symbolic',
    hail: 'weather-hail-symbolic',
    fog: 'weather-fog-symbolic',
    haze: 'weather-haze-symbolic',
    dust: 'weather-dust-symbolic',
    wind: 'weather-windy-symbolic',
    tornado: 'weather-tornado-symbolic',
    hot: 'weather-hot-symbolic',
    cold: 'weather-cold-symbolic',
    unknown: 'weather-severe-alert-symbolic',
};

export function weatherKind(weather) {
    const text = typeof weather === 'string' ? weather.trim() : '';
    // Mixed precipitation takes precedence over the single rain/snow branches.
    if (/龙卷/.test(text)) return 'tornado';
    if (/雷/.test(text)) return 'storm';
    if (/雨夹雪|雨雪|雪雨/.test(text)) return 'sleet';
    if (/冰雹|冰粒/.test(text)) return 'hail';
    if (/雪/.test(text)) return 'snow';
    if (/雨/.test(text)) return 'rain';
    if (/沙|尘/.test(text)) return 'dust';
    if (/霾/.test(text)) return 'haze';
    if (/雾/.test(text)) return 'fog';
    if (/多云|少云/.test(text)) return 'cloudy';
    if (/阴/.test(text)) return 'overcast';
    if (/晴/.test(text)) return 'clear';
    if (/风/.test(text)) return 'wind';
    if (/热|高温/.test(text)) return 'hot';
    if (/冷|低温/.test(text)) return 'cold';
    return 'unknown';
}

export function weatherAppearance(weather, night = false) {
    const kind = weatherKind(weather);
    const nocturnal = Boolean(night) && ['clear', 'cloudy'].includes(kind);
    const icon = nocturnal ? ICONS[kind].replace('-symbolic', '-night-symbolic') : ICONS[kind];
    return {kind, night: nocturnal, icon, className: nocturnal ? `${kind}-night` : kind};
}

export function weatherIcon(weather, night = false) {
    return weatherAppearance(weather, night).icon;
}

export function isNight(now) {
    const hour = new Date(now + 8 * 3_600_000).getUTCHours();
    // Fixed visual day/night boundary; the weather API has no sunrise/sunset data.
    return hour < 6 || hour >= 18;
}
