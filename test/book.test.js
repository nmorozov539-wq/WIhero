import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookIds, newId, upgradeBook, writeConfig } from '../src/book.js';
import { buildModel } from '../src/engine/model.js';
import { convertCharacterBook, convertWorldInfoToCharacterBook } from './fixtures/card-book.js';

test('writeConfig sets extensions.wihero without replacing extensions, and drops the old top-level field', () => {
    const data = { entries: { 3: { uid: 3, wihero: { id: 'old' }, extensions: { other: 1 } }, 4: { uid: 4 } } };
    writeConfig(data, 3, { id: 'mill' });
    assert.deepEqual(data.entries[3], { uid: 3, extensions: { other: 1, wihero: { id: 'mill' } } });
    writeConfig(data, 4, { id: 'road' });
    assert.deepEqual(data.entries[4].extensions, { wihero: { id: 'road' } }, 'creates extensions when missing');
    writeConfig(data, 3, null);
    assert.deepEqual(data.entries[3].extensions, { other: 1 });
});

test('writeConfig keeps a card-imported book\'s originalData in sync', () => {
    const data = { entries: { 0: { uid: 0, extensions: {} } }, originalData: { entries: [{ id: 0, keys: ['a'], extensions: { position: 1 } }] } };
    writeConfig(data, 0, { id: 'a' });
    assert.deepEqual(data.originalData.entries[0].extensions, { position: 1, wihero: { id: 'a' } });
});

test('upgradeBook moves old books to the current shape and hands back the UI fields', () => {
    const data = { entries: {
        0: { uid: 0, wihero: { id: 'road', folder: 'Places' } },
        1: { uid: 1, wihero: { id: 'mill', gates: ['road'] } },
        2: { uid: 2, extensions: { wihero: { id: 'new', gate: [['road']] } } },
        3: { uid: 3, wihero: { color: 'red' } },
    } };
    const { changed, ui } = upgradeBook(data);
    assert.deepEqual(changed, [0, 1, 3]);
    assert.deepEqual(ui, { 0: { folder: 'Places' }, 3: { color: 'red' } });
    assert.deepEqual(data.entries[1], { uid: 1, extensions: { wihero: { id: 'mill', gate: [['road']], closesFor: ['road'] } } });
    assert.deepEqual(data.entries[3], { uid: 3 });
    assert.deepEqual(data.entries[2].extensions.wihero, { id: 'new', gate: [['road']] }, 'untouched');
});

test('new ids are slugs of the title, unique within the book', () => {
    const data = { entries: { 0: { uid: 0, comment: 'Old Mill', extensions: { wihero: { id: 'old-mill' } } } } };
    assert.equal(newId({ uid: 1, comment: 'Old Mill' }, bookIds(data)), 'old-mill-2');
    assert.equal(newId({ uid: 7 }, new Set()), 'entry-7');
    assert.equal(newId({ uid: 7, key: ['Café Noir'] }, new Set()), 'cafe-noir');
});

test('a book run through ST\'s card embedding and import keeps its story logic', () => {
    const entries = {
        0: { uid: 0, key: ['road'], comment: 'Road', content: 'R', order: 100, position: 0, disable: false, extensions: { wihero: { id: 'road' } } },
        1: { uid: 1, key: ['mill'], comment: 'Mill', content: 'M', order: 100, position: 1, disable: false, extensions: { other: true, wihero: { id: 'mill', gate: [['road', { lock: ['red beard'] }]], masks: [{ name: 'ruin', content: 'X', gate: [['road']] }] } } },
        2: { uid: 2, key: ['plain'], comment: 'Plain', content: 'P', order: 100, position: 0, disable: false },
    };
    const card = JSON.parse(JSON.stringify(convertWorldInfoToCharacterBook('Book', entries)));
    const back = convertCharacterBook(card);
    assert.deepEqual(back.entries[1].extensions.wihero, entries[1].extensions.wihero);
    assert.equal(back.entries[1].extensions.other, true);
    assert.equal(back.entries[2].extensions.wihero, undefined);
    const model = buildModel(Object.values(back.entries).map(x => ({ ...x, world: 'Book' })));
    assert.deepEqual(model.issues, []);
    assert.equal(model.nodes.get('Book/mill').opens.rows[0].locks[0].phrases[0], 'red beard');
});

test('a top-level wihero (the old build) is lost by the card round trip, which is why it moved', () => {
    const card = convertWorldInfoToCharacterBook('Book', { 0: { uid: 0, key: ['a'], wihero: { id: 'a' } } });
    assert.equal(convertCharacterBook(card).entries[0].wihero, undefined);
});
