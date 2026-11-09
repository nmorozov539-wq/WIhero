// The Hero canvas as data: cards from a book, the one-time layout, placing new cards, port sides, and the router.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    CH, CW, G, LR, buildGraph, canvasBook, canvasSet, withFrames, computePorts, crosses, layout, makeGrid, nodeRects, placeNew, route, snap,
} from '../src/ui/canvas-graph.js';
import { arrange, linkKey } from '../src/ui/canvas.js';

const sample = () => JSON.parse(fs.readFileSync(new URL('../examples/WIHero-Sample.json', import.meta.url), 'utf8'));
const overlap = (a, b, gap = 0) => Math.abs(a.x - b.x) < CW + gap && Math.abs(a.y - b.y) < CH + gap;

function laidOut(data = sample()) {
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = canvasSet(m, g, []);
    const pos = layout(m, g, ids);
    return { m, g, ids, pos };
}

test('cards are keyed as in the settings, and story logic refs become id: keys', () => {
    const { m, g } = laidOut();
    assert.ok(m.E.length > 10);
    for (const e of m.E) assert.match(e.id, /^(id|uid):/);
    for (const x of g.edges) {
        assert.ok(x.from.startsWith('id:') || x.from.startsWith('pack:'), x.from);
        assert.ok(x.to.startsWith('id:') || x.to.startsWith('pack:'), x.to);
    }
    assert.deepEqual(g.packs, ['town']);
});

test('a book without pieces has nothing on the canvas until entries are placed by hand', () => {
    const data = sample();
    for (const e of Object.values(data.entries)) { delete e.extensions; delete e.wihero; }
    const m = canvasBook(data);
    const g = buildGraph(m);
    assert.equal(canvasSet(m, g, []).size, 0);
    const one = m.E[0].id;
    assert.deepEqual([...canvasSet(m, g, [one])], [one]);
});

test('a pack shows its frame as soon as a member is on the canvas, without pulling in the rest', () => {
    const data = sample();
    for (const e of Object.values(data.entries)) { delete e.extensions; delete e.wihero; }
    const [a, b] = Object.values(data.entries);
    a.extensions = { wihero: { packs: ['crew'] } };
    b.extensions = { wihero: { packs: ['crew'] } };
    const m = canvasBook(data);
    const g = buildGraph(m);
    assert.deepEqual(g.packs, [], 'no rule reads or targets the pack');
    const one = m.E.find(e => e.packs.includes('crew')).id;
    const ids = canvasSet(m, g, [one]);
    assert.deepEqual([...ids], [one], 'only the placed member is on the canvas');
    const gf = withFrames(m, g, ids);
    assert.deepEqual(gf.packs, ['crew']);
    const R = nodeRects(m, gf, ids, { [one]: { x: 0, y: 0 } });
    assert.ok(R.get('pack:crew'), 'a frame round the placed member');
    assert.deepEqual(R.get('pack:crew').members, [one]);
    assert.equal(withFrames(m, g, new Set()), g, 'nothing placed, nothing added');
});

test('the layout puts every card on the grid, none overlapping, opens flowing downwards', () => {
    const { m, g, ids, pos } = laidOut();
    const keys = [...ids];
    assert.equal(Object.keys(pos).length, keys.length);
    for (const k of keys) { assert.equal(pos[k].x, snap(pos[k].x)); assert.equal(pos[k].y, snap(pos[k].y)); }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(!overlap(pos[keys[i]], pos[keys[j]]), `${keys[i]} / ${keys[j]}`);
    for (const x of g.edges) {
        if (x.kind !== 'open' || x.mask != null || x.from.startsWith('pack:') || x.to.startsWith('pack:')) continue;
        if (m.byId(x.from).packs.length && m.byId(x.from).packs[0] === m.byId(x.to).packs[0]) continue;
        assert.ok(pos[x.from].y < pos[x.to].y, `${x.from} above ${x.to}`);
    }
});

test('pack members are laid out together inside their frame', () => {
    const { m, g, ids, pos } = laidOut();
    const R = nodeRects(m, g, ids, pos);
    const frame = R.get('pack:town');
    assert.ok(frame);
    for (const key of frame.members) {
        const r = R.get(key);
        assert.ok(r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h);
    }
    for (const r of R.values()) {
        if (r.pack || frame.members.includes(r.key)) continue;
        assert.ok(r.x + r.w <= frame.x || r.x >= frame.x + frame.w || r.y + r.h <= frame.y || r.y >= frame.y + frame.h, `${r.key} is outside the frame`);
    }
});

