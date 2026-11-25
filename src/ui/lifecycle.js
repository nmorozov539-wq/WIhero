// A tiny disposal registry for a component's listeners, observers and timers. Each owner registers the one call that
// lets a thing go; `dispose()` runs them once, in registration order, and an owner that registers after disposal is
// cleaned at once instead of leaking. A failure in one cleanup does not stop the others.
//
// The editor app, the Hero canvas's input and the retained shells use this so a teardown is one call, and so the
// bookkeeping itself can be tested in Node without a DOM.

/**
 * @returns {{ add: (cleanup: () => void) => () => void, dispose: () => void, readonly size: number, readonly disposed: boolean }}
 */
export function createDisposer() {
    const cleanups = new Set();
    let disposed = false;
    let ran = false;

    /** Registers `cleanup`; returns an unregister function (safe after disposal). A cleanup that must run now does. */
    function add(cleanup) {
        if (typeof cleanup !== 'function') return () => {};
        if (disposed) {
            run(cleanup);
            return () => {};
        }
        cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
    }

    function run(cleanup) {
        try { cleanup(); } catch (error) { console.error('[WI Hero] dispose failed', error); }
    }

    /** Runs every registered cleanup once. Later `add` calls clean themselves at once. */
    function dispose() {
        if (disposed) return;
        disposed = true;
        ran = true;
        for (const cleanup of cleanups) run(cleanup);
        cleanups.clear();
    }

    return {
        add,
        dispose,
        get size() { return cleanups.size; },
        get disposed() { return disposed; },
        /** Test-only: whether dispose has ever run. */
        get ran() { return ran; },
    };
}
