// Undo history (freeze exception, 2026-11-11): Ctrl+Z / Ctrl+Shift+Z and the canvas's arrows, per book, over
// everything WI Hero keeps for it: the entries (text, parameters, story logic) and the book's WI Hero settings
// (canvas places, link shapes, folders). The camera is left out: looking around is not an edit.
//
// It works by comparing, not by listening to every kind of edit: each book has a "last seen" copy, and when the
// book or its settings differ from it (after a change through the library, or at a redraw), the last seen copy
// goes on the undo stack. So every edit is covered without each one knowing about history.
// - One action is one step: changes in the same task (an edit, then its settings, then the redraw) merge.
// - Typing merges: quiet changes less than a second apart, with no redraw between them, are one step.
// - While the piece bar's strip is open (`held`), nothing is recorded; closing it with Done makes one step, and
//   Cancel (which puts the book back) none.
// - A change from outside WI Hero (ST's editor, a slash command) starts the book's history over, so Undo never
//   writes over someone else's save.
// No DOM, no SillyTavern imports.

const LIMIT = 100;
const MERGE_MS = 1000;

/** The book's settings without the camera. */
function settingsOf(settings, book) {
    const s = settings.books?.[book];
    if (!s) return {};
    if (!s.canvas?.camera) return s;
    const { camera, ...canvas } = s.canvas;
    return { ...s, canvas };
}

/**
 * @param {object} o
 * @param {object} o.library peek(name), change(name, fn, opts), version
 * @param {object} o.settings the extension settings (books[name] is a book's)
 * @param {() => void} o.saveSettings
 * @param {() => boolean} [o.held] true while edits shouldn't be recorded yet (a strip is open)
 * @param {() => number} [o.now]
 */
export function createHistory({ library, settings, saveSettings, held = () => false, now = () => Date.now() }) {
    /** book → { cur: { entries, original, settings }, curJson, setJson, ver, undo: [], redo: [], at, quiet } */
    const books = new Map();
    let ourVersion = null; // library.version right after a change we made or saw through change()
    // The current task: changes made before the next microtask checkpoint belong to one action.
    let tick = 0;
    let armed = false;
    const task = () => { if (!armed) { armed = true; queueMicrotask(() => { armed = false; tick++; }); } return tick; };

    const take = (book, d) => ({
        entries: JSON.stringify(d.entries ?? {}),
        original: d.originalData === undefined ? undefined : JSON.stringify(d.originalData),
        settings: JSON.stringify(settingsOf(settings, book)),
    });
    const same = (a, b) => a.entries === b.entries && a.original === b.original && a.settings === b.settings;

    /**
     * Looks at the book now. A difference from the last seen copy becomes an undo step, or, when it came from
     * outside WI Hero, starts the history over.
     * @param {{ quiet?: boolean, ours?: boolean, redraw?: boolean }} [o] `ours`: the change went through
     *   library.change just now. `redraw`: called from a redraw, which ends a run of typing.
     */
    function touch(book, { quiet = false, ours = false, redraw = false } = {}) {
        const d = book ? library.peek(book) : null;
        if (!d) return;
        let h = books.get(book);
        if (!h) { books.set(book, { cur: take(book, d), ver: library.version, undo: [], redo: [], at: 0, quiet: false }); return; }
        if (held()) return;
        // Same library version: the entries can't have changed, so only the settings are compared.
        const next = library.version === h.ver
            ? { entries: h.cur.entries, original: h.cur.original, settings: JSON.stringify(settingsOf(settings, book)) }
            : take(book, d);
        if (same(next, h.cur)) { h.ver = library.version; if (redraw) h.quiet = false; return; }
        const entriesMoved = next.entries !== h.cur.entries || next.original !== h.cur.original;
        if (entriesMoved && !ours && library.version !== ourVersion) {
            // Changed outside WI Hero: what was undoable no longer applies to this book.
            books.set(book, { cur: next, ver: library.version, undo: [], redo: [], at: 0, quiet: false });
            return;
        }
        const t = now();
        const k = task();
        const merge = h.undo.length && (h.task === k || (quiet && h.quiet && t - h.at < MERGE_MS));
        if (!merge) {
            h.undo.push(h.cur);
            if (h.undo.length > LIMIT) h.undo.shift();
        }
        h.redo = [];
        h.cur = next;
        h.ver = library.version;
        h.at = t;
        h.quiet = quiet;
        h.task = k;
    }

    /** Puts a recorded state on the book (entries, original data and settings; the camera stays where it is). */
    function apply(book, st) {
        library.change(book, d => {
            d.entries = JSON.parse(st.entries);
            if (st.original !== undefined) d.originalData = JSON.parse(st.original);
        }, { quiet: true });
        ourVersion = library.version;
        const camera = settings.books?.[book]?.canvas?.camera;
        const s = JSON.parse(st.settings);
        if (camera) { s.canvas ??= {}; s.canvas.camera = camera; }
        settings.books[book] = s;
        saveSettings();
    }

    function step(book, from, to) {
        touch(book);
        const h = books.get(book);
        if (!h || !h[from].length || held()) return false;
        h[to].push(h.cur);
        h.cur = h[from].pop();
        apply(book, h.cur);
        h.ver = library.version;
        h.at = 0;
        h.quiet = false;
        h.task = -1;
        return true;
    }

    return {
        touch,
        /** Called around library.change: the version after it counts as ours. */
        changed(book, quiet) { ourVersion = library.version; touch(book, { quiet, ours: true }); },
        undo: book => step(book, 'undo', 'redo'),
        redo: book => step(book, 'redo', 'undo'),
        canUndo: book => !!books.get(book)?.undo.length,
        canRedo: book => !!books.get(book)?.redo.length,
        /** A book renamed: its history goes with it. */
        rename(from, to) { const h = books.get(from); books.delete(from); if (h) books.set(to, h); },
        forget(book) { books.delete(book); },
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
                    history.touch(name);
                    const out = t.change(name, fn, opts);
                    history.changed(name, !!opts.quiet);
                    return out;
                };
            }
            if (k === 'rename') return async (from, to, ...rest) => { const out = await t.rename(from, to, ...rest); history.rename(from, to); return out; };
            if (k === 'remove') return async (name, ...rest) => { const out = await t.remove(name, ...rest); history.forget(name); return out; };
            const v = Reflect.get(t, k);
            return typeof v === 'function' ? v.bind(t) : v;
        },
    });
}
