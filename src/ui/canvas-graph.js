// The Hero canvas as data (VISUAL 7, BUILD_SPEC 8.3): a book's entries as cards, their pieces as ports and links,
// packs as frames; the layered layout, placement of new cards, port sides, and the grid link router (D12). Lifted
// from the demo (demo/wihero-demo.html, in the git history) with its numbers kept. Pure: no DOM, so it is tested with node --test.
import { rawConfig } from '../engine/model.js';
import { isObject } from '../engine/util.js';
import { cardKey, configOf, strategyOf, titleOf } from './data.js';

export const G = 12;
export const CW = 168;
export const CH = 60;
export const snap = v => Math.round(v / G) * G;

/** Port kinds: direction, family and the piece the inspector opens on. */
export const PORT = {
    gin: { dir: 'in', family: 'open', piece: 'gate' }, gout: { dir: 'out', family: 'open', piece: 'gatesFor' },
    cin: { dir: 'in', family: 'close', piece: 'closeGate' }, cout: { dir: 'out', family: 'close', piece: 'closesFor' },
    glin: { dir: 'in', family: 'glue', piece: 'glue' }, glout: { dir: 'out', family: 'glue', piece: 'glue' },
    mgin: { dir: 'in', family: 'open', piece: 'masks', ring: true }, mcin: { dir: 'in', family: 'close', piece: 'masks', ring: true },
};
export const NORM = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
/** How port sides are saved in the settings (BUILD_SPEC 8.2): readable names. */
export const SIDE_NAME = { t: 'top', b: 'bottom', l: 'left', r: 'right' };
export const SIDE_OF = { top: 't', bottom: 'b', left: 'l', right: 'r' };

const isPackRef = r => typeof r === 'string' && r.startsWith('#');
const isLock = r => isObject(r) && Array.isArray(r.lock);
export function parseRef(r) {
    if (isLock(r)) return { lock: r.lock };
    if (!isPackRef(r)) return { id: r };
    const [n, m] = r.slice(1).split(':');
    return { pack: n, mode: m || 'any' };
}

/**
 * A book as the canvas sees it. Cards are keyed as in the settings: `id:<wihero id>`, or `uid:<n>`. Refs in the
 * story logic name ids, so they become `id:` keys; waits and greetings are not drawn here.
 * @returns {{ E: object[], byId: (key) => object, packMembers: (name) => object[] }}
 */
export function canvasBook(data, { folderOf = () => '', problems = new Set(), greetings = [] } = {}) {
    const greetKey = r => `greet:${r.char}:${r.greeting}`;
    const shown = new Set(greetings.map(g => g.key));
    const greet = r => (isObject(r) && 'greeting' in r && shown.has(greetKey(r)) ? greetKey(r) : null);
    const ref = r => (typeof r === 'string' ? (r.startsWith('#') ? r : `id:${r}`) : isLock(r) ? { lock: r.lock } : greet(r));
    const rows = rs => (Array.isArray(rs) ? rs.filter(Array.isArray).map(row => row.map(ref).filter(Boolean)).filter(row => row.length) : []);
    const list = (xs) => (Array.isArray(xs) ? xs.filter(x => typeof x === 'string').map(ref) : []);
    const E = Object.values(data?.entries ?? {}).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid).map(entry => {
        const c = rawConfig(entry) ? (configOf(entry) ?? {}) : {};
        const s = strategyOf(entry);
        // Greeting rules stored on this entry (BUILD_SPEC 15.3); `via` aims them at a pack.
        const self = cardKey(entry);
        const aim = r => (typeof r.via === 'string' && r.via.startsWith('#') ? `pack:${r.via.slice(1)}` : self);
        const fromGreetings = [];
        for (const r of Array.isArray(c.gatedBy) ? c.gatedBy : []) if (greet(r)) fromGreetings.push({ from: greet(r), to: aim(r), kind: 'open' });
        const closeRows = Array.isArray(c.closeGate) ? c.closeGate.filter(row => {
            if (!(Array.isArray(row) && row.length === 1 && isObject(row[0]) && 'greeting' in row[0] && typeof row[0].via === 'string')) return true;
            if (greet(row[0])) fromGreetings.push({ from: greet(row[0]), to: aim(row[0]), kind: 'close' });
            return false;
        }) : c.closeGate;
        return {
            id: cardKey(entry), uid: entry.uid, entry, title: titleOf(entry), keys: entry.key ?? [],
            strategy: s === 'off' ? (entry.constant ? 'perm' : entry.vectorized ? 'vec' : 'keys') : s, off: !!entry.disable,
            folder: folderOf(entry), problem: problems.has(entry.uid),
            gate: rows(c.gate), gatesFor: list(c.gatesFor), closeGate: rows(closeRows), closesFor: list(c.closesFor), fromGreetings,
            glue: c.glue?.mode === 'ride' && typeof c.glue.host === 'string' ? { mode: 'ride', host: `id:${c.glue.host}` } : c.glue?.mode === 'hold' ? { mode: 'hold' } : null,
            switch: list(c.switch),
            masks: Array.isArray(c.masks) ? c.masks.filter(isObject).map(m => ({ name: m.name, content: m.content, gate: rows(m.gate), closeGate: rows(m.closeGate) })) : [],
            packs: Array.isArray(c.packs) ? c.packs.filter(p => typeof p === 'string') : [],
            once: c.once === true, by: c.by ?? null,
        };
    });
    // The open chat's character's greetings: start cards with out ports only (VISUAL 7.5).
    for (const g of greetings) {
        E.push({
            id: g.key, uid: null, entry: null, greeting: g, title: g.title, text: g.text, keys: [], strategy: 'keys', off: false,
            folder: '', problem: !!g.changed, gate: [], gatesFor: [], closeGate: [], closesFor: [], fromGreetings: [], glue: null,
            switch: [], masks: [], packs: [], once: false, by: null,
        });
    }
    const byKey = new Map(E.map(e => [e.id, e]));
    const byId = key => byKey.get(key);
    const packMembers = name => E.filter(e => e.packs.some(p => p === name || p.startsWith(`${name}/`)));
    return { E, byId, packMembers };
}

