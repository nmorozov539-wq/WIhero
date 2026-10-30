import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryHash, scanLength, stickyHeld } from '../src/timers.js';

/** Stand-in for ST's getStringHash: the hashed text itself, so tests can see what was hashed. */
const text = s => s;

test('entryHash hashes the entry as ST does: decorators added, content without them', () => {
    const plain = { uid: 1, world: 'B', content: 'text' };
    assert.equal(entryHash(plain, text), JSON.stringify({ ...plain, decorators: [], content: 'text' }));
    const decorated = { uid: 2, world: 'B', content: '@@activate\n@@unknown\nbody' };
    assert.equal(entryHash(decorated, text), JSON.stringify({ ...decorated, decorators: ['@@activate'], content: 'body' }));
    const escaped = { uid: 3, world: 'B', content: '@@@dont_activate\nbody' };
    assert.equal(JSON.parse(entryHash(escaped, text)).content, 'body', 'an escaped decorator before any fallback is skipped');
    assert.deepEqual(JSON.parse(entryHash({ uid: 4 }, text)), { uid: 4, decorators: [], content: '' });
});

test('scanLength counts non-system messages, minus the reply a swipe replaces', () => {
    const chat = [{ mes: 'greeting' }, { mes: 'note', is_system: true }, { mes: 'hi', is_user: true }, { mes: 'reply' }];
    assert.equal(scanLength(chat), 3);
    assert.equal(scanLength(chat, 'normal'), 3);
    assert.equal(scanLength(chat, 'continue'), 3);
    assert.equal(scanLength(chat, 'swipe'), 2);
    assert.equal(scanLength([], 'swipe'), 0);
});

test('stickyHeld follows ST: active after the start, until the end, matched by hash', () => {
    const lantern = { world: 'B', uid: 5, sticky: 5, h: 11 };
    const other = { world: 'B', uid: 6, sticky: 2, h: 12 };
    const hashOf = e => e.h;
    const timed = { sticky: { 'B.5': { hash: 11, start: 2, end: 7, protected: false } }, cooldown: {} };
    const at = length => [...stickyHeld([lantern, other], timed, length, hashOf).entries()];
    assert.deepEqual(at(2), [], 'chat not advanced past the start');
    assert.deepEqual(at(4), [['B.5', 7]]);
    assert.deepEqual(at(6), [['B.5', 7]]);
    assert.deepEqual(at(7), [], 'ended');
    const guarded = { sticky: { 'B.5': { ...timed.sticky['B.5'], protected: true } } };
    assert.deepEqual([...stickyHeld([lantern], guarded, 2, hashOf).keys()], ['B.5'], 'protected effects hold at the start');
});

test('stickyHeld skips effects whose entry changed, is gone or is no longer sticky', () => {
    const timed = { sticky: { 'B.5': { hash: 11, start: 2, end: 7 } } };
    const hashOf = e => e.h;
    assert.equal(stickyHeld([{ world: 'B', uid: 5, sticky: 5, h: 99 }], timed, 4, hashOf).size, 0, 'edited entry: new hash');
    assert.equal(stickyHeld([], timed, 4, hashOf).size, 0);
    assert.equal(stickyHeld([{ world: 'B', uid: 5, sticky: 0, h: 11 }], timed, 4, hashOf).size, 0);
    assert.equal(stickyHeld([{ world: 'B', uid: 5, sticky: 5, h: 11 }], undefined, 4, hashOf).size, 0);
});

test('stickyHeld keys by the entry the hash matches, as ST does', () => {
    const timed = { sticky: { 'Old.1': { hash: 11, start: 2, end: 7 } } };
    const moved = { world: 'New', uid: 3, sticky: 5, h: 11 };
    assert.deepEqual([...stickyHeld([moved], timed, 4, e => e.h).keys()], ['New.3']);
});
