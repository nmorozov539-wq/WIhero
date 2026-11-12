// The Hero canvas on screen (VISUAL 7): cards, ports, junctions, lock tags, links routed around cards, mask
// stacks, pack frames; pan, pinch and wheel zoom, Fit, card and port dragging. Lifted from the demo. Positions,
// port sides, the mask layer on each card and the camera are kept in the extension settings (D7, BUILD_SPEC 8.2).
import { CH, CW, G, PORT, SIDE_OF, TB, buildGraph, canvasSet, withFrames, computePorts, layout, nodeRects, placeNew, rounded, snap } from './canvas-graph.js';
import { createLinkEngine } from '../link-engine/index.js';
import { addDot, moveDot, normalize, removeDot, setSegment, toCanvas } from '../link-engine/shape.js';
import { btn, el } from './dom.js';
import { ic } from './icons.js';
import { wireInput } from './canvas-input.js';

const FAMILY_VAR = { open: 'var(--p-open)', close: 'var(--p-close)', glue: 'var(--p-glue)', mask: 'var(--p-mask)', pack: 'var(--p-pack)' };
const STRAT_VAR = { keys: 'var(--s-key)', perm: 'var(--s-perm)', vec: 'var(--s-vec)', off: 'var(--s-off)' };
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, at, style) => { const n = document.createElementNS(NS, tag); for (const k in at) n.setAttribute(k, at[k]); if (style) n.setAttribute('style', style); return n; };
const kindColor = kind => (kind === 'close' ? FAMILY_VAR.close : kind === 'ride' ? FAMILY_VAR.glue : FAMILY_VAR.open);

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
    // Hand-made link shapes go with their link: one whose link is gone is dropped.
    const live = new Set(g.edges.map(x => `${x.from} ${linkKey(x)}`));
    for (const [k, c] of Object.entries(memory.cards)) {
        if (!c.links) continue;
        for (const lk of Object.keys(c.links)) if (!live.has(`${k} ${lk}`)) delete c.links[lk];
        if (!Object.keys(c.links).length) delete c.links;
    }
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
 * The link engine (src/link-engine): smooth links that go around cards. It keeps each link's path across draws and
 * only redoes the ones whose ends, shape or nearby cards changed: Hero mode redraws the canvas on every tap (open the
 * inspector, pick a piece), and routing every link again was most of a tap's time on a phone.
 */
const LINKS = createLinkEngine({ grid: G });
/** Where a link's hand-made shape is kept: on its source card, `canvas.cards[<from>].links[<this>]`. */
export const linkKey = x => `${x.fromPort}>${x.to}${x.mask != null ? `@${x.mask}` : ''}`;
/** The smallest zoom a phone's first open and Fit go to (LAYOUT "Canvas"). */
export const PHONE_FLOOR = 0.8;
export { holdSpace, wheelMove } from './canvas-mouse.js';
export { pinchCamera } from './canvas-touch.js';
export { MAGNET, nearCard } from './canvas-input.js';

