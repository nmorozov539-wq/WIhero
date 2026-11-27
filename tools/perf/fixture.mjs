// Deterministic fixtures for the in-repo benchmarks (docs/optimization-pass/PLAN.md, B0).
// Every generator takes a seed and returns the same data for the same arguments. No Math.random, no SillyTavern,
// no real library: these are synthetic books, chats and saved-canvas shapes, built to the plan's scales.
//
// The entry shorthand is the one test/sim.js uses (`e()`), copied here so tools never import test files.
import { FIELD } from '../../src/engine/model.js';

/** mulberry32: a small seeded PRNG, so a fixture can be replayed exactly. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const ADJ = ['old', 'quiet', 'salt', 'iron', 'hidden', 'north', 'amber', 'broken', 'green', 'silent', 'last', 'white', 'red', 'cold', 'deep'];
const NOUN = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river', 'forest', 'shrine', 'bridge', 'vault', 'orchard', 'beacon', 'well'];

/**
 * An entry in shorthand, as in test/sim.js: `e(0, 'mill town', { id: 'mill-town', gate: [['road']] })`.
 * Keys default to the id in the title; `keys: null` means no key words; `extra` overrides or adds ST fields.
 */
export function e(uid, keys, config, extra = {}) {
    const entry = {
        uid,
        world: extra.world ?? 'Book',
        comment: extra.comment ?? (typeof keys === 'string' ? keys : keys?.[0] ?? `e${uid}`),
        key: keys === null ? [] : [].concat(keys),
        content: `[${uid}]`,
        ...extra,
    };
    if (config !== undefined) entry.extensions = { [FIELD]: config };
    return entry;
}

/**
 * `keys` multi-word key words for an entry, each made unique by the entry index; `shared` puts a word from a small
 * vocabulary in every key after the first, so the clash scan has plausible candidates, as real books do.
 */
export function keyWords(rng, i, { shared = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river'], keys = 2 } = {}) {
    const out = [];
    for (let j = 0; j < keys; j++) {
        out.push(j === 0 ? `${pick(rng, ADJ)} ${pick(rng, NOUN)} ${i}` : `${pick(rng, shared)} ${pick(rng, NOUN)} ${i}`);
    }
    return out;
}

/** The shared-vocabulary clash shape's pool, the same 16 words `bench-clash` uses. */
export const SHARED_VOCAB = ['mill', 'harbor', 'tower', 'road', 'lantern', 'gate', 'market', 'river', 'forest', 'shrine', 'stone', 'water', 'iron', 'ash', 'salt', 'north'];

/**
 * `keys` unique five-word keys per entry drawn from a 16-word pool, so every token recurs in hundreds of keys. This is
 * the shape that measured about 147–159 ms native at 1,000 × 4 in `bench-clash`, and the same encoding it uses.
 */
export function sharedKeyWords(i, keys = 4) {
    const out = [];
    for (let j = 0; j < keys; j++) {
        let n = i * keys + j; // 16^5 combinations, so every key is distinct
        const words = [];
        for (let d = 0; d < 5; d++) { words.push(SHARED_VOCAB[n % SHARED_VOCAB.length]); n = Math.floor(n / SHARED_VOCAB.length); }
        out.push(words.join(' '));
    }
    return out;
}

/**
 * A synthetic book at the plan's scales: 150, 1,000, 3,000 or 5,000 entries, sparse or dense.
 * Entries carry story logic (gates, Closes when, packs, written trackers, masks, Once) and Moments; some are plain
 * World Info. Ids are `entry-<i>` / `moment-<i>`; keys are unique multi-word phrases.
 * @param {number} size entries
 * @param {object} [options]
 * @param {string} [options.world] book name
 * @param {number} [options.seed]
 * @param {'sparse'|'mixed'|'dense'} [options.shape] how much story logic and how many gate edges
 * @param {number} [options.contentLength] roughly how many characters of content each entry gets
 * @param {'unique'|'shared'} [options.keyShape] unique multi-word keys, or five-word keys from a shared vocabulary
 * @param {number} [options.keysPerEntry] key words per entry
 * @returns {object[]} entries
 */
export function book(size, { world = 'Book', seed = 1, shape = 'mixed', contentLength = 240, keyShape = 'unique', keysPerEntry = 2 } = {}) {
    const rng = mulberry32(seed);
    const plainChance = shape === 'sparse' ? 0.65 : shape === 'dense' ? 0.03 : 0.3;
    const gateChance = shape === 'dense' ? 0.8 : shape === 'sparse' ? 0.15 : 0.4;
    const keysFor = i => (keyShape === 'shared' ? sharedKeyWords(i, keysPerEntry) : keyWords(rng, i, { keys: keysPerEntry }));
    const entries = [];
    for (let i = 0; i < size; i++) {
        const keys = keysFor(i);
        const plain = rng() < plainChance;
        const moment = i % 50 === 25;
        const content = `${pick(rng, NOUN)} ${i}. ` + `${pick(rng, ADJ)} ${pick(rng, NOUN)} and ${pick(rng, ADJ)} ${pick(rng, NOUN)}. `.repeat(
            Math.max(1, Math.round(contentLength / 70)),
        );
        if (moment) {
            entries.push(e(i, [`moment ${pick(rng, ADJ)} ${pick(rng, NOUN)} ${i}`], {
                id: `moment-${i}`,
                moment: true,
                // a later entry waits on it, so the Moment is used
                ...(i + 1 < size ? { gatesFor: [`entry-${i + 1}`] } : {}),
            }, { world, comment: `Moment ${i}`, content: '', disable: true }));
            continue;
        }
        if (plain) {
            entries.push(e(i, keys, undefined, { world, content }));
            continue;
        }
        const config = { id: `entry-${i}` };
        if (i > 2 && rng() < gateChance) config.gate = rng() < 0.7 ? [[`entry-${i - 1}`]] : [[`entry-${i - 1}`, `entry-${i - 2}`]];
        if (i > 4 && rng() < 0.12) config.closeGate = [[`entry-${int(rng, 0, i - 3)}`]];
        if (rng() < 0.1) config.once = true;
        if (rng() < 0.08) config.packs = [`group-${i % 17}`];
        if (i % 10 === 0) config.written = { label: `Stat ${i}`, describe: `the value of stat ${i}` };
        if (i % 14 === 0) {
            config.masks = [
                { name: 'Broken', content: `broken view of ${i}` },
                { name: 'Night', written: { label: `Night ${i}` } },
            ];
        }
        entries.push(e(i, keys, config, {
            world,
            content: config.written ? String(int(rng, 1, 99)) : content,
            ...(rng() < 0.05 ? { order: int(rng, 1, 100) } : {}),
        }));
    }
    return entries;
}

/** A plain book with roomy content, for serialization-heavy benches (the history wrapper). */
export function bulkyBook(size, { world = 'Book', seed = 7, contentLength = 1150 } = {}) {
    const rng = mulberry32(seed);
    return Array.from({ length: size }, (_, i) => e(i, keyWords(rng, i), { id: `entry-${i}` }, {
        world,
        content: `${pick(rng, ADJ)} ${pick(rng, NOUN)} ${i}. `.repeat(Math.ceil(contentLength / 20)),
    }));
}

/** The plan's library scales: 40 and 100 books. Each book is deterministic; names sort and stay unique. */
export function library(count, { entries = 150, seed = 1, shape = 'mixed', worldPrefix = 'Book' } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        name: `${worldPrefix} ${String(i + 1).padStart(3, '0')}`,
        entries: book(entries, { world: `${worldPrefix} ${String(i + 1).padStart(3, '0')}`, seed: seed + i * 7919, shape }),
    }));
}

