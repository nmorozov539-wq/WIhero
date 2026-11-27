// The Hero canvas with a mouse or pen on desktop (LAYOUT "Canvas: mouse"): the right button only moves the view
// (so do the middle button and Space with the left one), the left button works on things and box-selects on empty
// canvas, the wheel zooms or scrolls, hover shows a card's handles and lights links, double-click empty adds an entry.
// The shared parts (grabbing, dragging, drops) are in canvas-input.js.

/**
 * Space held (desktop): a left-drag pans, wherever it starts. Kept for the page, not per canvas: the canvas is drawn
 * again on most clicks, and the key may go up while another one is mounted. The Hero keys set it (they know when the
 * focus is in a text box); its release and a lost window focus clear it.
 */
let SPACE = false;
let spaceVp = null;
let spaceHolders = 0;
const onSpaceUp = e => { if (e.key === ' ' && SPACE) holdSpace(false); };
const onSpaceBlur = () => { if (SPACE) holdSpace(false); };
/** The page-level Space release is shared by every mounted canvas and goes when the last one does. */
function retainSpace() {
    if (spaceHolders++) return;
    window.addEventListener('keyup', onSpaceUp, true);
    window.addEventListener('blur', onSpaceBlur);
}
function releaseSpace() {
    if (!spaceHolders || --spaceHolders) return;
    window.removeEventListener('keyup', onSpaceUp, true);
    window.removeEventListener('blur', onSpaceBlur);
}
export function holdSpace(on) {
    SPACE = on;
    spaceVp?.classList.toggle('spacepan', on);
}

/**
 * How a wheel event moves the camera: { zoom: factor } around the pointer, or { pan: [dx, dy] } in screen pixels.
 * Zoom follows the size of the scroll, so a trackpad's many small events zoom smoothly and a mouse's notch is about
 * the old 10% step. Ctrl+wheel (also what a trackpad pinch sends) always zooms; Shift+wheel always pans sideways.
 * `wheel`: 'zoom' (default) or 'scroll' (two fingers pan, as in Figma), from ☰ › Canvas › Mouse wheel.
 */
export function wheelMove(e, wheel = 'zoom') {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    if (e.ctrlKey || e.metaKey) return { zoom: Math.exp(-clamp(dy, 10) * 0.01) };
    if (e.shiftKey) return { pan: [-(dx || dy), 0] };
    if (wheel === 'scroll') return { pan: [-dx, -dy] };
    if (Math.abs(dx) > Math.abs(dy)) return { pan: [-dx, 0] };
    return { zoom: Math.exp(-clamp(dy, 100) * 0.001) };
}

