// Manual actions on the story state (BUILD_SPEC 7). Pure: each returns a new state, written onto the latest
// message by the caller, so it rewinds like everything else.

/**
 * Reopen (D5): the entry is restored as it was just before it closed (holding again if it was holding), and its
 * close rules count afresh from now.
 * @param {number} now The chat length: close rules only count fires and latches from this index on.
 */
export function reopen(state, key, now) {
    const next = structuredClone(state);
    const closed = next.closed[key];
    delete next.closed[key];
    if (closed?.wasHolding) next.holding[key] = { since: now };
    next.baseline[key] = now;
    return next;
}

/** Picks a mask by hand (`name`), or clears the pick (no name), so the masks follow their gates again. */
export function pickMask(state, key, name) {
    const next = structuredClone(state);
    if (name) next.masks.pick[key] = name;
    else delete next.masks.pick[key];
    return next;
}

/**
 * Sets a tracker's value by hand (TRACKERS 2.3), or clears it (empty text), on the latest message.
 * @param {number} at The latest message's index: the value is stored there.
 */
export function setSlot(state, key, text, at) {
    const next = structuredClone(state);
    // Values read at an older message stay there; this snapshot keeps only its own.
    if (next.at !== at) next.wrote = {};
    next.wrote ??= {};
    next.written ??= {};
    next.wrote[key] = String(text ?? '').trim();
    next.written[key] = at;
    return next;
}
