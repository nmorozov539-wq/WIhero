// T0: the entry page's real token count is cached by exact text, deferred while typing, and skipped while the
// host is hidden or the page was rebuilt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenCounter } from '../src/ui/token-count.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

function counting(result = 3) {
    const calls = [];
    const tokens = async text => { calls.push(text); return result; };
    return { calls, tokens };
}

test('token count: open caches by exact text', async () => {
    const { calls, tokens } = counting();
    const counter = createTokenCounter({ tokens });
    assert.equal(await counter.open('one'), 3);
    assert.equal(await counter.open('one'), 3);
    assert.equal(calls.length, 1, 'a cached open makes no call');
    assert.equal(await counter.open('two'), 3);
    assert.equal(calls.length, 2, 'different text is a different count');
    assert.deepEqual(calls, ['one', 'two']);
});

test('token count: input is deferred and the burst keeps only the last text', async () => {
    const { calls, tokens } = counting();
    const counter = createTokenCounter({ tokens, idleMs: 30 });
    const first = counter.input('a');
    await wait(10);
    assert.equal(calls.length, 0, 'nothing before the idle');
    assert.equal(await first, 3);
    assert.deepEqual(calls, ['a']);

    calls.length = 0;
    const a = counter.input('p');
    const b = counter.input('q');
    const c = counter.input('r');
    assert.equal(await a, null, 'a replaced input is superseded');
    assert.equal(await b, null, 'b replaced input is superseded');
    assert.equal(await c, 3);
    await wait(40);
    assert.deepEqual(calls, ['r'], 'one request, for the last text only');
});

test('token count: flush cancels the timer and asks once', async () => {
    const { calls, tokens } = counting();
    const counter = createTokenCounter({ tokens, idleMs: 30 });
    const scheduled = counter.input('text');
    const flushed = counter.flush('text');
    assert.equal(await scheduled, null, 'the scheduled input was superseded');
    assert.equal(await flushed, 3);
    await wait(40);
    assert.equal(calls.length, 1, 'the cancelled timer did not fire');
});

test('token count: a second flush of the same in-flight text shares the request', async () => {
    const calls = [];
    let release;
    const tokens = text => {
        calls.push(text);
        return new Promise(resolve => { release = () => resolve(7); });
    };
    const counter = createTokenCounter({ tokens });
    const a = counter.flush('shared');
    const b = counter.flush('shared');
    assert.equal(calls.length, 1, 'one call while in flight');
    release();
    assert.equal(await a, 7);
    assert.equal(await b, 7);
    assert.equal(await counter.open('shared'), 7);
    assert.equal(calls.length, 1, 'the result is cached');
});

test('token count: hidden or inactive pages do not tokenize', async () => {
    const { calls, tokens } = counting(5);
    let hidden = false;
    let active = true;
    const counter = createTokenCounter({ tokens, idleMs: 15, hidden: () => hidden, isActive: () => active });

    hidden = true;
    assert.equal(await counter.input('hidden'), null);
    assert.equal(await counter.flush('hidden'), null);
    await wait(25);
    assert.equal(calls.length, 0);

    hidden = false;
    active = false;
    assert.equal(await counter.input('inactive'), null);
    assert.equal(await counter.flush('inactive'), null);
    await wait(25);
    assert.equal(calls.length, 0);

    active = true;
    assert.equal(await counter.flush('inactive'), 5);
    assert.deepEqual(calls, ['inactive'], 'a working call resumes after the condition clears');
});

test('token count: a page that goes inactive after scheduling does not call at the idle', async () => {
    const { calls, tokens } = counting();
    let active = true;
    const counter = createTokenCounter({ tokens, idleMs: 15, isActive: () => active });
    const scheduled = counter.input('gone');
    active = false;
    assert.equal(await scheduled, null);
    await wait(25);
    assert.equal(calls.length, 0);
});

test('token count: a failure resolves null and is not cached', async () => {
    const calls = [];
    let fail = true;
    const tokens = async text => {
        calls.push(text);
        if (fail) throw new Error('tokenizer unavailable');
        return 4;
    };
    const counter = createTokenCounter({ tokens });
    assert.equal(await counter.open('x'), null);
    assert.equal(await counter.open('x'), null, 'a failure is asked again');
    assert.equal(calls.length, 2);
    fail = false;
    assert.equal(await counter.open('x'), 4);
    assert.equal(await counter.open('x'), 4);
    assert.equal(calls.length, 3, 'the numeric result is cached');
});

test('token count: the cache cap evicts the oldest text', async () => {
    const { calls, tokens } = counting();
    const counter = createTokenCounter({ tokens, limit: 2 });
    await counter.open('a');
    await counter.open('b');
    await counter.open('c');
    assert.equal(calls.length, 3);
    assert.equal(await counter.open('c'), 3);
    assert.equal(calls.length, 3, 'c is still cached');
    assert.equal(await counter.open('a'), 3);
    assert.equal(calls.length, 4, 'a was evicted when c arrived');
    assert.equal(await counter.open('b'), 3);
    assert.equal(calls.length, 5, 'b was evicted when a was re-added');
});
