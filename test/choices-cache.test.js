// The character filter's choices are cached (C6): one provider call until invalidate(), and the provider's shape
// and order come through unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charsText, filterChoices } from '../src/ui/data.js';

test('the provider result is cached until invalidate()', () => {
    let calls = 0;
    const list = { chars: [{ key: 'Sera', name: 'Seraphina' }], tags: [{ key: 't1', name: 'fantasy' }] };
    filterChoices.setProvider(() => { calls++; return list; });
    const a = filterChoices.get();
    const b = filterChoices.get();
    assert.equal(calls, 1, 'the provider ran once');
    assert.equal(b, a, 'both calls get the cached object');
    filterChoices.invalidate();
    assert.equal(filterChoices.get(), list, 'a rebuild asks the provider again');
    assert.equal(calls, 2);
});

test('item shape and order are the provider\'s', () => {
    filterChoices.setProvider(() => ({
        chars: [{ key: 'B', name: 'Bea' }, { key: 'A', name: 'Al' }],
        tags: [{ key: 2, name: 'second' }, { key: 1, name: 'first' }],
    }));
    const { chars, tags } = filterChoices.get();
    assert.deepEqual(chars, [{ key: 'B', name: 'Bea' }, { key: 'A', name: 'Al' }]);
    assert.deepEqual(tags, [{ key: 2, name: 'second' }, { key: 1, name: 'first' }]);
    assert.equal(charsText({ isExclude: false, names: ['B', 'A'], tags: [2] }), 'Only Bea, Al, #second');
});

test('a character edit between calls sees the new list', () => {
    let chars = [{ key: 'Sera', name: 'Seraphina' }];
    filterChoices.setProvider(() => ({ chars, tags: [] }));
    assert.equal(charsText({ names: ['Sera'], tags: [] }), 'Only Seraphina');
    chars = [{ key: 'Sera', name: 'Seraphina Vale' }];
    filterChoices.invalidate();
    assert.equal(charsText({ names: ['Sera'], tags: [] }), 'Only Seraphina Vale');
});
