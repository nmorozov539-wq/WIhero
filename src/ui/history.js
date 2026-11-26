// Undo history (freeze exception, 2026-11-11): Ctrl+Z / Ctrl+Shift+Z and the canvas's arrows, per book, over
// everything WI Hero keeps for it: the entries (text, parameters, story logic) and the book's WI Hero settings
// (canvas places, link shapes, folders). The camera is left out: looking around is not an edit.
//
// It works by comparing, not by listening to every kind of edit: each book has a "last seen" copy, and when the
// book or its settings differ from it (after a change through the library, or at a redraw), the last seen copy
// goes on the undo stack. So every edit is covered without each one knowing about history.
// - One action is one step: changes in the same task (an edit, then its settings, then the redraw) merge.
// - Typing merges: quiet changes less than a second apart, with no redraw between them, are one step. The run's
//   pre-edit state is captured once, at its first change; the final state is captured once, at its boundary.
// - While the piece bar's strip is open (`held`), nothing is recorded; closing it with Done makes one step, and
//   Cancel (which puts the book back) none.
// - A change from outside WI Hero (ST's editor, a slash command) starts the book's history over, so Undo never
//   writes over someone else's save.
// - States are kept as strings, with a global estimated-byte budget as well as a per-book step limit.
// No DOM, no SillyTavern imports.
import { perf } from './perf.js';

const LIMIT = 100;
const MERGE_MS = 1000;
const DEFAULT_BUDGET = 12 * 1024 * 1024;

/**
 * The parts of a book's settings that are edits: its canvas (without the camera: looking around is not an edit),
 * its folders and its new-entry defaults. Bookkeeping (`edited`, `seen`, the Snapshots list) is left out, so a save
 * is never a step and Undo never brings back an old timestamp or a deleted snapshot. Empty parts are left out too:
 * they are made on first use, not by an edit.
 */
const TRACKED = ['canvas', 'folders', 'folderList', 'defaults'];
function settingsOf(settings, book) {
    const s = settings.books?.[book];
    if (!s) return {};
    const out = {};
    for (const k of TRACKED) {
        let v = s[k];
        if (k === 'canvas' && v && typeof v === 'object') { const { camera, ...canvas } = v; v = canvas; }
        if (v === undefined || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) continue;
        out[k] = v;
    }
    return out;
}

/**
 * @param {object} o
 * @param {object} o.library peek(name), change(name, fn, opts), version
 * @param {object} o.settings the extension settings (books[name] is a book's)
 * @param {() => void} o.saveSettings
 * @param {() => boolean} [o.held] true while edits shouldn't be recorded yet (a strip is open)
 * @param {() => number} [o.now]
 * @param {number} [o.budget] estimated bytes kept across every book's undo and redo states
 */
