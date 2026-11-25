// The real token count for an entry's text, asked only when it is worth asking: once on open, and once after a
// typing pause or a blur. The page shows `tokenGuess` immediately, so no count is needed while keys are arriving.
// A cache by exact text keeps mask switches and repeats free, and an in-flight request for the same text is shared.
import { perf } from './perf.js';

/**
 * @param {object} options
 * @param {(text: string) => Promise<number>|number} options.tokens The host tokenizer (ST's or the harness stand-in).
 * @param {number} [options.idleMs] Quiet time after the last input before the deferred request.
 * @param {() => boolean} [options.hidden] True while the document is hidden; no request then.
 * @param {() => boolean} [options.isActive] False when the page was rebuilt; no deferred request then.
 * @param {number} [options.limit] Cache entries kept, oldest evicted first.
 */
export function createTokenCounter({
    tokens,
    idleMs = 1200,
    hidden = () => globalThis.document?.hidden === true,
    isActive = () => true,
    limit = 8,
} = {}) {
    // Insertion order is the age order; re-setting an entry makes it the newest.
    const cache = new Map();
    const inFlight = new Map();
    let timer = null;
    let pending = null;

    const cached = text => (cache.has(text) ? cache.get(text) : undefined);

    const remember = (text, count) => {
        cache.delete(text);
        cache.set(text, count);
        while (cache.size > limit) cache.delete(cache.keys().next().value);
    };

    /** Cancels a scheduled input and resolves its promise null: it was replaced or flushed. */
    const cancelTimer = () => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        const old = pending;
        pending = null;
        old?.resolve(null);
    };

    /** One real tokenizer call per text, shared while it is in flight and cached if it returns a number. */
    const request = text => {
        const hit = cached(text);
        if (hit !== undefined) return Promise.resolve(hit);
        if (inFlight.has(text)) return inFlight.get(text);
        perf.count('tokenCalls');
        let answer;
        try {
            answer = Promise.resolve(tokens(text));
        } catch {
            return Promise.resolve(null);
        }
        const done = answer.then(
            n => {
                if (typeof n !== 'number') return null;
                remember(text, n);
                return n;
            },
            () => null,
        ).finally(() => { inFlight.delete(text); });
        inFlight.set(text, done);
        return done;
    };

    /** A count the page already knows, or the one request an open needs. */
    const open = text => request(text);

    /** Defers one request until the typing pauses. Repeated calls replace the timer and the text. */
    const input = text => {
        cancelTimer();
        if (hidden() || !isActive()) return Promise.resolve(null);
        const hit = cached(text);
        if (hit !== undefined) return Promise.resolve(hit);
        return new Promise(resolve => {
            pending = { resolve };
            timer = setTimeout(() => {
                timer = null;
                pending = null;
                if (hidden() || !isActive()) { resolve(null); return; }
                request(text).then(resolve);
            }, idleMs);
        });
    };

    /** A blur asks now; the hidden/inactive rule is the same as for a deferred input. */
    const flush = text => {
        cancelTimer();
        if (hidden() || !isActive()) return Promise.resolve(null);
        return request(text);
    };

    return { open, input, flush };
}
