// The stand-in for SillyTavern behind harness.html: an in-memory library of books (the examples, and a few made up
// here), WI Hero's settings in localStorage, and no chat. Exposes `wihero.app` like the extension does.
import { createApp } from '../../src/ui/app.js';
import { ensureSettings } from '../../src/ui/data.js';

const TEMPLATE = { key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: null, sticky: null, cooldown: null, delay: null };

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') document.documentElement.classList.add('light');
const KEY = 'wihero-harness-settings';
if (params.has('reset')) localStorage.removeItem(KEY);
const settings = ensureSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
const saveSettings = () => localStorage.setItem(KEY, JSON.stringify(settings));

const books = new Map();
const edited = new Map();
let globals = new Set(['WIHero-Sample']);
async function loadBooks() {
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
const library = {
    names: () => [...books.keys()].sort((a, b) => a.localeCompare(b)),
    get: async name => library.peek(name),
    peek: name => {
        if (!books.has(name)) return null;
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
    links: name => (name === 'WIHero-N1' ? [{ name: 'Seraphina', kind: 'char' }, { name: 'Road trip', kind: 'chat' }] : []),
    unlink: async () => {},
    linkChat: async () => {},
    chatOpen: () => false,
    chatBook: () => null,
    wiSettings: () => ({ depth: 2, recursive: true, maxRecursion: 0, minActivations: 0, minActivationsDepth: 0, caseSensitive: false, wholeWords: false, includeNames: true, groupScoring: false, budget: 25, budgetCap: 0, overflowAlert: false, bookOrder: 1, maxContext: 8192 }),
    setWiSetting: () => {},
};
const snapshots = { seed: async () => {}, list: () => [], take: async () => {}, restore: async () => ({}), rename: () => {}, forget: () => {}, keep: () => {}, removeFile: () => {}, removeAll: async () => {} };
const hooks = { model: { nodes: new Map() }, state: () => ({ closed: {}, fired: {} }), reopenEntry: async () => {} };
const ctx = () => ({ chat: [], characters: [], getTokenCountAsync: null });

await loadBooks();
app = createApp({
    ctx, library, snapshots, hooks, settings, saveSettings, entryTemplate: TEMPLATE,
    cssUrl: new URL('../../src/ui/app.css', import.meta.url).href,
    openStEditor: () => {},
    onVisible: open => document.getElementById('wi-button').classList.toggle('lit', open),
});
document.getElementById('wi-button').addEventListener('click', () => app.toggle());
globalThis.wihero = { app, library, settings };
if (!params.has('closed')) app.show();
