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


export function createLinkEngine(options = {}) {
    // scales: handle lengths tried for the one-curve link, in order of preference.
    const opts = { grid: 12, clearance: 14, margin: 2, stub: 12, tension: 0.5, bend: 4, radius: 40, laneGap: 8, scales: [1, 0.6, 1.5, 0.35], ...options };
    let rects = new Map();
    let dirty = []; // obstacles added, removed or moved since the last layout (old and new rects)
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
        for (const [id, r] of rects) {
            if (pass.has(id)) continue;
            const m = ends.has(id) ? 0 : opts.margin;
            if (!overlaps({ x: box.x - m - 1, y: box.y - m - 1, w: box.w + 2 * m + 2, h: box.h + 2 * m + 2 }, r)) continue;
            for (let i = 0; i + 3 < pts.length; i += 2) if (segHitsRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, m)) return false;
        }
        return true;
    }

    /** Line of sight for string pulling: against obstacles grown by the full clearance. */
    function sees(a, b, pass, ends) {
        for (const [id, r] of rects) {
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
        const stops = [def.from || {}, ...(Array.isArray(def.via) ? def.via : []), def.to || {}];
        if (stops.length === 2) { const one = leg(stops[0], stops[1], def, defs); return finish(one.parts, one.kind, one.clear, one.runs ? [one.runs] : null); }
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
        return finish(parts, kind, isClear, runs.length ? runs : null);
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
        const near = (x, y, p) => Math.hypot(x - p[0], y - p[1]) < 3 * opts.stub;
        let total = 0;
        for (const [id, e] of links) {
            if (id === self || !e.flat || !overlaps({ x: box.x - g, y: box.y - g, w: box.w + 2 * g, h: box.h + 2 * g }, e.box)) continue;
            const o = e.flat;
            for (let i = 0; i + 3 < pts.length; i += 2) {
                const x0 = pts[i]; const y0 = pts[i + 1]; const x1 = pts[i + 2]; const y1 = pts[i + 3];
                if (near(x0, y0, a) || near(x1, y1, b) || near(x0, y0, b) || near(x1, y1, a)) continue;
                const u = unit(x1 - x0, y1 - y0);
                if (!u) continue;
                const len = Math.hypot(x1 - x0, y1 - y0);
                const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
                for (let j = 0; j + 3 < o.length; j += 2) {
                    const v = unit(o[j + 2] - o[j], o[j + 3] - o[j + 1]);
                    if (!v || Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.5) continue; // steeper than 30°: a clean crossing
                    // Distance from this piece's midpoint to the other piece.
                    const vx = o[j + 2] - o[j]; const vy = o[j + 3] - o[j + 1];
                    const t = Math.max(0, Math.min(1, ((mx - o[j]) * vx + (my - o[j + 1]) * vy) / (vx * vx + vy * vy)));
                    if (Math.hypot(mx - (o[j] + vx * t), my - (o[j + 1] + vy * t)) < g) { total += len; break; }
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

    function crowded(a, b, self, P) {
        for (const [id, e] of links) {
            if (id === self || !e.path.runs) continue;
            for (const R of e.path.runs) {
                // Links leaving the same port (or junction) travel together from it: their first runs don't count.
                for (let i = 0; i + 1 < R.length; i++) {
                    const c = R[i]; const d = R[i + 1];
                    if ((i === 0 && c[0] === P[0][0] && c[1] === P[0][1]) || (i + 2 === R.length && d[0] === P.at(-1)[0] && d[1] === P.at(-1)[1])) continue;
                    if (onTop(a, b, c, d)) return true;
                }
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

    function finish(parts, kind, isClear, runs = null) {
        return { parts, d: pathD(parts), ...tangents(parts), drawn: [kind], clear: isClear, runs };
    }

    const sigOf = (def) => {
        const f = def.from || {}; const t = def.to || {};
        const own = def.owner ? [...def.owner].sort() : null;
        return JSON.stringify([f.x, f.y, f.n, f.card, t.x, t.y, t.n, t.card, own, def.via ?? null]);
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
            links.set(def.id, { sig, path, flat, box: boxOf(flat) });
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
        return { d, startTangent, endTangent, drawn, clear: isClear };
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
            const x0 = pts[i]; const y0 = pts[i + 1]; const x1 = pts[i + 2]; const y1 = pts[i + 3];
            const vx = x1 - x0; const vy = y1 - y0;
            const len = Math.hypot(vx, vy);
            const s = len < EPS ? 0 : Math.max(0, Math.min(1, ((point.x - x0) * vx + (point.y - y0) * vy) / (len * len)));
            const dist = Math.hypot(point.x - (x0 + vx * s), point.y - (y0 + vy * s));
            if (dist < best.dist) best = { dist, at: run + len * s };
            run += len;
        }
        return { segment: 0, t: run < EPS ? 0 : best.at / run, dist: best.dist };
    }

    const stats = () => ({ links: links.size, computes, routes });

    return { setObstacles, layout, path, polyline, nearest, stats };
}
