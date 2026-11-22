// Tidy (src/ui/canvas.js): the layout it applies, its idempotence, and the undo it hands back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CH, CW, LR, canvasBook, canvasSet, nodeRects, withFrames, buildGraph } from '../src/ui/canvas-graph.js';
import { tidyMemory, tidyPositions } from '../src/ui/canvas.js';

const sample = () => JSON.parse(fs.readFileSync(new URL('../examples/WIHero-Sample.json', import.meta.url), 'utf8'));
const overlap = (a, b, gap = 0) => Math.abs(a.x - b.x) < CW + gap && Math.abs(a.y - b.y) < CH + gap;
const placed = (data = sample()) => {
    const m = canvasBook(data);
    const g = buildGraph(m);
    const ids = canvasSet(m, g, []);
    return { m, ids };
};
const ent = (uid, id, config = {}) => ({ uid, comment: id, key: [id], content: '', extensions: { wihero: { id, ...config } } });
const book = (...entries) => ({ entries: Object.fromEntries(entries.map(x => [x.uid, x])) });

test('tidy is idempotent: a second tidy puts every card in the same place', () => {
    const { m, ids } = placed();
    const once = tidyPositions(m, ids);
    const twice = tidyPositions(m, ids);
    assert.deepEqual(twice, once);
});

test('tidy leaves no card overlapping another, and pack members stay inside their frame', () => {
    for (const dir of [undefined, LR]) {
        const { m, ids } = placed();
        const pos = tidyPositions(m, ids, dir);
        const keys = [...ids];
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
            assert.ok(!overlap(pos[keys[i]], pos[keys[j]], dir === LR ? 24 : 0), `${keys[i]} / ${keys[j]}`);
        }
        const g = withFrames(m, buildGraph(m), ids);
        const R = nodeRects(m, g, ids, pos);
        const frame = R.get('pack:town');
        assert.ok(frame, 'the sample has a pack frame');
        for (const key of frame.members) {
            const r = R.get(key);
            assert.ok(r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h, key);
        }
    }
});

test('tidy undo restores card positions, ports and the camera exactly', () => {
    const { m, ids } = placed();
    const memory = { cards: {}, camera: { x: 12, y: 34, zoom: 0.75 } };
    const first = [...ids][0];
    memory.cards[first] = { x: 7, y: 9, ports: { gout: 'l' }, layer: 'alt' };
    const before = structuredClone(memory.cards);
    const view = { tx: 40, ty: 50, scale: 0.9 };
    const undo = tidyMemory(m, memory, ids, view);
    assert.ok(memory.cards[first].x !== 7 || memory.cards[first].y !== 9, 'tidy moved the card');
    assert.equal(memory.cards[first].ports, undefined, 'tidy reset the ports');
    assert.equal(undo(), view, 'undo hands the camera back');
    assert.deepEqual(memory.cards, before, 'undo restored positions, ports and the layer');
    assert.deepEqual(memory.camera, { x: 12, y: 34, zoom: 0.75 }, 'the saved camera is untouched');
});

test('a cyclic book terminates and lays out the same way every time', () => {
    const data = book(
        ent(0, 'a', { gate: [['c']] }),
        ent(1, 'b', { gate: [['a']] }),
        ent(2, 'c', { gate: [['b']] }),
    );
    const { m, ids } = placed(data);
    const once = tidyPositions(m, ids);
    const twice = tidyPositions(m, ids);
    assert.equal(Object.keys(once).length, 3, 'every card is placed');
    assert.deepEqual(twice, once, 'the cycle is stable across runs');
    for (const k of ids) assert.ok(Number.isFinite(once[k].x) && Number.isFinite(once[k].y), k);
});
