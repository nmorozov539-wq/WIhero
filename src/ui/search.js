// Search's index (M4, docs/optimization-pass/PLAN.md §2.3). The overlay used to lowercase every title, key word and
// folder on each keystroke and scan every book in the library, after loading all of them. Now one corpus per book is
// built on demand and kept until that book's revision (V1) changes, and the overlay only scans books that are loaded;
// the rest are named as "not searched yet" and can be loaded in the background.
//
// The corpus keeps the original entry objects, so a hit is the same `{ kind, book, entry, current }` a caller got
// from `data.search`, and the ranking (current book first, then other books, then book names, then folders) is the
// same. Folder rows dedupe by the folder's owner and name, as `data.search` does.
import { titleOf } from './data.js';
import { perf } from './perf.js';

/** Result caps after the scan, as the overlays had them before the index (phone `.res`, desktop `.dsres`). */
export const SEARCH_LIMITS = Object.freeze({ phone: 80, desktop: 60 });

const lower = t => String(t ?? '').toLowerCase();

/**
 * The lowercase searchable fields of one book revision: its name and folder, and each visible entry's title, key
 * words and folder. `entries` is already what the caller searches (Moments and hidden entries excluded by
 * `entriesShown`; off entries are included, as before).
 * @param {string} name
 * @param {string} folder the book's folder, or ''
 * @param {object[]} entries
 * @param {(entry: object) => string} folderOf
 */
export function buildBookCorpus(name, folder, entries, folderOf) {
    return {
        name,
        folder: folder ?? '',
        lowerName: lower(name),
        lowerFolder: lower(folder ?? ''),
        entries: entries.map(entry => {
            const title = titleOf(entry);
            const entryFolder = folderOf(entry) ?? '';
            return {
                entry,
                title,
                lowerTitle: lower(title),
                keys: (entry.key ?? []).map(lower),
                folder: entryFolder,
                lowerFolder: lower(entryFolder),
            };
        }),
    };
}

/**
 * The scan over built corpora. Same hits and order as `data.search` (the reference it is tested against):
 * with a current book its entries come first, then other books' entries, then book names, then folders; with no
 * current book, books come before folders and entries.
 * @param {ReturnType<typeof buildBookCorpus>[]} books
 * @param {string} query
 * @param {string} [currentBook]
 */
export function searchCorpus(books, query, currentBook) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    const mine = [];
    const others = [];
    const bookHits = [];
    const folders = new Map();
    for (const b of books) {
        if (b.lowerName.includes(q)) bookHits.push({ kind: 'book', book: b.name });
        if (b.folder && b.lowerFolder.includes(q)) folders.set(`b:${b.folder}`, { kind: 'folder', folder: b.folder });
        for (const x of b.entries) {
            if (x.folder && x.lowerFolder.includes(q)) folders.set(`${b.name}:${x.folder}`, { kind: 'folder', book: b.name, folder: x.folder });
            if (x.lowerTitle.includes(q) || x.keys.some(k => k.includes(q))) {
                const current = b.name === currentBook;
                (current ? mine : others).push({ kind: 'entry', book: b.name, entry: x.entry, current });
            }
        }
    }
    if (!currentBook) return [...bookHits, ...folders.values(), ...others];
    return [...mine, ...others, ...bookHits, ...folders.values()];
}

/**
 * Per-book corpora, rebuilt only when the book's revision, its working-copy object or the folder settings change.
 * The revision alone is not enough: a book removed and made again under the same name starts its revisions at 0, and
 * folders live in mutable settings; `data` identity and `stamp` cover both without walking the book.
 *
 * The app invalidates a book when its *visible* entries change without a revision (the Undo-toast hidden set).
 * @param {{ revision?: (name: string) => number, stamp?: () => number }} [o]
 */
export function createSearchCache({ revision = () => 0, stamp = () => 0 } = {}) {
    const kept = new Map(); // name → { data, rev, mark, corpus }
    return {
        /**
         * @param {string} name
         * @param {object | null} data the working copy (`library.peek`), or null while the book is not loaded
         * @param {string} folder the book's folder
         * @param {(name: string, data: object | null) => object[]} entriesOf called only on a miss
         * @param {(entry: object) => string} folderOf
         */
        book(name, data, folder, entriesOf, folderOf) {
            const rev = revision(name);
            const mark = stamp();
            const old = kept.get(name);
            if (old && old.rev === rev && old.mark === mark && old.data === data) return old.corpus;
            const corpus = buildBookCorpus(name, folder, data ? entriesOf(name, data) : [], folderOf);
            kept.set(name, { data, rev, mark, corpus });
            perf.count('searchIndexBuilds');
            return corpus;
        },
        /** A book's visible entries or folders changed outside its revision (the hidden-entry set). */
        invalidate(name) { kept.delete(name); },
        clear() { kept.clear(); },
        size: () => kept.size,
    };
}

/**
 * A trailing debounce (M4: 120–150 ms). `run` is never called twice for one burst; `flush` runs it now if a call is
 * waiting (Enter or an arrow key must act on the query that is on screen). `set`/`clear` are injectable for tests.
 */
export function createDebounced(run, delay = 130, { set = setTimeout, clear = clearTimeout } = {}) {
    let timer = null;
    const cancel = () => {
        if (timer === null) return;
        clear(timer);
        timer = null;
    };
    return {
        call() {
            cancel();
            timer = set(() => { timer = null; run(); }, delay);
        },
        /** Runs now and drops the waiting call; returns whether one was waiting. */
        flush() {
            if (timer === null) return false;
            cancel();
            run();
            return true;
        },
        cancel,
        pending: () => timer !== null,
    };
}
