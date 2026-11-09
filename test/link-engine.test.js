import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkEngine } from '../src/link-engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const def = (id, from, to) => ({ id, from, to });

function run(defs, rects = []) {
    const e = createLinkEngine();
    e.setObstacles(rects);
    e.layout(defs);
    return e;
}

// Sign changes of the turning direction along a flat polyline.
function inflections(pts) {
    let last = 0, count = 0;
    for (let i = 0; i + 5 < pts.length; i += 2) {
        const ax = pts[i + 2] - pts[i], ay = pts[i + 3] - pts[i + 1];
        const bx = pts[i + 4] - pts[i + 2], by = pts[i + 5] - pts[i + 3];
        const cross = ax * by - ay * bx;
        if (Math.abs(cross) < 1e-6 * Math.hypot(ax, ay) * Math.hypot(bx, by)) continue;
        const s = Math.sign(cross);
        if (last && s !== last) count++;
        last = s;
    }
    return count;
}

function distToPolyline(x, y, pts) {
    let best = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
        const vx = pts[i + 2] - pts[i], vy = pts[i + 3] - pts[i + 1];
        const len2 = vx * vx + vy * vy;
        const s = len2 ? Math.max(0, Math.min(1, ((x - pts[i]) * vx + (y - pts[i + 1]) * vy) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (pts[i] + vx * s), y - (pts[i + 1] + vy * s)));
    }
    return best;
}

test('a link starts and ends exactly on its ports', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 400, y: 300, n: 'left' })]);
    const p = e.polyline('a');
    assert.deepEqual([p[0], p[1]], [100, 100]);
    assert.deepEqual([p[p.length - 2], p[p.length - 1]], [400, 300]);
});

test('heads line up: tangents follow the port normals', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 400, y: 300, n: 'left' })]);
    const { startTangent: s, endTangent: t, drawn } = e.path('a');
    close(s.x, 1); close(s.y, 0);
    close(t.x, 1); close(t.y, 0); // travels +x into a port whose outward normal is -x
    assert.deepEqual(drawn, ['curve']);
});

test('end tangent for a top port points down into the card', () => {
    const e = run([def('a', { x: 20, y: 50, n: 'right' }, { x: 300, y: 200, n: 'top' })]);
    const t = e.path('a').endTangent;
    close(t.x, 0); close(t.y, 1);
});

test('aligned facing ports give a straight line with no inflection', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 400, y: 100, n: 'left' })]);
    const p = e.polyline('a');
    for (let i = 1; i < p.length; i += 2) close(p[i], 100);
    assert.equal(inflections(p), 0);
});

test('offset facing ports give one S-curve (one inflection)', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 400, y: 300, n: 'left' })]);
    assert.equal(inflections(e.polyline('a', 0.25)), 1);
});

test('leaders shorten to a third of the chord when ports are close', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 118, y: 100, n: 'left' })]);
    const p = e.polyline('a');
    close(p[2], 106); close(p[3], 100); // 18 / 3 = 6
});

test('a port facing away leaves along its normal and curves round', () => {
    const e = run([def('a', { x: 200, y: 100, n: 'left' }, { x: 400, y: 100, n: 'left' })]);
    const p = e.polyline('a', 0.25);
    const { startTangent: s, endTangent: t } = e.path('a');
    close(s.x, -1); close(s.y, 0);
    close(t.x, 1); close(t.y, 0);
    assert.ok(p[2] < 200, 'first step goes left, along the normal');
    assert.ok(p.some((v, i) => i % 2 === 1 && Math.abs(v - 100) > 20), 'bends sideways instead of doubling back on the line');
});

test('side names, arrays and objects are the same normal', () => {
    const mk = (n) => run([def('a', { x: 0, y: 0, n }, { x: 300, y: 80, n: 'left' })]).path('a').d;
    assert.equal(mk('right'), mk([1, 0]));
    assert.equal(mk('right'), mk({ x: 1, y: 0 }));
});

test('a missing normal points at the other port', () => {
    const e = run([def('a', { x: 0, y: 0 }, { x: 300, y: 10 })]);
    const { startTangent: s, endTangent: t } = e.path('a');
    close(s.x, 1); close(t.x, 1);
});

