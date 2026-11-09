// The rules of BUILD_SPEC 9.3, played through the engine with a stand-in for ST's scan (test/sim.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, normalize } from '../src/engine/model.js';
import { readState } from '../src/engine/state.js';
import { reopen, pickMask } from '../src/engine/manual.js';
import { keywordOnSide, stateForScan } from '../src/engine/turn.js';
import { e, Sim } from './sim.js';

const K = id => `Book/${id}`;
const fires = (sim, text, uid, reply) => sim.send(text, reply).includes(uid);
const problems = model => model.issues.filter(i => !i.warning).map(i => `${i.id ?? i.label}: ${i.message}`);
const warnings = model => model.issues.filter(i => i.warning).map(i => `${i.id ?? i.label}: ${i.message}`);

// ---------------------------------------------------------------- Gate rows

test('gate rows: AND inside a row, OR between rows', () => {
    const entries = [e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill' }), e(2, 'gold', { id: 'gold', gate: [['road', 'mill']] }), e(3, 'silver', { id: 'silver', gate: [['road'], ['mill']] })];
    const s = new Sim(entries);
    assert.ok(!fires(s, 'gold silver', 2));
    s.send('road');
    assert.deepEqual(s.send('gold silver').sort(), [3]);
    s.send('mill');
    assert.ok(fires(s, 'gold', 2));
});

test('pack readings: any, all and at least n', () => {
    const p = { packs: ['town'] };
    const entries = [e(0, 'inn', { id: 'inn', ...p }), e(1, 'smith', { id: 'smith', ...p }), e(2, 'well', { id: 'well', ...p }),
        e(3, 'any', { id: 'any', gate: [['#town']] }), e(4, 'two', { id: 'two', gate: [['#town:2']] }), e(5, 'all', { id: 'all', gate: [['#town:all']] })];
    const s = new Sim(entries);
    s.send('inn');
    assert.deepEqual(s.send('any two all').sort(), [3]);
    s.send('smith');
    assert.deepEqual(s.send('two all').sort(), [4]);
    s.send('well');
    assert.ok(fires(s, 'all', 5));
});

test('a pack reading of 0 is a problem, not a gate that is always met', () => {
    const entries = [e(0, 'inn', { id: 'inn', packs: ['town'] }), e(1, 'zero', { id: 'zero', gate: [['#town:0']] })];
    const s = new Sim(entries);
    assert.deepEqual(problems(s.model), ['zero: gate: "#town:0" counts from 1: use #town for any member']);
    assert.deepEqual(s.send('zero'), []);
});

test('a nested pack: a rule on town covers town/inn', () => {
    const s = new Sim([e(0, 'inn', { id: 'inn', packs: ['town/inn'] }), e(1, 'rumor', { id: 'rumor', gate: [['#town']] })]);
    s.send('inn');
    assert.ok(fires(s, 'rumor', 1));
});

test('Gates for adds AND on top of the target\'s own gate, also through a pack', () => {
    const entries = [e(0, 'road', { id: 'road' }), e(1, 'key', { id: 'key', gatesFor: ['mill', '#town'] }),
        e(2, 'mill', { id: 'mill', gate: [['road']] }), e(3, 'inn', { id: 'inn', packs: ['town'] })];
    const s = new Sim(entries);
    s.send('road');
    assert.deepEqual(s.send('mill inn'), [], 'own gate open, but the key has not fired');
    s.send('key');
    assert.deepEqual(s.send('mill inn').sort(), [2, 3]);
});

// ---------------------------------------------------------------- Locks

test('locks: not armed before the rest of the row, then latch and stay latched', () => {
    const entries = [e(0, 'mill', { id: 'mill' }), e(1, 'tunnel', { id: 'tunnel', gate: [['mill', { lock: ['red beard'] }]] })];
    const s = new Sim(entries);
    s.send('the red beard');
    s.send('mill');
    assert.ok(!fires(s, 'tunnel', 1), 'the phrase came before the mill fired');
    assert.ok(fires(s, 'tunnel, red beard', 1), 'a lock in the user message opens in the same reply (D1)');
    assert.ok(fires(s, 'tunnel again', 1), 'the latch survives later messages');
});

test('a lock in the reply opens from the next message (D1)', () => {
    const s = new Sim([e(0, 'mill', { id: 'mill' }), e(1, 'tunnel', { id: 'tunnel', gate: [['mill', { lock: ['red beard'] }]] })]);
    s.send('mill');
    assert.ok(!s.send('tunnel', 'A man with a red beard.').includes(1), 'the reply says it after the lore was picked');
    // The phrase is still in the previous reply, which is in the scan, but it was latched when the reply landed.
    assert.equal(Object.keys(s.state.latches).length, 1);
    assert.ok(fires(s, 'tunnel', 1));
});

test('a lock alone in a row is always armed; by limits which side counts', () => {
    const entries = [e(0, 'gate', { id: 'gate', gate: [[{ lock: ['open sesame'], by: 'user' }]] })];
    const s = new Sim(entries);
    s.send('nothing', 'open sesame');
    assert.ok(!fires(s, 'gate', 0), 'the reply said it, but only the user counts');
    assert.ok(fires(s, 'gate, open sesame', 0));
});

test('lock phrases match whole words, ignoring case', () => {
    const s = new Sim([e(0, 'cave', { id: 'cave', gate: [[{ lock: ['ring'] }]] })]);
    assert.ok(!fires(s, 'cave, a string', 0));
    assert.ok(fires(s, 'cave, the RING!', 0));
});

// ---------------------------------------------------------------- Waits

test('waits: counted from the row\'s done time, by side', () => {
    const entries = [e(0, 'storm', { id: 'storm' }), e(1, 'flood', { id: 'flood', gate: [['storm', { wait: 3 }]] }),
        e(2, 'calm', { id: 'calm', gate: [['storm', { wait: 2, by: 'user' }]] })];
    const s = new Sim(entries);
    s.send('storm'); // storm fires at the reply, index 2
    assert.deepEqual(s.send('flood calm'), [], 'user message 3 only: one message since');
    // Since the storm: user 3, reply 4, user 5 → 3 messages; 2 user messages.
    assert.deepEqual(s.send('flood calm').sort(), [1, 2]);
});

test('a wait alone counts from the chat start', () => {
    const s = new Sim([e(0, 'later', { id: 'later', gate: [[{ wait: 3 }]] })]);
    assert.ok(!fires(s, 'later', 0)); // user 1
    assert.ok(fires(s, 'later', 0)); // reply 2, user 3
});

test('a wait then a lock: the lock is armed once the wait runs out', () => {
    const s = new Sim([e(0, 'door', { id: 'door', gate: [[{ wait: 2 }, { lock: ['knock'] }]] })]);
    assert.ok(!fires(s, 'door, knock', 0), 'user 1: wait not run out');
    assert.ok(fires(s, 'door, knock', 0), 'reply 2 ran it out, user 3 knocks');
});

// ---------------------------------------------------------------- Closing

test('close gate: closes from the next message, and closed stays closed', () => {
    const s = new Sim([e(0, 'tower', { id: 'tower' }), e(1, 'storm', { id: 'storm', closeGate: [['tower']] })]);
    assert.ok(fires(s, 'storm', 1));
    s.send('tower');
    assert.ok(!fires(s, 'storm', 1));
    assert.deepEqual(s.state.closed[K('storm')].by, 'closeGate');
});

test('a close gate lock closes in the same reply when the user says it', () => {
    const s = new Sim([e(0, 'storm', { id: 'storm', closeGate: [[{ lock: ['the rain stops'] }]] })]);
    assert.ok(fires(s, 'storm', 0));
    assert.ok(!fires(s, 'storm, the rain stops', 0));
});

test('Closes for: the target closes when the source fires; closing beats opening', () => {
    const s = new Sim([e(0, 'blaze', { id: 'blaze', closesFor: ['#town'] }), e(1, 'inn', { id: 'inn', packs: ['town'] })]);
    assert.deepEqual(s.send('blaze inn'), [0], 'both mentioned: the inn closes and does not fire');
    assert.ok(!fires(s, 'inn', 1));
    assert.equal(s.state.closed[K('inn')].by, 'closesFor:Book/blaze');
});

test('switch: one path per fork, ties keep the first in switch order', () => {
    const entries = [e(0, 'fork', { id: 'fork', switch: ['left', 'right'] }), e(1, 'left', { id: 'left', gate: [['fork']] }), e(2, 'right', { id: 'right', gate: [['fork']] })];
    const s = new Sim(entries);
    s.send('fork');
    assert.deepEqual(s.send('right left'), [1]);
    assert.ok(s.state.closed[K('right')]);
    assert.ok(fires(s, 'left', 1));
    assert.ok(!fires(s, 'right', 2));
    const t = new Sim(entries);
    t.send('fork');
    assert.deepEqual(t.send('right'), [2]);
    assert.ok(!fires(t, 'left', 1));
});

test('Once: fires one time, closes from the next message', () => {
    const s = new Sim([e(0, 'omen', { id: 'omen', once: true })]);
    assert.ok(fires(s, 'omen', 0));
    assert.ok(!fires(s, 'omen', 0));
    assert.equal(s.state.closed[K('omen')].by, 'once');
});

test('D3: an entry closed this turn didn\'t happen (Bridge stays open)', () => {
    const entries = [e(0, 'tunnel', { id: 'tunnel', closesFor: ['mill'] }), e(1, 'mill', { id: 'mill', closesFor: ['bridge'] }), e(2, 'bridge', { id: 'bridge' })];
    const s = new Sim(entries);
    assert.deepEqual(s.send('tunnel mill bridge').sort(), [0, 2]);
    const state = s.state;
    assert.ok(state.closed[K('mill')]);
    assert.ok(!state.closed[K('bridge')]);
    assert.ok(fires(s, 'bridge', 2));
});

test('D3: entries that close each other in a loop all close', () => {
    const s = new Sim([e(0, 'cat', { id: 'cat', closesFor: ['dog'] }), e(1, 'dog', { id: 'dog', closesFor: ['cat'] })]);
    assert.deepEqual(s.send('cat dog'), []);
    assert.ok(s.state.closed[K('cat')] && s.state.closed[K('dog')]);
});

test('a running sticky still finishes after its entry closes', () => {
    const s = new Sim([e(0, 'blaze', { id: 'blaze', closesFor: ['ferry'] }), e(1, 'ferry', { id: 'ferry' })]);
    s.send('ferry');
    s.sticky.add('Book.1'); // ST holds the ferry by sticky
    assert.deepEqual(s.send('blaze').sort(), [0, 1], 'closed this turn but its sticky keeps it in');
    assert.ok(s.state.closed[K('ferry')]);
    assert.ok(fires(s, 'nothing', 1), 'still held while the sticky runs');
    s.sticky.clear();
    assert.ok(!fires(s, 'ferry', 1));
});

// ---------------------------------------------------------------- Glue

test('hold: starts on the first firing, stays every turn, ends through its close gate', () => {
    const entries = [e(0, 'storm', { id: 'storm', glue: { mode: 'hold' }, closeGate: [[{ lock: ['storm passes'] }]] })];
    const s = new Sim(entries);
    assert.ok(fires(s, 'storm', 0));
    assert.ok(fires(s, 'nothing', 0));
    assert.ok(s.state.holding[K('storm')]);
    assert.ok(!fires(s, 'the storm passes', 0), 'any close ends glue, the same reply for a user lock');
    assert.ok(!s.state.holding[K('storm')]);
    assert.equal(s.state.closed[K('storm')].wasHolding, true);
});

test('hold ends on any close, also from Closes for', () => {
    const s = new Sim([e(0, 'storm', { id: 'storm', glue: { mode: 'hold' } }), e(1, 'sun', { id: 'sun', closesFor: ['storm'] })]);
    s.send('storm');
    assert.deepEqual(s.send('sun'), [1]);
    assert.ok(!fires(s, 'x', 0));
});

test('ride along: fires only with its host, stops when the host closes or is a victim', () => {
    const entries = [e(0, 'tunnel', { id: 'tunnel', closeGate: [['exit']] }), e(1, 'echo', { id: 'echo', glue: { mode: 'ride', host: 'tunnel' } }),
        e(2, 'exit', { id: 'exit' }), e(3, 'cave', { id: 'cave', closesFor: ['tunnel'] })];
    const s = new Sim(entries);
    assert.deepEqual(s.send('echo'), [], 'no host, no ride');
    assert.deepEqual(s.send('tunnel').sort(), [0, 1]);
    assert.deepEqual(s.send('cave tunnel echo').sort(), [3], 'host closed this turn: the rider is dropped');
    const t = new Sim(entries);
    t.send('tunnel');
    t.send('exit');
    assert.deepEqual(t.send('tunnel echo'), [], 'host closed: nothing to ride');
});

test('a rider with its own gate only rides once that gate is open', () => {
    const s = new Sim([e(0, 'tunnel', { id: 'tunnel' }), e(1, 'echo', { id: 'echo', gate: [['bat']], glue: { mode: 'ride', host: 'tunnel' } }), e(2, 'bat', { id: 'bat' })]);
    assert.deepEqual(s.send('tunnel'), [0]);
    s.send('bat');
    assert.deepEqual(s.send('tunnel').sort(), [0, 1]);
});

test('the on/off switch is a pause: a hold carries on when turned back on (D4)', () => {
    const entries = [e(0, 'storm', { id: 'storm', glue: { mode: 'hold' } })];
    const s = new Sim(entries);
    s.send('storm');
    entries[0].disable = true;
    assert.deepEqual(s.send('storm'), []);
    assert.ok(s.state.holding[K('storm')], 'state untouched');
    entries[0].disable = false;
    assert.ok(fires(s, 'x', 0));
});

test('an off entry still follows the story: its close gate closes it, and it comes back closed (D4)', () => {
    const entries = [e(0, 'storm', { id: 'storm', closeGate: [['dawn']] }), e(1, 'dawn', { id: 'dawn' })];
    const s = new Sim(entries);
    s.send('storm');
    entries[0].disable = true;
    s.send('dawn');
    assert.ok(s.state.closed[K('storm')], 'closed while off');
    entries[0].disable = false;
    assert.ok(!fires(s, 'storm', 0));
});

// ---------------------------------------------------------------- Masks

test('masks: the last open mask wins; a mask close gate turns it off; main below', () => {
    const entries = [e(0, 'storm', { id: 'storm' }), e(1, 'dawn', { id: 'dawn' }), e(2, 'fire', { id: 'fire' }),
        e(3, 'tower', { id: 'tower', masks: [{ name: 'ruined', content: 'R', gate: [['storm']] }, { name: 'lit', content: 'L', gate: [['fire']], closeGate: [['dawn']] }] })];
    const s = new Sim(entries);
    s.send('tower');
    assert.equal(s.maskOf(3), null);
    s.send('storm');
    s.send('tower');
    assert.equal(s.maskOf(3), 'ruined');
    s.send('fire');
    s.send('tower');
    assert.equal(s.maskOf(3), 'lit');
    s.send('dawn');
    s.send('tower');
    assert.equal(s.maskOf(3), 'ruined');
    assert.ok(s.state.masks.closed[`${K('tower')}/lit`] !== undefined);
});

test('masks: a hand pick wins; a mask without a gate is only used by hand', () => {
    const entries = [e(0, 'tower', { id: 'tower', masks: [{ name: 'lit', content: 'L' }] })];
    const s = new Sim(entries);
    s.send('tower');
    assert.equal(s.maskOf(0), null);
    const last = s.chat.at(-1);
    last.extra.wihero = pickMask(last.extra.wihero, K('tower'), 'lit');
    s.send('tower');
    assert.equal(s.maskOf(0), 'lit');
});

test('a malformed mask is skipped and the entry keeps working', () => {
    const model = buildModel([e(0, 'tower', { id: 'tower', masks: [{ name: 'x' }, { name: 'ok', content: 'C', gate: [['tower2']] }] }), e(1, 'tower2', { id: 'tower2' })]);
    const node = model.nodes.get(K('tower'));
    assert.equal(node.blocked, false);
    assert.deepEqual(node.masks.map(m => m.name), ['ok']);
    assert.match(model.issues[0].message, /mask "x" has no content; it is skipped/);
    assert.equal(model.issues[0].warning, true, 'a skipped mask is a warning: the entry still fires');
});

test('a mask closed this turn by a firing entry is not used (closing beats opening)', () => {
    const entries = [e(0, 'fire', { id: 'fire' }), e(1, 'dawn', { id: 'dawn' }),
        e(2, 'tower', { id: 'tower', masks: [{ name: 'lit', content: 'L', gate: [['fire']], closeGate: [['dawn']] }] })];
    const s = new Sim(entries);
    s.send('fire');
    s.send('tower dawn');
    assert.equal(s.maskOf(2), null);
});

// ---------------------------------------------------------------- Who triggers

test('who triggers: kept only when the allowed side said a keyword', () => {
    const globals = { depth: 4, caseSensitive: false, matchWholeWords: true };
    const entry = { key: ['wolf'], scanDepth: null };
    const chat = [{ mes: 'hi' }, { is_user: true, mes: 'a wolf!' }, { mes: 'no' }];
    assert.equal(keywordOnSide(entry, chat, 'user', globals), true);
    assert.equal(keywordOnSide(entry, chat, 'char', globals), false);
    assert.equal(keywordOnSide({ ...entry, scanDepth: 1 }, chat, 'user', globals), false, 'outside its scan depth');
    assert.equal(keywordOnSide({ key: ['/wol./i'] }, chat, 'user', globals), true, 'regex keys');
    assert.equal(keywordOnSide({ key: ['wol'] }, chat, 'user', globals), false, 'whole words');
});

test('who triggers: the dropped entry (here: matched only through recursion) does not fire', () => {
    const s = new Sim([e(0, 'wolf', { id: 'wolf', by: 'user' })]);
    s.byDropped = map => new Set([...map.keys()].filter(k => !keywordOnSide(map.get(k), s.chat.slice(-1), 'user', { depth: 1, caseSensitive: false, matchWholeWords: true })));
    assert.ok(!fires(s, 'nothing', 0, 'Reply mentions wolf.'));
    assert.ok(!fires(s, 'nothing', 0), 'the reply said it: not allowed');
    assert.ok(fires(s, 'a wolf', 0));
});

// ---------------------------------------------------------------- State

test('state rewinds on swipe and delete', () => {
    const s = new Sim([e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill', gate: [['road']] })]);
    s.send('road');
    assert.equal(s.state.fired[K('road')], 1);
    s.swipe();
    assert.equal(s.state.fired[K('road')], 1, 'swipe: worked out again from before the reply, the road fires again in the new swipe');
    s.chat.splice(1); // delete back to the greeting
    assert.equal(s.state.fired[K('road')], undefined);
    assert.ok(!fires(s, 'mill', 1));
});

test('continue: the fired set is the union of both parts', () => {
    const s = new Sim([e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill' })]);
    s.send('road');
    s.chat.push({ is_user: true, mes: 'mill' });
    s.generate('first');
    s.chat[s.chat.length - 2].mes = 'road'; // what the continue scan sees
    s.continue();
    const state = s.chat.at(-1).extra.wihero;
    assert.equal(state.fired[K('mill')], 1);
    assert.equal(state.fired[K('road')], 2, 'counted once for this turn');
});

test('a v1 snapshot from the old build reads as v2', () => {
    const model = buildModel([e(0, 'mill', { id: 'mill' }), e(1, 'storm', { id: 'storm' })]);
    const state = readState({ v: 1, fired: { mill: 2 }, closed: { mill: true }, glued: { storm: { seen: [] } }, masks: { mill: 'x' }, round: ['Book.0'] }, { at: 7, keyOfId: id => model.nodes.get(K(id))?.key });
    assert.deepEqual(state.fired, { [K('mill')]: 2 });
    assert.deepEqual(state.firstAt, { [K('mill')]: 7 });
    assert.ok(state.closed[K('mill')]);
    assert.deepEqual(state.holding, { [K('storm')]: { since: 7 } });
    assert.deepEqual(state.masks.pick, { [K('mill')]: 'x' });
    const chat = [{ mes: 'hi' }, { is_user: true, mes: 'x' }, { mes: 'y', extra: { wihero: { v: 1, fired: { mill: 1 }, closed: {}, glued: {}, masks: {}, round: [] } } }];
    assert.equal(stateForScan(chat, model).fired[K('mill')], 1);
});

test('editing a row forgets its latch', () => {
    const entries = [e(0, 'cave', { id: 'cave', gate: [[{ lock: ['ring'] }]] })];
    const s = new Sim(entries);
    assert.ok(fires(s, 'cave ring', 0));
    entries[0].extensions.wihero.gate = [[{ lock: ['ring', 'band'] }]];
    s.rebuild();
    assert.ok(!fires(s, 'cave', 0));
});

test('renamed books keep their state', () => {
    const state = readState({ v: 2, fired: { 'Old/mill': 1 }, firstAt: {}, lastAt: {}, closed: {}, holding: {}, latches: { 'Old/mill|g|1|0': 3 }, baseline: {}, masks: {}, round: ['Old.4'] }, { renamed: { Old: 'New' } });
    assert.deepEqual(state.fired, { 'New/mill': 1 });
    assert.deepEqual(Object.keys(state.latches), ['New/mill|g|1|0']);
    assert.deepEqual(state.round, ['New.4']);
});

test('a rename of "a" leaves the round keys of a book called "a.b" alone (review finding 9)', () => {
    const state = readState({ v: 2, fired: {}, firstAt: {}, lastAt: {}, closed: {}, holding: {}, latches: {}, baseline: {}, masks: {}, round: ['a.3', 'a.b.3', 'x.y.1'] }, { renamed: { a: 'Z', 'x.y': 'W' } });
    assert.deepEqual(state.round, ['Z.3', 'a.b.3', 'W.1']);
});

test('keys are per book: two books with a "mill" never mix', () => {
    const entries = [e(0, 'mill', { id: 'mill' }, { world: 'A' }), e(0, 'grain', { id: 'mill' }, { world: 'B' }), e(1, 'flour', { id: 'flour', gate: [['mill']] }, { world: 'B' })];
    const s = new Sim(entries);
    s.send('mill');
    assert.deepEqual(s.send('flour'), [], 'A/mill fired, B/mill did not');
    s.send('grain');
    assert.ok(s.send('flour').length);
});

// ---------------------------------------------------------------- Greetings

const greet = n => ({ greeting: n, char: 'Sera.png', name: 'Sera', fp: `fp${n}` });
const fpOf = (char, n) => char === 'Sera.png' ? (n < 3 ? `fp${n}` : null) : undefined;

test('greetings: the opening greeting counts as fired at index 0, and only that one', () => {
    const entries = [e(0, 'forest', { id: 'forest', gate: [[greet(1)]] }), e(1, 'town', { id: 'town', gate: [[greet(0)]] })];
    const s = new Sim(entries, { greeting: '@Sera.png:1', modelOptions: { greetingFp: fpOf } });
    assert.deepEqual(s.send('forest town'), [0]);
    assert.equal(s.state.firstAt['@Sera.png:1'], 0);
});

test('greetings: swiping the greeting before the first reply switches the scenario', () => {
    const entries = [e(0, 'forest', { id: 'forest', gate: [[greet(1)]] }), e(1, 'town', { id: 'town', gate: [[greet(0)]] })];
    const s = new Sim(entries, { greeting: '@Sera.png:0' });
    assert.deepEqual(stateForScan(s.chat, s.model, { greeting: '@Sera.png:0' }).fired, { '@Sera.png:0': 1 });
    s.options.greeting = '@Sera.png:1'; // the user swiped the greeting
    assert.deepEqual(s.send('forest town'), [0]);
});

test('greetings: a fingerprint mismatch blocks the greeting until re-picked', () => {
    const entries = [e(0, 'forest', { id: 'forest', gate: [[{ ...greet(1), fp: 'old' }]] })];
    const s = new Sim(entries, { greeting: '@Sera.png:1', modelOptions: { greetingFp: fpOf } });
    assert.deepEqual(s.send('forest'), []);
    assert.match(problems(s.model).join(), /Sera's Alt 1 changed/);
    assert.equal(s.model.nodes.get(K('forest')).blocked, false);
});

test('greetings: Gates for and Closes for from a greeting, through a pack, reach a member added later', () => {
    const entries = [
        e(0, 'inn', { id: 'inn', packs: ['town'], gatedBy: [{ ...greet(0), via: '#town' }] }),
        e(1, 'cave', { id: 'cave', packs: ['wild'], closeGate: [[{ ...greet(0), via: '#wild' }]] }),
    ];
    const s = new Sim(entries, { greeting: '@Sera.png:1' });
    assert.deepEqual(s.send('inn cave'), [1], 'opened with Alt 1: the town waits for the main greeting');
    entries.push(e(2, 'smith', { id: 'smith', packs: ['town'] }), e(3, 'wolf', { id: 'wolf', packs: ['wild'] }));
    s.rebuild();
    assert.deepEqual(s.send('smith wolf').sort(), [3]);
    const t = new Sim(entries, { greeting: '@Sera.png:0' });
    assert.deepEqual(t.send('inn smith cave wolf').sort(), [0, 2], 'the main greeting gates the town in and closes the wild');
});

test('greetings: a missing character is a warning, and its greeting never fires', () => {
    const model = buildModel([e(0, 'x', { id: 'x', gate: [[{ greeting: 0, char: 'Gone.png', name: 'Gone' }]] })], { greetingFp: fpOf });
    assert.match(warnings(model).join(), /Gone, a character that is missing/);
});

// ---------------------------------------------------------------- Manual

test('Reopen restores holding and resets the close baseline (D5)', () => {
    const entries = [e(0, 'storm', { id: 'storm', glue: { mode: 'hold' }, closeGate: [['sun']] }), e(1, 'sun', { id: 'sun' })];
    const s = new Sim(entries);
    s.send('storm');
    s.send('sun');
    assert.ok(s.state.closed[K('storm')]);
    const last = s.chat.at(-1);
    last.extra.wihero = reopen(s.state, K('storm'), s.chat.length);
    assert.ok(s.state.holding[K('storm')], 'holding again');
    assert.ok(fires(s, 'nothing', 0), 'the sun fired before the reopen, so it no longer counts');
    s.send('sun');
    assert.ok(!fires(s, 'x', 0), 'a new sun closes it again');
});

test('Reopen rewinds with the chat', () => {
    const s = new Sim([e(0, 'omen', { id: 'omen', once: true })]);
    s.send('omen');
    const last = s.chat.at(-1);
    const before = last.extra.wihero;
    last.extra.wihero = reopen(before, K('omen'), s.chat.length);
    assert.ok(!s.state.closed[K('omen')]);
    last.extra.wihero = before; // e.g. a swipe back
    assert.ok(s.state.closed[K('omen')]);
});

// ---------------------------------------------------------------- Problems

test('problems block an entry; warnings don\'t', () => {
    const model = buildModel([
        e(0, 'a', { id: 'a', gate: [['nope']] }),
        e(1, 'b', { id: 'dup' }), e(2, 'c', { id: 'dup' }),
        e(3, 'd', { id: 'd', gatesFor: ['d'] }),
        e(4, 'f', { id: 'f', gate: [['g']] }), e(5, 'g', { id: 'g', gate: [['f']] }),
        e(6, 'h', { id: 'h', switch: ['i'] }), e(7, 'i', { id: 'i' }),
        e(8, 'j', { id: 'j', glue: { mode: 'ride', host: '#town' } }),
        e(9, 'k', { id: 'k', glue: { mode: 'hold' } }, { cooldown: 3 }),
        e(10, 'l', { id: 'l', packs: ['p'], gatesFor: ['#p'] }),
        e(11, 'm', { id: 'm', closeGate: [['m']] }),
        e(12, 'n', { id: 'n', glue: { mode: 'ride', host: 'n' } }),
    ]);
    const p = problems(model).join('\n');
    for (const re of [/a: gate: links to "nope"/, /dup: id "dup" is used by more than one entry/, /d: gatesFor targets itself/, /f: is in a loop/, /g: is in a loop/,
        /h: a switch needs at least two paths/, /j: ride-along glue can't ride a pack/, /l: gatesFor #p includes this entry itself/, /m: close gate names this entry itself/, /n: rides along with itself/]) assert.match(p, re);
    const w = warnings(model).join('\n');
    assert.match(w, /k: has a cooldown/);
    assert.match(w, /k: holds with nothing that can close it/);
    assert.ok(model.nodes.get(K('a')).blocked);
    assert.ok(!model.nodes.get(K('k')).blocked);
});

test('a loop broken by another row is not a problem', () => {
    const model = buildModel([e(0, 'a', { id: 'a', gate: [['b'], ['c']] }), e(1, 'b', { id: 'b', gate: [['a']] }), e(2, 'c', { id: 'c' })]);
    assert.deepEqual(problems(model), []);
});

test('warns about a switch path not gated on its fork, and a gate row the close gate always beats', () => {
    const model = buildModel([e(0, 'fork', { id: 'fork', switch: ['l', 'r'] }), e(1, 'l', { id: 'l', gate: [['fork']] }), e(2, 'r', { id: 'r' }),
        e(3, 'x', { id: 'x', gate: [['l']], closeGate: [['l']] })]);
    const w = warnings(model).join('\n');
    assert.match(w, /r: switch path "r" doesn't gate on fork/);
    assert.match(w, /x: its close gate is always met before gate row/);
});

test('an entry with a problem is removed at load and never fires', () => {
    const s = new Sim([e(0, 'a', { id: 'a', gate: [['nope']] })]);
    assert.ok(!fires(s, 'a', 0));
});

// ---------------------------------------------------------------- Data

test('old field names normalize (BUILD_SPEC 2.3)', () => {
    assert.deepEqual(normalize({ id: 'b', gates: ['a', '#t'] }).config, { id: 'b', gate: [['a', '#t']], closesFor: ['a'] });
    assert.deepEqual(normalize({ id: 'b', gates: ['a', 'c'], gateMode: 'any', closeGates: false }).config, { id: 'b', gate: [['a'], ['c']] });
    assert.deepEqual(normalize({ id: 'b', closes: ['#t'], labels: ['u'] }).config, { id: 'b', closesFor: ['#t'], packs: ['u'] });
    assert.deepEqual(normalize({ id: 's', glue: { closeKeywords: ['calm'], closeWhenFired: ['x', 'y'], closeWhenAllFired: ['p', 'q'] } }).config,
        { id: 's', glue: { mode: 'hold' }, closeGate: [['x'], ['y'], ['p', 'q'], [{ lock: ['calm'] }]] });
    assert.deepEqual(normalize({ id: 's', glue: true }).config, { id: 's', glue: { mode: 'hold' } });
    assert.deepEqual(normalize({ id: 't', masks: [{ name: 'm', content: 'c', gates: ['a', 'b'], gateMode: 'any' }] }).config, { id: 't', masks: [{ name: 'm', content: 'c', gate: [['a'], ['b']] }] });
    const { ui, config, legacy } = normalize({ id: 'x', folder: 'Places', color: 'red' });
    assert.deepEqual([ui, config, legacy], [{ folder: 'Places', color: 'red' }, { id: 'x' }, true]);
    const fresh = { id: 'x', gate: [['a']] };
    assert.equal(normalize(fresh).legacy, false);
});

test('a top-level wihero (the old build) is read like extensions.wihero', () => {
    const model = buildModel([{ world: 'Book', uid: 0, key: ['a'], wihero: { id: 'a' } }, { world: 'Book', uid: 1, key: ['b'], wihero: { id: 'b', gates: ['a'] } }]);
    assert.deepEqual(problems(model), []);
    assert.equal(model.nodes.get(K('a')).closes[0].kind, 'closesFor', 'the old "story moves on" default');
});
