// Editing story logic (src/ui/pieces.js): what the inspector writes lands in the book in BUILD_SPEC 2's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addMask, addPiece, addToList, addToRow, applyMovesOn, bookEditor, greetingRules, hasPiece, maskName, missingPieces,
    moveMaskUp, movesOn, packsOf, reading, refLabel, removeFromRow, repickGreeting, setGreetingRule, tidyConfig,
} from '../src/ui/pieces.js';
import { buildModel } from '../src/engine/model.js';

const book = () => ({
    entries: Object.fromEntries(['Road', 'Mill', 'Tunnel', 'Inn', 'Market'].map((comment, uid) => [uid, { uid, comment, key: [comment.toLowerCase()], content: comment }])),
});
const wh = (d, uid) => d.entries[uid].extensions?.wihero;
const ref = { greeting: 1, char: 'Sera.png', name: 'Sera', fp: 'abc' };

test('an entry gets an id from its name with its first piece, and the editor reports it', () => {
    const d = book();
    const ed = bookEditor(d);
    ed.update(1, (c, id) => { c.gate = addToRow(c.gate ?? [], null, ed.idOf(0)); });
    assert.deepEqual(wh(d, 1), { id: 'mill', gate: [['road']] });
    assert.deepEqual(wh(d, 0), { id: 'road' }, 'the target got an id too');
    assert.deepEqual(ed.created.sort(), [[0, 'road'], [1, 'mill']]);
    assert.deepEqual(buildModel(Object.values(d.entries).map(e => ({ ...e, world: 'B' }))).issues, []);
});

test('rows: AND inside a row, OR between rows; removing the last item drops the row; nothing empty is stored', () => {
    const rows = [];
    addToRow(rows, null, 'road');
    addToRow(rows, 0, '#town:all');
    addToRow(rows, 0, 'road');
    addToRow(rows, null, { lock: ['red beard'] });
    addToRow(rows, 1, { wait: 3 });
    assert.deepEqual(rows, [['road', '#town:all'], [{ lock: ['red beard'] }, { wait: 3 }]]);
    removeFromRow(rows, 1, 0);
    removeFromRow(rows, 1, 0);
    assert.deepEqual(rows, [['road', '#town:all']]);
    assert.deepEqual(tidyConfig({ id: 'x', gate: [[]], closesFor: [], once: false, by: null, masks: [] }), { id: 'x' });
    assert.deepEqual(addToList(['a'], 'a'), ['a']);
});

test('Story moves on writes Closes for to the gate\'s entries, once', () => {
    const c = { gate: [['road', '#town'], ['mill', { lock: ['x'] }]], closesFor: ['mill'] };
    assert.deepEqual(movesOn(c), { ids: ['road', 'mill'], missing: ['road'] });
    assert.deepEqual(applyMovesOn(c), ['road']);
    assert.deepEqual(c.closesFor, ['mill', 'road']);
    assert.deepEqual(movesOn(c).missing, []);
});

test('pieces: what can be added, Once not on glue, glue drops Once', () => {
    const c = {};
    assert.equal(missingPieces(c).length, 10);
    addPiece(c, 'once');
    assert.ok(hasPiece(c, 'once'));
    addPiece(c, 'glue');
    assert.deepEqual(c.glue, { mode: 'hold' });
    assert.equal(c.once, undefined);
    assert.ok(!missingPieces(c).some(p => p.key === 'once'));
    addPiece(c, 'by');
    assert.equal(c.by, 'user');
});

test('masks: names are slugs, unique; a new mask copies the main text; moving up lowers priority', () => {
    const c = {};
    assert.equal(addMask(c, 'Ruined tower', 'Main text').name, 'Ruined-tower');
    assert.equal(addMask(c, 'Ruined tower', '').name, 'Ruined-tower-2');
    assert.equal(c.masks[0].content, 'Main text');
    assert.ok(c.masks[1].content.length, 'never empty, or the model would skip it');
    moveMaskUp(c, 1);
    assert.deepEqual(c.masks.map(m => m.name), ['Ruined-tower-2', 'Ruined-tower']);
    assert.equal(maskName('!!', []), 'mask');
});

test('refs read as chips; pack readings are stored as BUILD_SPEC 2.2 says', () => {
    const name = id => ({ road: 'Road' })[id];
    assert.equal(refLabel('road', name).text, 'Road');
    assert.equal(refLabel('#town', name).text, 'any of #town');
    assert.equal(refLabel('#town:all', name).text, 'all of #town');
    assert.equal(refLabel('#town:2', name).text, '2 of #town');
    assert.equal(refLabel({ lock: ['a', 'b'] }, name).text, '"a" or "b"');
    assert.equal(refLabel({ wait: 1 }, name).text, '1 message');
    assert.equal(refLabel(ref, name).text, 'Sera · Alt 1');
    assert.deepEqual([reading('town'), reading('town', 'all'), reading('town', 3)], ['#town', '#town:all', '#town:3']);
});

test('packs used in a book include the parents of nested ones', () => {
    const d = book();
    const ed = bookEditor(d);
    ed.update(3, c => { c.packs = ['town/inn']; });
    ed.update(4, c => { c.packs = ['town']; });
    assert.deepEqual(packsOf(d), ['town', 'town/inn']);
});

test('greeting rules are written on the entries they touch, a pack target with via, and read back', () => {
    const d = book();
    const ed = bookEditor(d);
    ed.update(3, c => { c.packs = ['town']; });
    ed.update(4, c => { c.packs = ['town']; });
    setGreetingRule(ed, ref, 'gatesFor', ed.idOf(0), true);
    setGreetingRule(ed, ref, 'closesFor', '#town', true);
    ed.update(1, c => { c.gate = [[{ ...ref }, ed.idOf(0)]]; });
    assert.deepEqual(wh(d, 0).gatedBy, [ref]);
    assert.deepEqual(wh(d, 3).closeGate, [[{ ...ref, via: '#town' }]]);
    assert.deepEqual(wh(d, 4).closeGate, [[{ ...ref, via: '#town' }]]);
    const r = greetingRules(d, ref);
    assert.deepEqual(r, { gatesFor: ['road'], closesFor: ['#town'], usedBy: [1] });
    const model = buildModel(Object.values(d.entries).map(e => ({ ...e, world: 'B' })));
    assert.deepEqual(model.issues.filter(i => !i.warning), []);
    assert.ok(model.nodes.get('B/road').opens.all.some(i => i.type === 'greeting'));

    setGreetingRule(ed, ref, 'closesFor', '#town', false);
    assert.equal(wh(d, 3).closeGate, undefined);
    assert.equal(repickGreeting(ed, d, ref, 'new'), 2);
    assert.equal(wh(d, 0).gatedBy[0].fp, 'new');
    assert.equal(wh(d, 1).gate[0][0].fp, 'new');
});
