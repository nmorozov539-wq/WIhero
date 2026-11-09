import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDot, createLinkEngine, crosses, moveDot, removeDot, reset, setSegment, toCanvas, toLocal } from '../src/link-engine/index.js';
import { segHitsRect } from '../src/link-engine/geom.js';
import { LR, TB, bookScene } from '../tools/link-scenes.js';
import { bigScene } from '../tools/link-bench.js';

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

// ---- going around cards

const enters = (pts, r, m = 0) => {
    for (let i = 0; i + 3 < pts.length; i += 2) if (segHitsRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, m)) return true;
    return false;
};
const card = (id, x, y, w = 60, h = 60, more = {}) => ({ id, x, y, w, h, ...more });
const at = (r, side) => ({
    x: side === 'left' ? r.x : side === 'right' ? r.x + r.w : r.x + r.w / 2,
    y: side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : r.y + r.h / 2,
    n: side,
    card: r.id,
});

test('a card in the way: the link goes round it and still meets both ports along their normals', () => {
    const A = card('A', 20, 80); const B = card('B', 280, 80); const M = card('M', 150, 60, 60, 100);
    const e = run([def('a', at(A, 'right'), at(B, 'left'))], [A, B, M]);
    const p = e.path('a');
    assert.deepEqual(p.drawn, ['route']);
    assert.ok(p.clear);
    for (const r of [A, B, M]) assert.ok(!enters(e.polyline('a'), r), `enters ${r.id}`);
    close(p.startTangent.x, 1); close(p.endTangent.x, 1);
    const pts = e.polyline('a');
    assert.deepEqual([pts[0], pts[1], pts.at(-2), pts.at(-1)], [80, 110, 280, 110]);
});

test('a link skips a card in its column without touching it', () => {
    const A = card('A', 130, 10, 100, 40); const M = card('M', 130, 90, 100, 40); const B = card('B', 130, 170, 100, 40);
    const e = run([def('a', at(A, 'bottom'), at(B, 'top'))], [A, M, B]);
    assert.ok(!enters(e.polyline('a'), M, 2));
    close(e.path('a').endTangent.y, 1);
});

test('ports facing away loop round their own cards instead of crossing them', () => {
    const A = card('A', 120, 80); const B = card('B', 220, 80);
    for (const [sa, sb] of [['left', 'left'], ['left', 'right']]) {
        const e = run([def('a', at(A, sa), at(B, sb))], [A, B]);
        assert.ok(e.path('a').clear, `${sa} → ${sb}`);
        for (const r of [A, B]) assert.ok(!enters(e.polyline('a'), r), `${sa} → ${sb} enters ${r.id}`);
    }
});

test('a wall of cards: the link goes round the end of it', () => {
    const A = card('A', 20, 80); const B = card('B', 290, 80);
    const wall = [card('M1', 150, 10, 50, 60), card('M2', 150, 80, 50, 60), card('M3', 150, 150, 50, 60)];
    const e = run([def('a', at(A, 'right'), at(B, 'left'))], [A, B, ...wall]);
    for (const r of wall) assert.ok(!enters(e.polyline('a'), r, 2), `enters ${r.id}`);
});

test('pack frames: only links of its members go in; owner lets a link through anything it names', () => {
    const A = card('A', 0, 100); const B = card('B', 400, 100);
    const frame = card('F', 150, 0, 120, 260, { pass: 'members', members: new Set(['X']) });
    const outsider = run([def('a', at(A, 'right'), at(B, 'left'))], [A, B, frame]);
    assert.ok(!enters(outsider.polyline('a'), frame, 0), 'an outsider stays out of the frame');
    const X = card('X', 180, 100);
    const member = run([def('a', at(A, 'right'), at(X, 'left'))], [A, X, frame]);
    assert.deepEqual(member.path('a').drawn, ['curve'], 'a member is reached straight through its frame');
    const owned = run([{ ...def('a', at(A, 'right'), at(B, 'left')), owner: new Set(['F']) }], [A, B, frame]);
    assert.deepEqual(owned.path('a').drawn, ['curve']);
});

