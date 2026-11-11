// The Hero canvas's input, shared by every pointer (LAYOUT "Canvas tab" and "Canvas: mouse"): what a press grabs
// (a card, a dot of the shaped link, a port, a link from a handle, a loose end, a pack), dragging it with edge scroll,
// the link magnet, and what a release does (drops, a box's selection, taps). What only a mouse does lives in
// canvas-mouse.js (right-button camera, box select, middle and Space pan, wheel, hover); what only fingers do in
// canvas-touch.js (one-finger pan, pinch, hand-off, two-finger tap, long press). Rendering stays in canvas.js.
import { CH, CW, PORT, SIDE_NAME, snap } from './canvas-graph.js';
import { el } from './dom.js';
import { mouseInput } from './canvas-mouse.js';
import { touchInput } from './canvas-touch.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, at, style) => { const n = document.createElementNS(NS, tag); for (const k in at) n.setAttribute(k, at[k]); if (style) n.setAttribute('style', style); return n; };

/** How near a card (screen pixels) a dropped link or loose end still lands on it: wider for a finger. */
export const MAGNET = { mouse: 24, touch: 32 };

/** The card nearest a canvas point within `reach` (canvas units), not counting `except`; for the link magnet. */
export function nearCard(R, x, y, reach, except = null) {
    let card = null;
    let pack = null;
    let cd = reach;
    let pd = reach;
    for (const r of R.values()) {
        if (r.key === except) continue;
        const dist = Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
        if (r.pack) { if (dist <= pd) { pack = r.key; pd = dist; } } else if (dist <= cd) { card = r.key; cd = dist; }
    }
    return card ?? pack;
}

/** The last tap on a shaped link's dot (kept across draws: a tap draws the app again), for a double tap. */
let lastDotTap = null;

/**
 * Wires the canvas's pointer input. `C` is the canvas (canvas.js): its view, camera, overlay, shaping and taps.
 * A finger follows the phone's rules, as does any pointer on the phone layout; a mouse or pen on the desktop layout
 * follows the desktop's (LAYOUT "Canvas: mouse"), so a touchscreen laptop still pans with a finger.
 */
