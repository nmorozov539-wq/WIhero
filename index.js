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
import { checkHealth, createHealth, EVENTS, standDownText, stVersion } from './src/compat.js';
import * as st from './src/st.js';

const ctx = () => SillyTavern.getContext();
/**
 * The editor's view of getContext(): ST builds a new, large object on every call, and a draw asks dozens of times.
 * One object serves one synchronous run (a draw). It is dropped in a microtask, so code after any await reads a
 * fresh one (fields like chat and characterId can change while it waits).
 */
let ctxNow = null;
const uiCtx = () => {
    if (!ctxNow) { ctxNow = SillyTavern.getContext(); queueMicrotask(() => { ctxNow = null; }); }
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
    saveSettings: () => saveSettingsDebounced(),
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

/**
 * Subscribes to an ST event by name, only if this ST has it. The engine's own events are in the health check
 * (compat.js EVENTS), which stands the engine down without them; the rest only keep panels and the editor fresh,
 * so a missing one is named in the console and skipped.
 */
function on(type, fn) {
    if (eventTypes[type]) { eventSource.on(eventTypes[type], fn); return; }
    if (!EVENTS.includes(type)) console.warn(`[WI Hero] SillyTavern has no ${type} event; what follows it may not refresh.`);
}
on('GENERATION_STARTED', hooks.onGenerationStarted);
on('GENERATION_AFTER_COMMANDS', hooks.onAfterCommands);
on('WORLDINFO_ENTRIES_LOADED', hooks.onEntriesLoaded);
on('WORLDINFO_SCAN_DONE', hooks.onScanDone);
on('WORLD_INFO_ACTIVATED', hooks.onWorldInfoActivated);
on('MESSAGE_RECEIVED', hooks.onMessageReceived);
on('GENERATION_STOPPED', hooks.dropPending);
on('CHAT_CHANGED', hooks.dropPending);
for (const type of ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_RECEIVED']) on(type, refresh);

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
on('CHAT_CHANGED', () => setTimeout(offerCatchUp, 300));

// ---- The editor (N2)
let snapshots = null;
const library = createLibrary({
    ctx: uiCtx, WI: st.WI, powerUser: ctx().powerUserSettings, settings, saveSettings: saveSettingsDebounced,
    onFirstSeen: (name, data, o) => snapshots.seed(name, data, o),
    onChange: () => app?.refresh(),
    onSaveError: (name, e, final, what = 'save') => {
        console.error(`[WI Hero] Could not ${what}`, name, e);
        globalThis.toastr?.error(what === 'export' ? `Could not export ${name}.`
            : final ? `Could not save ${name}. Your edits are kept here; the next change tries again.`
                : `Could not save ${name}. Trying again in a few seconds.`, 'WI Hero');
    },
    onMerged: (name, conflicts) => {
        if (conflicts) globalThis.toastr?.warning(`${name} was also changed outside WI Hero while an edit was waiting to save. `
            + `${conflicts === 1 ? 'One entry' : `${conflicts} entries`} changed in both places keep${conflicts === 1 ? 's' : ''} WI Hero's version; the rest take the outside changes.`, 'WI Hero');
    },
});
// An edit still inside its save delay is lost if the page goes away (a reload, or a phone switching apps): save it
// now. Best effort, since the page may not live to see the save finish (review 2026-11-09, finding 5).
const flushNow = () => library.flush().catch(() => {}); // a failed save is reported by the library
globalThis.addEventListener?.('pagehide', flushNow);
globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
const seedWarned = new Set();
snapshots = createSnapshots({
    ctx, settings, saveSettings: saveSettingsDebounced, library,
    // Users are told to count on this copy, so a failed one is said once per book and session, not only logged.
    onSeedError: book => {
        if (seedWarned.has(book)) return;
        seedWarned.add(book);
        globalThis.toastr?.warning(`Could not keep the "As imported" copy of ${book}. WI Hero tries again the next time you open it; take a snapshot or export the book to be safe.`, 'WI Hero');
    },
});

// ---- ST's World Info button (LAYOUT "Opening the editor"). The button and its drawer stay ST's: ST opens and closes
// the drawer, lights the button, and closes the drawer when another top bar drawer opens, the same for every way in
// (the button, a card's lorebook just imported, the character's, chat's and persona's lorebook buttons). WI Hero only
// follows: it shows while the drawer is open, with the drawer itself hidden under it (.wihero-under).
const wiDrawer = document.getElementById('WorldInfo');
const drawerOpen = () => !!wiDrawer?.classList.contains('openDrawer');
const clickWiButton = () => globalThis.jQuery?.('#WI-SP-button .drawer-toggle').trigger('click');
/** While ST's own editor is asked for ("More settings ›"), the drawer shows as itself until it closes. */
let native = false;
function openStEditor() {
    native = true;
    wiDrawer?.classList.remove('wihero-under');
    app.hide();
    if (!drawerOpen()) clickWiButton();
}
/** WI Hero opened or closed itself (its Back, Escape): ST's drawer goes with it, through ST's own button. */
function followEditor(open) {
    if (!native && wiDrawer && open !== drawerOpen()) clickWiButton();
}
/** The book ST just picked in its editor's dropdown (it opens the drawer on a book), for WI Hero to open on. */
let askedBook = null;
let askedTimer = null;

bubble = createBubble({ ctx, settings, saveSettings: saveSettingsDebounced, gap: () => (hooks.active() ? hooks.gap() : null), onFixGap: fixGap });
stVersion().then(v => health.setVersion(v));
if (!health.ok) showHealth(health);

app = createApp({
    ctx: uiCtx, library, snapshots, hooks, settings, saveSettings: saveSettingsDebounced,
    entryTemplate: st.newWorldInfoEntryTemplate,
    cssUrl: new URL('./src/ui/app.css', import.meta.url).href,
    openStEditor,
    onVisible: followEditor,
    scan: { globals: scanGlobals, parseRegexFromString: st.parseRegexFromString },
});

function syncWithDrawer() {
    if (!drawerOpen()) {
        native = false; // the class stays on while the drawer closes, so its closing animation isn't seen
        app.hide();
        return;
    }
    if (native) return;
    if (!wiDrawer.classList.contains('wihero-under')) wiDrawer.classList.add('wihero-under');
    if (askedBook) { const name = askedBook; askedBook = null; app.openBook(name); } else app.show();
}
// ST closes its open drawers on any touch or mouse press outside them (script.js, on <html>). WI Hero stands for the
// drawer, so a press inside it stays inside: it doesn't reach that handler. Passive: a touch listener that could
// cancel makes the phone wait for the page's script before every scroll starts.
for (const type of ['touchstart', 'mousedown']) app.host.addEventListener(type, e => e.stopPropagation(), { passive: true });
if (wiDrawer) {
    new MutationObserver(syncWithDrawer).observe(wiDrawer, { attributes: true, attributeFilter: ['class'] });
    syncWithDrawer();
}
// Desktop at drawer size (LAYOUT "Desktop: normal mode", Size and place): WI Hero sits in the middle, so ST's side
// panels (AI Response Configuration on the left, Characters on the right) open beside it instead of closing it.
// ST closes every open drawer that isn't pinned when another one opens (doNavbarIconClick), so for that one click
// the World Info drawer counts as pinned. Its handler reads the classes at once, before its first await. The press
// itself is covered too: ST's "click outside closes drawers" runs on mousedown when it misses the icon.
const SIDE_PANELS = new Set(['left-nav-panel', 'right-nav-panel']);
const keepBesideSidePanel = e => {
    const toggle = e.target.closest?.('.drawer-toggle');
    const panel = toggle?.parentElement?.querySelector('.drawer-content');
    if (!panel || !SIDE_PANELS.has(panel.id) || panel.classList.contains('openDrawer')) return;
    if (!app.isOpen() || !app.host.classList.contains('desk') || app.host.classList.contains('wide') || !drawerOpen()) return;
    const icon = document.querySelector('#WI-SP-button .drawer-icon');
    const pinned = wiDrawer.classList.contains('pinnedOpen');
    if (pinned) return;
    wiDrawer.classList.add('pinnedOpen');
    icon?.classList.add('drawerPinnedOpen');
    setTimeout(() => { wiDrawer.classList.remove('pinnedOpen'); icon?.classList.remove('drawerPinnedOpen'); }, 0);
};
for (const type of ['mousedown', 'touchstart', 'click']) document.addEventListener(type, keepBesideSidePanel, { capture: true, passive: true });
// Widened, WI Hero keeps clear of an open side panel (pinned, or opened beside normal mode): app.css insets it.
for (const [id, cls] of [['left-nav-panel', 'pl'], ['right-nav-panel', 'pr']]) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    const sync = () => app.host.classList.toggle(cls, panel.classList.contains('openDrawer'));
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();
}
globalThis.jQuery?.('#world_editor_select').on('change', function () {
    if (native || library.busy?.()) return; // WI Hero's own book changes refresh that list too
    const name = st.WI.world_names?.[Number(globalThis.jQuery(this).val())];
    if (!name) return;
    if (app.isOpen()) { app.openBook(name); return; }
    // The drawer can open a moment later (ST waits for another drawer to close first).
    askedBook = name;
    clearTimeout(askedTimer);
    askedTimer = setTimeout(() => { askedBook = null; }, 1500);
});

on('WORLDINFO_UPDATED', library.onWorldInfoUpdated);
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
