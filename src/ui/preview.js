// Preview (CONCEPTS 7, LAYOUT "Preview tab"): one pretend exchange checked against a book, nothing saved.
// Every rule is the real engine's (D13): the turn runs through stateForScan, keepAtLoad, settleScan and advance
// exactly as a chat does. Only keyword matching is our own, since ST's scan doesn't run here (BUILD_SPEC 10).
// Pure: no DOM, no SillyTavern.
import { advance, baseState, chooseMask, holdingKeys, keepAtLoad, keywordOnSide, opensMet, settleScan, stateForScan } from '../engine/turn.js';
import { itemTime, rowMet, waitTime } from '../engine/rows.js';
import { FIELD } from '../engine/model.js';
import { parseRegex, phraseMatcher } from '../engine/util.js';
import { and, closedText, wording } from './logic-text.js';

const stKeyOf = e => `${e.world}.${e.uid}`;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const counted = m => m && !m.is_system;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const has = list => list.length === 1 && !/^(any|all|\d+) of/.test(list[0]) ? 'has' : 'have';
// ST's selectiveLogic: AND_ANY, NOT_ALL, NOT_ANY, AND_ALL.
const SECONDARY = ['and any', 'not all', 'not any', 'and all'];

/**
 * Where an entry's keyword appears in `text`, as ST would match it (WorldInfoBuffer.matchKeys), with positions.
 * @returns {{ a: number, b: number, k: string }[]}
 */
export function keyHits(entry, text, globals = {}, keys = entry.key) {
    const out = [];
    if (!text) return out;
    const caseSensitive = entry.caseSensitive ?? globals.caseSensitive ?? false;
    const whole = entry.matchWholeWords ?? globals.matchWholeWords ?? false;
    const toRegex = globals.parseRegexFromString ?? parseRegex;
    for (const raw of keys ?? []) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const k = raw.trim();
        let re = toRegex(k);
        if (re) re = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
        else {
            const flags = caseSensitive ? 'gu' : 'giu';
            re = whole && k.split(/\s+/).length === 1 ? new RegExp(`(?<=^|\\W)${escape(k)}(?=$|\\W)`, flags) : new RegExp(escape(k), flags);
        }
        for (let m; (m = re.exec(text));) {
            if (!m[0]) { re.lastIndex++; continue; }
            out.push({ a: m.index, b: m.index + m[0].length, k });
        }
    }
    return out;
}

/** Where a lock phrase appears in `text` (whole words, any case, as the engine's phraseMatcher). */
function phraseHits(phrase, text) {
    const out = [];
    if (!text || !phraseMatcher(phrase)(text)) return out;
    const regex = parseRegex(phrase);
    const re = regex ? new RegExp(regex.source, `${regex.flags.replace('g', '')}g`) : new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${escape(phrase.trim())}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    for (let m; (m = re.exec(text));) {
        if (!m[0]) { re.lastIndex++; continue; }
        out.push({ a: m.index, b: m.index + m[0].length });
    }
    return out;
}

/** The messages an entry's scan sees: the last `depth` counted messages, with their chat indexes. */
function scanWindow(entry, chat, globals) {
    const depth = Number.isInteger(entry.scanDepth) ? entry.scanDepth : (globals.depth ?? 2);
    if (!(depth > 0)) return [];
    return chat.map((m, i) => ({ m, i })).filter(x => counted(x.m)).slice(-depth);
}

/** Whether an entry's secondary keywords pass (ST's selective logic), over the scan window's text. */
function secondaryOk(entry, text, globals) {
    const second = (entry.keysecondary ?? []).filter(k => typeof k === 'string' && k.trim());
    if (!entry.selective || !second.length) return true;
    const found = second.map(k => keyHits(entry, text, globals, [k]).length > 0);
    switch (entry.selectiveLogic ?? 0) {
        case 1: return !found.every(Boolean);
        case 2: return !found.some(Boolean);
        case 3: return found.every(Boolean);
        default: return found.some(Boolean);
    }
}

