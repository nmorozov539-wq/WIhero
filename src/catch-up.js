// Catching up a chat that ran without WI Hero (BUILD_SPEC 17.1). Replies written while WI Hero was off (or before it
// was installed) carry no snapshot, so the story state is stuck at the last one that does. ST doesn't save which
// entries it sent with each reply, so catch-up replays the skipped turns through the engine with Preview's keyword
// matching (src/ui/preview.js), oldest first, each turn starting from the one before, as in play.
import { FIELD } from './engine/model.js';
import { advance, baseState } from './engine/turn.js';
import { initialState } from './engine/state.js';
import { writeSnapshot } from './chat-state.js';
import { simulateTurn } from './ui/preview.js';

const isReply = m => m && !m.is_user && !m.is_system;

/**
 * The replies after the last snapshot that have none (a greeting before the first user message never has one).
 * @returns {{ from: number, skipped: number[] }} `from` is the index of the last snapshot, -1 for none.
 */
export function findGap(chat) {
    chat ??= [];
    let from = -1;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.extra?.[FIELD]) { from = i; break; }
    const firstUser = chat.findIndex(m => m?.is_user && !m.is_system);
    const skipped = [];
    if (firstUser < 0) return { from, skipped };
    for (let i = Math.max(from + 1, firstUser + 1); i < chat.length; i++) if (isReply(chat[i])) skipped.push(i);
    return { from, skipped };
}

/**
 * Resolves a gap, writing snapshots on the chat's messages (the caller saves the chat).
 * @param {'catchUp' | 'keep' | 'fresh'} how Catch up: replay each skipped turn, oldest first. Keep: carry the old
 *   state on to the newest reply. Fresh: the story starts again from the newest reply.
 * @param {object} input { chat, entries (with world), model, options: (chat) => stateOptions, globals }
 * @returns {number} How many replies got a snapshot.
 */
export function resolveGap(how, { chat, entries, model, options = () => ({}), globals = {} }) {
    const { skipped } = findGap(chat);
    if (!skipped.length) return 0;
    const last = skipped.at(-1);
    if (how === 'keep') {
        const { state } = baseState(chat, model, options(chat), last);
        writeSnapshot(chat[last], { ...state, at: last, round: [] });
        return 1;
    }
    if (how === 'fresh') {
        writeSnapshot(chat[last], { ...initialState(), at: last });
        return 1;
    }
    for (const j of skipped) {
        const seen = chat.slice(0, j);
        const turn = simulateTurn({ entries, model, chat: seen, opts: options(seen), globals });
        const next = advance(turn.state, { fired: turn.fired, victims: turn.victims }, model, chat.slice(0, j + 1), j);
        writeSnapshot(chat[j], next);
    }
    return skipped.length;
}
