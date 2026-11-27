// Per-book revisions (src/ui/st-books.js): a cache kept for one book must not be thrown away by an edit to another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../src/ui/st-books.js';

function setup() {
    const books = {
        A: { entries: { 0: { uid: 0, key: ['alpha'], content: 'A' } } },
        B: { entries: { 0: { uid: 0, key: ['beta'], content: 'B' } } },
    };
    const settings = { books: {} };
    const ctx = {
        getWorldInfoNames: () => Object.keys(books),
        loadWorldInfo: async name => structuredClone(books[name]),
        getRequestHeaders: () => ({}),
        updateWorldInfoList: async () => {},
        saveSettingsDebounced: () => {},
        reloadWorldInfoEditor: () => {},
        characters: [],
        chatMetadata: {},
    };
    const WI = {
        deleteWorldInfo: async name => { delete books[name]; return true; },
        world_info: { charLore: [] },
        METADATA_KEY: 'world_info',
        selected_world_info: [],
    };
    const library = createLibrary({
        ctx: () => ctx, WI, settings, saveSettings: () => {},
        writeBook: async (name, data) => { books[name] = data; },
    });
    return { library, books };
}

const sanitize = () => async (_url, options) => ({ ok: true, json: async () => ({ fileName: JSON.parse(options.body).fileName }) });

test('editing one book bumps its revision and leaves another book\'s cache key alone', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library } = setup();
    await library.get('A');
    await library.get('B');
    const a0 = library.bookVersion('A');
    const b0 = library.bookVersion('B');
    const global0 = library.version;
    library.change('A', d => { d.entries[0].content = 'A1'; }, { quiet: true });
    assert.ok(library.bookVersion('A') > a0, 'A bumped');
    assert.equal(library.bookVersion('B'), b0, 'B keeps the key its model and clashes are cached under');
    assert.ok(library.version > global0, 'Home still redraws');
});

test('two edits bump twice; a save without a new edit does not bump again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { library } = setup();
    await library.get('A');
    library.change('A', d => { d.entries[0].content = 'A1'; }, { quiet: true });
    const first = library.bookVersion('A');
    library.change('A', d => { d.entries[0].content = 'A2'; }, { quiet: true });
    const second = library.bookVersion('A');
    assert.ok(second > first, 'the second edit bumped again');
    await library.save('A');
    assert.equal(library.bookVersion('A'), second, 'confirming the save is not another edit');
});

test('an external update bumps only the book it is for', async () => {
    const { library, books } = setup();
    await library.get('A');
    await library.get('B');
    const a0 = library.bookVersion('A');
    const b0 = library.bookVersion('B');
    const global0 = library.version;
    const outside = structuredClone(books.B);
    outside.entries[0].content = 'B outside';
    library.onWorldInfoUpdated('B', outside);
    assert.ok(library.bookVersion('B') > b0, 'B bumped');
    assert.equal(library.bookVersion('A'), a0, 'A untouched');
    assert.ok(library.version > global0, 'Home still redraws');
});

test('a removed book starts fresh when it is made again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', sanitize());
    const { library } = setup();
    await library.get('A');
    library.change('A', d => { d.entries[0].content = 'A1'; }, { quiet: true });
    library.change('A', d => { d.entries[0].content = 'A2'; }, { quiet: true });
    const old = library.bookVersion('A');
    await library.remove('A');
    assert.equal(library.bookVersion('A'), 0, 'a removed name answers nothing');
    const global0 = library.version;
    await library.create('A');
    const fresh = library.bookVersion('A');
    assert.ok(fresh > 0, 'the new book has a revision');
    assert.notEqual(fresh, old, 'not the removed book\'s revision');
    assert.ok(library.version > global0, 'Home still redraws');
});

test('a rename carries the revision to the new name and forgets the old one', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', sanitize());
    const { library } = setup();
    await library.get('A');
    library.change('A', d => { d.entries[0].content = 'A1'; }, { quiet: true });
    const old = library.bookVersion('A');
    assert.ok(old > 0);
    const global0 = library.version;
    await library.rename('A', 'A new');
    assert.equal(library.bookVersion('A new'), old, 'the new name answers with the old book\'s revision');
    assert.equal(library.bookVersion('A'), 0, 'the old name is unknown');
    assert.ok(library.version > global0, 'Home still redraws');
});
