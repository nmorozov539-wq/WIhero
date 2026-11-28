// The stand-in for SillyTavern behind harness.html: an in-memory library of books (the examples, and a few made up
// here), WI Hero's settings in localStorage, and no chat. Exposes `wihero.app` like the extension does.
//
// This page imports the editor eagerly on purpose: it is the fixture for editor behaviour, not for ST's launch
// (e2e/desktop/boot.html with index.js is the L1 boot page). `wihero.ready` is already resolved for parity.
//
// `?perf=1` swaps that library for the disposable optimization profile (docs/optimization-pass/PLAN.md, B0): 40
// generated books, one 1,000-entry "Perf Big" book with a placed canvas, a 100 KB entry, and a long chat. It is not
// saved anywhere but this page's localStorage, and e2e/perf-harness.mjs drives it. Without `perf` nothing changes.
import { createLibrary } from '../../src/ui/st-books.js';
import { createApp } from '../../src/ui/app.js';
import { ensureSettings } from '../../src/ui/data.js';
import { buildModel } from '../../src/engine/model.js';
import { perf as perfCounters } from '../../src/ui/perf.js';
import { book as perfBook, chat as perfChat, placedCanvas } from '../../tools/perf/fixture.mjs';

const TEMPLATE = { key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: null, sticky: null, cooldown: null, delay: null };

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') document.documentElement.classList.add('light');
const KEY = 'wihero-harness-settings';
if (params.has('reset')) localStorage.removeItem(KEY);
const settings = ensureSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
const saveSettings = () => localStorage.setItem(KEY, JSON.stringify(settings));

/** A positive whole number from the query string, or the default. */
const count = (name, fallback) => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return fallback;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// `?slow=1` (or `?slow=<ms>`) delays every library read so the loader's queue and priority can be observed; any value
// above 1 is taken as milliseconds, and 1 means the default. Without `slow` the harness reads resolve immediately.
const slowRaw = params.get('slow');
const slowMs = slowRaw === null ? 0 : (Number(slowRaw) > 1 ? Math.floor(Number(slowRaw)) : 120);

// The disposable profile. Everything here is synthetic, like tools/perf/fixture.mjs: no real book, no ST.
const perf = params.get('perf') === '1' ? {
    books: count('books', 40),
    entries: count('entries', 150),
    big: count('big', 1000),
    canvas: count('canvas', 500),
    keys: params.get('keys') === 'unique' ? 'unique' : 'shared',
    keyCount: count('keyCount', 4),
    long: count('long', 100000),
    chats: count('chats', 240),
} : null;

const books = new Map();
const edited = new Map();
let globals = new Set(['WIHero-Sample']);
const BIG = 'Perf Big';
const asBook = entries => ({ entries: Object.fromEntries(entries.map(e => [e.uid, e])) });
const pad = n => String(n).padStart(3, '0');
/** Moments only exist on the canvas: place them, or opening a generated book would prune them (canvas-graph). */
function momentCanvas(entries) {
    const cards = {};
    for (const e of entries) {
        const cfg = e.extensions?.wihero;
        if (cfg?.moment && cfg.id) cards[`id:${cfg.id}`] = { placed: true };
    }
    return { camera: null, cards, placed: true };
}

/** The disposable optimization profile: deterministic, in memory, and never written to a real library. */
function seedPerf() {
    globals = new Set();
    for (let i = 0; i < perf.books; i++) {
        const name = `Perf Book ${pad(i + 1)}`;
        const entries = perfBook(perf.entries, { world: name, seed: 1000 + i * 7919, keyShape: perf.keys, keysPerEntry: perf.keyCount });
        books.set(name, asBook(entries));
        settings.books[name] = { defaults: {}, folders: {}, canvas: momentCanvas(entries) };
        edited.set(name, Date.now() - i * 60000);
    }
    const entries = perfBook(perf.big, { world: BIG, seed: 4242, keyShape: perf.keys, keysPerEntry: perf.keyCount });
    // One 100 KB entry for the typing path; the book still has exactly `big` entries.
    entries[0].comment = 'Perf long entry';
    entries[0].content = 'The mill at the harbor keeps its own hours. '.repeat(Math.ceil(perf.long / 44)).slice(0, perf.long);
    const mem = placedCanvas(entries, { seed: 77 });
    const moments = new Set(entries.filter(e => e.extensions?.wihero?.moment).map(e => `id:${e.extensions.wihero.id}`));
    const ordered = [...moments].filter(k => mem.cards[k]).concat(Object.keys(mem.cards).filter(k => !moments.has(k)));
    const cards = {};
    for (const key of ordered.slice(0, perf.canvas)) cards[key] = { ...mem.cards[key], placed: true };
    settings.books[BIG] = { defaults: {}, folders: {}, canvas: { camera: null, cards, placed: true } };
    books.set(BIG, asBook(entries));
    edited.set(BIG, Date.now());
}

