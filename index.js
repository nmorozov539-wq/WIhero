// WI Hero: story logic for SillyTavern's World Info. Entries open as the story reaches them and close once it
// moves past. The engine and its ST wiring (N1), and the editor that opens from ST's World Info button (N2).
// See docs/BUILD_SPEC.md.
import { MODULE, getSettings } from './src/settings.js';
import { ensureSettings } from './src/ui/data.js';
import { createLibrary } from './src/ui/st-books.js';
import { createSnapshots } from './src/ui/snapshots.js';
import { createApp } from './src/ui/app.js';
import { mountPanel, render, renderNotice } from './src/panel.js';
import { createHooks } from './src/st-hooks.js';
import { createBubble } from './src/bubble.js';
import { checkHealth, createHealth, standDownText, stVersion } from './src/compat.js';
import * as st from './src/st.js';

const ctx = () => SillyTavern.getContext();
/**
 * The editor's view of getContext(): ST builds a new, large object on every call, and a draw asks dozens of times.
 * One object serves until the current task ends (fields like chat and characterId can change between tasks).
 */
let ctxNow = null;
const uiCtx = () => {
    if (!ctxNow) { ctxNow = SillyTavern.getContext(); setTimeout(() => { ctxNow = null; }, 0); }
    return ctxNow;
};
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = ctx();
const settings = ensureSettings(getSettings(extensionSettings));

let refreshTimer = null;
/** ST refreshes often during a generation, so the panel is redrawn at most every 150 ms. */
function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { render(hooks.view()); app?.refresh(); bubble?.render(); }, 150);
}
let app = null;
let bubble = null;

// ---- Compatibility (BUILD_SPEC 17.2): the ST version, and every thread WI Hero pulls. A problem stands the engine
// down (World Info runs as plain ST); a version WI Hero isn't tested on is only a warning.
const warned = new Set();
function showHealth(h) {
    const lines = [h.versionText, h.ok ? null : standDownText(h.problems)];
    renderNotice(lines);
    for (const line of lines) {
        if (!line || warned.has(line)) continue;
        warned.add(line);
        globalThis.toastr?.warning(line, 'WI Hero', { timeOut: 12000 });
    }
    refresh();
}
const health = createHealth(showHealth);
for (const problem of checkHealth(ctx(), st.internals())) health.problems.push(problem);

/** ST's World Info scan settings, read live (they change in ST's settings). */
const { scanGlobals } = st;

const hooks = createHooks({
    ctx,
    settings,
    health,
    onChange: refresh,
    st: {
        getSortedEntries: st.getSortedEntries,
        getStringHash: st.getStringHash,
        parseRegexFromString: st.parseRegexFromString,
        scan_state: st.scan_state,
        globals: scanGlobals,
    },
});

