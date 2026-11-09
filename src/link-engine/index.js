// WI Hero link engine: smooth curves between ports that go around cards.
// Pure module: no DOM, no ST, no pieces. It knows rectangles, ports, points and paths; WI Hero knows what a link
// means and draws it. See docs (link engine handout) for the split.
//
// How a link is made:
// 1. Each port gets a short leader along its outward normal.
// 2. If one S-curve between the leader ends is clear of every card, that's the link (few bends, rule 1).
// 3. Otherwise a lattice search finds a way round, string pulling cuts it down to the few corners it really
//    needs, and a smooth curve is fitted through those. If the curve clips a card, it is pulled tighter
//    (lower tension) until it doesn't.
//
// Obstacles: { id, x, y, w, h, pass?: 'never' | 'members', members?: Set | Array }. A link may enter an obstacle
// whose id is in its `owner`, or a 'members' obstacle when one of its end cards is a member (a pack frame).
// Ports: { x, y, n, card? }, n = outward normal as a side name, [x, y] or { x, y }; card = the obstacle id the
// port sits on.

import { EPS, axisToward, boxOf, flatten, normal, num, overlaps, pathD, segHitsRect, tangents, unit } from './geom.js';
import { inside, makeGrid, mark, search } from './grid.js';
import { normalize, toCanvas } from './shape.js';

/**
 * Whether a link's flattened points (from engine.polyline) pass through a rectangle's inside, `pad` in from its
 * border: the curve-aware version of canvas-graph's crosses, for tests that check links never cross cards.
 */
export function crosses(pts, r, pad = 1) {
    for (let i = 0; i + 3 < pts.length; i += 2) if (segHitsRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, -pad)) return true;
    return false;
}

export { TYPES, addDot, moveDot, normalize, removeDot, reset, setSegment, toCanvas, toLocal } from './shape.js';