/** All links of a book as edges between node keys (card keys or `pack:<name>`), and the rows that meet at junctions. */
export function buildGraph(m) {
    const edges = [];
    const rows = {};
    const nodeOf = r => { const p = parseRef(r); return p.pack ? `pack:${p.pack}` : p.id; };
    const addRow = (key, port, items) => { (rows[`${key}:${port}`] ||= []).push(items); };
    const ref = (r, to, port, fromPort, kind, extra = {}) => {
        const p = parseRef(r);
        if (p.lock) return { lock: p.lock, to, port, kind, ...extra };
        const from = nodeOf(r);
        if (!from || (!p.pack && !m.byId(from)) || (p.pack && !m.packMembers(p.pack).length)) return null;
        const e = { from, fromPort, to, port, kind, mode: p.pack ? p.mode : null, ...extra };
        edges.push(e);
        return e;
    };
    for (const e of m.E) {
        e.gate.forEach(row => { const it = row.map(r => ref(r, e.id, 'gin', 'gout', 'open')).filter(Boolean); if (it.length) addRow(e.id, 'gin', it); });
        e.gatesFor.forEach(r => { const to = nodeOf(r); if (to && (m.byId(to) || (to.startsWith('pack:') && m.packMembers(to.slice(5)).length))) ref(e.id, to, 'gin', 'gout', 'open', { direct: true }); });
        e.closeGate.forEach(row => { const it = row.map(r => ref(r, e.id, 'cin', 'cout', 'close')).filter(Boolean); if (it.length) addRow(e.id, 'cin', it); });
        e.closesFor.forEach(r => {
            const to = nodeOf(r);
            if (!to || !(m.byId(to) || (to.startsWith('pack:') && m.packMembers(to.slice(5)).length))) return;
            const x = ref(e.id, to, 'cin', 'cout', 'close');
            if (x) addRow(to, 'cin', [x]);
        });
        if (e.glue?.mode === 'ride' && m.byId(e.glue.host)) ref(e.glue.host, e.id, 'glin', 'glout', 'ride', { direct: true });
        for (const x of e.fromGreetings ?? []) {
            const [port, fromPort] = x.kind === 'open' ? ['gin', 'gout'] : ['cin', 'cout'];
            if (x.to.startsWith('pack:') && !m.packMembers(x.to.slice(5)).length) continue;
            if (edges.some(y => y.from === x.from && y.to === x.to && y.port === port)) continue;
            const made = { from: x.from, fromPort, to: x.to, port, kind: x.kind, mode: null, direct: true };
            edges.push(made);
            if (x.kind === 'close') addRow(x.to, 'cin', [made]);
        }
        e.masks.forEach((mk, i) => {
            mk.gate.forEach(row => { const it = row.map(r => ref(r, e.id, 'mgin', 'gout', 'open', { mask: i })).filter(Boolean); if (it.length) addRow(e.id, 'mgin', it); });
            mk.closeGate.forEach(row => { const it = row.map(r => ref(r, e.id, 'mcin', 'cout', 'close', { mask: i })).filter(Boolean); if (it.length) addRow(e.id, 'mcin', it); });
        });
    }
    const switches = new Set(m.E.filter(e => e.switch.length).map(e => e.id));
    const packs = [...new Set(edges.flatMap(x => [x.from, x.to]).filter(k => k && k.startsWith('pack:')))].map(k => k.slice(5));
    return { edges: edges.filter(x => x.to), rows, switches, packs };
}

