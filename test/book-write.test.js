import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeBook } from '../src/ui/book-write.js';
import { createLibrary } from '../src/ui/st-books.js';

for (const status of [403, 500]) test(`HTTP ${status} preserves cache, edits and rename source`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const cache = new Map([['Book', { entries: {}, value: 'old' }]]);
    const events = [], errors = [], deleted = [];
    const ctx = { getRequestHeaders: () => ({}), eventTypes: { WORLDINFO_UPDATED: 'updated' },
        eventSource: { emit: async (...args) => events.push(args) },
        getWorldInfoNames: () => [...cache.keys()], loadWorldInfo: async n => structuredClone(cache.get(n)) };
    const WI = { worldInfoCache: cache, deleteWorldInfo: async n => deleted.push(n) };
    t.mock.method(globalThis, 'fetch', async url => url.includes('sanitize')
        ? { ok: true, json: async () => ({ fileName: 'New' }) } : { ok: false, status });
    const library = createLibrary({ ctx: () => ctx, WI, settings: { books: {} }, saveSettings() {},
        onSaveError: (...args) => errors.push(args) });
    await library.get('Book');
    library.change('Book', d => { d.value = 'new'; });
    await assert.rejects(library.flush(), /could not be saved/);
    assert.equal(library.peek('Book').value, 'new');
    assert.equal(cache.get('Book').value, 'old');
    assert.equal(errors.length, 1);
    assert.deepEqual(events, []);
    await assert.rejects(library.rename('Book', 'New'));
    assert.deepEqual(deleted, []);
    assert.equal(cache.has('Book'), true);
});

test('confirmed HTTP save publishes cache before the host event', async t => {
    const cache = new Map();
    const data = { entries: {} };
    let emitted = false;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        assert.deepEqual(JSON.parse(options.body), { name: 'Book', data });
        assert.equal(cache.size, 0);
        return { ok: true };
    });
    await writeBook({ getRequestHeaders: () => ({}), eventTypes: { WORLDINFO_UPDATED: 'updated' },
        eventSource: { emit: async (type, name, copy) => {
            assert.equal(type, 'updated'); assert.equal(cache.get(name), copy); emitted = true;
        } } }, { worldInfoCache: cache }, 'Book', data);
    assert.equal(emitted, true);
});

test('rename never deletes the source when the destination returns HTTP 500', async t => {
    const data = { entries: { 0: { content: 'precious' } } };
    const cache = new Map([['Book', data]]);
    let deleted = false;
    const ctx = { getRequestHeaders: () => ({}), eventTypes: { WORLDINFO_UPDATED: 'updated' },
        eventSource: { emit: async () => {} }, getWorldInfoNames: () => [...cache.keys()],
        loadWorldInfo: async name => structuredClone(cache.get(name)) };
    t.mock.method(globalThis, 'fetch', async url => url.includes('sanitize')
        ? { ok: true, json: async () => ({ fileName: 'New' }) } : { ok: false, status: 500 });
    const library = createLibrary({ ctx: () => ctx, WI: { worldInfoCache: cache,
        deleteWorldInfo: async () => { deleted = true; } }, settings: { books: {} }, saveSettings() {} });
    await assert.rejects(library.rename('Book', 'New'), /HTTP 500/);
    assert.equal(deleted, false);
    assert.equal(cache.has('New'), false);
    assert.deepEqual(cache.get('Book'), data);
});

test('a queued native save cannot overwrite a confirmed extension write, even with clone-on-get', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    class Cache extends Map { get(name) { return structuredClone(super.get(name)); } }
    const cache = new Cache();
    const native = { entries: {}, value: 'stale', removed: true };
    cache.set('Book', native); // ST saveWorldInfo caches the same object captured by its debounce.
    let disk;
    setTimeout(() => { disk = structuredClone(native); }, 1000);
    const current = { entries: {}, value: 'current' };
    t.mock.method(globalThis, 'fetch', async (_url, opts) => { disk = JSON.parse(opts.body).data; return { ok: true }; });
    await writeBook({ getRequestHeaders: () => ({}), eventTypes: { WORLDINFO_UPDATED: 'updated' },
        eventSource: { emit: async () => {} } }, { worldInfoCache: cache }, 'Book', current);
    t.mock.timers.tick(1000);
    assert.deepEqual(disk, current);
    assert.deepEqual(native, current);
    assert.deepEqual(cache.get('Book'), current);
});

test('a native edit made while HTTP is pending is not mutated or evicted from cache', async t => {
    let release, sent;
    const held = new Promise(r => { release = r; });
    const pending = { entries: {}, value: 'old' };
    const cache = new Map([['Book', pending]]);
    t.mock.method(globalThis, 'fetch', async () => { await held; return { ok: true }; });
    const saving = writeBook({ getRequestHeaders: () => ({}), eventTypes: { WORLDINFO_UPDATED: 'updated' },
        eventSource: { emit: async (_type, _name, data) => { sent = data; } } }, { worldInfoCache: cache }, 'Book', { entries: {}, value: 'local' });
    pending.value = 'new native edit';
    release(); await saving;
    assert.equal(cache.get('Book').value, 'new native edit');
    assert.equal(pending.value, 'new native edit');
    assert.equal(sent.value, 'local');
});