test('moving a card near a link reroutes it; moving one far away does not', () => {
    const A = card('A', 20, 80); const B = card('B', 280, 80); const M = card('M', 150, 60, 60, 100);
    const e = createLinkEngine();
    const defs = [def('a', at(A, 'right'), at(B, 'left'))];
    e.setObstacles([A, B, M]);
    e.layout(defs);
    assert.deepEqual(e.path('a').drawn, ['route']);
    e.setObstacles([A, B, { ...M, x: 1000, y: 1000 }]);
    assert.deepEqual(e.layout(defs).changed, ['a']);
    assert.deepEqual(e.path('a').drawn, ['curve']);
    e.setObstacles([A, B, { ...M, x: 1200, y: 1000 }]);
    assert.deepEqual(e.layout(defs).changed, []);
});

test('the example books: no link enters a card, on phones and on desktop', () => {
    for (const file of ['WIHero-Sample.json', 'WIHero-N1.json']) {
        for (const dir of [TB, LR]) {
            const s = bookScene(file, dir);
            const e = createLinkEngine();
            e.setObstacles(s.obstacles);
            e.layout(s.defs);
            const cards = s.obstacles.filter(r => !r.pack && !String(r.id).includes('#'));
            for (const d of s.defs) {
                assert.ok(e.path(d.id).clear, `${file} ${dir}: ${d.id} is not clear`);
                const pts = e.polyline(d.id);
                for (const r of cards) assert.ok(!enters(pts, r, -1), `${file} ${dir}: ${d.id} enters ${r.id}`);
            }
        }
    }
});

// ---- junctions

const passesThrough = (pts, x, y) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i += 2) best = Math.min(best, Math.hypot(pts[i] - x, pts[i + 1] - y));
    return best;
};

test('a link passes through its via points, in order, travelling the way each one says', () => {
    const A = card('A', 0, 0); const B = card('B', 300, 300);
    const via = [{ x: 200, y: 100, n: 'bottom' }];
    const e = run([{ ...def('a', at(A, 'right'), at(B, 'top')), via }], [A, B]);
    const pts = e.polyline('a', 0.25);
    close(passesThrough(pts, 200, 100), 0, 1e-6);
    // Travelling down through the junction: the points just around it line up vertically.
    const i = pts.findIndex((v, k) => k % 2 === 0 && v === 200 && pts[k + 1] === 100);
    assert.ok(i > 0);
    close(pts[i - 2], 200, 1e-6); close(pts[i + 2], 200, 1e-6);
    assert.ok(pts[i - 1] < 100 && pts[i + 3] > 100);
    assert.ok(e.path('a').clear);
});

test('several links into one junction share the run from it, and each still goes round cards', () => {
    const S = card('S', 200, 300, 120, 60);
    const K = [card('K1', 0, 0), card('K2', 200, 0), card('K3', 400, 0)];
    const M = card('M', 230, 120, 60, 40);
    const J = { x: 260, y: 250, n: 'bottom' };
    const defs = K.map(k => ({ ...def(k.id, at(k, 'bottom'), at(S, 'top')), via: [J] }));
    const e = run(defs, [S, M, ...K]);
    for (const d of defs) {
        assert.ok(e.path(d.id).clear, d.id);
        close(passesThrough(e.polyline(d.id, 0.25), J.x, J.y), 0, 1e-6);
        assert.ok(!enters(e.polyline(d.id), M, 2), `${d.id} enters M`);
    }
});

test('a via without a direction travels from the point before it to the point after it', () => {
    const e = run([{ ...def('a', { x: 0, y: 0, n: 'right' }, { x: 400, y: 0, n: 'left' }), via: [{ x: 200, y: 80 }] }]);
    const pts = e.polyline('a', 0.25);
    close(passesThrough(pts, 200, 80), 0, 1e-6);
    assert.ok(e.path('a').d.startsWith('M0 0'));
});

