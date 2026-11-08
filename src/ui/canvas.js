// The Hero canvas on screen (VISUAL 7): cards, ports, junctions, lock tags, links routed around cards, mask
// stacks, pack frames; pan, pinch and wheel zoom, Fit, card and port dragging. Lifted from the demo. Positions,
// port sides, the mask layer on each card and the camera are kept in the extension settings (D7, BUILD_SPEC 8.2).
import { CH, CW, G, PORT, SIDE_NAME, SIDE_OF, TB, buildGraph, canvasSet, withFrames, computePorts, layout, makeGrid, nodeRects, placeNew, rounded, route, snap } from './canvas-graph.js';
import { btn, el } from './dom.js';
import { ic } from './icons.js';

const FAMILY_VAR = { open: 'var(--p-open)', close: 'var(--p-close)', glue: 'var(--p-glue)', mask: 'var(--p-mask)', pack: 'var(--p-pack)' };
const STRAT_VAR = { keys: 'var(--s-key)', perm: 'var(--s-perm)', vec: 'var(--s-vec)', off: 'var(--s-off)' };
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, at, style) => { const n = document.createElementNS(NS, tag); for (const k in at) n.setAttribute(k, at[k]); if (style) n.setAttribute('style', style); return n; };

/**
 * The saved canvas of a book: { camera: {x, y, zoom} | null, cards: {key: {x, y, ports, layer, placed}}, placed }.
 * `placed` (book level) is the one-time arrangement of D8.
 */
export function canvasMemory(bookSettings) {
    const c = (bookSettings.canvas ??= { camera: null, cards: {}, placed: false });
    c.cards ??= {};
    return c;
}

/**
 * Lays out what isn't placed yet: the whole book once (D8), then each new card beside its partner.
 * @returns {{ g, ids, pos, R, P }}
 */
export function arrange(m, memory, center, dir = TB) {
    const g0 = buildGraph(m);
    const placedByHand = Object.entries(memory.cards).filter(([, c]) => c.placed).map(([k]) => k);
    const ids = canvasSet(m, g0, placedByHand);
    const g = withFrames(m, g0, ids);
    const pos = {};
    for (const [k, c] of Object.entries(memory.cards)) if (Number.isFinite(c.x) && ids.has(k)) pos[k] = { x: c.x, y: c.y };
    if (!memory.placed) {
        if (ids.size) Object.assign(pos, layout(m, g, new Set([...ids].filter(k => !pos[k])), { dir }));
        memory.placed = true;
    } else {
        placeNew(m, g, ids, pos, center, { dir });
    }
    for (const [k, p] of Object.entries(pos)) { const c = (memory.cards[k] ??= {}); c.x = p.x; c.y = p.y; }
    const manual = {};
    for (const [k, c] of Object.entries(memory.cards)) for (const [kind, side] of Object.entries(c.ports ?? {})) if (SIDE_OF[side]) manual[`${k}:${kind}`] = SIDE_OF[side];
    const R = nodeRects(m, g, ids, pos);
    const P = computePorts(g, R, manual, { dir });
    return { g, ids, pos, R, P };
}

/**
 * Mounts the canvas in `vp`.
 * @param {HTMLElement} vp
 * @param {object} d { book() → { m, memory, status(key) → card state | null, problems:Set, chatState, legend },
 *   save(), open(key, piece), pack(name), toast(text), onFirstFit? }
 */
/**
 * Routed links, kept across draws while nothing on the canvas moved: Hero mode redraws the canvas on every tap
 * (open the inspector, pick a piece), and routing every link again was most of a tap's time on a phone.
 */
const ROUTES = { sig: '', map: new Map() };
/** The smallest zoom a phone's first open and Fit go to (LAYOUT "Canvas"). */
export const PHONE_FLOOR = 0.8;