export function mountCanvas(vp, d) {
    const world = el('div', 'world');
    vp.append(world);
    const tools = el('div', 'canvas-tools');
    tools.append(btn('', ic('fit'), () => fit(), 'Fit to screen'), btn('', ic('plus'), () => zoomAt(1.2), 'Zoom in'), btn('', ic('minus'), () => zoomAt(1 / 1.2), 'Zoom out'));
    d.tools?.(tools); // desktop: Tidy and the inspector toggle
    // The zoom label: a click goes to 100% around the middle of the view.
    const zl = el('button', 'zlabel');
    zl.type = 'button';
    zl.title = 'Zoom to 100%';
    zl.addEventListener('click', () => zoomTo(1));
    vp.append(tools, zl);
    // Focus and find-in-page can scroll even an overflow:hidden box; the camera is the only way to move.
    vp.addEventListener('scroll', () => { vp.scrollTop = 0; vp.scrollLeft = 0; });
    let CV = null;
    let drawn = 0; // full draws so far: a card drag notices one made under it
    let moving = null;
    let hit = null;
    let cam = null;
    /** Desktop: the cards selected on the canvas (click, Shift/Ctrl-click, a drag on empty canvas). */
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
        let fading = false; // drawing another layer's links (#29): faded
        const put = (parent, ...nodes) => { for (const n of nodes) { if (owner) n.dataset.of = owner; if (fading) n.classList.add('lfade'); parent.append(n); } };
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

        // Where each masked card's ‹ › control goes: under the card, or beside it when its bottom edge has a port.
        for (const r of R.values()) {
            if (!r.e?.masks.length) continue;
            const n = Math.min(2, r.e.masks.length);
            const bottomTaken = [...(P.get(r.key)?.values() ?? [])].some(p => p.side === 'b');
            r.nav = bottomTaken ? { v: true, x: r.x + CW + 6 * n + 8, y: r.y + CH / 2 - 36, w: 26, h: 72 } : { v: false, x: r.x + CW / 2 - 44, y: r.y + CH + 10, w: 88, h: 24 };
        }
        // What links go around: cards, mask stacks and their ‹ › control, and pack frames (only their members' links
        // go in). A card's own stack sits over its top edge, so its links may touch it.
        const obstacles = [];
        for (const r of R.values()) {
            if (r.pack) obstacles.push({ id: r.key, x: r.x, y: r.y, w: r.w, h: r.h, pass: 'members', members: new Set(r.members) });
            else obstacles.push({ id: r.key, x: r.x, y: r.y, w: r.w, h: r.h });
            if (!r.e?.masks.length) continue;
            const n = Math.min(2, r.e.masks.length);
            obstacles.push({ id: `${r.key}#stack`, x: r.x, y: r.y - 6 * n, w: CW + 6 * n, h: CH }, { id: `${r.key}#nav`, x: r.nav.x, y: r.nav.y, w: r.nav.w, h: r.nav.h });
        }
        LINKS.setObstacles(obstacles);

        // Larger frames first: an inner frame must not cover another pack's higher header band.
        const frames = [...R.values()].filter(r => r.pack).sort((a, b) => b.w * b.h - a.w * a.h);
        for (const r of frames) {
            owner = r.key;
            const f = el('div', 'packframe');
            Object.assign(f.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
            const pn = el('span', 'pn', `#${r.pack}`);
            pn.title = `#${r.pack} — Rename the pack (drag to move it)`;
            f.append(pn);
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
            else if (typeof st?.value === 'string') { k.classList.add('wval'); k.textContent = `${st.mask ? `${st.mask}: ` : ''}${st.value.replace(/\s+/g, ' ')}`; k.title = st.value; }
            else if (si) k.textContent = `mask: ${e.masks[si - 1].name}`;
            else {
                if (e.by) k.insertAdjacentHTML('beforeend', ic(e.by === 'user' ? 'user' : 'bot'));
                k.append(el('span', '', e.strategy === 'perm' ? 'permanent' : e.keys.join(', ') || 'no key words'));
            }
            c.append(k);
            if (e.glue?.mode === 'hold') c.append(el('i', 'hold'));
            if (st?.fired) c.append(el('span', 'fired', `${st.fired}×`));
            else if (e.once) c.append(el('span', 'badge1', '1×'));
            else if (e.closesAfter != null) {
                const b = el('span', 'badge1', e.closesAfter ? `+${e.closesAfter}` : '1×');
                b.title = e.closesAfter ? `Closes ${e.closesAfter} message${e.closesAfter === 1 ? '' : 's'} after it first fires` : 'Closes after it first fires';
                c.append(b);
            }
            if (e.timing) { const b = el('span', 'timing', e.timing.text); b.title = `ST: ${e.timing.title}`; c.append(b); }
            if (problems.has(e.uid)) { const b = el('span', 'cbang', '!'); b.title = 'This entry has a problem'; c.append(b); }
            if (e.note) {
                // A sticky note (AFTER_V1): the author's own, pinned over the card; never sent to the model.
                const n = el('div', 'sticky', e.note);
                n.title = e.note;
                c.append(n);
            }
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
        const color = kindColor;
        const path = (pts, kind, dashed, cls = null, dd = rounded(pts)) => {
            const n = sv('path', { d: dd }, `stroke:${color(kind)};${kind === 'close' || dashed ? `stroke-dasharray:${dashed ?? '6 5'}` : ''}`);
            if (cls) n.classList.add(cls);
            put(lk, n);
            // Only Closes has a head (the bar of a stop); Opens and ride-along lines run knob to socket without one.
            if (kind === 'close') arrow(pts, kind, cls);
        };
        // Phones: a Closes line that runs back up the canvas is drawn faint until one of its cards is focused, so the
        // long lines climbing the page don't drown the story running down it (VISUAL 7.6).
        const focused = d.desk ? null : d.focused?.() ?? null;
        const faint = x => (x.fade ? 'faint' : !d.desk && x.kind === 'close' && focused !== x.from && focused !== x.to
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
        // Links are laid out together (so they keep a lane apart and cross cleanly), then drawn: drawEdge queues one,
        // and `then(pts)` runs once it's drawn, with its points (pills sit on them).
        const queue = [];
        const linkIds = new Set();
        const drawEdge = (x, endPt, endN, rawEnd, then = null) => {
            const a = portOf(x.from, x.fromPort);
            if (!a) return;
            const end = rawEnd ?? endPt;
            let id = `${x.from}>${x.fromPort}>${x.to}>${x.port}${x.mask != null ? `@${x.mask}` : ''}`;
            while (linkIds.has(id)) id += '+';
            linkIds.add(id);
            const shape = mem.cards[x.from]?.links?.[linkKey(x)] ?? null;
            const s0 = tip(a, 7);
            queue.push({
                x: fading ? { ...x, fade: true } : x, a, then,
                def: {
                    id,
                    from: { x: s0[0], y: s0[1], n: a.n, card: x.from },
                    to: { x: end[0], y: end[1], n: endN, card: R.has(x.to) && !isJunction(endPt, x) ? x.to : undefined },
                    owner: new Set([...allow(x.from, x.to), `${x.from}#stack`, `${x.to}#stack`]),
                    shape,
                },
            });
        };
        // A link that ends on a junction (an AND or OR point off the card) doesn't end on its card.
        const isJunction = (pt, x) => { const p = portOf(x.to, x.port); return !p || Math.hypot(pt[0] - p.x, pt[1] - p.y) > 6; };
        // A link's own drawn nodes (its line and head) carry data-lid, so a dot drag can draw just that link again.
        const lineOf = q => {
            const n0 = lk.childNodes.length;
            const flat = LINKS.polyline(q.def.id, 1);
            const pts = [];
            for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
            path(pts, q.x.kind, undefined, faint(q.x), LINKS.path(q.def.id).d);
            for (const n of [...lk.childNodes].slice(n0)) { n.dataset.lid = q.def.id; n.classList.add('ln'); }
            return pts;
        };
        const drawQueued = () => {
            LINKS.layout(queue.map(q => q.def));
            for (const q of queue) {
                const { x, a, then, def } = q;
                owning(`${x.from} ${x.to}`, () => {
                    const pts = lineOf(q);
                    // A wide, invisible copy of the line takes taps and drops (the piece bar edits a link through it).
                    const hp = sv('path', { d: LINKS.path(def.id).d, class: 'lhit' });
                    hp.dataset.link = CV.links.push({ kind: x.kind, from: x.from, to: x.to, mask: x.mask ?? null, id: def.id, key: linkKey(x) }) - 1;
                    hp.dataset.ends = `${x.from}>${x.to}`;
                    hp.dataset.kind = x.kind;
                    hp.dataset.lid = def.id;
                    put(lk, hp);
                    if (x.mode) {
                        const s1 = tip(a, G);
                        const lb = el('div', 'plabel', x.mode === 'any' ? 'any' : x.mode === 'all' ? 'all' : `${x.mode}+`);
                        Object.assign(lb.style, { left: `${s1[0] + a.n[0] * 8}px`, top: `${s1[1] + a.n[1] * 8}px` });
                        put(world, lb);
                    }
                    then?.(pts);
                });
            }
        };
        // Draws some links again after a layout (a dot being dragged): their lines and hit paths, not their pills.
        CV.queue = queue;
        CV.relink = ids => {
            for (const q of queue) {
                if (!ids.has(q.def.id)) continue;
                for (const n of [...lk.querySelectorAll('.ln')]) if (n.dataset.lid === q.def.id) n.remove();
                owning(`${q.x.from} ${q.x.to}`, () => lineOf(q));
                for (const n of lk.querySelectorAll('.lhit')) if (n.dataset.lid === q.def.id) n.setAttribute('d', LINKS.path(q.def.id).d);
            }
        };
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
        /** Draws one port's rows: links into its socket, AND and OR junctions, and lock and wait pills. */
        const drawRows = (key, kind, p, rows) => {
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
                drawEdge(x, socketPt, p.n, x.kind === 'close' ? tip(p, 3) : socketPt, pts => condsOf(rows[0]).forEach((c, li) => pill(c, rows[0], along(pts, 28 + li * STEP))));
                return;
            }
            const out = d => [snap(p.x + p.n[0] * d), snap(p.y + p.n[1] * d)];
            if (rows.length === 1 && !linksOf(rows[0]).length) {
                // Only locks and waits: a short line out of the socket with the pills on it.
                const cs = condsOf(rows[0]);
                path([out(14 + cs.length * STEP), socketPt], closeKind ? 'close' : 'open');
                cs.forEach((c, li) => pill(c, rows[0], [p.x + p.n[0] * (26 + li * STEP), p.y + p.n[1] * (26 + li * STEP)]));
                return;
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
            if (rows.length === 1) { linksOf(rows[0]).forEach(x => drawEdge(x, J0, p.n, J0)); return; }
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
                    drawEdge(links[0], J0, p.n, J0, pts => cs.forEach((c, li) => pill(c, row, along(pts, 26 + li * STEP))));
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
            // Every layer's rows: the shown layer's as usual, the other layers' faded (#29), each layer on its own.
            const shown = row => row.every(x => x.cond ? (x.mask == null || layerOf(m.byId(key)) === x.mask + 1) : visible(x));
            const rows = rowsAll.filter(shown);
            if (rows.length) drawRows(key, kind, p, rows);
            const others = new Map();
            for (const row of rowsAll) if (!shown(row)) { const mk = row.mask ?? row.find(x => x.mask != null)?.mask ?? -1; if (!others.has(mk)) others.set(mk, []); others.get(mk).push(row); }
            for (const list of others.values()) { fading = true; try { drawRows(key, kind, p, list); } finally { fading = false; } }
        }
        owner = '';
        for (const x of g.edges) {
            if (handled.has(x)) continue;
            const p = portOf(x.to, x.port);
            fading = !visible(x);
            if (p) drawEdge(x, tip(p, 2), p.n, x.kind === 'ride' ? tip(p, 3) : tip(p, 2));
            fading = false;
        }
        drawQueued();

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
        // Phones have no hover: the card whose inspector is open is the focused one, and the rest dims as on desktop.
        if (!d.desk) phoneFocus();
        drawShaping();
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
    /**
     * Links into or out of one port run together near it, so a short line can lie mostly under a longer one. Of the
     * lines whose hit paths are under a point, the one nearest it (the top one on a tie); any other node as it is.
     */
    function lineUnder(t, cx, cy) {
        if (!t?.classList?.contains('lhit')) return t;
        const root = vp.getRootNode();
        const list = (root.elementsFromPoint ? root : document).elementsFromPoint(cx, cy).filter(n => n.classList?.contains('lhit') && vp.contains(n));
        if (list.length < 2) return t;
        const [x, y] = toWorld(cx, cy);
        let best = t; let bd = Infinity;
        for (const n of list) {
            const dist = LINKS.nearest(n.dataset.lid, { x, y })?.dist ?? Infinity;
            if (dist < bd - 0.5) { best = n; bd = dist; }
        }
        return best;
    }
    /** What is under a screen point. */
    function hitAt(cx, cy) {
        const root = vp.getRootNode();
        const list = (root.elementsFromPoint ? root : document).elementsFromPoint(cx, cy);
        for (const n of list) {
            if (n === vp) break;
            if (!vp.contains(n)) continue;
            const h = hitOf(lineUnder(n, cx, cy));
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

    /** Zooms to `scale` (100%: 1) around the middle of the view. */
    function zoomTo(scale) {
        const v = camera();
        if (!v) return;
        zoomAt(scale / v.scale);
    }

    /**
     * Fits the picked cards in view when any are picked (F, the Fit button), else everything. The first fit keeps
     * cards readable (55% at least) and starts at the top.
     */
    function fit(first = false) {
        if (!vp.clientWidth) return;
        cam ??= { tx: 20, ty: 20, scale: 0.78 };
        if (!CV || !CV.R.size) { applyView(); saveCamera(); return; }
        const sel = first ? [] : [...picked].map(k => CV.R.get(k)).filter(Boolean);
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (const r of sel.length ? sel : CV.R.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y - 40); x1 = Math.max(x1, r.x + r.w + 40); y1 = Math.max(y1, r.y + r.h + 40); }
        const W = vp.clientWidth; const H = vp.clientHeight - 20;
        cam.scale = Math.min(1, Math.max(0.25, Math.min((W - 24) / (x1 - x0), (H - 60) / (y1 - y0))));
        cam.tx = (W - (x1 - x0) * cam.scale) / 2 - x0 * cam.scale;
        cam.ty = 60 + (H - 60 - (y1 - y0) * cam.scale) / 2 - y0 * cam.scale;
        if (!d.desk && (d.dir ?? TB) === TB && first) {
            // Phones, on first open: fit the width, never below about 80%, and start at the top; the canvas scrolls
            // down from there rather than shrinking until it is unreadable. Fit itself shows every card (#36).
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

    // ---- shaping a link: the strip of a drawn link shows its dots, a ghost dot on each part, and the part picked.
    // Only these handles catch a drag; the line itself still pans, so links never become places a finger gets stuck.
    let SH = null; // { sel: { kind, from, to, seg, dot }, l: the CV.links entry, q: its queued def }
    function selLink(sel) {
        return CV?.links.find(l => l.kind === sel.kind && l.from === sel.from && l.to === sel.to && (l.mask ?? null) === (sel.mask ?? null)) ?? null;
    }
    function drawShaping() {
        vp.classList.remove('shaping');
        world.querySelector('svg.hd')?.remove();
        const sel = d.shaping?.() ?? null;
        const l = sel && selLink(sel);
        const q = l && CV.queue?.find(y => y.def.id === l.id);
        const was = SH?.l.id;
        SH = q ? { sel: { seg: 0, dot: null, ...sel }, l, q } : null;
        if (!SH) return;
        vp.classList.add('shaping');
        drawHandles();
        // Phones: a line just picked has its ghost dots brought into view once the strip has taken its room (half
        // the screen). A mouse has room to spare, and moving the view under it would be a surprise.
        if (!d.desk && was !== SH.l.id) requestAnimationFrame(() => showHandlesOf(SH?.l.id));
    }
    function showHandlesOf(id) {
        const v = camera();
        const mids = id && LINKS.midpoints(id);
        if (!v || !mids?.length || !vp.clientWidth) return;
        const W = vp.clientWidth;
        const Hh = vp.clientHeight;
        const M = 48;
        const at = mids.map(m => [m.x * v.scale + v.tx, m.y * v.scale + v.ty]);
        if (at.every(([x, y]) => x >= M && x <= W - M && y >= M && y <= Hh - M)) return;
        const cx = at.reduce((s, p) => s + p[0], 0) / at.length;
        const cy = at.reduce((s, p) => s + p[1], 0) / at.length;
        v.tx += W / 2 - cx;
        v.ty += Hh / 2 - cy;
        applyView();
        saveCamera();
    }
    const storedShape = () => normalize(memory().cards[SH.l.from]?.links?.[SH.l.key] ?? null);
    function writeShape(shape) {
        const c = (memory().cards[SH.l.from] ??= {});
        if (shape) (c.links ??= {})[SH.l.key] = shape;
        else if (c.links) { delete c.links[SH.l.key]; if (!Object.keys(c.links).length) delete c.links; }
        SH.q.def.shape = shape;
    }
    /** The link's points in order: its start, each dot, its end. */
    function shapePoints(shape) {
        const ends = LINKS.ends(SH.l.id);
        const { from, to } = SH.q.def;
        return [{ x: from.x, y: from.y }, ...(shape?.dots ?? []).map(dt => toCanvas(dt, ends)), { x: to.x, y: to.y }];
    }
    function drawHandles() {
        world.querySelector('svg.hd')?.remove();
        for (const n of world.querySelectorAll('svg.lk .ln')) n.classList.toggle('shsel', n.dataset.lid === SH.l.id);
        const id = SH.l.id;
        const lp = LINKS.path(id);
        if (!lp) return;
        const k = 1 / (camera()?.scale || 1);
        const hd = sv('svg', { class: 'hd', width: 1, height: 1 });
        hd.style.color = kindColor(SH.l.kind);
        hd.append(sv('path', { d: lp.d, class: 'sband' }));
        const shape = storedShape();
        const pts = shapePoints(shape);
        const st = shapeState();
        if (st.segs > 1 && st.seg != null) { const sd = LINKS.segmentD(id, st.seg); if (sd) hd.append(sv('path', { d: sd, class: 'sseg' })); }
        // A dot inside a card: the card gets a dashed outline, so it's plain the line was sent through it on purpose.
        for (const p of pts.slice(1, -1)) {
            const r = [...CV.R.values()].find(b => !b.pack && p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);
            if (r) hd.append(sv('rect', { x: r.x - 5, y: r.y - 5, width: r.w + 10, height: r.h + 10, rx: 12, class: 'incard' }));
        }
        // Hit circles are 32px across on a phone and 18px with a mouse, whatever the zoom.
        const hit = (cx, cy, attr, v) => { const c = sv('circle', { cx, cy, r: (d.desk ? 9 : 16) * k, class: 'hhit' }); c.dataset[attr] = v; return c; };
        (LINKS.midpoints(id) ?? []).forEach((m, s) => hd.append(sv('circle', { cx: m.x, cy: m.y, r: 4.5 * k, class: 'ghost' }), hit(m.x, m.y, 'ghost', s)));
        pts.slice(1, -1).forEach((p, i) => {
            const on = st.dot === i;
            hd.append(sv('circle', { cx: p.x, cy: p.y, r: (on ? 7.5 : 6) * k, class: `sdot${on ? ' on' : ''}` }), hit(p.x, p.y, 'dot', i));
        });
        world.append(hd);
    }
    /** What the strip shows: how many parts, which part or dot is picked, and that part's settings. */
    function shapeState() {
        if (!SH) return null;
        const shape = storedShape();
        const segs = (shape?.dots.length ?? 0) + 1;
        const dot = SH.sel.dot != null && SH.sel.dot < segs - 1 ? SH.sel.dot : null;
        const seg = dot == null && segs > 1 ? Math.min(SH.sel.seg ?? 0, segs - 1) : null;
        const s = shape?.segments[seg ?? 0] ?? { type: 'curve' };
        return { shaped: !!shape, segs, seg, dot, type: s.type, flip: !!s.flip, tension: s.tension ?? 0.5 };
    }
    let liveRaf = 0;
    function relayout() {
        liveRaf = 0;
        if (!SH) return;
        const { changed } = LINKS.layout(CV.queue.map(q => q.def));
        CV.relink(new Set([...changed, SH.l.id]));
        drawHandles();
    }
    const liveLater = () => { if (!liveRaf) liveRaf = requestAnimationFrame(relayout); };
    /** Changes the shape. `live`: a slider being dragged, drawn at once without telling the app. */
    function editShape(fn, live = false) {
        if (!SH) return;
        writeShape(normalize(fn(storedShape(), shapeState())));
        if (live) { liveLater(); return; }
        d.save();
        d.shapeSet?.({ seg: SH.sel.seg, dot: SH.sel.dot }, true);
    }
    /** Sets the picked part (or every part, when none is picked) to `patch`: { type?, flip?, tension? }. */
    function patchShape(patch, live = false) {
        editShape((s, st) => {
            const list = st.seg == null ? [...Array(st.segs).keys()] : [st.seg];
            for (const i of list) s = setSegment(s, i, patch);
            return s;
        }, live);
    }
    function removeShapeDot(i = shapeState()?.dot) {
        if (!SH || i == null) return;
        writeShape(removeDot(storedShape(), i));
        d.save();
        d.shapeSet?.({ seg: i, dot: null }, true);
    }
    function resetShape() {
        if (!SH) return;
        writeShape(null);
        d.save();
        d.shapeSet?.({ seg: 0, dot: null }, true);
    }
    /** Where a dragged dot goes: on the grid with a mouse (Alt: anywhere); level with a neighbour on a phone. */
    function dotPoint(drag, cx, cy, free) {
        let [x, y] = toWorld(cx, cy);
        if (d.desk) return free ? { x, y } : { x: snap(x), y: snap(y) };
        const P = shapePoints(storedShape());
        const near = drag.dot == null ? [P[drag.ghost], P[drag.ghost + 1]] : [P[drag.dot], P[drag.dot + 2]];
        const t = 8 / camera().scale;
        for (const n of near) {
            if (!n) continue;
            if (Math.abs(x - n.x) < t) x = n.x;
            if (Math.abs(y - n.y) < t) y = n.y;
        }
        return { x, y };
    }
    /** A dot drag (`drag`: the input's { dot, ghost }) at a screen point. */
    function dotTo(drag, cx, cy, free) {
        const p = dotPoint(drag, cx, cy, free);
        const ends = LINKS.ends(SH.l.id);
        let shape = storedShape();
        if (drag.dot == null) { shape = addDot(shape, drag.ghost, p, ends); drag.dot = drag.ghost; drag.ghost = null; } else shape = moveDot(shape, drag.dot, p, ends);
        writeShape(shape);
        SH.sel.dot = drag.dot;
        liveLater();
    }
    /** Desktop: a double-click on the shaped line adds a dot there. */
    function addDotAt(cx, cy, free) {
        let [x, y] = toWorld(cx, cy);
        if (!free) { x = snap(x); y = snap(y); }
        const n = LINKS.nearest(SH.l.id, { x, y });
        if (!n) return;
        writeShape(addDot(storedShape(), n.segment, { x, y }, LINKS.ends(SH.l.id)));
        d.save();
        d.shapeSet?.({ seg: null, dot: n.segment }, true);
    }

    // ---- input (canvas-input.js, with canvas-mouse.js and canvas-touch.js)
    const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); const v = camera(); return [(cx - r.left - v.tx) / v.scale, (cy - r.top - v.ty) / v.scale]; };
    // The camera moves at most once per frame (a phone sends pointer moves faster than it draws), and while a finger
    // pans or pinches, the world is its own GPU layer, so moving it doesn't paint the cards again. The layer is let go
    // at the end, which draws the text sharp at the new zoom. `off`: let it go that many ms later (the wheel).
    let viewRaf = 0;
    const viewLater = () => { if (!viewRaf) viewRaf = requestAnimationFrame(() => { viewRaf = 0; applyView(); }); };
    let gestureTimer = null;
    const gesture = (on, off = 0) => {
        clearTimeout(gestureTimer);
        if (on) { vp.classList.add('gesture'); if (off) gestureTimer = setTimeout(() => gesture(false), off); } else { if (viewRaf) { cancelAnimationFrame(viewRaf); viewRaf = 0; applyView(); } vp.classList.remove('gesture'); }
    };
    /**
     * Lasso to make a pack (desktop, AFTER_V1): after a box select, a small box under it asks for a pack name.
     * Existing packs are offered as you type, so `town/` lists the packs inside town. Enter packs the cards;
     * Esc or a click elsewhere leaves the selection as it is.
     */
    /** After a long press let go on empty canvas: a "Place an entry here" button at the spot; a tap elsewhere drops it. */
    function placeOffer(at, then = p => d.holdEmpty?.(p)) {
        vp.querySelector('.placeoffer')?.remove();
        const r = vp.getBoundingClientRect();
        const b = el('button', 'placeoffer');
        b.type = 'button';
        b.innerHTML = ic('plus', 's');
        b.append('Place an entry here');
        Object.assign(b.style, { left: `${Math.min(Math.max(at.x - r.left, 90), r.width - 90)}px`, top: `${at.y - r.top}px` });
        const drop = () => { b.remove(); vp.removeEventListener('pointerdown', away, true); };
        const away = ev => { if (!b.contains(ev.target)) drop(); };
        b.addEventListener('click', () => { drop(); then(pointAt(at.x, at.y)); });
        vp.append(b);
        setTimeout(() => vp.addEventListener('pointerdown', away, true), 0);
    }
    /** P with several cards picked (desktop): the pack-name box under them, as after a phone's lasso. */
    function packPrompt() {
        const rs = [...picked].map(k => CV?.R.get(k)).filter(r => r && !r.pack);
        const v = camera();
        if (!rs.length || !v) return false;
        const x0 = Math.min(...rs.map(r => r.x));
        const y1 = Math.max(...rs.map(r => r.y + r.h));
        lassoPrompt(rs.map(r => r.key), x0 * v.scale + v.tx, y1 * v.scale + v.ty);
        return true;
    }
    function lassoPrompt(keys, x, y) {
        vp.querySelector('.lasso')?.remove();
        const uids = d.lasso?.entries(keys) ?? [];
        if (!uids.length) return;
        const box = el('div', 'lasso');
        const list = el('datalist');
        list.id = `wih-lasso-${Date.now()}`;
        for (const p of d.lasso.packs()) { const o = el('option'); o.value = p; list.append(o); }
        const input = el('input');
        input.placeholder = `Pack ${uids.length === 1 ? 'it' : `these ${uids.length}`}: name, then Enter`;
        input.setAttribute('aria-label', 'Pack name');
        input.dataset.ownEscape = '1'; // Esc closes this box, not a step of Back
        input.setAttribute('list', list.id);
        box.append(el('span', 'lh', '#'), input, list);
        // Unpack (#24): takes the picked entries out of every pack they are in.
        if (d.lasso.packed?.(uids)) {
            const un = el('button', 'lun', 'Unpack');
            un.type = 'button';
            un.addEventListener('click', () => { done(); d.lasso.unpack(uids); });
            box.append(un);
        }
        const r = vp.getBoundingClientRect();
        box.style.left = `${Math.max(8, Math.min(x, r.width - 300))}px`;
        box.style.top = `${Math.min(y + 8, r.height - 44)}px`;
        vp.append(box);
        const done = () => { box.remove(); document.removeEventListener('pointerdown', away, true); };
        const away = ev => { if (!ev.composedPath().includes(box)) done(); };
        input.addEventListener('keydown', ev => {
            ev.stopPropagation();
            if (ev.key === 'Escape') { ev.preventDefault(); done(); }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                const name = input.value.trim().replace(/^#/, '').replace(/\s+/g, '-').replace(/\/+$/, '');
                if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(name)) { box.classList.add('bad'); return; }
                done();
                d.lasso.pack(uids, name);
            }
        });
        input.addEventListener('input', () => box.classList.remove('bad'));
        for (const t of ['pointerdown', 'wheel']) box.addEventListener(t, ev => ev.stopPropagation());
        setTimeout(() => { document.addEventListener('pointerdown', away, true); input.focus(); }, 0);
    }

    /** Desktop selection; `quiet` leaves telling the app to the tap that follows. */
    function setPicked(next, quiet = false) {
        picked = next;
        for (const n of world.querySelectorAll('.card[data-id]')) n.classList.toggle('picked', picked.has(n.dataset.id));
        if (!quiet) d.onPick?.([...picked]);
    }
    // ---- desktop hover: handles under a card at once, its links bright after 350ms (LAYOUT "Canvas: mouse")
    let hoverKey = null;
    let focusKey = null;
    function showHandles(key) {
        world.querySelector('.hhandles')?.remove();
        const r = CV?.R.get(key);
        const e = CV?.m.byId(key);
        if (!r || !e || OV) return;
        const box = el('div', 'hhandles');
        // Under the card; a masked card's ‹ › control sits there already, so the handles go under it (#28).
        const below = r.nav && !r.nav.v ? r.nav.y + r.nav.h + 2 : r.y + r.h + 4;
        Object.assign(box.style, { left: `${r.x + r.w / 2}px`, top: `${below}px` });
        const kinds = e.greeting || e.moment ? [['open', 'Opens: drag onto the card this one opens'], ['close', 'Closes: drag onto the card this one closes']]
            : [['open', 'Opens: drag onto the card this one opens'], ['close', 'Closes: drag onto the card this one closes'], ['ride', 'Glue: drag onto the card that rides along with this one']];
        for (const [k, label] of kinds) {
            const h = el('i', `hh ${k}`);
            h.dataset.handle = key;
            h.dataset.kind = k;
            h.title = label;
            box.append(h);
        }
        // The card's menu (the right button only moves the view): Menu key or Shift F10 for a selected card too.
        const more = el('i', 'hh hmore', '⋯');
        more.dataset.more = key;
        more.title = 'Card menu (Shift F10)';
        more.setAttribute('aria-label', 'Card menu');
        box.append(more);
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
    /** Phones have no hover: the card whose inspector is open is the focused one, and the rest dims as on desktop. */
    function phoneFocus() {
        if (d.desk) return;
        const f = d.focused?.() ?? null;
        if (f && CV?.R.has(f) && !OV) applyFocus(f);
        else if (focusKey) clearFocus();
    }
    function clearFocus() {
        focusKey = null;
        vp.classList.remove('focusdim');
        for (const n of world.querySelectorAll('.lit')) n.classList.remove('lit');
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

    /** A tap on `t`; `e` gives the point, so a piece armed on the bar lands where the tap was. */
    function tapAt(t, e = null) {
        if (d.tapTarget?.(hitOf(t), e ? pointAt(e.clientX, e.clientY) : null)) return;
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
        // A pack's name on its frame renames it (#21); the rest of the frame opens the pack.
        const pn = t.closest?.('.packframe .pn');
        if (pn && d.renamePack) { d.renamePack(pn.parentElement.dataset.pack); return; }
        const pf = t.closest?.('[data-pack]');
        if (pf) { d.pack(pf.dataset.pack); return; }
        if (!d.desk && picked.size) setPicked(new Set(), true); // a tap on empty canvas lets go of a box selection
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

    // The input (canvas-input.js) reaches the canvas only through this.
    wireInput({
        vp, world, d, camera, saveCamera, applyView, viewLater, gesture, memory, toWorld, zoomAt, render, setPicked,
        drawOverlay, dotTo, addDotAt, removeShapeDot, hideHandles, showHandles, applyFocus, clearFocus, lineUnder, hitAt,
        markTarget, tapAt, pointAt, placeOffer, lassoPrompt,
        cancelLive: () => { if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; } },
        /** The part of the shaped line nearest a screen point. */
        partAt: (cx, cy) => { const [x, y] = toWorld(cx, cy); return LINKS.nearest(SH.l.id, { x, y })?.segment; },
        get CV() { return CV; }, get OV() { return OV; }, get SH() { return SH; }, get picked() { return picked; },
        get drawn() { return drawn; }, get moving() { return moving; }, set moving(v) { moving = v; },
        get hoverKey() { return hoverKey; }, set hoverKey(v) { hoverKey = v; }, get focusKey() { return focusKey; },
    });

    return {
        render, fit, centerOn, reveal, tidy, flip, pointAt, overlay, looseStart, hitAt, markTarget, zoomAt, zoomTo, packPrompt,
        shapeState, patchShape, removeShapeDot, resetShape, refreshShaping: () => drawShaping(),
        picked: () => [...picked], setPicked, phoneFocus,
        get view() { return CV; }, get camera() { return camera(); },
    };
}