/** Words for one model: names, pack readings, rows. */
function namer(model) {
    const label = key => {
        if (key?.startsWith('@')) {
            const g = model.greetings?.get(key);
            if (!g) return 'a greeting';
            return `${g.ref.name || g.ref.char}'s ${g.ref.greeting === 0 ? 'Greeting' : `Alt ${g.ref.greeting}`}`;
        }
        return model.nodes.get(key)?.label ?? null;
    };
    const item = i => {
        if (i.type === 'pack') return `${i.mode === 'all' ? 'all' : i.mode === 'any' ? 'any' : i.mode} of #${i.name}`;
        return label(i.key) ?? i.key;
    };
    const phrases = lock => and(lock.phrases.map(p => `"${p}"`), 'or');
    return { label: k => label(k) ?? k, item, phrases };
}

/** Messages counted towards a wait after chat index `from`. */
function waited(wait, from, chat) {
    let n = 0;
    for (let i = Math.max(0, from + 1); i < chat.length; i++) {
        const m = chat[i];
        if (!counted(m) || (wait.by && (m.is_user ? 'user' : 'char') !== wait.by)) continue;
        n++;
    }
    return n;
}

/**
 * Why a row isn't met: the stage it stops at (0 items, 1 waits, 2 locks) and the words for it.
 * `what` is 'gate', 'close gate' or 'mask' (for the lock wording).
 */
function rowWhy(row, ctx, words, what = 'gate') {
    const missing = row.items.filter(i => itemTime(i, ctx) === null).map(words.item);
    if (missing.length) {
        const text = row.locks.length
            ? `its lock isn't armed yet: it arms once ${and(missing)} ${has(missing)} fired`
            : `its ${what} is waiting for ${and(missing)}`;
        return { stage: 0, missing, text };
    }
    let at = 0;
    for (const i of row.items) at = Math.max(at, itemTime(i, ctx));
    for (const wait of row.waits) {
        if (waitTime(wait, at, ctx.chat) === null) {
            const left = wait.n - waited(wait, at, ctx.chat);
            const who = wait.by === 'user' ? ' of yours' : wait.by === 'char' ? ' from the character' : '';
            return { stage: 1, text: `its wait hasn't run out: ${plural(left, 'more message')}${who}` };
        }
    }
    const lock = row.locks.find(l => ctx.state.latches?.[l.key] === undefined || (ctx.baseline != null && ctx.state.latches[l.key] < ctx.baseline));
    if (lock) return { stage: 2, text: `its lock is armed and waiting for ${words.phrases(lock)}` };
    return null;
}

/** Why an entry with story logic isn't let in at load (keepAtLoad said no). */
function blockedWhy(node, state, chat, model, words, issues) {
    if (node.blocked || !node.key) {
        const issue = issues.find(i => i.stKey === node.stKey && !i.warning && i.blocking !== false);
        return issue ? `it has a problem: ${issue.message}` : 'it has a problem';
    }
    const closed = state.closed[node.key];
    if (closed) {
        if (closed.at >= chat.length) {
            const cl = node.closes.find(c => c.kind === 'closeGate' && rowMet(c.row, { state, chat, baseline: state.baseline[node.key] }).met);
            return cl ? `its close gate is met (${wording(node, model).rowText(cl.row.raw)})` : 'its close gate is met';
        }
        if (closed.by === 'once') return 'it fires once, and it already fired';
        return `it was closed earlier in the chat, by ${closedText(closed.by, words.label)}`;
    }
    const ctx = { state, chat, greetingOk: key => model.greetings?.get(key)?.ok ?? true };
    for (const i of node.opens.all) {
        if (itemTime(i, ctx) !== null) continue;
        if (i.type === 'greeting') return `it only opens in a chat that started at ${words.label(i.key)}`;
        return `${words.label(i.source)} holds it back until it has fired`;
    }
    let best = null;
    for (const row of node.opens.rows) {
        const why = rowWhy(row, ctx, words);
        if (why && (!best || why.stage > best.stage)) best = why;
    }
    return best?.text ?? 'its gate is closed';
}

/**
 * One scan, as ST and WI Hero run it for a generation over `chat` (ending with the user's message).
 * @returns {{ state, results: Map, fired: string[], victims: Map, masks: Map }}
 *   `results` by world.uid: { stKey, uid, key, title, how, status: 'fires'|'blocked'|'maybe', why, phrase, at, mask }
 */
