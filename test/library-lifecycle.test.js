import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../src/ui/st-books.js';
import { createHistory, withHistory } from '../src/ui/history.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(t, write) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const books = new Map([['Book', { entries: { 0: { uid: 0, content: 'A' }, 1: { uid: 1, content: 'old' } } }]]);
    const settings = { books: {} };
    const ctx = { getWorldInfoNames: () => [...books.keys()], loadWorldInfo: async n => structuredClone(books.get(n)),
        getRequestHeaders: () => ({}), updateWorldInfoList: async () => {}, saveSettingsDebounced() {} };
    const WI = { world_info: {}, deleteWorldInfo: async name => books.delete(name) };
    let writes = 0;
    const library = createLibrary({ ctx: () => ctx, WI, settings, saveSettings() {},
        writeBook: async (name, data) => { await write?.(name, data, ++writes); books.set(name, structuredClone(data)); } });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ fileName: 'New' }) }));
    return { books, library, settings, WI, ctx };
}

test('rename visibly holds editing throughout the destination request and source deletion', async t => {
    const gate = deferred(), started = deferred(), deleting = deferred(), deleteStarted = deferred();
    const { library, WI, books } = setup(t, async () => { started.resolve(); await gate.promise; });
    WI.deleteWorldInfo = async name => { deleteStarted.resolve(); await deleting.promise; return books.delete(name); };
    await library.get('Book');
    const renaming = library.rename('Book', 'New');
    await started.promise;
    assert.equal(library.operationText(), 'Renaming Book');
    assert.throws(() => library.change('Book', d => { d.entries[0].content = 'lost'; }), /Please wait/);
    await assert.rejects(library.remove('Book'), /Please wait/, 'overlapping lifecycle operations are refused');
    gate.resolve(); await deleteStarted.promise;
    assert.throws(() => library.change('Book', () => {}), /Please wait/);
    deleting.resolve();
    assert.equal(await renaming, 'New');
    await library.flush();
    assert.equal(library.operationText(), '');
    assert.equal(books.has('Book'), false);
    assert.equal(books.get('New').entries[0].content, 'A');
});

test('outside merge during a request remains dirty and is saved in a serialized follow-up', async t => {
    const gate = deferred(), started = deferred();
    const { library, books } = setup(t, async (_name, _data, n) => { if (n === 1) { started.resolve(); await gate.promise; } });
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'mine'; });
    const saving = library.flush(); await started.promise;
    const outside = structuredClone(books.get('Book')); outside.entries[1].content = 'outside';
    books.set('Book', outside); library.onWorldInfoUpdated('Book', outside);
    gate.resolve(); await saving;
    assert.equal(books.get('Book').entries[0].content, 'mine');
    assert.equal(books.get('Book').entries[1].content, 'outside');
    assert.deepEqual(books.get('Book'), library.peek('Book'));
});

test('completed external replacement clears Undo even when the reloaded copy has the same contents', async t => {
    const { library, books, settings } = setup(t);
    await library.get('Book');
    const history = createHistory({ library, settings, saveSettings() {} });
    const editor = withHistory(library, history);
    editor.change('Book', d => { d.entries[0].content = 'local'; }, { quiet: true });
    await editor.flush();
    const outside = structuredClone(books.get('Book')); outside.entries[1].content = 'outside';
    books.set('Book', outside); library.onWorldInfoUpdated('Book', outside);
    await library.get('Book');
    assert.equal(history.undo('Book'), false);
    assert.equal(books.get('Book').entries[1].content, 'outside');
    editor.change('Book', d => { d.entries[0].content = 'new local'; }, { quiet: true });
    assert.equal(history.undo('Book'), true);
    await editor.flush();
    assert.equal(books.get('Book').entries[1].content, 'outside');
});

test('delete failure preserves the loaded book, unlocks editing and rejects for the UI', async t => {
    const { library, WI, books } = setup(t);
    await library.get('Book');
    WI.deleteWorldInfo = async () => false;
    await assert.rejects(library.remove('Book'), /book and its backups were kept/);
    assert.ok(library.peek('Book'));
    assert.equal(books.has('Book'), true);
    assert.equal(library.operationText(), '');
    library.change('Book', d => { d.entries[0].content = 'still editable'; });
    await library.flush();
    assert.equal(books.get('Book').entries[0].content, 'still editable');
});

test('rename delete failure keeps both books and reports partial completion', async t => {
    const { library, WI, books } = setup(t);
    await library.get('Book');
    WI.deleteWorldInfo = async () => false;
    await assert.rejects(library.rename('Book', 'New'), /Both books were kept/);
    assert.ok(library.peek('Book'));
    assert.ok(books.has('Book') && books.has('New'));
    assert.equal(library.operationText(), '');
});

test('native edits cached during a save are merged and confirmed before flush completes', async t => {
    const started = deferred(), gate = deferred();
    const { library, books, WI } = setup(t, async (name, data, n) => {
        if (n === 1) { started.resolve(); await gate.promise; }
        else WI.worldInfoCache.set(name, structuredClone(data));
    });
    WI.worldInfoCache = new Map([['Book', structuredClone(books.get('Book'))]]);
    await library.get('Book');
    library.change('Book', d => { d.entries[0].content = 'local'; });
    const saving = library.flush(); await started.promise;
    WI.worldInfoCache.get('Book').entries[1].content = 'native';
    gate.resolve(); await saving;
    assert.equal(books.get('Book').entries[0].content, 'local');
    assert.equal(books.get('Book').entries[1].content, 'native');
});

test('a late native event confirms the latest copy again without invalidating its Undo', async t => {
    const { library, books, settings } = setup(t);
    await library.get('Book');
    const history = createHistory({ library, settings, saveSettings() {} });
    const editor = withHistory(library, history);
    editor.change('Book', d => { d.entries[0].content = 'local'; });
    await editor.flush();
    const confirmed = structuredClone(books.get('Book'));
    // A native request emitted the updated object, but its previously serialized HTTP body was stale.
    books.set('Book', { entries: {} });
    library.onWorldInfoUpdated('Book', confirmed);
    await library.flush();
    assert.deepEqual(books.get('Book'), confirmed);
    assert.equal(history.canUndo('Book'), true);
});
