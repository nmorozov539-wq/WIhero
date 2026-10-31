// The graph stage: cards in a world layer moved by one CSS transform (pan and zoom), links in one SVG layer.
// Pure layout comes from layout.js; this only draws and handles the pointer.
import { el } from './panel.js';
import { COLORS } from './bulk.js';

const SVG = 'http://www.w3.org/2000/svg';
/** Above this many cards, only those near the visible part of the world are in the page. */
export const CULL_ABOVE = 300;
const CULL_MARGIN = 300;
const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
};

/** How each link type is drawn: CSS class (colour, dashes) and whether it ends in an arrow. */
const LINK_STYLE = {
    gate: { arrow: true }, labelSource: { arrow: true }, switch: { arrow: true }, gatesFor: { arrow: true },
    closes: { arrow: true }, endsGlue: { arrow: true }, maskGate: { arrow: true }, member: { arrow: false }, mask: { arrow: false },
};
export const LINK_NAMES = {
    gate: 'gate', labelSource: 'gate on a label', switch: 'switch path', gatesFor: 'gates for',
    closes: 'closes', endsGlue: 'ends glue', member: 'has label', mask: 'mask', maskGate: 'mask gate',
};

/**
 * @param {HTMLElement} stage The element the graph fills.
 * @param {{ onSelect: (key: string|null) => void, onOpen: (key: string) => void, onHover: (key: string|null, card: HTMLElement) => void,
 *   onMove?: (key: string, x: number, y: number) => void, onBox?: (kind: string, id: string, rect: object) => void,
 *   onLink?: (from: string, to: string|null, x: number, y: number) => void, onNote?: (id: string, text: string) => void,
 *   onArea?: (id: string, name: string) => void, onRemove?: (kind: string, id: string) => void }} on
 *   The canvas callbacks are only used in canvas mode.
 */
