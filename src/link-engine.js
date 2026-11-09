// WI Hero link engine, phase 2: leaders + one smooth S-curve per link.
// Pure module: no DOM, no ST, no pieces. Everything arrives through the API.
//
// Phase 2 scope: ports get a short leader along their normal, the link is a single
// cubic between the leader ends, and a straight port-to-port line is the fallback.
// `via`, `enter` and `shape` are accepted on a def and ignored until phases 3 and 6.
// Obstacle rectangles are only used to spot overlapping end cards (the fallback case).
//
// Port normal `n` may be a side name ('left' | 'right' | 'top' | 'bottom'), an [x, y]
// array or an { x, y } object. A missing or invalid normal points at the other port.

const EPS = 1e-9;
const SIDES = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const num = (v) => (Number.isFinite(v) ? v : 0);
const fmt = (v) => String(Math.round(v * 100) / 100);

function unit(x, y) {
    const m = Math.hypot(x, y);
    return m < EPS ? null : [x / m, y / m];
}

function normal(n) {
    if (typeof n === 'string') return SIDES[n] || null;
    if (Array.isArray(n)) return unit(num(n[0]), num(n[1]));
    if (n && typeof n === 'object') return unit(num(n.x), num(n.y));
    return null;
}

// Dominant axis of (dx, dy), as a unit vector.
function axisToward(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return [dx >= 0 ? 1 : -1, 0];
    return [0, dy >= 0 ? 1 : -1];
}

function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Handle point for one end. (dx, dy) points from this end to the other end.
// A port that faces away from the other end gets a longer handle pushed sideways,
// so the link leaves along the normal and curves round instead of doubling back.
function handle(x, y, n, dx, dy, span, h) {
    const fwd = span < EPS ? 1 : (n[0] * dx + n[1] * dy) / span;
    const away = fwd < 0 ? Math.min(1, -fwd) : 0;
    let hx = x + n[0] * h * (1 + 0.5 * away);
    let hy = y + n[1] * h * (1 + 0.5 * away);
    if (away > 0) {
        const side = n[0] * dy - n[1] * dx >= 0 ? 1 : -1;
        hx += -n[1] * side * h * away;
        hy += n[0] * side * h * away;
    }
    return [hx, hy];
}

const lineParts = (ax, ay, bx, by) => [{ k: 'L', p: [ax, ay, bx, by] }];

function build(parts, drawn) {
    let d = `M${fmt(parts[0].p[0])} ${fmt(parts[0].p[1])}`;
    for (const { k, p } of parts) {
        d += k === 'L'
            ? `L${fmt(p[2])} ${fmt(p[3])}`
            : `C${fmt(p[2])} ${fmt(p[3])} ${fmt(p[4])} ${fmt(p[5])} ${fmt(p[6])} ${fmt(p[7])}`;
    }
    const first = parts[0].p;
    const last = parts[parts.length - 1];
    const startTangent = pick([
        [first[2] - first[0], first[3] - first[1]],
        [first[4] - first[0], first[5] - first[1]],
        [first[6] - first[0], first[7] - first[1]],
    ]);
    const lp = last.p;
    const endTangent = last.k === 'L'
        ? pick([[lp[2] - lp[0], lp[3] - lp[1]]])
        : pick([[lp[6] - lp[4], lp[7] - lp[5]], [lp[6] - lp[2], lp[7] - lp[3]], [lp[6] - lp[0], lp[7] - lp[1]]]);
    return { d, startTangent, endTangent, drawn, parts };
}

// First candidate vector with a direction; {1, 0} if none has one.
function pick(candidates) {
    for (const [x, y] of candidates) {
        const u = unit(num(x), num(y));
        if (u) return { x: u[0], y: u[1] };
    }
    return { x: 1, y: 0 };
}

function compile(def, overlap, opts) {
    const A = def.from || {};
    const B = def.to || {};
    const ax = num(A.x), ay = num(A.y), bx = num(B.x), by = num(B.y);
    const chord = Math.hypot(bx - ax, by - ay);
    if (chord < 1 || overlap) return build(lineParts(ax, ay, bx, by), ['straight']);

    const n = normal(A.n) || axisToward(bx - ax, by - ay);
    const m = normal(B.n) || axisToward(ax - bx, ay - by);
    const lead = Math.min(opts.stub, chord / 3);
    const l = lead >= 1 ? lead : 0;

    const qx = ax + n[0] * l, qy = ay + n[1] * l;
    const rx = bx + m[0] * l, ry = by + m[1] * l;
    const dx = rx - qx, dy = ry - qy;
    const span = Math.hypot(dx, dy);
    const h = opts.tension * span;
    const c1 = handle(qx, qy, n, dx, dy, span, h);
    const c2 = handle(rx, ry, m, -dx, -dy, span, h);

    const parts = [];
    if (l) parts.push({ k: 'L', p: [ax, ay, qx, qy] });
    parts.push({ k: 'C', p: [qx, qy, c1[0], c1[1], c2[0], c2[1], rx, ry] });
    if (l) parts.push({ k: 'L', p: [rx, ry, bx, by] });
    return build(parts, ['curve']);
}

