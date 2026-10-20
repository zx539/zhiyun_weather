export const CITY = '110101';
export const NOW = Date.parse('2026-10-20T12:00:00+08:00');
export function liveResponse(city = CITY) {
    return {status: '1', infocode: '10000', lives: [{
        province: '北京', city: '东城区', adcode: city, weather: '晴', temperature: '18',
        winddirection: '北', windpower: '≤3', humidity: '42', reporttime: '2026-10-20 11:30:00',
    }]};
}
export function forecastResponse(city = CITY) {
    return {status: '1', infocode: '10000', forecasts: [{
        province: '北京', city: '东城区', adcode: city, reporttime: '2026-10-20 11:00:00',
        casts: [20, 21, 22, 23].map((day, index) => ({
            date: `2026-10-${day}`, week: String(index + 2),
            dayweather: '晴', nightweather: '多云', daytemp: '20', nighttemp: '8',
            daywind: '北', nightwind: '南', daypower: '≤3', nightpower: '1-3',
        })),
    }]};
}