/** The cards on the canvas: everything linked, pack members, and entries placed by hand. */
export function canvasSet(m, g, placed) {
    const s = new Set(placed);
    for (const x of g.edges) for (const k of [x.from, x.to]) if (!k.startsWith('pack:')) s.add(k);
    for (const p of g.packs) m.packMembers(p).forEach(e => s.add(e.id));
    return new Set([...s].filter(id => m.byId(id)));
}

/**
 * Layered layout, top to bottom (VISUAL 7.6): longest path ranks, barycentre order, packs kept together.
 * @returns {Record<string, {x: number, y: number}>} positions by card key
 */
export function layout(m, g, ids) {
    const pos = {};
    const unitOf = {};
    const units = [];
    for (const p of g.packs) {
        const mem = m.packMembers(p).filter(e => ids.has(e.id) && !unitOf[e.id]);
        if (!mem.length) continue;
        const u = { keys: mem.map(e => e.id), pack: p };
        units.push(u);
        mem.forEach(e => { unitOf[e.id] = u; });
        unitOf[`pack:${p}`] = u;
    }
    for (const id of ids) if (!unitOf[id]) { const u = { keys: [id] }; units.push(u); unitOf[id] = u; }
    const preds = new Map(units.map(u => [u, new Set()]));
    for (const x of g.edges) {
        if (x.kind === 'close' || x.mask != null) continue;
        const a = unitOf[x.from];
        const b = unitOf[x.to];
        if (a && b && a !== b) preds.get(b).add(a);
    }
    const depth = new Map(units.map(u => [u, 0]));
    for (let it = 0; it < units.length; it++) {
        let ch = false;
        for (const u of units) for (const p of preds.get(u)) if (depth.get(p) + 1 > depth.get(u) && depth.get(p) + 1 < units.length) { depth.set(u, depth.get(p) + 1); ch = true; }
        if (!ch) break;
    }
    const linked = new Set();
    for (const [u, ps] of preds) if (ps.size) { linked.add(u); ps.forEach(p => linked.add(p)); }
    for (const x of g.edges) { const a = unitOf[x.from]; const b = unitOf[x.to]; if (a) linked.add(a); if (b) linked.add(b); }
    const maxD = Math.max(0, ...units.filter(u => linked.has(u)).map(u => depth.get(u)));
    units.forEach(u => { if (!linked.has(u)) depth.set(u, maxD + 1); });
    const layers = [];
    units.forEach(u => (layers[depth.get(u)] ||= []).push(u));
    const cols = u => (u.pack ? Math.min(2, u.keys.length) : 1);
    const wOf = u => (u.pack ? cols(u) * CW + (cols(u) - 1) * 24 + 48 : CW + (m.byId(u.keys[0]).masks.length ? 36 : 0));
    const hOf = u => (u.pack ? Math.ceil(u.keys.length / 2) * (CH + 24) - 24 + 60 : CH);
    const cx = new Map();
    const layerY = [];
    let y = 0;
    layers.forEach((L, d) => {
        if (!L) return;
        if (d > 0) L.forEach(u => { const ps = [...preds.get(u)].filter(p => cx.has(p)); u.bc = ps.length ? ps.reduce((s, p) => s + cx.get(p), 0) / ps.length : 0; });
        if (d > 0) L.sort((a, b) => a.bc - b.bc);
        const total = L.reduce((s, u) => s + wOf(u), 0) + (L.length - 1) * 60;
        let x = -total / 2;
        L.forEach(u => { const w = wOf(u); cx.set(u, x + w / 2); x += w + 60; });
        layerY[d] = y;
        y += Math.max(...L.map(hOf)) + 132;
    });
    units.forEach(u => {
        const y0 = layerY[depth.get(u)] + (u.pack ? 36 : 0);
        const x0 = cx.get(u) - wOf(u) / 2 + (u.pack ? 24 : 0);
        u.keys.forEach((k, i) => {
            const c = u.pack ? i % 2 : 0;
            const r = u.pack ? Math.floor(i / 2) : 0;
            pos[k] = { x: snap(x0 + c * (CW + 24)), y: snap(y0 + r * (CH + 24)) };
        });
    });
    return pos;
}

