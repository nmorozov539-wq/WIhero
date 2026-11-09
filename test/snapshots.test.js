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
