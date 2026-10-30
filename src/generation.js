// Which generations move gate state, and which messages they read state from.
// See docs/DESIGN.md 2.0 and docs/TECHNICAL_NOTES.md sections 6–7.
import { FIELD, advance } from './engine.js';
import { stateBefore } from './chat-state.js';

/** Generation types whose result lands in the chat. ST passes no type for a plain send. */
const RECORDED = new Set([undefined, 'normal', 'swipe', 'regenerate', 'continue']);

export const isRecorded = type => RECORDED.has(type);

/**
 * End (exclusive) of the chat a generation reads its state from.
 * A swipe, continue or regenerate works on the last reply, so that reply's own snapshot doesn't count.
 * (A regenerate removes the old reply partway through; before that, this skips it.)
 */
export function scanEnd(chat, type) {
    const last = chat[chat.length - 1];
    if ((type === 'swipe' || type === 'continue' || type === 'regenerate') && last && !last.is_user) return chat.length - 1;
    return chat.length;
}

/** State a generation of this type gates with. */
export const gatingState = (chat, type) => stateBefore(chat, scanEnd(chat, type)).state;

/**
 * Text of the turn that produced chat[messageId]: the messages after the previous snapshot, up to the reply.
 * Glue close keywords are checked against it.
 */
export function turnText(chat, messageId) {
    const { index } = stateBefore(chat, messageId);
    return chat.slice(index + 1, messageId + 1).filter(m => !m?.is_system).map(m => m?.mes ?? '').join('\n');
}

/**
 * Snapshot for a reply that just landed in the chat.
 * @param {object} base State the generation gated with.
 * @param {string[]} activated world.uid keys ST activated during the generation.
 * @param {string} text The turn's text (turnText).
 * @param {object} message The reply. On a continue it already carries the first part's snapshot,
 *   whose round is merged in: both parts are one turn.
 */
export function snapshotFor({ base, activated, message, type, model, text = '' }) {
    const earlier = type === 'continue' ? message?.extra?.[FIELD]?.round ?? [] : [];
    return advance(base, [...earlier, ...activated], model, text);
}