test('overlapping end cards fall back to a straight line', () => {
    const rects = [{ id: 'A', x: 100, y: 70, w: 100, h: 80 }, { id: 'B', x: 160, y: 100, w: 100, h: 80 }];
    const e = run([def('a', { x: 200, y: 110, n: 'right', card: 'A' }, { x: 160, y: 140, n: 'left', card: 'B' })], rects);
    assert.deepEqual(e.path('a').drawn, ['straight']);
    assert.ok(!e.path('a').d.includes('C'));
});

test('separate end cards keep the curve', () => {
    const rects = [{ id: 'A', x: 0, y: 0, w: 100, h: 80 }, { id: 'B', x: 300, y: 0, w: 100, h: 80 }];
    const e = run([def('a', { x: 100, y: 40, n: 'right', card: 'A' }, { x: 300, y: 40, n: 'left', card: 'B' })], rects);
    assert.deepEqual(e.path('a').drawn, ['curve']);
});

test('bad input never throws and still gives a path', () => {
    const e = createLinkEngine();
    assert.doesNotThrow(() => e.layout([
        def('nan', { x: NaN, y: undefined, n: 7 }, { x: Infinity, y: 0 }),
        def('same', { x: 5, y: 5, n: 'left' }, { x: 5, y: 5, n: 'left' }),
        { id: 'empty' },
        null,
    ]));
    for (const id of ['nan', 'same', 'empty']) assert.match(e.path(id).d, /^M/);
});

test('deterministic: same input, same path', () => {
    const defs = [def('a', { x: 0, y: 0, n: 'right' }, { x: 300, y: 120, n: 'left' })];
    assert.equal(run(defs).path('a').d, run(defs).path('a').d);
});

test('calm: unchanged links are not recomputed and keep their path', () => {
    const e = createLinkEngine();
    const a = def('a', { x: 0, y: 0, n: 'right' }, { x: 300, y: 120, n: 'left' });
    const b = def('b', { x: 0, y: 200, n: 'right' }, { x: 300, y: 320, n: 'left' });
    e.layout([a, b]);
    const before = { a: e.path('a').d, b: e.path('b').d };
    assert.equal(e.stats().computes, 2);

    const same = e.layout([a, b]);
    assert.deepEqual(same.changed, []);
    assert.equal(e.stats().computes, 2);

    const moved = def('b', { x: 0, y: 200, n: 'right' }, { x: 340, y: 360, n: 'left' });
    const res = e.layout([a, moved]);
    assert.deepEqual(res.changed, ['b']);
    assert.equal(e.path('a').d, before.a);
    assert.notEqual(e.path('b').d, before.b);
});

test('links missing from a layout are removed', () => {
    const e = createLinkEngine();
    e.layout([def('a', { x: 0, y: 0 }, { x: 100, y: 0 }), def('b', { x: 0, y: 50 }, { x: 100, y: 50 })]);
    const res = e.layout([def('a', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    assert.deepEqual(res.removed, ['b']);
    assert.equal(e.path('b'), null);
    assert.equal(e.polyline('b'), null);
    assert.equal(e.nearest('b', { x: 0, y: 0 }), null);
});

test('polyline stays within the requested tolerance of the true curve', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 420, y: 340, n: 'left' })]);
    const fine = e.polyline('a', 0.002);
    for (const tol of [2, 0.5, 0.1]) {
        const p = e.polyline('a', tol);
        for (let i = 0; i + 3 < p.length; i += 2) {
            const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
            assert.ok(distToPolyline(mx, my, fine) <= tol + 0.01, `chord midpoint off by more than ${tol}`);
        }
    }
});

test('nearest finds the closest point and where along the link it is', () => {
    const e = run([def('a', { x: 100, y: 100, n: 'right' }, { x: 400, y: 300, n: 'left' })]);
    const p = e.polyline('a', 0.25);
    const k = Math.floor(p.length / 4) * 2;
    const hit = e.nearest('a', { x: p[k], y: p[k + 1] });
    close(hit.dist, 0, 1e-9);
    assert.equal(hit.segment, 0);
    assert.ok(hit.t > 0 && hit.t < 1);
    close(e.nearest('a', { x: 100, y: 100 }).t, 0, 1e-9);
    close(e.nearest('a', { x: 400, y: 300 }).t, 1, 1e-9);
    assert.ok(e.nearest('a', { x: 250, y: 20 }).dist > 10);
});
