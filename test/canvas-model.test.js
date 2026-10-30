import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine.js';
import { buildGraph, labelKey, maskKey } from '../src/graph.js';
import { layout, CARD } from '../src/layout.js';
import { canvasOf, placeKey, canvasLayout, boxAround, inside, linkOptions, applyLink, setLabel, newProblems, pushUndo } from '../src/canvas-model.js';

const B = 'Book';
function book() {
    return { entries: {
        0: { uid: 0, comment: 'Road', key: ['road'], wihero: { id: 'road' } },
        1: { uid: 1, comment: 'Mill', key: ['mill'], wihero: { id: 'mill', gates: ['road'] } },
        2: { uid: 2, comment: 'Tavern', key: ['tavern'], wihero: { id: 'tavern', labels: ['town'] } },
        3: { uid: 3, comment: 'Market', key: ['market'], wihero: { id: 'market', labels: ['town'], gates: ['tavern'] } },
        4: { uid: 4, comment: 'Tower', key: ['tower'], wihero: { id: 'tower', masks: [{ name: 'lit', content: 'x' }] } },
        5: { uid: 5, comment: 'Fork', key: ['fork'], wihero: { id: 'fork', switch: ['road', 'mill'] } },
        6: { uid: 6, comment: 'Old Well', key: ['well'] },
    } };
}
const graphOf = data => {
    const entries = Object.values(data.entries).map(e => ({ ...e, world: B }));
    return buildGraph(entries, buildModel(entries), B);
};
const node = (graph, key) => graph.nodes.get(key);

test('canvasOf creates an empty canvas; placeKey prefers the id', () => {
    const settings = {};
    assert.deepEqual(canvasOf(settings, B), { pos: {}, boxes: {}, areas: [], notes: [] });
    assert.equal(canvasOf(settings, B), settings.canvas[B]);
    assert.equal(placeKey({ kind: 'entry', id: 'mill', uid: 1 }), 'id:mill');
    assert.equal(placeKey({ kind: 'entry', uid: 6 }), 'uid:6');
    assert.equal(placeKey({ kind: 'label', key: '#town' }), '#town');
});

test('canvasLayout: saved places win, the rest come from the graph layout, pills and label boxes follow', () => {
    const data = book();
    const graph = graphOf(data);
    const auto = layout(graph);
    const canvas = canvasOf({}, B);
    canvas.pos['id:tower'] = { x: 900, y: 500 };
    const { pos } = canvasLayout(graph, auto, canvas);
    assert.deepEqual([pos.get('Book.4').x, pos.get('Book.4').y], [900, 500]);
    assert.deepEqual([pos.get('Book.0').x, pos.get('Book.0').y], [auto.pos.get('Book.0').x, auto.pos.get('Book.0').y]);
    assert.deepEqual(pos.get(maskKey('Book.4', 'lit')), { x: 916, y: 500 + CARD.h + CARD.pillGap, w: CARD.w - 16, h: CARD.pill });
    const box = pos.get(labelKey('town'));
    assert.ok(box.box && inside({ x: pos.get('Book.2').x + 1, y: pos.get('Book.2').y + 1 }, box) && inside({ x: pos.get('Book.3').x + 1, y: pos.get('Book.3').y + 1 }, box));
    canvas.boxes['#town'] = { x: 0, y: 0, w: 50, h: 50 };
    assert.deepEqual(canvasLayout(graph, auto, canvas).pos.get('#town'), { x: 0, y: 0, w: 50, h: 50, box: true });
    assert.equal(boxAround([]), null);
});

test('linkOptions depend on what the link joins', () => {
    const graph = graphOf(book());
    const types = (a, b) => linkOptions(node(graph, a), node(graph, b)).map(o => o.type);
    assert.deepEqual(types('Book.0', 'Book.4'), ['gate', 'closes', 'endsGlue']);
    assert.deepEqual(types('Book.5', 'Book.4'), ['gate', 'closes', 'endsGlue', 'switch'], 'a fork can take another path');
    assert.deepEqual(types('Book.0', '#town'), ['gatesFor', 'closes']);
    assert.deepEqual(types('#town', 'Book.4'), ['gate']);
    assert.deepEqual(types('Book.0', maskKey('Book.4', 'lit')), ['maskGate']);
    assert.deepEqual(types('Book.0', 'Book.0'), []);
});

test('applyLink writes each link type onto the right entry', () => {
    const data = book();
    const graph = graphOf(data);
    const taken = new Set(['road', 'mill', 'tavern', 'market', 'tower', 'fork']);
    const N = k => node(graph, k);
    assert.deepEqual(applyLink(data, N('Book.1'), N('Book.4'), 'gate', taken), [4]);
    assert.deepEqual(data.entries[4].wihero.gates, ['mill']);
    applyLink(data, N('Book.0'), N('#town'), 'gatesFor', taken);
    applyLink(data, N('Book.0'), N('#town'), 'closes', taken);
    assert.deepEqual([data.entries[0].wihero.gatesFor, data.entries[0].wihero.closes], [['#town'], ['#town']]);
    applyLink(data, N('#town'), N('Book.4'), 'gate', taken);
    assert.deepEqual(data.entries[4].wihero.gates, ['mill', '#town']);
    applyLink(data, N('Book.0'), N(maskKey('Book.4', 'lit')), 'maskGate', taken);
    assert.deepEqual(data.entries[4].wihero.masks[0].gates, ['road']);
    applyLink(data, N('Book.0'), N('Book.1'), 'endsGlue', taken);
    assert.deepEqual(data.entries[1].wihero.glue, { closeWhenFired: ['road'] });
    applyLink(data, N('Book.5'), N('Book.4'), 'switch', taken);
    assert.deepEqual(data.entries[5].wihero.switch, ['road', 'mill', 'tower']);
});

test('applyLink gives an entry without config an id', () => {
    const data = book();
    data.entries[6].wihero = { id: 'well', folder: 'x' };
    const graph = graphOf(data);
    delete data.entries[6].wihero.id;
    applyLink(data, node(graph, 'Book.0'), { ...node(graph, 'Book.6'), kind: 'entry', uid: 6 }, 'gate', new Set(['road']));
    assert.deepEqual(data.entries[6].wihero, { folder: 'x', id: 'old-well', gates: ['road'] });
});

test('setLabel adds and removes a label', () => {
    const entry = { uid: 6, comment: 'Old Well' };
    setLabel(entry, 'town', true, new Set());
    assert.deepEqual(entry.wihero, { id: 'old-well', labels: ['town'] });
    setLabel(entry, 'town', false, new Set());
    assert.deepEqual(entry.wihero, { id: 'old-well' });
});

test('newProblems reports what a link would break, with the engine\'s words', () => {
    const before = book();
    const after = structuredClone(before);
    after.entries[0].wihero.gates = ['mill'];
    assert.deepEqual(newProblems([], B, before, after, [0]), ['road: is in a gate loop: road → mill → road']);
    const fine = structuredClone(before);
    fine.entries[4].wihero.gates = ['road'];
    assert.deepEqual(newProblems([], B, before, fine, [4]), []);
});

test('pushUndo keeps the last few states', () => {
    const stack = [];
    for (let i = 0; i < 25; i++) pushUndo(stack, { i });
    assert.equal(stack.length, 20);
    assert.deepEqual(JSON.parse(stack.at(-1)), { i: 24 });
});
