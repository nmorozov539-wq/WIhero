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
 * The greeting a chat opened with, as a greeting key (`@<avatar>:<n>`), or null (BUILD_SPEC 15.1).
 * chat[0] is a greeting when it is the character's message and its swipes are the character's greetings
 * (ST's getFirstMessage puts the alternate greetings in as swipes, script.js 7710).
 * @param {object[]} chat
 * @param {{ avatar: string, first_mes?: string, data?: { alternate_greetings?: string[] } } | null} character
 *   The open chat's character, or null for a group chat or no chat.
 */
export function openingGreeting(chat, character) {
    const first = chat?.[0];
    if (!first || first.is_user || first.is_system || !character?.avatar) return null;
    const alternates = Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [];
    const offset = character.first_mes ? 0 : 1; // with no main greeting ST drops it from the swipes
    const count = alternates.length + 1 - offset;
    const swipes = Array.isArray(first.swipes) ? first.swipes.length : 1;
    if (count <= 0 || swipes !== count) return null;
    const n = (first.swipe_id ?? 0) + offset;
    return `@${character.avatar}:${n}`;
}

/** The greetings of a character, raw from the card: [main, alt 1, alt 2…]. */
export function greetingsOf(character) {
    if (!character) return [];
    return [character.first_mes ?? '', ...(Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [])];
}

/** A greeting's fingerprint: ST's getStringHash of its first 200 characters, trimmed (BUILD_SPEC 15.2). */
export const greetingFingerprint = (text, hash) => String(hash(String(text ?? '').trim().slice(0, 200)));