function scanTurn({ entries, model, chat, opts, globals, words, current = chat.length - 1 }) {
    const state = stateForScan(chat, model, opts);
    const results = new Map();
    const activated = [];
    const byKey = new Map(entries.map(e => [stKeyOf(e), e]));
    const set = (entry, r) => {
        const node = model.byStKey.get(stKeyOf(entry));
        results.set(stKeyOf(entry), { stKey: stKeyOf(entry), uid: entry.uid, key: node?.key ?? null, title: entry.comment || entry.key?.[0] || `uid ${entry.uid}`, logic: !!node, ...r });
    };

    for (const entry of entries) {
        const k = stKeyOf(entry);
        const node = model.byStKey.get(k);
        const window = scanWindow(entry, chat, globals);
        const text = window.map(x => x.m.mes ?? '').join('\n');
        let match = null;
        if (!entry.constant) {
            for (let j = window.length - 1; j >= 0 && !match; j--) {
                const h = keyHits(entry, window[j].m.mes ?? '', globals);
                if (h.length) match = { at: window[j].i, k: h[0].k, seen: window.filter(x => keyHits(entry, x.m.mes ?? '', globals).length).map(x => x.i) };
            }
        }
        const how = entry.constant ? 'permanent' : match ? 'keyword' : entry.vectorized ? 'vector' : null;
        if (!how) continue;
        const base = { how, phrase: match?.k ?? null, at: match?.at ?? null, seen: match?.seen ?? [] };
        if (entry.disable) {
            if (how === 'keyword') set(entry, { ...base, status: 'blocked', why: 'the entry is turned off' });
            continue;
        }
        if (how === 'keyword' && !secondaryOk(entry, text, globals)) {
            set(entry, { ...base, status: 'blocked', why: `its secondary keywords aren't met (${SECONDARY[entry.selectiveLogic ?? 0] ?? 'and any'})` });
            continue;
        }
        if (!keepAtLoad(entry, model, state, chat)) {
            set(entry, { ...base, status: 'blocked', why: blockedWhy(node, state, chat, model, words, model.issues) });
            continue;
        }
        if (how === 'vector') {
            set(entry, { ...base, status: 'maybe', why: 'vector matches can\'t be checked here; if it matches, its story logic lets it fire' });
            continue;
        }
        const where = how === 'permanent' ? 'permanent, always on' : match.seen.includes(current) ? `key word "${match.k}"` : `key word "${match.k}" in an earlier message`;
        set(entry, { ...base, status: 'fires', why: where });
        activated.push(k);
    }
    // Glue that holds is forced on before the scan (BUILD_SPEC 6.2).
    for (const k of holdingKeys(model, state)) {
        const entry = byKey.get(k);
        if (!entry || entry.disable || activated.includes(k)) continue;
        activated.push(k);
        set(entry, { how: 'hold', phrase: null, at: null, seen: [], status: 'fires', why: 'it holds: on since it fired earlier' });
    }
    // Who triggers (6.4 step 2): the engine's own check, on ST's match. Permanent and glue are exempt.
    const byDropped = new Set();
    for (const k of activated) {
        const node = model.byStKey.get(k);
        const r = results.get(k);
        if (!node?.by || r.how !== 'keyword') continue;
        if (!keywordOnSide(byKey.get(k), chat, node.by, globals)) byDropped.add(k);
    }
    // Settle after every scan loop, from the whole Map, forcing riders in for one more pass (6.4).
    const map = new Set(activated);
    const victims = new Map();
    let masks = new Map();
    for (let pass = 0; pass < 5; pass++) {
        const out = settleScan(model, state, { activated: [...map], byDropped, chat });
        for (const [key, by] of out.victims) victims.set(key, by);
        masks = out.masks;
        for (const k of out.drop) {
            map.delete(k);
            const node = model.byStKey.get(k);
            const r = results.get(k);
            let why;
            if (byDropped.has(k)) why = node.by === 'user' ? 'only your messages trigger it, and this was in the reply' : 'only the character\'s replies trigger it, and this was in your message';
            else if (out.victims.has(node.key)) {
                const by = out.victims.get(node.key);
                const m = /^(switch|closesFor):(.+)$/.exec(by);
                if (m?.[1] === 'switch') {
                    const sw = model.switches.find(s => s.paths.includes(node.key));
                    why = `${words.label(sw?.fork)}'s switch already picked ${words.label(m[2])}`;
                } else if (m) why = `${words.label(m[2])} closes it this turn, and closing beats opening`;
                else if (by === 'loop') why = 'it and other entries close each other this turn, so they all close';
                else why = 'its close gate is met this turn, and closing beats opening';
            } else if (node?.glue?.mode === 'ride') why = `it only rides along with ${words.label(node.glue.host)}, and that doesn't fire`;
            else why = 'it is dropped this turn';
            Object.assign(r, { status: 'blocked', why });
        }
        const forced = out.force.filter(k => byKey.get(k) && !byKey.get(k).disable && !map.has(k));
        if (!forced.length) break;
        for (const k of forced) {
            map.add(k);
            const node = model.byStKey.get(k);
            set(byKey.get(k), { how: 'ride', phrase: null, at: null, seen: [], status: 'fires', why: `it rides along with ${words.label(node.glue.host)}` });
        }
    }
    for (const [k, name] of masks) {
        const r = results.get(k);
        if (r?.status === 'fires' && name) r.mask = name;
    }
    return { state, results, fired: [...map], victims, masks };
}