export function createGraphView(stage, on) {
    const world = el('div', { class: 'wihero-world' });
    const links = svg('svg', { class: 'wihero-links' });
    const defs = svg('defs');
    for (const type of Object.keys(LINK_STYLE)) {
        const marker = svg('marker', { id: `wihero-head-${type}`, orient: 'auto', markerWidth: '8', markerHeight: '8', refX: '6', refY: '4' });
        marker.append(svg('path', { d: 'M0 0 L7 4 L0 8 Z', class: `wihero-head wihero-link-${type}` }));
        defs.append(marker);
    }
    links.append(defs);
    world.append(links);
    stage.replaceChildren(world);

    let view = { x: 40, y: 40, k: 1 };
    let size = { width: 0, height: 0 };
    const cards = new Map();
    const boxes = [];
    /** Pointer drags in progress: the workspace holds off re-rendering until they end. */
    let dragging = 0;
    /** What's drawn now, so a drag can re-route the links. */
    let current = { graph: null, placed: null, canvas: false };
    /** A point of the stage (client coordinates) in world coordinates. */
    const toWorld = (cx, cy) => {
        const r = stage.getBoundingClientRect();
        return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    };
    let culling = null;
    let cullFrame = 0;
    const apply = () => {
        world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
        if (culling && !cullFrame) cullFrame = requestAnimationFrame(() => { cullFrame = 0; cull(); });
    };

    // Pan by dragging the background, zoom with the wheel around the pointer.
    let drag = null;
    // Two fingers on the background pinch to zoom.
    const touches = new Map();
    let pinch = null;
    const spread = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    stage.addEventListener('pointerdown', e => {
        if (e.target.closest('.wihero-card, .wihero-box, .wihero-zoom') || e.button !== 0) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        stage.setPointerCapture(e.pointerId);
        if (touches.size === 2) { drag = null; pinch = spread(); return; }
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    });
    stage.addEventListener('pointercancel', e => { touches.delete(e.pointerId); pinch = null; drag = null; });
    stage.addEventListener('pointermove', e => {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size === 2) {
            const now = spread();
            const r = stage.getBoundingClientRect();
            zoomAt(now.x - r.left, now.y - r.top, now.d / Math.max(1, pinch.d));
            pinch = now;
            return;
        }
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
        apply();
    });
    stage.addEventListener('pointerup', e => {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (drag && !drag.moved) on.onSelect(null);
        drag = null;
    });
    stage.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    function zoomAt(px, py, factor) {
        const k = Math.min(2, Math.max(0.2, view.k * factor));
        view.x = px - (px - view.x) * (k / view.k);
        view.y = py - (py - view.y) * (k / view.k);
        view.k = k;
        apply();
    }

    /** Zooms around the middle of the stage (the zoom buttons). */
    function zoomBy(factor) {
        zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, factor);
    }

    /** Fits the whole graph in the stage (never above 100%). */
    function fit() {
        const w = stage.clientWidth || 800;
        const h = stage.clientHeight || 600;
        const k = Math.min(1, (w - 80) / Math.max(1, size.width), (h - 80) / Math.max(1, size.height));
        view = { k: Math.max(0.2, k), x: 0, y: 0 };
        view.x = (w - size.width * view.k) / 2;
        view.y = Math.max(40, (h - size.height * view.k) / 2);
        apply();
    }

    /** Pans so a node is in the middle. */
    function center(key) {
        const p = current.placed?.pos.get(key);
        if (!p) return;
        view.x = stage.clientWidth / 2 - (p.x + p.w / 2) * view.k;
        view.y = stage.clientHeight / 2 - (p.y + p.h / 2) * view.k;
        apply();
    }

    function cardFor(node, p, look) {
        const card = el('div', { class: `wihero-card wihero-card-${node.kind} ${look.className ?? ''}`, 'data-key': node.key, tabindex: '0' });
        card._pos = p;
        Object.assign(card.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
        if (node.color && COLORS[node.color]) card.style.setProperty('--wihero-color', COLORS[node.color]);
        card.append(...look.content);
        if (current.canvas && (node.kind === 'entry' || node.kind === 'group')) {
            if (node.kind === 'entry') card.append(handle(node.key));
            draggable(card, card, p, () => drawLinks(), () => on.onMove?.(node.key, p.x, p.y));
        }
        card.addEventListener('click', e => { e.stopPropagation(); if (!card._dragged) on.onSelect(node.key); card._dragged = false; });
        card.addEventListener('dblclick', e => { e.stopPropagation(); on.onOpen(node.key); });
        card.addEventListener('keydown', e => { if (e.key === 'Enter') on.onSelect(node.key); });
        card.addEventListener('pointerenter', () => on.onHover(node.key, card));
        card.addEventListener('pointerleave', () => on.onHover(null, card));
        return card;
    }

    /**
     * Makes an element drag `rect` (and itself) around the world. `grip` is where the drag starts.
     * Calls `moving` on every step and `done` once at the end if it moved.
     */
    function draggable(element, grip, rect, moving, done, { resize = false } = {}) {
        grip.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('.wihero-handle, textarea, input, button')) return;
            e.stopPropagation();
            const start = toWorld(e.clientX, e.clientY);
            const from = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
            let moved = false;
            dragging++;
            grip.setPointerCapture(e.pointerId);
            const move = ev => {
                const p = toWorld(ev.clientX, ev.clientY);
                const dx = Math.round(p.x - start.x);
                const dy = Math.round(p.y - start.y);
                if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
                moved = true;
                if (resize) { rect.w = Math.max(120, from.w + dx); rect.h = Math.max(60, from.h + dy); }
                else { rect.x = from.x + dx; rect.y = from.y + dy; }
                Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
                moving();
            };
            const up = () => {
                dragging--;
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', up);
                if (moved) { element._dragged = true; done(); }
            };
            grip.addEventListener('pointermove', move);
            grip.addEventListener('pointerup', up);
        });
    }

    /** The dot on a card's right edge: drag it onto another card or a label box to draw a link. */
    function handle(key) {
        const dot = el('button', { type: 'button', class: 'wihero-handle', 'aria-label': 'Draw a link from here', title: 'Drag onto another entry or a label box to link' });
        dot.addEventListener('pointerdown', e => {
            e.stopPropagation();
            e.preventDefault();
            dot.setPointerCapture(e.pointerId);
            dragging++;
            const a = current.placed.pos.get(key);
            const line = svg('path', { class: 'wihero-link wihero-link-drawing' });
            links.append(line);
            const move = ev => {
                const p = toWorld(ev.clientX, ev.clientY);
                line.setAttribute('d', `M ${a.x + a.w} ${a.y + a.h / 2} L ${p.x} ${p.y}`);
            };
            const up = ev => {
                dragging--;
                dot.removeEventListener('pointermove', move);
                dot.removeEventListener('pointerup', up);
                line.remove();
                const target = document.elementsFromPoint(ev.clientX, ev.clientY).map(x => x.closest?.('[data-key]')).find(x => x && x.dataset.key !== key);
                on.onLink?.(key, target?.dataset.key ?? null, ev.clientX, ev.clientY);
            };
            dot.addEventListener('pointermove', move);
            dot.addEventListener('pointerup', up);
        });
        return dot;
    }

    /** A label box, a group area or a note on the canvas: behind the cards, moved by its title, resized by its corner. */
    function boxFor(kind, id, rect, { title, text, key } = {}) {
        const box = el('div', { class: `wihero-box wihero-box-${kind}`, ...(key && { 'data-key': key }), 'data-box': id });
        Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
        const head = el('div', { class: 'wihero-box-head' });
        const done = () => on.onBox?.(kind, id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        if (kind === 'area') {
            const name = el('input', { type: 'text', class: 'wihero-box-name', value: title, 'aria-label': 'Area name' });
            name.addEventListener('change', () => on.onArea?.(id, name.value));
            head.append(name);
        } else {
            head.append(el('b', {}, title));
        }
        if (kind === 'label') head.append(handle(key));
        if (kind !== 'label') {
            const x = el('button', { type: 'button', class: 'wihero-box-remove', 'aria-label': `Remove this ${kind}` }, '×');
            x.addEventListener('click', e => { e.stopPropagation(); on.onRemove?.(kind, id); });
            head.append(x);
        }
        box.append(head);
        if (kind === 'note') {
            const area = el('textarea', { class: 'wihero-box-text', 'aria-label': 'Note' });
            area.value = text ?? '';
            area.addEventListener('change', () => on.onNote?.(id, area.value));
            box.append(area);
        }
        const corner = el('div', { class: 'wihero-box-corner', 'aria-hidden': 'true' });
        box.append(corner);
        draggable(box, head, rect, () => drawLinks(), done);
        draggable(box, corner, rect, () => drawLinks(), done, { resize: true });
        return box;
    }

    /** Path from one box to another: out of the right side, into the left, as a gentle curve. Pills are entered from the left too. */
    function route(a, b, type) {
        if (type === 'mask') {
            const x = a.x + 8;
            return `M ${x} ${a.y + a.h} L ${x} ${b.y + b.h / 2} L ${b.x} ${b.y + b.h / 2}`;
        }
        const x1 = a.x + a.w;
        const y1 = a.y + a.h / 2;
        const x2 = b.x - 2;
        const y2 = b.y + b.h / 2;
        const bend = Math.max(40, Math.abs(x2 - x1) / 2);
        return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    }

    /**
     * Draws a graph.
     * @param {{ nodes: Map, links: object[] }} graph
     * @param {{ pos: Map, width: number, height: number }} placed layout() of it
     * @param {(node: object) => { className?: string, content: Node[] }} look How a card looks.
     */
    function render(graph, placed, look, { keepView = false, canvas = null } = {}) {
        size = { width: placed.width, height: placed.height };
        current = { graph, placed, canvas: !!canvas };
        for (const card of cards.values()) card.remove();
        cards.clear();
        for (const b of boxes.splice(0)) b.remove();
        Object.assign(links.style, { width: `${placed.width + 80}px`, height: `${placed.height + 80}px` });
        if (canvas) {
            for (const a of canvas.areas) boxes.push(boxFor('area', a.id, a, { title: a.name }));
            for (const n of graph.nodes.values()) {
                const p = placed.pos.get(n.key);
                if (n.kind === 'label' && p?.box) boxes.push(boxFor('label', n.key, p, { title: n.title, key: n.key }));
            }
            for (const note of canvas.notes) boxes.push(boxFor('note', note.id, note, { title: 'Note', text: note.text }));
            world.prepend(...boxes);
            world.prepend(links);
        }
        drawLinks();
        const drawable = [...graph.nodes.values()].filter(n => placed.pos.get(n.key) && !placed.pos.get(n.key).box);
        culling = drawable.length > CULL_ABOVE ? { nodes: drawable, look } : null;
        if (!keepView) fit();
        if (culling) cull();
        else for (const node of drawable) addCard(node, look);
    }

    function addCard(node, look) {
        const card = cardFor(node, current.placed.pos.get(node.key), look(node));
        if (selected === node.key) card.classList.add('wihero-selected');
        cards.set(node.key, card);
        world.append(card);
    }

    /** Keeps only the cards near the visible part of the world in the page (big books). */
    function cull() {
        if (!culling) return;
        const w = stage.clientWidth || 800;
        const h = stage.clientHeight || 600;
        const area = {
            x: -view.x / view.k - CULL_MARGIN, y: -view.y / view.k - CULL_MARGIN,
            r: (w - view.x) / view.k + CULL_MARGIN, b: (h - view.y) / view.k + CULL_MARGIN,
        };
        for (const node of culling.nodes) {
            const p = current.placed.pos.get(node.key);
            const near = p.x + p.w >= area.x && p.x <= area.r && p.y + p.h >= area.y && p.y <= area.b;
            if (near && !cards.has(node.key)) addCard(node, culling.look);
            else if (!near && cards.has(node.key) && node.key !== selected) { cards.get(node.key).remove(); cards.delete(node.key); }
        }
    }

    /** Draws every link from the current positions (again after a drag). */
    function drawLinks() {
        const { graph, placed, canvas } = current;
        links.replaceChildren(defs);
        for (const l of graph.links) {
            // On the canvas a label is a box around its entries, so membership needs no line.
            if (canvas && l.type === 'member') continue;
            const a = placed.pos.get(l.from);
            const b = placed.pos.get(l.to);
            if (!a || !b) continue;
            const path = svg('path', { d: route(a, b, l.type), class: `wihero-link wihero-link-${l.type}`, 'data-from': l.from, 'data-to': l.to, 'data-type': l.type });
            if (LINK_STYLE[l.type]?.arrow) path.setAttribute('marker-end', `url(#wihero-head-${l.type})`);
            path.append(svg('title'));
            path.lastChild.textContent = LINK_NAMES[l.type];
            links.append(path);
        }
        // Mask pills follow their entry.
        if (canvas) for (const n of graph.nodes.values()) {
            if (n.kind !== 'mask') continue;
            const o = placed.pos.get(n.owner);
            const p = placed.pos.get(n.key);
            const card = cards.get(n.key);
            if (!o || !p || !card) continue;
            const pills = [...graph.nodes.values()].filter(m => m.kind === 'mask' && m.owner === n.owner);
            const i = pills.indexOf(n);
            p.x = o.x + 16;
            p.y = o.y + o.h + 4 + i * 32;
            Object.assign(card.style, { left: `${p.x}px`, top: `${p.y}px` });
        }
    }

    let selected = null;
    /** Marks the selected card and dims what isn't linked to it. */
    function select(key) {
        selected = key;
        const near = new Set();
        if (key) for (const p of links.querySelectorAll('.wihero-link')) {
            if (p.dataset.from === key || p.dataset.to === key) { near.add(p.dataset.from); near.add(p.dataset.to); p.classList.add('wihero-link-near'); }
            else p.classList.remove('wihero-link-near');
        } else for (const p of links.querySelectorAll('.wihero-link-near')) p.classList.remove('wihero-link-near');
        for (const [k, card] of cards) {
            card.classList.toggle('wihero-selected', k === key);
            card.classList.toggle('wihero-near', !!key && near.has(k) && k !== key);
        }
    }

    return { render, select, fit, center, zoomAt, zoomBy, toWorld, busy: () => dragging > 0, get view() { return view; }, cards, get culling() { return !!culling; } };
}
