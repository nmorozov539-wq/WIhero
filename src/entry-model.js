// Editing an entry's own ST fields from the workspace, and finding unlinked mentions. Pure, no DOM.
import { FIELD, entryKey } from './engine.js';
import { slugify } from './editor-model.js';

const POSITIONS = [[0, '↑Char'], [1, '↓Char'], [2, '↑AN'], [3, '↓AN'], [4, '@D'], [5, '↑EM'], [6, '↓EM'], [7, 'Outlet']];
const LOGIC = [[0, 'AND ANY'], [1, 'NOT ALL'], [2, 'NOT ANY'], [3, 'AND ALL']];
const TRISTATE = [['', 'Use global'], ['true', 'Yes'], ['false', 'No']];

/**
 * The ST fields the workspace edits, by tab. `type`: text, list (comma separated), textarea, int, bool,
 * select (numbers), tristate (null / true / false). `more` fields sit under "More".
 */
export const ENTRY_FIELDS = Object.freeze([
    { field: 'comment', label: 'Title', type: 'text' },
    { field: 'key', label: 'Keywords', type: 'list' },
    { field: 'keysecondary', label: 'Optional filter', type: 'list' },
    { field: 'selectiveLogic', label: 'Filter logic', type: 'select', options: LOGIC },
    { field: 'content', label: 'Content', type: 'textarea' },
    { field: 'position', label: 'Position', type: 'select', options: POSITIONS },
    { field: 'depth', label: 'Depth', type: 'int', min: 0 },
    { field: 'order', label: 'Order', type: 'int' },
    { field: 'probability', label: 'Trigger %', type: 'int', min: 0, max: 100 },
    { field: 'disable', label: 'Disabled', type: 'bool' },
    { field: 'constant', label: 'Constant (always on)', type: 'bool' },
    { field: 'group', label: 'Inclusion group', type: 'text', more: true },
    { field: 'scanDepth', label: 'Scan depth', type: 'int', min: 0, optional: true, more: true },
    { field: 'caseSensitive', label: 'Case-sensitive', type: 'tristate', options: TRISTATE, more: true },
    { field: 'matchWholeWords', label: 'Whole words', type: 'tristate', options: TRISTATE, more: true },
    { field: 'excludeRecursion', label: 'Non-recursable', type: 'bool', more: true },
    { field: 'preventRecursion', label: 'Prevent further recursion', type: 'bool', more: true },
    { field: 'ignoreBudget', label: 'Ignore budget', type: 'bool', more: true },
]);
export const TIMER_FIELDS = Object.freeze([
    { field: 'sticky', label: 'Sticky (messages)', type: 'int', min: 0 },
    { field: 'cooldown', label: 'Cooldown (messages)', type: 'int', min: 0 },
    { field: 'delay', label: 'Delay (messages)', type: 'int', min: 0 },
]);

/** A form value as text, for an input. */
export function fieldText(spec, value) {
    if (spec.type === 'list') return (value ?? []).join(', ');
    if (spec.type === 'bool') return !!value;
    if (spec.type === 'tristate') return value === null || value === undefined ? '' : String(value);
    return value === null || value === undefined ? '' : String(value);
}

/** Parses an input's value: `{ value }`, or `{ error }`. */
export function parseField(spec, raw) {
    switch (spec.type) {
        case 'list': return { value: String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean) };
        case 'bool': return { value: !!raw };
        case 'tristate': return { value: raw === '' ? null : raw === 'true' };
        case 'select': return { value: Number(raw) };
        case 'int': {
            const text = String(raw ?? '').trim();
            if (text === '' && spec.optional) return { value: null };
            const n = Number(text);
            if (text === '' || !Number.isInteger(n) || n < (spec.min ?? -Infinity) || n > (spec.max ?? Infinity)) {
                return { error: `${spec.label}: a whole number${spec.min !== undefined ? ` from ${spec.min}` : ''}${spec.max !== undefined ? ` to ${spec.max}` : ''}` };
            }
            return { value: n };
        }
        default: return { value: String(raw ?? '') };
    }
}

