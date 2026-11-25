// The library's memory half (M2, docs/optimization-pass/PLAN.md §5): summaries that Home draws without loading a
// book, LRU eviction of clean copies, and the pins that keep open, dirty, saving, failed, history and reserved books
// loaded. No DOM and no SillyTavern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, MAX_COPIES } from '../src/ui/st-books.js';
import { createHistory, withHistory } from '../src/ui/history.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeBook(entries = 3) {
    const out = {};
    for (let uid = 0; uid < entries; uid++) out[uid] = { uid, comment: `Entry ${uid}`, key: [`k${uid}`], content: 'x' };
    return { entries: out };
}

function setup({ count = 3, entries = 3, maxCopies = MAX_COPIES, summarize, pinned, onFirstSeen, writeBook } = {}) {
    const books = {};
    for (let i = 0; i < count; i++) books[`b${i}`] = makeBook(entries);
    const settings = { books: {} };
    const loads = [];
    const ctx = {
        getWorldInfoNames: () => Object.keys(books),
        loadWorldInfo: async name => { loads.push(name); return structuredClone(books[name] ?? { entries: {} }); },
        reloadWorldInfoEditor: () => {},
        getRequestHeaders: () => ({}),
        updateWorldInfoList: async () => {},
        saveSettingsDebounced: () => {},
        characters: [], chatMetadata: {},
    };
    const library = createLibrary({
        ctx: () => ctx, WI: { world_info: { charLore: [] }, deleteWorldInfo: async name => { delete books[name]; } },
        settings, saveSettings: () => {},
        writeBook: writeBook ?? (async (name, data) => { books[name] = structuredClone(data); }),
        onFirstSeen, summarize, pinned, maxCopies,
    });
    return { library, books, settings, loads };
}

// ---- summaries

test('a book is summarised once on load, not on a change, and lazily again when Home asks', async () => {
    const calls = [];
    const { library, loads } = setup({
        summarize: (name, data) => {
            calls.push(name);
            return { entries: Object.keys(data.entries).length * 10, total: Object.keys(data.entries).length, tokens: 7 };
        },
    });
    const data = await library.get('b0');
    assert.equal(Object.keys(data.entries).length, 3);
    assert.deepEqual(calls, ['b0'], 'one walk when the book was read');
    assert.deepEqual({ ...library.summary('b0'), revision: 0 }, { entries: 30, total: 3, tokens: 7, revision: 0 });

    library.change('b0', d => { d.entries[9] = { uid: 9, content: 'new' }; });
    assert.deepEqual(calls, ['b0'], 'typing does not walk the book: the revision alone makes the summary stale');
    assert.equal(library.summary('b0').entries, 40, 'the next Home ask takes the new count once');
    assert.deepEqual(calls, ['b0', 'b0']);
    assert.equal(library.summary('b0').entries, 40, 'and it is kept until the next change');
    assert.deepEqual(calls, ['b0', 'b0']);
    assert.equal(loads.length, 1, 'neither ask read the book again');
});

test('an explicit invalidation drops the summary without a read', async () => {
    const { library, loads } = setup({ summarize: (name, data) => ({ entries: Object.keys(data.entries).length }) });
    await library.get('b0');
    library.invalidateSummary('b0');
    assert.equal(library.summary('b0').entries, 3, 'the working copy can still answer');
    assert.equal(loads.length, 1, 'no read was needed');
});

test('a summary can be kept after the working copy is evicted, so Home never reads the book for its count', async () => {
    const { library, loads } = setup({ count: 8, maxCopies: 2 });
    for (const name of ['b0', 'b1', 'b2']) await library.get(name);
    assert.equal(library.peek('b0'), null, 'b0 is the oldest clean copy and was let go');
    const before = loads.length;
    assert.deepEqual({ ...library.summary('b0'), revision: 0 }, { entries: 3, total: 3, tokens: 0, revision: 0 });
    assert.equal(loads.length, before, 'the count came from the summary, with no get');
    const data = await library.get('b0');
    assert.equal(Object.keys(data.entries).length, 3, 'opening it reads it fresh');
    assert.equal(loads.length, before + 1);
});

// ---- LRU eviction

