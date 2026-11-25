// Whether the page's optional motion may run: the document is visible, and the reader has not asked for less motion.
// A missing visibility API is the visible path, so old or partial engines keep today's behavior. The DOM is injected
// (a document-like object and a matchMedia), which keeps this testable in Node without a browser.
//
// The editor chunk owns one of these (app.js), so a never-opened editor pays nothing for it. The returned `listen`
// is the only part that touches an event target; `hidden` and `reduced` are plain reads.

/** The media query the editor's reduced-motion CSS uses. Kept here so the JS and CSS cannot drift apart. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * @param {object} [options]
 *   document: a document-like object with `visibilityState` and `addEventListener` (default the global document)
 *   matchMedia: a `matchMedia` function (default the global one); a missing function means motion is allowed
 * @returns {{ hidden: () => boolean, reduced: () => boolean, listen: (fn) => () => void, snapshot: () => object }}
 */
export function createPageMotion({
    document: doc = globalThis.document,
    matchMedia: media = globalThis.matchMedia,
} = {}) {
    const query = typeof media === 'function' ? media(REDUCED_MOTION) : null;
    const hidden = () => doc?.visibilityState === 'hidden';
    const reduced = () => !!query?.matches;

    /** Calls `fn({ hidden, reduced })` on every visibility or motion-preference change; returns the unsubscribe. */
    function listen(fn) {
        if (!doc?.addEventListener) return () => {};
        const changed = () => fn({ hidden: hidden(), reduced: reduced() });
        doc.addEventListener('visibilitychange', changed);
        // MediaQueryList has addEventListener on current engines; older WebViews only have addListener.
        if (query?.addEventListener) query.addEventListener('change', changed);
        else if (query?.addListener) query.addListener(changed);
        return () => {
            doc.removeEventListener?.('visibilitychange', changed);
            if (query?.removeEventListener) query.removeEventListener('change', changed);
            else if (query?.removeListener) query.removeListener(changed);
        };
    }

    return { hidden, reduced, listen, snapshot: () => ({ hidden: hidden(), reduced: reduced() }) };
}