export function mountCanvas(vp, d) {
    const world = el('div', 'world');
    vp.append(world);
    const tools = el('div', 'canvas-tools');
    tools.append(btn('', ic('fit'), () => fit(), 'Fit to screen'), btn('', ic('plus'), () => zoomAt(1.2), 'Zoom in'), btn('', ic('minus'), () => zoomAt(1 / 1.2), 'Zoom out'));
    d.tools?.(tools); // desktop: Tidy and the inspector toggle
    const zl = el('div', 'zlabel');
    vp.append(tools, zl);
    // Focus and find-in-page can scroll even an overflow:hidden box; the camera is the only way to move.
    vp.addEventListener('scroll', () => { vp.scrollTop = 0; vp.scrollLeft = 0; });
    let CV = null;
    let drawn = 0; // full draws so far: a card drag notices one made under it
    let moving = null;
    let hit = null;
    let cam = null;
    /** Desktop: the cards selected on the canvas (click, Shift/Ctrl-click, Shift-drag a box). */
    let picked = new Set();

    const memory = () => d.book().memory;
    function camera() {
        const mem = memory();
        cam ??= mem.camera ? { tx: mem.camera.x, ty: mem.camera.y, scale: mem.camera.zoom } : null;
        return cam;
    }
    let camTimer = null;
    function saveCamera() {
        if (cam) memory().camera = { x: Math.round(cam.tx), y: Math.round(cam.ty), zoom: Math.round(cam.scale * 1000) / 1000 };
        clearTimeout(camTimer);
        camTimer = setTimeout(() => d.save(), 400);
    }
    function applyView() {
        const v = camera();
        if (!v) return;
        world.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
        zl.textContent = `${Math.round(v.scale * 100)}%`;
    }
    function viewCenter() {
        const v = camera() ?? { tx: 20, ty: 20, scale: 0.78 };
        const w = vp.clientWidth || 390;
        const h = vp.clientHeight || 600;
        return { x: (w / 2 - v.tx) / v.scale - CW / 2, y: (h / 2 - v.ty) / v.scale - CH / 2 };
    }

    function render() {
        const { m, problems = new Set(), status = () => null, chatState = false } = d.book();
        const mem = memory();
        const before = JSON.stringify(mem);
        const { g, ids, R, P } = arrange(m, mem, viewCenter(), d.dir ?? TB);
        if (JSON.stringify(mem) !== before) d.save();
        CV = { m, g, R, P, ids, links: [], conds: [], rowsAt: [] };
        world.innerHTML = '';
        drawn++;
        // Every node is tagged with the cards it belongs to (data-of): a card drag moves a card's own nodes and
        // hides the links to other cards, without drawing the canvas again (dragFrame).
        let owner = '';
        const put = (parent, ...nodes) => { for (const n of nodes) { if (owner) n.dataset.of = owner; parent.append(n); } };
        const owning = (o, fn) => { const was = owner; owner = o; try { return fn(); } finally { owner = was; } };
        vp.querySelector('.cv-empty')?.remove();
        if (!ids.size) {
            const hint = el('div', 'cv-empty');
            const p = el('p');
            p.append('Nothing on the canvas yet. Open the ');
            const icon = el('span', 'cv-ic');
            icon.innerHTML = ic('panel', 's');
            p.append(icon, ' panel and drag an entry\'s dot here, or long press the canvas to pick one.');
            hint.append(p);
            vp.append(hint);
        }
        const layerOf = e => {
            const name = mem.cards[e.id]?.layer;
            const i = name ? e.masks.findIndex(x => x.name === name) : -1;
            return i + 1;
        };
        const lk = sv('svg', { class: 'lk', width: 1, height: 1 });
        const pt = sv('svg', { class: 'pt', width: 1, height: 1 });

        // Decorations links must route around: mask layers and their ‹ › control.
        const extra = [];
        for (const r of R.values()) {
            if (!r.e?.masks.length) continue;
            const n = Math.min(2, r.e.masks.length);
            extra.push({ x: r.x, y: r.y - 6 * n, w: CW + 6 * n, h: CH });
            const bottomTaken = [...(P.get(r.key)?.values() ?? [])].some(p => p.side === 'b');
            r.nav = bottomTaken ? { v: true, x: r.x + CW + 6 * n + 8, y: r.y + CH / 2 - 36, w: 26, h: 72 } : { v: false, x: r.x + CW / 2 - 44, y: r.y + CH + 10, w: 88, h: 24 };
            extra.push(r.nav);
        }
        const grid = makeGrid(R, extra);
        const sig = [...R.values()].map(r => `${r.key}:${r.x},${r.y},${r.w},${r.h}`).join('|') + extra.map(r => `${r.x},${r.y},${r.w},${r.h}`).join('|');
        if (sig !== ROUTES.sig) { ROUTES.sig = sig; ROUTES.map.clear(); }
        const routeOnce = (sx, sy, ex, ey, al) => {
            const k = `${sx},${sy},${ex},${ey}|${[...al].sort().join(',')}`;
            if (!ROUTES.map.has(k)) ROUTES.map.set(k, route(grid, sx, sy, ex, ey, al));
            const pts = ROUTES.map.get(k);
            return pts && pts.map(q => [...q]);
        };

        for (const r of R.values()) {
            if (!r.pack) continue;
            owner = r.key;
            const f = el('div', 'packframe');
            Object.assign(f.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
            f.append(el('span', 'pn', `#${r.pack}`));
            f.dataset.pack = r.pack;
            put(world, f);
        }

        for (const r of R.values()) {
            const e = r.e;
            if (!e) continue;
            owner = e.id;
            if (e.greeting) {
                // A start card (VISUAL 7.5): rounded on the left, a chat icon, START over its name, the opening words.
                const c = el('div', `card greet${e.greeting.missing ? ' missing' : ''}${hit === e.id ? ' hit' : ''}${moving === e.id ? ' moving' : ''}${picked.has(e.id) ? ' picked' : ''}`);
                c.dataset.id = e.id;
                Object.assign(c.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${CW}px`, height: `${CH}px` });
                const gr = el('div', 'grip gicon');
                gr.innerHTML = ic('chat');
                gr.dataset.grip = e.id;
                gr.setAttribute('aria-label', `Move ${e.title}`);
                c.append(gr, el('div', 'tag', e.greeting.missing ? 'START · MISSING' : 'START'), el('div', 't', e.title),
                    el('div', 'k gk', e.greeting.changed ? 'Re-pick: the text changed' : e.text || '(empty)'));
                if (e.problem) { const b = el('span', 'cbang', '!'); b.title = 'This greeting changed'; c.append(b); }
                put(world, c);
                continue;
            }
            if (e.moment) {
                // A Moment (VISUAL 7.5): a short card with a spark, MOMENT over its name, its phrases in quotes in the
                // content font. No strategy stripe. With chat state on: happened, or not yet.
                const st = chatState ? status(e.id) : null;
                const c = el('div', `card moment${hit === e.id ? ' hit' : ''}${moving === e.id ? ' moving' : ''}${picked.has(e.id) ? ' picked' : ''}${st?.happened ? ' happened' : ''}`);
                c.dataset.id = e.id;
                Object.assign(c.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${CW}px`, height: `${CH}px` });
                const gr = el('div', 'grip gicon');
                gr.innerHTML = ic('spark');
                gr.dataset.grip = e.id;
                gr.setAttribute('aria-label', `Move ${e.title}`);
                const who = e.moment.by === 'user' ? ' · YOU' : e.moment.by === 'char' ? ' · CHARACTER' : '';
                const tag = st ? (st.happened ? 'HAPPENED' : 'NOT YET') : `MOMENT${who}`;
                c.append(gr, el('div', 'tag', tag), el('div', 't', e.title),
                    el('div', 'k gk', e.moment.phrases.length ? e.moment.phrases.map(p => `“${p}”`).join(' · ') : 'no phrases yet'));
                if (problems.has(e.uid)) { const b = el('span', 'cbang', '!'); b.title = 'This Moment has a problem'; c.append(b); }
                put(world, c);
                continue;
            }
            const si = layerOf(e);
            const st = chatState ? status(e.id) : null;
            for (let i = Math.min(2, e.masks.length); i >= 1; i--) {
                const b = el('div', 'layercard');
                Object.assign(b.style, { left: `${r.x + 6 * i}px`, top: `${r.y - 6 * i}px` });
                put(world, b);
            }
            const cls = ['card', e.off && 'off', si && 'masked', hit === e.id && 'hit', moving === e.id && 'moving', picked.has(e.id) && 'picked',
                st?.closed && 'closed', st?.waiting && 'waiting', st?.holding && 'holding'].filter(Boolean).join(' ');
            const c = el('div', cls);
            c.dataset.id = e.id;
            Object.assign(c.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${CW}px`, height: `${CH}px` });
            const gr = el('div', `grip${(e.strategy === 'vec' && !e.off) || st?.waiting ? ' ring' : ''}`);
            gr.style.setProperty('--c', STRAT_VAR[e.off ? 'off' : e.strategy]);
            gr.innerHTML = '<i></i>'.repeat(6);
            gr.dataset.grip = e.id;
            gr.setAttribute('aria-label', `Move ${e.title}`);
            c.append(gr, el('div', 't', e.title));
            const k = el('div', 'k');
            if (st?.closed) k.append(el('span', 'cl', `CLOSED · by ${st.closed}`));
            else if (si) k.textContent = `mask: ${e.masks[si - 1].name}`;
            else {
                if (e.by) k.insertAdjacentHTML('beforeend', ic(e.by === 'user' ? 'user' : 'bot'));
                k.append(el('span', '', e.strategy === 'perm' ? 'permanent' : e.keys.join(', ') || 'no key words'));
            }
            c.append(k);
            if (e.glue?.mode === 'hold') c.append(el('i', 'hold'));
            if (st?.fired) c.append(el('span', 'fired', `${st.fired}×`));
            else if (e.once) c.append(el('span', 'badge1', '1×'));
            if (problems.has(e.uid)) { const b = el('span', 'cbang', '!'); b.title = 'This entry has a problem'; c.append(b); }
            put(world, c);
            if (r.nav) {
                const n = el('div', `mnav${r.nav.v ? ' v' : ''}`);
                Object.assign(n.style, { left: `${r.nav.x}px`, top: `${r.nav.y}px` });
                if (r.nav.v) Object.assign(n.style, { height: `${r.nav.h}px`, width: `${r.nav.w}px`, justifyContent: 'space-between' });
                const active = st?.mask ? e.masks.findIndex(x => x.name === st.mask) + 1 : 0;
                const pv = btn('', ic('left'), null, 'Previous layer');
                pv.dataset.flip = e.id; pv.dataset.d = -1;
                const nx = btn('', ic('right'), null, 'Next layer');
                nx.dataset.flip = e.id; nx.dataset.d = 1;
                n.append(pv, el('span', '', `${si ? `${si}/${e.masks.length}` : 'main'}${active && active === si ? ' •' : ''}`), nx);
                put(world, n);
            }
        }

        owner = '';
        // Links.
        const visible = x => x.mask == null || layerOf(m.byId(x.to)) === x.mask + 1;
        const portOf = (key, kind) => P.get(key)?.get(kind);
        const tip = (p, dd) => [p.x + p.n[0] * dd, p.y + p.n[1] * dd];
        const allow = (...keys) => {
            const s = new Set();
            for (const key of keys) {
                if (!key) continue;
                if (key.startsWith('pack:')) s.add(key);
                else for (const r of R.values()) if (r.pack && r.members.includes(key)) s.add(r.key);
            }
            return s;
        };
        const color = kind => (kind === 'close' ? FAMILY_VAR.close : kind === 'ride' ? FAMILY_VAR.glue : FAMILY_VAR.open);
        const path = (pts, kind, dashed, cls = null) => {
            const n = sv('path', { d: rounded(pts) }, `stroke:${color(kind)};${kind === 'close' || dashed ? `stroke-dasharray:${dashed ?? '6 5'}` : ''}`);
            if (cls) n.classList.add(cls);
            put(lk, n);
            // Only Closes has a head (the bar of a stop); Opens and ride-along lines run knob to socket without one.
            if (kind === 'close') arrow(pts, kind, cls);
        };
        // Phones: a Closes line that runs back up the canvas is drawn faint until one of its cards is focused, so the
        // long lines climbing the page don't drown the story running down it (VISUAL 7.6).
        const focused = d.desk ? null : d.focused?.() ?? null;
        const faint = x => (!d.desk && x.kind === 'close' && focused !== x.from && focused !== x.to
            && (R.get(x.from)?.y ?? 0) > (R.get(x.to)?.y ?? 0) + CH ? 'faint' : null);
        // Arrowheads are drawn as paths (no SVG markers, which don't resolve reliably inside a shadow root).
        const arrow = (pts, kind, cls = null) => {
            const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const ux = (b[0] - a[0]) / len; const uy = (b[1] - a[1]) / len;
            const back = kind === 'close' ? 4 : 0;
            const tipX = b[0] - ux * back; const tipY = b[1] - uy * back;
            const bx = tipX - ux * 8; const by = tipY - uy * 8;
            const head = sv('path', { d: `M${tipX},${tipY} L${bx - uy * 5},${by + ux * 5} L${bx + uy * 5},${by - ux * 5} Z` }, `fill:${color(kind)};stroke:none`);
            if (cls) head.classList.add(cls);
            put(lk, head);
            if (kind === 'close') { const bar = sv('path', { d: `M${b[0] - uy * 6},${b[1] + ux * 6} L${b[0] + uy * 6},${b[1] - ux * 6}` }, `stroke:${color(kind)};stroke-width:2.5`); if (cls) bar.classList.add(cls); put(lk, bar); }
        };
        const drawEdge = (x, endPt, endN, rawEnd) => owning(`${x.from} ${x.to}`, () => {
            const a = portOf(x.from, x.fromPort);
            if (!a) return undefined;
            const s0 = tip(a, 7); const s1 = tip(a, G);
            const e1 = [endPt[0] + endN[0] * G, endPt[1] + endN[1] * G];
            const mid = routeOnce(snap(s1[0]), snap(s1[1]), snap(e1[0]), snap(e1[1]), allow(x.from, x.to));
            const pts = mid ? [s0, ...mid, rawEnd ?? endPt] : [s0, s1, e1, rawEnd ?? endPt];
            path(pts, x.kind, undefined, faint(x));
            // A wide, invisible copy of the line takes taps and drops (the piece bar edits a link through it).
            const hp = sv('path', { d: rounded(pts), class: 'lhit' });
            hp.dataset.link = CV.links.push({ kind: x.kind, from: x.from, to: x.to, mask: x.mask ?? null }) - 1;
            hp.dataset.ends = `${x.from}>${x.to}`;
            hp.dataset.kind = x.kind;
            put(lk, hp);
            if (x.mode) {
                const lb = el('div', 'plabel', x.mode === 'any' ? 'any' : x.mode === 'all' ? 'all' : `${x.mode}+`);
                Object.assign(lb.style, { left: `${s1[0] + a.n[0] * 8}px`, top: `${s1[1] + a.n[1] * 8}px` });
                put(world, lb);
            }
            return pts;
        });
        /** The point `d` back from the end of a line. */
        const along = (pts, d) => {
            for (let k = pts.length - 1; k > 0; k--) {
                const [b, a] = [pts[k], pts[k - 1]];
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (d <= len) return [b[0] + (a[0] - b[0]) * d / len, b[1] + (a[1] - b[1]) * d / len];
                d -= len;
            }
            return pts[0];
        };
        const handled = new Set();
        for (const [rk, rowsAll] of Object.entries(g.rows)) {
            const i = rk.lastIndexOf(':');
            const key = rk.slice(0, i);
            const kind = rk.slice(i + 1);
            const p = portOf(key, kind);
            owner = key;
            rowsAll.flat().forEach(x => handled.add(x));
            if (!p) continue;
            const rows = rowsAll.filter(row => row.every(x => x.cond ? (x.mask == null || layerOf(m.byId(key)) === x.mask + 1) : visible(x)));
            if (!rows.length) continue;
            const closeKind = kind === 'cin' || kind === 'mcin';
            const col = FAMILY_VAR[PORT[kind].family];
            const t = [-p.n[1], p.n[0]];
            const socketPt = tip(p, 2);
            const rowAt = row => CV.rowsAt.push({ key, port: kind, ri: row.ri, mask: row.mask ?? null }) - 1;
            const linksOf = row => row.filter(x => !x.cond);
            const condsOf = row => row.filter(x => x.cond);
            // Locks and waits sit on the line of their row: on the link itself when the row has one, else on the
            // short line from the row's junction to the card.
            const pill = (x, row, at) => {
                const n = el('div', 'lockp');
                n.style.color = col;
                n.innerHTML = ic(x.lock ? 'lock' : 'clock');
                n.append(el('span', '', x.lock ? x.lock[0] : `${x.wait} msg${x.wait === 1 ? '' : 's'}`));
                // Clear of the cards: a pill is wider than the gap beside a card's side, so it moves out along the
                // port's normal (or, on a top or bottom port, sideways) until it no longer sits on one.
                const label = x.lock ? x.lock[0] : `${x.wait} msgs`;
                const hw = Math.min(140, 30 + label.length * 6.5) / 2 + 4;
                const hh = 15;
                const on = ([cx, cy]) => [...R.values()].some(r => !r.pack && cx + hw > r.x && cx - hw < r.x + r.w && cy + hh > r.y && cy - hh < r.y + r.h);
                const step = p.n[0] ? [p.n[0] * 6, 0] : [6, 0];
                for (let i = 0; i < 24 && on(at); i++) at = [at[0] + step[0], at[1] + step[1]];
                Object.assign(n.style, { left: `${at[0]}px`, top: `${at[1]}px` });
                n.dataset.open = key;
                n.dataset.piece = PORT[kind].piece;
                n.dataset.kind = x.lock ? 'lock' : 'wait';
                n.dataset.cond = CV.conds.push({ key, port: kind, ri: row.ri, mask: row.mask ?? null, cond: x.lock ? { lock: x.lock, ...(x.by ? { by: x.by } : {}) } : { wait: x.wait, ...(x.by ? { by: x.by } : {}) } }) - 1;
                put(world, n);
            };
            const STEP = 30;
            if (rows.length === 1 && linksOf(rows[0]).length === 1) {
                const x = linksOf(rows[0])[0];
                const pts = drawEdge(x, socketPt, p.n, x.kind === 'close' ? tip(p, 3) : socketPt);
                if (pts) owning(`${x.from} ${x.to}`, () => condsOf(rows[0]).forEach((c, li) => pill(c, rows[0], along(pts, 28 + li * STEP))));
                continue;
            }
            const out = d => [snap(p.x + p.n[0] * d), snap(p.y + p.n[1] * d)];
            if (rows.length === 1 && !linksOf(rows[0]).length) {
                // Only locks and waits: a short line out of the socket with the pills on it.
                const cs = condsOf(rows[0]);
                path([out(14 + cs.length * STEP), socketPt], closeKind ? 'close' : 'open');
                cs.forEach((c, li) => pill(c, rows[0], [p.x + p.n[0] * (26 + li * STEP), p.y + p.n[1] * (26 + li * STEP)]));
                continue;
            }
            const own = rows.length === 1 ? condsOf(rows[0]).length : 0;
            const J0 = out(36 + own * STEP);
            path([J0, socketPt], closeKind ? 'close' : 'open');
            if (own) condsOf(rows[0]).forEach((c, li) => pill(c, rows[0], [p.x + p.n[0] * (22 + li * STEP), p.y + p.n[1] * (22 + li * STEP)]));
            const jl = el('div', 'junc', rows.length > 1 ? 'or' : 'and');
            jl.style.color = col;
            if (rows.length === 1 && rows[0].ri !== undefined) { jl.dataset.row = rowAt(rows[0]); jl.classList.add('jhit'); }
            Object.assign(jl.style, { left: `${J0[0]}px`, top: `${J0[1]}px` });
            put(world, jl);
            if (rows.length === 1) { linksOf(rows[0]).forEach(x => drawEdge(x, J0, p.n, J0)); continue; }
            const multi = rows.filter(r => linksOf(r).length > 1);
            rows.forEach((row, ri) => {
                const links = linksOf(row);
                const cs = condsOf(row);
                if (links.length > 1) {
                    // Several links: their own AND junction, with the pills on its line to the OR junction.
                    const mi = multi.indexOf(row);
                    const off = (mi - (multi.length - 1) / 2) * 84;
                    const reach = 40 + cs.length * STEP;
                    const target = [snap(J0[0] + p.n[0] * reach + t[0] * off), snap(J0[1] + p.n[1] * reach + t[1] * off)];
                    path([target, J0], 'open', null);
                    lk.lastChild.setAttribute('style', `stroke:${col}`);
                    cs.forEach((c, li) => pill(c, row, along([target, J0], 18 + li * STEP)));
                    const jr = el('div', 'junc', 'and');
                    jr.style.color = col;
                    if (row.ri !== undefined) { jr.dataset.row = rowAt(row); jr.classList.add('jhit'); }
                    Object.assign(jr.style, { left: `${target[0]}px`, top: `${target[1]}px` });
                    put(world, jr);
                    links.forEach(x => drawEdge(x, target, p.n, target));
                } else if (links.length === 1) {
                    const pts = drawEdge(links[0], J0, p.n, J0);
                    if (pts) owning(`${links[0].from} ${links[0].to}`, () => cs.forEach((c, li) => pill(c, row, along(pts, 26 + li * STEP))));
                } else {
                    // Only locks and waits, as one of several rows: a stub off the OR junction.
                    const kk = ri - (rows.length - 1) / 2;
                    cs.forEach((c, li) => {
                        const lp = [J0[0] + p.n[0] * (30 + li * STEP) + t[0] * kk * 80, J0[1] + p.n[1] * (30 + li * STEP) + t[1] * kk * 80];
                        put(lk, sv('path', { d: rounded([lp, J0]) }, `stroke:${col};stroke-dasharray:2 4`));
                        pill(c, row, lp);
                    });
                }
            });
        }
        owner = '';
        for (const x of g.edges) {
            if (handled.has(x) || !visible(x)) continue;
            const p = portOf(x.to, x.port);
            if (p) drawEdge(x, tip(p, 2), p.n, x.kind === 'ride' ? tip(p, 3) : tip(p, 2));
        }

        // Ports, on top of the cards: socket = in, knob = out (VISUAL 7.2).
        for (const [key, ports] of P) {
            owner = key;
            for (const p of ports.values()) {
                const def = PORT[p.kind];
                const t = [-p.n[1], p.n[0]];
                const rr = 7;
                const A = [p.x + t[0] * rr, p.y + t[1] * rr];
                const B = [p.x - t[0] * rr, p.y - t[1] * rr];
                const col = FAMILY_VAR[def.family];
                const outs = g.edges.filter(x => x.from === key && x.fromPort === p.kind);
                const ins = g.edges.filter(x => x.to === key && x.port === p.kind);
                const anyVisible = (def.dir === 'out' ? outs : ins).some(visible);
                if (def.dir === 'out') {
                    const sw = p.kind === 'gout' && g.switches.has(key);
                    const fill = !anyVisible ? 'var(--canvas)' : sw ? FAMILY_VAR.close : col;
                    put(pt, sv('path', { d: `M${A} A${rr},${rr} 0 0 0 ${B} Z` }, `fill:${fill};stroke:${sw ? FAMILY_VAR.close : col};stroke-width:2;${anyVisible ? '' : 'stroke-dasharray:3 2'}`));
                    if (sw) put(pt, sv('circle', { cx: p.x + p.n[0] * 3, cy: p.y + p.n[1] * 3, r: 2 }, 'fill:var(--canvas)'));
                } else {
                    if (!anyVisible) continue;
                    put(pt, sv('path', { d: `M${A} A${rr},${rr} 0 0 1 ${B} Z` }, 'fill:var(--canvas)'));
                    put(pt, sv('path', { d: `M${A} A${rr},${rr} 0 0 1 ${B}` }, `fill:none;stroke:${col};stroke-width:2.2`));
                    if (def.ring) {
                        const A2 = [p.x + t[0] * 11, p.y + t[1] * 11];
                        const B2 = [p.x - t[0] * 11, p.y - t[1] * 11];
                        put(pt, sv('path', { d: `M${A2} A11,11 0 0 1 ${B2}` }, `fill:none;stroke:${FAMILY_VAR.mask};stroke-width:2`));
                    }
                }
                const h = sv('circle', { cx: p.x, cy: p.y, r: 14, class: 'port' }, 'fill:transparent');
                h.dataset.port = `${key}|${p.kind}`;
                put(pt, h);
            }
        }
        owner = '';
        world.prepend(lk);
        world.append(pt);
        if (!camera()) fit(true);
        applyView();
        drawOverlay();
        if (d.desk && hoverKey && CV.R.has(hoverKey)) showHandles(hoverKey);
        if (d.desk && focusKey) applyFocus(focusKey);
    }

    // ---- the piece bar's overlay: dimmed cards, the cards a piece is on, and a link's loose end (pieces-one-by-one)
    let OV = null;
    const keyOf = n => n.dataset.id ?? (n.dataset.pack ? `pack:${n.dataset.pack}` : null);
    function drawOverlay() {
        world.querySelectorAll('.ov').forEach(n => n.remove());
        vp.classList.toggle('arming', !!OV?.dim);
        for (const n of world.querySelectorAll('.card[data-id], .packframe[data-pack]')) {
            const k = keyOf(n);
            const sel = !!OV?.sel?.has(k);
            // Asked once per card while this overlay stands: a loose end being dragged redraws it on every move.
            if (OV?.dim && !OV.dims?.has(k)) (OV.dims ??= new Map()).set(k, !!OV.dim(k));
            n.classList.toggle('dim', !sel && !!OV?.dims?.get(k));
            n.classList.toggle('sel', sel);
            n.classList.remove('target');
        }
        const lo = OV?.loose;
        const r = lo && CV?.R.get(lo.from);
        if (!r) return;
        const a = [r.x + r.w / 2, r.y + (lo.at[1] < r.y ? 0 : r.h)];
        const line = sv('svg', { class: 'lk ov', width: 1, height: 1 });
        line.append(sv('path', { d: `M${a[0]},${a[1]} L${lo.at[0]},${lo.at[1]}` }, `stroke:${lo.color};stroke-dasharray:6 5`));
        world.append(line);
        const h = el('div', 'loosend ov');
        h.style.color = lo.color;
        Object.assign(h.style, { left: `${lo.at[0]}px`, top: `${lo.at[1]}px` });
        h.setAttribute('aria-label', 'Loose end: drag it onto another card');
        world.append(h);
    }
    /** Sets the overlay: { dim(key) → bool, sel: Set, loose: { from, at: [x, y], color }, onLoose(hit) }. */
    function overlay(o) { OV = o; drawOverlay(); }
    /** Where a loose end starts: below its card. */
    function looseStart(key) {
        const r = CV?.R.get(key);
        return r ? [r.x + r.w / 2 + 24, r.y + r.h + 72] : [0, 0];
    }

    /** What a node on the canvas stands for: a card, a pack frame, a line, a junction or a lock/wait pill. */
    function hitOf(n) {
        if (!n?.closest) return null;
        if (n.closest('.loosend, .dragghost, .dropcancel')) return null;
        const cd = n.closest('[data-cond]');
        if (cd && CV.conds[cd.dataset.cond]) return { cond: CV.conds[cd.dataset.cond] };
        const rw = n.closest('[data-row]');
        if (rw && CV.rowsAt[rw.dataset.row]) return { row: CV.rowsAt[rw.dataset.row] };
        const c = n.closest('.card[data-id]');
        if (c) return { card: c.dataset.id };
        const port = n.closest('[data-port]');
        if (port) return { card: port.dataset.port.split('|')[0] };
        const ln = n.closest('[data-link]');
        if (ln && CV.links[ln.dataset.link]) return { link: CV.links[ln.dataset.link] };
        const pf = n.closest('[data-pack]');
        if (pf) return { card: `pack:${pf.dataset.pack}` };
        return null;
    }
    /** What is under a screen point. */
    function hitAt(cx, cy) {
        const root = vp.getRootNode();
        const list = (root.elementsFromPoint ? root : document).elementsFromPoint(cx, cy);
        for (const n of list) {
            if (n === vp) break;
            if (!vp.contains(n)) continue;
            const h = hitOf(n);
            if (h) return h;
        }
        return null;
    }
    function markTarget(h) {
        for (const n of world.querySelectorAll('.target')) n.classList.remove('target');
        if (!h?.card) return;
        const n = h.card.startsWith('pack:') ? world.querySelector(`.packframe[data-pack="${CSS.escape(h.card.slice(5))}"]`) : world.querySelector(`.card[data-id="${CSS.escape(h.card)}"]`);
        n?.classList.add('target');
    }

    /** `soon`: inside a gesture, the camera is applied on the next frame. */
    function zoomAt(f, cx, cy, soon = false) {
        const v = camera() ?? (cam = { tx: 20, ty: 20, scale: 0.78 });
        if (cx === undefined) { cx = vp.clientWidth / 2; cy = vp.clientHeight / 2; }
        const ns = Math.min(2, Math.max(0.25, v.scale * f));
        v.tx = cx - (cx - v.tx) * ns / v.scale;
        v.ty = cy - (cy - v.ty) * ns / v.scale;
        v.scale = ns;
        if (soon) viewLater(); else applyView();
        saveCamera();
    }

    /** Fits everything in view; the first fit keeps cards readable (55% at least) and starts at the top. */
    function fit(first = false) {
        if (!vp.clientWidth) return;
        cam ??= { tx: 20, ty: 20, scale: 0.78 };
        if (!CV || !CV.R.size) { applyView(); saveCamera(); return; }
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (const r of CV.R.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y - 40); x1 = Math.max(x1, r.x + r.w + 40); y1 = Math.max(y1, r.y + r.h + 40); }
        const W = vp.clientWidth; const H = vp.clientHeight - 20;
        cam.scale = Math.min(1, Math.max(0.25, Math.min((W - 24) / (x1 - x0), (H - 60) / (y1 - y0))));
        cam.tx = (W - (x1 - x0) * cam.scale) / 2 - x0 * cam.scale;
        cam.ty = 60 + (H - 60 - (y1 - y0) * cam.scale) / 2 - y0 * cam.scale;
        if (!d.desk && (d.dir ?? TB) === TB) {
            // Phones: fit the width, never below about 80%, and start at the top; the canvas scrolls down from there
            // rather than shrinking until it is unreadable.
            cam.scale = Math.min(1, Math.max(PHONE_FLOOR, (W - 24) / (x1 - x0)));
            const wide = (x1 - x0) * cam.scale;
            cam.tx = wide <= W - 24 ? (W - wide) / 2 - x0 * cam.scale : 12 - x0 * cam.scale;
            cam.ty = 60 - y0 * cam.scale;
        } else if (first && cam.scale < 0.55) { cam.scale = 0.55; cam.tx = W / 2 - ((x0 + x1) / 2) * cam.scale; cam.ty = 70 - y0 * cam.scale; }
        applyView();
        saveCamera();
    }

    function centerOn(key, flash = true) {
        const p = memory().cards[key];
        if (!p || !Number.isFinite(p.x)) return;
        const v = camera() ?? (cam = { tx: 20, ty: 20, scale: 0.8 });
        v.scale = Math.max(v.scale, 0.8);
        v.tx = vp.clientWidth / 2 - (p.x + CW / 2) * v.scale;
        v.ty = vp.clientHeight * 0.4 - (p.y + CH / 2) * v.scale;
        if (flash) {
            hit = key;
            render();
            setTimeout(() => { if (hit === key) { hit = null; if (vp.isConnected && !moving) render(); } }, 1600);
        }
        applyView();
        saveCamera();
    }

    // ---- input
    const pts = new Map();
    let mode = null;
    let start = null;
    let moved = false;
    let drag = null;
    let pinch = null;
    let holdTimer = null;
    const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); const v = camera(); return [(cx - r.left - v.tx) / v.scale, (cy - r.top - v.ty) / v.scale]; };
    // The camera moves at most once per frame (a phone sends pointer moves faster than it draws), and while a finger
    // pans or pinches, the world is its own GPU layer, so moving it doesn't paint the cards again. The layer is let go
    // at the end, which draws the text sharp at the new zoom.
    let viewRaf = 0;
    const viewLater = () => { if (!viewRaf) viewRaf = requestAnimationFrame(() => { viewRaf = 0; applyView(); }); };
    let gestureTimer = null;
    const gesture = on => {
        clearTimeout(gestureTimer);
        if (on) vp.classList.add('gesture');
        else { if (viewRaf) { cancelAnimationFrame(viewRaf); viewRaf = 0; applyView(); } vp.classList.remove('gesture'); }
    };

    // A card drag moves the card's own nodes (the card, its mask layers, ports, junctions and pills) and swaps its
    // links to other cards for straight guide lines, once per frame. The canvas is drawn again once, on the drop.
    let dragRaf = 0;
    let DR = null;
    function dragSetup(id) {
        // The card itself, or (desktop) every selected card when it is one of them.
        const group = new Set(drag?.group ?? [id]);
        const own = [];
        const others = new Map();
        for (const n of world.querySelectorAll('[data-of]')) {
            const of = n.dataset.of.split(' ');
            if (!of.some(k => group.has(k))) continue;
            if (of.every(k => group.has(k))) own.push(n);
            else {
                n.style.visibility = 'hidden';
                const mine = of.find(k => group.has(k));
                for (const k of of) if (!group.has(k)) others.set(`${mine}>${k}`, [mine, k]);
            }
        }
        for (const k of group) world.querySelector(`.card[data-id="${CSS.escape(k)}"]`)?.classList.add('moving');
        const guide = sv('svg', { class: 'lk dragguide', width: 1, height: 1 });
        world.prepend(guide);
        const r0 = CV.R.get(id);
        DR = { id, drawn, own, guide, from: r0 ? [r0.x, r0.y] : null, others: [...others.values()].map(([a, k]) => [a, CV.R.get(k)]).filter(([, r]) => r),
            paths: [] };
        for (let i = 0; i < DR.others.length; i++) DR.paths.push(guide.appendChild(sv('path', {}, 'stroke:var(--muted);stroke-dasharray:4 5;opacity:.7')));
    }
    function dragFrame() {
        dragRaf = 0;
        if (!moving) return;
        if (!DR || DR.id !== moving || DR.drawn !== drawn) dragSetup(moving);
        const c = memory().cards[moving];
        if (!DR.from || !c) return;
        const dx = c.x - DR.from[0];
        const dy = c.y - DR.from[1];
        for (const n of DR.own) n.style.translate = `${dx}px ${dy}px`;
        DR.others.forEach(([a, r], i) => {
            const q = memory().cards[a];
            if (!q) return;
            DR.paths[i].setAttribute('d', `M${q.x + CW / 2},${q.y + CH / 2} L${r.x + r.w / 2},${r.y + r.h / 2}`);
        });
    }
    const later = () => { if (!dragRaf) dragRaf = requestAnimationFrame(dragFrame); };
    vp.addEventListener('pointerdown', e => {
        if (e.target.closest('.canvas-tools, .panelBtn, .panel, .legend-box, .cvbanner')) return;
        if (!camera()) return;
        if (d.desk && e.button !== 0) return; // right-click is a menu, middle-click nothing
        vp.setPointerCapture?.(e.pointerId);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: camera().scale };
            mode = 'pinch';
            return;
        }
        moved = false;
        start = { x: e.clientX, y: e.clientY, tx: camera().tx, ty: camera().ty, target: e.target };
        const gr = e.target.closest?.('[data-grip]');
        const port = e.target.closest?.('[data-port]');
        const card = d.desk && !port && !e.target.closest?.('[data-flip], .lockp, .junc') ? e.target.closest?.('.card[data-id]') : null;
        const handle = d.desk ? e.target.closest?.('[data-handle]') : null;
        if (handle || (d.desk && port && PORT[port.dataset.port.split('|')[1]]?.dir === 'out' && !OV)) {
            // Desktop: drag from a hover handle or a knob onto another card makes a link (LAYOUT "Canvas: mouse").
            const [key, kindOrPort] = handle ? [handle.dataset.handle, handle.dataset.kind] : port.dataset.port.split('|');
            const kind = handle ? kindOrPort : { gout: 'open', cout: 'close', glout: 'ride' }[kindOrPort];
            mode = 'link';
            drag = { from: key, kind, port: port?.dataset.port };
        } else if (e.target.closest?.('.loosend') && OV?.loose) { mode = 'loose'; drag = {}; } else if (card || gr) {
            const id = (card ?? gr).dataset.id ?? gr.dataset.grip;
            const [wx, wy] = toWorld(e.clientX, e.clientY);
            const c = memory().cards[id];
            const group = d.desk && picked.has(id) && picked.size > 1 ? [...picked].filter(k => memory().cards[k]) : null;
            drag = { id, dx: wx - c.x, dy: wy - c.y, group, at: group ? Object.fromEntries(group.map(k => [k, { x: memory().cards[k].x, y: memory().cards[k].y }])) : null };
            mode = 'card';
        } else if (d.desk && e.shiftKey && !e.target.closest?.('[data-port], [data-pack], [data-link], [data-row], [data-cond]')) {
            mode = 'box';
            const r = vp.getBoundingClientRect();
            drag = { x0: e.clientX - r.left, y0: e.clientY - r.top, box: el('div', 'selbox') };
            vp.append(drag.box);
        } else if (gr) {
            const id = gr.dataset.grip;
            const [wx, wy] = toWorld(e.clientX, e.clientY);
            const c = memory().cards[id];
            drag = { id, dx: wx - c.x, dy: wy - c.y };
            mode = 'card';
        } else if (port) { mode = 'port'; drag = { port: port.dataset.port }; } else mode = 'pan';
        // A long press on empty canvas picks an entry to place there.
        clearTimeout(holdTimer);
        if (mode === 'pan' && d.holdEmpty && !d.desk && !OV && !e.target.closest?.('.card, [data-port], [data-pack], [data-flip], [data-open], [data-link], [data-row]')) {
            const at = { x: e.clientX, y: e.clientY };
            holdTimer = setTimeout(() => {
                if (moved || mode !== 'pan' || pts.size !== 1) return;
                mode = null; start = null;
                pts.clear();
                d.holdEmpty(pointAt(at.x, at.y));
            }, 520);
        }
    });
    vp.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (mode === 'pinch' && pts.size === 2) {
            const [a, b] = [...pts.values()];
            const r = vp.getBoundingClientRect();
            const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
            gesture(true);
            zoomAt(pinch.s * dd / pinch.d / camera().scale, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, true);
            return;
        }
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 7) { moved = true; clearTimeout(holdTimer); }
        if (!moved) return;
        if (mode === 'pan') { const v = camera(); v.tx = start.tx + e.clientX - start.x; v.ty = start.ty + e.clientY - start.y; gesture(true); viewLater(); } else if (mode === 'card') {
            const [wx, wy] = toWorld(e.clientX, e.clientY);
            moving = drag.id;
            hideHandles();
            const c = memory().cards[drag.id];
            const nx = snap(wx - drag.dx);
            const ny = snap(wy - drag.dy);
            if (drag.group) {
                const dx = nx - drag.at[drag.id].x;
                const dy = ny - drag.at[drag.id].y;
                for (const k of drag.group) Object.assign(memory().cards[k], { x: drag.at[k].x + dx, y: drag.at[k].y + dy });
            } else Object.assign(c, { x: nx, y: ny });
            later();
        } else if (mode === 'link') {
            drag.to = toWorld(e.clientX, e.clientY);
            drawLinkGuide();
            const h = hitAt(e.clientX, e.clientY);
            markTarget(h?.card && h.card !== drag.from ? h : null);
        } else if (mode === 'box') {
            const r = vp.getBoundingClientRect();
            const x1 = e.clientX - r.left;
            const y1 = e.clientY - r.top;
            Object.assign(drag.box.style, { left: `${Math.min(drag.x0, x1)}px`, top: `${Math.min(drag.y0, y1)}px`, width: `${Math.abs(x1 - drag.x0)}px`, height: `${Math.abs(y1 - drag.y0)}px` });
            drag.x1 = x1;
            drag.y1 = y1;
        } else if (mode === 'port') { drag.at = toWorld(e.clientX, e.clientY); vp.style.cursor = 'crosshair'; } else if (mode === 'loose') {
            OV.loose.at = toWorld(e.clientX, e.clientY);
            drawOverlay();
            const h = hitAt(e.clientX, e.clientY);
            markTarget(h?.card && !OV.dim?.(h.card) ? h : null);
        }
    });
    const end = e => {
        clearTimeout(holdTimer);
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        if (mode === 'pinch') { if (pts.size === 0) { mode = null; gesture(false); } return; }
        if (!pts.size) gesture(false);
        vp.style.cursor = '';
        if (mode === 'pan' && moved) saveCamera();
        if (mode === 'loose') {
            const h = moved && e.type === 'pointerup' ? hitAt(e.clientX, e.clientY) : null;
            markTarget(null);
            mode = null; start = null; drag = null;
            OV?.onLoose?.(h, OV?.loose?.at);
            return;
        }
        if (mode === 'link') {
            world.querySelector('.linkguide')?.remove();
            const h = moved && e.type === 'pointerup' ? hitAt(e.clientX, e.clientY) : null;
            markTarget(null);
            const from = drag.from;
            const kind = drag.kind;
            const portKey = drag.port;
            mode = null; start = null; drag = null;
            if (h?.card && h.card !== from) d.link?.(kind, from, h.card);
            else if (!moved && portKey) tapAt(e.target);
            return;
        }
        if (mode === 'box') {
            drag.box.remove();
            if (moved && drag.x1 !== undefined) {
                const [ax, ay] = toWorldLocal(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
                const [bx, by] = toWorldLocal(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
                const inside = [...CV.R.values()].filter(r => !r.pack && r.x < bx && r.x + r.w > ax && r.y < by && r.y + r.h > ay).map(r => r.key);
                setPicked(e.ctrlKey || e.metaKey ? new Set([...picked, ...inside]) : new Set(inside));
            }
            mode = null; start = null; drag = null;
            return;
        }
        if (mode === 'card' && moved) { moving = null; DR = null; if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; } d.save(); render(); } else if (mode === 'port' && moved && drag.at) {
            const [key, kind] = drag.port.split('|');
            const r = CV.R.get(key);
            const [x, y] = drag.at;
            const dist = { t: Math.abs(y - r.y), b: Math.abs(y - r.y - r.h), l: Math.abs(x - r.x), r: Math.abs(x - r.x - r.w) };
            const side = Object.entries(dist).sort((a, b) => a[1] - b[1])[0][0];
            if (!key.startsWith('pack:')) {
                const c = (memory().cards[key] ??= {});
                (c.ports ??= {})[kind] = SIDE_NAME[side];
                d.save();
                render();
                d.toast('Port moved');
            }
        } else if (!moved && start) {
            // Desktop: Shift/Ctrl-click adds a card to the selection; a click selects it alone (then inspects it).
            const c = d.desk ? start.target.closest?.('.card[data-id]') : null;
            if (c && (e.shiftKey || e.ctrlKey || e.metaKey) && !OV) {
                const s2 = new Set(picked);
                s2.has(c.dataset.id) ? s2.delete(c.dataset.id) : s2.add(c.dataset.id);
                setPicked(s2);
            } else {
                if (d.desk && !OV) setPicked(c ? new Set([c.dataset.id]) : new Set(), true);
                tapAt(start.target);
            }
        }
        moving = null;
        mode = null; start = null; drag = null;
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const r = vp.getBoundingClientRect();
        gesture(true);
        gestureTimer = setTimeout(() => gesture(false), 250);
        zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top, true);
    }, { passive: false });
    // Keyboard: the canvas tools are buttons; a focused card opens with Enter.
    vp.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.id) d.open(e.target.dataset.id); });

    const toWorldLocal = (x, y) => { const v = camera(); return [(x - v.tx) / v.scale, (y - v.ty) / v.scale]; };
    /** Desktop selection; `quiet` leaves telling the app to the tap that follows. */
    function setPicked(next, quiet = false) {
        picked = next;
        for (const n of world.querySelectorAll('.card[data-id]')) n.classList.toggle('picked', picked.has(n.dataset.id));
        if (!quiet) d.onPick?.([...picked]);
    }
    function drawLinkGuide() {
        world.querySelector('.linkguide')?.remove();
        const r = CV?.R.get(drag.from);
        if (!r || !drag.to) return;
        const col = { open: 'var(--p-open)', close: 'var(--p-close)', ride: 'var(--p-glue)' }[drag.kind];
        const line = sv('svg', { class: 'lk linkguide', width: 1, height: 1 });
        line.append(sv('path', { d: `M${r.x + r.w / 2},${r.y + r.h / 2} L${drag.to[0]},${drag.to[1]}` }, `stroke:${col};stroke-dasharray:6 5`));
        world.append(line);
    }

    // ---- desktop hover: handles under a card at once, its links bright after 350ms (LAYOUT "Canvas: mouse")
    let hoverKey = null;
    let focusKey = null;
    let focusTimer = null;
    let leaveTimer = null;
    function showHandles(key) {
        world.querySelector('.hhandles')?.remove();
        const r = CV?.R.get(key);
        const e = CV?.m.byId(key);
        if (!r || !e || OV) return;
        const box = el('div', 'hhandles');
        Object.assign(box.style, { left: `${r.x + r.w / 2}px`, top: `${r.y + r.h + 4}px` });
        const kinds = e.greeting || e.moment ? [['open', 'Opens: drag onto the card this one opens'], ['close', 'Closes: drag onto the card this one closes']]
            : [['open', 'Opens: drag onto the card this one opens'], ['close', 'Closes: drag onto the card this one closes'], ['ride', 'Glue: drag onto the card that rides along with this one']];
        for (const [k, label] of kinds) {
            const h = el('i', `hh ${k}`);
            h.dataset.handle = key;
            h.dataset.kind = k;
            h.title = label;
            box.append(h);
        }
        world.append(box);
    }
    function hideHandles() { world.querySelector('.hhandles')?.remove(); }
    function applyFocus(key) {
        focusKey = key;
        const lit = new Set([key]);
        for (const x of CV?.g.edges ?? []) {
            if (x.from === key || x.to === key) for (const k of [x.from, x.to]) { lit.add(k); if (k.startsWith('pack:')) CV.m.packMembers(k.slice(5)).forEach(m => lit.add(m.id)); }
        }
        const packs = CV?.m.byId(key)?.packs ?? [];
        for (const r of CV?.R.values() ?? []) if (r.pack && (packs.some(p => p === r.pack || p.startsWith(`${r.pack}/`)) || lit.has(r.key))) lit.add(r.key);
        vp.classList.add('focusdim');
        for (const n of world.querySelectorAll('[data-of]')) {
            const of = n.dataset.of.split(' ');
            const on = of.length > 1 ? of.includes(key) && of.every(k => lit.has(k)) : lit.has(of[0]);
            n.classList.toggle('lit', on);
        }
    }
    function clearFocus() {
        focusKey = null;
        vp.classList.remove('focusdim');
        for (const n of world.querySelectorAll('.lit')) n.classList.remove('lit');
    }
    if (d.desk) {
        vp.addEventListener('pointermove', e => {
            if (pts.size || e.buttons) return;
            const c = e.target.closest?.('.card[data-id]');
            const onHandles = e.target.closest?.('.hhandles');
            const key = c?.dataset.id ?? (onHandles ? hoverKey : null);
            if (key) {
                clearTimeout(leaveTimer);
                if (key !== hoverKey) {
                    hoverKey = key;
                    showHandles(key);
                    clearTimeout(focusTimer);
                    focusTimer = setTimeout(() => { if (hoverKey === key && !OV && !mode) applyFocus(key); }, 350);
                }
                return;
            }
            if (!hoverKey) return;
            // Off the card: let go after a moment, so crossing to its handles or the next card doesn't flicker.
            clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => { hoverKey = null; clearTimeout(focusTimer); hideHandles(); clearFocus(); }, 160);
        });
        vp.addEventListener('pointerleave', () => { clearTimeout(focusTimer); hoverKey = null; hideHandles(); clearFocus(); });
        vp.addEventListener('dblclick', e => {
            // The press captured the pointer, so the event's target is the view: look under the pointer instead.
            const key = hitAt(e.clientX, e.clientY)?.card;
            if (key && (key.startsWith('id:') || key.startsWith('uid:'))) d.openText?.(key);
        });
        vp.addEventListener('contextmenu', e => {
            if (e.target.closest('.canvas-tools, .panelBtn')) return;
            e.preventDefault();
            const c = e.target.closest?.('.card[data-id]');
            if (c) { if (!picked.has(c.dataset.id)) setPicked(new Set([c.dataset.id]), true); d.cardMenu?.(c.dataset.id, { x: e.clientX, y: e.clientY }); return; }
            d.emptyMenu?.(pointAt(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
        });
    }

    function flip(key, delta) {
        const e = CV.m.byId(key);
        const n = e.masks.length + 1;
        const c = (memory().cards[key] ??= {});
        const cur = c.layer ? e.masks.findIndex(x => x.name === c.layer) + 1 : 0;
        const next = (cur + delta + n) % n;
        if (next) c.layer = e.masks[next - 1].name; else delete c.layer;
        d.save();
        render();
    }

    function tapAt(t) {
        if (d.tapTarget?.(hitOf(t))) return;
        const fl = t.closest?.('[data-flip]');
        if (fl) { flip(fl.dataset.flip, Number(fl.dataset.d)); return; }
        const port = t.closest?.('[data-port]');
        if (port) {
            const [key, kind] = port.dataset.port.split('|');
            const outs = CV.g.edges.filter(x => x.from === key && x.fromPort === kind);
            const vis = outs.filter(x => x.mask == null || (CV.m.byId(x.to) && (memory().cards[x.to]?.layer ?? null) === CV.m.byId(x.to).masks[x.mask]?.name));
            if (PORT[kind].dir === 'out' && outs.length && !vis.length) {
                const x = outs[0];
                const target = CV.m.byId(x.to);
                (memory().cards[x.to] ??= {}).layer = target.masks[x.mask].name;
                d.save();
                render();
                d.toast(`${target.title}: showing mask "${target.masks[x.mask].name}"`);
                return;
            }
            if (key.startsWith('pack:')) { d.pack(key.slice(5)); return; }
            d.open(key, PORT[kind].piece);
            return;
        }
        const lp = t.closest?.('[data-open]');
        if (lp) { d.open(lp.dataset.open, lp.dataset.piece); return; }
        const card = t.closest?.('.card');
        if (card) { d.open(card.dataset.id); return; }
        const pf = t.closest?.('[data-pack]');
        if (pf) { d.pack(pf.dataset.pack); return; }
        d.tapEmpty?.();
    }

    /** Tidy: lay everything out again and put every port back on its default side. Returns what Undo needs. */
    function tidy() {
        const mem = memory();
        const before = structuredClone(mem.cards);
        const view = camera() ? { ...camera() } : null;
        const { m } = d.book();
        const ids = CV?.ids ?? new Set();
        const g = withFrames(m, buildGraph(m), ids);
        const pos = layout(m, g, ids, { dir: d.dir ?? TB });
        for (const k of ids) { const c = (mem.cards[k] ??= {}); c.x = pos[k].x; c.y = pos[k].y; delete c.ports; }
        d.save();
        render();
        fit();
        return () => {
            mem.cards = before;
            if (view) { cam = view; saveCamera(); }
            d.save();
            render();
        };
    }

    /** Pans just enough for a card to sit in the top `frac` of the view (above the inspector). */
    function reveal(key, frac = 1) {
        const p = memory().cards[key];
        const v = camera();
        if (!p || !Number.isFinite(p.x) || !v || !vp.clientWidth) return;
        const W = vp.clientWidth;
        const Hh = vp.clientHeight * frac;
        const sx = p.x * v.scale + v.tx;
        const sy = p.y * v.scale + v.ty;
        const w = CW * v.scale;
        const h = CH * v.scale;
        if (sx >= 8 && sx + w <= W - 8 && sy >= 8 && sy + h <= Hh - 8) return;
        v.tx = W / 2 - (p.x + CW / 2) * v.scale;
        v.ty = Hh / 2 - (p.y + CH / 2) * v.scale;
        applyView();
        saveCamera();
    }

    /** The canvas point under a screen point, or null when the point is outside the view. */
    function pointAt(cx, cy) {
        const r = vp.getBoundingClientRect();
        if (!camera() || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
        const [x, y] = toWorld(cx, cy);
        return { x: snap(x - CW / 2), y: snap(y - CH / 2) };
    }

    return {
        render, fit, centerOn, reveal, tidy, flip, pointAt, overlay, looseStart, hitAt, markTarget, zoomAt,
        picked: () => [...picked], setPicked,
        get view() { return CV; }, get camera() { return camera(); },
    };
}