/**
 * Places cards that have no position yet (BUILD_SPEC 8.3): the nearest free spot beside the card it is linked
 * with (right, then below, then above, then left), or the middle of the view. Changes `pos`.
 */
export function placeNew(m, g, ids, pos, center) {
    // Pack frames (members' box plus its margins) are taken space too, for cards that aren't members.
    const frames = g.packs.map(name => {
        const keys = new Set(m.packMembers(name).map(e => e.id));
        const ps = [...keys].map(k => pos[k]).filter(Boolean);
        if (!ps.length) return null;
        return { keys, x0: Math.min(...ps.map(q => q.x)) - 24, y0: Math.min(...ps.map(q => q.y)) - 36, x1: Math.max(...ps.map(q => q.x)) + CW + 24, y1: Math.max(...ps.map(q => q.y)) + CH + 24 };
    }).filter(Boolean);
    const inFrame = (id, p) => frames.some(f => !f.keys.has(id) && p.x < f.x1 + 24 && p.x + CW > f.x0 - 24 && p.y < f.y1 + 24 && p.y + CH > f.y0 - 24);
    let current = null;
    const free = p => !inFrame(current, p) && ![...ids].some(k => pos[k] && Math.abs(pos[k].x - p.x) < CW + 24 && Math.abs(pos[k].y - p.y) < CH + 24);
    const added = [];
    for (const id of ids) {
        if (pos[id]) continue;
        current = id;
        const partner = g.edges.find(x => (x.from === id && pos[x.to]) || (x.to === id && pos[x.from]));
        const base = partner ? pos[partner.from === id ? partner.to : partner.from] : null;
        let spot = null;
        if (base) {
            const steps = [[1, 0], [0, 1], [0, -1], [-1, 0]];
            for (let ring = 1; ring <= 12 && !spot; ring++) {
                for (const [dx, dy] of steps) {
                    const p = { x: snap(base.x + dx * ring * (CW + 48)), y: snap(base.y + dy * ring * (CH + 72)) };
                    if (free(p)) { spot = p; break; }
                }
            }
        }
        if (!spot) {
            let p = { x: snap(center.x), y: snap(center.y) };
            for (let i = 0; i < 30 && !free(p); i++) p = { x: snap(p.x + CW + 48), y: p.y };
            spot = p;
        }
        pos[id] = spot;
        added.push(id);
    }
    return added;
}

/** Card and pack frame rectangles. */
export function nodeRects(m, g, ids, pos) {
    const R = new Map();
    for (const id of ids) { const p = pos[id]; R.set(id, { key: id, x: p.x, y: p.y, w: CW, h: CH, e: m.byId(id) }); }
    for (const p of g.packs) {
        const mem = m.packMembers(p).filter(e => R.has(e.id)).map(e => R.get(e.id));
        if (!mem.length) continue;
        const x0 = Math.min(...mem.map(r => r.x)) - 24;
        const y0 = Math.min(...mem.map(r => r.y)) - 36;
        const x1 = Math.max(...mem.map(r => r.x + r.w)) + 24;
        const y1 = Math.max(...mem.map(r => r.y + r.h)) + 24;
        R.set(`pack:${p}`, { key: `pack:${p}`, pack: p, x: x0, y: y0, w: x1 - x0, h: y1 - y0, members: mem.map(r => r.key) });
    }
    return R;
}

/**
 * Which ports sit on each node, on which side and where (VISUAL 7.2): by default the side facing the linked
 * cards, long edges three ports, short edges one; a card with masks keeps its bottom and right for the layers.
 * @param {Record<string, string>} manual sides moved by hand, by `key:kind`
 */