test('a new linked card goes in the nearest free spot beside its partner; a lone one near the middle of the view', () => {
    const { m, g, ids, pos } = laidOut();
    const [victim] = [...ids].filter(k => g.edges.some(x => x.to === k && !x.from.startsWith('pack:')) && !m.byId(k).packs.length);
    const partner = g.edges.find(x => x.to === victim && pos[x.from]).from;
    delete pos[victim];
    const added = placeNew(m, g, ids, pos, { x: 0, y: 0 });
    assert.deepEqual(added, [victim]);
    const p = pos[victim];
    const b = pos[partner];
    assert.ok(Math.abs(p.x - b.x) <= 12 * (CW + 48) && Math.abs(p.y - b.y) <= 12 * (CH + 72));
    for (const k of ids) if (k !== victim) assert.ok(!overlap(p, pos[k]), `${victim} overlaps ${k}`);

    const lone = m.E.find(e => !ids.has(e.id)).id;
    const set = new Set([...ids, lone]);
    placeNew(m, g, set, pos, { x: 5000, y: 5000 });
    assert.ok(Math.abs(pos[lone].x - snap(5000)) < 1 && pos[lone].y >= snap(5000));
});

test('the canvas grows downwards: a card a partner leads to goes below it, one that leads to it goes above', () => {
    const { m, g, ids, pos } = laidOut();
    const free = k => !m.byId(k).packs.length;
    const x = g.edges.find(e => e.kind === 'open' && e.mask == null && !e.from.startsWith('pack:') && !e.to.startsWith('pack:') && free(e.from) && free(e.to));
    const keep = { ...pos };
    const only = new Set([x.from, x.to]);
    const p1 = { [x.from]: keep[x.from] };
    placeNew(m, g, only, p1, { x: 0, y: 0 });
    assert.equal(p1[x.to].x, keep[x.from].x);
    assert.ok(p1[x.to].y > keep[x.from].y, 'the gated card sits below');
    const p2 = { [x.to]: keep[x.to] };
    placeNew(m, g, only, p2, { x: 0, y: 0 });
    assert.equal(p2[x.from].x, keep[x.to].x);
    assert.ok(p2[x.from].y < keep[x.to].y, 'the card that gates it sits above');
});

test('no row of the layout is wider than two cards, so a phone sees it at full zoom', () => {
    const { m, g, ids, pos } = laidOut();
    const R = nodeRects(m, g, ids, pos);
    const rows = new Map();
    for (const r of R.values()) {
        if (r.pack || m.byId(r.key)?.packs.length) continue;
        (rows.get(r.y) ?? rows.set(r.y, []).get(r.y)).push(r);
    }
    for (const [y, rs] of rows) assert.ok(rs.length <= 2, `${rs.length} cards side by side at y=${y}`);
});

test('ports face their partners, and a side moved by hand wins', () => {
    const { m, g, ids, pos } = laidOut();
    const R = nodeRects(m, g, ids, pos);
    const P = computePorts(g, R);
    const x = g.edges.find(e => e.kind === 'open' && e.mask == null && !e.from.startsWith('pack:') && !e.to.startsWith('pack:') && pos[e.from].y < pos[e.to].y);
    assert.equal(P.get(x.from).get(x.fromPort).side, 'b');
    assert.equal(P.get(x.to).get(x.port).side, 't');
    const moved = computePorts(g, R, { [`${x.to}:${x.port}`]: 'l' });
    assert.equal(moved.get(x.to).get(x.port).side, 'l');
});

test('links are routed around cards, never through one', () => {
    const { m, g, ids, pos } = laidOut();
    const R = nodeRects(m, g, ids, pos);
    const P = computePorts(g, R);
    const grid = makeGrid(R, []);
    const cards = [...R.values()].filter(r => !r.pack);
    let routed = 0;
    for (const x of g.edges) {
        const a = P.get(x.from)?.get(x.fromPort);
        const b = P.get(x.to)?.get(x.port);
        if (!a || !b) continue;
        const s = [snap(a.x + a.n[0] * G), snap(a.y + a.n[1] * G)];
        const e = [snap(b.x + b.n[0] * G), snap(b.y + b.n[1] * G)];
        const allow = new Set([x.from, x.to].filter(k => k.startsWith('pack:')));
        for (const r of R.values()) if (r.pack && (r.members.includes(x.from) || r.members.includes(x.to))) allow.add(r.key);
        const pts = route(grid, s[0], s[1], e[0], e[1], allow);
        assert.ok(pts, `${x.from} → ${x.to} found a way`);
        routed++;
        for (const r of cards) assert.ok(!crosses(pts, r), `${x.from} → ${x.to} crosses ${r.key}`);
    }
    assert.ok(routed >= 10);
});

