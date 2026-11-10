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
/** The widest a row of the layout gets: two cards side by side, about a phone's width at full zoom. */
export const ROW_W = 2 * CW + 60;

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
const isWait = r => isObject(r) && Number.isInteger(r.wait);
export function parseRef(r) {
    if (isLock(r)) return { lock: r.lock, by: r.by };
    if (isWait(r)) return { wait: r.wait, by: r.by };
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
    const ref = r => (typeof r === 'string' ? (r.startsWith('#') ? r : `id:${r}`) : isLock(r) ? { lock: r.lock, by: r.by } : isWait(r) ? { wait: r.wait, by: r.by } : greet(r));
    // Each row keeps its index in the stored gate (`ri`), so a tap on the canvas finds it again.
    const rows = rs => (Array.isArray(rs) ? rs.map((row, ri) => (Array.isArray(row) ? Object.assign(row.map(ref).filter(Boolean), { ri }) : [])).filter(row => row.length) : []);
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
        // Delayed closing (CONCEPTS 3.3): rows naming the entry itself are not links; the card shows a badge.
        const selfRow = row => Array.isArray(row) && row.includes(c.id);
        const after = Array.isArray(closeRows) ? closeRows.filter(selfRow) : [];
        const closesAfter = after.length ? Math.min(...after.map(row => row.find(isWait)?.wait ?? 0)) : null;
        return {
            id: cardKey(entry), uid: entry.uid, entry, title: titleOf(entry), keys: entry.key ?? [],
            strategy: s === 'off' ? (entry.constant ? 'perm' : entry.vectorized ? 'vec' : 'keys') : s, off: !!entry.disable,
            folder: folderOf(entry), problem: problems.has(entry.uid),
            gate: rows(c.gate), gatesFor: list(c.gatesFor), closeGate: rows(Array.isArray(closeRows) ? closeRows.filter(row => !selfRow(row)) : closeRows), closesAfter, closesFor: list(c.closesFor), fromGreetings,
            glue: c.glue?.mode === 'ride' && typeof c.glue.host === 'string' ? { mode: 'ride', host: `id:${c.glue.host}` } : c.glue?.mode === 'hold' ? { mode: 'hold' } : null,
            switch: list(c.switch),
            masks: Array.isArray(c.masks) ? c.masks.filter(isObject).map(m => ({ name: m.name, content: m.content, gate: rows(m.gate), closeGate: rows(m.closeGate) })) : [],
            packs: Array.isArray(c.packs) ? c.packs.filter(p => typeof p === 'string') : [],
            note: typeof c.note === 'string' ? c.note.trim() : '',
            once: c.once === true, by: c.by ?? null,
            ...(c.moment === true ? momentNode(entry, c) : {}),
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

/**
 * A Moment's card (CONCEPTS 3.13): its name without "Moment: ", its phrases, who says them. It sends nothing, so it
 * has no strategy, is never drawn off, and takes no glue, masks, switch, Once or close gate.
 */
function momentNode(entry, c) {
    return {
        moment: { phrases: (entry.key ?? []).filter(k => typeof k === 'string' && k.trim()), by: c.by ?? null },
        title: momentName(entry), off: false, glue: null, masks: [], switch: [], once: false, closeGate: [], by: null,
    };
}

/** A Moment's name: its title without the "Moment: " ST shows. */
export const momentName = entry => String(entry?.comment ?? '').replace(/^Moment:\s*/i, '') || (entry?.key ?? [])[0] || 'Moment';

/** All links of a book as edges between node keys (card keys or `pack:<name>`), and the rows that meet at junctions. */
export function buildGraph(m) {
    const edges = [];
    const rows = {};
    const nodeOf = r => { const p = parseRef(r); return p.pack ? `pack:${p.pack}` : p.id; };
    const addRow = (key, port, items, ri) => { (rows[`${key}:${port}`] ||= []).push(Object.assign(items, { ri })); };
    const ref = (r, to, port, fromPort, kind, extra = {}) => {
        const p = parseRef(r);
        if (p.lock || p.wait !== undefined) return { cond: true, lock: p.lock, wait: p.wait, by: p.by, to, port, kind, ...extra };
        const from = nodeOf(r);
        if (!from || (!p.pack && !m.byId(from)) || (p.pack && !m.packMembers(p.pack).length)) return null;
        const e = { from, fromPort, to, port, kind, mode: p.pack ? p.mode : null, ...extra };
        edges.push(e);
        return e;
    };
    for (const e of m.E) {
        e.gate.forEach(row => { const it = row.map(r => ref(r, e.id, 'gin', 'gout', 'open')).filter(Boolean); if (it.length) addRow(e.id, 'gin', it, row.ri); });
        e.gatesFor.forEach(r => { const to = nodeOf(r); if (to && (m.byId(to) || (to.startsWith('pack:') && m.packMembers(to.slice(5)).length))) ref(e.id, to, 'gin', 'gout', 'open', { direct: true }); });
        e.closeGate.forEach(row => { const it = row.map(r => ref(r, e.id, 'cin', 'cout', 'close')).filter(Boolean); if (it.length) addRow(e.id, 'cin', it, row.ri); });
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
            mk.gate.forEach(row => { const it = row.map(r => ref(r, e.id, 'mgin', 'gout', 'open', { mask: i })).filter(Boolean); if (it.length) addRow(e.id, 'mgin', Object.assign(it, { mask: i }), row.ri); });
            mk.closeGate.forEach(row => { const it = row.map(r => ref(r, e.id, 'mcin', 'cout', 'close', { mask: i })).filter(Boolean); if (it.length) addRow(e.id, 'mcin', Object.assign(it, { mask: i }), row.ri); });
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
 * The pack frames to draw: every pack a rule reads or targets (`g.packs`, whose members are all on the canvas),
 * and every pack with at least one member on the canvas, so "Pack into…" makes a frame at once and a link can be
 * dropped on it. Returns a graph with those packs; canvasSet must be given the graph from buildGraph, not this one.
 */
export function withFrames(m, g, ids) {
    const packs = new Set(g.packs);
    for (const id of ids) for (const p of m.byId(id)?.packs ?? []) packs.add(p);
    return packs.size === g.packs.length ? g : { ...g, packs: [...packs] };
}

/** Layout directions (VISUAL 7.6): phones run top to bottom, desktop left to right. */
export const TB = 'tb';
export const LR = 'lr';
/** Left to right: the room between columns (lanes, junctions and pills), and between cards in a column. */
export const COL_GAP = 144;
export const STACK_GAP = 48;
/** The most cards a column of unlinked cards holds before it wraps into another column. */
const LOOSE_COL = 6;

/**
 * Layered layout (VISUAL 7.6): longest path ranks, barycentre order, packs kept together.
 * Top to bottom (phones): a layer wraps at ROW_W, so a wide one becomes several rows.
 * Left to right (desktop): each layer is a column, ordered by where its sources sit, every column centred on the
 * same middle line; a pack stands as one block in a column, its members stacked.
 * @param {{ dir?: 'tb' | 'lr' }} [opts]
 * @returns {Record<string, {x: number, y: number}>} positions by card key
 */
export function layout(m, g, ids, { dir = TB } = {}) {
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
    const lr = dir === LR;
    const cols = u => (u.pack ? (lr ? 1 : Math.min(2, u.keys.length)) : 1);
    const wOf = u => (u.pack ? cols(u) * CW + (cols(u) - 1) * 24 + 48 : CW + (m.byId(u.keys[0]).masks.length ? 36 : 0));
    const hOf = u => (u.pack ? Math.ceil(u.keys.length / cols(u)) * (CH + 24) - 24 + 60 : CH + (lr && m.byId(u.keys[0]).masks.length ? 48 : 0));
    const cx = new Map();
    const rowY = new Map();
    if (lr) layoutColumns(); else layoutRows();

    function layoutRows() {
        let y = 0;
        layers.forEach((L, d) => {
            if (!L) return;
            if (d > 0) L.forEach(u => { const ps = [...preds.get(u)].filter(p => cx.has(p)); u.bc = ps.length ? ps.reduce((s, p) => s + cx.get(p), 0) / ps.length : 0; });
            if (d > 0) L.sort((a, b) => a.bc - b.bc);
            // Phone first: a layer wider than two cards wraps onto more rows, so the canvas grows down, not sideways.
            const rows = [];
            for (const u of L) {
                const row = rows.at(-1);
                if (row && row.w + 60 + wOf(u) <= ROW_W) { row.units.push(u); row.w += 60 + wOf(u); } else rows.push({ units: [u], w: wOf(u) });
            }
            rows.forEach((row, i) => {
                let x = -row.w / 2;
                row.units.forEach(u => { const w = wOf(u); cx.set(u, x + w / 2); rowY.set(u, y); x += w + 60; });
                y += Math.max(...row.units.map(hOf)) + (i < rows.length - 1 ? 72 : 132);
            });
        });
    }

    function layoutColumns() {
        // Columns by link depth; the last layer (cards with no links) wraps every LOOSE_COL cards.
        const columns = [];
        const cy = new Map();
        layers.forEach((L, d) => {
            if (!L) return;
            const loose = L.every(u => !linked.has(u));
            if (loose) { for (let i = 0; i < L.length; i += LOOSE_COL) columns.push(L.slice(i, i + LOOSE_COL)); return; }
            columns.push(L);
        });
        const bookOrder = new Map(m.E.map((e, i) => [e.id, i]));
        let x = 0;
        for (const col of columns) {
            // Ordered by where their sources sit (barycentre); cards with no source in the book's own order.
            col.forEach(u => { const ps = [...preds.get(u)].filter(p => cy.has(p)); u.bc = ps.length ? ps.reduce((s, p) => s + cy.get(p), 0) / ps.length : Infinity; u.i = Math.min(...u.keys.map(k => bookOrder.get(k) ?? Infinity)); });
            col.sort((a, b) => (a.bc === b.bc ? a.i - b.i : a.bc - b.bc));
            const w = Math.max(...col.map(wOf));
            const h = col.reduce((s, u) => s + hOf(u), 0) + (col.length - 1) * STACK_GAP;
            let y = -h / 2;
            for (const u of col) {
                const uw = wOf(u);
                cx.set(u, x + uw / 2);
                rowY.set(u, y + (u.pack || !m.byId(u.keys[0]).masks.length ? 0 : 12));
                cy.set(u, y + hOf(u) / 2);
                y += hOf(u) + STACK_GAP;
            }
            x += w + COL_GAP;
        }
    }

    units.forEach(u => {
        const y0 = rowY.get(u) + (u.pack ? 36 : 0);
        const x0 = cx.get(u) - wOf(u) / 2 + (u.pack ? 24 : 0);
        const n = cols(u);
        u.keys.forEach((k, i) => {
            const c = u.pack ? i % n : 0;
            const r = u.pack ? Math.floor(i / n) : 0;
            pos[k] = { x: snap(x0 + c * (CW + 24)), y: snap(y0 + r * (CH + 24)) };
        });
    });
    return pos;
}

/**
 * Places cards that have no position yet (BUILD_SPEC 8.3): the nearest free spot beside the card it is linked
 * with, or the middle of the view. Top to bottom, a card its partner leads to goes below it first (then right, left,
 * above), and a card that leads to its partner goes above it first. Left to right, the same with right for below.
 * Changes `pos`.
 */
export function placeNew(m, g, ids, pos, center, { dir = TB } = {}) {
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
            const steps = dir === LR
                ? (partner.to === id ? [[1, 0], [0, 1], [0, -1], [-1, 0]] : [[-1, 0], [0, -1], [0, 1], [1, 0]])
                : (partner.to === id ? [[0, 1], [1, 0], [-1, 0], [0, -1]] : [[0, -1], [1, 0], [-1, 0], [0, 1]]);
            const [sx, sy] = dir === LR ? [CW + COL_GAP, CH + STACK_GAP] : [CW + 48, CH + 72];
            for (let ring = 1; ring <= 12 && !spot; ring++) {
                for (const [dx, dy] of steps) {
                    const p = { x: snap(base.x + dx * ring * sx), y: snap(base.y + dy * ring * sy) };
                    if (free(p)) { spot = p; break; }
                }
            }
        }
        if (!spot) {
            let p = { x: snap(center.x), y: snap(center.y) };
            for (let i = 0; i < 30 && !free(p); i++) p = { x: p.x, y: snap(p.y + CH + 72) };
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

/** On a side edge the ports run top to bottom: opens, glue, closes (VISUAL 7.6). */
const FAMILY_ORDER = { open: 0, glue: 1, close: 2 };
/** Where n ports sit along a side edge of a card: on the 12px lattice where they fit, so links leave straight. */
const SIDE_AT = { 1: [36], 2: [24, 48], 3: [12, 30, 48] };

/**
 * Which ports sit on each node, on which side and where (VISUAL 7.2, 7.6): by default the side facing the linked
 * cards; a card with masks keeps its bottom and right for the layers. Top to bottom (phones), long edges take
 * three ports and short edges one. Left to right (desktop), cards side by side link right edge to left edge and
 * cards above one another bottom to top; side edges take three ports, in family order; a port with no partner
 * (a lone lock or wait) sits on the top edge. Sides saved by hand always win.
 * @param {Record<string, string>} manual sides moved by hand, by `key:kind`
 * @param {{ dir?: 'tb' | 'lr' }} [opts]
 */
export function computePorts(g, R, manual = {}, { dir = TB } = {}) {
    const lr = dir === LR;
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
    // A row of only locks or waits has no line, but its pill needs a port to hang from.
    for (const rk of Object.keys(g.rows ?? {})) { const i = rk.lastIndexOf(':'); add(rk.slice(0, i), rk.slice(i + 1)); }
    const ctr = r => [r.x + r.w / 2, r.y + r.h / 2];
    for (const [key, ports] of P) {
        const r = R.get(key);
        const [cx, cy] = ctr(r);
        const hasMask = r.e?.masks.length;
        const load = { t: 0, b: 0, l: 0, r: 0 };
        const side = lr ? 3 : 1;
        const cap = { t: 3, b: hasMask ? 2 : 3, l: side, r: hasMask ? 0 : side };
        const list = [...ports.values()];
        for (const p of list) {
            const man = manual[`${key}:${p.kind}`];
            let dx = 0;
            let dy = 0;
            p.partners.forEach(k => { const [px, py] = ctr(R.get(k)); dx += px - cx; dy += py - cy; });
            if (lr && p.partners.length) { dx /= p.partners.length; dy /= p.partners.length; }
            let prefs;
            if (!p.partners.length && lr) {
                const out = PORT[p.kind].dir === 'out';
                prefs = ['t', 'b', out ? 'r' : 'l', out ? 'l' : 'r'];
            } else {
                if (!p.partners.length) dy = PORT[p.kind].dir === 'in' ? -1 : 1;
                // Side by side once the partner's column is clear of this card's; phones lean towards up and down.
                const across = lr ? Math.abs(dx) > (r.w + CW) / 2 - 24 : Math.abs(dy) * 1.6 < Math.abs(dx);
                prefs = across
                    ? [dx < 0 ? 'l' : 'r', dy < 0 ? 't' : 'b', dy < 0 ? 'b' : 't', dx < 0 ? 'r' : 'l']
                    : [dy < 0 ? 't' : 'b', dx < 0 ? 'l' : 'r', dy < 0 ? 'b' : 't', dx < 0 ? 'r' : 'l'];
            }
            p.pref = man ? [man, ...prefs] : prefs;
            p.ax = dx;
            p.ay = dy;
        }
        list.sort((a, b) => (!!manual[`${key}:${b.kind}`]) - (!!manual[`${key}:${a.kind}`]));
        for (const p of list) { p.side = p.pref.find(s => load[s] < cap[s]) ?? p.pref[0]; load[p.side]++; }
        for (const s of ['t', 'b', 'l', 'r']) {
            const on = list.filter(p => p.side === s);
            const flat = s === 't' || s === 'b';
            const along = p => (flat ? p.ax : p.ay);
            const fam = p => FAMILY_ORDER[PORT[p.kind].family];
            if (lr && !flat) on.sort((a, b) => fam(a) - fam(b) || a.kind.localeCompare(b.kind));
            else on.sort((a, b) => along(a) - along(b) || a.kind.localeCompare(b.kind));
            on.forEach((p, i) => {
                const f = (i + 1) / (on.length + 1);
                p.n = NORM[s];
                if (flat) { p.x = snap(r.x + r.w * f); p.y = s === 't' ? r.y : r.y + r.h; } else {
                    p.x = s === 'l' ? r.x : r.x + r.w;
                    p.y = lr && r.h === CH && SIDE_AT[on.length] ? r.y + SIDE_AT[on.length][i] : snap(r.y + r.h / 2);
                }
            });
        }
    }
    return P;
}

// ---- drawing helpers (links themselves are laid out by src/link-engine)

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
