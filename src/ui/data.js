// Pure helpers over a book's data ({ entries: { uid: entry } }) and WI Hero's own settings (BUILD_SPEC 8.2).
// No DOM, no SillyTavern imports, so they are tested with node --test.
import { FIELD, normalize, rawConfig } from '../engine/model.js';
import { slugify, uniqueId } from '../engine/util.js';
import { writeConfig } from '../book.js';

// ---------------------------------------------------------------- entries

/** keys · perm · vec · off (VISUAL 6.1). */
export const strategyOf = e => e.disable ? 'off' : e.constant ? 'perm' : e.vectorized ? 'vec' : 'keys';
export const STRATEGY_NAME = { keys: 'Keywords', perm: 'Permanent', vec: 'Vectorized', off: 'Off' };
export const STRATEGY_HELP = { keys: 'Fires when a key word appears', perm: 'Always in the prompt (ST: Constant)', vec: 'Fires on a match in meaning, and on key words' };

export function setStrategy(entry, strategy) {
    entry.constant = strategy === 'perm';
    entry.vectorized = strategy === 'vec';
}

/** ST's selectiveLogic values with LAYOUT's words. */
export const LOGIC = [[0, 'And any of'], [3, 'And all of'], [2, 'But none of'], [1, 'But not all of']];
export const logicName = v => (LOGIC.find(([k]) => k === Number(v)) ?? LOGIC[0])[1];

export const entriesOf = data => Object.values(data?.entries ?? {});
export const titleOf = e => e?.comment || (Array.isArray(e?.key) && e.key[0]) || 'Untitled';
export const idOf = e => rawConfig(e)?.id;
/** The story logic in the current shape, or null. */
export const configOf = e => { const raw = rawConfig(e); return raw ? normalize(raw).config : null; };

/** Where WI Hero files an entry in its settings: `id:<wihero id>`, or `uid:<n>` for one without an id. */
export const cardKey = e => idOf(e) ? `id:${idOf(e)}` : `uid:${e.uid}`;

/** A rough token estimate, shown until ST's own count arrives. */
export const tokenGuess = text => Math.round(String(text ?? '').length / 3.8);

export function freeUid(data) {
    for (let uid = 0; uid < 1_000_000; uid++) if (!(uid in data.entries)) return uid;
    return null;
}

/**
 * Adds a new entry from ST's template, with the book's New entry defaults on top.
 * @returns {object} the entry
 */
export function addEntry(data, template, defaults = {}, fields = {}) {
    const uid = freeUid(data);
    const entry = { uid, ...structuredClone(template), ...structuredClone(defaults), ...fields, uid };
    entry.displayIndex ??= uid;
    data.entries[uid] = entry;
    return entry;
}

/** The ids used in a book's entries. */
export const idsIn = data => new Set(entriesOf(data).map(idOf).filter(Boolean));

/** A copy of an entry in the same book: a new uid and, if it has story logic, a fresh id (BUILD_SPEC 2.4). */
export function duplicateEntry(data, uid) {
    const source = data.entries[uid];
    const copy = structuredClone(source);
    copy.uid = freeUid(data);
    copy.comment = `${titleOf(source)} copy`;
    data.entries[copy.uid] = copy;
    const config = configOf(source);
    if (config?.id) writeConfig(data, copy.uid, { ...config, id: uniqueId(slugify(copy.comment) || `entry-${copy.uid}`, idsIn(data)) });
    return copy;
}

/**
 * Moves an entry to another book. Its id stays unless the target book has it already. Links to other entries
 * of the old book don't travel (refs are per book), and are left as they are, so the target reports them.
 * @returns {object} the entry in the target book
 */
export function moveEntry(from, uid, to) {
    const entry = structuredClone(from.entries[uid]);
    removeEntry(from, uid);
    entry.uid = freeUid(to);
    to.entries[entry.uid] = entry;
    const config = configOf(entry);
    if (config?.id && idsIn({ entries: Object.fromEntries(Object.entries(to.entries).filter(([k]) => Number(k) !== entry.uid)) }).has(config.id)) {
        writeConfig(to, entry.uid, { ...config, id: uniqueId(config.id, idsIn(to)) });
    }
    return entry;
}