test('arrange lays a book out once, then keeps every card where it was', () => {
    const data = sample();
    const m = canvasBook(data);
    const memory = { camera: null, cards: {}, placed: false };
    arrange(m, memory, { x: 0, y: 0 });
    assert.equal(memory.placed, true);
    const first = structuredClone(memory.cards);
    const key = Object.keys(first)[0];
    memory.cards[key].x += 240;
    arrange(m, memory, { x: 0, y: 0 });
    assert.equal(memory.cards[key].x, first[key].x + 240);
    for (const k of Object.keys(first)) if (k !== key) assert.deepEqual(memory.cards[k], first[k]);
});

test('a hand-made link shape is kept with its link and dropped when the link goes', () => {
    const m = canvasBook(sample());
    const memory = { camera: null, cards: {}, placed: false };
    const { g } = arrange(m, memory, { x: 0, y: 0 });
    const x = g.edges.find(e => e.from.startsWith('id:') && memory.cards[e.from]);
    const shape = { dots: [{ u: 0.5, v: 0.2 }], segments: [{ type: 'curve' }, { type: 'arc' }] };
    memory.cards[x.from].links = { [linkKey(x)]: shape, 'gout>id:nowhere': shape };
    arrange(m, memory, { x: 0, y: 0 });
    assert.deepEqual(memory.cards[x.from].links, { [linkKey(x)]: shape });
});

test('a card placed by hand never lands inside a pack frame it isn\'t in', () => {
    const { m, g, ids, pos } = laidOut();
    const R = nodeRects(m, g, ids, pos);
    const frame = R.get('pack:town');
    const lone = m.E.find(e => !ids.has(e.id)).id;
    placeNew(m, g, new Set([...ids, lone]), pos, { x: frame.x + 10, y: frame.y + 10 });
    const p = pos[lone];
    assert.ok(p.x >= frame.x + frame.w || p.x + CW <= frame.x || p.y >= frame.y + frame.h || p.y + CH <= frame.y, JSON.stringify([p, frame]));
});

test('an empty canvas still makes a grid', () => {
    const grid = makeGrid(new Map(), []);
    assert.ok(grid.W > 0 && grid.H > 0);
});

test('the open chat\'s greetings are start cards; their rules on entries become links (BUILD_SPEC 15.4)', () => {
    const data = sample();
    const g = { greeting: 0, char: 'Sera.png', name: 'Sera', fp: 'f' };
    const road = Object.values(data.entries).find(e => e.wihero?.id === 'road');
    road.wihero.gatedBy = [g];
    const tavern = Object.values(data.entries).find(e => e.wihero?.id === 'tavern');
    tavern.wihero.closeGate = [[{ ...g, via: '#town' }]];
    const greetings = [{ key: 'greet:Sera.png:0', title: 'Greeting', text: 'Hello', ref: g }];
    const m = canvasBook(data, { greetings });
    assert.ok(m.byId('greet:Sera.png:0').greeting);
    const gr = buildGraph(m);
    assert.ok(gr.edges.some(x => x.from === 'greet:Sera.png:0' && x.to === 'id:road' && x.kind === 'open'));
    assert.ok(gr.edges.some(x => x.from === 'greet:Sera.png:0' && x.to === 'pack:town' && x.kind === 'close'));
    assert.equal(buildGraph(canvasBook(data)).edges.filter(x => x.from.startsWith('greet:')).length, 0, 'with no chat open, none are drawn');
});

// ---- Left to right (desktop, VISUAL 7.6)

const book = (...entries) => ({ entries: Object.fromEntries(entries.map(x => [x.uid, x])) });
const ent = (uid, id, config = {}) => ({ uid, comment: id, key: [id], content: '', extensions: { wihero: { id, ...config } } });

function laidOutLR(data = sample()) {
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = canvasSet(m, g, []);
    const pos = layout(m, g, ids, { dir: LR });
    return { m, g, ids, pos };
}

