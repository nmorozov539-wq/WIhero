// normalize is memoized by the raw config object (C3): read-only callers share the result, and every mutating
// caller gets its own copy, so the cache never sees an edit made through it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/engine/model.js';
import { bookEditor } from '../src/ui/pieces.js';

const entry = (uid, id, comment = 'Entry') => ({ uid, comment, key: [comment.toLowerCase()], content: '', ...(id ? { extensions: { wihero: { id } } } : {}) });
const book = (...entries) => ({ entries: Object.fromEntries(entries.map(e => [e.uid, e])) });

test('the same raw object gives the same normalized object; a different raw object does not', () => {
    const raw = { id: 'a', folder: 'Places', gates: ['b'] };
    const one = normalize(raw);
    assert.equal(normalize(raw), one, 'a hit is the same object');
    assert.deepEqual(one.config, { id: 'a', gate: [['b']], closesFor: ['b'] });
    assert.deepEqual(one.ui, { folder: 'Places' });
    assert.equal(one.legacy, true);
    const other = normalize({ id: 'a', folder: 'Places', gates: ['b'] });
    assert.notEqual(other, one, 'a new raw object gets a new result');
    assert.deepEqual(other.config, one.config);
});

test('non-objects are not cached', () => {
    for (const value of [null, 'story', 42, true]) {
        const a = normalize(value);
        assert.notEqual(normalize(value), a, `${value} gives a fresh result`);
        assert.deepEqual(a, { config: value, ui: {}, legacy: false });
    }
});

test('a bookEditor update does not change the cached config of the raw object it started from', () => {
    const d = book(entry(0, 'a'));
    const raw = d.entries[0].extensions.wihero;
    const cached = normalize(raw);
    assert.deepEqual(cached.config, { id: 'a' });
    bookEditor(d).update(0, c => { c.gate = [['b']]; });
    assert.deepEqual(cached.config, { id: 'a' }, 'the cached config still holds what that raw held');
    const after = d.entries[0].extensions.wihero;
    assert.notEqual(after, raw, 'the edit stored a new raw object');
    assert.deepEqual(normalize(after).config, { id: 'a', gate: [['b']] }, 'the stored raw normalizes to the edited values');
});

test('two entries do not share a config', () => {
    const d = book(entry(0, 'a'), entry(1, 'b'));
    const ed = bookEditor(d);
    ed.update(0, c => { c.note = 'first'; });
    assert.equal(d.entries[1].extensions.wihero.note, undefined, 'the other entry is untouched');
    assert.notEqual(normalize(d.entries[0].extensions.wihero).config, normalize(d.entries[1].extensions.wihero).config);
    ed.update(1, c => { c.note = 'second'; });
    assert.equal(d.entries[0].extensions.wihero.note, 'first');
    assert.equal(d.entries[1].extensions.wihero.note, 'second');
});
