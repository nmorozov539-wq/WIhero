// The Hero canvas with fingers (LAYOUT "Canvas tab"), and any pointer on the phone layout: one finger works the
// canvas and pans everywhere a card's grip isn't, two fingers move the view (pan and zoom at once), a lifted finger
// hands the pan to the other, a quick two-finger tap undoes, a long press on empty canvas box-selects or places an
// entry. A drag owns its finger: a second one does nothing until it ends. Shared parts are in canvas-input.js.

/**
 * The pinch's camera: the canvas point that was under the fingers' midpoint stays under it, while the spread sets
 * the zoom. So two fingers pan and zoom at once, as in every map. `p0`: { d, s, wx, wy } at the start; `mx, my`: the
 * midpoint now (view pixels); `dd`: the spread now.
 */
export function pinchCamera(p0, mx, my, dd) {
    const scale = Math.min(2, Math.max(0.25, p0.s * dd / (p0.d || 1)));
    return { scale, tx: mx - p0.wx * scale, ty: my - p0.wy * scale };
}

/** A two-finger tap: the second finger lands within 250ms of the first, both are up within 300ms, neither moves 10px. */
export const TAP2 = { land: 250, lift: 300, slack: 10 };

/** The fingers' rules for the shared input `I` of canvas `C`. */
export function touchInput(C, I) {
    const { vp, d } = C;
    let pinch = null; // { d, s, wx, wy, cam } at the pinch's start
    let firstDown = 0; // when the first finger of a gesture landed
    let tap2 = null; // a pinch that may yet be a two-finger tap: { t, at: Map(id → [x, y]), far }

    return {
        /** A finger landing while another is down: a pinch, unless a drag owns the first one. A third is ignored. */
        down(e) {
            const { pts } = I;
            if (pts.size >= 2) return true;
            if (pts.size === 0) { firstDown = performance.now(); tap2 = null; return false; }
            if (I.mode && I.mode !== 'pan' && I.mode !== 'hold') return true;
            clearTimeout(I.holdTimer);
            vp.setPointerCapture?.(e.pointerId);
            pts.set(e.pointerId, [e.clientX, e.clientY]);
            const [a, b] = [...pts.values()];
            const r = vp.getBoundingClientRect();
            const v = C.camera();
            const mx = (a[0] + b[0]) / 2 - r.left;
            const my = (a[1] + b[1]) / 2 - r.top;
            pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: v.scale, wx: (mx - v.tx) / v.scale, wy: (my - v.ty) / v.scale, cam: { ...v } };
            // It may be a two-finger tap (undo): the second finger landed soon after the first, and nothing moved yet.
            const now = performance.now();
            tap2 = !I.moved && now - firstDown < TAP2.land ? { t: now, at: new Map([...pts].map(([id, p]) => [id, [...p]])), far: 0 } : null;
            I.mode = 'pinch';
            return true;
        },
        /** Empty canvas, a line, a card's body: one finger pans; held still for 520ms it is a long press. */
        empty(e) {
            I.mode = 'pan';
            if (!d.holdEmpty || C.OV || e.target.closest?.('.card, [data-port], [data-pack], [data-flip], [data-open], [data-row]')) return;
            const at = { x: e.clientX, y: e.clientY };
            I.holdTimer = setTimeout(() => {
                if (I.moved || I.mode !== 'pan' || I.pts.size !== 1) return;
                // A long press on empty canvas (#24): drag from here to box-select cards, or let go to place one.
                I.mode = 'hold';
                I.drag = { at };
                navigator.vibrate?.(12);
            }, 520);
        },
        move(e) {
            if (tap2) { const s0 = tap2.at.get(e.pointerId); if (s0) tap2.far = Math.max(tap2.far, Math.hypot(e.clientX - s0[0], e.clientY - s0[1])); }
            if (I.mode !== 'pinch') return false;
            if (I.pts.size !== 2) return true;
            // Two fingers pan and zoom at once: the point under their middle stays under it.
            const [a, b] = [...I.pts.values()];
            const r = vp.getBoundingClientRect();
            C.gesture(true);
            Object.assign(C.camera(), pinchCamera(pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, Math.hypot(a[0] - b[0], a[1] - b[1])));
            C.viewLater();
            C.saveCamera();
            return true;
        },
        /** A slip of the finger isn't a box: it takes 18px from the held spot to start one (review 2026-11-11). */
        drag(e) {
            if (I.mode !== 'hold' || Math.hypot(e.clientX - I.drag.at.x, e.clientY - I.drag.at.y) <= 18) return;
            const r = vp.getBoundingClientRect();
            I.startBox(I.drag.at.x - r.left, I.drag.at.y - r.top);
        },
        up(e) {
            const { pts } = I;
            if (tap2 && !pts.size) {
                // Both fingers up: a quick two-finger tap that didn't move undoes, and the view goes back as it was.
                const t = tap2;
                tap2 = null;
                if (e.type === 'pointerup' && performance.now() - t.t <= TAP2.lift && t.far <= TAP2.slack) {
                    Object.assign(C.camera(), pinch.cam);
                    I.reset();
                    C.gesture(false);
                    C.applyView();
                    C.saveCamera();
                    navigator.vibrate?.(12);
                    d.undo?.();
                    return true;
                }
            }
            if (I.mode === 'pinch') {
                if (pts.size === 1) {
                    // One finger left: it pans on from where it is, so the view doesn't jump; it never counts as a tap.
                    const p = [...pts.values()][0];
                    const v = C.camera();
                    I.mode = 'pan';
                    I.moved = true;
                    I.start = { x: p[0], y: p[1], tx: v.tx, ty: v.ty, target: vp };
                } else if (!pts.size) {
                    I.mode = null;
                    C.gesture(false);
                    C.saveCamera();
                }
                return true;
            }
            if (I.mode === 'hold') {
                // Let go without a box: offer Place here as a button to tap, so a lasso cut short never opens the picker.
                const at = I.drag.at;
                if (!pts.size) C.gesture(false);
                I.reset();
                C.placeOffer(at);
                return true;
            }
            return false;
        },
    };
}