/**
 * Deletes an entry. For a book imported from a card, its `originalData` entry goes too, like ST's own delete
 * (world-info.js deleteWIOriginalDataValue), so a later entry given the same uid doesn't pick up the old one.
 */
export function removeEntry(data, uid) {
    delete data.entries[uid];
    const original = data.originalData?.entries;
    if (!Array.isArray(original)) return;
    // Loose equality like ST's: card uids can be strings.
    const i = original.findIndex(x => x?.uid == uid);
    if (i >= 0) original.splice(i, 1);
}

/** "Copy as text": the name, the key words and the content. */
export function entryAsText(e) {
    const keys = (e.key ?? []).join(', ');
    return [titleOf(e), keys && `Key words: ${keys}`, '', e.content ?? ''].filter(x => x !== false && x !== undefined).join('\n').trim();
}

/** An entry that was never filled in: discarded when its new page is left (LAYOUT "+ New"). */
export const isBlank = e => !e.comment && !(e.key ?? []).length && !(e.content ?? '').trim() && !rawConfig(e);

// ---------------------------------------------------------------- parameters

const POSITIONS = [[0, 'Before character'], [1, 'After character'], [5, 'Before examples'], [6, 'After examples'], [2, 'Top of Author\'s Note'], [3, 'Bottom of Author\'s Note'], [4, 'At depth'], [7, 'Outlet']];
const ROLES = [[0, 'System'], [1, 'User'], [2, 'Assistant']];
const TRI = [[null, 'Use global'], [true, 'Yes'], [false, 'No']];
const BY = [[null, 'Anyone'], ['user', 'Your messages'], ['char', 'Character\'s replies']];

/**
 * The entry page's Parameters (LAYOUT "Entry page"), in groups. Each: { field, label, type, options?, def, unit?, when? }.
 * `by` is WI Hero's own (Who triggers), stored in the story logic.
 */
export const PARAMS = [
    ['Placement', [
        { field: 'position', label: 'Position', type: 'enum', options: POSITIONS, def: 0 },
        { field: 'depth', label: 'Depth', type: 'int', def: 4, min: 0, when: e => Number(e.position) === 4 },
        { field: 'role', label: 'Role', type: 'enum', options: ROLES, def: 0, when: e => Number(e.position) === 4 },
        { field: 'outletName', label: 'Outlet name', type: 'text', def: '', when: e => Number(e.position) === 7 },
        { field: 'order', label: 'Order', type: 'int', def: 100 },
    ]],
    ['Chance and timing', [
        { field: 'probability', label: 'Probability', type: 'int', def: 100, min: 0, max: 100, unit: '%' },
        { field: 'sticky', label: 'Sticky', type: 'int', def: 0, min: 0, unit: ' messages' },
        { field: 'cooldown', label: 'Cooldown', type: 'int', def: 0, min: 0, unit: ' messages' },
        { field: 'delay', label: 'Delay', type: 'int', def: 0, min: 0, unit: ' messages' },
    ]],
    ['Matching', [
        { field: 'scanDepth', label: 'Scan depth', type: 'int', def: null, min: 0, optional: true },
        { field: 'caseSensitive', label: 'Case-sensitive', type: 'enum', options: TRI, def: null },
        { field: 'matchWholeWords', label: 'Whole words', type: 'enum', options: TRI, def: null },
        { field: 'excludeRecursion', label: 'Can\'t be triggered by other entries', type: 'bool', def: false },
        { field: 'preventRecursion', label: 'Doesn\'t trigger other entries', type: 'bool', def: false },
        { field: 'by', label: 'Who triggers', type: 'enum', options: BY, def: null, logic: true },
    ]],
    ['Limits', [
        { field: 'group', label: 'Inclusion group', type: 'text', def: '' },
        { field: 'ignoreBudget', label: 'Ignore budget', type: 'bool', def: false },
    ]],
];
export const PARAM_LIST = PARAMS.flatMap(([, list]) => list);

export function paramValue(e, p) {
    if (p.logic) return configOf(e)?.[p.field] ?? p.def;
    const v = e[p.field];
    return v === undefined || (v === null && p.def !== null) ? p.def : v;
}