async function loadBooks() {
    if (perf) { seedPerf(); return; }
    for (const name of ['WIHero-Sample', 'WIHero-N1']) books.set(name, await (await fetch(`../../examples/${name}.json`)).json());
    const made = { 'Moonlit Keep': 11, 'Harbor Town': 24, 'Sky Ruins': 6, 'Old Notes': 2, 'Witch Hunt': 15 };
    for (const [name, n] of Object.entries(made)) {
        const entries = {};
        for (let uid = 0; uid < n; uid++) entries[uid] = { ...structuredClone(TEMPLATE), uid, comment: `${name.split(' ')[0]} ${uid + 1}`, key: [`word${uid}`, `term${uid}`], content: `Entry ${uid + 1} of ${name}.`, constant: uid === 0, disable: uid === n - 1 };
        books.set(name, { entries });
    }
    if (!settings.bookFolders || !Object.keys(settings.bookFolders).length) settings.bookFolders = { Campaigns: ['Moonlit Keep', 'Witch Hunt'] };
    for (const [i, name] of [...books.keys()].entries()) edited.set(name, Date.now() - i * 86400000 * 3);
}

let app = null;
const copies = new Map();
let version = 0;
// The `?slow` observability hook: writes only the harness page memory. Each read records its start and how many run
// at once; `peek` answers null until that read has finished, as SillyTavern's own cache does before a book is loaded.
const loadState = slowMs ? { log: [], loaded: new Set(), active: 0, maxActive: 0, activeByName: new Set(), duplicate: false } : null;
let library = {
    names: () => [...books.keys()].sort((a, b) => a.localeCompare(b)),
    get: async name => {
        if (!loadState) return library.peek(name);
        loadState.log.push({ name, at: performance.now() });
        if (loadState.activeByName.has(name)) loadState.duplicate = true;
        loadState.activeByName.add(name);
        loadState.active++;
        loadState.maxActive = Math.max(loadState.maxActive, loadState.active);
        try {
            await new Promise(resolve => setTimeout(resolve, slowMs));
            loadState.loaded.add(name);
            return library.peek(name);
        } finally {
            loadState.active--;
            loadState.activeByName.delete(name);
        }
    },
    peek: name => {
        if (!books.has(name)) return null;
        if (loadState && !loadState.loaded.has(name)) return null;
        if (!copies.has(name)) copies.set(name, structuredClone(books.get(name)));
        return copies.get(name);
    },
    seen: () => {},
    change(name, fn, { quiet = false } = {}) {
        const data = library.peek(name);
        if (!data) return undefined;
        let out;
        try { out = fn(data); } finally { version++; }
        edited.set(name, Date.now());
        if (!quiet) app?.refresh();
        return out;
    },
    get version() { return version; },
    // The harness has one revision: the layout checks do not exercise per-book cache invalidation.
    bookVersion: () => version,
    edited: name => edited.get(name) ?? null,
    save: async () => {},
    flush: async () => {},
    onWorldInfoUpdated: () => {},
    nameProblem: (n, current = null) => {
        n = String(n ?? '').trim();
        if (!n) return 'Type a name';
        if (n !== current && library.names().some(x => x.toLowerCase() === n.toLowerCase())) return 'A book with that name exists';
        return null;
    },
    create: async name => { books.set(name, { entries: {} }); edited.set(name, Date.now()); app?.refresh(); return name; },
    replace: async (name, data) => { const old = library.peek(name); copies.set(name, structuredClone(data)); app?.refresh(); return old; },
    duplicate: async name => { let n = `${name} copy`; for (let i = 2; books.has(n); i++) n = `${name} copy ${i}`; books.set(n, structuredClone(library.peek(name))); return n; },
    remove: async name => { books.delete(name); copies.delete(name); globals.delete(name); },
    rename: async (name, to) => { books.set(to, books.get(name)); copies.set(to, library.peek(name)); books.delete(name); copies.delete(name); if (globals.delete(name)) globals.add(to); return to; },
    exportBook: async () => {},
    isGlobal: name => globals.has(name),
    setGlobal: (name, on) => { if (on) globals.add(name); else globals.delete(name); app?.refresh(); },
    links: name => (name === 'WIHero-N1' ? [{ name: 'Seraphina', kind: 'char', avatar: 'Seraphina.png' }, { name: 'Road trip', kind: 'chat' }] : []),
    unlink: async () => {},
    linkChat: async () => {},
    chatOpen: () => false,
    chatBook: () => null,
    wiSettings: () => ({ depth: 2, recursive: true, maxRecursion: 0, minActivations: 0, minActivationsDepth: 0, caseSensitive: false, wholeWords: false, includeNames: true, groupScoring: false, budget: 25, budgetCap: 0, overflowAlert: false, bookOrder: 1, maxContext: 8192 }),
    setWiSetting: () => {},
};
const snapshots = { seed: async () => {}, list: () => [], take: async () => {}, restore: async () => ({}), rename: () => {}, forget: () => {}, keep: () => {}, removeFile: () => {}, removeAll: async () => {} };
const hooks = { model: { nodes: new Map() }, state: () => ({ closed: {}, fired: {} }), reopenEntry: async () => {} };
// Under `perf`, a counting stand-in for ST's tokenizer, so the typing step can report how many times the page asked.
const countTokens = async text => {
    globalThis.__perfTokenCalls = (globalThis.__perfTokenCalls ?? 0) + 1;
    return Math.ceil(String(text ?? '').length / 4);
};
const perfChatLog = perf ? perfChat({ turns: perf.chats, long: true }) : null;
// A greeting-capable character for the no-chat Hero checks. The harness has no chats; its worlds stay in memory.
const HARNESS_CHARACTERS = perf ? [] : [{
    name: 'Seraphina', avatar: 'Seraphina.png',
    first_mes: 'The keeper looks up from the ledger. “You made it before the rain.”',
    data: { alternate_greetings: ['The bell over the door rings twice.', 'A letter waits on the table, already opened.'] },
}, {
    name: 'Bob', avatar: 'Bob.png',
    first_mes: 'Bob waves from the yard.',
    data: { alternate_greetings: ['Bob is already at the gate.'] },
}];
const ctx = () => (perf
    ? { chat: perfChatLog, characters: [], getTokenCountAsync: countTokens }
    : { chat: [], characters: HARNESS_CHARACTERS, getTokenCountAsync: null });