// Flatten to a flat [x0, y0, x1, y1, ...] array. Uniform subdivision of each cubic:
// the error is at most 0.75 * L / n^2, with L the larger second difference of the
// control polygon, so n = ceil(sqrt(0.75 * L / tol)) keeps every chord within tol.
function flatten(parts, tol) {
    const out = [parts[0].p[0], parts[0].p[1]];
    for (const { k, p } of parts) {
        if (k === 'L') {
            out.push(p[2], p[3]);
            continue;
        }
        const L = Math.max(
            Math.hypot(p[0] - 2 * p[2] + p[4], p[1] - 2 * p[3] + p[5]),
            Math.hypot(p[2] - 2 * p[4] + p[6], p[3] - 2 * p[5] + p[7]),
        );
        const n = Math.min(512, Math.max(1, Math.ceil(Math.sqrt((0.75 * L) / tol))));
        for (let i = 1; i <= n; i++) {
            const t = i / n, u = 1 - t;
            const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
            out.push(
                a * p[0] + b * p[2] + c * p[4] + e * p[6],
                a * p[1] + b * p[3] + c * p[5] + e * p[7],
            );
        }
    }
    return out;
}

export function createLinkEngine(options = {}) {
    const opts = { grid: 12, clearance: 8, stub: 12, laneGap: 8, tension: 0.5, ...options };
    let rects = new Map();
    const links = new Map(); // id -> { sig, path }
    let computes = 0;

    function setObstacles(list) {
        rects = new Map();
        for (const r of list || []) rects.set(r.id, r);
    }

    function overlapOf(def) {
        const a = def.from && def.from.card;
        const b = def.to && def.to.card;
        if (a === undefined || b === undefined || a === b) return false;
        const ra = rects.get(a), rb = rects.get(b);
        return !!(ra && rb && overlaps(ra, rb));
    }

    // Call setObstacles first, then layout. Returns what changed so the host can redraw only that.
    function layout(defs) {
        const seen = new Set();
        const changed = [];
        for (const def of defs || []) {
            if (!def || def.id === undefined) continue;
            seen.add(def.id);
            const overlap = overlapOf(def);
            const f = def.from || {}, t = def.to || {};
            const sig = JSON.stringify([f.x, f.y, f.n, t.x, t.y, t.n, overlap]);
            const prev = links.get(def.id);
            if (prev && prev.sig === sig) continue;
            links.set(def.id, { sig, path: compile(def, overlap, opts) });
            computes++;
            changed.push(def.id);
        }
        const removed = [];
        for (const id of links.keys()) {
            if (!seen.has(id)) {
                links.delete(id);
                removed.push(id);
            }
        }
        return { changed, removed };
    }

    function path(id) {
        const e = links.get(id);
        if (!e) return null;
        const { d, startTangent, endTangent, drawn } = e.path;
        return { d, startTangent, endTangent, drawn };
    }

    function polyline(id, tol = 0.5) {
        const e = links.get(id);
        return e ? flatten(e.path.parts, tol) : null;
    }

    // Nearest point on a link. A link with no shape is one stretch, so segment is 0.
    function nearest(id, point) {
        const pts = polyline(id, 0.25);
        if (!pts) return null;
        let best = { dist: Infinity, at: 0 };
        let run = 0;
        for (let i = 0; i + 3 < pts.length; i += 2) {
            const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
            const vx = x1 - x0, vy = y1 - y0;
            const len = Math.hypot(vx, vy);
            const s = len < EPS ? 0 : Math.max(0, Math.min(1, ((point.x - x0) * vx + (point.y - y0) * vy) / (len * len)));
            const dist = Math.hypot(point.x - (x0 + vx * s), point.y - (y0 + vy * s));
            if (dist < best.dist) best = { dist, at: run + len * s };
            run += len;
        }
        return { segment: 0, t: run < EPS ? 0 : best.at / run, dist: best.dist };
    }

    const stats = () => ({ links: links.size, computes });

    return { setObstacles, layout, path, polyline, nearest, stats };
}
