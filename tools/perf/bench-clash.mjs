// Keyword-clash scan at the plan's shapes: 150x3, 500x4, 1,000x4 and 2,000x4 unique multi-word keys, plus the
// shared-vocabulary variant at 500x4 and 1,000x4. The scan is the current token index in src/ui/clashes.js. This
// bench does not carry the pre-H1 implementation, so its cold/warm numbers are a fresh fingerprint, not a replay of
// the 43.5 ms → 2.0 ms table: it records what the current code costs and keeps a regression visible.
//
// The two key shapes matter. "Unique" gives every key its own tokens, the plan's own shape; the token index narrows
// to nothing. "Shared vocabulary" draws every token from a small pool, so each word appears in hundreds of keys and
// the index cannot narrow: this is the H1 done-condition case, not a fixture quirk.
//
// Cold: a fresh book with new words (unique shape) or a fresh book (shared shape), so no per-word regex was compiled
// for it. Warm: the same book again, no revision cache. Cached: the same revision twice, a Map lookup.
import { keywordClashes } from '../../src/ui/clashes.js';
import { mulberry32, e, CLASH_SIZES } from './fixture.mjs';
import { sample, once, summarize } from './timing.mjs';

const SHARED = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river', 'forest', 'shrine'];
const NOUN = ['stone', 'water', 'iron', 'ash', 'salt', 'north', 'light', 'bell', 'key', 'door'];
const VOCAB = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river', 'forest', 'shrine', 'stone', 'water', 'iron', 'ash', 'salt', 'north'];

/** `entries` entries with `keys` unique multi-word keys each whose tokens no other key has. */
function uniqueBook(entries, keys, seed, salt) {
    const rng = mulberry32(seed);
    const list = Array.from({ length: entries }, (_, i) => {
        const keysList = Array.from({ length: keys }, (_, j) => {
            const a = SHARED[Math.floor(rng() * SHARED.length)];
            const b = NOUN[Math.floor(rng() * NOUN.length)];
            return `${a}${salt}${i}x${j} ${b}${salt}${i}x${j} ${salt}x${i}y${j}`;
        });
        return e(i, keysList, { id: `clash-${salt}-${i}` }, { world: `Clash ${salt}` });
    });
    return { entries: Object.fromEntries(list.map(x => [x.uid, x])) };
}

/** `entries` entries with `keys` unique keys of five words drawn from a 16-word pool: every token recurs. */
function sharedBook(entries, keys, salt) {
    const list = Array.from({ length: entries }, (_, i) => {
        const keysList = Array.from({ length: keys }, (_, j) => {
            let n = i * keys + j; // 16^5 combinations, so every key is distinct
            const words = [];
            for (let d = 0; d < 5; d++) { words.push(VOCAB[n % 16]); n = Math.floor(n / 16); }
            return words.join(' ');
        });
        return e(i, keysList, { id: `clash-${salt}-${i}` }, { world: `Clash ${salt}` });
    });
    return { entries: Object.fromEntries(list.map(x => [x.uid, x])) };
}

const SHAPES = [
    { name: 'unique multi-word, no shared tokens', small: CLASH_SIZES, full: CLASH_SIZES, book: uniqueBook },
    { name: 'shared vocabulary', small: [[30, 2]], full: [[500, 4], [1000, 4]], book: (entries, keys, seed, salt) => sharedBook(entries, keys, salt) },
];

export async function run({ smoke = false, sink }) {
    for (const shape of SHAPES) {
        for (const [entries, keys] of smoke ? shape.small : shape.full) {
            const shared = shape.name === 'shared vocabulary';
            const fixture = { entries, keys, distinctKeys: entries * keys, keyShape: shape.name };
            const cold = [];
            const coldSamples = smoke ? 1 : 3;
            for (let s = 0; s < coldSamples; s++) {
                // Unique keys carry the sample's salt; shared keys do not need one: the pool is the point.
                const data = shape.book(entries, keys, 900 + s, `cold${entries}x${s}`);
                cold.push(once(() => keywordClashes(data)));
            }
            sink.add({ bench: 'bench-clash', metric: 'cold', fixture, ...summarize(cold) });

            const data = shape.book(entries, keys, 100 + entries, `warm${entries}`);
            const result = keywordClashes(data);
            const warmOptions = smoke ? { warmup: 1, minSamples: 2, maxSamples: 3 } : shared
                ? { warmup: 1, minSamples: 3, maxSamples: 5, budgetMs: 300 }
                : { warmup: 2, minSamples: 3, maxSamples: 10, budgetMs: 200 };
            const warmMs = sample(() => keywordClashes(data), warmOptions);
            sink.add({ bench: 'bench-clash', metric: 'warm', fixture: { ...fixture, groups: result.groups.length }, ...warmMs });

            keywordClashes(data, new Set(), 1);
            const cachedMs = sample(() => keywordClashes(data, new Set(), 1), { warmup: 1, minSamples: 5, maxSamples: smoke ? 5 : 30, budgetMs: 20 });
            sink.add({ bench: 'bench-clash', metric: 'cached', fixture: { ...fixture, groups: result.groups.length }, ...cachedMs });
        }
    }
}