await loadBooks();
// Under `perf`, the seeded books get their real model and a state object the page test can change, so Hero's chat
// state has something to show (closed, holding, fired) without a chat. The default harness keeps its empty one.
let harnessState = null;
if (perf) {
    const entries = [];
    for (const [name, data] of books) for (const entry of Object.values(data.entries)) entries.push({ ...entry, world: name });
    hooks.model = buildModel(entries);
    harnessState = {
        v: 2, at: -1, fired: {}, firstAt: {}, lastAt: {}, closed: {}, holding: {}, latches: {}, baseline: {},
        masks: { closed: {}, pick: {} }, round: [], rolls: {}, written: {}, wrote: {}, byHand: {},
    };
    hooks.state = () => harnessState;
}
// Optional real save lifecycle, including ST's programmatic dropdown event on editor reload.
if (params.has('saves')) {
    const controls = globalThis.wiheroHarness = { writeDelay: 20, deleteDelay: 0, failDelete: false, snapshots, loads: 0 };
    const host = {
        getRequestHeaders: () => ({}), updateWorldInfoList: async () => {}, saveSettingsDebounced() {},
        characters: [], chatMetadata: {},
        getWorldInfoNames: () => [...books.keys()],
        loadWorldInfo: async name => { controls.loads++; return structuredClone(books.get(name)); },
        reloadWorldInfoEditor: name => { if (!library.busy()) app.openBook(name); },
    };
    library = Object.setPrototypeOf(createLibrary({
        ctx: () => host, WI: { world_info: {}, deleteWorldInfo: async name => {
            await new Promise(resolve => setTimeout(resolve, controls.deleteDelay));
            return controls.failDelete ? false : books.delete(name);
        } }, settings, saveSettings,
        writeBook: async (name, data) => {
            await new Promise(resolve => setTimeout(resolve, controls.writeDelay));
            books.set(name, structuredClone(data));
            library.onWorldInfoUpdated(name, data);
        },
        onChange: () => app?.refresh(),
        // M2, as index.js wires it: Home counts from summaries, and the open/undo books stay loaded.
        summarize: (name, data) => app?.summarizeBook?.(name, data) ?? { entries: Object.keys(data?.entries ?? {}).length },
        pinned: () => app?.pinnedBooks?.() ?? [],
    }), library);
}
app = createApp({
    ctx, library, snapshots, hooks, settings, saveSettings, entryTemplate: TEMPLATE,
    cssUrl: new URL('../../src/ui/app.css', import.meta.url).href,
    openStEditor: () => {},
    onVisible: open => document.getElementById('wi-button').classList.toggle('lit', open),
});
document.getElementById('wi-button').addEventListener('click', () => app.toggle());
globalThis.wihero = { app, ready: Promise.resolve(app), library, settings, perf: perfCounters, dispose: () => app?.destroy?.(), ...(harnessState ? { hooks } : {}) };
if (loadState) globalThis.wiheroHarnessLoads = loadState;
if (perf) {
    // Left closed so the runner can time the page's first tab; the profile it actually seeded is reported with each
    // measurement.
    globalThis.__perfTokenCalls = 0;
    globalThis.wiheroHarnessProfile = { ...perf };
} else if (!params.has('closed')) app.show();
