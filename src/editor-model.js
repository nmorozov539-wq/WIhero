// Entry editor logic: the form's fields to and from a `wihero` config, and the issues it would cause.
// No DOM, no SillyTavern imports. The block itself is in editor.js.
import { FIELD, buildModel, entryKey } from './engine.js';

/** The form for an entry without config. */
export const EMPTY_FORM = Object.freeze({
    id: '',
    gates: '',
    gateMode: 'all',
    closeGates: true,
    glue: false,
    closeKeywords: '',
    closeWhenFired: '',
    closeWhenAllFired: '',
});

/** Suggested id for an entry: its title or first key as a slug. */
export function slugify(text) {
    return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_.:-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 40);
}

/** Ids from a comma or newline separated list, trimmed, without repeats. */
export const parseIds = text => [...new Set(String(text ?? '').split(/[,\n]/).map(s => s.trim()).filter(Boolean))];

/** Keywords, one per line (they may contain commas). */
export const parseLines = text => [...new Set(String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean))];

/** Form fields for a stored config. Configs the form can't show as is (wrong types) come out as best it can. */
export function configToForm(config) {
    if (!config || typeof config !== 'object') return { ...EMPTY_FORM };
    const list = value => Array.isArray(value) ? value.join(', ') : '';
    const glue = config.glue === true || (config.glue && typeof config.glue === 'object') ? (config.glue === true ? {} : config.glue) : null;
    return {
        id: typeof config.id === 'string' ? config.id : '',
        gates: list(config.gates),
        gateMode: config.gateMode === 'any' ? 'any' : 'all',
        closeGates: config.closeGates !== false,
        glue: !!glue,
        closeKeywords: Array.isArray(glue?.closeKeywords) ? glue.closeKeywords.join('\n') : '',
        closeWhenFired: list(glue?.closeWhenFired),
        closeWhenAllFired: list(glue?.closeWhenAllFired),
    };
}

/**
 * The config for the form, with defaults left out, or null when the form is empty
 * (the entry goes back to vanilla).
 */
export function formToConfig(form) {
    const config = {};
    const id = String(form.id ?? '').trim();
    if (id) config.id = id;
    const gates = parseIds(form.gates);
    if (gates.length) config.gates = gates;
    if (form.gateMode === 'any') config.gateMode = 'any';
    if (form.closeGates === false) config.closeGates = false;
    if (form.glue) {
        const glue = {};
        const closeKeywords = parseLines(form.closeKeywords);
        const closeWhenFired = parseIds(form.closeWhenFired);
        const closeWhenAllFired = parseIds(form.closeWhenAllFired);
        if (closeKeywords.length) glue.closeKeywords = closeKeywords;
        if (closeWhenFired.length) glue.closeWhenFired = closeWhenFired;
        if (closeWhenAllFired.length) glue.closeWhenAllFired = closeWhenAllFired;
        config.glue = Object.keys(glue).length ? glue : true;
    }
    return Object.keys(config).length ? config : null;
}

/** Writes a config onto a book entry, or removes the field for null. */
export function applyConfig(entry, config) {
    if (config) entry[FIELD] = config;
    else delete entry[FIELD];
}

/**
 * Issues the entry would have with this config, among the other loaded entries.
 * @param {object[]} entries Loaded entries (with `world`), the edited one included or not.
 * @param {object} entry The edited entry, with `world` and `uid`.
 * @param {object | null} config
 * @returns {object[]} buildModel issues for this entry (warnings have `warning: true`).
 */
export function issuesFor(entries, entry, config) {
    const key = entryKey(entry);
    const edited = { ...entry };
    applyConfig(edited, config);
    const others = entries.filter(e => entryKey(e) !== key);
    return buildModel([...others, edited]).issues.filter(i => i.key === key);
}

/** Ids the entry can refer to: every other entry's id, sorted. */
export function knownIds(entries, entry) {
    const key = entryKey(entry);
    const ids = entries.filter(e => entryKey(e) !== key).map(e => e?.[FIELD]?.id).filter(id => typeof id === 'string' && id);
    return [...new Set(ids)].sort();
}
