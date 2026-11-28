// Story state stored on chat messages. Each counted reply carries a snapshot of the state after it, in
// message.extra.wihero and on its current swipe, so swipes, deletes and branches rewind it with no extra work.
// See BUILD_SPEC 4.1 and TECHNICAL_NOTES section 7.
import { FIELD } from './engine/model.js';

/** Stores a snapshot on a message and on its current swipe, so switching swipes keeps it. */
export function writeSnapshot(message, state) {
    message.extra ??= {};
    message.extra[FIELD] = state;
    const swipe = message.swipe_info?.[message.swipe_id ?? 0];
    if (swipe) {
        swipe.extra ??= {};
        swipe.extra[FIELD] = state;
    }
}

/**
 * The character's greeting-swipe count as ST's getFirstMessage lays it out: the main greeting when it is present,
 * plus every alternate. ST drops an empty main greeting from the swipes (script.js getFirstMessage).
 */
function greetingSwipeCount(character) {
    const alternates = Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [];
    return (character.first_mes ? 1 : 0) + alternates.length;
}

/**
 * The greeting a chat opened with, as a greeting key (`@<avatar>:<n>`), or null (BUILD_SPEC 15.1).
 * chat[0] is a greeting when it is the character's message and its swipe structure is the character's greeting
 * list: the swipe count matches (main, when present, plus alternates, with the empty main dropped as ST does) and
 * `swipe_id` is a valid index. Swipe texts are never compared: an edited first message keeps its swipe identity,
 * and so does a chat whose swipe list predates a card edit or reorder.
 * Without a swipe list, only a sole main greeting can be recognised, by its exact text; there is no swipe identity
 * to keep, and a similar phrase must not count.
 * @param {object[]} chat
 * @param {{ avatar: string, first_mes?: string, data?: { alternate_greetings?: string[] } } | null} character
 *   The open chat's character, or null for a group chat or no chat.
 */
export function openingGreeting(chat, character) {
    const first = chat?.[0];
    if (!first || first.is_user || first.is_system || !character?.avatar) return null;
    const count = greetingSwipeCount(character);
    const offset = character.first_mes ? 0 : 1; // with no main greeting ST drops it from the swipes
    const swipes = Array.isArray(first.swipes) ? first.swipes : null;
    if (swipes || first.swipe_id !== undefined) {
        if (!(count > 0)) return null;
        if (swipes && swipes.length !== count) return null;
        const swipe = first.swipe_id ?? 0;
        if (!Number.isInteger(swipe) || swipe < 0 || swipe >= count) return null;
        return `@${character.avatar}:${swipe + offset}`;
    }
    // No swipe identity: only the character's sole main greeting, recognised by its exact text.
    const main = character.first_mes;
    const alternates = Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [];
    if (!main || alternates.length) return null;
    return String(first.mes ?? '').trim() === String(main).trim() ? `@${character.avatar}:0` : null;
}

/** The greetings of a character, raw from the card: [main, alt 1, alt 2…]. */
export function greetingsOf(character) {
    if (!character) return [];
    return [character.first_mes ?? '', ...(Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [])];
}

/** A greeting's fingerprint: ST's getStringHash of its first 200 characters, trimmed (BUILD_SPEC 15.2). */
export const greetingFingerprint = (text, hash) => String(hash(String(text ?? '').trim().slice(0, 200)));

/**
 * buildModel's `greetingFp` over ST's characters: the fingerprint of a character's greeting n, undefined when the
 * character is missing, null when it has no greeting n. The runtime, the editor and Preview all use it, so they
 * agree on which greetings changed.
 * @param {() => object[] | undefined} characters
 */
export const greetingFpOf = (characters, hash) => (avatar, n) => {
    const char = characters()?.find?.(c => c.avatar === avatar);
    if (!char) return undefined;
    const list = greetingsOf(char);
    return n < list.length ? greetingFingerprint(list[n], hash) : null;
};

/** A key that changes whenever a character's greetings change in a way the model sees (their fingerprints). */
export const greetingSignature = (character, hash) => `${character?.avatar ?? ''}|${greetingsOf(character).map(t => greetingFingerprint(t, hash)).join(',')}`;
