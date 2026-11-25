// Show in chat (TRACKERS 4): the hider's render memo and the per-task queue, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, createRenderMemo } from '../src/show-in-chat.js';

const key = model => ({ mes: 'Hi.\n[Gold: 7]', active: true, model, name: 'Seraphina', is_system: false, is_user: false, out: 'Hi.' });

test('render memo: the same key skips, and a changed message, flag, model or name renders again', () => {
    const memo = createRenderMemo();
    const box = {};
    const model = {};
    const first = key(model);
    assert.equal(memo.same(box, first), false, 'nothing rendered yet');
    memo.set(box, first);
    assert.equal(memo.same(box, { ...first }), true);
    assert.equal(memo.same(box, { ...first, mes: 'Hi.\n[Gold: 8]' }), false, 'message text changed');
    assert.equal(memo.same(box, { ...first, active: false }), false, 'WI Hero switched');
    assert.equal(memo.same(box, { ...first, model: {} }), false, 'the model was built again');
    assert.equal(memo.same(box, { ...first, name: 'Anna' }), false, 'author changed');
    memo.set(box, { ...first, out: null });
    assert.equal(memo.same(box, { ...first, out: null }), true);
    assert.equal(memo.same(box, first), false, 'shown text changed');
    memo.clear();
    assert.equal(memo.same(box, first), false, 'cleared: every box renders again');
});

test('queue: a burst flushes once with every id, and the next add schedules its own flush', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flushes = [];
    const queue = createQueue(ids => flushes.push(ids));
    for (const id of [1, 2, 3, 4, 5]) queue.add(id);
    assert.deepEqual(flushes, [], 'nothing until the task ends');
    t.mock.timers.tick(1);
    assert.deepEqual(flushes, [[1, 2, 3, 4, 5]]);
    queue.add(6);
    t.mock.timers.tick(1);
    assert.deepEqual(flushes, [[1, 2, 3, 4, 5], [6]], 'a late id gets its own flush');
});

test('queue: the same id twice in a burst renders once, and clear drops a pending flush', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flushes = [];
    const queue = createQueue(ids => flushes.push(ids));
    queue.add(7);
    queue.add(7);
    t.mock.timers.tick(1);
    assert.deepEqual(flushes, [[7]]);
    queue.add(8);
    queue.clear();
    t.mock.timers.tick(1);
    assert.deepEqual(flushes, [[7]], 'cleared before the flush');
});
