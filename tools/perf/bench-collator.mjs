// A–Z sorting at 150/500/1,000/3,000 entries: the shared `Intl.Collator` path (data.js `sortEntries(..., 'az')`)
// beside the old comparator that passed options to `localeCompare` inside the sort. This one compares the two
// implementations side by side rather than old repo code against new: both run on the same synthetic titles.
import { sortEntries, titleOf } from '../../src/ui/data.js';
import { mulberry32, SORT_SIZES } from './fixture.mjs';
import { sample } from './timing.mjs';

const ADJ = ['old', 'quiet', 'amber', 'broken', 'green', 'silent', 'last', 'white', 'cold', 'deep', 'north', 'salt'];
const NOUN = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river', 'forest', 'shrine', 'bridge', 'vault'];

/** Synthetic titles: two words, a number and a case change, so sensitivity and numeric order both matter. */
function syntheticEntries(n, seed) {
    const rng = mulberry32(seed);
    return Array.from({ length: n }, (_, i) => {
        const adj = ADJ[Math.floor(rng() * ADJ.length)];
        const noun = NOUN[Math.floor(rng() * NOUN.length)];
        const title = i % 7 === 0 ? `${adj.toUpperCase()} ${noun} ${i}` : `${adj} ${noun} ${i}`;
        return { uid: i, comment: title, key: [], content: '' };
    });
}

const orderOf = entries => entries.map(x => x.uid).join(',');
const listOrder = (a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid;

/** The old comparator: options per comparison, and titleOf twice per comparison. */
const oldSort = entries => [...entries].sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base', numeric: true }) || listOrder(a, b));

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [60] : SORT_SIZES;
    for (const n of sizes) {
        const entries = syntheticEntries(n, 400 + n);
        const same = orderOf(oldSort(entries)) === orderOf(sortEntries(entries, 'az'));
        const fixture = { entries: n, titles: 'synthetic multi-word + numeric', sameOrder: same };
        const oldMs = sample(() => oldSort(entries), smoke ? { warmup: 1, minSamples: 3, maxSamples: 5 } : { warmup: 2, minSamples: 5, maxSamples: 20 });
        sink.add({ bench: 'bench-collator', metric: 'localeCompare', fixture: { ...fixture, impl: 'localeCompare(..., options) per comparison' }, ...oldMs });
        const newMs = sample(() => sortEntries(entries, 'az'), smoke ? { warmup: 1, minSamples: 3, maxSamples: 5 } : { warmup: 3, minSamples: 7, maxSamples: 40 });
        sink.add({ bench: 'bench-collator', metric: 'collator', fixture: { ...fixture, impl: 'shared Intl.Collator, decorate-sort' }, ...newMs });
    }
}
