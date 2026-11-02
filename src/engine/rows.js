// Evaluating a row: plain items, waits and locks (BUILD_SPEC 5). Pure, no SillyTavern imports.
import { phraseMatcher } from './util.js';

const matchers = new Map();
const matcher = phrase => {
    if (!matchers.has(phrase)) matchers.set(phrase, phraseMatcher(phrase));
    return matchers.get(phrase);
};

/** Whether a lock's phrases appear in `text`. */
export const lockFound = (lock, text) => !!text && lock.phrases.some(p => matcher(p)(text));

/**
 * When an item became true, or null if it isn't.
 * @param {object} item A compiled row item.
 * @param {object} ctx See rowMet.
 */
export function itemTime(item, ctx) {
    const { state, baseline } = ctx;
    const entryTime = (key, self = false) => {
        if (item.type === 'greeting' || key.startsWith('@')) {
            if (ctx.greetingOk && !ctx.greetingOk(key)) return null;
        }
        if ((state.fired[key] ?? 0) > 0) {
            const first = state.firstAt[key] ?? state.lastAt[key] ?? 0;
            const last = state.lastAt[key] ?? first;
            if (baseline === undefined || baseline === null) return first;
            if (last >= baseline) return first >= baseline ? first : last;
        }
        // Fired this turn (only for the turn's own closing decisions); never for Once's own row.
        if (!self && ctx.extra?.has(key)) return ctx.turnAt ?? ctx.now;
        return null;
    };
    switch (item.type) {
        case 'entry':
        case 'greeting':
            return entryTime(item.key);
        case 'self':
            return entryTime(item.key, true);
        case 'pack': {
            const times = item.keys.map(k => entryTime(k)).filter(t => t !== null).sort((a, b) => a - b);
            if (item.mode === 'any') return times.length ? times[0] : null;
            if (item.mode === 'all') return times.length === item.keys.length ? times[times.length - 1] : null;
            return times.length >= item.mode ? times[item.mode - 1] : null;
        }
        default:
            return null;
    }
}

const sideOf = message => message?.is_user ? 'user' : 'char';
const counts = message => message && !message.is_system;

/**
 * The chat index at which a wait runs out, or null. Counts messages after `from`, up to the end of `chat`.
 */
export function waitTime(wait, from, chat) {
    if (wait.n === 0) return from;
    let n = 0;
    for (let i = Math.max(0, from + 1); i < (chat?.length ?? 0); i++) {
        const m = chat[i];
        if (!counts(m) || (wait.by && sideOf(m) !== wait.by)) continue;
        if (++n >= wait.n) return i;
    }
    return null;
}

/**
 * Whether a row is met.
 * @param {object} row A compiled row ({ items, waits, locks }).
 * @param {object} ctx
 * @param {object} ctx.state Story state.
 * @param {object[]} ctx.chat The chat as the generation sees it.
 * @param {{ user?: { text: string, at: number }, char?: { text: string, at: number } }} [ctx.texts]
 *   What a lock may see now. Without it, only latched locks count.
 * @param {number} [ctx.baseline] Only fires and latches from this chat index count (close rules after a Reopen).
 * @param {Set<string>} [ctx.extra] Keys counted as fired at `ctx.turnAt` (this turn's entries).
 * @param {(key: string) => boolean} [ctx.greetingOk]
 * @returns {{ met: boolean, at: number | null, armed: boolean, latches: { key: string, at: number }[] }}
 *   `latches` are the locks found in `texts` now, for the caller to write.
 */
export function rowMet(row, ctx) {
    const no = { met: false, at: null, armed: false, latches: [] };
    let at = 0;
    for (const item of row.items) {
        const t = itemTime(item, ctx);
        if (t === null) return no;
        at = Math.max(at, t);
    }
    let waitsAt = at;
    for (const wait of row.waits) {
        const t = waitTime(wait, at, ctx.chat);
        if (t === null) return no;
        waitsAt = Math.max(waitsAt, t);
    }
    const latches = [];
    let lockAt = waitsAt;
    for (const lock of row.locks) {
        const latched = ctx.state.latches?.[lock.key];
        if (latched !== undefined && (ctx.baseline === undefined || ctx.baseline === null || latched >= ctx.baseline)) {
            lockAt = Math.max(lockAt, latched);
            continue;
        }
        const seen = ['user', 'char'].filter(side => !lock.by || lock.by === side)
            .map(side => ctx.texts?.[side]).find(t => t && t.at >= waitsAt && lockFound(lock, t.text));
        if (!seen) return { ...no, armed: true, latches };
        latches.push({ key: lock.key, at: seen.at });
        lockAt = Math.max(lockAt, seen.at);
    }
    return { met: true, at: lockAt, armed: true, latches };
}

/** Whether any of the rows is met (a gate opens / a close rule closes), with the first row that is. */
export function anyRowMet(rows, ctx) {
    for (const row of rows) {
        const r = rowMet(row, ctx);
        if (r.met) return { ...r, row };
    }
    return null;
}

/** The newest user message and the newest reply in the chat: what a lock may see. */
export function newestTexts(chat) {
    const texts = {};
    for (let i = (chat?.length ?? 0) - 1; i >= 0 && !(texts.user && texts.char); i--) {
        const m = chat[i];
        if (!counts(m)) continue;
        const side = sideOf(m);
        if (!texts[side]) texts[side] = { text: m.mes ?? '', at: i };
    }
    return texts;
}