test('moving a via point redoes the link', () => {
    const e = createLinkEngine();
    const d1 = { ...def('a', { x: 0, y: 0, n: 'right' }, { x: 400, y: 0, n: 'left' }), via: [{ x: 200, y: 80 }] };
    e.layout([d1]);
    assert.deepEqual(e.layout([{ ...d1, via: [{ x: 200, y: 120 }] }]).changed, ['a']);
});

// ---- readability

/** Length of link pieces that run within 6px of another link at under 30°, away from the ports. */
function overlapLength(e, defs) {
    let total = 0;
    const P = defs.map(d => e.polyline(d.id, 2));
    P.forEach((p, a) => {
        const ends = [[p[0], p[1]], [p.at(-2), p.at(-1)]];
        for (let i = 0; i + 3 < p.length; i += 2) {
            if (ends.some(([x, y]) => Math.hypot(p[i] - x, p[i + 1] - y) < 40)) continue;
            const ux = p[i + 2] - p[i]; const uy = p[i + 3] - p[i + 1]; const ul = Math.hypot(ux, uy);
            const mx = p[i] + ux / 2; const my = p[i + 1] + uy / 2;
            const hit = P.some((o, b) => {
                if (a === b) return false;
                for (let j = 0; j + 3 < o.length; j += 2) {
                    const vx = o[j + 2] - o[j]; const vy = o[j + 3] - o[j + 1]; const vl = Math.hypot(vx, vy);
                    if (!vl || !ul || Math.abs(ux * vy - uy * vx) / (ul * vl) > 0.5) continue;
                    const t = Math.max(0, Math.min(1, ((mx - o[j]) * vx + (my - o[j + 1]) * vy) / (vl * vl)));
                    if (Math.hypot(mx - o[j] - vx * t, my - o[j + 1] - vy * t) < 6) return true;
                }
                return false;
            });
            if (hit) total += ul;
        }
    });
    return total;
}

test('links cross cleanly: choosing among curve shapes cuts long shallow overlaps on the desktop sample', () => {
    const s = bookScene('WIHero-Sample.json', LR);
    const lay = (o) => { const e = createLinkEngine(o); e.setObstacles(s.obstacles); e.layout(s.defs); return e; };
    const plain = overlapLength(lay({ scales: [1] }), s.defs);
    const picked = overlapLength(lay(), s.defs);
    assert.ok(picked < plain * 0.6, `overlap ${picked.toFixed(0)} vs ${plain.toFixed(0)} with one shape`);
});

test('no two links sit on top of each other for long in the phone sample', () => {
    const s = bookScene('WIHero-Sample.json', TB);
    const e = createLinkEngine();
    e.setObstacles(s.obstacles);
    e.layout(s.defs);
    const lanesOff = createLinkEngine({ laneGap: 0.5 });
    lanesOff.setObstacles(s.obstacles);
    lanesOff.layout(s.defs);
    assert.ok(overlapLength(e, s.defs) < overlapLength(lanesOff, s.defs) * 0.5);
});

// ---- hand shaping

test('dots are stored against the two cards: they stretch and turn when a card moves', () => {
    const ends = { from: card('A', 0, 0, 100, 100), to: card('B', 300, 0, 100, 100) };
    const dot = toLocal({ x: 200, y: 150 }, ends);
    assert.deepEqual(dot, { u: 0.5, v: 0.3333 });
    const back = toCanvas(dot, ends);
    close(back.x, 200); close(back.y, 150, 0.02);
    // B moves twice as far away: the dot keeps its place in between, and its distance off the line grows too.
    const far = toCanvas(dot, { ...ends, to: card('B', 600, 0, 100, 100) });
    close(far.x, 350); close(far.y, 50 + 0.3333 * 600, 0.01);
    // Cards on top of each other still give a usable frame.
    const same = { from: card('A', 0, 0), to: card('B', 0, 0) };
    const p = toCanvas(toLocal({ x: 40, y: 70 }, same), same);
    close(p.x, 40, 0.01); close(p.y, 70, 0.01);
});

