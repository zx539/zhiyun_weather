// Cairo vector artwork used by both GNOME DrawingArea and the offline preview.
// No images, network requests, timers or GTK dependencies in this module.
const TAU = Math.PI * 2;
const PALETTES = {
    clear: [0.96, 0.68, 0.19], cloudy: [0.42, 0.65, 0.88], overcast: [0.55, 0.62, 0.70],
    rain: [0.25, 0.58, 0.95], storm: [0.56, 0.47, 0.90], sleet: [0.40, 0.74, 0.92],
    snow: [0.51, 0.78, 0.95], hail: [0.42, 0.70, 0.88], fog: [0.63, 0.70, 0.76],
    haze: [0.72, 0.63, 0.46], dust: [0.85, 0.61, 0.32], wind: [0.36, 0.73, 0.69],
    tornado: [0.57, 0.61, 0.70], hot: [0.96, 0.48, 0.22], cold: [0.42, 0.75, 0.93],
    unknown: [0.55, 0.60, 0.67],
};

function color(cr, rgb, alpha) { cr.setSourceRGBA(...rgb, alpha); }
function circle(cr, x, y, radius, rgb, alpha) {
    color(cr, rgb, alpha);
    cr.arc(x, y, radius, 0, TAU);
    cr.fill();
}
function line(cr, x1, y1, x2, y2, rgb, alpha, width = 1.5) {
    color(cr, rgb, alpha);
    cr.setLineWidth(width);
    cr.moveTo(x1, y1);
    cr.lineTo(x2, y2);
    cr.stroke();
}

function cloud(cr, x, y, size, ink, alpha) {
    cr.save();
    cr.translate(x, y);
    cr.scale(size, size);
    cr.moveTo(-1, 0.35);
    cr.curveTo(-1.42, 0.33, -1.40, -0.32, -0.91, -0.38);
    cr.curveTo(-0.87, -1.10, 0.08, -1.20, 0.36, -0.61);
    cr.curveTo(0.88, -0.88, 1.30, -0.48, 1.24, -0.07);
    cr.curveTo(1.82, 0.13, 1.45, 0.62, 0.99, 0.60);
    cr.lineTo(-0.91, 0.60);
    cr.closePath();
    color(cr, ink, alpha);
    cr.fill();
    cr.restore();
}

function sun(cr, x, y, radius, tint, phase, night) {
    if (night) {
        color(cr, [0.58, 0.70, 0.97], 0.50 + 0.05 * Math.sin(phase * TAU));
        cr.save();
        cr.translate(x, y);
        cr.scale(radius / 20, radius / 20);
        cr.moveTo(12, -17);
        cr.curveTo(-16, -26, -28, 8, -10, 19);
        cr.curveTo(6, 29, 21, 15, 20, 7);
        cr.curveTo(-1, 14, -8, -4, 12, -17);
        cr.fill();
        cr.restore();
        for (let i = 0; i < 5; i++)
            circle(cr, x - 55 + i * 24, y - 30 - i % 2 * 10, 1.2, [0.58, 0.70, 0.97],
                0.32 + 0.1 * Math.sin((phase + i / 5) * TAU));
        return;
    }
    const pulse = 1 + 0.04 * Math.sin(phase * TAU);
    for (const [scale, alpha] of [[2.2, 0.04], [1.6, 0.08], [1, 0.36]])
        circle(cr, x, y, radius * scale * pulse, tint, alpha);
    for (let i = 0; i < 10; i++) {
        const angle = i * TAU / 10 + Math.sin(phase * TAU) * 0.05;
        line(cr, x + Math.cos(angle) * radius * 1.25, y + Math.sin(angle) * radius * 1.25,
            x + Math.cos(angle) * radius * 1.5, y + Math.sin(angle) * radius * 1.5,
            tint, 0.30, 2);
    }
}

function flake(cr, x, y, radius, tint, alpha) {
    for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI / 3;
        line(cr, x - Math.cos(angle) * radius, y - Math.sin(angle) * radius,
            x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, tint, alpha, 1.2);
    }
}

