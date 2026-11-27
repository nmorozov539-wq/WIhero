// A small work queue for book loads (M1, docs/optimization-pass/PLAN.md §5). Home's entry counts are background work:
// they must not hold up the book the reader opens, and leaving Home must drop the ones that have not started yet.
//
// `load` is the only thing that reads a book: the library's own `get`, with its `loading` map, so a name is never
// read twice at once even across the loader's two priorities. Background work is bounded by `concurrency` (3, as the
// old count pump was); a foreground request starts at once, even when every background slot is busy, because it is
// what the reader is waiting for. In-flight work cannot be aborted (ST has no abort), so `cancel()` only drops the
// queue and bumps the generation: a callback from the old generation can see that it is stale and stay quiet.
// `group` + `cancelGroup` are the same for one owner (M4's search background reads) without touching Home's counts.
const DEFAULT_CONCURRENCY = 3;

/**
 * @param {object} o
 * @param {(name: string) => Promise<unknown>} o.load the one read path (library.get)
 * @param {number} [o.concurrency] maximum background loads; foreground requests don't wait for a slot
 */
export function createLoader({ load, concurrency = DEFAULT_CONCURRENCY } = {}) {
    if (typeof load !== 'function') throw new TypeError('createLoader needs a load(name) function');
    const limit = Math.max(1, Math.floor(concurrency) || DEFAULT_CONCURRENCY);
    /** Background items waiting for a slot. Foreground items never wait here. */
    const queue = [];
    /** name → its queued or running item, so the same book is never queued twice. */
    const active = new Map();
    /** group → the generation `cancelGroup` last started for it (search's background reads, M4). */
    const groups = new Map();
    let generation = 0;
    let background = 0;
    let foreground = 0;
    const stats = {
        enqueued: 0, started: 0, completed: 0, failed: 0, cancelled: 0, promoted: 0,
        foreground: 0, background: 0, maxQueued: 0, maxBackground: 0, maxRunning: 0,
    };

    function settle(item, error, data) {
        if (active.get(item.name) === item) active.delete(item.name);
        if (item.priority === 'foreground') foreground--; else background--;
        if (error === undefined) item.resolve(data); else item.reject(error);
        pump();
    }

    function start(item, priority) {
        item.queued = false;
        item.priority = priority;
        if (priority === 'foreground') {
            foreground++;
            stats.foreground++;
        } else {
            background++;
            stats.background++;
        }
        stats.started++;
        stats.maxRunning = Math.max(stats.maxRunning, background + foreground);
        if (priority === 'background') stats.maxBackground = Math.max(stats.maxBackground, background);
        let out;
        try { out = load(item.name); } catch (error) { out = Promise.reject(error); }
        Promise.resolve(out).then(
            data => { stats.completed++; settle(item, undefined, data); },
            error => { stats.failed++; settle(item, error); },
        );
    }

    function pump() {
        while (background < limit && queue.length) {
            const item = queue.shift();
            if (!item) continue;
            start(item, 'background');
        }
    }

    /**
     * Queues a load for `name`, or returns the one already queued or running. A foreground request for a queued
     * background load promotes it and starts it now; one for an in-flight load shares that load, since it is already
     * the reader's book that is being read.
     * @param {string} name
     * @param {{ foreground?: boolean, group?: string }} [options] `group` lets one owner cancel only its own queued
     *   work (M4 search) without touching Home's counts.
     * @returns {Promise<unknown>} resolves with the load's value (null when a queued item is cancelled)
     */
    function enqueue(name, { foreground: urgent = false, group = null } = {}) {
        const existing = active.get(name);
        if (existing) {
            if (urgent && existing.queued) {
                const at = queue.indexOf(existing);
                if (at >= 0) queue.splice(at, 1);
                stats.promoted++;
                start(existing, 'foreground');
            }
            return existing.promise;
        }
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const item = { name, generation, group, queued: false, priority: null, promise, resolve, reject };
        active.set(name, item);
        stats.enqueued++;
        if (urgent) start(item, 'foreground');
        else {
            item.queued = true;
            queue.push(item);
            stats.maxQueued = Math.max(stats.maxQueued, queue.length);
            pump();
        }
        return promise;
    }

    /**
     * Drops every queued load and makes the results of work already running stale: `generation()` changes, so a
     * callback that captured the old number can check and not write into a list the user has left. Returns how many
     * queued loads were dropped. Running loads are not aborted; their own promises still settle.
     */
    function cancel() {
        generation++;
        let dropped = 0;
        while (queue.length) {
            const item = queue.shift();
            item.queued = false;
            if (active.get(item.name) === item) active.delete(item.name);
            stats.cancelled++;
            dropped++;
            item.resolve(null);
        }
        return dropped;
    }

    /**
     * Drops only the queued loads one owner enqueued under `group` and starts a new generation for that group, so a
     * completion that was already running can tell it is stale. Other queued work (Home's counts) is untouched.
     * Returns how many queued loads were dropped.
     */
    function cancelGroup(group) {
        if (!group) return 0;
        groups.set(group, (groups.get(group) ?? 0) + 1);
        let dropped = 0;
        for (let i = queue.length - 1; i >= 0; i--) {
            const item = queue[i];
            if (item.group !== group) continue;
            queue.splice(i, 1);
            item.queued = false;
            if (active.get(item.name) === item) active.delete(item.name);
            stats.cancelled++;
            dropped++;
            item.resolve(null);
        }
        return dropped;
    }

    return {
        enqueue,
        cancel,
        /** Drops one group's queued loads, leaving every other queue entry where it is (M4). */
        cancelGroup,
        /** The current generation; capture it before enqueueing, compare it before writing the result. */
        generation: () => generation,
        isCurrent: gen => gen === generation,
        /** A group's generation: gone up when that group was cancelled, never for another group's cancel. */
        groupGeneration: group => groups.get(group) ?? 0,
        /** Background loads waiting for a slot. */
        size: () => queue.length,
        stats: () => ({ ...stats, queued: queue.length, running: background + foreground, generation }),
    };
}