test('left to right: every card on the grid, none overlapping, opens flowing rightwards', () => {
    const { m, g, ids, pos } = laidOutLR();
    const keys = [...ids];
    assert.equal(Object.keys(pos).length, keys.length);
    for (const k of keys) { assert.equal(pos[k].x, snap(pos[k].x)); assert.equal(pos[k].y, snap(pos[k].y)); }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(!overlap(pos[keys[i]], pos[keys[j]], 24), `${keys[i]} / ${keys[j]}`);
    let checked = 0;
    for (const x of g.edges) {
        if (x.kind !== 'open' || x.mask != null || x.from.startsWith('pack:') || x.to.startsWith('pack:')) continue;
        if (m.byId(x.from).packs.length && m.byId(x.from).packs[0] === m.byId(x.to).packs[0]) continue;
        assert.ok(pos[x.from].x + CW < pos[x.to].x, `${x.from} left of ${x.to}`);
        checked++;
    }
    assert.ok(checked >= 5);
});

test('left to right: a pack stands as one block in its column, its members stacked inside the frame', () => {
    const { m, g, ids, pos } = laidOutLR();
    const R = nodeRects(m, g, ids, pos);
    const frame = R.get('pack:town');
    assert.ok(frame.members.length >= 2);
    const xs = new Set(frame.members.map(k => pos[k].x));
    assert.equal(xs.size, 1, 'one column');
    for (const key of frame.members) {
        const r = R.get(key);
        assert.ok(r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h);
    }
    for (const r of R.values()) {
        if (r.pack || frame.members.includes(r.key)) continue;
        assert.ok(r.x + r.w <= frame.x || r.x >= frame.x + frame.w || r.y + r.h <= frame.y || r.y >= frame.y + frame.h, `${r.key} is outside the frame`);
    }
});

test('left to right: a card sits one column right of everything it waits for, columns ordered by their sources and centred', () => {
    // a and b start; c waits for b, d waits for a, e waits for c and d.
    const data = book(ent(0, 'a'), ent(1, 'b'), ent(2, 'c', { gate: [['b']] }), ent(3, 'd', { gate: [['a']] }), ent(4, 'e', { gate: [['c', 'd']] }));
    const { pos } = laidOutLR(data);
    const p = id => pos[`id:${id}`];
    assert.equal(p('a').x, p('b').x);
    assert.equal(p('c').x, p('d').x);
    assert.ok(p('c').x > p('a').x && p('e').x > p('c').x);
    assert.ok(p('a').y < p('b').y, 'the first column keeps the book order');
    assert.ok(p('d').y < p('c').y, 'd follows a, which is above b');
    // Every column is centred on the same middle line.
    const mid = ks => (Math.min(...ks.map(k => p(k).y)) + Math.max(...ks.map(k => p(k).y)) + CH) / 2;
    assert.ok(Math.abs(mid(['a', 'b']) - mid(['e'])) <= G);
    assert.ok(Math.abs(mid(['c', 'd']) - mid(['e'])) <= G);
});

test('left to right: a pack\'s unlinked members join the column of its linked member', () => {
    // Only inn is linked (from gate); square reads the pack, so the frame is drawn.
    const data = book(ent(0, 'gate'), ent(1, 'inn', { gate: [['gate']], packs: ['town'] }), ent(2, 'smith', { packs: ['town'] }), ent(3, 'baker', { packs: ['town'] }),
        ent(4, 'square', { gate: [['#town']] }));
    const { pos } = laidOutLR(data);
    const x = id => pos[`id:${id}`].x;
    assert.equal(x('smith'), x('inn'));
    assert.equal(x('baker'), x('inn'));
    assert.ok(x('inn') > x('gate'));
    assert.ok(x('square') > x('inn'));
});

test('left to right: cards with no links wrap into columns of six', () => {
    const entries = Array.from({ length: 14 }, (_, i) => ent(i, `e${i}`));
    const data = book(...entries);
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = new Set(m.E.map(e => e.id));
    const pos = layout(m, g, ids, { dir: LR });
    const cols = new Map();
    for (const k of ids) cols.set(pos[k].x, (cols.get(pos[k].x) ?? 0) + 1);
    assert.deepEqual([...cols.values()].sort(), [2, 6, 6]);
});

