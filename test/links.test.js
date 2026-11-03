// The piece bar's links (src/ui/links.js): Opens, Closes, Glue, rows, flips, locks, waits and switches land in
// the same stored shape the inspector writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookEditor } from '../src/ui/pieces.js';
import { addCond, addLink, condRowFor, findLink, flipLink, joinOf, readingOf, removeLink, setJoin, setReading, setSwitch, whyNot, whyNotFlip, pathsWait } from '../src/ui/links.js';
import { buildModel } from '../src/engine/model.js';

const book = () => ({
    entries: Object.fromEntries(['Road', 'Mill', 'Tunnel', 'Bridge', 'Inn'].map((comment, uid) => [uid, { uid, comment, key: [comment.toLowerCase()], content: comment }])),
});
const wh = (d, uid) => d.entries[uid].extensions?.wihero;
const E = uid => ({ t: 'entry', uid });
const issues = d => buildModel(Object.values(d.entries).map(e => ({ ...e, world: 'B' }))).issues.filter(i => !i.warning);
const greet = { t: 'greet', ref: { greeting: 0, char: 'Sera.png', name: 'Sera', fp: 'f' } };

test('Opens: B waits for A in a row of B\'s gate; both and either; a second link follows the choice', () => {
    const d = book();
    const ed = bookEditor(d);
    addLink(ed, d, 'open', E(0), E(1));
    assert.deepEqual(wh(d, 1).gate, [['road']]);
    assert.equal(joinOf(ed, 'open', E(1)), null, 'one row of one: ask');
    addLink(ed, d, 'open', E(3), E(1), { join: 'and' });
    assert.deepEqual(wh(d, 1).gate, [['road', 'bridge']]);
    assert.equal(joinOf(ed, 'open', E(1)), 'and');
    setJoin(ed, d, 'open', E(3), E(1), 'or');
    assert.deepEqual(wh(d, 1).gate, [['road'], ['bridge']]);
    assert.equal(joinOf(ed, 'open', E(1)), 'or');
    removeLink(ed, d, 'open', E(3), E(1));
    assert.deepEqual(wh(d, 1).gate, [['road']]);
    assert.deepEqual(issues(d), []);
});

test('turning around: a lone row moves with its lock; a shared row is left; a greeting can\'t wait', () => {
    const d = book();
    const ed = bookEditor(d);
    addLink(ed, d, 'open', E(0), E(1));
    const { at } = condRowFor(ed, d, 'open', E(0), E(1));
    addCond(ed, at.uid, at.field, at.mask, at.row, { lock: ['the old mill'] });
    addCond(ed, at.uid, at.field, at.mask, at.row, { wait: 2 });
    assert.deepEqual(wh(d, 1).gate, [['road', { wait: 2 }, { lock: ['the old mill'] }]], 'the wait goes before the lock');
    flipLink(ed, d, 'open', E(0), E(1));
    assert.equal(wh(d, 1).gate, undefined);
    assert.deepEqual(wh(d, 0).gate, [['mill', { wait: 2 }, { lock: ['the old mill'] }]]);

    addLink(ed, d, 'open', E(2), E(0), { join: 'and' });
    const out = flipLink(ed, d, 'open', E(2), E(0));
    assert.deepEqual(out.shared, ['mill']);
    assert.deepEqual(wh(d, 0).gate, [['mill', { wait: 2 }, { lock: ['the old mill'] }]]);
    assert.deepEqual(wh(d, 2).gate, [['road']]);

    addLink(ed, d, 'open', greet, E(4));
    assert.ok(findLink(ed, d, 'open', greet, E(4)));
    assert.match(whyNotFlip(ed, d, 'open', greet, E(4)), /greeting/);
    assert.match(whyNot('close', E(1), E(1)), /Once/);
});

test('links into a pack are Gates for and Closes for on the source; a pack source has a reading', () => {
    const d = book();
    const ed = bookEditor(d);
    ed.update(2, c => { c.packs = ['town']; });
    ed.update(4, c => { c.packs = ['town/inn']; });
    addLink(ed, d, 'open', E(0), { t: 'pack', name: 'town' });
    addLink(ed, d, 'close', E(1), { t: 'pack', name: 'town' });
    assert.deepEqual(wh(d, 0).gatesFor, ['#town']);
    assert.deepEqual(wh(d, 1).closesFor, ['#town']);
    assert.match(condRowFor(ed, d, 'open', E(0), { t: 'pack', name: 'town' }).why, /pack/);
    addLink(ed, d, 'open', { t: 'pack', name: 'town' }, E(3));
    setReading(ed, d, 'open', { t: 'pack', name: 'town' }, E(3), 2);
    assert.deepEqual(wh(d, 3).gate, [['#town:2']]);
    assert.equal(readingOf(ed, d, 'open', { t: 'pack', name: 'town' }, E(3)), 2);
    addLink(ed, d, 'open', greet, { t: 'pack', name: 'town' });
    assert.ok(findLink(ed, d, 'open', greet, { t: 'pack', name: 'town' }));
    removeLink(ed, d, 'open', greet, { t: 'pack', name: 'town' });
    assert.equal(findLink(ed, d, 'open', greet, { t: 'pack', name: 'town' }), null);
});

test('Closes stored as Closes for moves into a close gate row to take a lock; glue rides one host', () => {
    const d = book();
    const ed = bookEditor(d);
    ed.update(1, c => { c.closesFor = [ed.idOf(0)]; });
    const { at } = condRowFor(ed, d, 'close', E(1), E(0));
    assert.deepEqual(wh(d, 0).closeGate, [['mill']]);
    assert.equal(wh(d, 1).closesFor, undefined);
    addCond(ed, at.uid, at.field, at.mask, at.row, { lock: ['storm'], by: 'char' });
    assert.deepEqual(wh(d, 0).closeGate, [['mill', { lock: ['storm'], by: 'char' }]]);

    addLink(ed, d, 'ride', E(2), E(3));
    assert.deepEqual(wh(d, 3).glue, { mode: 'ride', host: 'tunnel' });
    addLink(ed, d, 'ride', E(4), E(3));
    assert.deepEqual(wh(d, 3).glue, { mode: 'ride', host: 'inn' }, 'a second host replaces the first');
    addLink(ed, d, 'ride', E(1), E(4));
    assert.match(whyNotFlip(ed, d, 'ride', E(4), E(3)), /one host/);
    assert.deepEqual(issues(d), []);
});

test('switch: paths in order, and they wait for the fork', () => {
    const d = book();
    const ed = bookEditor(d);
    addLink(ed, d, 'open', E(3), E(2));
    setSwitch(ed, d, E(0), [E(1), E(2)], true);
    assert.deepEqual(wh(d, 0).switch, ['mill', 'tunnel']);
    assert.deepEqual(wh(d, 1).gate, [['road']]);
    assert.deepEqual(wh(d, 2).gate, [['bridge', 'road']]);
    assert.ok(pathsWait(ed, d, E(0), [E(1), E(2)]));
    setSwitch(ed, d, E(0), [E(2), E(1)], false);
    assert.deepEqual(wh(d, 0).switch, ['tunnel', 'mill']);
    assert.equal(wh(d, 1).gate, undefined);
    assert.deepEqual(wh(d, 2).gate, [['bridge']]);
    assert.deepEqual(issues(d), []);
});