mountPanel({
    settings,
    handlers: {
        onToggle(value) {
            settings.enabled = value;
            saveSettingsDebounced();
            refresh();
            if (value) offerCatchUp();
        },
        onBubble(value) {
            settings.bubble = value;
            saveSettingsDebounced();
            refresh();
        },
        onReopen: key => hooks.reopenEntry(key),
        onFixGap: how => fixGap(how),
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
for (const type of ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_RECEIVED']) eventSource.on(eventTypes[type], refresh);

// ---- Catch-up (BUILD_SPEC 17.1): replies that ran with WI Hero off leave the story state behind.
const FIXED = { catchUp: n => `Caught up on ${n} ${n === 1 ? 'reply' : 'replies'}, oldest first.`, keep: () => 'Kept the old story state.', fresh: () => 'The story state starts again from the newest reply.' };
async function fixGap(how) {
    const n = await hooks.fixGap(how);
    if (n) globalThis.toastr?.success(FIXED[how](n), 'WI Hero');
    refresh();
}
const asked = new Set();
/** Asks once per chat and gap what to do about replies that ran without WI Hero. */
async function offerCatchUp() {
    if (!hooks.active()) return;
    try { await hooks.loadModel(); } catch { return; }
    const g = hooks.gap();
    refresh();
    if (!g) return;
    const c = ctx();
    const sig = `${c.getCurrentChatId?.() ?? c.chatId}|${g.skipped.join(',')}`;
    if (asked.has(sig)) return;
    asked.add(sig);
    const n = g.skipped.length;
    const text = `<h3>WI Hero was off for ${n} ${n === 1 ? 'reply' : 'replies'}</h3>`
        + `<p>Its story state is from ${g.from < 0 ? 'the start of this chat' : `message #${g.from}`}, so gates the story has passed may still be shut.</p>`
        + '<p><b>Catch up</b> replays the skipped replies one by one, oldest first, matching key words as Preview does. '
        + '<b>Keep as is</b> carries the old state on. <b>Start from here</b> starts the story state again.</p>';
    const { POPUP_TYPE, POPUP_RESULT } = c;
    const result = await c.callGenericPopup(text, POPUP_TYPE.TEXT, '', {
        okButton: 'Catch up', cancelButton: 'Not now',
        customButtons: [{ text: 'Keep as is', result: POPUP_RESULT.CUSTOM1 }, { text: 'Start from here', result: POPUP_RESULT.CUSTOM2 }],
    });
    const how = { [POPUP_RESULT.AFFIRMATIVE]: 'catchUp', [POPUP_RESULT.CUSTOM1]: 'keep', [POPUP_RESULT.CUSTOM2]: 'fresh' }[result];
    if (how) await fixGap(how);
}
eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(offerCatchUp, 300));

// ---- The editor (N2)
let snapshots = null;
const library = createLibrary({
    ctx: uiCtx, WI: st.WI, powerUser: ctx().powerUserSettings, settings, saveSettings: saveSettingsDebounced,
    onFirstSeen: (name, data, o) => snapshots.seed(name, data, o),
    onChange: () => app?.refresh(),
});
snapshots = createSnapshots({ ctx, settings, saveSettings: saveSettingsDebounced, library });

/** ST's own World Info drawer, for the settings WI Hero doesn't show ("More settings ›"). */
let bypass = false;
function openStEditor() {
    const $ = globalThis.jQuery;
    if ($('#WorldInfo').hasClass('openDrawer')) return;
    bypass = true;
    try { $('#WI-SP-button .drawer-toggle').trigger('click'); } finally { bypass = false; }
}

bubble = createBubble({ ctx, settings, gap: () => (hooks.active() ? hooks.gap() : null), onFixGap: fixGap });
stVersion().then(v => health.setVersion(v));
if (!health.ok) showHealth(health);

app = createApp({
    ctx: uiCtx, library, snapshots, hooks, settings, saveSettings: saveSettingsDebounced,
    entryTemplate: st.newWorldInfoEntryTemplate,
    cssUrl: new URL('./src/ui/app.css', import.meta.url).href,
    openStEditor,
    scan: { globals: scanGlobals, parseRegexFromString: st.parseRegexFromString },
});

// ST's World Info button opens WI Hero instead of ST's drawer (LAYOUT "Opening the editor"). Any other top bar
// drawer hides it, as ST's drawers close each other.
document.getElementById('top-settings-holder')?.addEventListener('click', e => {
    const toggle = e.target.closest?.('.drawer-toggle');
    if (!toggle || bypass) return;
    if (toggle.closest('#WI-SP-button')) {
        if (globalThis.jQuery?.('#WorldInfo').hasClass('openDrawer')) return; // ST's own drawer is open: the button closes it
        e.stopPropagation();
        e.preventDefault();
        app.toggle();
    } else {
        app.hide();
    }
}, true);

eventSource.on(eventTypes.WORLDINFO_UPDATED, library.onWorldInfoUpdated);
for (const type of ['WORLDINFO_SETTINGS_UPDATED', 'CHARACTER_EDITED', 'CHAT_CHANGED']) if (eventTypes[type]) eventSource.on(eventTypes[type], refresh);

globalThis.wihero = {
    app,
    library,
    snapshots,
    get model() { return hooks.model; },
    get state() { return hooks.state(); },
    get pending() { return hooks.pending; },
    health,
    bubble,
    hooks,
    settings,
    module: MODULE,
};