/** The mouse's rules for the shared input `I` of canvas `C`. */
export function mouseInput(C, I) {
    const { vp, world, d } = C;
    spaceVp = vp;
    vp.classList.toggle('spacepan', SPACE);

    // ---- hover: a card's handles at once, its links bright after 350ms; a line and its two cards the same (#11)
    let litKey = null; // the hovered card whose links were lit, to light again on its handles
    let focusTimer = null;
    let leaveTimer = null;
    let litLine = null; // the line under the pointer
    let lineOn = false; // it is lit
    let lineTimer = null;
    function lightLine(l) {
        const CV = C.CV;
        const ends = new Set([l.from, l.to]);
        for (const k of [l.from, l.to]) if (k.startsWith('pack:')) CV.m.packMembers(k.slice(5)).forEach(m => ends.add(m.id));
        vp.classList.add('focusdim');
        for (const n of world.querySelectorAll('[data-of]')) {
            const of = n.dataset.of.split(' ');
            n.classList.toggle('lit', of.length > 1 ? n.dataset.lid === l.id : ends.has(of[0]));
        }
        lineOn = true;
    }
    function unlightLine() {
        clearTimeout(lineTimer);
        litLine = null;
        if (lineOn) { lineOn = false; C.clearFocus(); }
    }

    function wire() {
        retainSpace();
        spaceVp = vp;
        const onWheel = e => {
            e.preventDefault();
            const v = C.camera();
            if (!v) return;
            const r = vp.getBoundingClientRect();
            const step = wheelMove(e, d.wheel?.() ?? 'zoom');
            // A wheel zoom changes the scale, which rasterizes the world again either way; making it its own GPU
            // layer first only re-rasterizes the whole scene per step (measured at 6×). Panning still promotes it,
            // because a move is a transform the compositor can reuse.
            if (step.zoom) { C.zoomAt(step.zoom, e.clientX - r.left, e.clientY - r.top, true); return; }
            C.gesture(true, 250);
            v.tx += step.pan[0];
            v.ty += step.pan[1];
            C.viewLater();
            C.saveCamera();
        };
        // The middle button pans: no autoscroll (Windows) and no paste (Linux) on the canvas.
        const onDown = e => { if (e.button === 1) e.preventDefault(); };
        const onAux = e => { if (e.button === 1) e.preventDefault(); };
        vp.addEventListener('wheel', onWheel, { passive: false });
        vp.addEventListener('mousedown', onDown);
        vp.addEventListener('auxclick', onAux);
        wire.handlers = { onWheel, onDown, onAux };
        if (!d.desk) return;
        const onMove = e => {
            if (I.pts.size || e.buttons || e.pointerType === 'touch') return;
            const c = e.target.closest?.('.card[data-id]');
            const onHandles = e.target.closest?.('.hhandles');
            const key = c?.dataset.id ?? (onHandles ? C.hoverKey : null);
            const OV = C.OV;
            if (key) {
                if (litLine) unlightLine();
                clearTimeout(leaveTimer);
                if (key !== C.hoverKey) {
                    C.hoverKey = key;
                    litKey = null;
                    C.showHandles(key);
                    clearTimeout(focusTimer);
                    focusTimer = setTimeout(() => { if (C.hoverKey === key && !C.OV && !I.mode) { C.applyFocus(key); litKey = key; } }, 350);
                } else if (litKey === key && C.focusKey !== key && !OV && !I.mode) C.applyFocus(key); // back from the gap
                return;
            }
            // A line under the pointer lights up after the same 350ms.
            const ln = !OV && !C.SH && e.target.closest?.('.lhit') ? C.lineUnder(e.target, e.clientX, e.clientY) : null;
            const l = ln ? C.CV?.links[ln.dataset.link] : null;
            if ((l?.id ?? null) !== litLine) {
                unlightLine();
                if (l) {
                    litLine = l.id;
                    lineTimer = setTimeout(() => { if (litLine === l.id && !I.mode && !C.OV && !C.hoverKey) lightLine(l); }, 350);
                }
            }
            if (!C.hoverKey) return;
            // Off the card: everything lights up again at once (#23). The handles stay a moment, so crossing to them
            // doesn't lose them; reaching them lights the card's links again.
            if (C.focusKey) C.clearFocus();
            clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => { C.hoverKey = null; litKey = null; clearTimeout(focusTimer); C.hideHandles(); }, 160);
        };
        const onLeave = () => { clearTimeout(focusTimer); C.hoverKey = null; C.hideHandles(); unlightLine(); C.clearFocus(); };
        const onDbl = e => {
            if (e.target.closest?.('button, input, .lasso, .placeoffer')) return;
            // The press captured the pointer, so the event's target is the view: look under the pointer instead.
            const SH = C.SH;
            if (SH) {
                const under = vp.getRootNode().elementFromPoint?.(e.clientX, e.clientY);
                if (under?.closest?.('[data-dot], [data-ghost]')) return;
                if (C.hitAt(e.clientX, e.clientY)?.link?.id === SH.l.id) { C.addDotAt(e.clientX, e.clientY, e.altKey); return; }
            }
            const h = C.hitAt(e.clientX, e.clientY);
            const key = h?.card;
            if (key && (key.startsWith('id:') || key.startsWith('uid:'))) d.openText?.(key);
            // Double-click empty canvas: Add to canvas here, at that spot (#10).
            else if (!h && !C.OV && !SH && !e.target.closest?.('.hhandles')) d.addHere?.(C.pointAt(e.clientX, e.clientY));
        };
        // The right button only moves the view: no menu on the canvas, the browser's or ours.
        const onMenu = e => {
            if (e.target.closest('.canvas-tools, .panelBtn, .lasso input')) return;
            e.preventDefault();
        };
        vp.addEventListener('pointermove', onMove);
        vp.addEventListener('pointerleave', onLeave);
        vp.addEventListener('dblclick', onDbl);
        vp.addEventListener('contextmenu', onMenu);
        wire.handlers = { ...wire.handlers, onMove, onLeave, onDbl, onMenu };
    }

    function dispose() {
        pause();
        const h = wire.handlers;
        if (h) {
            vp.removeEventListener('wheel', h.onWheel);
            vp.removeEventListener('mousedown', h.onDown);
            vp.removeEventListener('auxclick', h.onAux);
            if (h.onMove) vp.removeEventListener('pointermove', h.onMove);
            if (h.onLeave) vp.removeEventListener('pointerleave', h.onLeave);
            if (h.onDbl) vp.removeEventListener('dblclick', h.onDbl);
            if (h.onMenu) vp.removeEventListener('contextmenu', h.onMenu);
        }
        wire.handlers = null;
        if (spaceVp === vp) spaceVp = null;
        releaseSpace();
    }

    /** Hover timers do not run while the page is hidden (A3). */
    function pause() {
        clearTimeout(focusTimer);
        clearTimeout(lineTimer);
        clearTimeout(leaveTimer);
        C.hoverKey = null;
        litKey = null;
        litLine = null;
        C.hideHandles?.();
        unlightLine();
    }

    return {
        wire,
        dispose,
        pause,
        /** A press: the right and middle buttons (and Space with the left) start a camera drag; others are ignored. */
        down(e) {
            if (e.button === 0 || e.button === 1 || e.button === 2) return I.pts.size > 0; // one pointer at a time
            return true;
        },
        /** Before anything under it: a camera drag, from anywhere; the ⋯ after a card's handles. */
        press(e) {
            if (e.button === 2 || e.button === 1 || SPACE) {
                e.preventDefault(); // no autoscroll on the middle button
                I.mode = 'pan';
                I.start.view = true;
                vp.classList.add('panning');
                return true;
            }
            const more = e.target.closest?.('[data-more]');
            if (more) {
                // The card's menu, on release.
                I.mode = 'more';
                I.drag = { key: more.dataset.more };
                return true;
            }
            return false;
        },
        /**
         * A left-drag on empty canvas, a line or a pill is a box select; Shift or Ctrl adds to the selection. A click
         * without moving is still a click (a line opens its strip, empty canvas lets go of the selection).
         */
        empty(e) {
            const r = vp.getBoundingClientRect();
            I.startBox(e.clientX - r.left, e.clientY - r.top, { add: e.shiftKey || e.ctrlKey || e.metaKey, mouse: true });
        },
        up() {
            if (I.mode === 'pan' && I.start?.view) {
                if (I.moved) C.saveCamera();
                if (!I.pts.size) C.gesture(false);
                I.reset();
                return true;
            }
            if (I.mode === 'more') {
                const key = I.drag.key;
                const moved = I.moved;
                I.reset();
                if (!moved) d.cardMenu?.(key);
                return true;
            }
            return false;
        },
        unlightLine,
    };
}
