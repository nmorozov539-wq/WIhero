// The cheap AFTER_V1 additions: keyword clash finder, the static dead branch report and dice for switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/model.js';
import { deadBranches } from '../src/engine/dead.js';
import { keywordClashes } from '../src/ui/clashes.js';
import { e, Sim } from './sim.js';
import { diceRoll } from '../src/engine/turn.js';

const report = entries => Object.fromEntries(deadBranches(buildModel(entries), entries).map(f => [f.label, { dead: f.dead, reasons: f.reasons }]));

// ---------------------------------------------------------------- keyword clashes

test('clashes: the same key word in two entries, and a word inside a longer key', () => {
    const data = { entries: {
        1: { uid: 1, comment: 'Mill', key: ['mill', 'Wheel'] },
        2: { uid: 2, comment: 'Old Mill', key: ['old mill'] },
        3: { uid: 3, comment: 'Miller', key: ['miller', 'WHEEL '] },
        4: { uid: 4, comment: 'Off', key: ['mill'], disable: true },
        5: { uid: 5, comment: 'Regex', key: ['/mill/i'] },
    } };
    const c = keywordClashes(data);
    assert.deepEqual(c.groups, [{ word: 'mill', uids: [1, 2] }, { word: 'wheel', uids: [1, 3] }]);
    assert.deepEqual(c.of(1, 'mill'), ['Old Mill']);
    assert.deepEqual(c.of(2, 'old mill'), ['Mill']);
    assert.deepEqual(c.of(3, 'miller'), [], '"mill" is not a whole word of "miller"');
    assert.deepEqual(c.of(3, 'Wheel'), ['Mill']);
});

test('clashes: Permanent entries, Moments and entries pending delete are left out', () => {
    const data = { entries: {
        1: { uid: 1, comment: 'A', key: ['door'] },
        2: { uid: 2, comment: 'B', key: ['door'], constant: true },
        3: { uid: 3, comment: 'C', key: ['door'], extensions: { wihero: { id: 'c', moment: true } } },
        4: { uid: 4, comment: 'D', key: ['door'] },
    } };
    assert.equal(keywordClashes(data).groups.length, 1);
    assert.equal(keywordClashes(data, new Set([4])).groups.length, 0);
});

// ---------------------------------------------------------------- dead branches

test('dead branches: a row that needs both paths of one switch', () => {
    const r = report([
        e(0, 'fork', { id: 'fork', switch: ['left', 'right'] }),
        e(1, 'left', { id: 'left', gate: [['fork']] }),
        e(2, 'right', { id: 'right', gate: [['fork']] }),
        e(3, 'both', { id: 'both', gate: [['left', 'right']] }),
        e(4, 'either', { id: 'either', gate: [['left', 'right'], ['fork']] }),
    ]);
    assert.equal(r.both.dead, true);
    assert.match(r.both.reasons[0], /two paths of the fork switch/);
    assert.equal(r.either.dead, false);
    assert.equal(r.either.reasons.length, 1);
    assert.equal(r.left, undefined);
});

test('dead branches: nothing sets it off, and that spreads down the chain', () => {
    const r = report([
        e(0, null, { id: 'silent' }, { comment: 'silent' }),
        e(1, 'next', { id: 'next', gate: [['silent']] }),
        e(2, 'rider', { id: 'rider', glue: { mode: 'ride', host: 'next' } }),
        e(3, 'perm', { id: 'perm', gate: [['next']] }, { constant: true }),
    ]);
    assert.match(r.silent.reasons[0], /nothing sets it off/);
    assert.match(r.next.reasons[0], /needs silent, which can never fire/);
    assert.match(r.rider.reasons[0], /rides along with next/);
    assert.equal(r.perm.dead, true);
});

