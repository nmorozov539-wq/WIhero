// One chat turn: the state a scan uses, what may fire, settling the scan, and the snapshot after the reply.
// Pure: data in, decisions out. The ST side (src/st-hooks.js) applies them. See BUILD_SPEC 6.
import { FIELD } from './model.js';
import { anyRowMet, itemTime, newestTexts, rowMet } from './rows.js';
import { initialState, readState } from './state.js';
import { getStringHash, parseRegex } from './util.js';

const greetingOk = model => key => model.greetings?.get(key)?.ok ?? true;

/** Maps an old-build id (unique across books) to its state key. */
const keyOfId = model => {
    const map = new Map();
    for (const node of model.nodes.values()) if (!map.has(node.id)) map.set(node.id, node.key);
    return id => map.get(id);
};

/**
 * The snapshot in effect after chat[0..end-1]: the last message that carries one, or the initial state.
 * The chat's opening greeting (if any) always counts as fired at index 0.
 * @param {object} [options] { greeting: greeting key the chat opened with, or null; renamed: book renames }
 * @returns {{ state: object, index: number }} index of the message it came from, -1 for the initial state.
 */
export function baseState(chat, model, { greeting = null, renamed = {} } = {}, end = chat?.length ?? 0) {
    let state = null;
    let index = -1;
    // The old-build id map is only needed for a v1 snapshot: built on first use, once per call (review finding 8).
    let ids = null;
    const oldId = id => (ids ??= keyOfId(model))(id);
    for (let i = Math.min(end, chat?.length ?? 0) - 1; i >= 0; i--) {
        state = readState(chat[i]?.extra?.[FIELD], { at: i, keyOfId: oldId, renamed });
        if (state) { index = i; break; }
    }
    state ??= initialState();
    if (greeting && !(state.fired[greeting] > 0)) {
        state.fired[greeting] = 1;
        state.firstAt[greeting] = 0;
        state.lastAt[greeting] = 0;
    }
    return { state, index };
}

const closedBy = cl => cl.kind === 'closeGate' ? 'closeGate' : cl.kind === 'once' ? 'once' : `${cl.kind}:${cl.source}`;

/** Closes an entry in `state`, ending its hold. */
function close(state, key, at, by) {
    if (state.closed[key]) return;
    state.closed[key] = { at, by, wasHolding: !!state.holding[key] };
    delete state.holding[key];
}

/** Writes the latches of every armed lock whose phrase is in `texts`. */
function latchLocks(state, model, chat, texts) {
    const ctx = { state, chat, texts, greetingOk: greetingOk(model) };
    const write = r => { for (const l of r.latches) if (state.latches[l.key] === undefined) state.latches[l.key] = l.at; };
    for (const node of model.nodes.values()) {
        if (node.blocked || state.closed[node.key]) continue;
        for (const row of node.opens.rows) if (row.locks.length) write(rowMet(row, ctx));
        const baseline = state.baseline[node.key];
        for (const cl of node.closes) if (cl.row.locks.length) write(rowMet(cl.row, { ...ctx, baseline }));
        for (const mask of node.masks) {
            if (state.masks.closed[mask.key] !== undefined) continue;
            for (const row of [...mask.opens, ...mask.closes]) if (row.locks.length) write(rowMet(row, ctx));
        }
    }
}

/**
 * Moments (CONCEPTS 3.13) that happen now: one of the phrases is in `texts` (on its side), with its gate met. A Moment
 * happens once and stays happened; it is written as fired at the message that said it, so one said in the user
 * message counts for the reply to it, one said in a reply from the next message (as locks, D1).
 */
function happenMoments(state, model, chat, texts) {
    const ctx = { state, chat, texts, greetingOk: greetingOk(model) };
    for (const node of model.nodes.values()) {
        if (!node.moment?.rows || node.blocked || (state.fired[node.key] ?? 0) > 0) continue;
        if (!node.opens.all.every(item => itemTime(item, ctx) !== null)) continue;
        const r = anyRowMet(node.moment.rows, ctx);
        if (!r) continue;
        state.fired[node.key] = 1;
        state.firstAt[node.key] = r.at;
        state.lastAt[node.key] = r.at;
    }
}

/** Closes every entry and mask whose close rules are met in `state` (latches already written). */
function applyCloses(state, model, chat, at) {
    const ctx = { state, chat, greetingOk: greetingOk(model) };
    const closing = [];
    for (const node of model.nodes.values()) {
        if (node.blocked || state.closed[node.key]) continue;
        const baseline = state.baseline[node.key];
        const cl = node.closes.find(c => rowMet(c.row, { ...ctx, baseline }).met);
        if (cl) closing.push([node.key, closedBy(cl)]);
    }
    for (const node of model.nodes.values()) {
        for (const mask of node.masks) {
            if (state.masks.closed[mask.key] === undefined && anyRowMet(mask.closes, ctx)) state.masks.closed[mask.key] = at;
        }
    }
    // Close rules read what fired, not what is closed, so the order doesn't matter.
    for (const [key, by] of closing) close(state, key, at, by);
}