export function paramText(e, p) {
    const v = paramValue(e, p);
    if (p.type === 'enum') return (p.options.find(([k]) => k === v || (k !== null && v !== null && String(k) === String(v))) ?? p.options[0])[1];
    if (p.type === 'bool') return v ? 'Yes' : 'No';
    if (v === null || v === '' || v === undefined) return p.optional ? 'Use global' : p.type === 'text' ? 'None' : String(p.def);
    return `${v}${p.unit ?? ''}`;
}

const isDefault = (e, p) => {
    const v = paramValue(e, p);
    return v === p.def || (v === undefined) || (p.def === null && v === null) || (p.type === 'text' && !v && !p.def) || (p.type === 'bool' && !v && !p.def);
};

/** The folded Parameters header: what isn't default, or "Defaults". */
export function paramSummary(e) {
    const changed = PARAM_LIST.filter(p => (!p.when || p.when(e)) && !isDefault(e, p));
    return changed.length ? changed.map(p => `${p.label} ${paramText(e, p)}`).join(', ') : 'Defaults';
}

/** Sets a parameter on an entry. `by` goes into the story logic; probability also turns useProbability on, like ST. */
export function setParam(data, uid, p, value) {
    const e = data.entries[uid];
    if (p.logic) {
        const config = { ...(configOf(e) ?? {}) };
        if (value === null) delete config[p.field]; else config[p.field] = value;
        if (!config.id && Object.keys(config).length) config.id = uniqueId(slugify(titleOf(e)) || `entry-${uid}`, idsIn(data));
        writeConfig(data, uid, Object.keys(config).filter(k => k !== 'id').length ? config : (config.id && rawConfig(e) ? config : null));
        return;
    }
    e[p.field] = value;
    if (p.field === 'probability') e.useProbability = true;
}

// ---------------------------------------------------------------- settings (BUILD_SPEC 8.2)

export const DEFAULT_UI = Object.freeze({ openInHero: false, contentFont: 'serif', colorMode: 'standard', bookFolders: {}, books: {}, renamed: {} });

/** Fills in WI Hero's settings in place. */
export function ensureSettings(s) {
    for (const [k, v] of Object.entries(DEFAULT_UI)) if (s[k] === undefined) s[k] = structuredClone(v);
    return s;
}

export const bookSettings = (s, book) => (s.books[book] ??= { defaults: {}, folders: {} });

export const folderOf = (s, book, e) => s.books?.[book]?.folders?.[cardKey(e)] ?? '';

export function setFolder(s, book, e, folder) {
    const folders = bookSettings(s, book).folders;
    const f = String(folder ?? '').split('/').map(x => x.trim()).filter(Boolean).join('/');
    if (f) folders[cardKey(e)] = f; else delete folders[cardKey(e)];
}

/** Moves the old build's folder and color (from upgradeBook) into the settings. Colors are dropped (D22). */
export function adoptUiFields(s, book, data, ui) {
    for (const [uid, fields] of Object.entries(ui ?? {})) {
        const e = data.entries[uid];
        if (e && typeof fields.folder === 'string' && fields.folder && !folderOf(s, book, e)) setFolder(s, book, e, fields.folder);
    }
}

/** When an entry gets its first id, its settings move from `uid:` to `id:`. */
export function rekeyEntry(s, book, uid, id) {
    const b = s.books?.[book];
    if (!b) return;
    for (const map of [b.folders, b.canvas?.cards].filter(Boolean)) {
        if (map[`uid:${uid}`] !== undefined && map[`id:${id}`] === undefined) map[`id:${id}`] = map[`uid:${uid}`];
        delete map[`uid:${uid}`];
    }
}

export const bookFolderOf = (s, name) => Object.entries(s.bookFolders).find(([, list]) => list.includes(name))?.[0] ?? '';

export function setBookFolder(s, name, folder) {
    for (const [f, list] of Object.entries(s.bookFolders)) {
        s.bookFolders[f] = list.filter(n => n !== name);
        if (!s.bookFolders[f].length) delete s.bookFolders[f];
    }
    const f = String(folder ?? '').trim();
    if (f) (s.bookFolders[f] ??= []).push(name);
}

