// Geometry for the link engine: vectors, rectangles, cubic curves and SVG path text.
// Pure functions, no DOM.

export const EPS = 1e-9;
export const SIDES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export const num = v => (Number.isFinite(v) ? v : 0);
export const fmt = v => String(Math.round(v * 100) / 100);

export function unit(x, y) {
    const m = Math.hypot(x, y);
    return m < EPS ? null : [x / m, y / m];
}

/** A port normal from a side name, an [x, y] array or an { x, y } object; null when it has no direction. */
export function normal(n) {
    if (typeof n === 'string') return SIDES[n] || null;
    if (Array.isArray(n)) return unit(num(n[0]), num(n[1]));
    if (n && typeof n === 'object') return unit(num(n.x), num(n.y));
    return null;
}

/** The dominant axis of (dx, dy), as a unit vector. */
export function axisToward(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return [dx >= 0 ? 1 : -1, 0];
    return [0, dy >= 0 ? 1 : -1];
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether the segment a→b enters the open rectangle r grown by m on every side (Liang–Barsky). */
export function segHitsRect(ax, ay, bx, by, r, m) {
    const x0 = r.x - m; const x1 = r.x + r.w + m; const y0 = r.y - m; const y1 = r.y + r.h + m;
    if (x1 <= x0 || y1 <= y0) return false;
    if (Math.max(ax, bx) <= x0 || Math.min(ax, bx) >= x1 || Math.max(ay, by) <= y0 || Math.min(ay, by) >= y1) return false;
    const dx = bx - ax; const dy = by - ay;
    let t0 = 0; let t1 = 1;
    const clip = (p, q) => {
        if (Math.abs(p) < EPS) return q > 0;
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
        return true;
    };
    if (!clip(-dx, ax - x0) || !clip(dx, x1 - ax) || !clip(-dy, ay - y0) || !clip(dy, y1 - ay)) return false;
    // Touching the border only (a zero-length overlap) is not entering.
    return t1 - t0 > 1e-6;
}

/**
 * A path is a list of parts: { k: 'L', p: [x0, y0, x1, y1] } or { k: 'C', p: [x0, y0, c1x, c1y, c2x, c2y, x1, y1] }.
 * These turn it into SVG `d` text, flatten it to points, and give its end tangents.
 */
export function pathD(parts) {
    let d = `M${fmt(parts[0].p[0])} ${fmt(parts[0].p[1])}`;
    for (const { k, p } of parts) {
        d += k === 'L'
            ? `L${fmt(p[2])} ${fmt(p[3])}`
            : `C${fmt(p[2])} ${fmt(p[3])} ${fmt(p[4])} ${fmt(p[5])} ${fmt(p[6])} ${fmt(p[7])}`;
    }
    return d;
}

/** The first candidate vector with a direction; {1, 0} if none has one. */
function pick(candidates) {
    for (const [x, y] of candidates) {
        const u = unit(num(x), num(y));
        if (u) return { x: u[0], y: u[1] };
    }
    return { x: 1, y: 0 };
}

export function tangents(parts) {
    const dirs = ({ k, p }) => (k === 'L'
        ? [[p[2] - p[0], p[3] - p[1]]]
        : [[p[2] - p[0], p[3] - p[1]], [p[4] - p[0], p[5] - p[1]], [p[6] - p[0], p[7] - p[1]]]);
    const back = ({ k, p }) => (k === 'L'
        ? [[p[2] - p[0], p[3] - p[1]]]
        : [[p[6] - p[4], p[7] - p[5]], [p[6] - p[2], p[7] - p[3]], [p[6] - p[0], p[7] - p[1]]]);
    // Zero-length parts have no direction: look past them.
    return { startTangent: pick(parts.flatMap(dirs)), endTangent: pick(parts.slice().reverse().flatMap(back)) };
}

/**
 * Flatten to a flat [x0, y0, x1, y1, ...] array. Uniform subdivision of each cubic: the error is at most
 * 0.75 * L / n^2, with L the larger second difference of the control polygon, so n = ceil(sqrt(0.75 * L / tol))
 * keeps every chord within tol. `from` and `to` pick a range of parts.
 */
export function flatten(parts, tol, from = 0, to = parts.length) {
    const out = [parts[from].p[0], parts[from].p[1]];
    for (let j = from; j < to; j++) {
        const { k, p } = parts[j];
        if (k === 'L') { out.push(p[2], p[3]); continue; }
        const L = Math.max(
            Math.hypot(p[0] - 2 * p[2] + p[4], p[1] - 2 * p[3] + p[5]),
            Math.hypot(p[2] - 2 * p[4] + p[6], p[3] - 2 * p[5] + p[7]),
        );
        const n = Math.min(512, Math.max(1, Math.ceil(Math.sqrt((0.75 * L) / tol))));
        for (let i = 1; i <= n; i++) {
            const t = i / n; const u = 1 - t;
            const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t * t; const e = t * t * t;
            out.push(a * p[0] + b * p[2] + c * p[4] + e * p[6], a * p[1] + b * p[3] + c * p[5] + e * p[7]);
        }
    }
    return out;
}

/** The bounding box of a flat point list. */
export function boxOf(pts) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
        if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
