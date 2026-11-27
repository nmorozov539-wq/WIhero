// The page-motion helper (src/ui/page-motion.js, A3): hidden and reduced-motion reads with the DOM injected, plus a
// change subscription that a missing visibility API turns into a no-op. No browser and no global document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPageMotion, REDUCED_MOTION } from '../src/ui/page-motion.js';

/** A document stand-in that records its listeners. */
function fakeDoc(visibilityState) {
    const listeners = new Map();
    return {
        visibilityState,
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
        emit(type) { listeners.get(type)?.(); },
        listeners,
    };
}

/** A matchMedia stand-in with one query and, optionally, only the legacy listener methods. */
function fakeMedia(matches, { legacy = false } = {}) {
    const listeners = new Map();
    const list = { matches };
    if (legacy) {
        list.addListener = fn => listeners.set('legacy', fn);
        list.removeListener = fn => { if (listeners.get('legacy') === fn) listeners.delete('legacy'); };
    } else {
        list.addEventListener = (type, fn) => listeners.set(type, fn);
        list.removeEventListener = (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); };
    }
    return { list, listeners, media: () => list };
}

test('a missing document is the visible path', () => {
    const motion = createPageMotion({ document: undefined, matchMedia: undefined });
    assert.equal(motion.hidden(), false);
    assert.equal(motion.reduced(), false);
    assert.deepEqual(motion.snapshot(), { hidden: false, reduced: false });
    const off = motion.listen(() => { throw new Error('never called'); });
    assert.equal(typeof off, 'function');
    off(); // no document: still safe to call
});

test('visibilityState hidden is read, and a missing visibility API is not', () => {
    assert.equal(createPageMotion({ document: fakeDoc('hidden') }).hidden(), true);
    assert.equal(createPageMotion({ document: fakeDoc('visible') }).hidden(), false);
    assert.equal(createPageMotion({ document: {} }).hidden(), false);
});

test('matchMedia answers reduced motion when it is available', () => {
    const reduce = fakeMedia(true);
    const motion = createPageMotion({ document: fakeDoc('visible'), matchMedia: reduce.media });
    assert.equal(motion.reduced(), true);
    assert.equal(motion.snapshot().reduced, true);
    assert.equal(createPageMotion({ document: fakeDoc('visible'), matchMedia: fakeMedia(false).media }).reduced(), false);
    assert.equal(createPageMotion({ document: fakeDoc('visible'), matchMedia: null }).reduced(), false);
});

test('listen fires on visibilitychange and on a changed motion preference, then unsubscribes', () => {
    const doc = fakeDoc('visible');
    const media = fakeMedia(false);
    const motion = createPageMotion({ document: doc, matchMedia: media.media });
    const seen = [];
    const off = motion.listen(state => seen.push(state));

    assert.ok(media.listeners.has('change'), 'motion changes are watched');
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    assert.deepEqual(seen.at(-1), { hidden: true, reduced: false });

    doc.visibilityState = 'visible';
    media.list.matches = true;
    media.listeners.get('change')();
    assert.deepEqual(seen.at(-1), { hidden: false, reduced: true });

    off();
    assert.equal(doc.listeners.has('visibilitychange'), false);
    assert.equal(media.listeners.has('change'), false);
});

test('an old WebView with addListener is watched and unwatched the same way', () => {
    const doc = fakeDoc('hidden');
    const media = fakeMedia(true, { legacy: true });
    const seen = [];
    const off = createPageMotion({ document: doc, matchMedia: media.media }).listen(state => seen.push(state));
    assert.ok(media.listeners.has('legacy'));
    media.listeners.get('legacy')();
    assert.deepEqual(seen.at(-1), { hidden: true, reduced: true });
    off();
    assert.equal(media.listeners.has('legacy'), false);
});

test('the reduced-motion query is the one the editor CSS uses', () => {
    assert.equal(REDUCED_MOTION, '(prefers-reduced-motion: reduce)');
});