/**
 * The working state for a scan (BUILD_SPEC 6.2): the last snapshot, with locks latched against the newest user
 * message and reply (D1) and the close rules that are now met applied.
 * @param {object[]} chat The chat as this generation sees it (a swipe's replaced reply left out).
 */
export function stateForScan(chat, model, options = {}) {
    const { state } = baseState(chat, model, options);
    const texts = newestTexts(chat);
    latchLocks(state, model, chat, texts);
    happenMoments(state, model, chat, texts);
    applyCloses(state, model, chat, chat.length);
    return state;
}

/** Whether an entry's open rules are met: its gate (any row) and every Gates for aimed at it. */
export function opensMet(node, state, chat, model, extra = {}) {
    const ctx = { state, chat, greetingOk: greetingOk(model), ...extra };
    if (node.opens.rows.length && !anyRowMet(node.opens.rows, ctx)) return false;
    return node.opens.all.every(item => itemTime(item, ctx) !== null);
}

/** Whether an entry may fire now: no blocking problem, not closed, open rules met. */
export function mayFire(node, state, chat, model) {
    if (!node) return true;
    if (node.blocked || state.closed[node.key]) return false;
    return opensMet(node, state, chat, model);
}

/**
 * Whether WORLDINFO_ENTRIES_LOADED keeps an entry (BUILD_SPEC 6.3). Entries without story logic are kept.
 * @param {Set<string>} [sticky] world.uid keys ST is about to hold by sticky: a running sticky finishes.
 */
export function keepAtLoad(entry, model, state, chat, sticky) {
    const node = model.byStKey.get(`${entry.world}.${entry.uid}`);
    if (!node) return true;
    if (node.moment) return false; // it sends nothing (stored off; this covers one switched on by hand)
    if (sticky?.has(node.stKey)) return true;
    if (node.blocked || !node.key || state.closed[node.key]) return false;
    if (state.holding[node.key]) return true;
    return opensMet(node, state, chat, model);
}

/** world.uid keys of the entries that are holding and must be force-activated. */
export function holdingKeys(model, state) {
    return Object.keys(state.holding)
        .map(key => model.nodes.get(key))
        .filter(node => node && !node.blocked && !state.closed[node.key] && node.glue?.mode === 'hold')
        .map(node => node.stKey);
}

/**
 * Settles one scan (BUILD_SPEC 6.4 steps 1, 3, 4, 5), from the whole Map each time.
 * @param {object} input
 * @param {string[]} input.activated world.uid keys in the activated Map, in order.
 * @param {Set<string>} [input.byDropped] Entries Who triggers drops (step 2, worked out by the caller).
 * @param {Set<string>} [input.sticky] Entries held by sticky: closed but kept.
 * @param {object[]} input.chat The chat as the generation sees it.
 * @returns {{ drop: Set<string>, force: string[], victims: Map<string, string>, masks: Map<string, string | null> }}
 *   `drop` world.uid keys to delete from the Map, `force` riders' world.uid keys to force in,
 *   `victims` state keys closed this turn with why, `masks` the mask name (null for main) per world.uid key.
 */
