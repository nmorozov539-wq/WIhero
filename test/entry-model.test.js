import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_FIELDS, TIMER_FIELDS, parseField, fieldText, formChanges, applyEntryChanges } from '../src/entry-model.js';

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
