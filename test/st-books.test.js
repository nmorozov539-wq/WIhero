// The library's saves (src/ui/st-books.js) against a stand-in for ST's saveWorldInfo that can fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, mergeOutside } from '../src/ui/st-books.js';

function setup(fail) {
    const saved = [];
    const errors = [];
    const books = { Book: { entries: { 0: { uid: 0, key: ['a'], content: 'A' } } } };
    const ctx = {
        getWorldInfoNames: () => Object.keys(books),
        loadWorldInfo: async name => structuredClone(books[name]),
        saveWorldInfo: async (name, data) => { if (fail()) throw new Error('disk full'); saved.push(name); books[name] = data; },
    };
    const library = createLibrary({
        ctx: () => ctx, writeBook: (name, data) => ctx.saveWorldInfo(name, data), WI: {}, powerUser: null, settings: { books: {} }, saveSettings: () => {},
        onSaveError: (name, e, final, what) => errors.push({ name, message: e.message, final, what }),
    });
    return { library, saved, errors, books };
}

test('a failed save is reported and the edit is kept; flush rejects so a book action stops', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let failing = true;
    const { library, saved, errors, books } = setup(() => failing);
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'B'; }, { quiet: true });
    await assert.rejects(library.flush(), /could not be saved/);
    assert.deepEqual(errors.map(e => [e.name, e.message, e.final]), [['Book', 'disk full', false]]);
    assert.equal(library.peek('Book').entries[0].content, 'B', 'the working copy keeps the edit');
    failing = false;
    t.mock.timers.tick(5000); // the retry
    await new Promise(r => setImmediate(r));
    assert.deepEqual(saved, ['Book']);
    assert.equal(books.Book.entries[0].content, 'B');
});

test('after a few failures in a row, the save stops retrying and says so', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library, errors } = setup(() => true);
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'B'; }, { quiet: true });
    await library.flush().catch(() => {});
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(5000); await new Promise(r => setImmediate(r)); }
    assert.deepEqual(errors.map(e => e.final), [false, false, true]);
    await assert.rejects(library.flush(), /could not be saved/, 'a book left unsaved is tried again on flush');
});

test('a failed export is reported, not thrown', async () => {
    const { library, errors } = setup(() => false);
    assert.equal(await library.exportBook('Missing'), false);
    assert.deepEqual(errors.map(e => [e.name, e.what]), [['Missing', 'export']]);
});

// ---- review 2026-11-09: outside saves during a pending save (3), unsaved books (5), reused names (2)

function setupOutside() {
    const books = { Book: { entries: { 0: { uid: 0, key: ['a'], content: 'A' }, 1: { uid: 1, key: ['b'], content: 'B' } } } };
    const merged = [];
    let onUpdated = null;
    const ctx = {
        getWorldInfoNames: () => Object.keys(books),
        loadWorldInfo: async name => structuredClone(books[name]),
        saveWorldInfo: async (name, data) => { books[name] = data; onUpdated?.(name, data); },
    };
    const library = createLibrary({
        ctx: () => ctx, writeBook: (name, data) => ctx.saveWorldInfo(name, data), WI: {}, powerUser: null, settings: { books: {} }, saveSettings: () => {},
        onMerged: (name, n) => merged.push([name, n]),
    });
    onUpdated = library.onWorldInfoUpdated;
    /** A save from outside WI Hero (ST's editor, /setentryfield). */
    const outside = fn => { const d = structuredClone(books.Book); fn(d); books.Book = d; library.onWorldInfoUpdated('Book', d); };
    return { library, books, merged, outside };
}

test('an outside save during a pending save is merged per entry, not overwritten', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library, books, merged, outside } = setupOutside();
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'A mine'; }, { quiet: true });
    outside(d => { d.entries[1].content = 'B outside'; d.entries[2] = { uid: 2, key: ['c'], content: 'C' }; });
    assert.deepEqual(merged, [['Book', 0]]);
    await library.flush();
    assert.equal(books.Book.entries[0].content, 'A mine');
    assert.equal(books.Book.entries[1].content, 'B outside', 'the outside edit survives WI Hero\'s save');
    assert.equal(books.Book.entries[2].content, 'C', 'an entry added outside survives too');
});

test('an entry changed on both sides keeps WI Hero\'s version, and says so', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library, books, merged, outside } = setupOutside();
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'A mine'; }, { quiet: true });
    outside(d => { d.entries[0].content = 'A outside'; delete d.entries[1]; });
    assert.deepEqual(merged, [['Book', 1]]);
    await library.flush();
    assert.equal(books.Book.entries[0].content, 'A mine');
    assert.equal(books.Book.entries[1], undefined, 'an entry deleted outside stays deleted');
});

test('an outside save with nothing pending drops the working copy', async () => {
    const { library, merged, outside } = setupOutside();
    await library.get('Book');
    outside(d => { d.entries[0].content = 'A outside'; });
    assert.equal(library.peek('Book'), null);
    assert.equal((await library.get('Book')).entries[0].content, 'A outside');
    assert.deepEqual(merged, []);
});

