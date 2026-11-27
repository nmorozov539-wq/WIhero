// Save-path cost at 150/1,000/5,000 entries: createLibrary over a mock host (no SillyTavern, no network, no editor).
// Each round appends one character per change, the quiet path typing uses, lets the debounce settle into one save,
// and reports that save's time. Beside it: how many changes coalesced into how many saves, the settings saves, and
// the characters serialized (perf's serializedChars counter). The mock host's worldInfoCache holds the last written
// book and is updated by the mock writeBook, as book-write.js does, so the save path's cache checks run too.
import { bulkyBook } from './fixture.mjs';
import { createLibrary } from '../../src/ui/st-books.js';
import { perf } from '../../src/ui/perf.js';
import { summarize } from './timing.mjs';

/** The plan's save-path scales. */
const SAVE_SIZES = [150, 1000, 5000];
/** Saves per size: enough for a median, few enough to stay well inside a minute. */
const ROUNDS = 5;
/** Characters typed per round, close together, so the debounce coalesces them into one save. */
const CHANGES = 8;
/** Past the longest adaptive delay (1000 ms), so the timer has fired before the round settles. */
const SETTLE_MS = 1100;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A library over one in-memory book, with the host calls counted. */
function mock(entries) {
    const data = { entries: Object.fromEntries(entries.map(entry => [entry.uid, entry])) };
    const settings = { books: {} };
    const stats = { writes: 0, last: null };
    const cache = new Map([['Book', structuredClone(data)]]);
    const ctx = {
        getWorldInfoNames: () => ['Book'],
        loadWorldInfo: async () => data,
        reloadWorldInfoEditor: () => {},
    };
    const library = createLibrary({
        ctx: () => ctx,
        WI: { worldInfoCache: cache },
        powerUser: null,
        settings,
        saveSettings: () => {},
        writeBook: async (_name, sent) => { stats.writes += 1; stats.last = sent; cache.set('Book', sent); },
        onSaveError: () => {},
    });
    return { library, data, settings, stats };
}

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [40] : SAVE_SIZES;
    const rounds = smoke ? 1 : ROUNDS;
    const changes = smoke ? 3 : CHANGES;
    perf.timing = true;
    try {
        for (const n of sizes) {
            const book = mock(bulkyBook(n, { seed: 4000 + n }));
            await book.library.get('Book');
            const base = perf.snapshot();
            const perSave = [];
            for (let round = 0; round < rounds; round++) {
                const before = perf.snapshot();
                for (let i = 0; i < changes; i++) {
                    book.library.change('Book', d => { d.entries[0].content += 'x'; }, { quiet: true });
                }
                // Smoke settles through flush (no real wait); a full run lets the debounce fire naturally.
                if (smoke) await book.library.flush();
                else { await delay(SETTLE_MS); await book.library.flush(); }
                const after = perf.snapshot();
                const calls = after.saveCalls - before.saveCalls;
                if (calls) perSave.push((after.saveMs - before.saveMs) / calls);
            }
            const now = perf.snapshot();
            sink.add({
                bench: 'bench-save',
                metric: 'save',
                fixture: { entries: n, changes: rounds * changes, rounds, debounce: smoke ? 'flush' : 'natural' },
                ...summarize(perSave),
                saves: book.stats.writes,
                settingsSaves: now.settingsSaves - base.settingsSaves,
                attempts: now.saveAttempts - base.saveAttempts,
                serializedChars: now.serializedChars - base.serializedChars,
                finalContentChars: book.data.entries[0].content.length,
            });
        }
    } finally {
        perf.timing = false;
    }
}
