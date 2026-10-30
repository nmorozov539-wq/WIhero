// WI Hero: story-gated World Info. Entries only become eligible once the story reaches them,
// and retire once it moves past. See docs/DESIGN.md.
import { MODULE, getSettings } from './src/settings.js';
import { mountPanel, render } from './src/panel.js';
import { buildModel, eligibility, entryKey, gluedKeys, removeIneligible } from './src/engine.js';
import { stateBefore, writeSnapshot } from './src/chat-state.js';
import { isRecorded, gatingState, snapshotFor, turnText } from './src/generation.js';
import { entryHash, scanLength, stickyHeld } from './src/timers.js';
import { getSortedEntries, getStringHash } from './src/st.js';

const ctx = () => SillyTavern.getContext();
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = ctx();
const settings = getSettings(extensionSettings);

/** Model of the gated entries in the books ST loaded last. */
let model = null;
/** The entries ST loaded last, before gating removed any, and their ST hashes by world.uid. */
let loaded = [];
let hashes = new Map();
let hashWarned = false;
const hashOf = entry => hashes.get(entryKey(entry));
/** Entries ST will hold by sticky in a scan of `length` messages: gating leaves them in. */
const held = length => stickyHeld(loaded, ctx().chatMetadata?.timedWorldInfo, length, hashOf);
/**
 * The generation in progress: { type, record, base, model, activated }.
 * `base` and `model` are set by its World Info scan; `activated` collects world.uid keys.
 * A newer generation replaces it. Dry runs never touch it.
 */
let generation = null;

function onGenerationStarted(type, _options, dryRun) {
    if (dryRun) return;
    generation = { type, record: isRecorded(type), base: null, model: null, activated: [] };
}

/**
 * Glue: force-activate glued entries for this generation's scan. ST clears forced entries after every
 * scan, so this runs before each one. The entries come from getSortedEntries() so they carry the hash
 * ST keys sticky/cooldown by (docs/TECHNICAL_NOTES.md section 3).
 */
async function onAfterCommands(type) {
    if (!settings.enabled) return;
    const entries = await getSortedEntries();
    if (!model) return;
    if (!hashWarned && entries.some(e => hashes.has(entryKey(e)) && hashes.get(entryKey(e)) !== e.hash)) {
        hashWarned = true;
        console.warn('[WI Hero] Entry hashes differ from SillyTavern\'s; sticky entries may be cut short when they close.');
    }
    const keys = new Set(gluedKeys(model, gatingState(ctx().chat ?? [], type)));
    const glued = entries.filter(e => keys.has(entryKey(e)));
    if (glued.length) await eventSource.emit(eventTypes.WORLDINFO_FORCE_ACTIVATE, glued);
}

function onEntriesLoaded(lore) {
    loaded = Object.values(lore ?? {}).filter(Array.isArray).flat();
    hashes = new Map(loaded.map(e => [entryKey(e), entryHash(e, getStringHash)]));
    model = buildModel(loaded);
    if (!settings.enabled) return refresh();
    const chat = ctx().chat ?? [];
    const state = gatingState(chat, generation?.type);
    if (generation && !generation.base) {
        generation.base = state;
        generation.model = model;
    }
    // ST skips timed effects on dry runs, and a dry run never sets `generation`.
    removeIneligible(lore, model, state, generation ? held(scanLength(chat, generation.type)) : null);
    refresh();
}

function onWorldInfoActivated(entries) {
    if (generation?.record && generation.base) generation.activated.push(...entries.map(entryKey));
}

function onMessageReceived(messageId) {
    const current = generation;
    if (!current?.record || !current.base || !settings.enabled) return;
    const message = ctx().chat?.[messageId];
    if (!message || message.is_user) return;
    generation = null;
    writeSnapshot(message, snapshotFor({ ...current, message, text: turnText(ctx().chat, messageId) }));
    refresh();
}

/** Status of every gated entry for the next generation. */
function refresh() {
    if (!model) return render(null);
    const chat = ctx().chat ?? [];
    const { state, index } = stateBefore(chat);
    const sticky = settings.enabled ? held(scanLength(chat) + 1) : new Map(); // the next send adds a message
    const status = node => {
        const { eligible, reason } = eligibility(node, model, state);
        return !eligible && sticky.has(node.key) ? `sticky (${reason})` : reason;
    };
    const rows = [...model.byKey.values()].map(node => ({
        id: node.id ?? node.label,
        key: node.key,
        status: status(node),
        fired: node.id ? state.fired[node.id] ?? 0 : 0,
        lastRound: state.round.includes(node.key),
    }));
    render({ rows, issues: model.issues, enabled: settings.enabled, from: index, roundSize: state.round.length });
}

mountPanel({
    settings,
    handlers: {
        onToggle(value) {
            settings.enabled = value;
            saveSettingsDebounced();
            refresh();
        },
    },
});

eventSource.on(eventTypes.GENERATION_STARTED, onGenerationStarted);
eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, onAfterCommands);
eventSource.on(eventTypes.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
eventSource.on(eventTypes.CHAT_CHANGED, () => { generation = null; });
for (const type of ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) {
    eventSource.on(eventTypes[type], refresh);
}

globalThis.wihero = {
    get model() { return model; },
    get state() { return stateBefore(ctx().chat ?? []).state; },
    get generation() { return generation; },
    settings,
    module: MODULE,
};
