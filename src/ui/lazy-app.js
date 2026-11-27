// The editor chunk, loaded on first need (L1). The engine side of the extension starts with only its own modules;
// `create()` does the actual work — a dynamic import plus createApp — once, no matter how many callers ask.
//
// `load()` waits for it: the drawer cannot show an editor before the chunk arrives. `prefetch()` asks for it on an
// idle callback a few seconds after boot, so the first open on a capable device is instant; `cancel()` drops that
// pending request (page teardown). A failed attempt is not remembered: the next `load()` tries again, while `ready`
// keeps the first failure for tests that await it. Nothing here touches the DOM or SillyTavern.

/**
 * @param {() => any | Promise<any>} create makes the app once
 * @param {object} [options]
 *   delay: ms after boot before the idle prefetch (default 3000)
 *   onError(error): told about every failed attempt, background ones included
 *   requestIdleCallback / cancelIdleCallback / setTimeout / clearTimeout: injectable for tests
 * @returns {{ app: any, ready: Promise<any>, load: () => Promise<any>, prefetch: () => void, cancel: () => void }}
 */
export function createLazyApp(create, {
    delay = 3000,
    onError = () => {},
    requestIdleCallback: requestIdle = globalThis.requestIdleCallback,
    cancelIdleCallback: cancelIdle = globalThis.cancelIdleCallback,
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
} = {}) {
    let app = null;
    let pending = null;
    let timer = null;
    let idleHandle = null;
    let stopped = false;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A prefetch failure is reported through onError and retried on demand: don't also make it an unhandled rejection.
    // Test callers can still await `ready` to see the first failure.
    ready.catch(() => {});

    function attempt() {
        if (app) return Promise.resolve(app);
        if (pending) return pending;
        pending = Promise.resolve().then(create).then(instance => {
            pending = null;
            app = instance;
            resolveReady(instance);
            return instance;
        }, error => {
            pending = null;
            onError(error);
            throw error;
        });
        return pending;
    }

    /** Waits for the app; a failure rejects `ready` once and leaves the next `load()` free to retry. */
    function load() {
        if (stopped) return Promise.reject(new Error('the editor loader was cancelled'));
        return attempt().catch(error => {
            rejectReady(error);
            throw error;
        });
    }

    /** Asks for the app a few seconds after boot, on an idle callback (a timeout where there is none). */
    function prefetch() {
        if (stopped || app || timer !== null) return;
        timer = setTimer(() => {
            timer = null;
            if (stopped) return;
            const start = () => { if (!stopped && !app) attempt().catch(() => {}); };
            if (typeof requestIdle === 'function') idleHandle = requestIdle(start, { timeout: 5000 });
            else start();
        }, delay);
    }

    /** Page teardown: no prefetch, and no new attempt. One already under way is left to finish. */
    function cancel() {
        stopped = true;
        if (timer !== null) { clearTimer(timer); timer = null; }
        if (idleHandle !== null && typeof cancelIdle === 'function') cancelIdle(idleHandle);
        idleHandle = null;
    }

    return {
        get app() { return app; },
        get pending() { return pending; },
        ready,
        load,
        prefetch,
        cancel,
    };
}
