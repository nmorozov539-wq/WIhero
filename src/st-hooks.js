// The ST side of one turn (BUILD_SPEC 6): reads ST's events, calls the engine, applies its decisions to ST's
// entry lists and activated Map. SillyTavern is reached only through `ctx()` and the `st` functions passed in,
// so this can be tested with a stand-in.
import { buildModel, FIELD, rawConfig, stKey } from './engine/model.js';
import { advance, baseState, entryStatus, holdingKeys, keepAtLoad, keywordOnSide, settleScan, stateForScan } from './engine/turn.js';
import { pickMask, reopen } from './engine/manual.js';
import { greetingFingerprint, greetingsOf, openingGreeting, writeSnapshot } from './chat-state.js';
import { isCounted, scanChat } from './generation.js';
import { entryHash, scanLength, stickyHeld } from './timers.js';

/**
 * @param {object} deps
 * @param {() => object} deps.ctx SillyTavern.getContext
 * @param {object} deps.st { getSortedEntries, getStringHash, parseRegexFromString, scan_state, globals() }
 * @param {object} deps.settings extension_settings.wihero
 * @param {() => void} [deps.onChange] Called when the panel should refresh.
 */
export function createHooks({ ctx, st, settings, onChange = () => {} }) {
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
    const greetingFp = (avatar, n) => {
        const char = ctx().characters?.find?.(c => c.avatar === avatar);
        if (!char) return undefined;
        const list = greetingsOf(char);
        return n < list.length ? greetingFingerprint(list[n], st.getStringHash) : null;
    };

    function rebuild(entries) {
        const sig = entries.map(e => `${stKey(e)}|${e.comment}|${e.probability}|${e.useProbability}|${e.cooldown}|${JSON.stringify(rawConfig(e) ?? null)}`).join('\n')
            + `\n${character()?.avatar ?? ''}|${greetingsOf(character()).join('\u0000').length}`;
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
        pending = { type, uncounted: !isCounted(type), working: null, chat: null, sticky: new Set(), forced: new Set(), victims: new Map(), fired: [] };
    }

    // 6.2, glue: force-activate holds before the scan. ST clears forced entries after every scan.
    async function onAfterCommands(type, _options, dryRun) {
        if (!settings.enabled || dryRun) return;
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
        loaded = Object.values(lore ?? {}).filter(Array.isArray).flat();
        hashes = new Map(loaded.map(e => [stKey(e), entryHash(e, st.getStringHash)]));
        rebuild(loaded);
        if (!settings.enabled) return onChange();
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
        const map = args?.activated?.entries;
        if (!settings.enabled || !(map instanceof Map)) return;
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
        if (pending) pending.victims = out.victims;
        // 4. Ride-along: force the riders in and ask ST for one more pass.
        const riders = out.force.map(k => args.sortedEntries?.find?.(e => stKey(e) === k)).filter(e => e && !e.disable);
        if (riders.length) {
            for (const e of riders) forced.add(stKey(e));
            await ctx().eventSource.emit(ctx().eventTypes.WORLDINFO_FORCE_ACTIVATE, riders);
            if (args.state && args.state.next === st.scan_state.NONE) args.state.next = st.scan_state.MIN_ACTIVATIONS;
        }
        // 5. Masks: on the scan's own copies, never the book.
        for (const [k, name] of out.masks) {
            const entry = map.get(k);
            if (!entry) continue;
            if (!baseContent.has(entry)) baseContent.set(entry, entry.content);
            const mask = name && model.byStKey.get(k).masks.find(m => m.name === name);
            entry.content = mask ? ctx().substituteParams(mask.content) : baseContent.get(entry);
        }
    }

    // 6.5
    function onWorldInfoActivated(entries) {
        if (pending && !pending.uncounted) pending.fired = (entries ?? []).map(stKey);
    }

    // 6.6
    function onMessageReceived(mesId) {
        const turn = pending;
        if (!turn || turn.uncounted || !turn.working || !settings.enabled) return;
        const chat = ctx().chat ?? [];
        const message = chat[mesId];
        if (!message || message.is_user) return;
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

    /** Finds an entry by `book/id`, or by id alone when only one loaded book has it. */
    function findNode(ref) {
        if (model.nodes.has(ref)) return model.nodes.get(ref);
        const found = [...model.nodes.values()].filter(n => n.id === ref);
        return found.length === 1 ? found[0] : null;
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
        return { rows, issues: model.issues, enabled: settings.enabled, from: index, roundSize: state.round.length };
    }

    return {
        onGenerationStarted, onAfterCommands, onEntriesLoaded, onScanDone, onWorldInfoActivated, onMessageReceived, dropPending,
        reopenEntry, pickEntryMask, findNode, view,
        get model() { return model; },
        get pending() { return pending; },
        get loaded() { return loaded; },
        state() { const chat = ctx().chat ?? []; return stateForScan(chat, model, stateOptions(chat)); },
    };
}