/** A book renamed: its settings move, chats keep their state through `renamed` (BUILD_SPEC 4.2, 8.2). */
export function renameBookSettings(s, from, to) {
    if (s.books[from]) { s.books[to] = s.books[from]; delete s.books[from]; }
    const folder = bookFolderOf(s, from);
    if (folder) { setBookFolder(s, from, ''); setBookFolder(s, to, folder); }
    for (const [old, now] of Object.entries(s.renamed)) if (now === from) s.renamed[old] = to;
    s.renamed[from] = to;
    delete s.renamed[to];
}

export function deleteBookSettings(s, name) {
    delete s.books[name];
    setBookFolder(s, name, '');
}

export function copyBookSettings(s, from, to) {
    if (s.books[from]) s.books[to] = structuredClone({ ...s.books[from], snapshots: [] });
    const folder = bookFolderOf(s, from);
    if (folder) setBookFolder(s, to, folder);
}

// ---------------------------------------------------------------- lists

/**
 * Groups a book's entries for the book page: by folder (nested names kept whole, "" first), by strategy, or none.
 * @returns {[string, object[]][]}
 */
/** The orders entries can be sorted in, inside each folder (LAYOUT "Book page"). */
export const SORT_NAMES = { order: 'Order', az: 'A–Z', keys: 'Key words first', perm: 'Permanent first', vec: 'Vectorized first' };

/** Sorts entries: ST's order (displayIndex), A–Z, or one strategy first (then the rest in order, off entries last). */
export function sortEntries(entries, by = 'order') {
    const order = (a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid;
    const rank = e => { const s = strategyOf(e); return s === by ? 0 : s === 'off' ? 2 : 1; };
    const cmp = by === 'az' ? (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base', numeric: true }) || order(a, b)
        : SORT_NAMES[by] && by !== 'order' ? (a, b) => rank(a) - rank(b) || order(a, b)
        : order;
    return [...entries].sort(cmp);
}

/**
 * Folders are containers: entries are grouped by folder (no folder first, then folders A–Z) and sorted inside each.
 * @returns {[string, object[]][]}
 */
export function groupEntries(entries, by, folder) {
    const groups = new Map();
    for (const e of sortEntries(entries, by)) {
        const k = folder(e);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
    }
    return [...groups.entries()].sort(([a], [b]) => (a !== '') - (b !== '') || a.localeCompare(b));
}

/**
 * Search (LAYOUT "Search overlay"): book names, folder names, entry names and key words in every book.
 * @param {{ name: string, folder: string, entries: object[], folderOf: (e) => string }[]} books
 * @returns {{ kind: 'entry' | 'book' | 'folder', book?: string, entry?: object, folder?: string, current?: boolean }[]}
 *   the current book's entries first, then other books' entries, then books, then folders.
 */
export function search(books, query, currentBook) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    const has = t => String(t ?? '').toLowerCase().includes(q);
    const mine = [];
    const others = [];
    const bookHits = [];
    const folders = new Map();
    for (const b of books) {
        if (has(b.name)) bookHits.push({ kind: 'book', book: b.name });
        if (b.folder && has(b.folder)) folders.set(`b:${b.folder}`, { kind: 'folder', folder: b.folder });
        for (const e of b.entries) {
            const f = b.folderOf(e);
            if (f && has(f)) folders.set(`${b.name}:${f}`, { kind: 'folder', book: b.name, folder: f });
            if (has(titleOf(e)) || (e.key ?? []).some(has)) (b.name === currentBook ? mine : others).push({ kind: 'entry', book: b.name, entry: e, current: b.name === currentBook });
        }
    }
    // In a book, its entries come first; with no book open, the books do.
    if (!currentBook) return [...bookHits, ...folders.values(), ...others];
    return [...mine, ...others, ...bookHits, ...folders.values()];
}

/** Values of the selected entries for bulk Edit…: the value, or MIXED when they differ. */
export const MIXED = Symbol('mixed');
export function commonValue(entries, p) {
    const values = entries.map(e => JSON.stringify(paramValue(e, p) ?? null));
    return new Set(values).size === 1 ? paramValue(entries[0], p) : MIXED;
}

export { FIELD };
