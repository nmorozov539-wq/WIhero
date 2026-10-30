// ST's own sticky effect, read so gating never cuts a running sticky short. No SillyTavern imports.
// See docs/TECHNICAL_NOTES.md section 2.
import { entryKey } from './engine.js';

/** Copy of ST's KNOWN_DECORATORS (world-info.js 100), which isn't exported. */
const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];

/** ST's parseDecorators (world-info.js 4652), which isn't exported. */
function parseDecorators(content) {
    if (!content.startsWith('@@')) return [[], content];
    const isKnown = data => KNOWN_DECORATORS.some(d => (data.startsWith('@@@') ? data.substring(1) : data).startsWith(d));
    const lines = content.split('\n');
    const decorators = [];
    let newContent = content;
    let fallbacked = false;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('@@')) {
            newContent = lines.slice(i).join('\n');
            break;
        }
        if (lines[i].startsWith('@@@') && !fallbacked) continue;
        if (isKnown(lines[i])) {
            decorators.push(lines[i].startsWith('@@@') ? lines[i].substring(1) : lines[i]);
            fallbacked = false;
        } else {
            fallbacked = true;
        }
    }
    return [decorators, newContent];
}

/**
 * The hash ST gives an entry in getSortedEntries() (world-info.js 4627–4634), computed on the entry
 * as WORLDINFO_ENTRIES_LOADED hands it over. Timed effects are matched back to entries by it.
 * @param {(text: string) => number} getStringHash ST's utils.js getStringHash.
 */
export function entryHash(entry, getStringHash) {
    const [decorators, content] = parseDecorators(entry.content || '');
    return getStringHash(JSON.stringify({ ...entry, decorators, content }));
}

/**
 * How many messages ST's World Info scan sees: the non-system messages, minus the reply a swipe replaces
 * (script.js 4496–4499). Timed effects compare their start/end against this.
 */
export function scanLength(chat, type) {
    const length = (chat ?? []).filter(m => !m?.is_system).length;
    return type === 'swipe' ? Math.max(0, length - 1) : length;
}

/**
 * Entries ST will hold active by sticky in a scan of `length` messages, mirroring
 * WorldInfoTimedEffects#checkTimedEffectOfType (world-info.js 619–656).
 * @param {object[]} entries The loaded entries.
 * @param {object} timed chat_metadata.timedWorldInfo.
 * @param {(entry: object) => number} hashOf Hash of an entry (entryHash).
 * @returns {Map<string, number>} world.uid key → the scan length at which the sticky ends.
 */
export function stickyHeld(entries, timed, length, hashOf) {
    const held = new Map();
    for (const effect of Object.values(timed?.sticky ?? {})) {
        if (!effect || typeof effect !== 'object') continue;
        if (length <= Number(effect.start) && !effect.protected) continue;
        if (length >= Number(effect.end)) continue;
        const entry = (entries ?? []).find(e => String(hashOf(e)) === String(effect.hash));
        if (!entry?.sticky) continue;
        held.set(entryKey(entry), Number(effect.end));
    }
    return held;
}