test('the edits are pure and keep one segment more than there are dots', () => {
    const ends = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    const s1 = addDot(null, 0, { x: 50, y: 20 }, ends);
    assert.deepEqual(s1, { dots: [{ u: 0.5, v: 0.2 }], segments: [{ type: 'curve' }, { type: 'curve' }] });
    const s2 = setSegment(s1, 1, { type: 'arc', flip: true, tension: 2 });
    assert.deepEqual(s2.segments[1], { type: 'arc', flip: true, tension: 1 });
    assert.deepEqual(s1.segments[1], { type: 'curve' }, 'the old shape is unchanged');
    const s3 = addDot(s2, 1, { x: 80, y: 0 }, ends);
    assert.equal(s3.dots.length, 2); assert.equal(s3.segments.length, 3);
    assert.deepEqual(s3.segments[2], { type: 'arc', flip: true, tension: 1 }, 'a split segment keeps its settings in both halves');
    const s4 = moveDot(s3, 0, { x: 10, y: 10 }, ends);
    assert.deepEqual(s4.dots[0], { u: 0.1, v: 0.1 });
    assert.equal(removeDot(removeDot(s1, 0), 0), null, 'nothing left: back to auto');
    assert.equal(removeDot(s1, 0), null);
    assert.equal(setSegment(null, 0, { type: 'curve' }), null, 'a plain curve is no shape at all');
    assert.equal(reset(), null);
    assert.equal(JSON.stringify(s2), JSON.stringify(JSON.parse(JSON.stringify(s2))), 'plain JSON, ready for the settings');
});

test('a dot added where the host clicked: the link then runs through it', () => {
    const A = card('A', 0, 0); const B = card('B', 400, 200);
    const base = def('a', at(A, 'right'), at(B, 'left'));
    const e = run([base], [A, B]);
    const hit = e.nearest('a', { x: 200, y: 40 });
    assert.equal(hit.segment, 0);
    const shape = addDot(null, hit.segment, { x: 200, y: 40 }, { from: A, to: B });
    e.layout([{ ...base, shape }]);
    close(e.nearest('a', { x: 200, y: 40 }).dist, 0, 0.5);
    assert.deepEqual(e.path('a').drawn, ['curve', 'curve']);
    // Each half is its own segment for hit tests.
    assert.equal(e.nearest('a', { x: 60, y: 30 }).segment, 0);
    assert.equal(e.nearest('a', { x: 380, y: 230 }).segment, 1);
});

test('segment types: straight, arc (and flipped), step', () => {
    const A = card('A', 0, 0); const B = card('B', 300, 0);
    const base = def('a', at(A, 'right'), at(B, 'left'));
    const lay = sg => { const e = run([{ ...base, shape: { dots: [], segments: [sg] } }], [A, B]); return e; };
    assert.equal(lay({ type: 'straight' }).path('a').d, 'M60 30L300 30');
    const up = lay({ type: 'arc', tension: 0.5 }).polyline('a');
    const down = lay({ type: 'arc', tension: 0.5, flip: true }).polyline('a');
    const ys = p => p.filter((_, i) => i % 2 === 1);
    // Travelling right, "left" is up the screen (smaller y).
    assert.ok(Math.min(...ys(up)) < 30 - 40 && Math.max(...ys(up)) <= 30 + 1e-6);
    assert.ok(Math.max(...ys(down)) > 30 + 40 && Math.min(...ys(down)) >= 30 - 1e-6);
    const C = card('C', 300, 200);
    const e = run([{ ...def('a', at(A, 'right'), at(C, 'left')), shape: { dots: [], segments: [{ type: 'step' }] } }], [A, C]);
    const d = e.path('a').d;
    assert.match(d, /L\S+ 30/); // a run along the start's row
    assert.match(d, /L\S+ 230/); // and one along the end's row
    assert.deepEqual(e.path('a').drawn, ['step']);
});

