// Which generations move the story, and which part of the chat they read their state from.
// See BUILD_SPEC 6.1 and TECHNICAL_NOTES sections 6–7.

/** Generation types whose result lands in the chat. ST passes no type for a plain send. */
const COUNTED = new Set([undefined, 'normal', 'swipe', 'regenerate', 'continue']);

export const isCounted = type => COUNTED.has(type);

/**
 * End (exclusive) of the chat a generation of this type sees.
 * A swipe, continue or regenerate works on the last reply, so that reply (and its snapshot) doesn't count.
 * (A regenerate removes the old reply partway through; before that, this skips it.)
 */
export function scanEnd(chat, type) {
    const last = chat[chat.length - 1];
    if ((type === 'swipe' || type === 'continue' || type === 'regenerate') && last && !last.is_user) return chat.length - 1;
    return chat.length;
}

/** The chat as a generation of this type sees it. */
export const scanChat = (chat, type) => (chat ?? []).slice(0, scanEnd(chat ?? [], type));