export function settleScan(model, state, { activated, byDropped = new Set(), sticky = new Set(), chat }) {
    const out = { drop: new Set(), force: [], victims: new Map(), masks: new Map() };
    const at = chat.length;
    const ctx = { state, chat, greetingOk: greetingOk(model), turnAt: at };
    const nodeOf = k => model.byStKey.get(k);
    const drop = key => { if (!sticky.has(key)) out.drop.add(key); };

    for (const k of activated) if (byDropped.has(k)) out.drop.add(k);
    const present = activated.filter(k => !out.drop.has(k));
    const inMap = new Set(present.map(k => nodeOf(k)?.key).filter(Boolean));

    // 1. Switch ties: the first path in switch order stays.
    for (const sw of model.switches) {
        const [first, ...others] = sw.paths.filter(p => inMap.has(p));
        for (const p of others) {
            out.victims.set(p, `switch:${first}`);
            drop(model.nodes.get(p).stKey);
        }
    }

    // 3. Closing (D3): an entry closed this turn didn't happen.
    const T = [...inMap].filter(k => !out.victims.has(k));
    const safe = new Set();
    let undecided = new Set(T);
    const baselineOf = key => state.baseline[key];
    for (let changed = true; changed && undecided.size;) {
        changed = false;
        for (const key of [...undecided]) {
            const node = model.nodes.get(key);
            const could = new Set([...undecided, ...safe]);
            const possible = node.closes.filter(cl => rowMet(cl.row, { ...ctx, baseline: baselineOf(key), extra: could }).met);
            if (!possible.length) {
                safe.add(key);
                undecided.delete(key);
                changed = true;
                continue;
            }
            const met = possible.find(cl => rowMet(cl.row, { ...ctx, baseline: baselineOf(key), extra: safe }).met);
            if (met) {
                out.victims.set(key, closedBy(met));
                undecided.delete(key);
                changed = true;
            }
        }
    }
    // Entries still undecided close each other in a loop: they all close.
    for (const key of undecided) {
        const node = model.nodes.get(key);
        const cl = node.closes.find(c => rowMet(c.row, { ...ctx, baseline: baselineOf(key), extra: new Set([...undecided, ...safe]) }).met);
        out.victims.set(key, cl ? closedBy(cl) : 'loop');
    }
    for (const key of out.victims.keys()) drop(model.nodes.get(key).stKey);

    // 4. Ride-along: riders fire with a safe host, and only then.
    for (const k of present) {
        const node = nodeOf(k);
        if (node?.glue?.mode === 'ride' && !safe.has(node.glue.host)) drop(k);
    }
    for (const host of safe) {
        for (const r of model.riders.get(host) ?? []) {
            const rider = model.nodes.get(r);
            if (inMap.has(r) || out.victims.has(r)) continue;
            if (!mayFire(rider, state, chat, model)) continue;
            out.force.push(rider.stKey);
        }
    }

    // 5. Masks: a hand pick wins, else the last mask that is on and not closed, else main.
    for (const k of present) {
        if (out.drop.has(k)) continue;
        const node = nodeOf(k);
        if (!node?.masks?.length) continue;
        out.masks.set(k, chooseMask(node, state, chat, model, safe));
    }
    return out;
}

/** The mask an entry injects now (its name), or null for main. `safe` are this turn's entries that fire. */
export function chooseMask(node, state, chat, model, safe = new Set()) {
    const pick = state.masks.pick[node.key];
    if (pick !== undefined && pick !== null) return node.masks.some(m => m.name === pick) ? pick : null;
    const ctx = { state, chat, greetingOk: greetingOk(model), turnAt: chat.length };
    for (let i = node.masks.length - 1; i >= 0; i--) {
        const mask = node.masks[i];
        if (!mask.opens.length || state.masks.closed[mask.key] !== undefined) continue;
        if (!anyRowMet(mask.opens, ctx)) continue;
        if (anyRowMet(mask.closes, { ...ctx, extra: safe })) continue;
        return mask.name;
    }
    return null;
}

/**
 * The snapshot after a reply (BUILD_SPEC 6.6).
 * @param {object} working The state the generation scanned with (stateForScan).
 * @param {{ fired: string[], victims?: Map<string, string> | object }} pending world.uid keys that fired
 *   (WORLD_INFO_ACTIVATED; on a continue, the union with the first part), and this turn's closes.
 * @param {object[]} chat The chat up to and including the reply.
 * @param {number} mesId The reply's chat index.
 */
export function advance(working, pending, model, chat, mesId) {
    const next = structuredClone(working);
    next.at = mesId;
    next.round = [...new Set(pending.fired ?? [])];
    const victims = pending.victims instanceof Map ? pending.victims : new Map(Object.entries(pending.victims ?? {}));

    // 1. What fired. Dropped entries aren't in the list; a victim held in by its sticky is, and counts (6.5).
    const fired = [...new Set(next.round.map(k => model.byStKey.get(k)).filter(n => n?.key && !n.blocked).map(n => n.key))];
    for (const key of fired) {
        next.fired[key] = (next.fired[key] ?? 0) + 1;
        next.firstAt[key] ??= mesId;
        next.lastAt[key] = mesId;
    }
    // 2. Closes worked out in the scan.
    for (const [key, by] of victims) close(next, key, mesId, by);
    // 2b. Dice: a fork that fired for the first time picks its path now; the others close from the next message.
    rollDice(next, model, fired, chat, mesId);
    // 3. New holds.
    for (const key of fired) {
        if (model.nodes.get(key)?.glue?.mode === 'hold' && !next.closed[key] && !next.holding[key]) next.holding[key] = { since: mesId };
    }
    // 4. Locks whose phrase is in the new reply act from the next message (D1).
    const reply = chat[mesId];
    if (reply && !reply.is_user) {
        latchLocks(next, model, chat, { char: { text: reply.mes ?? '', at: mesId } });
        happenMoments(next, model, chat, { char: { text: reply.mes ?? '', at: mesId } });
    }
    // 5–6. Close rules met now (Once, this turn's fires, new latches, waits) close from the next message.
    applyCloses(next, model, chat, mesId);
    return next;
}

