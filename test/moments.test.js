// Moments (CONCEPTS 3.13): a lock on its own card. Played through the engine with the stand-in scan (test/sim.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/model.js';
import { entryStatus } from '../src/engine/turn.js';
import { e, Sim } from './sim.js';

const K = id => `Book/${id}`;
/** A Moment as it is stored: phrases as keys, no content, switched off, "Moment: …". */
const m = (uid, phrases, config = {}) => ({ ...e(uid, phrases, { id: config.id ?? `m${uid}`, moment: true, ...config }, { comment: `Moment: ${phrases[0]}` }), content: '', disable: true });
const problems = model => model.issues.filter(i => !i.warning).map(i => `${i.id}: ${i.message}`);
const warnings = model => model.issues.filter(i => i.warning).map(i => `${i.id}: ${i.message}`);

test('a Moment said in the user message opens a gate in the reply to it; it stays happened', () => {
    const s = new Sim([m(0, ['missing tooth'], { id: 'tooth' }), e(1, 'dentist', { id: 'dentist', gate: [['tooth']] })]);
    assert.deepEqual(s.send('dentist'), [], 'not yet');
    assert.deepEqual(s.send('I have a missing tooth, find a dentist'), [1], 'the same reply');
    assert.deepEqual(s.send('dentist again'), [1], 'stays happened');
    assert.equal(s.state.fired[K('tooth')], 1, 'happened once, never counted again');
});

test('said in a reply, it acts from the next message; it never injects anything', () => {
    const s = new Sim([m(0, ['storm breaks'], { id: 'storm' }), e(1, 'flood', { id: 'flood', gate: [['storm']] })]);
    assert.deepEqual(s.send('flood?', 'The storm breaks.'), [], 'the reply that said it');
    assert.deepEqual(s.send('flood'), [1], 'from the next message');
    assert.ok(!s.lastFired.includes(0), 'the Moment is never sent');
});

test('who says it: only the character', () => {
    const s = new Sim([m(0, ['your name'], { id: 'name', by: 'char' }), e(1, 'trust', { id: 'trust', gate: [['name']] })]);
    s.send('tell me your name');
    assert.deepEqual(s.send('trust'), [], 'the user saying it does not count');
    s.send('hm', 'I know your name now.');
    assert.deepEqual(s.send('trust'), [1]);
});

test('its own gate arms it; a phrase before that is ignored', () => {
    const s = new Sim([e(0, 'kiss', { id: 'kiss' }), m(1, ['missing tooth'], { id: 'tooth', gate: [['kiss']] }), e(2, 'dentist', { id: 'dentist', gate: [['tooth']] })]);
    s.send('missing tooth');
    assert.deepEqual(s.send('dentist'), [], 'not armed: it did not happen');
    s.send('kiss');
    assert.deepEqual(s.send('missing tooth dentist'), [2]);
});

test('a Moment closes things (Closes for and close gates) and rewinds with a swipe', () => {
    const s = new Sim([m(0, ['missing tooth'], { id: 'tooth', closesFor: ['tower'] }), e(1, 'tower', { id: 'tower' }), e(2, 'smile', { id: 'smile', closeGate: [['tooth']] })]);
    assert.deepEqual(s.send('tower smile').sort(), [1, 2]);
    s.send('nothing', 'A missing tooth!');
    assert.equal(s.state.fired[K('tooth')], 1);
    s.swipe('Nothing happens.');
    assert.equal(s.state.fired[K('tooth')] ?? 0, 0, 'the swipe replaced the reply that said it: it never happened');
    s.send('nothing', 'A missing tooth!');
    assert.deepEqual(s.send('tower smile'), [], 'both closed from the next message');
});

test('problems and warnings: no phrases, nothing uses it, pieces a Moment takes none of, closing a Moment', () => {
    const model = buildModel([m(0, [], { id: 'empty', gatesFor: ['x'] }), e(1, 'x', { id: 'x' }), m(2, ['lonely']), m(3, ['held'], { id: 'held', glue: { mode: 'hold' }, gatesFor: ['x'] }), e(4, 'closer', { id: 'closer', closesFor: ['held'] })]);
    assert.deepEqual(problems(model), ['empty: is a Moment with no phrases, so it can never happen', 'closer: Closes targets the Moment "held": a Moment can\'t be closed']);
    assert.deepEqual(warnings(model), ['held: is a Moment, which takes no glue; it is ignored', 'm2: is a Moment nothing uses yet']);
});

test('chat state: happened or not yet', () => {
    const s = new Sim([m(0, ['storm breaks'], { id: 'storm' }), e(1, 'flood', { id: 'flood', gate: [['storm']] })]);
    const node = s.model.nodes.get(K('storm'));
    assert.equal(entryStatus(node, s.state, s.chat, s.model).text, 'not yet');
    s.send('the storm breaks');
    assert.equal(entryStatus(node, s.state, s.chat, s.model).status, 'happened');
});

test('Preview: a Moment said in your message happens this turn and its gate opens in the same reply; in the reply, from the next message', async () => {
    const { runPreview } = await import('../src/ui/preview.js');
    const list = [m(0, ['missing tooth'], { id: 'tooth' }), e(1, 'dentist', { id: 'dentist', gate: [['tooth']] })];
    const model = buildModel(list);
    const now = runPreview({ entries: list, model, user: 'a missing tooth, find a dentist', reply: 'Hm.' });
    assert.ok(now.changes.some(c => c.family === 'moment' && c.text === 'Moment: missing tooth happened' && c.when === 'This turn'));
    assert.equal(now.results.get('Book.1')?.status, 'fires', 'the dentist fires in the same reply');
    assert.equal(now.results.get('Book.0'), undefined, 'the Moment itself is never a result: it sends nothing');
    assert.ok(now.hits.user.some(h => h.moment && h.ok), 'its phrase is highlighted');
    const later = runPreview({ entries: list, model, user: 'dentist?', reply: 'You have a missing tooth.' });
    assert.ok(later.changes.some(c => c.family === 'moment' && c.when === 'From the next message'));
    assert.notEqual(later.results.get('Book.1')?.status, 'fires');
});
