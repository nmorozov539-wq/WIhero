// The ST side of one turn (BUILD_SPEC 6): reads ST's events, calls the engine, applies its decisions to ST's
// entry lists and activated Map. SillyTavern is reached only through `ctx()` and the `st` functions passed in,
// so this can be tested with a stand-in.
import { buildModel, FIELD, stKey } from './engine/model.js';
import { advance, baseState, rereadReply, slotOpen, slotValues, entryStatus, holdingKeys, keepAtLoad, keywordOnSide, settleScan, stateForScan } from './engine/turn.js';
import { pickMask, reopen, setSlot } from './engine/manual.js';
import { readState } from './engine/state.js';
import { instruction } from './engine/written.js';

/** The key of WI Hero's one extension prompt: the trackers' instruction (TRACKERS 3.2). */
export const TEACH_KEY = 'wihero_trackers';
import { greetingFpOf, greetingSignature, openingGreeting, writeSnapshot } from './chat-state.js';
import { isCounted, scanChat } from './generation.js';
import { entryHash, scanLength, stickyHeld } from './timers.js';
import { probeEntriesLoaded, probeScanDone } from './compat.js';
import { findGap, resolveGap } from './catch-up.js';

/** Where the entries sent with a reply are kept: message.extra.wiheroSent, and on its swipe (the chat bubble). */
export const SENT_FIELD = 'wiheroSent';

/** Takes WI Hero's snapshot off a message and its current swipe. */
export function dropSnapshot(message) {
    if (message.extra) delete message.extra[FIELD];
    const swipe = message.swipe_info?.[message.swipe_id ?? 0];
    if (swipe?.extra) delete swipe.extra[FIELD];
}

/** Stores what was sent with a reply on the message and its current swipe. */
export function writeSent(message, sent) {
    message.extra ??= {};
    message.extra[SENT_FIELD] = sent;
    const swipe = message.swipe_info?.[message.swipe_id ?? 0];
    if (swipe) {
        swipe.extra ??= {};
        swipe.extra[SENT_FIELD] = sent;
    }
}

/**
 * @param {object} deps
 * @param {() => object} deps.ctx SillyTavern.getContext
 * @param {object} deps.st { getSortedEntries, getStringHash, parseRegexFromString, scan_state, globals() }
 * @param {object} deps.settings extension_settings.wihero
 * @param {() => void} [deps.onChange] Called when the panel should refresh.
 * @param {object} [deps.health] src/compat.js createHealth(): runtime problems stand the engine down.
 * @param {() => void} [deps.saveSettings] Saves extension_settings (a rename left behind by a new book is dropped).
 */