/**
 * One generation's scan simulated over `chat` (ending with the user's message), as Preview runs it: what fires, what
 * closed this turn, and the masks. Catch-up (src/catch-up.js) replays skipped turns with it.
 * @returns {{ state: object, fired: string[], victims: Map<string, string>, masks: Map<string, string | null> }}
 */
export function simulateTurn({ entries, model, chat, opts = {}, globals = {} }) {
    const g = { depth: 2, caseSensitive: false, matchWholeWords: false, ...globals };
    const t = scanTurn({ entries, model, chat, opts, globals: g, words: namer(model) });
    return { state: t.state, fired: t.fired, victims: t.victims, masks: t.masks };
}

/** Every lock phrase of the loaded rules: { node, row, lock, what: 'gate'|'close gate'|'mask', mask }. */
function locksOf(model) {
    const out = [];
    for (const node of model.nodes.values()) {
        if (node.blocked) continue;
        for (const row of node.opens.rows) for (const lock of row.locks) out.push({ node, row, lock, what: 'gate' });
        for (const cl of node.closes) for (const lock of cl.row.locks) out.push({ node, row: cl.row, lock, what: 'close gate' });
        for (const mask of node.masks) {
            for (const row of mask.opens) for (const lock of row.locks) out.push({ node, row, lock, what: 'mask', mask: mask.name });
            for (const row of mask.closes) for (const lock of row.locks) out.push({ node, row, lock, what: 'mask close gate', mask: mask.name });
        }
    }
    return out;
}

/**
 * Runs one pretend exchange.
 * @param {object} input
 * @param {object[]} input.entries The book's entries, each with `world`.
 * @param {object} input.model buildModel of those entries.
 * @param {object[]} input.base The chat before the pretend user message (the open chat, a greeting, or nothing).
 * @param {string|null} [input.greeting] Greeting key the chat opened with.
 * @param {object} [input.renamed] Book renames, for old snapshots.
 * @param {string} input.user The pretend user message.
 * @param {string} input.reply The pretend reply.
 * @param {object} [input.globals] { depth, caseSensitive, matchWholeWords, parseRegexFromString }
 * @returns {object} { start, results, hits, also, changes, next, counts }
 */
