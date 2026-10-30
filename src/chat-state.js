// Gate state stored on chat messages. Each chat reply carries a snapshot of the state after it,
// in message.extra.wihero, so swipes, deletes and branches rewind the state with no extra work.
// See docs/TECHNICAL_NOTES.md section 7.
import { FIELD, initialState, readState } from './engine.js';

/**
 * State in effect for a generation that follows chat[0..end-1].
 * @param {object[]} chat ST chat array.
 * @param {number} [end] Exclusive end; defaults to the whole chat.
 * @returns {{ state: object, index: number }} index of the message the state came from, -1 for the initial state.
 */
export function stateBefore(chat, end = chat?.length ?? 0) {
    for (let i = Math.min(end, chat?.length ?? 0) - 1; i >= 0; i--) {
        const state = readState(chat[i]?.extra?.[FIELD]);
        if (state) return { state, index: i };
    }
    return { state: initialState(), index: -1 };
}

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