test('dead branches: pack readings count one path per switch', () => {
    const p = { packs: ['ways'] };
    const r = report([
        e(0, 'fork', { id: 'fork', switch: ['a', 'b'] }),
        e(1, 'a', { id: 'a', gate: [['fork']], ...p }),
        e(2, 'b', { id: 'b', gate: [['fork']], ...p }),
        e(3, 'c', { id: 'c', ...p }),
        e(4, 'two', { id: 'two', gate: [['#ways:2']] }),
        e(5, 'three', { id: 'three', gate: [['#ways:3']] }),
        e(6, 'all', { id: 'all', gate: [['#ways:all']] }),
    ]);
    assert.equal(r.two, undefined);
    assert.equal(r.three.dead, true);
    assert.match(r.three.reasons[0], /only 2 can ever fire/);
    assert.match(r.all.reasons[0], /two paths of the fork switch/);
});

test('dead branches: a mask that can never turn on; blocked entries are left to Problems', () => {
    const r = report([
        e(0, 'fork', { id: 'fork', switch: ['a', 'b'] }),
        e(1, 'a', { id: 'a', gate: [['fork']] }),
        e(2, 'b', { id: 'b', gate: [['fork']] }),
        e(3, 'inn', { id: 'inn', masks: [{ name: 'both', content: 'x', gate: [['a', 'b']] }] }),
        e(4, 'bad', { id: 'bad', gate: [['nope']] }),
    ]);
    assert.match(r.inn.reasons[0], /mask "both" can never turn on/);
    assert.equal(r.inn.dead, false);
    assert.equal(r.bad, undefined);
});

// ---------------------------------------------------------------- dice for switches

const diceBook = () => [
    e(0, 'crossroads', { id: 'fork', switch: ['left', 'right', 'ahead'], dice: true }),
    e(1, 'road', { id: 'left', gate: [['fork']] }),
    e(2, 'road', { id: 'right', gate: [['fork']] }),
    e(3, 'road', { id: 'ahead', gate: [['fork']] }),
];

test('dice: the fork picks one path when it first fires; the others close from the next message', () => {
    const s = new Sim(diceBook());
    s.send('the crossroads');
    const roll = s.state.rolls['Book/fork'];
    assert.ok(roll, 'the roll is saved in chat state');
    const closed = Object.keys(s.state.closed).sort();
    assert.equal(closed.length, 2);
    assert.ok(!closed.includes(roll.path));
    const uid = { 'Book/left': 1, 'Book/right': 2, 'Book/ahead': 3 }[roll.path];
    assert.deepEqual(s.send('down the road'), [uid]);
    assert.equal(s.state.closed[roll.path], undefined);
    s.send('the crossroads again');
    assert.deepEqual(s.state.rolls['Book/fork'], roll, 'a fork rolls only once');
});

test('dice: a swipe keeps the roll; rewriting the message before it rolls again', () => {
    const s = new Sim(diceBook());
    s.chat.push({ is_user: true, mes: 'the crossroads', name: 'User', send_date: 'a' });
    s.generate('Reply.');
    const first = s.state.rolls['Book/fork'].path;
    for (let i = 0; i < 3; i++) { s.swipe(`Swipe ${i}.`); assert.equal(s.state.rolls['Book/fork'].path, first); }
    // Going back: different words or a different time for the user's message give a new roll (eventually a new path).
    const seen = new Set();
    for (let i = 0; i < 30; i++) seen.add(diceRoll('Book/fork', [{}, { mes: 'the crossroads', send_date: `t${i}` }], 2) % 3);
    assert.equal(seen.size, 3);
});

test('dice: no roll when a path was already taken; dice without a switch is a warning', () => {
    const entries = [
        e(0, 'crossroads', { id: 'fork', switch: ['left', 'right'], dice: true }),
        e(1, 'left', { id: 'left' }),
        e(2, 'right', { id: 'right' }),
        e(3, 'lone', { id: 'lone', dice: true }),
    ];
    const s = new Sim(entries);
    s.send('left');
    s.send('crossroads');
    assert.equal(s.state.rolls['Book/fork'], undefined);
    assert.ok(s.model.issues.some(i => i.id === 'lone' && i.warning && /no switch/.test(i.message)));
});
