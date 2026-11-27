// The shared loader (src/ui/loader.js): foreground before background, bounded concurrency, and cancellation that
// drops queued work and makes older results stale. No DOM and no SillyTavern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from '../src/ui/loader.js';

/** A load that records its name and stays pending until the test settles it. */
function deferredLoads() {
    const calls = [];
    const pending = new Map();
    const load = name => {
        calls.push(name);
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        pending.set(name, resolve);
        return promise;
    };
    const finish = (name, value = name) => { pending.get(name)?.(value); pending.delete(name); };
    return { calls, load, finish, pending };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a foreground load starts before queued background work', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 3 });
    for (const name of ['b1', 'b2', 'b3', 'b4', 'b5']) loader.enqueue(name);
    assert.deepEqual(calls, ['b1', 'b2', 'b3'], 'three background loads fill the slots');

    const urgent = loader.enqueue('book', { foreground: true });
    assert.deepEqual(calls, ['b1', 'b2', 'b3', 'book'], 'the foreground load does not wait for a slot');
    assert.equal(loader.stats().running, 4, 'the foreground request runs beside the bounded background');

    finish('book');
    assert.equal(await urgent, 'book');
    for (const name of ['b1', 'b2', 'b3', 'b4', 'b5']) finish(name);
    await flush();
    assert.equal(loader.size(), 0);
});

test('background concurrency stays bounded while each finished load starts the next', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 3 });
    for (let i = 0; i < 10; i++) loader.enqueue(`b${i}`);
    assert.equal(calls.length, 3);
    assert.equal(loader.size(), 7);
    assert.equal(loader.stats().maxBackground, 3);

    finish('b0');
    await flush();
    assert.deepEqual(calls, ['b0', 'b1', 'b2', 'b3'], 'one slot freed starts exactly one more');
    assert.equal(loader.stats().maxBackground, 3);
    for (let i = 1; i < 10; i++) { finish(`b${i}`); await flush(); }
    assert.equal(loader.stats().maxBackground, 3, 'never more than three background reads');
    assert.equal(loader.size(), 0);
    assert.equal(loader.stats().running, 0);
});

test('cancel drops queued loads before they start and settles the queue', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 3 });
    for (let i = 0; i < 6; i++) loader.enqueue(`b${i}`);
    assert.deepEqual(calls, ['b0', 'b1', 'b2']);

    assert.equal(loader.cancel(), 3, 'the three queued loads are dropped');
    assert.equal(loader.size(), 0);
    assert.equal(loader.stats().cancelled, 3);
    assert.equal(loader.stats().queued, 0);

    // The running loads cannot be aborted, but finishing them starts nothing else.
    for (const name of ['b0', 'b1', 'b2']) finish(name);
    await flush();
    assert.deepEqual(calls, ['b0', 'b1', 'b2'], 'no cancelled load ever reached load()');
    assert.equal(loader.size(), 0);
    assert.equal(loader.stats().running, 0);
    assert.equal(loader.stats().started, 3);
});

test('a callback from before a cancel can see its generation is stale', async () => {
    const { load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 1 });
    let landed = null;
    const gen = loader.generation();
    const done = loader.enqueue('Book').then(data => {
        if (loader.isCurrent(gen)) landed = data;
    });
    loader.cancel();
    assert.notEqual(loader.generation(), gen, 'cancel starts a new generation');

    finish('Book', 'old copy');
    await done;
    assert.equal(landed, null, 'the stale callback wrote nothing');
    assert.equal(loader.isCurrent(gen), false);
});

test('the same name is not queued or loaded twice', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 3 });
    const a = loader.enqueue('Book');
    const b = loader.enqueue('Book');
    assert.equal(a, b, 'the second request shares the queued load');
    assert.deepEqual(calls, ['Book']);
    assert.equal(loader.size(), 0);

    const c = loader.enqueue('Book');
    assert.equal(c, a, 'a request while it runs shares it too');
    finish('Book', 'copy');
    assert.deepEqual(await Promise.all([a, b, c]), ['copy', 'copy', 'copy']);
    await flush();
    assert.equal(loader.stats().started, 1);
});

test('a foreground request promotes a queued load instead of queueing a second one', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 1 });
    loader.enqueue('b1');
    const queued = loader.enqueue('Book');
    assert.deepEqual(calls, ['b1'], 'Book waits behind the first background read');
    assert.equal(loader.size(), 1);

    const urgent = loader.enqueue('Book', { foreground: true });
    assert.equal(urgent, queued, 'the promoted request is the same load');
    assert.deepEqual(calls, ['b1', 'Book'], 'it starts at once');
    assert.equal(loader.size(), 0);
    assert.equal(loader.stats().promoted, 1);

    finish('Book', 'copy');
    finish('b1');
    assert.equal(await queued, 'copy');
    await flush();
    assert.equal(loader.stats().started, 2);
});

test('cancelGroup drops only that group\'s queued loads and leaves the rest alone', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 1 });
    loader.enqueue('count1');
    loader.enqueue('count2', { group: 'counts' });
    loader.enqueue('search1', { group: 'search' });
    loader.enqueue('search2', { group: 'search' });
    assert.deepEqual(calls, ['count1'], 'one background slot is busy with a count');
    assert.equal(loader.size(), 3);

    const gen = loader.groupGeneration('search');
    assert.equal(loader.cancelGroup('search'), 2, 'both queued search reads are dropped');
    assert.equal(loader.groupGeneration('search'), gen + 1, 'search callbacks can see they are stale');
    assert.equal(loader.groupGeneration('counts'), 0, 'another group\'s generation is untouched');
    assert.equal(loader.size(), 1, 'the queued count stays');

    finish('count1');
    await flush();
    assert.deepEqual(calls, ['count1', 'count2'], 'the count after it still starts; no cancelled search read does');
    finish('count2');
    await flush();
    assert.equal(loader.size(), 0);
    assert.equal(loader.stats().cancelled, 2);
});

test('a grouped request shares an existing load without moving it into that group', async () => {
    const { calls, load, finish } = deferredLoads();
    const loader = createLoader({ load, concurrency: 1 });
    loader.enqueue('Book');
    const shared = loader.enqueue('Book', { group: 'search' });
    assert.deepEqual(calls, ['Book']);
    assert.equal(loader.cancelGroup('search'), 0, 'the running count load is not the search group\'s');
    finish('Book', 'copy');
    assert.equal(await shared, 'copy');
});

test('a failed load frees its slot and later work still runs', async () => {
    const calls = [];
    let rejectFirst;
    const load = name => {
        calls.push(name);
        if (name === 'bad') return new Promise((_, reject) => { rejectFirst = reject; });
        return Promise.resolve(name);
    };
    const loader = createLoader({ load, concurrency: 1 });
    const bad = loader.enqueue('bad');
    loader.enqueue('next');
    rejectFirst(new Error('nope'));
    await assert.rejects(bad, /nope/);
    await flush();
    assert.deepEqual(calls, ['bad', 'next']);
    assert.equal(loader.stats().failed, 1);
    assert.equal(loader.size(), 0);
});