/**
 * Dice for switches (AFTER_V1). When a dice fork fires and its switch hasn't been decided (no roll yet, no path
 * fired or closed), one open path is picked and every other path closes. The roll is saved in `state.rolls`.
 * It is seeded by the message before the reply (its text and time) and the fork, so a swipe or a regenerate of
 * the same reply gets the same roll, and going back past that message and writing it again rolls again.
 */
export function rollDice(state, model, fired, chat, mesId) {
    for (const sw of model.switches) {
        if (!sw.dice || !fired.includes(sw.fork) || state.rolls[sw.fork]) continue;
        if (sw.paths.some(p => (state.fired[p] ?? 0) > 0 || state.closed[p])) continue;
        const open = sw.paths.filter(p => !model.nodes.get(p)?.blocked);
        if (!open.length) continue;
        const path = open[diceRoll(sw.fork, chat, mesId) % open.length];
        state.rolls[sw.fork] = { path, at: mesId };
        for (const p of sw.paths) if (p !== path) close(state, p, mesId, `dice:${path}`);
    }
}

/** The roll's number: a hash of the fork and the message before the reply. */
export function diceRoll(fork, chat, mesId) {
    const before = chat?.[mesId - 1];
    return Math.abs(getStringHash(`${fork}|${mesId}|${before?.send_date ?? ''}|${before?.mes ?? ''}`));
}

/**
 * Who triggers (BUILD_SPEC 6.4 step 2): whether one of the entry's primary keywords is in the allowed side's
 * messages within its scan depth. Matching follows ST's WorldInfoBuffer.matchKeys.
 * @param {object} entry The scan's copy of the entry.
 * @param {object[]} chat The chat as the generation sees it.
 * @param {'user' | 'char'} side
 * @param {{ depth: number, caseSensitive: boolean, matchWholeWords: boolean, parseRegexFromString?: Function }} globals
 */
export function keywordOnSide(entry, chat, side, globals) {
    const depth = Number.isInteger(entry.scanDepth) ? entry.scanDepth : globals.depth;
    if (!(depth > 0)) return false;
    const messages = (chat ?? []).filter(m => m && !m.is_system).slice(-depth).filter(m => (m.is_user ? 'user' : 'char') === side);
    const caseSensitive = entry.caseSensitive ?? globals.caseSensitive;
    const whole = entry.matchWholeWords ?? globals.matchWholeWords;
    const toRegex = globals.parseRegexFromString ?? parseRegex;
    const transform = s => caseSensitive ? s : s.toLowerCase();
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = (haystack, key) => {
        const regex = toRegex(key);
        if (regex) { regex.lastIndex = 0; return regex.test(haystack); }
        const h = transform(haystack);
        const k = transform(key);
        if (!whole || k.split(/\s+/).length > 1) return h.includes(k);
        return new RegExp(`(?:^|\\W)(${escape(k)})(?:$|\\W)`).test(h);
    };
    return (entry.key ?? []).filter(k => typeof k === 'string' && k.trim()).some(key => messages.some(m => match(m.mes ?? '', key.trim())));
}

/**
 * What the panel shows for an entry now.
 * @returns {{ status: 'blocked' | 'closed' | 'holding' | 'open' | 'waiting', text: string, mask: string | null }}
 */
export function entryStatus(node, state, chat, model) {
    if (node.moment) {
        if (node.blocked) return { status: 'blocked', text: 'has a problem', mask: null };
        return (state.fired[node.key] ?? 0) > 0 ? { status: 'happened', text: 'happened', mask: null } : { status: 'waiting', text: 'not yet', mask: null };
    }
    const mask = node.masks?.length && !node.blocked ? chooseMask(node, state, chat, model) : null;
    if (node.blocked) return { status: 'blocked', text: 'has a problem', mask: null };
    const closed = state.closed[node.key];
    if (closed) return { status: 'closed', text: `closed (${closed.by})`, mask };
    if (state.holding[node.key]) return { status: 'holding', text: 'holding', mask };
    if (opensMet(node, state, chat, model)) return { status: 'open', text: node.opens.rows.length || node.opens.all.length ? 'gate open' : 'open', mask };
    return { status: 'waiting', text: 'waiting', mask };
}
