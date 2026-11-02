import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingFingerprint, greetingsOf, openingGreeting, writeSnapshot } from '../src/chat-state.js';
import { baseState } from '../src/engine/turn.js';
import { buildModel } from '../src/engine/model.js';
import { initialState } from '../src/engine/state.js';
import { getStringHash } from '../src/engine/util.js';

const model = buildModel([]);
const snap = n => ({ ...initialState(), fired: { 'B/a': n } });

test('the state comes from the last message that carries one', () => {
    const chat = [{ mes: 'hi' }, { is_user: true }, { extra: { wihero: snap(1) } }, { is_user: true }, { extra: { wihero: snap(2) } }, { is_user: true }];
    assert.deepEqual(baseState(chat, model).index, 4);
    assert.equal(baseState(chat, model).state.fired['B/a'], 2);
    assert.equal(baseState(chat, model, {}, 4).state.fired['B/a'], 1);
    assert.deepEqual(baseState([], model), { state: initialState(), index: -1 });
});

test('a snapshot is written on the message and its current swipe', () => {
    const message = { swipe_id: 1, swipe_info: [{ extra: {} }, {}] };
    writeSnapshot(message, snap(3));
    assert.equal(message.extra.wihero.fired['B/a'], 3);
    assert.equal(message.swipe_info[1].extra.wihero.fired['B/a'], 3);
    assert.deepEqual(message.swipe_info[0].extra, {});
});

test('the opening greeting: the swipe of the character\'s first message', () => {
    const sera = { avatar: 'Sera.png', first_mes: 'Hello', data: { alternate_greetings: ['Alt one', 'Alt two'] } };
    assert.equal(openingGreeting([{ mes: 'Alt one', swipe_id: 1, swipes: ['Hello', 'Alt one', 'Alt two'] }], sera), '@Sera.png:1');
    assert.equal(openingGreeting([{ mes: 'Hello' }], { avatar: 'Bob.png', first_mes: 'Hello' }), '@Bob.png:0');
    assert.equal(openingGreeting([{ is_user: true, mes: 'x' }], sera), null, 'the greeting was deleted');
    assert.equal(openingGreeting([{ mes: 'x' }], sera), null, 'not the greeting\'s swipes');
    assert.equal(openingGreeting([{ mes: 'x' }], null), null, 'group chat or no chat');
    assert.equal(openingGreeting([{ mes: 'Alt one', swipe_id: 0, swipes: ['Alt one'] }], { avatar: 'C.png', first_mes: '', data: { alternate_greetings: ['Alt one'] } }), '@C.png:1', 'no main greeting');
    assert.deepEqual(greetingsOf(sera), ['Hello', 'Alt one', 'Alt two']);
    assert.equal(greetingFingerprint('  Hello ', getStringHash), String(getStringHash('Hello')));
});
