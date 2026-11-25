// The stand-in SillyTavern behind e2e/desktop/boot.html (L1). It exists so the real index.js can boot: the engine's
// context, one book, the health check's internals, and ST's drawer/dropdown controls. It deliberately never imports
// src/ui/app.js; the point of the page is that index.js reaches the editor only when the drawer opens.
const EVENTS = [
    'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE',
    'WORLD_INFO_ACTIVATED', 'MESSAGE_RECEIVED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'WORLDINFO_FORCE_ACTIVATE',
    'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'CHARACTER_EDITED',
    'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'WORLDINFO_SETTINGS_UPDATED', 'WORLDINFO_UPDATED',
    'SETTINGS_UPDATED',
];
const eventTypes = Object.fromEntries(EVENTS.map(type => [type, type]));
const listeners = new Map();
const eventSource = {
    on(type, fn) {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
    },
    emit(type, ...args) { for (const fn of listeners.get(type) ?? []) fn(...args); },
};

const template = {
    key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true,
    selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4,
    group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null,
    useGroupScoring: null, automationId: '', role: null, sticky: null, cooldown: null, delay: null,
};
const BOOK = 'Boot Book';
const book = {
    entries: {
        0: { ...template, uid: 0, comment: 'Boot Row', key: ['boot', 'row'], content: 'The boot entry.', order: 100, extensions: { wihero: { id: 'boot1' } } },
    },
};
const loadWorldInfo = async name => (name === BOOK ? structuredClone(book) : null);

const toasts = [];
globalThis.toastr = {
    warning(message) { toasts.push({ kind: 'warning', message }); },
    error(message) { toasts.push({ kind: 'error', message }); },
    success(message) { toasts.push({ kind: 'success', message }); },
};
globalThis.__wiheroBootToasts = toasts;

const dropdownHandlers = [];
let dropdownIndex = 0;
/** Just enough of ST's jQuery for index.js: the drawer button, the book dropdown and a no-op elsewhere. */
const jq = selector => {
    const target = typeof selector === 'string' ? document.querySelector(selector) : selector;
    return {
        on(type, fn) {
            if (type === 'change' && target?.id === 'world_editor_select') dropdownHandlers.push(fn);
            return this;
        },
        trigger(type) {
            if (type === 'change' && target?.id === 'world_editor_select') {
                for (const fn of dropdownHandlers) fn.call({ value: String(dropdownIndex) });
            } else if (type === 'click' && target) {
                target.click();
            }
            return this;
        },
        val(value) {
            if (value === undefined) return selector?.value ?? String(dropdownIndex);
            dropdownIndex = Number(value);
            return this;
        },
        children() { return { filter: () => null }; },
        filter() { return null; },
    };
};
globalThis.jQuery = jq;

const context = {
    eventSource,
    eventTypes,
    extensionSettings: { wihero: {} },
    saveSettingsDebounced: () => {},
    chat: [],
    characters: [],
    chatMetadata: {},
    powerUserSettings: {},
    chatId: null,
    groupId: null,
    characterId: undefined,
    maxContext: 8192,
    saveChat: async () => {},
    substituteParams: text => text,
    saveMetadata: async () => {},
    setExtensionPrompt: () => {},
    getCurrentChatId: () => null,
    getRequestHeaders: () => ({}),
    getWorldInfoNames: () => [BOOK],
    loadWorldInfo,
    saveWorldInfo: async () => {},
    updateWorldInfoList: async () => {},
    getTokenCountAsync: async text => Math.ceil(String(text ?? '').length / 4),
    SlashCommandParser: { addCommandObject() {} },
    SlashCommand: { fromProps: props => props },
    SlashCommandNamedArgument: { fromProps: props => props },
    SlashCommandArgument: { fromProps: props => props },
    ARGUMENT_TYPE: { STRING: 'string' },
    Popup: class Popup { async show() { return 0; } async complete() {} },
    POPUP_TYPE: { TEXT: 'text' },
    POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: 0, CUSTOM1: 2, CUSTOM2: 3 },
};
globalThis.SillyTavern = { getContext: () => context };

const wiDrawer = document.getElementById('WorldInfo');
const openDrawer = () => wiDrawer.classList.add('openDrawer');
const closeDrawer = () => wiDrawer.classList.remove('openDrawer');
document.getElementById('wi-toggle').addEventListener('click', () => {
    if (wiDrawer.classList.contains('openDrawer')) closeDrawer(); else openDrawer();
});
globalThis.wiheroBoot = {
    book: BOOK,
    openDrawer,
    closeDrawer,
    /** Raises ST's editor dropdown for world_names[index], as its programmatic editor reload does. */
    selectBook(index = 0) {
        dropdownIndex = index;
        for (const fn of dropdownHandlers) fn.call({ value: String(index) });
    },
};

// The real entry. Everything above is already in place; the import map in boot.html maps ST's own modules.
await import('../../index.js');