export function computePorts(g, R, manual = {}) {
    const P = new Map();
    const add = (key, kind, partner) => {
        if (!R.has(key)) return;
        const n = P.get(key) ?? new Map();
        P.set(key, n);
        const p = n.get(kind) ?? { kind, partners: [] };
        n.set(kind, p);
        if (partner && R.has(partner)) p.partners.push(partner);
    };
    for (const x of g.edges) { add(x.from, x.fromPort, x.to); add(x.to, x.port, x.from); }
    const ctr = r => [r.x + r.w / 2, r.y + r.h / 2];
    for (const [key, ports] of P) {
        const r = R.get(key);
        const [cx, cy] = ctr(r);
        const hasMask = r.e?.masks.length;
        const load = { t: 0, b: 0, l: 0, r: 0 };
        const cap = { t: 3, b: hasMask ? 2 : 3, l: 1, r: hasMask ? 0 : 1 };
        const list = [...ports.values()];
        for (const p of list) {
            const man = manual[`${key}:${p.kind}`];
            let dx = 0;
            let dy = 0;
            p.partners.forEach(k => { const [px, py] = ctr(R.get(k)); dx += px - cx; dy += py - cy; });
            if (!p.partners.length) dy = PORT[p.kind].dir === 'in' ? -1 : 1;
            const prefs = Math.abs(dy) * 1.6 >= Math.abs(dx)
                ? [dy < 0 ? 't' : 'b', dx < 0 ? 'l' : 'r', dy < 0 ? 'b' : 't', dx < 0 ? 'r' : 'l']
                : [dx < 0 ? 'l' : 'r', dy < 0 ? 't' : 'b', dy < 0 ? 'b' : 't', dx < 0 ? 'r' : 'l'];
            p.pref = man ? [man, ...prefs] : prefs;
            p.ax = dx;
            p.ay = dy;
        }
        list.sort((a, b) => (!!manual[`${key}:${b.kind}`]) - (!!manual[`${key}:${a.kind}`]));
        for (const p of list) { p.side = p.pref.find(s => load[s] < cap[s]) ?? p.pref[0]; load[p.side]++; }
        for (const s of ['t', 'b', 'l', 'r']) {
            const on = list.filter(p => p.side === s);
            const along = p => (s === 't' || s === 'b' ? p.ax : p.ay);
            on.sort((a, b) => along(a) - along(b) || a.kind.localeCompare(b.kind));
            on.forEach((p, i) => {
                const f = (i + 1) / (on.length + 1);
                p.n = NORM[s];
                if (s === 't' || s === 'b') { p.x = snap(r.x + r.w * f); p.y = s === 't' ? r.y : r.y + r.h; } else { p.x = s === 'l' ? r.x : r.x + r.w; p.y = snap(r.y + r.h / 2); }
            });
        }
    }
    return P;
}

// ---- routing: A* on a 12px lattice; cards are walls, links may cross links (D12, the demo's router as it is)

export function makeGrid(R, extra) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of [...R.values(), ...extra]) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; } // nothing on the canvas
    x0 = snap(x0 - 240); y0 = snap(y0 - 240); x1 = snap(x1 + 240); y1 = snap(y1 + 240);
    const W = (x1 - x0) / G + 1;
    const H = (y1 - y0) / G + 1;
    const wall = new Uint8Array(W * H);
    const frame = new Int16Array(W * H).fill(-1);
    const used = new Uint8Array(W * H);
    const mark = (r, pad, fn) => {
        const a = Math.ceil((r.x - pad - x0) / G); const b = Math.floor((r.x + r.w + pad - x0) / G);
        const c = Math.ceil((r.y - pad - y0) / G); const d = Math.floor((r.y + r.h + pad - y0) / G);
        for (let j = Math.max(0, c); j <= Math.min(H - 1, d); j++) for (let i = Math.max(0, a); i <= Math.min(W - 1, b); i++) fn(j * W + i);
    };
    const frames = [];
    for (const r of R.values()) {
        if (r.pack) { const fi = frames.push(r.key) - 1; mark(r, 2, k => { if (frame[k] < 0) frame[k] = fi; }); } else mark(r, 6, k => { wall[k] = 1; });
    }
    for (const r of extra) mark(r, 4, k => { wall[k] = 1; });
    return { x0, y0, W, H, wall, frame, frames, used };
}

/** A binary min-heap of (state, priority), on flat arrays: a phone's garbage collector was a large share of routing. */
function heap() {
    let xs = [];
    let ps = [];
    let n = 0;
    return {
        push(x, p) {
            let i = n++;
            while (i > 0) { const q = (i - 1) >> 1; if (ps[q] <= p) break; xs[i] = xs[q]; ps[i] = ps[q]; i = q; }
            xs[i] = x; ps[i] = p;
        },
        pop() {
            const top = xs[0];
            const x = xs[--n]; const p = ps[n];
            let i = 0;
            for (;;) {
                const l = 2 * i + 1; if (l >= n) break;
                const r = l + 1; const m = r < n && ps[r] < ps[l] ? r : l;
                if (ps[m] >= p) break;
                xs[i] = xs[m]; ps[i] = ps[m]; i = m;
            }
            if (n) { xs[i] = x; ps[i] = p; }
            return top;
        },
        get size() { return n; },
        clear() { n = 0; },
    };
}

