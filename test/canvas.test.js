// The Hero canvas as data: cards from a book, the one-time layout, placing new cards, port sides, and the router.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    CH, CW, G, buildGraph, canvasBook, canvasSet, computePorts, crosses, layout, makeGrid, nodeRects, placeNew, route, snap,
} from '../src/ui/canvas-graph.js';
import { arrange } from '../src/ui/canvas.js';

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
    assert.ok(Math.abs(pos[lone].y - snap(5000)) < 1 && pos[lone].x >= snap(5000));
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