test('a hand-made segment that would cross a card is routed round it; one into a dot inside a card is not', () => {
    const A = card('A', 0, 80); const B = card('B', 400, 80); const M = card('M', 180, 40, 60, 140);
    const base = def('a', at(A, 'right'), at(B, 'left'));
    const e = run([{ ...base, shape: { dots: [], segments: [{ type: 'straight' }] } }], [A, B, M]);
    assert.deepEqual(e.path('a').drawn, ['route']);
    assert.ok(!enters(e.polyline('a'), M, 2));
    // A dot inside M: both segments may run into M.
    const shape = addDot(null, 0, { x: 210, y: 110 }, { from: A, to: B });
    const f = run([{ ...base, shape: setSegment(setSegment(shape, 0, { type: 'straight' }), 1, { type: 'straight' }) }], [A, B, M]);
    assert.deepEqual(f.path('a').drawn, ['straight', 'straight']);
    assert.ok(f.path('a').clear);
});

test('changing a stored shape redoes the link, and it ends on its ports along their normals', () => {
    const A = card('A', 0, 0); const B = card('B', 400, 200);
    const base = def('a', at(A, 'right'), at(B, 'left'));
    const e = createLinkEngine();
    e.setObstacles([A, B]);
    e.layout([base]);
    const shape = addDot(null, 0, { x: 200, y: -80 }, { from: A, to: B });
    assert.deepEqual(e.layout([{ ...base, shape }]).changed, ['a']);
    assert.deepEqual(e.layout([{ ...base, shape }]).changed, []);
    const { startTangent: s, endTangent: t } = e.path('a');
    close(s.x, 1); close(t.x, 1);
});

// ---- calm updates

test('dropping one card redoes only the links near it; every other link keeps its exact path', () => {
    const { cards, defs } = bigScene();
    const e = createLinkEngine();
    e.setObstacles(cards);
    e.layout(defs);
    const before = new Map(defs.map(d => [d.id, e.path(d.id).d]));
    const shift = p => (p.card === 'c7_3' ? { ...p, x: p.x + 36, y: p.y + 24 } : p);
    e.setObstacles(cards.map(c => (c.id === 'c7_3' ? { ...c, x: c.x + 36, y: c.y + 24 } : c)));
    const { changed } = e.layout(defs.map(d => ({ ...d, from: shift(d.from), to: shift(d.to) })));
    const own = defs.filter(d => d.from.card === 'c7_3' || d.to.card === 'c7_3').map(d => d.id);
    for (const id of own) assert.ok(changed.includes(id), `${id} touches the card and must be redone`);
    assert.ok(changed.length < defs.length / 8, `${changed.length} of ${defs.length} redone`);
    for (const d of defs) if (!changed.includes(d.id)) assert.equal(e.path(d.id).d, before.get(d.id), `${d.id} moved`);
});

test('a big canvas: every link is clear of every card', () => {
    const { cards, defs } = bigScene();
    const e = createLinkEngine();
    e.setObstacles(cards);
    e.layout(defs);
    for (const d of defs) {
        assert.ok(e.path(d.id).clear, d.id);
        const pts = e.polyline(d.id);
        for (const r of cards) assert.ok(!enters(pts, r, -1), `${d.id} enters ${r.id}`);
    }
});

test('crosses: curve-aware, it sees a curve that bows into a card between its ends', () => {
    const A = card('A', 0, 0); const B = card('B', 300, 0); const M = card('M', 160, 110, 40, 40);
    const e = run([{ ...def('a', at(A, 'right'), at(B, 'left')), shape: { dots: [], segments: [{ type: 'arc', flip: true, tension: 1 }] } }], [A, B]);
    assert.ok(crosses(e.polyline('a'), M), 'the arc dips through M');
    assert.ok(!crosses([60, 30, 300, 30], M), 'the straight line does not');
    assert.ok(!crosses(e.polyline('a'), A), 'starting on a card\'s border is not crossing it');
});