export function createHooks({ ctx, st, settings, onChange = () => {}, health = null, saveSettings = () => {} }) {
    /** Whether the engine runs: switched on, and SillyTavern still has everything it needs (BUILD_SPEC 17.2). */
    const active = () => settings.enabled && (health?.ok ?? true);
    /** Model of the books ST loaded last, and its signature to skip rebuilding. */
    let model = buildModel([]);
    let signature = '';
    /** The entries ST loaded last, before any were removed, and their ST hashes by world.uid. */
    let loaded = [];
    let hashes = new Map();
    let hashWarned = false;
    /**
     * The generation in progress (BUILD_SPEC 6.7): { type, uncounted, working, chat, sticky, forced, victims, fired }.
     * Dry runs never create one; only a counted one is written as a snapshot.
     */
    let pending = null;
    /** Base content of the scan's copies whose content a mask replaced, so a later pass can restore it. */
    const baseContent = new WeakMap();

    const character = () => {
        const c = ctx();
        if (c.groupId) return null;
        return c.characters?.[c.characterId] ?? null;
    };
    const stateOptions = chat => ({ greeting: openingGreeting(chat, character()), renamed: settings.renamed ?? {} });
    const greetingFp = greetingFpOf(() => ctx().characters, st.getStringHash);

    function rebuild(entries) {
        // A loaded book under a name a rename left behind is a new book: its state is its own (review finding 2).
        let dropped = false;
        for (const book of new Set(entries.map(e => e.world))) {
            if (settings.renamed && Object.hasOwn(settings.renamed, book)) { delete settings.renamed[book]; dropped = true; }
        }
        if (dropped) saveSettings();
        // Compare the same complete inputs buildModel receives, including ordinary ST fields.
        const sig = JSON.stringify(entries) + `\n${greetingSignature(character(), st.getStringHash)}`;
        if (sig === signature) return;
        signature = sig;
        model = buildModel(entries, { greetingFp });
    }

    const sticky = (chat, type) => {
        const timed = ctx().chatMetadata?.timedWorldInfo;
        return new Set(stickyHeld(loaded, timed, scanLength(chat, type), e => hashes.get(stKey(e))).keys());
    };

    // 6.1
    function onGenerationStarted(type, _options, dryRun) {
        if (dryRun) return;
        // An uncounted generation (quiet, impersonate) still gets the rules; it just never writes a snapshot.
        pending = { type, uncounted: !isCounted(type), working: null, chat: null, sticky: new Set(), forced: new Set(), victims: new Map(), fired: [], sent: [], masks: new Map() };
    }

    /**
     * The trackers' instruction (TRACKERS 3.2): one system message in the chat at the books' depth, built from the
     * open slots of every book in WI Hero's own mode. Cleared when there is nothing to teach.
     */
    function teach(chat, type) {
        const c = ctx();
        if (typeof c.setExtensionPrompt !== 'function') return;
        // Only for replies that land in the chat: a quiet generation (/gen, a summary, an image prompt) or an
        // impersonation would otherwise write tracker lines into text that isn't a reply.
        const books = active() && isCounted(type) ? [...(model.trackers?.values() ?? [])].filter(t => t.teach.on && t.reader) : [];
        let text = '';
        let depth = Infinity;
        if (books.length) {
            const state = stateForScan(chat, model, stateOptions(chat));
            const values = slotValues(model, state, chat);
            const parts = [];
            for (const t of books) {
                const open = t.slots.filter(sl => !sl.bad && slotOpen(sl, state, chat, model));
                const part = instruction(t, open, values);
                if (part) { parts.push(part); depth = Math.min(depth, t.teach.depth); }
            }
            text = parts.join('\n\n');
        }
        c.setExtensionPrompt(TEACH_KEY, text, 1, Number.isFinite(depth) ? depth : 1, false, 0);
    }

    /**
     * ST's generate interceptor (TRACKERS 3.3): in WI Hero's own mode, tracker lines are taken out of the messages
     * the prompt is built from, so the model reads each value once, from its entry. ST's list holds the chat's own
     * message objects: changed ones are replaced by copies, never edited. A continue keeps the message it continues.
     */
    function stripPrompt(list, type) {
        if (!active() || !Array.isArray(list)) return;
        const books = [...(model.trackers?.values() ?? [])].filter(t => t.teach.on && t.reader);
        if (!books.length) return;
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || typeof m.mes !== 'string' || (type === 'continue' && i === list.length - 1)) continue;
            let mes = m.mes;
            for (const t of books) mes = t.reader.strip(mes);
            if (mes !== m.mes.trim()) list[i] = { ...m, mes };
        }
    }

    // 6.2, glue: force-activate holds before the scan. ST clears forced entries after every scan.
    async function onAfterCommands(type, _options, dryRun) {
        if (dryRun) return;
        try { teach(scanChat(ctx().chat ?? [], type), type); } catch (e) { console.error('[WI Hero] Could not build the trackers\' instruction', e); }
        if (!active()) return;
        const entries = await st.getSortedEntries();
        if (!hashWarned && entries.some(e => hashes.has(stKey(e)) && hashes.get(stKey(e)) !== e.hash)) {
            hashWarned = true;
            console.warn('[WI Hero] Entry hashes differ from SillyTavern\'s; sticky entries may be cut short when they close.');
        }
        const chat = scanChat(ctx().chat ?? [], type);
        const keys = new Set(holdingKeys(model, stateForScan(chat, model, stateOptions(chat))));
        const holds = entries.filter(e => keys.has(stKey(e)) && !e.disable);
        if (pending) for (const e of holds) pending.forced.add(stKey(e));
        if (holds.length) await ctx().eventSource.emit(ctx().eventTypes.WORLDINFO_FORCE_ACTIVATE, holds);
    }

    // 6.3: only ever remove entries, never edit them (ST hashes them right after this event).
    function onEntriesLoaded(lore) {
        const bad = probeEntriesLoaded(lore);
        if (bad) { health?.fail(bad); return; }
        // Our own read of the books (loadModel) must keep them all. But a generation's read can land while ours is
        // waiting, and the two can't be told apart: with a generation pending, the event is handled as usual and
        // loadModel takes the books from `loaded`, as they were before anything was removed (review finding 4).
        if (selfLoading && !pending) return;
        if (selfLoading) selfSpliced = true;
        loaded = Object.values(lore ?? {}).filter(Array.isArray).flat();
        hashes = new Map(loaded.map(e => [stKey(e), entryHash(e, st.getStringHash)]));
        rebuild(loaded);
        if (!active()) return onChange();
        const chat = scanChat(ctx().chat ?? [], pending?.type);
        const working = stateForScan(chat, model, stateOptions(chat));
        // ST skips timed effects on dry runs, and a dry run never has a pending turn.
        const held = pending ? sticky(chat, pending.type) : new Set();
        if (pending) Object.assign(pending, { working, chat, sticky: held });
        for (const list of Object.values(lore ?? {})) {
            if (!Array.isArray(list)) continue;
            for (let i = list.length - 1; i >= 0; i--) {
                if (!keepAtLoad(list[i], model, working, chat, held)) list.splice(i, 1);
            }
        }
        onChange();
    }

    // 6.4: settle the turn after every scan loop, from the whole Map each time.
    async function onScanDone(args) {
        if (!active()) return;
        const bad = probeScanDone(args);
        if (bad) { health?.fail(bad); return; }
        const map = args.activated.entries;
        const chat = pending?.chat ?? scanChat(ctx().chat ?? [], pending?.type);
        const working = pending?.working ?? stateForScan(chat, model, stateOptions(chat));
        const held = pending?.sticky ?? new Set();
        const forced = pending?.forced ?? new Set();
        const globals = st.globals();
        // 2. Who triggers: a filter on ST's own match. Sticky, glue and Permanent entries are exempt.
        const byDropped = new Set();
        for (const [k, entry] of map) {
            const node = model.byStKey.get(k);
            if (!node?.by || entry.constant || held.has(k) || forced.has(k)) continue;
            if (!keywordOnSide(entry, chat, node.by, { ...globals, parseRegexFromString: st.parseRegexFromString })) byDropped.add(k);
        }
        const out = settleScan(model, working, { activated: [...map.keys()], byDropped, sticky: held, chat });
        for (const k of out.drop) map.delete(k);
        if (pending) { pending.victims = out.victims; pending.masks = out.masks; pending.text = out.text; }
        // 4. Ride-along: force the riders in and ask ST for one more pass.
        const riders = out.force.map(k => args.sortedEntries?.find?.(e => stKey(e) === k)).filter(e => e && !e.disable);
        if (riders.length) {
            for (const e of riders) forced.add(stKey(e));
            await ctx().eventSource.emit(ctx().eventTypes.WORLDINFO_FORCE_ACTIVATE, riders);
            if (args.state && args.state.next === st.scan_state.NONE) args.state.next = st.scan_state.MIN_ACTIVATIONS;
        }
        // 5. Masks and written text (TRACKERS 2.2): on the scan's own copies, never the book.
        for (const k of new Set([...out.masks.keys(), ...out.text.keys()])) {
            const entry = map.get(k);
            if (!entry) continue;
            if (!baseContent.has(entry)) baseContent.set(entry, entry.content);
            const name = out.masks.get(k);
            const mask = name && model.byStKey.get(k).masks.find(m => m.name === name);
            const text = out.text.get(k);
            // Written text is the model's own: sent as it is, no macros.
            entry.content = typeof text === 'string' ? text
                : mask && text === undefined ? ctx().substituteParams(mask.content) : baseContent.get(entry);
        }
    }

    // 6.5
    function onWorldInfoActivated(entries) {
        if (!pending || pending.uncounted) return;
        const list = Array.isArray(entries) ? entries : [];
        pending.fired = list.map(stKey);
        // What reached the model, for the chat bubble. Recorded whether or not the engine runs.
        pending.sent = list.map(e => {
            const mask = pending.masks?.get(stKey(e));
            const written = typeof pending.text?.get(stKey(e)) === 'string';
            return { world: e.world, uid: e.uid, title: e.comment || e.key?.[0] || `uid ${e.uid}`, ...(mask ? { mask } : {}), ...(written ? { written: true } : {}) };
        });
    }

    // 6.6
    function onMessageReceived(mesId) {
        const turn = pending;
        if (!turn || turn.uncounted) return;
        const chat = ctx().chat ?? [];
        const message = chat[mesId];
        if (!message || message.is_user) return;
        let sent = turn.sent;
        if (turn.type === 'continue') {
            const before = message.extra?.[SENT_FIELD] ?? [];
            sent = [...new Map([...before, ...sent].map(x => [`${x.world}.${x.uid}`, x])).values()];
        }
        writeSent(message, sent);
        if (!turn.working || !active()) {
            pending = null;
            // No snapshot for this reply. A new swipe starts as a copy of the one before it, snapshot and all, which
            // would make this reply look covered (review finding 13): take it off so catch-up sees the gap.
            // A continue keeps its own: it is still the reply the snapshot was written for, only longer.
            if (turn.type !== 'continue') dropSnapshot(message);
            onChange();
            return;
        }
        pending = null;
        let fired = turn.fired;
        if (turn.type === 'continue') fired = [...new Set([...(message.extra?.[FIELD]?.round ?? []), ...fired])];
        const next = advance(turn.working, { fired, victims: turn.victims }, model, chat.slice(0, mesId + 1), mesId);
        writeSnapshot(message, next);
        onChange();
    }

    function dropPending() { pending = null; }

    /** Writes a manual action onto the latest message and saves the chat (BUILD_SPEC 7). */
    async function editState(edit) {
        const chat = ctx().chat ?? [];
        if (!chat.length) return false;
        const { state } = baseState(chat, model, stateOptions(chat));
        const next = edit(state, chat.length);
        next.at = chat.length - 1;
        writeSnapshot(chat[chat.length - 1], next);
        await ctx().saveChat();
        onChange();
        return true;
    }

    const reopenEntry = key => editState((state, now) => reopen(state, key, now));
    const pickEntryMask = (key, name) => editState(state => pickMask(state, key, name));
    /** Sets a tracker's value by hand, or clears it (no text), from the latest message on (TRACKERS 2.3). */
    const setSlotValue = (key, text) => editState((state, now) => setSlot(state, key, text, now - 1));

    /** Every tracker's value the next generation starts from: slot key → text. */
    function values() {
        const chat = ctx().chat ?? [];
        return slotValues(model, stateForScan(chat, model, stateOptions(chat)), chat);
    }

    /** An edit of the latest reply reads its trackers again (TRACKERS 2.4); older edits change nothing. */
    async function onMessageEdited(mesId) {
        if (!active() || !model.slots?.size) return;
        const chat = ctx().chat ?? [];
        const id = Number(mesId);
        const message = chat[id];
        if (id !== chat.length - 1 || !message || message.is_user) return;
        const snapshot = readState(message.extra?.[FIELD], { at: id, renamed: settings.renamed ?? {} });
        if (!snapshot) return;
        const before = chat.slice(0, id);
        const working = stateForScan(before, model, stateOptions(before));
        writeSnapshot(message, rereadReply(snapshot, working, model, chat, id));
        await ctx().saveChat();
        onChange();
    }

    /** Finds an entry by `book/id`, or by id alone when only one loaded book has it. */
    function findNode(ref) {
        if (model.nodes.has(ref)) return model.nodes.get(ref);
        const found = [...model.nodes.values()].filter(n => n.id === ref);
        return found.length === 1 ? found[0] : null;
    }

    /** Rebuilds the model from the books ST would load now (for a chat just opened, before any generation). */
    let selfLoading = false;
    /** A generation's read was handled while loadModel waited: what came back may have had entries removed. */
    let selfSpliced = false;
    async function loadModel() {
        let entries;
        selfLoading = true;
        selfSpliced = false;
        try { entries = await st.getSortedEntries(); } finally { selfLoading = false; }
        if (selfSpliced) return loaded; // already rebuilt from it in onEntriesLoaded
        if (Array.isArray(entries)) rebuild(entries);
        return entries ?? [];
    }

    /** Replies of the open chat that ran without WI Hero, when the loaded books have story logic; else null. */
    function gap() {
        const chat = ctx().chat ?? [];
        if (!model.nodes.size || !chat.length) return null;
        const g = findGap(chat);
        return g.skipped.length ? g : null;
    }

    /**
     * Resolves the open chat's gap (BUILD_SPEC 17.1) and saves the chat.
     * @param {'catchUp' | 'keep' | 'fresh'} how
     */
    async function fixGap(how) {
        const entries = await loadModel();
        const chat = ctx().chat ?? [];
        const n = resolveGap(how, { chat, entries, model, options: stateOptions, globals: { ...st.globals(), parseRegexFromString: st.parseRegexFromString } });
        if (n) await ctx().saveChat();
        onChange();
        return n;
    }

    /** What the panel shows: the state the next generation starts from. */
    function view() {
        if (!loaded.length && !model.nodes.size) return null;
        const chat = ctx().chat ?? [];
        const { index } = baseState(chat, model, stateOptions(chat));
        const state = stateForScan(chat, model, stateOptions(chat));
        const rows = [...model.byStKey.values()].map(node => {
            const s = node.key ? entryStatus(node, state, chat, model) : { status: 'blocked', text: 'has a problem', mask: null };
            return {
                key: node.key, id: node.id, book: node.book, label: node.label,
                status: s.status, text: s.text + (s.mask ? ` · mask: ${s.mask}` : ''),
                fired: node.key ? state.fired[node.key] ?? 0 : 0,
                lastRound: state.round.includes(node.stKey),
            };
        });
        return { rows, issues: model.issues, enabled: settings.enabled, from: index, roundSize: state.round.length, gap: gap() };
    }

    return {
        onGenerationStarted, onAfterCommands, onEntriesLoaded, onScanDone, onWorldInfoActivated, onMessageReceived, dropPending,
        reopenEntry, pickEntryMask, setSlotValue, values, onMessageEdited, stripPrompt, findNode, view, loadModel, gap, fixGap, active,
        get model() { return model; },
        get pending() { return pending; },
        get loaded() { return loaded; },
        state() { const chat = ctx().chat ?? []; return stateForScan(chat, model, stateOptions(chat)); },
    };
}
