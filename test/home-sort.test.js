// The Home list's sort (src/ui/desk.js homeSort): keys are computed once per book, and the order matches the
// comparator the list used before (ties keep their input order, whichever direction is chosen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeSort } from '../src/ui/desk.js';

const books = [
    { name: 'Delta', active: 0, entries: 3, edited: 100 },
    { name: 'alpha', active: 1, entries: null, edited: 0 }, // not loaded: entries sort as -1
    { name: 'Beta', active: 2, entries: 3, edited: 100 },
    { name: 'alpha', active: 1, entries: 0, edited: 0 }, // a tie on name, active and edited
    { name: 'Gamma', active: 0, entries: null, edited: 200 },
    { name: 'epsilon', active: 2, entries: 3, edited: 200 },
];

const keyOf = (book, key) => (key === 'entries' ? (book.entries ?? -1)
    : key === 'edited' ? (book.edited ?? 0) : key === 'active' ? book.active : book.name.toLowerCase());

/** The comparator the list used before the keys were precomputed. */
const oldSort = (list, key, dir) => [...list].sort((a, b) => {
    const va = keyOf(a, key);
    const vb = keyOf(b, key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
});

test('same order as the old comparator for every key and both directions', () => {
    for (const key of ['name', 'active', 'entries', 'edited']) {
        for (const dir of [1, -1]) {
            assert.deepEqual(homeSort(books, key, dir, keyOf), oldSort(books, key, dir), `${key} ${dir}`);
        }
    }
});

test('ties keep their input order in both directions', () => {
    const names = homeSort(books, 'active', 1, keyOf).map(b => b.name);
    assert.deepEqual(names, ['Delta', 'Gamma', 'alpha', 'alpha', 'Beta', 'epsilon']);
    assert.deepEqual(homeSort(books, 'active', -1, keyOf).map(b => b.name), ['Beta', 'epsilon', 'alpha', 'alpha', 'Delta', 'Gamma']);
});

test('unloaded books sort as -1 entries, ahead of a loaded book with none', () => {
    assert.deepEqual(homeSort(books, 'entries', 1, keyOf).map(b => [b.name, keyOf(b, 'entries')]), [
        ['alpha', -1], ['Gamma', -1], ['alpha', 0], ['Delta', 3], ['Beta', 3], ['epsilon', 3],
    ]);
});

test('the value lookup runs once per book', () => {
    for (const key of ['name', 'active', 'entries', 'edited']) {
        let calls = 0;
        const result = homeSort(books, key, 1, book => { calls++; return keyOf(book, key); });
        assert.equal(calls, books.length, key);
        assert.equal(result.length, books.length);
    }
    const input = books.slice();
    homeSort(books, 'name', 1, keyOf);
    assert.deepEqual(books, input, 'the input list is left alone');
});
