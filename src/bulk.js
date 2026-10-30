// Folders and bulk edits of a book's entries. Pure: works on a book's data object, no DOM, no ST imports.
// Folders and colors are UI only: they never affect gating (engine.js ignores a config holding only them).
import { FIELD } from './engine.js';

/** Colors an entry can be tagged with (wihero.color), and how they're drawn. */
export const COLORS = Object.freeze({
    red: '#d9534f', orange: '#e8873d', yellow: '#d4b42a', green: '#4fa65a',
    teal: '#2fa39a', blue: '#4a7fd1', purple: '#8a5cc9', pink: '#d0659f', gray: '#8a8a8a',
});

/** Shown in the folder filter for entries without a folder. */
export const NO_FOLDER = '\u0000none';

/** 'Town X / Inn/' → 'Town X/Inn'. */
export const normalizeFolder = folder => String(folder ?? '').split('/').map(s => s.trim()).filter(Boolean).join('/');

export const folderOf = entry => normalizeFolder(entry?.[FIELD]?.folder);

/** Whether an entry is in a folder or one of its subfolders. '' is every entry, NO_FOLDER the ones without. */
export function inFolder(entry, folder) {
    if (!folder) return true;
    const own = folderOf(entry);
    if (folder === NO_FOLDER) return !own;
    return own === folder || own.startsWith(`${folder}/`);
}

/** Every folder in use, parents included, sorted. */
export function folderList(entries) {
    const all = new Set();
    for (const entry of entries) {
        const parts = folderOf(entry).split('/').filter(Boolean);
        parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')));
    }
    return [...all].sort((a, b) => a.localeCompare(b));
}

/** Sets a value at a dotted path, creating objects on the way (as ST's setValueByPath). */
function setPath(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = object;
    for (const key of keys) target = target[key] ??= {};
    target[last] = value;
}

/**
 * The bulk actions. Each changes one book entry and returns the originalData fields it changed
 * (books imported from a character card keep that copy in sync, as ST's own editor does).
 * `parse` turns the typed value into `{ value }` for `apply`, or `{ error }`.
 */
export const ACTIONS = Object.freeze({
    enable: { label: 'Enable', parse: () => ({ value: null }), apply: e => { e.disable = false; return { enabled: true }; } },
    disable: { label: 'Disable', parse: () => ({ value: null }), apply: e => { e.disable = true; return { enabled: false }; } },
    probability: {
        label: 'Set trigger %', input: 'number',
        parse: v => intIn(v, 0, 100, 'a trigger % from 0 to 100'),
        apply: (e, n) => { e.probability = n; e.useProbability = true; return { 'extensions.probability': n }; },
    },
    depth: {
        label: 'Set depth', input: 'number',
        parse: v => intIn(v, 0, 10000, 'a depth of 0 or more'),
        apply: (e, n) => { e.depth = n; return { 'extensions.depth': n }; },
    },
    order: {
        label: 'Add to order', input: 'number',
        parse: v => intIn(v, -100000, 100000, 'a whole number (negative to lower the order)'),
        apply: (e, n) => { e.order = Number(e.order ?? 0) + n; return { insertion_order: e.order }; },
    },
    prefix: {
        label: 'Add keyword prefix', input: 'text',
        parse: v => String(v ?? '').trim() ? { value: String(v) } : { error: 'Enter a prefix.' },
        // Regex keys and keys that already start with the prefix are left alone.
        apply: (e, p) => {
            e.key = (e.key ?? []).map(k => k.startsWith('/') || k.startsWith(p) ? k : `${p}${k}`);
            return { keys: e.key };
        },
    },
    color: {
        label: 'Set color', input: 'color',
        parse: v => v === '' || Object.hasOwn(COLORS, v) ? { value: v } : { error: 'Pick one of the colors.' },
        apply: (e, c) => {
            if (c) (e[FIELD] ??= {}).color = c;
            else if (e[FIELD]) {
                delete e[FIELD].color;
                if (!Object.keys(e[FIELD]).length) delete e[FIELD];
            }
            return {};
        },
    },
});

function intIn(value, min, max, what) {
    const text = String(value ?? '').trim();
    const n = Number(text);
    return text !== '' && Number.isInteger(n) && n >= min && n <= max ? { value: n } : { error: `Enter ${what}.` };
}

/**
 * Applies a bulk action to every entry of a book in a folder.
 * @param {object} data A book's data ({ entries, originalData? }), changed in place.
 * @returns {{ count: number } | { error: string }}
 */
export function bulkEdit(data, folder, action, value) {
    const spec = ACTIONS[action];
    if (!spec) return { error: `unknown action ${action}` };
    const parsed = spec.parse(value);
    if (parsed.error) return { error: parsed.error };
    let count = 0;
    for (const entry of Object.values(data.entries ?? {})) {
        if (!inFolder(entry, folder)) continue;
        const changed = spec.apply(entry, parsed.value);
        const original = data.originalData?.entries?.find?.(x => x.uid === entry.uid);
        if (original) for (const [path, v] of Object.entries(changed)) setPath(original, path, v);
        count++;
    }
    return { count };
}
