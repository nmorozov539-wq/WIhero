// The app's disposal registry (src/ui/lifecycle.js, A4): one place for the listeners, observers and timers a component
// owns, so a teardown is one call and running it twice is safe. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDisposer } from '../src/ui/lifecycle.js';

test('dispose runs every cleanup once, in registration order, and is idempotent', () => {
    const d = createDisposer();
    const seen = [];
    d.add(() => seen.push('first'));
    d.add(() => seen.push('second'));
    assert.equal(d.size, 2);
    d.dispose();
    assert.deepEqual(seen, ['first', 'second']);
    assert.equal(d.disposed, true);
    assert.equal(d.ran, true);
    assert.equal(d.size, 0);
    d.dispose();
    assert.deepEqual(seen, ['first', 'second'], 'a second dispose runs nothing');
});

test('unregister removes one cleanup without running it', () => {
    const d = createDisposer();
    const seen = [];
    const off = d.add(() => seen.push('kept'));
    const dropped = d.add(() => seen.push('dropped'));
    assert.equal(typeof off, 'function');
    dropped();
    assert.equal(d.size, 1);
    d.dispose();
    assert.deepEqual(seen, ['kept']);
});

test('a cleanup added after dispose runs at once instead of leaking', () => {
    const d = createDisposer();
    d.dispose();
    let ran = 0;
    const off = d.add(() => ran++);
    assert.equal(ran, 1);
    assert.equal(d.size, 0);
    off();
});

test('one failing cleanup does not stop the rest', () => {
    const d = createDisposer();
    const errors = [];
    const original = console.error;
    console.error = (...a) => errors.push(a);
    try {
        const seen = [];
        d.add(() => { throw new Error('boom'); });
        d.add(() => seen.push('still runs'));
        d.dispose();
        assert.deepEqual(seen, ['still runs']);
        assert.equal(errors.length, 1);
    } finally {
        console.error = original;
    }
});

test('a non-function is ignored', () => {
    const d = createDisposer();
    assert.equal(typeof d.add(null), 'function');
    assert.equal(d.size, 0);
    d.dispose();
});
