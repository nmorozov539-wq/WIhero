import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCounted, scanChat, scanEnd } from '../src/generation.js';

test('only generations that land in the chat count', () => {
    for (const type of [undefined, 'normal', 'swipe', 'regenerate', 'continue']) assert.ok(isCounted(type), String(type));
    for (const type of ['quiet', 'impersonate', 'first_message']) assert.ok(!isCounted(type), type);
});

test('swipe, continue and regenerate see the chat without the last reply', () => {
    const chat = [{}, { is_user: true }, {}, { is_user: true }, {}];
    assert.equal(scanEnd(chat, 'swipe'), 4);
    assert.equal(scanEnd(chat, 'continue'), 4);
    assert.equal(scanEnd(chat, 'regenerate'), 4, 'before ST removes the old reply');
    assert.equal(scanEnd(chat.slice(0, 4), 'regenerate'), 4, 'after ST removes it');
    assert.equal(scanEnd(chat, 'normal'), 5);
    assert.equal(scanEnd(chat, 'quiet'), 5);
    assert.equal(scanChat(chat, 'swipe').length, 4);
    assert.deepEqual(scanChat([], 'swipe'), []);
});
