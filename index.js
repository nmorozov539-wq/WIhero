// WI Hero: story-gated World Info. Entries only become eligible once the story reaches them,
// and retire once it moves past. See docs/DESIGN.md.
import { MODULE, getSettings } from './src/settings.js';
import { mountPanel, render } from './src/panel.js';
import { buildModel, eligibility, entryKey, gluedKeys, removeIneligible } from './src/engine.js';
import { stateBefore, writeSnapshot } from './src/chat-state.js';
import { isRecorded, gatingState, snapshotFor, turnText } from './src/generation.js';
import { getSortedEntries } from './src/st.js';

const ctx = () => SillyTavern.getContext();
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = ctx();
const settings = getSettings(extensionSettings);

/** Model of the gated entries in the books ST loaded last. */
let model = null;
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
    const keys = new Set(gluedKeys(model, gatingState(ctx().chat ?? [], type)));
    const glued = entries.filter(e => keys.has(entryKey(e)));
    if (glued.length) await eventSource.emit(eventTypes.WORLDINFO_FORCE_ACTIVATE, glued);
}

function onEntriesLoaded(lore) {
    model = buildModel(Object.values(lore ?? {}).filter(Array.isArray).flat());
    if (!settings.enabled) return refresh();
    const chat = ctx().chat ?? [];
    const state = gatingState(chat, generation?.type);
    if (generation && !generation.base) {
        generation.base = state;
        generation.model = model;
    }
    removeIneligible(lore, model, state);
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
    const { state, index } = stateBefore(ctx().chat ?? []);
    const rows = [...model.byKey.values()].map(node => ({
        id: node.id ?? node.label,
        key: node.key,
        status: eligibility(node, model, state).reason,
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