test('left to right: ports side by side use right and left, stacked ones bottom and top, a lone lock the top', () => {
    const data = book(ent(0, 'road'), ent(1, 'mill', { gate: [['road']] }), ent(2, 'cave', { gate: [[{ lock: ['red beard'] }]] }));
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = new Set(m.E.map(e => e.id));
    const pos = { 'id:road': { x: 0, y: 0 }, 'id:mill': { x: CW + 144, y: 96 }, 'id:cave': { x: 0, y: 300 } };
    const R = nodeRects(m, g, ids, pos);
    let P = computePorts(g, R, {}, { dir: LR });
    assert.equal(P.get('id:road').get('gout').side, 'r');
    assert.equal(P.get('id:mill').get('gin').side, 'l');
    assert.equal(P.get('id:cave').get('gin').side, 't', 'a lone lock sits on top');
    // Above one another: bottom to top.
    pos['id:mill'] = { x: 24, y: 144 };
    P = computePorts(g, nodeRects(m, g, ids, pos), {}, { dir: LR });
    assert.equal(P.get('id:road').get('gout').side, 'b');
    assert.equal(P.get('id:mill').get('gin').side, 't');
    // A side moved by hand still wins.
    P = computePorts(g, nodeRects(m, g, ids, pos), { 'id:mill:gin': 'l' }, { dir: LR });
    assert.equal(P.get('id:mill').get('gin').side, 'l');
    // The phone keeps its rule: a lone lock's socket on top, links to the side only when far more across than down.
    pos['id:mill'] = { x: CW + 144, y: 96 };
    P = computePorts(g, nodeRects(m, g, ids, pos));
    assert.equal(P.get('id:road').get('gout').side, 'r');
    assert.equal(P.get('id:cave').get('gin').side, 't');
});

test('left to right: on a side edge the ports run opens, glue, closes, top to bottom', () => {
    const data = book(ent(0, 'host'), ent(1, 'storm'), ent(2, 'rider', { gate: [['host']], glue: { mode: 'ride', host: 'host' }, closeGate: [['storm']] }));
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = new Set(m.E.map(e => e.id));
    const pos = { 'id:host': { x: 0, y: 0 }, 'id:storm': { x: 0, y: 144 }, 'id:rider': { x: CW + 144, y: 48 } };
    const P = computePorts(g, nodeRects(m, g, ids, pos), {}, { dir: LR });
    const rider = P.get('id:rider');
    for (const k of ['gin', 'glin', 'cin']) assert.equal(rider.get(k).side, 'l', k);
    assert.ok(rider.get('gin').y < rider.get('glin').y && rider.get('glin').y < rider.get('cin').y);
});

test('left to right: a new card a partner leads to goes right of it; one that leads to it, left', () => {
    const { m, g, pos } = laidOutLR();
    const free = k => !m.byId(k).packs.length;
    const x = g.edges.find(e => e.kind === 'open' && e.mask == null && !e.from.startsWith('pack:') && !e.to.startsWith('pack:') && free(e.from) && free(e.to));
    const only = new Set([x.from, x.to]);
    const p1 = { [x.from]: pos[x.from] };
    placeNew(m, g, only, p1, { x: 0, y: 0 }, { dir: LR });
    assert.equal(p1[x.to].y, pos[x.from].y);
    assert.ok(p1[x.to].x > pos[x.from].x);
    const p2 = { [x.to]: pos[x.to] };
    placeNew(m, g, only, p2, { x: 0, y: 0 }, { dir: LR });
    assert.ok(p2[x.from].x < pos[x.to].x);
});

test('left to right: links are routed around cards, never through one', () => {
    const { m, g, ids, pos } = laidOutLR();
    const R = nodeRects(m, g, ids, pos);
    const P = computePorts(g, R, {}, { dir: LR });
    const grid = makeGrid(R, []);
    const cards = [...R.values()].filter(r => !r.pack);
    let routed = 0;
    for (const x of g.edges) {
        const a = P.get(x.from)?.get(x.fromPort);
        const b = P.get(x.to)?.get(x.port);
        if (!a || !b) continue;
        const s = [snap(a.x + a.n[0] * G), snap(a.y + a.n[1] * G)];
        const e = [snap(b.x + b.n[0] * G), snap(b.y + b.n[1] * G)];
        const allow = new Set([x.from, x.to].filter(k => k.startsWith('pack:')));
        for (const r of R.values()) if (r.pack && (r.members.includes(x.from) || r.members.includes(x.to))) allow.add(r.key);
        const pts = route(grid, s[0], s[1], e[0], e[1], allow);
        assert.ok(pts, `${x.from} → ${x.to} found a way`);
        routed++;
        for (const r of cards) assert.ok(!crosses(pts, r), `${x.from} → ${x.to} crosses ${r.key}`);
    }
    assert.ok(routed >= 10);
});