/**
 * The fields that differ between an entry and a form.
 * @param {object} entry The book entry.
 * @param {object[]} specs Fields shown.
 * @param {(field: string) => unknown} read The form's raw value of a field.
 * @returns {{ changes: object, errors: string[] }}
 */
export function formChanges(entry, specs, read) {
    const changes = {};
    const errors = [];
    for (const spec of specs) {
        const { value, error } = parseField(spec, read(spec.field));
        if (error) errors.push(error);
        else if (JSON.stringify(value) !== JSON.stringify(entry[spec.field] ?? (spec.type === 'list' ? [] : spec.type === 'bool' ? false : null))) changes[spec.field] = value;
    }
    return { changes, errors };
}

function setPath(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = object;
    for (const key of keys) target = target[key] ??= {};
    target[last] = value;
}

/**
 * Writes changes onto a book entry, and onto its originalData copy for books imported from a character card,
 * with ST's own field map (originalWIDataKeyMap), as ST's editor does.
 */
export function applyEntryChanges(data, uid, changes, keyMap) {
    const entry = data.entries[uid];
    const original = data.originalData?.entries?.find?.(x => x.uid === entry.uid);
    for (const [field, value] of Object.entries(changes)) {
        entry[field] = value;
        if (field === 'probability') entry.useProbability = true;
        if (!original) continue;
        if (field === 'disable') setPath(original, 'enabled', !value);
        else if (keyMap[field]) setPath(original, keyMap[field], value);
        if (field === 'position') original.position = value === 0 ? 'before_char' : 'after_char';
    }
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Entries whose content mentions one of this entry's keywords but that aren't linked to it either way.
 * Regex keywords are skipped; matches are whole words, ignoring case.
 * @param {object[]} entries The book's entries (with `world`).
 * @param {{ links: object[] }} graph buildGraph() of the book.
 * @param {Set<string>} ignored Keys of entries the user told to ignore for this one.
 * @returns {{ entry: object, keyword: string }[]}
 */
export function unlinkedMentions(entries, graph, target, ignored = new Set()) {
    const key = entryKey(target);
    const words = (target.key ?? []).filter(k => k && !/^\/.+\/[a-z]*$/s.test(k));
    if (!words.length) return [];
    const linked = new Set(graph.links.flatMap(l => l.from === key ? [l.to] : l.to === key ? [l.from] : []));
    const found = [];
    for (const other of entries) {
        const okey = entryKey(other);
        if (okey === key || linked.has(okey) || ignored.has(okey)) continue;
        const keyword = words.find(w => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(other.content ?? ''));
        if (keyword) found.push({ entry: other, keyword });
    }
    return found;
}

/** An id for an entry that has none: its title or first keyword as a slug, made unique. */
export function newId(entry, taken) {
    const base = slugify(entry.comment || entry.key?.[0]) || `entry-${entry.uid}`;
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    return id;
}

/**
 * "Gate X on Y": X waits for Y. Gives either an id if it has none.
 * @param {object} data The book's data, changed in place.
 * @param {Set<string>} taken Ids in use among the loaded books.
 * @returns {{ from: string, on: string }} The two ids.
 */
export function gateOn(data, fromUid, onUid, taken) {
    const ensure = entry => {
        entry[FIELD] ??= {};
        if (!entry[FIELD].id) {
            entry[FIELD].id = newId(entry, taken);
            taken.add(entry[FIELD].id);
        }
        return entry[FIELD].id;
    };
    const on = ensure(data.entries[onUid]);
    const from = ensure(data.entries[fromUid]);
    const config = data.entries[fromUid][FIELD];
    config.gates = [...new Set([...(config.gates ?? []), on])];
    return { from, on };
}
