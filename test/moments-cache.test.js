// Moments' fast path (C9): a book's Moments are kept by the library revision, placed ones are filtered per call,
// and a book without Moments never builds a canvas model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offCanvasMoments } from '../src/ui/canvas-graph.js';

const moment = (uid, id) => ({ uid, key: [], content: '', disable: true, extensions: { wihero: { id, moment: true } } });
const plain = (uid, id, config = {}) => ({ uid, content: '', extensions: { wihero: { id, ...config } } });
const book = (...entries) => ({ entries: Object.fromEntries(entries.map(e => [e.uid, e])) });
const uids = list => list.map(e => e.uid);

test('a book with no Moments returns none without building a canvas model', () => {
    // A plain entry whose key would throw if the canvas read it: only the Moments scan may look at entries.
    const entry = plain(0, 'plain');
    Object.defineProperty(entry, 'key', { get() { throw new Error('the canvas was built'); } });
    const data = book(entry);
    assert.deepEqual(offCanvasMoments(data, {}, 4), []);
    assert.deepEqual(offCanvasMoments(data, {}, 4), [], 'the cached empty list is reused');
});

test('placed Moments stay, graph-visible Moments stay, unplaced Moments come back', () => {
    const data = book(moment(0, 'placed'), moment(1, 'free'), moment(2, 'linked'), plain(3, 'target', { gate: [['linked']] }));
    const memory = { cards: { 'id:placed': { placed: true } } };
    assert.deepEqual(uids(offCanvasMoments(data, memory, 1)), [1]);
    assert.deepEqual(uids(offCanvasMoments(data, { cards: {} }, 1)), [0, 1], 'without its placement it is off canvas again');
});

test('the cache follows the revision and never shares between books', () => {
    const data = book(moment(0, 'a'));
    assert.deepEqual(uids(offCanvasMoments(data, {}, 7)), [0]);

    data.entries[1] = moment(1, 'b');
    assert.deepEqual(uids(offCanvasMoments(data, {}, 7)), [0], 'the same revision reuses the cached list');
    assert.deepEqual(uids(offCanvasMoments(data, {}, 8)), [0, 1], 'a new revision sees the added Moment');

    delete data.entries[0];
    assert.deepEqual(uids(offCanvasMoments(data, {}, 9)), [1], 'a new revision sees the removal');

    const other = book(moment(0, 'other'));
    assert.deepEqual(offCanvasMoments(other, {}, 9).map(e => e.extensions.wihero.id), ['other'], 'the same revision in another book');

    data.entries[0] = moment(0, 'a');
    assert.deepEqual(uids(offCanvasMoments(data, {}, null)), [0, 1], 'null computes uncached');
});
