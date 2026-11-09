// Keyword clash finder (AFTER_V1 brainstorm): key words that fire two or more entries at once. Works on plain
// World Info too, so Normal mode shows it as well as Hero mode.
import { configOf, entriesOf, titleOf } from './data.js';

const norm = k => String(k).trim().toLowerCase().replace(/\s+/g, ' ');
const isRegex = k => /^\/.+\/[a-z]*$/.test(String(k).trim());
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Entries whose key words can fire them: on, keyword strategy, not a Moment (ST never activates a Moment). */
function keyed(e) {
    if (e.disable || e.constant) return false;
    if (configOf(e)?.moment === true) return false;
    return Array.isArray(e.key) && e.key.some(k => typeof k === 'string' && k.trim());
}

/**
 * Finds the clashes in a book.
 * A clash is a key word that fires two or more entries: the same word in both ("mill" and "Mill"), or a word
 * inside another entry's longer key ("mill" inside "old mill": saying "old mill" fires both). Regex keys and
 * second key words (filters, not triggers) are left out.
 * @param {object} data the book ({ entries })
 * @param {Set<number>} [skip] uids to leave out (entries deleted with Undo still pending)
 * @returns {{ groups: { word: string, uids: number[] }[], of: (uid: number, key: string) => string[] }}
 *   `groups` one per clashing word, sorted by word; `of(uid, key)` the titles of the other entries that `key` of
 *   entry `uid` also fires (empty when it clashes with nothing).
 */
export function keywordClashes(data, skip = new Set()) {
    const entries = entriesOf(data).filter(e => keyed(e) && !skip.has(e.uid));
    const words = new Map(); // normalized key → Set(uid) of entries with that exact key
    for (const e of entries) {
        const ks = [...new Set(e.key.filter(k => typeof k === 'string' && k.trim() && !isRegex(k)).map(norm))];
        for (const k of ks) { if (!words.has(k)) words.set(k, new Set()); words.get(k).add(e.uid); }
    }
    const all = [...words.keys()];
    const groups = [];
    for (const w of all) {
        const uids = new Set(words.get(w));
        for (const other of all) if (other !== w && within(w, other)) for (const u of words.get(other)) uids.add(u);
        if (uids.size > 1) groups.push({ word: w, uids: [...uids] });
    }
    groups.sort((a, b) => a.word.localeCompare(b.word));
    const title = uid => titleOf(data.entries[uid]);
    return {
        groups,
        of(uid, key) {
            const k = norm(key);
            const hit = new Set();
            for (const g of groups) {
                if (!g.uids.includes(uid) || !(g.word === k || within(g.word, k))) continue;
                for (const u of g.uids) if (u !== uid) hit.add(u);
            }
            return [...hit].map(title);
        },
    };
}

/** Whether `word` sits inside the longer key `key` as whole words ("mill" in "old mill", not in "miller"). */
function within(word, key) {
    if (key.length <= word.length) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, 'u').test(key);
}