export function wireInput(C) {
    const { vp, world, d } = C;
    /** The input's state: the pointers down, what the press grabbed (`mode`, `drag`), where it started, if it moved. */
    const I = { pts: new Map(), mode: null, start: null, moved: false, drag: null, holdTimer: null };
    I.reset = () => { I.mode = null; I.start = null; I.drag = null; };
    I.magnetAt = (cx, cy, kind) => {
        const CV = C.CV;
        if (!CV) return null;
        const [x, y] = C.toWorld(cx, cy);
        return nearCard(CV.R, x, y, (kind === 'touch' ? MAGNET.touch : MAGNET.mouse) / (C.camera()?.scale || 1));
    };
    I.grabCard = (id, e, group = null) => {
        const [wx, wy] = C.toWorld(e.clientX, e.clientY);
        const mem = C.memory().cards;
        const c = mem[id];
        I.drag = { id, dx: wx - c.x, dy: wy - c.y, group, at: group ? Object.fromEntries(group.map(k => [k, { x: mem[k].x, y: mem[k].y }])) : null };
        I.mode = 'card';
    };
    I.startBox = (x0, y0, extra = {}) => { I.mode = 'box'; I.drag = { x0, y0, box: null, ...extra }; };

    const mouse = mouseInput(C, I);
    const touch = touchInput(C, I);
    const rules = e => (e.pointerType !== 'touch' && d.desk ? mouse : touch);

    // ---- a card drag moves the card's own nodes (the card, its mask layers, ports, junctions and pills) and swaps its
    // links to other cards for straight guide lines, once per frame. The canvas is drawn again once, on the drop.
    let dragRaf = 0;
    let DR = null;
    function dragSetup(id) {
        // The card itself, or (desktop) every selected card when it is one of them.
        const group = new Set(I.drag?.group ?? [id]);
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
        const r0 = C.CV.R.get(id);
        DR = { id, drawn: C.drawn, own, guide, from: r0 ? [r0.x, r0.y] : null, others: [...others.values()].map(([a, k]) => [a, C.CV.R.get(k)]).filter(([, r]) => r),
            paths: [] };
        for (let i = 0; i < DR.others.length; i++) DR.paths.push(guide.appendChild(sv('path', {}, 'stroke:var(--muted);stroke-dasharray:4 5;opacity:.7')));
    }
    function dragFrame() {
        dragRaf = 0;
        const moving = C.moving;
        if (!moving) return;
        if (!DR || DR.id !== moving || DR.drawn !== C.drawn) dragSetup(moving);
        const c = C.memory().cards[moving];
        if (!DR.from || !c) return;
        const dx = c.x - DR.from[0];
        const dy = c.y - DR.from[1];
        for (const n of DR.own) n.style.translate = `${dx}px ${dy}px`;
        DR.others.forEach(([a, r], i) => {
            const q = C.memory().cards[a];
            if (!q) return;
            DR.paths[i].setAttribute('d', `M${q.x + CW / 2},${q.y + CH / 2} L${r.x + r.w / 2},${r.y + r.h / 2}`);
        });
    }
    const later = () => { if (!dragRaf) dragRaf = requestAnimationFrame(dragFrame); };

    /** A card or dot drag at a screen point (the pointer, or the same point again while the view edge-scrolls). */
    function dragTo(at) {
        const drag = I.drag;
        if (I.mode === 'dot') { C.dotTo(drag, at.x, at.y, at.alt); return; }
        const [wx, wy] = C.toWorld(at.x, at.y);
        C.moving = drag.id;
        C.hideHandles();
        const mem = C.memory().cards;
        const nx = snap(wx - drag.dx);
        const ny = snap(wy - drag.dy);
        if (drag.group) {
            const dx = nx - drag.at[drag.id].x;
            const dy = ny - drag.at[drag.id].y;
            for (const k of drag.group) Object.assign(mem[k], { x: drag.at[k].x + dx, y: drag.at[k].y + dy });
        } else Object.assign(mem[drag.id], { x: nx, y: ny });
        later();
    }
    // Edge-scrolling: a card or dot held within 32px of the view's edge moves the camera, faster nearer the edge.
    let edgeRaf = 0;
    let edgeAt = null;
    function edgeTick() {
        edgeRaf = 0;
        if (!edgeAt || !I.moved || (I.mode !== 'card' && I.mode !== 'dot')) return;
        const r = vp.getBoundingClientRect();
        const EDGE = 32;
        const push = (p, lo, hi) => Math.max(-1, Math.min(1, p < lo + EDGE ? (lo + EDGE - p) / EDGE : p > hi - EDGE ? (hi - EDGE - p) / EDGE : 0));
        const fx = push(edgeAt.x, r.left, r.right);
        const fy = push(edgeAt.y, r.top, r.bottom);
        if (!fx && !fy) return;
        const v = C.camera();
        v.tx += fx * 14;
        v.ty += fy * 14;
        C.applyView();
        dragTo(edgeAt);
        edgeRaf = requestAnimationFrame(edgeTick);
    }
    function drawLinkGuide() {
        world.querySelector('.linkguide')?.remove();
        const drag = I.drag;
        const r = C.CV?.R.get(drag.from);
        if (!r || !drag.to) return;
        const col = { open: 'var(--p-open)', close: 'var(--p-close)', ride: 'var(--p-glue)' }[drag.kind];
        const line = sv('svg', { class: 'lk linkguide', width: 1, height: 1 });
        line.append(sv('path', { d: `M${r.x + r.w / 2},${r.y + r.h / 2} L${drag.to[0]},${drag.to[1]}` }, `stroke:${col};stroke-dasharray:6 5`));
        world.append(line);
    }
    const toWorldLocal = (x, y) => { const v = C.camera(); return [(x - v.tx) / v.scale, (y - v.ty) / v.scale]; };

    /**
     * What a press grabs, the same for every pointer: a dot of the shaped link, a link from a hover handle or knob
     * (desktop), a loose end, a card (a mouse: anywhere on it; a finger: by its grip), a pack (a mouse: its frame; a
     * finger: its name), or a port. `desk`: the desktop's mouse rules. False when it grabbed nothing.
     */
    function grab(e, desk) {
        const t = e.target;
        const OV = C.OV;
        const picked = C.picked;
        const gr = t.closest?.('[data-grip]');
        const port = t.closest?.('[data-port]');
        const card = desk && !port && !t.closest?.('[data-flip], .lockp, .junc') ? t.closest?.('.card[data-id]') : null;
        const handle = desk ? t.closest?.('[data-handle]') : null;
        const sh = C.SH ? t.closest?.('[data-dot], [data-ghost]') : null;
        if (sh) {
            // A dot of the shaped link, or a ghost dot (dragging it makes a new dot; a tap picks its part).
            I.mode = 'dot';
            I.drag = { dot: sh.dataset.dot != null ? Number(sh.dataset.dot) : null, ghost: sh.dataset.ghost != null ? Number(sh.dataset.ghost) : null };
            I.drag.tapped = I.drag.dot ?? I.drag.ghost;
        } else if (handle || (desk && port && PORT[port.dataset.port.split('|')[1]]?.dir === 'out' && !OV)) {
            // Desktop: drag from a hover handle or a knob onto another card makes a link (LAYOUT "Canvas: mouse").
            const [key, kindOrPort] = handle ? [handle.dataset.handle, handle.dataset.kind] : port.dataset.port.split('|');
            const kind = handle ? kindOrPort : { gout: 'open', cout: 'close', glout: 'ride' }[kindOrPort];
            I.mode = 'link';
            I.drag = { from: key, kind, port: port?.dataset.port };
        } else if (t.closest?.('.loosend') && OV?.loose) {
            I.mode = 'loose';
            I.drag = { at0: [...OV.loose.at] };
        } else if (card || gr) {
            const id = (card ?? gr).dataset.id ?? gr.dataset.grip;
            const group = picked.has(id) && picked.size > 1 ? [...picked].filter(k => C.memory().cards[k]) : null;
            I.grabCard(id, e, group);
        } else if (!OV && !port && t.closest?.(desk ? '.packframe[data-pack]' : '.packframe[data-pack] .pn') && !(desk && (e.shiftKey || e.ctrlKey || e.metaKey))) {
            // A pack frame moves the whole pack (#22): by its label or empty area with a mouse, by its label on a
            // phone, where the rest of the frame pans like the canvas around it. A tap still opens the pack.
            const name = t.closest('.packframe').dataset.pack;
            const group = (C.CV.R.get(`pack:${name}`)?.members ?? []).filter(k => Number.isFinite(C.memory().cards[k]?.x));
            if (group.length) I.grabCard(group[0], e, group);
            else I.mode = 'pan';
        } else if (port) {
            I.mode = 'port';
            I.drag = { port: port.dataset.port };
        } else return false;
        return true;
    }

    vp.addEventListener('pointerdown', e => {
        if (e.target.closest('.canvas-tools, .panelBtn, .panel, .legend-box, .cvbanner, .placeoffer, .zlabel, .lasso')) return;
        if (!C.camera()) return;
        const R = rules(e);
        if (R.down?.(e)) return; // the pointer's own rules took it (a camera drag, a second finger, a button ignored)
        vp.setPointerCapture?.(e.pointerId);
        I.pts.set(e.pointerId, [e.clientX, e.clientY]);
        I.moved = false;
        I.start = { x: e.clientX, y: e.clientY, tx: C.camera().tx, ty: C.camera().ty, target: C.lineUnder(e.target, e.clientX, e.clientY) };
        clearTimeout(I.holdTimer);
        if (R.press?.(e)) return; // before anything else under it (a mouse's ⋯, Space or the right button)
        if (grab(e, R === mouse)) return;
        R.empty(e); // empty canvas, a line, a pill: a mouse box-selects, a finger pans (or holds)
    });

    vp.addEventListener('pointermove', e => {
        if (!I.pts.has(e.pointerId)) return;
        I.pts.set(e.pointerId, [e.clientX, e.clientY]);
        const R = rules(e);
        if (R.move?.(e)) return; // a pinch
        const { start } = I;
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 7) { I.moved = true; clearTimeout(I.holdTimer); }
        if (!I.moved) return;
        R.drag?.(e); // a long press turning into a box
        const { mode, drag } = I;
        if (mode === 'pan') {
            const v = C.camera();
            v.tx = start.tx + e.clientX - start.x;
            v.ty = start.ty + e.clientY - start.y;
            C.gesture(true);
            C.viewLater();
        } else if (mode === 'card' || mode === 'dot') {
            edgeAt = { x: e.clientX, y: e.clientY, alt: e.altKey };
            dragTo(edgeAt);
            if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeTick);
        } else if (mode === 'link') {
            drag.to = C.toWorld(e.clientX, e.clientY);
            drawLinkGuide();
            const k = C.hitAt(e.clientX, e.clientY)?.card ?? I.magnetAt(e.clientX, e.clientY, e.pointerType);
            C.markTarget(k && k !== drag.from ? { card: k } : null);
        } else if (mode === 'box') {
            const r = vp.getBoundingClientRect();
            if (!drag.box) { drag.box = el('div', 'selbox'); vp.append(drag.box); }
            const x1 = e.clientX - r.left;
            const y1 = e.clientY - r.top;
            Object.assign(drag.box.style, { left: `${Math.min(drag.x0, x1)}px`, top: `${Math.min(drag.y0, y1)}px`, width: `${Math.abs(x1 - drag.x0)}px`, height: `${Math.abs(y1 - drag.y0)}px` });
            drag.x1 = x1;
            drag.y1 = y1;
        } else if (mode === 'port') {
            drag.at = C.toWorld(e.clientX, e.clientY);
            vp.style.cursor = 'crosshair';
        } else if (mode === 'loose') {
            const OV = C.OV;
            OV.loose.at = C.toWorld(e.clientX, e.clientY);
            C.drawOverlay();
            const k = C.hitAt(e.clientX, e.clientY)?.card ?? I.magnetAt(e.clientX, e.clientY, e.pointerType);
            C.markTarget(k && k !== OV.loose.from && !OV.dim?.(k) ? { card: k } : null);
        }
    });

    const end = e => {
        clearTimeout(I.holdTimer);
        if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = 0; }
        const scrolled = edgeAt && I.moved && (I.mode === 'card' || I.mode === 'dot');
        edgeAt = null;
        if (scrolled) C.saveCamera();
        if (!I.pts.has(e.pointerId)) return;
        I.pts.delete(e.pointerId);
        vp.classList.remove('panning');
        const R = rules(e);
        if (R.up?.(e)) return; // a pinch, a two-finger tap, a camera drag, a long press let go, a ⋯
        if (!I.pts.size) C.gesture(false);
        vp.style.cursor = '';
        const { mode, drag, moved, start } = I;
        if (mode === 'pan' && moved) C.saveCamera();
        const up = moved && e.type === 'pointerup';
        if (mode === 'loose') {
            // On a card (or near one: the magnet), it's picked; back on its own card nothing changes; on empty canvas
            // the end parks there, and Place an entry here (a mouse: Add to canvas here at once) offers a new target.
            const OV = C.OV;
            const h = up ? C.hitAt(e.clientX, e.clientY) : null;
            const k = up ? h?.card ?? I.magnetAt(e.clientX, e.clientY, e.pointerType) : null;
            C.markTarget(null);
            I.reset();
            if (k && k === OV?.loose?.from) { OV.loose.at = drag.at0; C.drawOverlay(); return; }
            OV?.onLoose?.(k ? { card: k } : h, OV?.loose?.at);
            if (!k && !h && up && d.looseEmpty) {
                if (R === touch) C.placeOffer({ x: e.clientX, y: e.clientY }, p => d.looseEmpty(p));
                else d.looseEmpty(C.pointAt(e.clientX, e.clientY));
            }
            return;
        }
        if (mode === 'link') {
            // Desktop link drag: on a card (or within the magnet's reach) links to it; let go on its own card it's
            // nothing; on empty canvas, Add to canvas here, and the entry picked arrives already linked.
            world.querySelector('.linkguide')?.remove();
            const h = up ? C.hitAt(e.clientX, e.clientY) : null;
            const k = up ? h?.card ?? I.magnetAt(e.clientX, e.clientY, e.pointerType) : null;
            C.markTarget(null);
            I.reset();
            if (k && k !== drag.from) d.link?.(drag.kind, drag.from, k);
            else if (up && !k && !h) d.linkEmpty?.(drag.kind, drag.from, C.pointAt(e.clientX, e.clientY));
            else if (!moved && drag.port) C.tapAt(e.target, e);
            return;
        }
        if (mode === 'box') {
            drag.box?.remove();
            if (moved || !drag.mouse) {
                if (moved && drag.x1 !== undefined) {
                    const [ax, ay] = toWorldLocal(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
                    const [bx, by] = toWorldLocal(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
                    const inside = [...C.CV.R.values()].filter(r => !r.pack && r.x < bx && r.x + r.w > ax && r.y < by && r.y + r.h > ay).map(r => r.key);
                    C.setPicked(drag.add || e.ctrlKey || e.metaKey ? new Set([...C.picked, ...inside]) : new Set(inside));
                    // A finger's lasso asks for a pack name at once; with a mouse a box only selects, and P asks.
                    if (inside.length && !drag.mouse) C.lassoPrompt([...C.picked], Math.min(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
                }
                I.reset();
                return;
            }
            I.mode = null; // a mouse's click without a drag: a click, below
        }
        if (mode === 'dot') {
            I.reset();
            if (moved) {
                C.cancelLive();
                d.save();
                d.shapeSet?.({ seg: null, dot: drag.dot }, true);
                return;
            }
            if (drag.ghost != null) { d.shapeSet?.({ seg: drag.ghost, dot: null }); return; }
            // A tap picks a dot; a second tap on it soon after takes it away (a double-click, with a mouse).
            const now = performance.now();
            const id = C.SH.l.id;
            if (lastDotTap && lastDotTap.id === id && lastDotTap.i === drag.dot && now - lastDotTap.t < 350) { lastDotTap = null; C.removeShapeDot(drag.dot); return; }
            lastDotTap = { id, i: drag.dot, t: now };
            d.shapeSet?.({ seg: null, dot: drag.dot });
            return;
        }
        if (mode === 'card' && moved) {
            C.moving = null;
            DR = null;
            if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
            d.save();
            C.render();
        } else if (mode === 'port' && moved && drag.at) {
            const [key, kind] = drag.port.split('|');
            const r = C.CV.R.get(key);
            const [x, y] = drag.at;
            const dist = { t: Math.abs(y - r.y), b: Math.abs(y - r.y - r.h), l: Math.abs(x - r.x), r: Math.abs(x - r.x - r.w) };
            const side = Object.entries(dist).sort((a, b) => a[1] - b[1])[0][0];
            if (!key.startsWith('pack:')) {
                const c = (C.memory().cards[key] ??= {});
                (c.ports ??= {})[kind] = SIDE_NAME[side];
                d.save();
                C.render();
                d.toast('Port moved');
            }
        } else if (!moved && start) {
            // Desktop: Shift/Ctrl-click adds a card to the selection; a click selects it alone (then inspects it).
            const c = d.desk ? start.target.closest?.('.card[data-id]') : null;
            const SH = C.SH;
            if (c && (e.shiftKey || e.ctrlKey || e.metaKey) && !C.OV) {
                const s2 = new Set(C.picked);
                s2.has(c.dataset.id) ? s2.delete(c.dataset.id) : s2.add(c.dataset.id);
                C.setPicked(s2);
            } else if (SH && start.target.closest?.('.lhit')?.dataset.lid === SH.l.id) {
                // A tap on the shaped line picks the part of it under the finger.
                d.shapeSet?.({ seg: C.partAt(e.clientX, e.clientY) ?? 0, dot: null });
            } else {
                if (d.desk && !C.OV) C.setPicked(c ? new Set([c.dataset.id]) : new Set(), true);
                C.tapAt(start.target, e);
            }
        }
        C.moving = null;
        I.reset();
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    // Keyboard: the canvas tools are buttons; a focused card opens with Enter.
    vp.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.id) d.open(e.target.dataset.id); });

    mouse.wire?.();
    touch.wire?.();
    /** What the canvas asks of its input: the mouse's hover state, which a draw puts back. */
    return { mouse, touch, get mode() { return I.mode; } };
}