export function runPreview({ entries, model, base = [], greeting = null, renamed = {}, user = '', reply = '', globals = {} }) {
    const words = namer(model);
    const opts = { greeting, renamed };
    globals = { depth: 2, caseSensitive: false, matchWholeWords: false, ...globals };
    const chatGen = [...base, { is_user: true, name: 'You', mes: user }];
    const userAt = chatGen.length - 1;
    const replyAt = chatGen.length;
    const t1 = scanTurn({ entries, model, chat: chatGen, opts, globals, words });
    const working = t1.state;

    // The reply, and the snapshot it would carry (BUILD_SPEC 6.6).
    const replyMsg = { is_user: false, name: 'Character', mes: reply };
    const chatFull = [...chatGen, replyMsg];
    const next = advance(working, { fired: t1.fired, victims: t1.victims }, model, chatFull, replyAt);
    replyMsg.extra = { [FIELD]: next };
    // The next generation's scan sees the reply: its key words count from the next message, like its locks (D1).
    const t2 = scanTurn({ entries, model, chat: [...chatFull, { is_user: true, name: 'You', mes: '' }], opts, globals, words, current: replyAt });
    const fromReply = new Map([...t2.results].filter(([, r]) => r.how === 'keyword' && r.seen.includes(replyAt)));

    const results = t1.results;
    const firedKeys = new Set(t1.fired.map(k => model.byStKey.get(k)?.key).filter(Boolean));
    const byState = key => [...model.byStKey.values()].find(n => n.key === key)?.stKey;

    // Would change, each with the entry that caused it.
    const changes = [];
    const change = (family, text, key, when, cause = key) => changes.push({ family, text, key, stKey: byState(key), when, cause });
    for (const [key, c] of Object.entries(next.closed)) {
        if (working.closed[key]) continue;
        const name = words.label(key);
        const m = /^(switch|closesFor):(.+)$/.exec(c.by);
        const thisTurn = t1.victims.has(key);
        const when = thisTurn ? 'This turn' : 'From the next message';
        if (m) change('close', `${name} closes for good, closed by ${words.label(m[2])}`, key, when, m[2]);
        else if (c.by === 'once') change('close', `${name} closes after this: it fires once`, key, when);
        else change('close', `${name} closes: its close gate is met`, key, when);
    }
    for (const key of Object.keys(next.holding)) {
        if (working.holding[key]) continue;
        const node = model.nodes.get(key);
        const ends = node.closes.filter(cl => cl.kind === 'closeGate').map(cl => wording(node, model).rowText(cl.row.raw));
        change('glue', `${words.label(key)} holds: it stays on${ends.length ? ` until ${ends.join(' or ')}` : ''}`, key, 'From the next message');
    }
    const gctx = (state, chat) => ({ state, chat, greetingOk: k => model.greetings?.get(k)?.ok ?? true });
    for (const node of model.nodes.values()) {
        if (node.blocked || next.closed[node.key] || !(node.opens.rows.length || node.opens.all.length)) continue;
        const before = opensMet(node, working, chatGen, model);
        const after = opensMet(node, next, chatFull, model);
        const opener = rows => {
            const row = rows.find(r => rowMet(r, gctx(next, chatFull)).met);
            return row?.items.flatMap(i => i.type === 'pack' ? i.keys : [i.key]).find(k => firedKeys.has(k)) ?? node.key;
        };
        if (!before && after) {
            const latched = node.opens.rows.some(r => r.locks.some(l => next.latches[l.key] !== undefined && working.latches[l.key] === undefined));
            change('open', latched ? `The lock on ${node.label}'s gate opens from the next message` : `${node.label}'s gate opens from the next message`, node.key, 'From the next message', opener(node.opens.rows));
            continue;
        }
        if (after) continue;
        const armedNow = node.opens.rows.find(r => r.locks.length && !rowMet(r, gctx(working, chatGen)).armed && rowMet(r, gctx(next, chatFull)).armed);
        if (armedNow) {
            const lock = armedNow.locks.find(l => next.latches[l.key] === undefined);
            change('open', `${node.label}'s lock is armed from the next message, waiting for ${words.phrases(lock ?? armedNow.locks[0])}`, node.key, 'From the next message', opener([armedNow]) === node.key ? null : opener([armedNow]));
        }
    }
    for (const node of model.nodes.values()) {
        if (node.blocked || !node.masks.length || next.closed[node.key]) continue;
        const was = chooseMask(node, working, chatGen, model, firedKeys);
        const now = chooseMask(node, next, chatFull, model);
        if (was === now) continue;
        change('mask', now ? `${node.label} switches to its "${now}" mask` : `${node.label} goes back to its main text`, node.key, 'From the next message', null);
    }
    for (const r of fromReply.values()) {
        if (r.status !== 'fires') continue;
        change('fire', `${r.title} fires on the next message: key word "${r.phrase}" is in the reply`, r.key, 'From the next message', null);
        if (!r.key) changes.at(-1).stKey = r.stKey;
    }

    // Highlights: key words, and lock phrases.
    const hits = { user: [], reply: [] };
    const textOf = { user, reply };
    for (const entry of entries) {
        const k = stKeyOf(entry);
        const r1 = results.get(k);
        if (r1?.how === 'keyword' && r1.seen.includes(userAt)) {
            for (const h of keyHits(entry, user, globals)) hits.user.push({ ...h, stKey: k, ok: r1.status === 'fires' });
        }
        const r2 = fromReply.get(k);
        if (r2) for (const h of keyHits(entry, reply, globals)) hits.reply.push({ ...h, stKey: k, ok: r2.status === 'fires', next: r2 });
    }
    const nameOfLock = (x) => x.what === 'gate' ? `${x.node.label}'s gate` : x.what === 'close gate' ? `${x.node.label}'s close gate` : x.what === 'mask' ? `${x.node.label}'s "${x.mask}" mask` : `the close gate of ${x.node.label}'s "${x.mask}" mask`;
    const verb = x => x.what === 'close gate' || x.what === 'mask close gate' ? `meets ${nameOfLock(x)}` : `opens the lock on ${nameOfLock(x)}`;
    const { state: before } = baseState(chatGen, model, opts);
    for (const x of locksOf(model)) {
        const close = x.what.includes('close');
        for (const side of ['user', 'reply']) {
            for (const phrase of x.lock.phrases) {
                const found = phraseHits(phrase, textOf[side]);
                if (!found.length) continue;
                const sideOk = !x.lock.by || x.lock.by === (side === 'user' ? 'user' : 'char');
                const state = side === 'user' ? working : next;
                const latched = state.latches[x.lock.key] !== undefined;
                let ok = false;
                let why;
                if (before.latches[x.lock.key] !== undefined) why = `already ${verb(x).replace(/^opens/, 'opened').replace(/^meets/, 'met')} earlier in the chat`;
                else if (x.node.key && state.closed[x.node.key] && !close) why = `${x.node.label} is closed, so its lock doesn't count`;
                else if (!sideOk) why = x.lock.by === 'user' ? 'only your words open this lock, and this was in the reply' : 'only the character\'s words open this lock, and this was in your message';
                else if (latched) { ok = true; why = side === 'user' ? verb(x) : `${verb(x)} from the next message`; }
                else {
                    const why0 = rowWhy(x.row, { ...gctx(working, chatGen), baseline: close ? working.baseline[x.node.key] : undefined }, words, x.what);
                    why = why0?.stage === 0 ? `the lock on ${nameOfLock(x)} isn't armed yet: it arms once ${and(why0.missing)} ${has(why0.missing)} fired`
                        : why0?.stage === 1 ? `the lock on ${nameOfLock(x)} isn't armed yet: ${why0.text}`
                            : `the lock on ${nameOfLock(x)} doesn't open`;
                }
                for (const h of found) hits[side].push({ ...h, stKey: x.node.stKey, lock: phrase, close, ok, why });
            }
        }
    }

    // Also active: permanent, vector and glue entries, which no phrase points at; and matches in earlier messages.
    const also = [...results.values()].filter(r => r.how === 'permanent' || r.how === 'vector' || r.how === 'hold' || r.how === 'ride'
        || (r.how === 'keyword' && !r.seen.includes(userAt))).map(r => r.stKey);

    // What each fired entry also changes (for its explanation).
    for (const r of results.values()) r.changes = r.key && r.status === 'fires' ? changes.filter(c => c.cause === r.key) : [];

    const start = {
        fired: Object.keys(working.fired).filter(k => working.fired[k] > 0 && model.nodes.has(k)).map(words.label),
        closed: Object.entries(working.closed).filter(([k, c]) => c.at < chatGen.length && model.nodes.has(k)).map(([k]) => words.label(k)),
        greeting: greeting ? words.label(greeting) : null,
    };
    const list = [...results.values()];
    const counts = { fire: list.filter(r => r.status === 'fires').length, blocked: list.filter(r => r.status === 'blocked').length, changes: changes.length };
    return { start, results, hits, also, changes, next, fromReply, counts, working };
}

/** The sentence an explanation sheet opens with. */
export function explain(result, phrase, { next = false } = {}) {
    if (!result) return null;
    const lead = (phrase ? `"${phrase}": ` : '') + (next ? 'it is in the reply, so it counts from the next message. Then ' : '');
    if (result.status === 'fires') return `${lead}${result.title} fires (${result.why}${result.mask ? `, with its "${result.mask}" mask` : ''}).`;
    if (result.status === 'maybe') return `${lead}${result.title} may fire: ${result.why}.`;
    return `${lead}${result.title} doesn't fire, because ${result.why}.`;
}
