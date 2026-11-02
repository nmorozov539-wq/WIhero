// Writing story logic onto a book's entries, and the save path. The pure part has no SillyTavern imports;
// saveBook takes ST's context. See BUILD_SPEC 2 and TECHNICAL_NOTES 9.
import { FIELD, normalize, rawConfig } from './engine/model.js';
import { slugify, uniqueId } from './engine/util.js';

/**
 * Sets (or with `config` null, removes) an entry's story logic at `extensions.wihero`, never replacing
 * `extensions`. The old top-level `wihero` is deleted. For a book imported from a card, `originalData` gets the
 * same, so ST's card export keeps it.
 */
export function writeConfig(data, uid, config) {
    const entry = data.entries[uid];
    const targets = [entry];
    const original = data.originalData?.entries?.find?.(x => x.uid === entry.uid || x.id === entry.uid);
    if (original) targets.push(original);
    for (const target of targets) {
        delete target[FIELD];
        if (config) {
            if (!target.extensions || typeof target.extensions !== 'object') target.extensions = {};
            target.extensions[FIELD] = structuredClone(config);
        } else if (target.extensions && typeof target.extensions === 'object') {
            delete target.extensions[FIELD];
        }
    }
}

/**
 * Brings every entry of a book to the current shape (BUILD_SPEC 2.3), for a save from WI Hero.
 * @returns {{ changed: number[], ui: Record<number, object> }} uids rewritten, and the old UI fields (folder,
 *   color) per uid, which the caller moves to the extension settings.
 */
export function upgradeBook(data) {
    const changed = [];
    const ui = {};
    for (const [uid, entry] of Object.entries(data.entries ?? {})) {
        const raw = rawConfig(entry);
        const topLevel = entry[FIELD] !== undefined;
        if (raw === undefined || raw === null) {
            if (topLevel) { writeConfig(data, uid, null); changed.push(Number(uid)); }
            continue;
        }
        const { config, ui: fields, legacy } = normalize(raw);
        if (!legacy && !topLevel) continue;
        if (Object.keys(fields).length) ui[uid] = fields;
        const empty = config && typeof config === 'object' && !Array.isArray(config) && !Object.keys(config).length;
        writeConfig(data, uid, empty ? null : config);
        changed.push(Number(uid));
    }
    return { changed, ui };
}

/** A new id for an entry: a slug of its title (or first keyword), unique within the book (BUILD_SPEC 2.4). */
export function newId(entry, taken) {
    const base = slugify(entry.comment || entry.key?.[0]) || `entry-${entry.uid}`;
    return uniqueId(base, taken);
}

/** The ids used in a book. */
export const bookIds = data => new Set(Object.values(data.entries ?? {}).map(e => rawConfig(e)?.id).filter(id => typeof id === 'string'));

/**
 * Saves a change to a book through ST's own path: a copy of ST's cache (which already has every editor edit) →
 * change → saveWorldInfo(immediately) → reload ST's editor, so it doesn't overwrite the change with its own copy.
 * @param {object} ctx SillyTavern.getContext()
 * @param {(data: object) => void | Promise<void>} change
 */
export async function saveBook(ctx, name, change) {
    const data = await ctx.loadWorldInfo(name);
    if (!data) throw new Error(`no book "${name}"`);
    await change(data);
    await ctx.saveWorldInfo(name, data, true);
    ctx.reloadWorldInfoEditor?.(name);
    return data;
}
