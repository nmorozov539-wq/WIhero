import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, NO_FOLDER, normalizeFolder, inFolder, folderList, bulkEdit } from '../src/bulk.js';
import { buildModel, eligibility, initialState } from '../src/engine.js';

const book = () => ({
    entries: {
        0: { uid: 0, key: ['inn'], order: 100, probability: 100, depth: 4, disable: false, wihero: { folder: 'Town/Inn' } },
        1: { uid: 1, key: ['square', '/sq(uare)?/i'], order: 90, wihero: { id: 'sq', folder: 'Town', color: 'blue' } },
        2: { uid: 2, key: ['road'], order: 80 },
        3: { uid: 3, key: ['tower'], order: 70, wihero: { folder: 'Townhall' } },
    },
});

test('folders: normalized, nested, and listed with their parents', () => {
    assert.equal(normalizeFolder(' Town / Inn// '), 'Town/Inn');
    const { entries } = book();
    assert.deepEqual(Object.values(entries).filter(e => inFolder(e, 'Town')).map(e => e.uid), [0, 1], 'subfolders yes, Townhall no');
    assert.deepEqual(Object.values(entries).filter(e => inFolder(e, NO_FOLDER)).map(e => e.uid), [2]);
    assert.equal(Object.values(entries).filter(e => inFolder(e, '')).length, 4);
    assert.deepEqual(folderList(Object.values(entries)), ['Town', 'Town/Inn', 'Townhall']);
});

test('enable, disable, trigger %, depth and order offset change only the folder', () => {
    const data = book();
    assert.deepEqual(bulkEdit(data, 'Town', 'disable'), { count: 2 });
    assert.deepEqual([0, 1, 2, 3].map(i => !!data.entries[i].disable), [true, true, false, false]);
    bulkEdit(data, 'Town/Inn', 'enable');
    assert.equal(data.entries[0].disable, false);
    bulkEdit(data, 'Town', 'probability', '40');
    assert.deepEqual([data.entries[1].probability, data.entries[1].useProbability, data.entries[2].probability], [40, true, undefined]);
    bulkEdit(data, 'Town', 'depth', 2);
    assert.equal(data.entries[1].depth, 2);
    bulkEdit(data, 'Town', 'order', '-15');
    assert.deepEqual([data.entries[0].order, data.entries[1].order, data.entries[2].order], [85, 75, 80]);
});

test('keyword prefix skips regex keys and keys that already have it', () => {
    const data = book();
    bulkEdit(data, 'Town', 'prefix', 'town ');
    bulkEdit(data, 'Town', 'prefix', 'town ');
    assert.deepEqual(data.entries[1].key, ['town square', '/sq(uare)?/i']);
});

test('color sets wihero.color, and clearing it removes a config left empty', () => {
    const data = book();
    bulkEdit(data, NO_FOLDER, 'color', 'red');
    assert.deepEqual(data.entries[2].wihero, { color: 'red' });
    bulkEdit(data, NO_FOLDER, 'color', '');
    assert.ok(!('wihero' in data.entries[2]));
    assert.ok(Object.keys(COLORS).includes('blue'));
});

test('bad values are refused before anything changes', () => {
    const data = book();
    const before = structuredClone(data);
    assert.deepEqual(bulkEdit(data, 'Town', 'probability', '140'), { error: 'Enter a trigger % from 0 to 100.' });
    assert.deepEqual(bulkEdit(data, 'Town', 'depth', ''), { error: 'Enter a depth of 0 or more.' });
    assert.deepEqual(bulkEdit(data, 'Town', 'order', '1.5'), { error: 'Enter a whole number (negative to lower the order).' });
    assert.deepEqual(bulkEdit(data, 'Town', 'prefix', '  '), { error: 'Enter a prefix.' });
    assert.deepEqual(bulkEdit(data, 'Town', 'color', 'mauve'), { error: 'Pick one of the colors.' });
    assert.deepEqual(bulkEdit(data, 'Town', 'explode'), { error: 'unknown action explode' });
    assert.deepEqual(data, before);
});

test('a character-card book keeps originalData in sync, as ST\'s editor does', () => {
    const data = book();
    data.originalData = { entries: [{ uid: 1, enabled: true, insertion_order: 90, keys: ['square'], extensions: {} }] };
    bulkEdit(data, 'Town', 'disable');
    bulkEdit(data, 'Town', 'probability', 30);
    bulkEdit(data, 'Town', 'order', 5);
    bulkEdit(data, 'Town', 'prefix', 't-');
    assert.deepEqual(data.originalData.entries[0], {
        uid: 1, enabled: false, insertion_order: 95, keys: ['t-square', '/sq(uare)?/i'], extensions: { probability: 30 },
    });
});

test('folder and color alone never gate an entry', () => {
    const entries = [{ world: 'B', uid: 0, wihero: { folder: 'Town', color: 'red' } }, { world: 'B', uid: 1, wihero: { id: 'a', folder: 'Town' } }];
    const model = buildModel(entries);
    assert.deepEqual(model.issues, []);
    assert.equal(eligibility(entries[0], model, initialState()).reason, 'not gated');
    assert.equal(eligibility(entries[1], model, initialState()).reason, 'open');
});
