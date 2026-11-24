// Keyword clash finder (AFTER_V1 brainstorm): key words that fire two or more entries at once. Works on plain
// World Info too, so Normal mode shows it as well as Hero mode.
import { compareText, entriesOf, titleOf } from './data.js';
import { rawConfig } from '../engine/model.js';
import { perf } from './perf.js';

const norm = k => String(k).trim().toLowerCase().replace(/\s+/g, ' ');
const isRegex = k => /^\/.+\/[a-z]*$/.test(String(k).trim());
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One whole-word pattern per distinct key, built once. */
const withinRx = new Map();
/** Per-book results, keyed by the book object and invalidated by its revision. */
const cache = new WeakMap();
function within(word, key) {
    if (key.length <= word.length) return false;
    let rx = withinRx.get(word);
    if (!rx) {
        rx = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, 'u');
        withinRx.set(word, rx);
    }
    return rx.test(key);
}

/** The alphanumeric tokens of a normalized key, used only to narrow the pair scan. */
const tokens = word => word.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Entries whose key words can fire them: on, keyword strategy, not a Moment (ST never activates a Moment). */
function keyed(e) {
    if (e.disable || e.constant) return false;
    if (rawConfig(e)?.moment === true) return false;
    return Array.isArray(e.key) && e.key.some(k => typeof k === 'string' && k.trim());
}

/**
 * Finds the clashes in a book.
 * A clash is a key word that fires two or more entries: the same word in both ("mill" and "Mill"), or a word
 * inside another entry's longer key ("mill" inside "old mill": saying "old mill" fires both). Regex keys and
 * second key words (filters, not triggers) are left out.
 * @param {object} data the book ({ entries })
 * @param {Set<number>} [skip] uids to leave out (entries deleted with Undo still pending)
 * @param {number | null} [revision] the book's revision; when given, the result is cached until it changes
 * @returns {{ groups: { word: string, uids: number[] }[], of: (uid: number, key: string) => string[] }}
 *   `groups` one per clashing word, sorted by word; `of(uid, key)` the titles of the other entries that `key` of
 *   entry `uid` also fires (empty when it clashes with nothing).
 */
export function keywordClashes(data, skip = new Set(), revision = null) {
    const started = perf.begin('clashScan');
    try {
        const skipSig = revision === null ? null : (skip.size ? [...skip].sort((a, b) => a - b).join(',') : '');
        if (revision !== null) {
            const hit = cache.get(data);
            if (hit && hit.revision === revision && hit.skipSig === skipSig) return hit.result;
        }
        const entries = entriesOf(data).filter(e => keyed(e) && !skip.has(e.uid));
        const words = new Map(); // normalized key → Set(uid) of entries with that exact key
        for (const e of entries) {
            const ks = [...new Set(e.key.filter(k => typeof k === 'string' && k.trim() && !isRegex(k)).map(norm))];
            for (const k of ks) { if (!words.has(k)) words.set(k, new Set()); words.get(k).add(e.uid); }
        }
        const all = [...words.keys()];
        // A key can only contain `word` as a whole-word substring if it contains `word`'s first token. Indexing by
        // token turns the W² pair scan into a scan of the plausible candidates; words with no token fall back to all.
        // Tokens only one key has are left out: they can never put another key in the candidate set.
        const keyTokens = new Map(); // normalized key → its unique tokens
        const tokenCount = new Map(); // token → how many keys contain it
        for (const k of all) {
            const ts = [...new Set(tokens(k))];
            keyTokens.set(k, ts);
            for (const t of ts) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
        }
        const byToken = new Map(); // token → Set(normalized keys), only for shared tokens
        for (const k of all) {
            for (const t of keyTokens.get(k)) {
                if (tokenCount.get(t) < 2) continue;
                let set = byToken.get(t);
                if (!set) byToken.set(t, set = new Set());
                set.add(k);
            }
        }
        const groups = [];
        for (const w of all) {
            const uids = new Set(words.get(w));
            const first = keyTokens.get(w)[0];
            const candidates = first ? (tokenCount.get(first) > 1 ? byToken.get(first) : null) : all;
            if (candidates) for (const other of candidates) {
                if (other !== w && within(w, other)) for (const u of words.get(other)) uids.add(u);
            }
            if (uids.size > 1) groups.push({ word: w, uids: [...uids] });
        }
        groups.sort((a, b) => compareText(a.word, b.word));
        const byUid = new Map(); // uid → the groups it belongs to, in the same sorted order
        for (const g of groups) for (const u of g.uids) {
            let list = byUid.get(u);
            if (!list) byUid.set(u, list = []);
            list.push(g);
        }
        const title = uid => titleOf(data.entries[uid]);
        const result = {
            groups,
            of(uid, key) {
                const k = norm(key);
                const hit = new Set();
                for (const g of byUid.get(uid) ?? []) {
                    if (!(g.word === k || within(g.word, k))) continue;
                    for (const u of g.uids) if (u !== uid) hit.add(u);
                }
                return [...hit].map(title);
            },
        };
        if (revision !== null) cache.set(data, { revision, skipSig, result });
        return result;
    } finally {
        perf.end(started);
    }
}

/** Whether the key `key` fires on the clash word `word`: the same word, or `word` inside it as whole words. */
export function firesOn(word, key) {
    if (typeof key !== 'string' || isRegex(key)) return false;
    const k = norm(key);
    return k === word || within(word, k);
}
