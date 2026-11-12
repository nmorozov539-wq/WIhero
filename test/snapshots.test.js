// The "As imported" copy (src/ui/snapshots.js seed): a book counts as seen only once its copy is uploaded
// (review 2026-11-09, finding 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshots } from '../src/ui/snapshots.js';

function setup(ok) {
    const settings = { books: {} };
    const errors = [];
    const uploads = [];
    globalThis.fetch = async (url, o) => {
        uploads.push(JSON.parse(o.body).name);
        return ok() ? { ok: true, json: async () => ({ path: `user/files/${JSON.parse(o.body).name}` }) } : { ok: false, status: 507 };
    };
    const snapshots = createSnapshots({
        ctx: () => ({ getRequestHeaders: () => ({}) }), settings, saveSettings: () => {}, library: {},
        onSeedError: book => errors.push(book),
    });
    return { snapshots, settings, errors, uploads };
}

test('a failed As imported copy is reported, and tried again next time', async () => {
    let up = false;
    const { snapshots, settings, errors, uploads } = setup(() => up);
    const book = { entries: { 0: { uid: 0, content: 'A' } } };
    assert.equal(await snapshots.seed('Book', book), false);
    assert.deepEqual(errors, ['Book']);
    assert.ok(!settings.books.Book?.seen, 'not marked seen while it has no copy');
    up = true;
    assert.equal(await snapshots.seed('Book', book), true);
    assert.equal(settings.books.Book.seen, true);
    assert.deepEqual(settings.books.Book.snapshots.map(s => [s.name, s.imported]), [['As imported', true]]);
    assert.equal(await snapshots.seed('Book', book), true);
    assert.equal(uploads.length, 2, 'a seen book is never copied again');
});

test('a book made in WI Hero is seen at once, with no copy', async () => {
    const { snapshots, settings, uploads } = setup(() => true);
    await snapshots.seed('New', { entries: {} }, { fresh: true });
    assert.equal(settings.books.New.seen, true);
    assert.deepEqual(uploads, []);
});

test('concurrent snapshots and colliding book slugs have distinct files and independent identities', async t => {
    const settings = { books: {} }, files = new Map();
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
        const data = JSON.parse(opts.body);
        files.set(data.name, data.data);
        await Promise.resolve();
        return { ok: true, json: async () => ({ path: data.name }) };
    });
    let value = 0;
    const snapshots = createSnapshots({ ctx: () => ({ getRequestHeaders: () => ({}) }), settings,
        saveSettings() {}, library: { get: async () => ({ entries: {}, value: ++value }) }, now: () => 42 });
    const [one, two, other] = await Promise.all([snapshots.take('Book!', 'one'), snapshots.take('Book!', 'two'), snapshots.take('Book?', 'other')]);
    assert.equal(files.size, 3);
    assert.equal(new Set([one.id, two.id, other.id]).size, 3);
    assert.equal(one.at, two.at, 'timestamps can coincide without being identities');
    snapshots.rename('Book!', one, 'renamed');
    assert.equal(two.name, 'two');
    snapshots.forget('Book!', one);
    assert.deepEqual(snapshots.list('Book!'), [two]);
    snapshots.keep('Book!', one);
    assert.equal(snapshots.list('Book!').length, 2);
});

test('legacy snapshot actions use their paths and continue to work', () => {
    const settings = { books: { Book: { snapshots: [{ name: 'old', at: 1, path: 'old.json' }, { name: 'same time', at: 1, path: 'other.json' }] } } };
    const snapshots = createSnapshots({ ctx: () => ({}), settings, saveSettings() {}, library: {} });
    const snap = snapshots.list('Book').find(s => s.path === 'old.json');
    snapshots.rename('Book', snap, 'renamed');
    snapshots.forget('Book', snap);
    assert.equal(snapshots.list('Book')[0].name, 'same time');
    snapshots.keep('Book', snap);
    assert.equal(snapshots.list('Book').length, 2);
});

test('an uploading seed follows renamed settings instead of recreating the old book', async t => {
    const { renameBookSettings } = await import('../src/ui/data.js');
    let release;
    const held = new Promise(r => { release = r; });
    const settings = { books: {}, bookFolders: {}, renamed: {} };
    t.mock.method(globalThis, 'fetch', async () => { await held; return { ok: true, json: async () => ({ path: 'seed.json' }) }; });
    const snapshots = createSnapshots({ ctx: () => ({ getRequestHeaders: () => ({}) }), settings, saveSettings() {}, library: {} });
    const first = snapshots.seed('Book', { entries: {} });
    const again = snapshots.seed('Book', { entries: {} });
    assert.equal(first, again, 'one As imported upload per book');
    renameBookSettings(settings, 'Book', 'New');
    release(); await first;
    assert.equal(settings.books.Book, undefined);
    assert.equal(settings.books.New.seen, true);
    assert.equal(snapshots.list('New')[0].path, 'seed.json');
});

test('snapshot cleanup waits for a pending upload before deleting its file', async t => {
    let release;
    const held = new Promise(r => { release = r; });
    const removed = [];
    t.mock.method(globalThis, 'fetch', async (url, opts) => {
        if (url.includes('upload')) { await held; return { ok: true, json: async () => ({ path: 'pending.json' }) }; }
        removed.push(JSON.parse(opts.body).path); return { ok: true };
    });
    const settings = { books: {} };
    const snapshots = createSnapshots({ ctx: () => ({ getRequestHeaders: () => ({}) }), settings, saveSettings() {}, library: {} });
    const upload = snapshots.seed('Book', { entries: {} });
    const cleanup = snapshots.removeAll('Book');
    assert.deepEqual(removed, []);
    release(); await upload; await cleanup;
    assert.deepEqual(removed, ['pending.json']);
});
