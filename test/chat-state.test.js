import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateBefore, writeSnapshot } from '../src/chat-state.js';
import { initialState } from '../src/engine.js';

const snap = n => ({ v: 1, fired: { a: n }, closed: {}, glued: {}, masks: {}, round: [] });

test('an empty chat or one without snapshots starts from the initial state', () => {
    assert.deepEqual(stateBefore([]), { state: initialState(), index: -1 });
    assert.deepEqual(stateBefore([{ mes: 'hi' }, { mes: 'yo', extra: {} }]), { state: initialState(), index: -1 });
});

test('the latest snapshot wins, and user messages without one are skipped', () => {
    const chat = [{ extra: { wihero: snap(1) } }, { extra: { wihero: snap(2) } }, { is_user: true, extra: {} }];
    assert.deepEqual(stateBefore(chat), { state: snap(2), index: 1 });
});

test('end limits the search, which is how a regenerate reads the state before the message it replaces', () => {
    const chat = [{ extra: { wihero: snap(1) } }, { extra: { wihero: snap(2) } }];
    assert.deepEqual(stateBefore(chat, 1), { state: snap(1), index: 0 });
});

test('deleting a message rewinds to the snapshot before it', () => {
    const chat = [{ extra: { wihero: snap(1) } }, { extra: { wihero: snap(2) } }];
    chat.pop();
    assert.deepEqual(stateBefore(chat).state, snap(1));
});

test('unreadable snapshots are skipped', () => {
    const chat = [{ extra: { wihero: snap(1) } }, { extra: { wihero: { v: 99 } } }];
    assert.deepEqual(stateBefore(chat).index, 0);
});

test('writeSnapshot writes to the message and its current swipe', () => {
    const message = { swipe_id: 1, swipe_info: [{ extra: {} }, {}], extra: { token_count: 3 } };
    writeSnapshot(message, snap(5));
    assert.deepEqual(message.extra, { token_count: 3, wihero: snap(5) });
    assert.deepEqual(message.swipe_info[1].extra, { wihero: snap(5) });
    assert.deepEqual(message.swipe_info[0].extra, {});
});

test('writeSnapshot works on a message with no extra or swipes', () => {
    const message = {};
    writeSnapshot(message, snap(1));
    assert.deepEqual(message, { extra: { wihero: snap(1) } });
});