/** Search buffers kept on the grid between routes; `stamp` says which entries belong to the current search. */
function buffers(grid) {
    if (!grid.search) {
        const size = grid.W * grid.H * 4;
        grid.search = { cost: new Float32Array(size), prev: new Int32Array(size), stamp: new Uint32Array(size), gen: 0, h: heap() };
    }
    const b = grid.search;
    if (++b.gen === 0xffffffff) { b.stamp.fill(0); b.gen = 1; }
    b.h.clear();
    return b;
}

/** A path of points from (sx, sy) to (ex, ey) that never passes through a card, or null. */
export function route(grid, sx, sy, ex, ey, allow) {
    const { x0, y0, W, H, wall, frame, frames, used } = grid;
    const toI = (x, y) => [Math.round((x - x0) / G), Math.round((y - y0) / G)];
    const [si, sj] = toI(sx, sy);
    const [ei, ej] = toI(ex, ey);
    if (si < 0 || sj < 0 || si >= W || sj >= H || ei < 0 || ej < 0 || ei >= W || ej >= H) return null;
    const blocked = k => wall[k] || (frame[k] >= 0 && !allow.has(frames[frame[k]]));
    const S0 = sj * W + si; const E0 = ej * W + ei;
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const { cost, prev, stamp, gen, h } = buffers(grid);
    for (let d = 0; d < 4; d++) { const s = S0 * 4 + d; stamp[s] = gen; cost[s] = 0; prev[s] = -1; h.push(s, 0); }
    let found = -1;
    let n = 0;
    while (h.size && n++ < 60000) {
        const s = h.pop(); const c = s >> 2; const d = s & 3; const cc = cost[s];
        if (c === E0) { found = s; break; }
        const ci = c % W; const cj = (c / W) | 0;
        for (let nd = 0; nd < 4; nd++) {
            const ni = ci + N4[nd][0]; const nj = cj + N4[nd][1];
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const k = nj * W + ni;
            if (k !== E0 && blocked(k)) continue;
            const nc = cc + 1 + (nd !== d ? 2.5 : 0) + (used[k] ? 0.6 : 0); const ns = k * 4 + nd;
            if (stamp[ns] !== gen || nc < cost[ns]) { stamp[ns] = gen; cost[ns] = nc; prev[ns] = s; h.push(ns, nc + Math.abs(ni - ei) + Math.abs(nj - ej)); }
        }
    }
    if (found < 0) return null;
    const pts = [];
    for (let s = found; s >= 0; s = prev[s]) { const c = s >> 2; used[c] = 1; pts.push([x0 + (c % W) * G, y0 + ((c / W) | 0) * G]); }
    pts.reverse();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const [a, b, c] = [out[out.length - 1], pts[i], pts[i + 1]];
        if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) continue;
        out.push(b);
    }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    return out;
}

/** A polyline with rounded corners, as an SVG path. */
export function rounded(pts, r = 12) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
        const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]); const l2 = Math.hypot(n[0] - q[0], n[1] - q[1]);
        const rr = Math.min(r, l1 / 2, l2 / 2);
        if (!rr) { d += ` L${q[0]},${q[1]}`; continue; }
        const a = [q[0] - (q[0] - p[0]) / l1 * rr, q[1] - (q[1] - p[1]) / l1 * rr];
        const b = [q[0] + (n[0] - q[0]) / l2 * rr, q[1] + (n[1] - q[1]) / l2 * rr];
        d += ` L${a[0]},${a[1]} Q${q[0]},${q[1]} ${b[0]},${b[1]}`;
    }
    const l = pts[pts.length - 1];
    return `${d} L${l[0]},${l[1]}`;
}

/** Whether a segment list passes through a rectangle's inside (for the tests: links never cross cards). */
export function crosses(pts, r, pad = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const xa = Math.min(a[0], b[0]); const xb = Math.max(a[0], b[0]);
        const ya = Math.min(a[1], b[1]); const yb = Math.max(a[1], b[1]);
        if (xb > r.x + pad && xa < r.x + r.w - pad && yb > r.y + pad && ya < r.y + r.h - pad) return true;
    }
    return false;
}