test('the oldest clean copy is evicted first, and a peek counts as use', async () => {
    const { library, settings } = setup({ count: 12, maxCopies: 4 });
    for (const name of ['b0', 'b1', 'b2', 'b3']) await library.get(name);
    settings.books.b1 = { folders: {} };
    library.peek('b0'); // used, so it is no longer the oldest
    const version = library.bookVersion('b1');
    await library.get('b4');
    const s = library.stats();
    assert.equal(s.copies, 4);
    assert.equal(s.evictions, 1);
    assert.ok(library.peek('b0'), 'the used book stays');
    assert.equal(library.peek('b1'), null, 'the oldest untouched copy goes');
    assert.ok(library.peek('b4'), 'the new copy is loaded');
    assert.equal(library.bookVersion('b1'), version, 'the book revision survives eviction');
    assert.deepEqual(settings.books.b1, { folders: {} }, 'and so does its settings record');
});

test('the bound defaults to MAX_COPIES and stats reports it', async () => {
    const { library } = setup({ count: MAX_COPIES + 3 });
    for (let i = 0; i < MAX_COPIES + 3; i++) await library.get(`b${i}`);
    const s = library.stats();
    assert.equal(s.maxCopies, MAX_COPIES);
    assert.equal(s.copies, MAX_COPIES);
    assert.equal(s.evictions, 3);
    assert.ok(s.estimatedBytes > 0, 'the estimate is taken from the loaded books');
    assert.equal(s.summaries, MAX_COPIES + 3, 'every read left its summary behind');
});

// ---- pinning

test('an open book is pinned even when it is the oldest', async () => {
    const { library } = setup({ count: 8, maxCopies: 2, pinned: () => ['b0'] });
    await library.get('b0');
    await library.get('b1');
    await library.get('b2');
    assert.ok(library.peek('b0'), 'the app keeps its open book loaded');
    assert.equal(library.peek('b1'), null, 'the oldest unpinned copy goes instead');
    assert.ok(library.stats().pinned.includes('b0'));
});

test('a dirty book is never evicted, and its edits stay in memory', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library } = setup({ count: 8, maxCopies: 1 });
    await library.get('b0');
    library.change('b0', d => { d.entries[0].content = 'edited'; }, { quiet: true });
    assert.ok(library.stats().pinned.includes('b0'), 'a pending save pins it');
    await library.get('b1');
    await library.get('b2');
    assert.equal(library.peek('b0').entries[0].content, 'edited', 'the only copy of the edit was kept');
    await library.flush();
    t.mock.timers.tick(350);
});

test('a save in flight pins its book until the write finishes', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const { library } = setup({ count: 8, maxCopies: 1, writeBook: async () => held });
    await library.get('b0');
    library.change('b0', d => { d.entries[0].content = 'while saving'; }, { quiet: true });
    t.mock.timers.tick(350);
    await flush();
    assert.ok(library.stats().pinned.includes('b0'), 'the save in flight pins it');
    await library.get('b1');
    await library.get('b2');
    assert.ok(library.peek('b0'), 'the copy a save is reading stays');
    release();
    await flush();
});

test('a book whose save failed for good is pinned until a save works', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library } = setup({ count: 8, maxCopies: 1, writeBook: async () => { throw new Error('disk full'); } });
    await library.get('b0');
    library.change('b0', d => { d.entries[0].content = 'unsaved'; }, { quiet: true });
    await library.flush().catch(() => {});
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(5000); await flush(); }
    assert.equal(library.unsaved('b0'), true);
    await library.get('b1');
    await library.get('b2');
    assert.equal(library.peek('b0').entries[0].content, 'unsaved', 'the only copy of the failed edit stays');
    assert.ok(library.stats().pinned.includes('b0'));
});

test('a running book operation pins its source copy', async t => {
    let release;
    let writes = 0;
    const held = new Promise(resolve => { release = resolve; });
    const { library } = setup({
        count: 8, maxCopies: 1,
        writeBook: async (name, data) => {
            writes++;
            if (name === 'b0 renamed') await held;
            return undefined;
        },
    });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ fileName: 'b0 renamed' }) }));
    await library.get('b0');
    const renaming = library.rename('b0', 'b0 renamed');
    await flush();
    assert.ok(library.stats().pinned.includes('b0'), 'the source of a running rename is pinned');
    await library.get('b1');
    await library.get('b2');
    assert.ok(library.peek('b0'), 'its copy stays while the rename writes');
    release();
    await renaming;
    assert.equal(writes, 1);
    assert.equal(library.peek('b0'), null, 'the old name is gone once the rename completes');
});

