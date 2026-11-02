// WI Hero: story logic for SillyTavern's World Info. Entries open as the story reaches them and close once it
// moves past. N1: the engine and its ST wiring, with the old panel for testing. See docs/BUILD_SPEC.md.
import { MODULE, getSettings } from './src/settings.js';
import { mountPanel, render } from './src/panel.js';
import { createHooks } from './src/st-hooks.js';
import * as st from './src/st.js';

const ctx = () => SillyTavern.getContext();
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = ctx();
const settings = getSettings(extensionSettings);

let refreshTimer = null;
/** ST refreshes often during a generation, so the panel is redrawn at most every 150 ms. */
function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => render(hooks.view()), 150);
}

const hooks = createHooks({
    ctx,
    settings,
    onChange: refresh,
    st: {
        getSortedEntries: st.getSortedEntries,
        getStringHash: st.getStringHash,
        parseRegexFromString: st.parseRegexFromString,
        scan_state: st.scan_state,
        globals: () => ({ depth: st.world_info_depth, caseSensitive: st.world_info_case_sensitive, matchWholeWords: st.world_info_match_whole_words }),
    },
});

mountPanel({
    settings,
    handlers: {
        onToggle(value) {
            settings.enabled = value;
            saveSettingsDebounced();
            refresh();
        },
        onReopen: key => hooks.reopenEntry(key),
    },
});

/** /wihero-mask entry=<id> [name]: picks a mask from the latest message on; no name clears the pick. */
function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandNamedArgument, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wihero-mask',
        helpString: 'Picks a WI Hero mask for an entry from the latest message on (it rewinds with the chat). '
            + 'Without a name, the pick is cleared and the masks follow their gates again.',
        namedArgumentList: [SlashCommandNamedArgument.fromProps({
            name: 'entry', description: 'WI Hero id of the entry (or book/id)', typeList: [ARGUMENT_TYPE.STRING], isRequired: true,
        })],
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'mask name', typeList: [ARGUMENT_TYPE.STRING], isRequired: false,
        })],
        callback: async (args, value) => {
            const ref = String(args.entry ?? '').trim();
            const name = String(value ?? '').trim();
            const node = hooks.findNode(ref);
            const problem = !node ? `no entry "${ref}" in the loaded books (or more than one: use book/id)`
                : name && !node.masks.some(m => m.name === name) ? `${node.id} has no mask "${name}"`
                    : !ctx().chat?.length ? 'open a chat first' : null;
            if (problem) toastr.warning(`WI Hero: ${problem}.`);
            else await hooks.pickEntryMask(node.key, name);
            return '';
        },
    }));
}
registerCommands();

eventSource.on(eventTypes.GENERATION_STARTED, hooks.onGenerationStarted);
eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, hooks.onAfterCommands);
eventSource.on(eventTypes.WORLDINFO_ENTRIES_LOADED, hooks.onEntriesLoaded);
eventSource.on(eventTypes.WORLDINFO_SCAN_DONE, hooks.onScanDone);
eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, hooks.onWorldInfoActivated);
eventSource.on(eventTypes.MESSAGE_RECEIVED, hooks.onMessageReceived);
eventSource.on(eventTypes.GENERATION_STOPPED, hooks.dropPending);
eventSource.on(eventTypes.CHAT_CHANGED, hooks.dropPending);
for (const type of ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED']) eventSource.on(eventTypes[type], refresh);

globalThis.wihero = {
    get model() { return hooks.model; },
    get state() { return hooks.state(); },
    get pending() { return hooks.pending; },
    settings,
    module: MODULE,
};