export function drawWeatherScene(cr, width, height, {
    kind = 'unknown', night = false, phase = 0, foreground = [0.8, 0.85, 0.9],
} = {}) {
    if (width <= 0 || height <= 0) return;
    const tint = night ? [0.43, 0.55, 0.89] : PALETTES[kind] ?? PALETTES.unknown;
    const x = width * 0.79;
    const y = height * 0.42;
    const radius = Math.min(height * 0.16, 23);
    const drift = Math.sin(phase * TAU) * 6;
    cr.save();
    const corner = Math.min(14, width / 2, height / 2);
    cr.newPath();
    cr.arc(width - corner, corner, corner, -Math.PI / 2, 0);
    cr.arc(width - corner, height - corner, corner, 0, Math.PI / 2);
    cr.arc(corner, height - corner, corner, Math.PI / 2, Math.PI);
    cr.arc(corner, corner, corner, Math.PI, Math.PI * 1.5);
    cr.closePath();
    cr.clip();
    color(cr, tint, 0.07);
    cr.paint();
    circle(cr, x, y, height * 0.9, tint, 0.04);
    circle(cr, x, y, height * 0.63, tint, 0.04);

    if (['clear', 'hot', 'cloudy'].includes(kind))
        sun(cr, x + (kind === 'cloudy' ? 12 : 0), y - (kind === 'cloudy' ? 7 : 0), radius, tint, phase, night);
    if (['cloudy', 'overcast', 'rain', 'storm', 'sleet', 'snow', 'hail'].includes(kind)) {
        cloud(cr, x - 16 + drift, y + 10, radius * 1.35, foreground, kind === 'cloudy' ? 0.15 : 0.20);
        cloud(cr, x + 29 - drift * 0.5, y - 6, radius * 0.9, foreground, 0.10);
    }
    if (['rain', 'storm', 'sleet', 'snow', 'hail', 'cold'].includes(kind)) {
        const count = kind === 'storm' ? 15 : 10;
        for (let i = 0; i < count; i++) {
            const px = width * 0.53 + ((i * 37 % 103) / 103) * width * 0.43 + drift * 0.3;
            const speed = ['snow', 'cold'].includes(kind) ? 2 : 6;
            const py = ((phase * speed + i * 0.173) % 1) * (height + 25) - 12;
            if (kind === 'snow' || kind === 'cold' || kind === 'sleet' && i % 2 === 0)
                flake(cr, px, py, 2.5 + i % 3, tint, 0.44);
            else if (kind === 'hail') {
                circle(cr, px, py, 2.2 + i % 2, tint, 0.43);
                line(cr, px - 3, py - 7, px - 1, py - 3, tint, 0.18);
            } else
                line(cr, px + 3, py - 8 - i % 4, px, py, tint, 0.34);
        }
    }
    if (kind === 'storm') {
        // A steady, gently varying bolt; no rapid flashing.
        color(cr, [0.85, 0.69, 0.96], 0.25 + 0.1 * Math.sin(phase * TAU));
        cr.moveTo(x + 7, y + 15);
        cr.lineTo(x - 5, y + 37);
        cr.lineTo(x + 5, y + 36);
        cr.lineTo(x - 2, y + 56);
        cr.lineTo(x + 22, y + 26);
        cr.lineTo(x + 9, y + 28);
        cr.closePath();
        cr.fill();
    }
    if (['fog', 'haze', 'dust', 'hot'].includes(kind)) {
        for (let i = 0; i < 5; i++) {
            const start = width * (0.50 + i % 2 * 0.08) + drift * (i % 2 ? -1 : 1);
            line(cr, start, height * (0.25 + i * 0.13), width + drift,
                height * (0.25 + i * 0.13), kind === 'fog' ? foreground : tint, 0.08 + i % 2 * 0.04, 5 + i % 3);
        }
        if (kind === 'dust' || kind === 'haze') {
            for (let i = 0; i < 18; i++)
                circle(cr, width * (0.51 + ((i * 31 % 97) / 97) * 0.46) + drift,
                    height * ((i * 17 % 89) / 89), 0.9 + i % 2, tint, 0.23);
        }
    }
    if (kind === 'wind' || kind === 'tornado') {
        for (let i = 0; i < 5; i++) {
            const start = width * (kind === 'tornado' ? 0.62 + i * 0.025 : 0.55) + drift;
            const end = width * (kind === 'tornado' ? 0.96 - i * 0.025 : 0.96);
            const py = height * (0.25 + i * 0.13);
            color(cr, tint, 0.25);
            cr.setLineWidth(2);
            cr.moveTo(start, py);
            cr.curveTo(start + 10, py - 9, end + 10, py + 12, end, py - 5);
            cr.stroke();
        }
    }
    cr.restore();
}
