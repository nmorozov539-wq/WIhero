import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine.js';
import { buildGraph, collapse, neighborhood, labelKey, maskKey } from '../src/graph.js';
import { layout, CARD } from '../src/layout.js';

const B = 'Book';
let uid = 0;
const e = (wihero, extra = {}) => ({ world: B, uid: uid++, comment: wihero?.id ?? 'plain', key: [wihero?.id ?? 'plain'], content: `text of ${wihero?.id}`, ...(wihero && { wihero }), ...extra });

function sample() {
    uid = 0;
    const entries = [
        e({ id: 'road', folder: 'Valley', color: 'green' }),
        e({ id: 'mill', gates: ['road'] }),
        e({ id: 'tunnel', gates: ['mill'] }),
        e({ id: 'fork', switch: ['left', 'right'] }),
        e({ id: 'left', gates: ['fork'] }),
        e({ id: 'right', gates: ['fork'] }),
        e({ id: 'storm', glue: { closeWhenFired: ['road'] } }),
        e({ id: 'tower', masks: [{ name: 'ruined', content: 'r', gates: ['storm'] }, { name: 'lit', content: 'l' }] }),
        e({ id: 'tavern', labels: ['town'] }),
        e({ id: 'market', labels: ['town'], gates: ['tavern'] }),
        e({ id: 'rumor', gates: ['#town'] }),
        e({ id: 'gatehouse', gatesFor: ['#town'] }),
        e({ id: 'blaze', closes: ['#town'] }),
        e(undefined),
        e({ folder: 'Valley' }),
        e({ id: 'lonely' }),
    ];
    const model = buildModel(entries);
    return { entries, model, graph: buildGraph(entries, model, B) };
}
const k = (entries, id) => `${B}.${entries.find(x => x.wihero?.id === id).uid}`;
const has = (graph, from, to, type) => graph.links.some(l => l.from === from && l.to === to && l.type === type);

test('buildGraph: every link type, label hubs and mask pills', () => {
    const { entries, graph } = sample();
    const K = id => k(entries, id);
    assert.ok(has(graph, K('road'), K('mill'), 'gate'));
    assert.ok(has(graph, K('fork'), K('left'), 'switch') && has(graph, K('fork'), K('right'), 'switch'));
    assert.ok(has(graph, K('road'), K('storm'), 'endsGlue'));
    assert.ok(has(graph, K('tower'), maskKey(K('tower'), 'ruined'), 'mask'));
    assert.ok(has(graph, K('storm'), maskKey(K('tower'), 'ruined'), 'maskGate'));
    assert.ok(has(graph, K('tavern'), labelKey('town'), 'member'));
    assert.ok(has(graph, labelKey('town'), K('rumor'), 'labelSource'));
    assert.ok(has(graph, K('gatehouse'), labelKey('town'), 'gatesFor'));
    assert.ok(has(graph, K('blaze'), labelKey('town'), 'closes'));
    assert.equal(graph.nodes.get(K('road')).color, 'green');
    assert.equal(graph.nodes.get(K('road')).folder, 'Valley');
});

test('buildGraph: entries without links are listed as unlinked, not drawn', () => {
    const { graph } = sample();
    assert.deepEqual(graph.unlinked.map(x => x.wihero?.id ?? x.wihero?.folder ?? 'vanilla'), ['vanilla', 'Valley', 'lonely']);
    assert.ok(![...graph.nodes.values()].some(n => n.id === 'lonely'));
});

test('buildGraph: an entry of another loaded book shows as an external node', () => {
    uid = 0;
    const other = { world: 'Other', uid: 0, wihero: { id: 'key' } };
    const door = e({ id: 'door', gates: ['key'] });
    const model = buildModel([other, door]);
    const graph = buildGraph([door], model, B);
    assert.equal(graph.nodes.get('Other.0').external, true);
});

test('layout: columns follow the links, rows never overlap, pills dock under their entry', () => {
    const { entries, graph } = sample();
    const { pos, width, height } = layout(graph);
    const K = id => k(entries, id);
    const col = id => pos.get(K(id)).x / CARD.col;
    assert.ok(col('road') < col('mill') && col('mill') < col('tunnel'));
    assert.ok(col('fork') < col('left'));
    assert.ok(pos.get(labelKey('town')).x > pos.get(K('tavern')).x);
    const tower = pos.get(K('tower'));
    const ruined = pos.get(maskKey(K('tower'), 'ruined'));
    assert.equal(ruined.y, tower.y + CARD.h + CARD.pillGap);
    assert.equal(pos.get(maskKey(K('tower'), 'lit')).y, ruined.y + CARD.pill + CARD.pillGap);
    const boxes = [...pos.entries()];
    for (const [a, p] of boxes) for (const [b, q] of boxes) {
        if (a < b) assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${a} overlaps ${b}`);
    }
    assert.ok(width > 0 && height > 0);
});

test('layout: loops do not hang and still give every node a place', () => {
    const graph = { nodes: new Map(['a', 'b', 'c'].map(key => [key, { key, kind: 'entry' }])), links: [
        { from: 'a', to: 'b', type: 'gate' }, { from: 'b', to: 'c', type: 'gate' }, { from: 'c', to: 'a', type: 'gate' }] };
    const { pos } = layout(graph);
    assert.equal(pos.size, 3);
});

test('layout: barycentre ordering keeps a chain on one row', () => {
    const nodes = new Map(['a1', 'b1', 'a2', 'b2'].map(key => [key, { key, kind: 'entry' }]));
    const graph = { nodes, links: [{ from: 'a1', to: 'a2', type: 'gate' }, { from: 'b1', to: 'b2', type: 'gate' }] };
    // a2 is listed after b2 in its column at first; the sweep puts it next to a1.
    const { pos } = layout({ nodes: new Map([...nodes].reverse()), links: graph.links });
    assert.equal(pos.get('a1').y, pos.get('a2').y);
    assert.equal(pos.get('b1').y, pos.get('b2').y);
});

test('collapse folds a label or a folder into one node and moves the links onto it', () => {
    const { entries, graph } = sample();
    const K = id => k(entries, id);
    const town = collapse(graph, new Set(['#town']));
    assert.ok(town.nodes.has('group:#town') && !town.nodes.has(K('tavern')) && !town.nodes.has(labelKey('town')));
    assert.ok(has(town, K('gatehouse'), 'group:#town', 'gatesFor'));
    assert.ok(has(town, 'group:#town', K('rumor'), 'labelSource'));
    assert.ok(!town.links.some(l => l.from === l.to));
    const valley = collapse(graph, new Set(['folder:Valley']));
    assert.equal(valley.nodes.get('group:folder:Valley').count, 1);
    assert.ok(has(valley, 'group:folder:Valley', K('mill'), 'gate'));
});

test('neighborhood keeps nodes within the depth, masks with their entry', () => {
    const { entries, graph } = sample();
    const K = id => k(entries, id);
    const one = neighborhood(graph, K('mill'), 1);
    assert.deepEqual(new Set([...one.nodes.keys()]), new Set([K('road'), K('mill'), K('tunnel')]));
    const two = neighborhood(graph, K('mill'), 2);
    assert.ok(two.nodes.has(K('storm')), 'road → storm (ends glue) is two steps away');
    const tower = neighborhood(graph, K('storm'), 1);
    assert.ok(tower.nodes.has(maskKey(K('tower'), 'ruined')));
});

test("layout: a gate into a mask pill puts the pill's entry after the source", () => {
    const { entries, graph } = sample();
    const { pos } = layout(graph);
    assert.ok(pos.get(k(entries, 'tower')).x > pos.get(k(entries, 'storm')).x);
});
