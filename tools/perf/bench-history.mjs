// History-wrapper edit cost at 150/1,000/5,000 entries: a mock library, one character appended per change, the
// quiet path typing uses, and the serialized book size beside it. Excludes rendering, persistence and token counting,
// like the plan's recipe. The history serializes the book to compare against its last-seen copy, so this is where
// a typing stall would come from.
import { bulkyBook, HISTORY_SIZES } from './fixture.mjs';
import { createHistory, withHistory } from '../../src/ui/history.js';
import { sample } from './timing.mjs';

/** The bits of src/ui/st-books.js the history reads: peek, change and the global version. */
function mockLibrary(entries) {
    const data = { entries: Object.fromEntries(entries.map(x => [x.uid, x])) };
    return {
        data,
        version: 0,
        peek(name) { return name === 'Book' ? data : null; },
        change(name, fn) {
            if (name !== 'Book') throw new Error(`unknown book ${name}`);
            fn(data);
            this.version += 1;
        },
        externalRevision() { return 0; },
    };
}

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [60] : HISTORY_SIZES;
    const options = smoke
        ? { warmup: 1, minSamples: 3, maxSamples: 5, budgetMs: 20 }
        : { warmup: 5, minSamples: 9, maxSamples: 15, budgetMs: 1500 };
    for (const n of sizes) {
        const entries = bulkyBook(n, { seed: 5000 + n });
        const library = mockLibrary(entries);
        const settings = { books: { Book: {} } };
        const history = createHistory({ library, settings, saveSettings: () => {} });
        const wrapped = withHistory(library, history);
        history.touch('Book'); // the last-seen copy before the first edit
        const editMs = sample(() => wrapped.change('Book', d => { d.entries[0].content += 'x'; }, { quiet: true }), options);
        sink.add({
            bench: 'bench-history',
            metric: 'edit',
            fixture: { entries: n, contentChars: 'about 1,150 per entry', change: 'one character appended', quiet: true },
            serializedChars: JSON.stringify(library.data.entries).length,
            ...editMs,
        });
    }
}