test('mergeOutside: top-level fields follow the same rule', () => {
    const base = { entries: {}, name: 'x', extra: 1 };
    const mine = { entries: {}, name: 'x', extra: 2 };
    const outside = { entries: {}, name: 'y', extra: 3 };
    mergeOutside(mine, base, outside);
    assert.deepEqual(mine, { entries: {}, name: 'y', extra: 2 });
});

test('a book whose save failed for good is marked unsaved until a save works; flush tries it again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let failing = true;
    const { library } = setup(() => failing);
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'B'; }, { quiet: true });
    await library.flush().catch(() => {});
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(5000); await new Promise(r => setImmediate(r)); }
    assert.equal(library.unsaved('Book'), true);
    failing = false;
    await library.flush();
    assert.equal(library.unsaved('Book'), false);
});

test('making a book under a name a rename left behind drops that rename', async () => {
    const books = {};
    const settings = { books: {}, renamed: { Kingdom: 'Kingdom v2', Other: 'Elsewhere' } };
    const ctx = {
        getWorldInfoNames: () => Object.keys(books),
        getRequestHeaders: () => ({}),
        saveWorldInfo: async (name, data) => { books[name] = data; },
        updateWorldInfoList: async () => {},
    };
    globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ fileName: JSON.parse(options.body).fileName }) });
    const library = createLibrary({ ctx: () => ctx, writeBook: (name, data) => ctx.saveWorldInfo(name, data), WI: {}, powerUser: null, settings, saveSettings: () => {} });
    assert.equal(await library.create('Kingdom'), 'Kingdom');
    assert.deepEqual(settings.renamed, { Other: 'Elsewhere' });
});

test('flush waits for active saves and serializes edits made during a request', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release;
    let active = 0;
    let peak = 0;
    const writes = [];
    // Hold the host save, including its native editor reload.
    const held = new Promise(r => { release = r; });
    const ctx = {
        getWorldInfoNames: () => ['Book'], loadWorldInfo: async () => ({ entries: {} }),
        reloadWorldInfoEditor: () => { assert.equal(lib.busy(), true, 'native dropdown changes are suppressed'); },
    };
    const lib = createLibrary({ ctx: () => ctx, WI: {}, settings: { books: {} }, saveSettings() {},
        writeBook: async (_name, data) => {
            peak = Math.max(peak, ++active);
            writes.push(data.value);
            if (writes.length === 1) await held;
            active--;
        },
    });
    await lib.get('Book');
    lib.change('Book', d => { d.value = 1; });
    t.mock.timers.tick(350);
    let finished = false;
    const flushed = lib.flush().then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    lib.change('Book', d => { d.value = 2; });
    t.mock.timers.tick(350);
    release();
    await flushed;
    assert.deepEqual(writes, [1, 2]);
    assert.equal(peak, 1);
});

test('create, rename and duplicate reject sanitized collisions and empty names before writing', async t => {
    const books = { Book: { entries: { 0: { content: 'precious' } } }, Other: { entries: {} } };
    let writes = 0, deletes = 0;
    const ctx = { getWorldInfoNames: () => Object.keys(books), getRequestHeaders: () => ({}),
        loadWorldInfo: async n => structuredClone(books[n]) };
    let sanitized = 'Book';
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ fileName: sanitized }) }));
    const library = createLibrary({ ctx: () => ctx, WI: { deleteWorldInfo: async () => { deletes++; } },
        settings: { books: {} }, saveSettings() {}, writeBook: async () => { writes++; } });
    await assert.rejects(library.create('Book?'), /exists/);
    await assert.rejects(library.rename('Other', 'Book?'), /exists/);
    await assert.rejects(library.duplicate('Other'), /exists/);
    sanitized = '';
    await assert.rejects(library.create('???'), /Type a name/);
    await assert.rejects(library.rename('Other', '???'), /Type a name/);
    await assert.rejects(library.duplicate('Other'), /Type a name/);
    assert.equal(writes, 0);
    assert.equal(deletes, 0);
    assert.equal(books.Book.entries[0].content, 'precious');
});

test('delete waits for an active write before removing the book', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const order = [];
    const ctx = { getWorldInfoNames: () => ['Book'], loadWorldInfo: async () => ({ entries: {} }) };
    const library = createLibrary({ ctx: () => ctx, WI: { deleteWorldInfo: async () => { order.push('delete'); } },
        settings: { books: {} }, saveSettings() {}, writeBook: async () => { await held; order.push('write'); } });
    await library.get('Book');
    library.change('Book', d => { d.value = 1; });
    t.mock.timers.tick(350);
    const removing = library.remove('Book');
    await Promise.resolve();
    assert.deepEqual(order, []);
    release();
    await removing;
    assert.deepEqual(order, ['write', 'delete']);
    assert.equal(library.peek('Book'), null);
});
