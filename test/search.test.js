// Search's per-book corpus (M4): the cached lowercase fields, the same hits and order as data.search, the caps, and
// the debounce. No DOM and no SillyTavern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/ui/data.js';
import { buildBookCorpus, createDebounced, createSearchCache, SEARCH_LIMITS, searchCorpus } from '../src/ui/search.js';

const entry = (uid, comment, key = [comment.toLowerCase()], extra = {}) => ({ uid, comment, key, content: '', ...extra });
const folderIn = map => e => map[e.uid] ?? '';

/** The fixtures data.search takes; searchCorpus must answer exactly the same for each query below. */
function books() {
    return [
        {
            name: 'Eldoria',
            folder: 'Fantasy',
            entries: [entry(0, 'River', ['river']), entry(1, 'King', ['king']), entry(2, 'Tide', ['tide'])],
            folderOf: folderIn({ 0: 'Rivers', 2: 'Rivers' }),
        },
        {
            name: 'River tales',
            folder: '',
            entries: [entry(0, 'riverbank', ['Mill']), entry(1, 'Harbor', ['harbor', 'river mouth'])],
            folderOf: () => '',
        },
        {
            name: 'Notes',
            folder: '',
            entries: [entry(0, 'Off but searchable', ['off'], { disable: true })],
            folderOf: () => '',
        },
    ];
}

const corpus = list => list.map(b => buildBookCorpus(b.name, b.folder, b.entries, b.folderOf));

test('searchCorpus gives the same hits and order as data.search', () => {
    const list = books();
    const built = corpus(list);
    for (const query of ['river', 'RIVER', 'king', 'fantasy', 'rivers', 'mill', 'harbor', 'off', 'notes', '  ', 'nothing', 'e']) {
        for (const current of ['Eldoria', 'River tales', null, 'Notes']) {
            assert.deepEqual(
                searchCorpus(built, query, current),
                search(list, query, current),
                `query ${JSON.stringify(query)} with current ${current}`,
            );
        }
    }
});

test('current-book priority, folder dedupe, case and key words match', () => {
    const built = corpus(books());
    assert.deepEqual(searchCorpus(built, 'river', 'River tales').map(h => `${h.kind}:${h.book ?? ''}:${h.folder ?? h.entry?.comment ?? ''}`), [
        'entry:River tales:riverbank', 'entry:River tales:Harbor', 'entry:Eldoria:River', 'book:River tales:', 'folder:Eldoria:Rivers',
    ]);
    assert.deepEqual(searchCorpus(built, 'RIVERS', null).map(h => h.kind), ['folder'], 'one folder row for two entries');
    assert.deepEqual(searchCorpus(built, 'king', null).map(h => h.entry?.comment), ['King'], 'a key word hit and a clean miss');
});

test('visible-entry rules are the caller\'s: Moments and hidden entries are not in the corpus, off entries are', () => {
    const list = books();
    const moment = entry(9, 'Moment of the mill', ['momentmill'], { extensions: { wihero: { id: 'moment-1', moment: true } } });
    const shown = [...list[1].entries, entry(2, 'Shown', ['millside']), moment];
    // Only what entriesShown passes reaches the index; off entries stay in, as they do today.
    const built = [buildBookCorpus('River tales', '', shown.filter(e => !e.extensions?.wihero?.moment), () => '')];
    assert.equal(searchCorpus(built, 'momentmill', null).length, 0, 'a Moment is never in the index');
    assert.deepEqual(searchCorpus(built, 'off', null).length, 0, 'a Moment\'s words find nothing');
    const notes = corpus(list).find(b => b.name === 'Notes');
    assert.deepEqual(searchCorpus([notes], 'off', null).map(h => h.entry.comment), ['Off but searchable'], 'an off entry is still searchable, as before');
});

test('the caps are the overlay limits, applied after the scan', () => {
    const many = Array.from({ length: 120 }, (_, uid) => entry(uid, `Mill ${uid}`, ['mill']));
    const built = [buildBookCorpus('Big', '', many, () => '')];
    const hits = searchCorpus(built, 'mill', 'Big');
    assert.equal(hits.length, 120);
    assert.equal(hits.slice(0, SEARCH_LIMITS.phone).length, 80);
    assert.equal(hits.slice(0, SEARCH_LIMITS.desktop).length, 60);
});

test('the corpus cache reuses a book until its revision, working copy or settings stamp changes', () => {
    let rev = 1;
    let stamp = 0;
    const cache = createSearchCache({ revision: () => rev, stamp: () => stamp });
    const data = { entries: {} };
    let builds = 0;
    const entriesOf = () => { builds++; return [entry(0, 'Mill')]; };
    const folderOf = () => '';

    const first = cache.book('Book', data, '', entriesOf, folderOf);
    const again = cache.book('Book', data, '', entriesOf, folderOf);
    assert.equal(again, first, 'a keystroke reuses the corpus');
    assert.equal(builds, 1);

    rev++;
    const changed = cache.book('Book', data, '', entriesOf, folderOf);
    assert.notEqual(changed, first, 'a library.change bumps the revision and the next query rebuilds');
    assert.equal(builds, 2);
    assert.deepEqual(searchCorpus([changed], 'mill', null).map(h => h.entry.comment), ['Mill']);

    stamp++;
    cache.book('Book', data, '', entriesOf, folderOf);
    assert.equal(builds, 3, 'a settings save (a folder move) rebuilds once');

    cache.book('Book', { entries: {} }, '', entriesOf, folderOf);
    assert.equal(builds, 4, 'a different working copy is not the old book');

    cache.invalidate('Book');
    assert.equal(cache.size(), 0, 'invalidation releases the corpus and its entry references');
    cache.book('Book', { entries: {} }, '', entriesOf, folderOf);
    assert.equal(builds, 5, 'the hidden-entry set can drop one book');
    cache.clear();
    assert.equal(cache.size(), 0, 'closing search releases every corpus');
    const reopened = cache.book('Book', data, '', entriesOf, folderOf);
    assert.deepEqual(searchCorpus([reopened], 'mill', null).map(h => h.entry.comment), ['Mill'], 'reopening rebuilds the same ranked hit');
    assert.equal(builds, 6);
});

test('the debounce runs a burst once, and flush runs the pending query now', () => {
    let t = 0;
    const timers = new Map();
    const set = (fn, ms) => { timers.set(++t, { fn, ms }); return t; };
    const clear = id => timers.delete(id);
    const fire = () => { const due = [...timers.entries()]; timers.clear(); for (const [, x] of due) x.fn(); };
    let runs = 0;
    const lazy = createDebounced(() => { runs++; }, 130, { set, clear });

    for (let i = 0; i < 10; i++) lazy.call();
    assert.equal(runs, 0, 'ten keys within the window schedule one run');
    assert.equal(timers.size, 1);
    fire();
    assert.equal(runs, 1);

    lazy.call();
    assert.equal(lazy.pending(), true);
    assert.equal(lazy.flush(), true);
    assert.equal(runs, 2, 'Enter or an arrow acts on the current query');
    assert.equal(timers.size, 0);
    assert.equal(lazy.flush(), false, 'nothing waits after a flush');

    lazy.call();
    lazy.cancel();
    fire();
    assert.equal(runs, 2, 'a closed overlay cancels its waiting run');
});
