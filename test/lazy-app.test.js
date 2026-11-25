// The lazy editor loader (src/ui/lazy-app.js, L1): one create for every caller, a ready promise for tests, a
// cancellable idle prefetch, and a failed attempt that the next open can retry. No DOM and no SillyTavern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLazyApp } from '../src/ui/lazy-app.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('concurrent loads create the app once and ready resolves with it', async () => {
    let calls = 0;
    const app = { name: 'editor' };
    const lazy = createLazyApp(async () => { calls++; return app; });
    const [a, b] = await Promise.all([lazy.load(), lazy.load()]);
    assert.equal(calls, 1);
    assert.equal(a, app);
    assert.equal(b, app);
    assert.equal(lazy.app, app);
    assert.equal(await lazy.ready, app);
});

test('a failed load rejects ready, and the next load retries', async () => {
    let calls = 0;
    const lazy = createLazyApp(async () => {
        if (++calls === 1) throw new Error('boom');
        return 'editor';
    });
    await assert.rejects(lazy.load(), /boom/);
    await assert.rejects(lazy.ready, /boom/);
    assert.equal(lazy.app, null);
    assert.equal(await lazy.load(), 'editor');
    assert.equal(lazy.app, 'editor');
});

test('prefetch waits for its delay, then asks on the idle callback', async () => {
    let timer = null;
    let idle = null;
    const lazy = createLazyApp(async () => 'editor', {
        delay: 3000,
        setTimeout: fn => { timer = fn; return 1; },
        clearTimeout: () => {},
        requestIdleCallback: (fn, options) => { assert.deepEqual(options, { timeout: 5000 }); idle = fn; return 7; },
        cancelIdleCallback: () => {},
    });
    lazy.prefetch();
    assert.ok(timer, 'the delay is scheduled');
    assert.equal(idle, null, 'nothing is asked before the delay');
    timer();
    assert.ok(idle, 'the delay hands over to the idle callback');
    idle();
    await flush();
    assert.equal(lazy.app, 'editor');
    assert.equal(await lazy.ready, 'editor');
});

test('cancel drops a prefetch before the delay and during the idle wait', async () => {
    const cleared = [];
    const idleCancelled = [];
    let timer = null;
    let idle = null;
    const lazy = createLazyApp(async () => 'editor', {
        delay: 3000,
        setTimeout: fn => { timer = fn; return 11; },
        clearTimeout: id => cleared.push(id),
        requestIdleCallback: fn => { idle = fn; return 22; },
        cancelIdleCallback: id => idleCancelled.push(id),
    });

    lazy.prefetch();
    lazy.cancel();
    assert.deepEqual(cleared, [11], 'the pending delay is cleared');
    await assert.rejects(lazy.load(), /cancelled/);
    assert.equal(lazy.app, null);

    const late = createLazyApp(async () => 'editor', {
        delay: 3000,
        setTimeout: fn => { timer = fn; return 11; },
        clearTimeout: () => {},
        requestIdleCallback: fn => { idle = fn; return 22; },
        cancelIdleCallback: id => idleCancelled.push(id),
    });
    late.prefetch();
    timer();
    late.cancel();
    assert.deepEqual(idleCancelled, [22], 'the pending idle callback is cancelled');
    idle(); // a browser may still run it after cancel
    await flush();
    assert.equal(late.app, null, 'a cancelled prefetch creates nothing');
});

test('a prefetch failure is reported but does not poison ready, and a later open retries', async () => {
    const errors = [];
    let calls = 0;
    let timer = null;
    let idle = null;
    const lazy = createLazyApp(async () => {
        if (++calls === 1) throw new Error('offline');
        return 'editor';
    }, {
        delay: 1,
        setTimeout: fn => { timer = fn; return 1; },
        clearTimeout: () => {},
        requestIdleCallback: fn => { idle = fn; return 2; },
        cancelIdleCallback: () => {},
        onError: error => errors.push(error.message),
    });
    lazy.prefetch();
    timer();
    idle();
    await flush();
    assert.deepEqual(errors, ['offline'], 'the background failure is reported once');
    assert.equal(lazy.app, null);
    assert.equal(await lazy.load(), 'editor', 'the next open tries again');
    assert.equal(lazy.app, 'editor');
    assert.equal(await lazy.ready, 'editor', 'ready was not rejected by the background attempt');
});

test('there is no prefetch once the app is loaded', async () => {
    let scheduled = 0;
    const lazy = createLazyApp(async () => 'editor', { setTimeout: () => { scheduled++; return 1; } });
    assert.equal(await lazy.load(), 'editor');
    lazy.prefetch();
    assert.equal(scheduled, 0);
});