export function createHistory({ library, settings, saveSettings, held = () => false, now = () => Date.now(), budget = DEFAULT_BUDGET }) {
    /**
     * book → { cur, ver, external, undo, redo, at, quiet, task, pending }
     * `cur` is the last seen state and is not counted in the budget until it moves onto a stack. A quiet run keeps
     * `ver` at the version before the run while `pending`, so a later look still takes the final state.
     */
    const books = new Map();
    let ourVersion = null; // library.version right after a change we made or saw through change()
    // The current task: changes made before the next microtask checkpoint belong to one action.
    let tick = 0;
    let armed = false;
    const task = () => { if (!armed) { armed = true; queueMicrotask(() => { armed = false; tick++; }); } return tick; };
    let seq = 0; // monotonic, so the oldest captured state can be found across books and both stacks
    let totalBytes = 0; // estimated characters of every state on an undo or redo stack

    const take = (book, d) => {
        perf.count('historyCaptures');
        const entries = JSON.stringify(d.entries ?? {});
        const original = d.originalData === undefined ? undefined : JSON.stringify(d.originalData);
        const settingsJson = JSON.stringify(settingsOf(settings, book));
        return {
            entries,
            original,
            settings: settingsJson,
            bytes: entries.length + (original?.length ?? 0) + settingsJson.length,
            seq: ++seq,
        };
    };
    const takeSettings = (h, book) => {
        const settingsJson = JSON.stringify(settingsOf(settings, book));
        return {
            entries: h.cur.entries,
            original: h.cur.original,
            settings: settingsJson,
            bytes: h.cur.entries.length + (h.cur.original?.length ?? 0) + settingsJson.length,
            seq: ++seq,
        };
    };
    const same = (a, b) => a.entries === b.entries && a.original === b.original && a.settings === b.settings;

    const release = h => {
        if (!h) return;
        for (const stack of [h.undo, h.redo]) for (const st of stack) totalBytes -= st.bytes;
    };
    /** Drops the oldest state in any book or stack until the estimated total fits the budget. */
    const evict = () => {
        while (totalBytes > budget) {
            let victim = null;
            let stack = null;
            let index = -1;
            for (const h of books.values()) {
                for (const s of [h.undo, h.redo]) {
                    for (let i = 0; i < s.length; i++) {
                        if (!victim || s[i].seq < victim.seq) { victim = s[i]; stack = s; index = i; }
                    }
                }
            }
            if (!victim) { totalBytes = 0; break; }
            stack.splice(index, 1);
            totalBytes -= victim.bytes;
        }
    };
    const remember = (h, stack, st) => {
        stack.push(st);
        totalBytes += st.bytes;
        if (stack === h.undo && h.undo.length > LIMIT) totalBytes -= h.undo.shift().bytes;
        evict();
    };
    const clearRedo = h => {
        for (const st of h.redo) totalBytes -= st.bytes;
        h.redo = [];
    };

    /** The book seen for the first time, or after an outside change: its history starts over. */
    function resetBook(book, d, ext) {
        release(books.get(book));
        books.set(book, {
            cur: take(book, d),
            ver: library.version,
            external: ext,
            undo: [],
            redo: [],
            at: 0,
            quiet: false,
            task: -1,
            pending: false,
        });
    }

    /** Ends a quiet run: its final state becomes current, once, without another step. */
    function endRun(book, h, d) {
        h.cur = take(book, d);
        h.ver = library.version;
        h.pending = false;
        h.quiet = false;
        h.at = 0;
        h.task = -1;
    }

    /**
     * Looks at the book now. A difference from the last seen copy becomes an undo step, or, when it came from
     * outside WI Hero, starts the history over.
     * @param {{ quiet?: boolean, ours?: boolean, redraw?: boolean, nextQuiet?: boolean }} [o] `ours`: the change
     *   went through library.change just now. `redraw`: called from a redraw, which ends a run of typing.
     *   `nextQuiet`: this is the look before a library.change, and that change will be quiet.
     */
    function touch(book, opts) {
        const started = perf.begin('history');
        try { return touchNow(book, opts); } finally { perf.end(started); }
    }
    function touchNow(book, { quiet = false, ours = false, redraw = false, nextQuiet = false } = {}) {
        const d = book ? library.peek(book) : null;
        if (!d) return;
        let h = books.get(book);
        const ext = library.externalRevision?.(book) ?? 0;
        if (!h || h.external !== ext) {
            resetBook(book, d, ext);
            return;
        }
        if (h.pending) {
            const t = now();
            // More quiet changes in the same run: keep only the time, not another copy.
            if (quiet && ours && !redraw && t - h.at < MERGE_MS) {
                h.at = t;
                return;
            }
            // The look before a quiet change that continues the run: leave the copy for the boundary.
            if (nextQuiet && !redraw && !held() && t - h.at < MERGE_MS) return;
            endRun(book, h, d);
        }
        if (held()) return;
        // A quiet change starts or continues a typing run. Its pre-run state is already `cur` (a draw or the last
        // boundary captured it) and its final state is taken once at the boundary, so the burst itself never has to
        // stringify the whole book: one keystroke costs a timestamp update, not a whole-book copy.
        if (quiet && ours && !redraw) {
            const t = now();
            const k = task();
            const merge = h.undo.length && (h.task === k || (quiet && h.quiet && t - h.at < MERGE_MS));
            if (!merge) remember(h, h.undo, h.cur);
            clearRedo(h);
            h.at = t;
            h.quiet = true;
            h.pending = true;
            h.task = k;
            return;
        }
        // Same library version: the entries can't have changed, so only the settings are compared.
        const next = library.version === h.ver
            ? takeSettings(h, book)
            : take(book, d);
        if (same(next, h.cur)) { h.ver = library.version; if (redraw) h.quiet = false; return; }
        const entriesMoved = next.entries !== h.cur.entries || next.original !== h.cur.original;
        if (entriesMoved && !ours && library.version !== ourVersion) {
            // Changed outside WI Hero: what was undoable no longer applies to this book.
            resetBook(book, d, ext);
            return;
        }
        const t = now();
        const k = task();
        const merge = h.undo.length && (h.task === k || (quiet && h.quiet && t - h.at < MERGE_MS));
        if (!merge) remember(h, h.undo, h.cur);
        clearRedo(h);
        h.cur = next;
        h.ver = quiet ? h.ver : library.version;
        h.at = t;
        h.quiet = quiet;
        h.task = k;
        h.pending = quiet;
    }

    /** Puts a recorded state on the book (entries, original data and settings; the camera stays where it is). */
    function apply(book, st) {
        library.change(book, d => {
            d.entries = JSON.parse(st.entries);
            if (st.original !== undefined) d.originalData = JSON.parse(st.original);
        }, { quiet: true });
        ourVersion = library.version;
        // Only the tracked parts go back; the camera and the bookkeeping stay as they are now.
        const now = (settings.books[book] ??= {});
        const camera = now.canvas?.camera;
        const s = JSON.parse(st.settings);
        for (const k of TRACKED) { if (k in s) now[k] = s[k]; else delete now[k]; }
        if (camera) { now.canvas ??= {}; now.canvas.camera = camera; }
        now.defaults ??= {}; // the parts left out when empty (bookSettings makes them)
        now.folders ??= {};
        saveSettings();
    }

    function step(book, from, to) {
        touch(book);
        const h = books.get(book);
        if (!h || !h[from].length || held()) return false;
        const prev = h[from].pop();
        totalBytes -= prev.bytes;
        remember(h, h[to], h.cur);
        h.cur = prev;
        apply(book, h.cur);
        h.ver = library.version;
        h.at = 0;
        h.quiet = false;
        h.pending = false;
        h.task = -1;
        return true;
    }

    return {
        touch,
        /**
         * A canvas draw placed cards on its own (a new book, a new entry): taken as the book's current state, not a
         * step, when only the settings changed. It also ends a pending typing run.
         */
        settle(book) {
            const h = books.get(book);
            const d = book ? library.peek(book) : null;
            if (!h || !d || held()) return;
            if (h.pending) {
                const ext = library.externalRevision?.(book) ?? 0;
                if (h.external !== ext) { resetBook(book, d, ext); return; }
                endRun(book, h, d);
                return;
            }
            if (library.version !== h.ver) return;
            h.cur = takeSettings(h, book);
        },
        /** Called around library.change: the version after it counts as ours. */
        changed(book, quiet) { ourVersion = library.version; touch(book, { quiet, ours: true }); },
        undo: book => step(book, 'undo', 'redo'),
        redo: book => step(book, 'redo', 'undo'),
        canUndo: book => !!books.get(book)?.undo.length,
        canRedo: book => !!books.get(book)?.redo.length,
        /** Estimated characters and step count kept for every book, for tests and diagnostics. */
        stats() {
            let steps = 0;
            for (const h of books.values()) steps += h.undo.length + h.redo.length;
            return { bytes: totalBytes, steps };
        },
        /**
         * Books with undo or redo states (M2). Those states are applied to the book's working copy, so the library
         * must keep that copy loaded: an evicted book could not be undone. The app pins these.
         */
        booksWithStates() {
            const out = [];
            for (const [book, h] of books) if (h.undo.length || h.redo.length) out.push(book);
            return out;
        },
        /** A book renamed: its history goes with it. */
        rename(from, to) {
            const h = books.get(from);
            books.delete(from);
            if (!h) return;
            if (to !== from && books.has(to)) release(books.get(to));
            h.external = library.externalRevision?.(to) ?? 0;
            books.set(to, h);
        },
        forget(book) { release(books.get(book)); books.delete(book); },
    };
}

/**
 * The library as the app sees it: the same, except that every change is looked at by the history (a first look
 * before it, so the state before the very first edit is known).
 */
export function withHistory(library, history) {
    return new Proxy(library, {
        get(t, k) {
            if (k === 'change') {
                return (name, fn, opts = {}) => {
                    history.touch(name, { nextQuiet: !!opts.quiet });
                    const out = t.change(name, fn, opts);
                    history.changed(name, !!opts.quiet);
                    return out;
                };
            }
            if (k === 'rename') return async (from, to, ...rest) => { const out = await t.rename(from, to, ...rest); history.rename(from, out); return out; };
            if (k === 'remove') return async (name, ...rest) => { const out = await t.remove(name, ...rest); history.forget(name); return out; };
            const v = Reflect.get(t, k);
            return typeof v === 'function' ? v.bind(t) : v;
        },
    });
}