export function createLinkEngine(options = {}) {
    // scales: handle lengths tried for the one-curve link, in order of preference.
    const opts = { grid: 12, clearance: 14, margin: 2, stub: 12, tension: 0.5, bend: 4, radius: 40, laneGap: 8, scales: [1, 0.6, 1.5, 0.35], ...options };
    let rects = new Map();
    let dirty = []; // obstacles added, removed or moved since the last layout (old and new rects)
    let buckets = null; // obstacles by coarse cell, for quick lookups near a point or box
    let grid = null; // built lazily, the first time a link needs routing after the obstacles change
    const links = new Map(); // id -> { sig, path, box }
    let computes = 0;
    let routes = 0;

    function setObstacles(list) {
        const next = new Map();
        for (const r of list || []) if (r && r.id !== undefined) next.set(r.id, r);
        for (const [id, r] of next) {
            const o = rects.get(id);
            if (!o) dirty.push(r);
            else if (o.x !== r.x || o.y !== r.y || o.w !== r.w || o.h !== r.h || o.pass !== r.pass || o.members !== r.members) dirty.push(o, r);
        }
        for (const [id, o] of rects) if (!next.has(id)) dirty.push(o);
        rects = next;
        buckets = null;
        if (dirty.length) grid = null;
    }

    // ---- which obstacles a link may enter

    const memberOf = (r, card) => card !== undefined && r.members
        && (typeof r.members.has === 'function' ? r.members.has(card) : r.members.includes(card));

    function passable(def) {
        const out = new Set();
        const own = def.owner;
        const a = def.from?.card; const b = def.to?.card;
        for (const [id, r] of rects) {
            if (own && (typeof own.has === 'function' ? own.has(id) : own.includes?.(id))) out.add(id);
            else if (r.pass === 'members' && (memberOf(r, a) || memberOf(r, b))) out.add(id);
        }
        return out;
    }

    /** Whether a flat point list stays clear of every card it may not enter. End cards may be touched, not entered. */
    function clear(pts, pass, ends) {
        const box = boxOf(pts);
        const bx1 = box.x + box.w; const by1 = box.y + box.h;
        for (const [id, r] of near(box.x, box.y, bx1, by1, opts.margin)) {
            const m = ends.has(id) ? 0 : opts.margin;
            if (r.x - m > bx1 || r.x + r.w + m < box.x || r.y - m > by1 || r.y + r.h + m < box.y || pass.has(id)) continue;
            for (let i = 0; i + 3 < pts.length; i += 2) if (segHitsRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, m)) return false;
        }
        return true;
    }

    /** Line of sight for string pulling: against obstacles grown by the full clearance. */
    const CELL = 256;
    const seen = new Set();
    /** The obstacles whose rectangles, grown by m, might touch the box x0..x1, y0..y1. */
    function near(x0, y0, x1, y1, m) {
        if (!buckets) {
            buckets = new Map();
            for (const [id, r] of rects) {
                for (let j = Math.floor((r.y - 32) / CELL); j <= Math.floor((r.y + r.h + 32) / CELL); j++) {
                    for (let i = Math.floor((r.x - 32) / CELL); i <= Math.floor((r.x + r.w + 32) / CELL); i++) {
                        const k = `${i},${j}`;
                        if (!buckets.has(k)) buckets.set(k, []);
                        buckets.get(k).push([id, r]);
                    }
                }
            }
        }
        // Huge boxes: just go through everything.
        if ((x1 - x0) * (y1 - y0) > 64 * CELL * CELL) return rects;
        seen.clear();
        const out = [];
        for (let j = Math.floor((y0 - m) / CELL); j <= Math.floor((y1 + m) / CELL); j++) {
            for (let i = Math.floor((x0 - m) / CELL); i <= Math.floor((x1 + m) / CELL); i++) {
                const b = buckets.get(`${i},${j}`);
                if (b) for (const e of b) if (!seen.has(e[0])) { seen.add(e[0]); out.push(e); }
            }
        }
        return out;
    }

    function sees(a, b, pass, ends) {
        for (const [id, r] of near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), opts.clearance)) {
            if (pass.has(id)) continue;
            if (segHitsRect(a[0], a[1], b[0], b[1], r, ends.has(id) ? opts.margin : opts.clearance)) return false;
        }
        return true;
    }

    function ensureGrid(defs) {
        if (grid) {
            const ok = defs.every(d => inside(grid, num(d.from?.x), num(d.from?.y)) && inside(grid, num(d.to?.x), num(d.to?.y)));
            if (ok) return grid;
        }
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        const take = (x, y, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
        for (const r of rects.values()) take(r.x, r.y, r.w, r.h);
        for (const d of defs) { take(num(d.from?.x), num(d.from?.y)); take(num(d.to?.x), num(d.to?.y)); }
        if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
        const pad = 240;
        grid = makeGrid({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }, opts.grid);
        for (const r of rects.values()) mark(grid, r, opts.clearance, 1);
        return grid;
    }

    // ---- shapes

    // Handle point for one end of the direct S-curve. (dx, dy) points from this end to the other end.
    // A port that faces away from the other end gets a longer handle pushed sideways, so the link leaves along
    // the normal and curves round instead of doubling back.
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

    function direct(A, n, B, m, q, r, scale) {
        const dx = r[0] - q[0]; const dy = r[1] - q[1];
        const span = Math.hypot(dx, dy);
        const h = opts.tension * scale * span;
        const c1 = handle(q[0], q[1], n, dx, dy, span, h);
        const c2 = handle(r[0], r[1], m, -dx, -dy, span, h);
        return [{ k: 'C', p: [q[0], q[1], c1[0], c1[1], c2[0], c2[1], r[0], r[1]] }];
    }

    /**
     * Straight runs between the waypoints, each corner rounded by an arc (a cubic close to a circle). `legs[i]` is
     * how far along each side corner i starts and ends its arc. P = [port, corner, ..., corner, port].
     */
    function filleted(P, legs) {
        const parts = [];
        let at = P[0];
        for (let i = 1; i < P.length - 1; i++) {
            const a = P[i - 1]; const c = P[i]; const b = P[i + 1];
            const la = Math.hypot(c[0] - a[0], c[1] - a[1]); const lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
            const t = legs[i];
            if (!t || la < EPS || lb < EPS) { parts.push({ k: 'L', p: [at[0], at[1], c[0], c[1]] }); at = c; continue; }
            const u = [(c[0] - a[0]) / la, (c[1] - a[1]) / la]; const v = [(b[0] - c[0]) / lb, (b[1] - c[1]) / lb];
            const th = Math.min(Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))), 2.97);
            const R = t / Math.tan(th / 2);
            const k = (4 / 3) * Math.tan(th / 4) * R;
            const S = [c[0] - u[0] * t, c[1] - u[1] * t]; const E = [c[0] + v[0] * t, c[1] + v[1] * t];
            if (Math.hypot(S[0] - at[0], S[1] - at[1]) > EPS) parts.push({ k: 'L', p: [at[0], at[1], S[0], S[1]] });
            parts.push({ k: 'C', p: [S[0], S[1], S[0] + u[0] * k, S[1] + u[1] * k, E[0] - v[0] * k, E[1] - v[1] * k, E[0], E[1]] });
            at = E;
        }
        const z = P[P.length - 1];
        parts.push({ k: 'L', p: [at[0], at[1], z[0], z[1]] });
        return parts;
    }

    /** The largest leg each corner may take: its share of both runs, and no more than the arc radius allows. */
    function maxLegs(P) {
        const legs = P.map(() => 0);
        const len = i => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
        for (let i = 1; i < P.length - 1; i++) {
            // The runs that touch a port keep a straight bit, so the link meets the port along its normal.
            const share = j => ((j === 0 || j === P.length - 2) ? len(j) - Math.min(opts.stub, len(j) / 2) : len(j) / 2);
            const a = P[i - 1]; const c = P[i]; const b = P[i + 1];
            const la = len(i - 1); const lb = len(i);
            if (la < EPS || lb < EPS) continue;
            const dot = ((c[0] - a[0]) * (b[0] - c[0]) + (c[1] - a[1]) * (b[1] - c[1])) / (la * lb);
            const th = Math.min(Math.acos(Math.max(-1, Math.min(1, dot))), 2.97);
            if (th < 0.01) continue;
            legs[i] = Math.min(share(i - 1), share(i), opts.radius * Math.tan(th / 2));
        }
        return legs;
    }

    /** Rounds the corners as much as they can be while staying clear: each corner that clips a card is tightened. */
    function rounded(P, pass, ends) {
        const legs = maxLegs(P);
        for (let round = 0; round < 8; round++) {
            const parts = filleted(P, legs);
            let bad = false;
            // Which corner owns each arc: arcs come in corner order.
            let ci = 0;
            for (let j = 0; j < parts.length; j++) {
                if (parts[j].k !== 'C') continue;
                while (ci < legs.length && !legs[ci]) ci++;
                if (!clear(flatten(parts, 1, j, j + 1), pass, ends)) { legs[ci] = legs[ci] < 2 ? 0 : legs[ci] * 0.55; bad = true; }
                ci++;
            }
            if (!bad) return parts;
        }
        return filleted(P, P.map(() => 0));
    }

    /**
     * Moves the first corner out along the port normal as far as it still sees the next waypoint, so the arc that
     * turns away from the port has room to be wide. `W` runs from the leader end; `p` is the port, `n` its normal.
     */
    function stretch(p, n, W, pass, ends) {
        if (W.length < 2) return W[0];
        const next = W[1];
        const room = Math.hypot(next[0] - W[0][0], next[1] - W[0][1]);
        for (const s of [opts.radius * 1.5, opts.radius, opts.radius * 0.6, opts.radius * 0.3]) {
            if (s <= opts.stub || s > opts.stub + room) continue;
            const c = [p[0] + n[0] * s, p[1] + n[1] * s];
            if (!sees(p, c, pass, ends) || !sees(c, next, pass, ends)) continue;
            // Only along the way: never past the next waypoint along the normal.
            if ((next[0] - c[0]) * n[0] + (next[1] - c[1]) * n[1] < 0) continue;
            return c;
        }
        return W[0];
    }

    /** Cuts lattice corners down to the ones that are needed: from each kept point, jump to the farthest it can see. */
    function pull(C, pass, ends) {
        const out = [C[0]];
        let i = 0;
        while (i < C.length - 1) {
            let j = C.length - 1;
            while (j > i + 1 && !sees(C[i], C[j], pass, ends)) j--;
            out.push(C[j]);
            i = j;
        }
        return out;
    }

    /**
     * A link from its first port through each `via` point to its last port. A via is a fixed point the link passes
     * through (a junction the host owns): { x, y, n? }, n = the way the link travels through it; without one, the
     * link travels from the point before it towards the point after it.
     */
    function compile(def, defs) {
        const shape = normalize(def.shape);
        if (shape) return shaped(def, defs, shape);
        const stops = [def.from || {}, ...(Array.isArray(def.via) ? def.via : []), def.to || {}];
        if (stops.length === 2) {
            const one = leg(stops[0], stops[1], def, defs);
            return finish(one.parts, one.kind, one.clear, one.runs ? [one.runs] : null, [one.parts.length]);
        }
        const pass = passable(def);
        const at = s => [num(s.x), num(s.y)];
        const pts = stops.map(at);
        const ports = stops.map((s, i) => {
            if (i === 0 || i === stops.length - 1) return s;
            const d = normal(s.n) || unit(pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]) || [1, 0];
            return { x: pts[i][0], y: pts[i][1], d };
        });
        const parts = [];
        const runs = [];
        let kind = 'curve';
        let isClear = true;
        for (let i = 0; i + 1 < ports.length; i++) {
            const a = ports[i]; const b = ports[i + 1];
            const A = a.d ? { x: a.x, y: a.y, n: a.d } : a;
            const B = b.d ? { x: b.x, y: b.y, n: [-b.d[0], -b.d[1]] } : b;
            const one = leg(A, B, def, defs, pass);
            parts.push(...one.parts);
            if (one.runs) runs.push(one.runs);
            if (one.kind === 'route') kind = 'route';
            isClear &&= one.clear;
        }
        return finish(parts, kind, isClear, runs.length ? runs : null, [parts.length]);
    }

    // ---- hand-made shapes

    /** The two anchors a shape's dots are stored against: the cards' rectangles, or the ports when a card is unknown. */
    const anchors = def => ({ from: rects.get(def.from?.card) ?? def.from ?? {}, to: rects.get(def.to?.card) ?? def.to ?? {} });

    /**
     * A link drawn from its stored shape: port → dots → port, each segment of its own type. A segment that would
     * enter a card is laid out automatically instead, unless it runs to a dot placed inside that card.
     */
    function shaped(def, defs, shape) {
        const A = def.from || {}; const B = def.to || {};
        const ends = anchors(def);
        const P = [[num(A.x), num(A.y)], ...shape.dots.map(d => { const c = toCanvas(d, ends); return [c.x, c.y]; }), [num(B.x), num(B.y)]];
        const last = P.length - 1;
        const n = normal(A.n) || axisToward(P[1][0] - P[0][0], P[1][1] - P[0][1]);
        const m = normal(B.n) || axisToward(P[last - 1][0] - P[last][0], P[last - 1][1] - P[last][1]);
        // The way the link travels through each point.
        const dir = P.map((p, i) => {
            if (i === 0) return n;
            if (i === last) return [-m[0], -m[1]];
            return unit(P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1]) || [1, 0];
        });
        const base = passable(def);
        const holding = p => [...rects.values()].filter(r => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h).map(r => r.id);
        const parts = [];
        const spans = [];
        const drawn = [];
        let isClear = true;
        for (let i = 0; i < last; i++) {
            const sg = shape.segments[i];
            const a = P[i]; const b = P[i + 1];
            const pass = new Set(base);
            if (i > 0) for (const id of holding(a)) pass.add(id);
            if (i + 1 < last) for (const id of holding(b)) pass.add(id);
            const cards = new Set([i === 0 ? A.card : undefined, i + 1 === last ? B.card : undefined].filter(c => c !== undefined));
            // Ports keep a short straight leader so heads line up; dots don't need one.
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const l = sg.type === 'straight' ? 0 : Math.min(opts.stub, len / 3);
            const la = i === 0 ? l : 0; const lb = i + 1 === last ? l : 0;
            const q = [a[0] + dir[i][0] * la, a[1] + dir[i][1] * la];
            const r = [b[0] - dir[i + 1][0] * lb, b[1] - dir[i + 1][1] * lb];
            const mid = piece(sg, q, r, dir[i], dir[i + 1]);
            const mine = [];
            if (la) mine.push({ k: 'L', p: [a[0], a[1], q[0], q[1]] });
            mine.push(...mid);
            if (lb) mine.push({ k: 'L', p: [r[0], r[1], b[0], b[1]] });
            let kind = sg.type;
            let got = mine;
            if (len >= 1 && !clear(flatten(mine, 1, la ? 1 : 0, mine.length - (lb ? 1 : 0)), pass, cards)) {
                const one = leg({ x: a[0], y: a[1], n: dir[i], card: i === 0 ? A.card : undefined },
                    { x: b[0], y: b[1], n: [-dir[i + 1][0], -dir[i + 1][1]], card: i + 1 === last ? B.card : undefined }, def, defs, pass);
                got = one.parts; kind = one.kind; isClear &&= one.clear;
            }
            parts.push(...got);
            spans.push(parts.length);
            drawn.push(kind);
        }
        const out = finish(parts, drawn[0], isClear, null, spans);
        out.drawn = drawn;
        return out;
    }

    /** One hand-made segment between q and r, leaving along ta and arriving along tb. */
    function piece(sg, q, r, ta, tb) {
        const dx = r[0] - q[0]; const dy = r[1] - q[1];
        const len = Math.hypot(dx, dy);
        if (len < EPS || sg.type === 'straight') return [{ k: 'L', p: [q[0], q[1], r[0], r[1]] }];
        const tension = sg.tension ?? 0.5;
        // Left of the way from q to r as seen on screen (y grows downwards), or right when flipped.
        const side = sg.flip ? -1 : 1;
        const px = dy / len * side; const py = -dx / len * side;
        if (sg.type === 'arc') {
            const h = (tension * len * 0.5) / 0.75; // the bow's height is three quarters of the control offset
            return [{ k: 'C', p: [q[0], q[1], q[0] + dx / 3 + px * h, q[1] + dy / 3 + py * h, q[0] + 2 * dx / 3 + px * h, q[1] + 2 * dy / 3 + py * h, r[0], r[1]] }];
        }
        if (sg.type === 'step') {
            const across = (Math.abs(dx) >= Math.abs(dy)) !== !!sg.flip;
            const W = across
                ? [q, [q[0] + dx / 2, q[1]], [q[0] + dx / 2, r[1]], r]
                : [q, [q[0], q[1] + dy / 2], [r[0], q[1] + dy / 2], r];
            const legs = W.map((w, i) => (i === 0 || i === W.length - 1 ? 0 : Math.min(10, Math.abs(across ? dx : dy) / 4, Math.abs(across ? dy : dx) / 2)));
            return filleted(W, legs);
        }
        // curve: smooth, following the way the link travels at each end; flip mirrors it across the line q→r.
        const h = tension * len * 0.8;
        let c1 = [q[0] + ta[0] * h, q[1] + ta[1] * h];
        let c2 = [r[0] - tb[0] * h, r[1] - tb[1] * h];
        if (sg.flip) {
            const mirror = c => { const t = ((c[0] - q[0]) * dx + (c[1] - q[1]) * dy) / (len * len); const fx = q[0] + dx * t; const fy = q[1] + dy * t; return [2 * fx - c[0], 2 * fy - c[1]]; };
            c1 = mirror(c1); c2 = mirror(c2);
        }
        return [{ k: 'C', p: [q[0], q[1], c1[0], c1[1], c2[0], c2[1], r[0], r[1]] }];
    }

    /** One stretch between two ports: { parts, kind, clear, runs }. */
    function leg(A, B, def, defs, pass = passable(def)) {
        const ax = num(A.x); const ay = num(A.y); const bx = num(B.x); const by = num(B.y);
        const chord = Math.hypot(bx - ax, by - ay);
        const straight = () => [{ k: 'L', p: [ax, ay, bx, by] }];
        const ra = rects.get(A.card); const rb = rects.get(B.card);
        const out = (parts, kind, isClear, runs = null) => ({ parts, kind, clear: isClear, runs });
        if (chord < 1 || (A.card !== B.card && ra && rb && overlaps(ra, rb))) return out(straight(), 'straight', true);

        const n = normal(A.n) || axisToward(bx - ax, by - ay);
        const m = normal(B.n) || axisToward(ax - bx, ay - by);
        const lead = Math.min(opts.stub, chord / 3);
        const l = lead >= 1 ? lead : 0;
        const q = [ax + n[0] * l, ay + n[1] * l];
        const r = [bx + m[0] * l, by + m[1] * l];
        const wrap = (mid) => {
            const parts = [];
            if (l) parts.push({ k: 'L', p: [ax, ay, q[0], q[1]] });
            parts.push(...mid);
            if (l) parts.push({ k: 'L', p: [r[0], r[1], bx, by] });
            return parts;
        };
        const lo = l ? 1 : 0;
        const ends = new Set([A.card, B.card].filter(c => c !== undefined));
        const ok = (parts) => clear(flatten(parts, 1, lo, parts.length - lo), pass, ends);

        // One S-curve, if one is clear. Of the clear ones, the one that runs along other links the least (rule 2:
        // links cross near a right angle, not in a long shallow overlap); the first is the default.
        let best = null;
        for (const s of opts.scales) {
            const parts = wrap(direct(A, n, B, m, q, r, s));
            if (!ok(parts)) continue;
            const score = shallow(flatten(parts, 2), def.id, [ax, ay], [bx, by]);
            if (!best || score < best.score - 1) best = { parts, score };
            if (score === 0) break;
        }
        if (best) return out(best.parts, 'curve', true);

        // Find a way round.
        const g = ensureGrid(defs);
        const opened = [];
        for (const id of pass) { const o = rects.get(id); mark(g, o, opts.clearance, -1); opened.push(o); }
        routes++;
        const C = search(g, q, n, r, [-m[0], -m[1]], { bend: opts.bend });
        for (const o of opened) mark(g, o, opts.clearance, 1);
        if (!C) return out(wrap(direct(A, n, B, m, q, r, 1)), 'curve', false);
        const W = pull(C, pass, ends);
        W[0] = stretch([ax, ay], n, W, pass, ends);
        const rev = W.slice().reverse();
        W[W.length - 1] = stretch([bx, by], m, rev, pass, ends);
        const P = lanes([[ax, ay], ...W, [bx, by]], def.id, n, m, pass, ends);
        const parts = rounded(P, pass, ends);
        return out(parts, 'route', ok(parts), P);
    }

    // ---- crossings (rule 2)

    /**
     * How much of a candidate runs along other links: the length of its pieces that lie within a lane of another
     * link's piece at a shallow angle (under 30°), or cross one at such an angle. Pieces near the link's own ports
     * don't count, since links sharing a port start out together on purpose.
     */
    function shallow(pts, self, a, b) {
        const box = boxOf(pts);
        const g = opts.laneGap;
        const keep = 3 * opts.stub;
        const near = (x, y, p) => Math.abs(x - p[0]) < keep && Math.abs(y - p[1]) < keep && Math.hypot(x - p[0], y - p[1]) < keep;
        let total = 0;
        for (const [id, e] of links) {
            if (id === self || !e.flat) continue;
            const eb = e.box;
            if (eb.x > box.x + box.w + g || eb.x + eb.w < box.x - g || eb.y > box.y + box.h + g || eb.y + eb.h < box.y - g) continue;
            const o = e.flat;
            for (let i = 0; i + 3 < pts.length; i += 2) {
                const x0 = pts[i]; const y0 = pts[i + 1]; const x1 = pts[i + 2]; const y1 = pts[i + 3];
                const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
                if (mx < eb.x - g || mx > eb.x + eb.w + g || my < eb.y - g || my > eb.y + eb.h + g) continue;
                if (near(x0, y0, a) || near(x1, y1, b) || near(x0, y0, b) || near(x1, y1, a)) continue;
                const len = Math.hypot(x1 - x0, y1 - y0);
                if (len < EPS) continue;
                const ux = (x1 - x0) / len; const uy = (y1 - y0) / len;
                for (let j = 0; j + 3 < o.length; j += 2) {
                    const ox = o[j]; const oy = o[j + 1]; const vx = o[j + 2] - ox; const vy = o[j + 3] - oy;
                    // Cheap reject first: the other piece's box, grown by a lane, must hold the midpoint.
                    if (mx < Math.min(ox, ox + vx) - g || mx > Math.max(ox, ox + vx) + g || my < Math.min(oy, oy + vy) - g || my > Math.max(oy, oy + vy) + g) continue;
                    const vl = Math.hypot(vx, vy);
                    if (vl < EPS || Math.abs(ux * vy - uy * vx) / vl > 0.5) continue; // steeper than 30°: a clean crossing
                    const t = Math.max(0, Math.min(1, ((mx - ox) * vx + (my - oy) * vy) / (vl * vl)));
                    if (Math.hypot(mx - (ox + vx * t), my - (oy + vy * t)) < g) { total += len; break; }
                }
            }
        }
        return total;
    }

    // ---- lanes (rule 3): a run that would sit on top of another link's run moves over by a lane

    const unitOf = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l < EPS ? null : [(b[0] - a[0]) / l, (b[1] - a[1]) / l, l]; };

    /** Whether run a→b lies along run c→d, closer than a lane, for longer than a corner. */
    function onTop(a, b, c, d) {
        const u = unitOf(a, b); const v = unitOf(c, d);
        if (!u || !v || Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.12) return false;
        const off = Math.abs((c[0] - a[0]) * -u[1] + (c[1] - a[1]) * u[0]);
        if (off > opts.laneGap - 0.5) return false;
        const s0 = (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1]; const s1 = (d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1];
        const lo = Math.max(0, Math.min(s0, s1)); const hi = Math.min(u[2], Math.max(s0, s1));
        return hi - lo > opts.laneGap * 2;
    }

    /** A link's runs as pieces { c, d, first, last, x0, y0, x1, y1 }, kept with the link for quick lookups. */
    function pieces(runs) {
        const out = [];
        for (const R of runs ?? []) {
            for (let i = 0; i + 1 < R.length; i++) {
                const c = R[i]; const d = R[i + 1];
                out.push({ c, d, first: i === 0, last: i + 2 === R.length, x0: Math.min(c[0], d[0]), y0: Math.min(c[1], d[1]), x1: Math.max(c[0], d[0]), y1: Math.max(c[1], d[1]) });
            }
        }
        return out;
    }

    function crowded(a, b, self, P) {
        const g = opts.laneGap;
        const x0 = Math.min(a[0], b[0]) - g; const x1 = Math.max(a[0], b[0]) + g;
        const y0 = Math.min(a[1], b[1]) - g; const y1 = Math.max(a[1], b[1]) + g;
        const s = P[0]; const z = P[P.length - 1];
        for (const [id, e] of links) {
            if (id === self || !e.pieces?.length) continue;
            if (e.box.x > x1 || e.box.x + e.box.w < x0 || e.box.y > y1 || e.box.y + e.box.h < y0) continue;
            for (const q of e.pieces) {
                if (q.x0 > x1 || q.x1 < x0 || q.y0 > y1 || q.y1 < y0) continue;
                // Links leaving the same port (or junction) travel together from it: their first runs don't count.
                if ((q.first && q.c[0] === s[0] && q.c[1] === s[1]) || (q.last && q.d[0] === z[0] && q.d[1] === z[1])) continue;
                if (onTop(a, b, q.c, q.d)) return true;
            }
        }
        return false;
    }

    /**
     * Moves each run between two corners sideways, a lane at a time, while it sits on another link. A corner next to
     * a port only moves along that port's normal, so the link still meets the port straight.
     */
    function lanes(P, self, n, m, pass, ends) {
        if (!links.size) return P;
        P = P.map(p => [p[0], p[1]]);
        for (let i = 1; i + 2 < P.length; i++) {
            if (!crowded(P[i], P[i + 1], self, P)) continue;
            const u = unitOf(P[i], P[i + 1]);
            if (!u) continue;
            const along = (nn, k) => Math.abs(nn[0] * k[1] - nn[1] * k[0]) < 1e-6;
            let done = false;
            for (let k = 1; k <= 4 && !done; k++) {
                for (const sg of [1, -1]) {
                    const o = [-u[1] * sg * k * opts.laneGap, u[0] * sg * k * opts.laneGap];
                    if (i === 1 && !along(n, o)) continue;
                    if (i + 2 === P.length - 1 && !along(m, o)) continue;
                    const a = [P[i][0] + o[0], P[i][1] + o[1]]; const b = [P[i + 1][0] + o[0], P[i + 1][1] + o[1]];
                    if (!sees(P[i - 1], a, pass, ends) || !sees(a, b, pass, ends) || !sees(b, P[i + 2], pass, ends)) continue;
                    if (crowded(a, b, self, P)) continue;
                    P[i] = a; P[i + 1] = b; done = true;
                    break;
                }
            }
        }
        return P;
    }

    function finish(parts, kind, isClear, runs = null, spans = [parts.length]) {
        return { parts, d: pathD(parts), ...tangents(parts), drawn: [kind], clear: isClear, runs, spans };
    }

    const sigOf = (def) => {
        const f = def.from || {}; const t = def.to || {};
        const own = def.owner ? [...def.owner].sort() : null;
        const shape = normalize(def.shape);
        const ends = shape ? anchors(def) : null;
        const box = r => (r ? [r.x, r.y, r.w, r.h] : null);
        return JSON.stringify([f.x, f.y, f.n, f.card, t.x, t.y, t.n, t.card, own, def.via ?? null, shape, ends && [box(ends.from), box(ends.to)]]);
    };

    /** Lays out the links. Only links whose ends changed, or that run near an obstacle that changed, are redone. */
    function layout(defs) {
        const list = (defs || []).filter(d => d && d.id !== undefined);
        const seen = new Set();
        const changed = [];
        const reach = opts.clearance + opts.grid;
        const near = (box) => box && dirty.some(o => overlaps({ x: box.x - reach, y: box.y - reach, w: box.w + 2 * reach, h: box.h + 2 * reach }, o));
        for (const def of list) {
            seen.add(def.id);
            const sig = sigOf(def);
            const prev = links.get(def.id);
            if (prev && prev.sig === sig && !near(prev.box)) continue;
            const path = compile(def, list);
            const flat = flatten(path.parts, 2);
            links.set(def.id, { sig, path, flat, box: boxOf(flat), pieces: pieces(path.runs) });
            computes++;
            changed.push(def.id);
        }
        dirty = [];
        const removed = [];
        for (const id of links.keys()) if (!seen.has(id)) { links.delete(id); removed.push(id); }
        return { changed, removed };
    }

    function path(id) {
        const e = links.get(id);
        if (!e) return null;
        const { d, startTangent, endTangent, drawn, clear: isClear } = e.path;
        return { d, startTangent, endTangent, drawn: [...drawn], clear: isClear };
    }

    function polyline(id, tol = 0.5) {
        const e = links.get(id);
        return e ? flatten(e.path.parts, tol) : null;
    }

    /** The nearest point on a link: { segment, t, dist, x, y }. segment = which stretch of its shape (0 with none). */
    function nearest(id, point) {
        const e = links.get(id);
        if (!e) return null;
        const { parts, spans } = e.path;
        let best = null;
        let from = 0;
        spans.forEach((to, segment) => {
            if (to <= from) return;
            const pts = flatten(parts, 0.25, from, to);
            from = to;
            let run = 0;
            let here = { dist: Infinity, at: 0, x: 0, y: 0 };
            for (let i = 0; i + 3 < pts.length; i += 2) {
                const x0 = pts[i]; const y0 = pts[i + 1]; const vx = pts[i + 2] - x0; const vy = pts[i + 3] - y0;
                const len = Math.hypot(vx, vy);
                const s1 = len < EPS ? 0 : Math.max(0, Math.min(1, ((point.x - x0) * vx + (point.y - y0) * vy) / (len * len)));
                const x = x0 + vx * s1; const y = y0 + vy * s1;
                const dist = Math.hypot(point.x - x, point.y - y);
                if (dist < here.dist) here = { dist, at: run + len * s1, x, y };
                run += len;
            }
            if (!best || here.dist < best.dist) best = { segment, t: run < EPS ? 0 : here.at / run, dist: here.dist, x: here.x, y: here.y };
        });
        return best;
    }

    const stats = () => ({ links: links.size, computes, routes });

    return { setObstacles, layout, path, polyline, nearest, stats };
}
