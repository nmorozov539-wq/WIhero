import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_FIELDS, TIMER_FIELDS, parseField, fieldText, formChanges, applyEntryChanges, unlinkedMentions, newId, gateOn } from '../src/entry-model.js';
import { buildModel } from '../src/engine.js';
import { buildGraph } from '../src/graph.js';

const spec = field => [...ENTRY_FIELDS, ...TIMER_FIELDS].find(s => s.field === field);
// The part of ST's originalWIDataKeyMap these tests touch.
const KEY_MAP = { comment: 'comment', key: 'keys', content: 'content', order: 'insertion_order', probability: 'extensions.probability', position: 'extensions.position', sticky: 'extensions.sticky' };

test('parseField reads every kind of field and refuses bad numbers', () => {
    assert.deepEqual(parseField(spec('key'), ' mill, wheel ,'), { value: ['mill', 'wheel'] });
    assert.deepEqual(parseField(spec('probability'), '40'), { value: 40 });
    assert.deepEqual(parseField(spec('probability'), '140'), { error: 'Trigger %: a whole number from 0 to 100' });
    assert.deepEqual(parseField(spec('scanDepth'), ''), { value: null });
    assert.deepEqual(parseField(spec('caseSensitive'), 'false'), { value: false });
    assert.deepEqual(parseField(spec('caseSensitive'), ''), { value: null });
    assert.deepEqual(parseField(spec('position'), '4'), { value: 4 });
    assert.deepEqual(parseField(spec('sticky'), '-1'), { error: 'Sticky (messages): a whole number from 0' });
    assert.equal(fieldText(spec('key'), ['a', 'b']), 'a, b');
    assert.equal(fieldText(spec('caseSensitive'), null), '');
});

test('formChanges lists only what changed, and the errors', () => {
    const entry = { comment: 'Mill', key: ['mill'], content: 'x', order: 100, disable: false };
    const form = { comment: 'Mill', key: 'mill, wheel', content: 'x', order: 'abc', disable: true };
    const specs = ['comment', 'key', 'content', 'order', 'disable'].map(spec);
    assert.deepEqual(formChanges(entry, specs, f => form[f]), {
        changes: { key: ['mill', 'wheel'], disable: true },
        errors: ['Order: a whole number'],
    });
});

test('applyEntryChanges writes the entry and keeps a card-imported book\'s originalData in sync', () => {
    const data = { entries: { 3: { uid: 3, comment: 'a', key: ['a'] } }, originalData: { entries: [{ uid: 3, keys: ['a'], extensions: {} }] } };
    applyEntryChanges(data, 3, { comment: 'b', key: ['b'], disable: true, probability: 50, position: 1, sticky: 2 }, KEY_MAP);
    assert.deepEqual(data.entries[3], { uid: 3, comment: 'b', key: ['b'], disable: true, probability: 50, useProbability: true, position: 1, sticky: 2 });
    assert.deepEqual(data.originalData.entries[0], {
        uid: 3, keys: ['b'], comment: 'b', enabled: false, position: 'after_char',
        extensions: { probability: 50, position: 1, sticky: 2 },
    });
    const plain = { entries: { 1: { uid: 1 } } };
    applyEntryChanges(plain, 1, { order: 5 }, KEY_MAP);
    assert.equal(plain.entries[1].order, 5);
});

test('unlinkedMentions finds whole-word mentions of the keywords in unlinked entries', () => {
    const W = 'B';
    const mill = { world: W, uid: 0, key: ['mill', '/mil+/i'], content: '', wihero: { id: 'mill' } };
    const village = { world: W, uid: 1, key: ['village'], content: 'The old Mill stands by the river.' };
    const windmill = { world: W, uid: 2, key: ['windmill'], content: 'A windmill, not a mill-race? Yes: the mill.' };
    const tunnel = { world: W, uid: 3, key: ['tunnel'], content: 'Behind the mill.', wihero: { id: 'tunnel', gates: ['mill'] } };
    const quiet = { world: W, uid: 4, key: ['quiet'], content: 'Milling about.' };
    const entries = [mill, village, windmill, tunnel, quiet];
    const graph = buildGraph(entries, buildModel(entries), W);
    assert.deepEqual(unlinkedMentions(entries, graph, mill).map(m => [m.entry.uid, m.keyword]), [[1, 'mill'], [2, 'mill']]);
    assert.deepEqual(unlinkedMentions(entries, graph, mill, new Set(['B.1'])).map(m => m.entry.uid), [2], 'ignored');
    assert.deepEqual(unlinkedMentions(entries, graph, { world: W, uid: 9, key: ['/x/'] }), [], 'only regex keys');
});

test('gateOn gives both entries ids when they need one and adds the gate once', () => {
    const data = { entries: { 0: { uid: 0, comment: 'Old Mill', wihero: { folder: 'Valley' } }, 1: { uid: 1, key: ['village'] }, 2: { uid: 2, comment: 'Old Mill' } } };
    const taken = new Set(['old-mill']);
    assert.deepEqual(gateOn(data, 1, 0, taken), { from: 'village', on: 'old-mill-2' });
    gateOn(data, 1, 0, taken);
    assert.deepEqual(data.entries[1].wihero, { id: 'village', gates: ['old-mill-2'] });
    assert.deepEqual(data.entries[0].wihero, { folder: 'Valley', id: 'old-mill-2' });
    assert.equal(newId(data.entries[2], new Set(['old-mill', 'old-mill-2'])), 'old-mill-3');
    assert.equal(newId({ uid: 7 }, new Set()), 'entry-7');
});
