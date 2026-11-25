// Keyword clash finder (AFTER_V1 brainstorm): key words that fire two or more entries at once. Works on plain
// World Info too, so Normal mode shows it as well as Hero mode.
import { compareText, entriesOf, titleOf } from './data.js';
import { rawConfig } from '../engine/model.js';
import { perf } from './perf.js';

const norm = k => String(k).trim().toLowerCase().replace(/\s+/g, ' ');
const isRegex = k => /^\/.+\/[a-z]*$/.test(String(k).trim());
const ALNUM = /[\p{L}\p{N}]/u;
/** Per-book results, keyed by the book object and invalidated by its revision. */
const cache = new WeakMap();

const alnum = cp => ALNUM.test(String.fromCodePoint(cp));

/** Whether the code point just before `at` is a letter or digit (surrogate pairs included). */
function alnumBefore(text, at) {
    if (at <= 0) return false;
    const low = text.charCodeAt(at - 1);
    if (low >= 0xDC00 && low <= 0xDFFF && at >= 2) {
        const high = text.charCodeAt(at - 2);
        if (high >= 0xD800 && high <= 0xDBFF) return alnum((high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000);
    }
    return alnum(low);
}

/** Whether the code point at `at` is a letter or digit. */
function alnumAfter(text, at) {
    return at < text.length && alnum(text.codePointAt(at));
}

/** Whether `word` is in `key` as a whole word: both edges are the string ends or outside `[\p{L}\p{N}]`. */
function within(word, key) {
    if (key.length <= word.length) return false;
    for (let at = key.indexOf(word); at !== -1; at = key.indexOf(word, at + 1)) {
        if (!alnumBefore(key, at) && !alnumAfter(key, at + word.length)) return true;
    }
    return false;
}

/** The ordered alphanumeric spans of a normalized key, as regex matches with `index` and text. */
const spans = key => [...key.matchAll(/[\p{L}\p{N}]+/gu)];

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
        // Enumerate phrases instead of scanning pairs. Every contiguous token span of a key, sliced from the
        // normalized string so its separators survive ("old-mill" keeps its hyphen), is a phrase. For a key that
        // starts and ends with a token, its phrases are exactly the whole words it contains; so a phrase that is
        // itself a key stands for the old "same word, or word inside a longer key" relation.
        const phrases = new Map(); // phrase → Set(normalized keys containing it), in key order
        const fallback = []; // keys a phrase cannot stand for: no token, or punctuation at an edge
        const keySpans = [];
        const counts = new Set(); // token counts some key has: only those spans can match a key
        for (const key of words.keys()) {
            const ts = spans(key);
            keySpans.push([key, ts]);
            if (ts.length) counts.add(ts.length);
            // A key can stand for a phrase only when its own text is one. It can still contain other keys' phrases,
            // so every key's spans are indexed; only a key whose span covers it whole can become a group word.
            if (!ts.length || ts[0].index !== 0 || ts[ts.length - 1].index + ts[ts.length - 1][0].length !== key.length) {
                fallback.push(key);
            }
        }
        const lengths = [...counts].sort((a, b) => a - b);
        for (const [key, ts] of keySpans) {
            for (let i = 0; i < ts.length; i++) {
                for (const len of lengths) {
                    const j = i + len - 1;
                    if (j >= ts.length) break;
                    const phrase = key.slice(ts[i].index, ts[j].index + ts[j][0].length);
                    // Only phrases that are keys themselves can ever be a group word; other slices are dropped.
                    if (!words.has(phrase)) continue;
                    let set = phrases.get(phrase);
                    if (!set) phrases.set(phrase, set = new Set());
                    set.add(key); // one member per key, however many spans produce the phrase
                }
            }
        }
        const groups = [];
        const addGroup = (word, uids) => { if (uids.size > 1) groups.push({ word, uids: [...uids] }); };
        for (const word of words.keys()) {
            const containing = phrases.get(word);
            if (!containing) continue;
            const uids = new Set(words.get(word));
            for (const key of containing) {
                if (key === word) continue;
                for (const uid of words.get(key)) uids.add(uid);
            }
            addGroup(word, uids);
        }
        // A key phrase enumeration cannot stand for (no alphanumeric token, or punctuation on an edge) is rare;
        // scan every key with the old boundary check so its groups and `of()` stay identical.
        for (const word of fallback) {
            const uids = new Set(words.get(word));
            for (const key of words.keys()) {
                if (key === word) continue;
                if (within(word, key)) for (const uid of words.get(key)) uids.add(uid);
            }
            addGroup(word, uids);
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
