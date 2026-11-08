// The library's saves (src/ui/st-books.js) against a stand-in for ST's saveWorldInfo that can fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../src/ui/st-books.js';

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
        ctx: () => ctx, WI: {}, powerUser: null, settings: { books: {} }, saveSettings: () => {},
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
    await library.flush(); // nothing pending any more
});

test('a failed export is reported, not thrown', async () => {
    const { library, errors } = setup(() => false);
    assert.equal(await library.exportBook('Missing'), false);
    assert.deepEqual(errors.map(e => [e.name, e.what]), [['Missing', 'export']]);
});