/**
 * A book's saved canvas memory (`settings.books[name].canvas`): placed cards, hand-set ports and layers, plus a few
 * cards left unplaced. Keyed as canvas.js keys them: `id:<wihero id>`, or `uid:<n>` for plain World Info.
 */
export function placedCanvas(entries, { seed = 3, dense = false } = {}) {
    const rng = mulberry32(seed);
    const cards = {};
    for (const entry of entries) {
        const id = entry.extensions?.[FIELD]?.id;
        if (!id && rng() < (dense ? 0.1 : 0.5)) continue; // sparse: many plain entries sit off the canvas
        const key = id ? `id:${id}` : `uid:${entry.uid}`;
        const placed = rng() < 0.9;
        cards[key] = {
            x: Math.round(rng() * 2400),
            y: Math.round(rng() * 1600),
            ...(rng() < 0.3 ? { ports: { r: 'gout', l: 'gin' } } : {}),
            ...(entry.extensions?.[FIELD]?.masks?.length && rng() < 0.2 ? { layer: 'Night' } : {}),
            placed,
            ...(rng() < 0.05 ? { links: { 'id:shape': { pts: [{ x: 10, y: 10 }, { x: 40, y: 40 }] } } } : {}),
        };
    }
    return { camera: null, cards, placed: true };
}

/** A chat: short (a greeting and a few turns) or long (the plan's long-chat scale). Words stay in the fixture's vocabulary. */
export function chat({ turns = 6, seed = 5, long = false } = {}) {
    const rng = mulberry32(seed);
    const count = long ? Math.max(turns, 240) : turns;
    const out = [{ is_user: false, mes: `Hello. The ${pick(rng, ADJ)} ${pick(rng, NOUN)} waits.`, name: 'Char' }];
    for (let i = 1; i <= count; i++) {
        const user = `${pick(rng, ADJ)} ${pick(rng, NOUN)} ${i}. ${pick(rng, ADJ)} ${pick(rng, NOUN)} and the ${pick(rng, NOUN)}.`;
        out.push({ is_user: true, mes: user, name: 'User' });
        const lines = rng() < 0.35 ? `\n[Stat ${i % 20}: ${int(rng, 1, 99)}]` : '';
        out.push({ is_user: false, mes: `The ${pick(rng, NOUN)} answers ${i}.${lines}`, name: 'Char' });
    }
    return out;
}

/** The plan's scales, in one place so a run and its README cannot drift apart. */
export const SIZES = [150, 1000, 3000, 5000];
export const LIBRARY_SIZES = [40, 100];
export const TRACKER_SIZES = [20, 60, 120];
export const CLASH_SIZES = [[150, 3], [500, 4], [1000, 4], [2000, 4]];
export const SORT_SIZES = [150, 500, 1000, 3000];
export const HISTORY_SIZES = [150, 1000, 5000];
