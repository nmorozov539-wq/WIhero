// Hand-made link shapes: the stored format and the pure edits on it. Each edit returns a new shape for the host to
// store; nothing here keeps state.
//
// A shape is { dots: [{ u, v }], segments: [{ type, flip?, tension? }] } with one segment more than there are dots.
// The link runs port → dot → … → port; segment i joins point i to point i + 1 (point 0 is the start port).
// type: 'curve' (smooth through the dots), 'arc' (bows to one side), 'straight', 'step' (right angles).
// flip: bow to the other side. tension: 0..1, how far it bows (curve and arc).
//
// Dots are stored in the frame of the two cards the link joins, so a shape stretches and turns when either card
// moves: (u, v) = u along the line from the first card's centre to the second's, v across it, both in units of
// that line's length. `ends` is { from, to }, each a card rectangle (its centre is used) or a point.

export const TYPES = ['curve', 'arc', 'straight', 'step'];

const centre = r => (r && Number.isFinite(r.w) && Number.isFinite(r.h) ? [r.x + r.w / 2, r.y + r.h / 2] : [Number(r?.x) || 0, Number(r?.y) || 0]);

function frame(ends) {
    const a = centre(ends?.from); const b = centre(ends?.to);
    let X = [b[0] - a[0], b[1] - a[1]];
    if (Math.hypot(X[0], X[1]) < 1) X = [100, 0]; // cards on top of each other: a fixed frame
    return { o: a, X, Y: [-X[1], X[0]] };
}

/** A canvas point as a dot { u, v }. */
export function toLocal(point, ends) {
    const { o, X, Y } = frame(ends);
    const dx = point.x - o[0]; const dy = point.y - o[1];
    const l2 = X[0] * X[0] + X[1] * X[1];
    const r = x => Math.round(x * 1e4) / 1e4;
    return { u: r((dx * X[0] + dy * X[1]) / l2), v: r((dx * Y[0] + dy * Y[1]) / l2) };
}

/** A dot as a canvas point { x, y }. */
export function toCanvas(dot, ends) {
    const { o, X, Y } = frame(ends);
    const u = Number(dot?.u) || 0; const v = Number(dot?.v) || 0;
    return { x: o[0] + u * X[0] + v * Y[0], y: o[1] + u * X[1] + v * Y[1] };
}

const seg = s => {
    const out = { type: TYPES.includes(s?.type) ? s.type : 'curve' };
    if (s?.flip) out.flip = true;
    if (Number.isFinite(s?.tension)) out.tension = Math.max(0, Math.min(1, s.tension));
    return out;
};

/** A shape cleaned up: dots and segments agree in number, unknown fields dropped. null for no shape. */
export function normalize(shape) {
    if (!shape || typeof shape !== 'object') return null;
    const dots = (Array.isArray(shape.dots) ? shape.dots : []).filter(d => d && Number.isFinite(d.u) && Number.isFinite(d.v)).map(d => ({ u: d.u, v: d.v }));
    const given = Array.isArray(shape.segments) ? shape.segments : [];
    const segments = Array.from({ length: dots.length + 1 }, (_, i) => seg(given[i]));
    return { dots, segments };
}

const blank = () => ({ dots: [], segments: [{ type: 'curve' }] });

/** Adds a dot at a canvas point on segment i, splitting it in two; both halves keep its settings. */
export function addDot(shape, i, point, ends) {
    const s = normalize(shape) ?? blank();
    const k = Math.max(0, Math.min(s.dots.length, i | 0));
    s.dots.splice(k, 0, toLocal(point, ends));
    s.segments.splice(k, 0, { ...s.segments[k] });
    return s;
}

/** Moves dot i to a canvas point. */
export function moveDot(shape, i, point, ends) {
    const s = normalize(shape);
    if (!s || !s.dots[i]) return s;
    s.dots[i] = toLocal(point, ends);
    return s;
}

/** Removes dot i; the two segments around it become one, with the first one's settings. Null when nothing is left. */
export function removeDot(shape, i) {
    const s = normalize(shape);
    if (!s || !s.dots[i]) return s;
    s.dots.splice(i, 1);
    s.segments.splice(i + 1, 1);
    return isPlain(s) ? null : s;
}

/** Changes segment i: { type?, flip?, tension? }. */
export function setSegment(shape, i, patch) {
    const s = normalize(shape) ?? blank();
    if (!s.segments[i]) return s;
    s.segments[i] = seg({ ...s.segments[i], ...patch });
    return isPlain(s) ? null : s;
}

/** Back to auto routing. */
export const reset = () => null;

/** No dots and one plain curve: the same as no shape at all, so nothing needs storing. */
const isPlain = s => !s.dots.length && s.segments[0].type === 'curve' && !s.segments[0].flip && s.segments[0].tension === undefined;