test('a reserved name keeps the copy a book action is about to write', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ fileName: 'New' }) }));
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const { library } = setup({ count: 8, maxCopies: 1, onFirstSeen: () => held });
    const creating = library.create('New');
    await flush();
    await library.get('New'); // the destination exists as a read before the write
    assert.ok(library.peek('New'));
    await library.get('b0');
    await library.get('b1');
    assert.ok(library.peek('New'), 'a reserved name is not evicted');
    assert.ok(library.stats().pinned.includes('New'));
    release();
    await creating;
    assert.equal(library.peek('New'), null, 'the finished create replaced the old copy');
});

test('the app can pin books with undo states, and history says which they are', async () => {
    let history = null;
    const { library } = setup({ count: 6, maxCopies: 2, pinned: () => history?.booksWithStates?.() ?? [] });
    history = createHistory({ library, settings: { books: {} }, saveSettings: () => {} });
    const proxy = withHistory(library, history);
    await library.get('b0');
    history.touch('b0');
    proxy.change('b0', d => { d.entries[0].content = 'undoable'; });
    await flush();
    history.touch('b0', { redraw: true });
    assert.deepEqual(history.booksWithStates(), ['b0']);
    assert.ok(history.canUndo('b0'));
    await library.get('b1');
    await library.get('b2');
    assert.ok(library.peek('b0'), 'a book with an undo state stays loaded');
    assert.ok(library.stats().pinned.includes('b0'));
    assert.ok(history.undo('b0'));
    assert.equal(library.peek('b0').entries[0].content, 'x', 'undo still reaches the loaded copy');
    await library.flush();
});

// ---- cleanup and outside changes

test('rename carries the summary to the new name; remove drops it', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ fileName: 'b0 renamed' }) }));
    const { library, books } = setup({ count: 3, maxCopies: 1 });
    await library.get('b0');
    const before = library.stats().summaries;
    await library.rename('b0', 'b0 renamed');
    assert.equal(library.summary('b0'), null, 'the old name has no summary');
    assert.equal(library.summary('b0 renamed').entries, 3, 'the new name answers without a read');
    assert.equal(library.stats().summaries, before, 'nothing was added or lost');
    await library.remove('b0 renamed');
    assert.equal(library.summary('b0 renamed'), null);
    assert.equal(library.stats().summaries, before - 1);
    assert.equal(books['b0 renamed'], undefined);
});

test('an outside save after eviction updates the summary and the next open reads the outside content', async () => {
    const { library, books, loads } = setup({ count: 8, maxCopies: 1 });
    await library.get('b0');
    await library.get('b1');
    assert.equal(library.peek('b0'), null, 'b0 was evicted');
    books.b0.entries[7] = { uid: 7, content: 'outside' };
    library.onWorldInfoUpdated('b0', structuredClone(books.b0));
    assert.equal(library.summary('b0').entries, 4, 'the summary follows the outside save without a read');
    const before = loads.length;
    const data = await library.get('b0');
    assert.equal(loads.length, before + 1, 'opening it reads once');
    assert.equal(data.entries[7].content, 'outside');
});

test('newCopy, duplicate and create leave a usable summary behind', async t => {
    t.mock.method(globalThis, 'fetch', async (_url, options) => ({ ok: true, json: async () => ({ fileName: JSON.parse(options.body).fileName }) }));
    const { library, books } = setup({ count: 3 });
    books.Other = makeBook(4);
    await library.get('Other');
    const copy = await library.duplicate('Other');
    assert.equal(library.summary(copy).entries, 4, 'the copy answers without a read');
    assert.equal(library.peek(copy), null, 'and is not left loaded');
    const made = await library.create('Fresh');
    assert.deepEqual(library.summary(made), { entries: 0, total: 0, tokens: 0, revision: library.bookVersion(made) });
});

test('eviction is not a summary change: a Home pass after an eviction does no reads', async () => {
    const { library, loads } = setup({ count: 10, maxCopies: 2 });
    const names = library.names();
    for (const name of names) await library.get(name);
    const reads = loads.length;
    const counts = names.map(name => library.summary(name).entries);
    assert.deepEqual(counts, names.map(() => 3));
    assert.equal(loads.length, reads, 'every Home count came from a summary');
    assert.equal(library.stats().copies, 2);
});
