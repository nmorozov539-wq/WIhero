// Story state: the snapshot stored on chat messages (BUILD_SPEC 4). Pure, no SillyTavern imports.
import { isObject } from './util.js';

export const STATE_VERSION = 2;

/** The state at the start of a chat: nothing fired, nothing closed. */
export function initialState() {
    return { v: STATE_VERSION, at: -1, fired: {}, firstAt: {}, lastAt: {}, closed: {}, holding: {}, latches: {}, baseline: {}, masks: { closed: {}, pick: {} }, round: [] };
}

const object = x => isObject(x) ? structuredClone(x) : {};

/**
 * Reads a stored snapshot, or returns null if it isn't one.
 * @param {any} value message.extra.wihero
 * @param {object} [options]
 * @param {number} [options.at] Chat index of the message it was read from (for v1 snapshots, which have none).
 * @param {(id: string) => string | undefined} [options.keyOfId] Maps a v1 id (unique across books) to its state key.
 * @param {Record<string, string>} [options.renamed] Book renames, old → new.
 */
export function readState(value, { at = -1, keyOfId = id => id, renamed = {} } = {}) {
    if (!isObject(value)) return null;
    let state;
    if (value.v === STATE_VERSION) {
        state = {
            v: STATE_VERSION,
            at: Number.isInteger(value.at) ? value.at : at,
            fired: object(value.fired),
            firstAt: object(value.firstAt),
            lastAt: object(value.lastAt),
            closed: object(value.closed),
            holding: object(value.holding),
            latches: object(value.latches),
            baseline: object(value.baseline),
            masks: { closed: object(value.masks?.closed), pick: object(value.masks?.pick) },
            round: Array.isArray(value.round) ? [...value.round] : [],
        };
    } else if (value.v === 1) {
        // The old build: ids were unique across books, there were no times, and glue was `glued`.
        state = initialState();
        state.at = at;
        const key = id => keyOfId(id) ?? id;
        for (const [id, n] of Object.entries(object(value.fired))) {
            state.fired[key(id)] = Number(n) || 0;
            state.firstAt[key(id)] = at;
            state.lastAt[key(id)] = at;
        }
        for (const id of Object.keys(object(value.closed))) state.closed[key(id)] = { at, by: 'earlier version', wasHolding: false };
        for (const id of Object.keys(object(value.glued))) state.holding[key(id)] = { since: at };
        for (const [id, name] of Object.entries(object(value.masks))) state.masks.pick[key(id)] = name;
        state.round = Array.isArray(value.round) ? [...value.round] : [];
    } else {
        return null;
    }
    return Object.keys(renamed).length ? renameBooks(state, renamed) : state;
}

/** Book renames, applied to every state key (`Old/x` → `New/x`, and `Old.3` in round). */
function renameBooks(state, renamed) {
    const map = key => {
        for (let i = 0; i < 10; i++) {
            const slash = key.indexOf('/');
            const book = slash > 0 ? key.slice(0, slash) : null;
            if (!book || !(book in renamed)) return key;
            key = renamed[book] + key.slice(slash);
        }
        return key;
    };
    const keys = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [map(k), v]));
    const latch = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [map(k), v]));
    // `round` holds ST keys, `book.uid`: only the whole book name before the last `.<uid>` counts, so a rename of
    // "a" leaves "a.b.3" alone (review 2026-11-09, finding 9).
    const round = key => {
        const m = /^(.*)\.(\d+)$/.exec(key);
        return m && Object.hasOwn(renamed, m[1]) ? `${renamed[m[1]]}.${m[2]}` : key;
    };
    return {
        ...state,
        fired: keys(state.fired), firstAt: keys(state.firstAt), lastAt: keys(state.lastAt),
        closed: keys(state.closed), holding: keys(state.holding), latches: latch(state.latches), baseline: keys(state.baseline),
        masks: { closed: keys(state.masks.closed), pick: keys(state.masks.pick) },
        round: state.round.map(round),
    };
}

