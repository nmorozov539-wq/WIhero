// Undo history (src/ui/history.js): steps, typing merged, one action one step, the strip held, outside changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, withHistory } from '../src/ui/history.js';

function setup() {
    const books = { b: { entries: { 0: { uid: 0, comment: 'A', content: '' } } } };
    let version = 0;
    const raw = {
        peek: n => books[n],
        change(n, fn) { const out = fn(books[n]); version++; return out; },
        get version() { return version; },
        outside(n, fn) { fn(books[n]); version++; }, // a save from ST's own editor
    };
    const settings = { books: { b: { folders: {}, canvas: { camera: { x: 0 }, cards: {} } } } };
    let t = 0;
    let held = false;
    const history = createHistory({ library: raw, settings, saveSettings: () => {}, held: () => held, now: () => t });
    const library = withHistory(raw, history);
    const tick = () => new Promise(r => setTimeout(r, 0)); // a new task
    return { books, raw, settings, history, library, tick, at: v => { t = v; }, hold: v => { held = v; } };
}

test('undo and redo step through changes; the camera is not an edit', async () => {
    const { books, settings, history, library, tick } = setup();
    history.touch('b');
    library.change('b', d => { d.entries[0].comment = 'B'; });
    await tick();
    library.change('b', d => { d.entries[0].comment = 'C'; });
    await tick();
    settings.books.b.canvas.camera = { x: 99 };
    history.touch('b', { redraw: true });
    assert.ok(history.canUndo('b'));
    assert.ok(history.undo('b'));
    assert.equal(books.b.entries[0].comment, 'B');
    assert.deepEqual(settings.books.b.canvas.camera, { x: 99 }, 'the camera stays where it is');
    assert.ok(history.undo('b'));
    assert.equal(books.b.entries[0].comment, 'A');
    assert.equal(history.undo('b'), false);
    assert.ok(history.redo('b'));
    assert.equal(books.b.entries[0].comment, 'B');
    // A new change clears redo.
    await tick();
    library.change('b', d => { d.entries[0].comment = 'D'; });
    assert.equal(history.canRedo('b'), false);
});

test('typing merges into one step; a redraw ends it', async () => {
    const { books, history, library, tick, at } = setup();
    history.touch('b');
    for (const [i, s] of ['h', 'he', 'hel'].entries()) { at(i * 300); library.change('b', d => { d.entries[0].content = s; }, { quiet: true }); await tick(); }
    history.touch('b', { redraw: true });
    at(1000);
    library.change('b', d => { d.entries[0].content = 'hello'; }, { quiet: true });
    await tick();
    history.undo('b');
    assert.equal(books.b.entries[0].content, 'hel');
    history.undo('b');
    assert.equal(books.b.entries[0].content, '');
});

test('an edit and its settings in the same task are one step; settings alone are a step', async () => {
    const { books, settings, history, library, tick } = setup();
    history.touch('b');
    library.change('b', d => { d.entries[0].comment = 'B'; });
    settings.books.b.folders['uid:0'] = 'People';
    history.touch('b', { redraw: true });
    await tick();
    settings.books.b.canvas.cards.k = { x: 5 }; // a card moved
    history.touch('b', { redraw: true });
    history.undo('b');
    assert.equal(settings.books.b.canvas.cards.k, undefined);
    assert.equal(books.b.entries[0].comment, 'B');
    history.undo('b');
    assert.equal(books.b.entries[0].comment, 'A');
    assert.equal(settings.books.b.folders['uid:0'], undefined);
});

test('nothing is recorded while held; Done is one step, Cancel none', async () => {
    const { books, history, library, tick, hold } = setup();
    history.touch('b');
    hold(true);
    library.change('b', d => { d.entries[0].comment = 'X'; });
    await tick();
    library.change('b', d => { d.entries[0].comment = 'Y'; });
    assert.equal(history.undo('b'), false, 'no undo while a strip is open');
    hold(false);
    await tick();
    history.touch('b', { redraw: true });
    history.undo('b');
    assert.equal(books.b.entries[0].comment, 'A');
    assert.equal(history.canUndo('b'), false);
});

test('a change from outside WI Hero starts the history over', async () => {
    const { books, raw, history, library, tick } = setup();
    history.touch('b');
    library.change('b', d => { d.entries[0].comment = 'B'; });
    await tick();
    raw.outside('b', d => { d.entries[0].comment = 'ST'; });
    history.touch('b', { redraw: true });
    assert.equal(history.canUndo('b'), false);
    assert.equal(books.b.entries[0].comment, 'ST');
});

test('bookkeeping in the book settings (a save time, snapshots) is never a step and survives an undo', async () => {
    const { books, settings, history, library, tick } = setup();
    history.touch('b');
    library.change('b', d => { d.entries[0].comment = 'B'; });
    await tick();
    settings.books.b.edited = 1234; // the library's save, a moment later
    settings.books.b.snapshots = [{ at: 1 }];
    history.touch('b', { redraw: true });
    assert.ok(history.undo('b'));
    assert.equal(books.b.entries[0].comment, 'A', 'one undo reaches the edit');
    assert.equal(settings.books.b.edited, 1234);
    assert.deepEqual(settings.books.b.snapshots, [{ at: 1 }]);
    settings.books.b.edited = 5678; // the undo's own save
    history.touch('b', { redraw: true });
    assert.equal(history.canUndo('b'), false);
    assert.ok(history.canRedo('b'), 'a save after undo keeps redo');
});
