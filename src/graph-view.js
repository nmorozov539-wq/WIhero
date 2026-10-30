// The graph stage: cards in a world layer moved by one CSS transform (pan and zoom), links in one SVG layer.
// Pure layout comes from layout.js; this only draws and handles the pointer.
import { el } from './panel.js';
import { COLORS } from './bulk.js';

const SVG = 'http://www.w3.org/2000/svg';
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
 * @param {{ onSelect: (key: string|null) => void, onOpen: (key: string) => void, onHover: (key: string|null, card: HTMLElement) => void }} on
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
    const apply = () => { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; };

    // Pan by dragging the background, zoom with the wheel around the pointer.
    let drag = null;
    stage.addEventListener('pointerdown', e => {
        if (e.target.closest('.wihero-card') || e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
        apply();
    });
    stage.addEventListener('pointerup', () => {
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
        const card = cards.get(key);
        if (!card) return;
        const p = card._pos;
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
        card.addEventListener('click', e => { e.stopPropagation(); on.onSelect(node.key); });
        card.addEventListener('dblclick', e => { e.stopPropagation(); on.onOpen(node.key); });
        card.addEventListener('keydown', e => { if (e.key === 'Enter') on.onSelect(node.key); });
        card.addEventListener('pointerenter', () => on.onHover(node.key, card));
        card.addEventListener('pointerleave', () => on.onHover(null, card));
        return card;
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
    function render(graph, placed, look, { keepView = false } = {}) {
        size = { width: placed.width, height: placed.height };
        for (const card of cards.values()) card.remove();
        cards.clear();
        links.replaceChildren(defs);
        Object.assign(links.style, { width: `${placed.width + 80}px`, height: `${placed.height + 80}px` });
        for (const l of graph.links) {
            const a = placed.pos.get(l.from);
            const b = placed.pos.get(l.to);
            if (!a || !b) continue;
            const path = svg('path', { d: route(a, b, l.type), class: `wihero-link wihero-link-${l.type}`, 'data-from': l.from, 'data-to': l.to, 'data-type': l.type });
            if (LINK_STYLE[l.type]?.arrow) path.setAttribute('marker-end', `url(#wihero-head-${l.type})`);
            path.append(svg('title'));
            path.lastChild.textContent = LINK_NAMES[l.type];
            links.append(path);
        }
        for (const node of graph.nodes.values()) {
            const p = placed.pos.get(node.key);
            if (!p) continue;
            const card = cardFor(node, p, look(node));
            cards.set(node.key, card);
            world.append(card);
        }
        if (!keepView) fit();
    }

    /** Marks the selected card and dims what isn't linked to it. */
    function select(key) {
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

    return { render, select, fit, center, zoomAt, get view() { return view; }, cards };
}
