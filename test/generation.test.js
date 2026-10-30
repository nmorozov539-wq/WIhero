import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecorded, scanEnd, gatingState, snapshotFor } from '../src/generation.js';
import { buildModel, initialState } from '../src/engine.js';

const snap = (fired, round = []) => ({ v: 1, fired, closed: {}, round });

test('only generations that land in the chat are recorded', () => {
    for (const type of [undefined, 'normal', 'swipe', 'regenerate', 'continue']) assert.ok(isRecorded(type), String(type));
    for (const type of ['quiet', 'impersonate', 'first_message']) assert.ok(!isRecorded(type), type);
});

test('swipe and continue read the state from before the last reply', () => {
    const chat = [{ is_user: true }, { extra: { wihero: snap({ a: 1 }) } }, { is_user: true }, { extra: { wihero: snap({ a: 2 }) } }];
    assert.equal(scanEnd(chat, 'swipe'), 3);
    assert.equal(scanEnd(chat, 'continue'), 3);
    assert.equal(scanEnd(chat, 'normal'), 4);
    assert.equal(scanEnd(chat, 'quiet'), 4);
    assert.deepEqual(gatingState(chat, 'swipe'), snap({ a: 1 }));
    assert.deepEqual(gatingState(chat, undefined), snap({ a: 2 }));
});

test('a continue after a user message reads the whole chat', () => {
    const chat = [{ extra: { wihero: snap({ a: 1 }) } }, { is_user: true }];
    assert.equal(scanEnd(chat, 'continue'), 2);
});

test('an empty chat reads the initial state', () => {
    assert.equal(scanEnd([], 'swipe'), 0);
    assert.deepEqual(gatingState([], 'swipe'), initialState());
});

test('a reply snapshot advances the base by what fired', () => {
    const model = buildModel([{ world: 'B', uid: 1, wihero: { id: 'a' } }, { world: 'B', uid: 2, wihero: { id: 'b', gates: ['a'] } }]);
    const s = snapshotFor({ base: initialState(), activated: ['B.1'], message: {}, type: 'normal', model });
    assert.deepEqual(s, snap({ a: 1 }, ['B.1']));
});

test('a continue merges the first part of the turn into the snapshot', () => {
    const model = buildModel([{ world: 'B', uid: 1, wihero: { id: 'a' } }, { world: 'B', uid: 2, wihero: { id: 'b', gates: ['a'] } }]);
    const base = snap({ a: 1 }, ['B.1']);
    const message = { extra: { wihero: snap({ a: 2 }, ['B.1', 'X.9']) } };
    const s = snapshotFor({ base, activated: ['B.2', 'B.1'], message, type: 'continue', model });
    assert.deepEqual(s.fired, { a: 2, b: 1 });
    assert.deepEqual(s.round, ['B.1', 'X.9', 'B.2']);
    assert.deepEqual(s.closed, { a: true });
});

test('a swipe ignores the round of the swipe it replaces', () => {
    const model = buildModel([{ world: 'B', uid: 1, wihero: { id: 'a' } }]);
    const message = { extra: { wihero: snap({ a: 5 }, ['B.1']) } };
    const s = snapshotFor({ base: initialState(), activated: [], message, type: 'swipe', model });
    assert.deepEqual(s, initialState());
});
