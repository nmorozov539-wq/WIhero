// Compatibility with SillyTavern (BUILD_SPEC 17): the ST version against the ones WI Hero is tested on, and a health
// check of every hook and internal it pulls. When something is gone, the engine stands down and World Info runs as
// plain ST, rather than half-working story logic writing bad snapshots. Pure apart from `stVersion`.

import { getStringHash as engineHash } from './engine/util.js';

/** Text the health check hashes with both ST's getStringHash and the engine's copy: they must agree. */
const HASH_PROBE = 'WI Hero hash probe: Ünïcödé ✓ {{char}}\n0123456789';

/** SillyTavern versions WI Hero is tested on (the e2e checks run against these). */
export const TESTED_ST = Object.freeze(['1.19.0']);

/** The events WI Hero listens to or emits. */
export const EVENTS = Object.freeze([
    'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE',
    'WORLD_INFO_ACTIVATED', 'MESSAGE_RECEIVED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'WORLDINFO_FORCE_ACTIVATE',
]);

/** getContext() members the engine needs. */
const CONTEXT = Object.freeze(['eventSource', 'eventTypes', 'chat', 'saveChat', 'substituteParams', 'characters', 'chatMetadata', 'Popup', 'POPUP_TYPE', 'POPUP_RESULT']);

/** ST's version, from its /version endpoint, or null. */
export async function stVersion(fetcher = globalThis.fetch) {
    try {
        const r = await fetcher('/version');
        if (!r.ok) return null;
        const v = await r.json();
        return typeof v?.pkgVersion === 'string' ? v.pkgVersion : null;
    } catch {
        return null;
    }
}

/**
 * Whether a version is one WI Hero is tested on, with the line to show when it isn't.
 * @returns {{ tested: boolean, text: string | null }}
 */
export function versionStatus(version, tested = TESTED_ST) {
    if (!version) return { tested: false, text: 'WI Hero couldn\'t read the SillyTavern version, so it can\'t tell whether they work together.' };
    if (tested.includes(version)) return { tested: true, text: null };
    return {
        tested: false,
        text: `Versions drifted: WI Hero is tested on SillyTavern ${tested.join(', ')}, and this is ${version}. WI Hero is not recommended on it.`,
    };
}

/**
 * Checks every thread WI Hero pulls from ST.
 * @param {object} context SillyTavern.getContext()
 * @param {Record<string, any>} internals from src/st.js
 * @returns {string[]} what is missing, in words; empty when healthy.
 */
export function checkHealth(context, internals) {
    const missing = [];
    for (const name of CONTEXT) if (context?.[name] === undefined) missing.push(`getContext().${name}`);
    for (const name of EVENTS) if (!context?.eventTypes?.[name]) missing.push(`the ${name} event`);
    if (context?.eventSource && typeof context.eventSource.on !== 'function') missing.push('eventSource.on');
    for (const [name, value] of Object.entries(internals ?? {})) {
        if (value === undefined || value === null) missing.push(name);
    }
    const scanState = internals?.['world-info.js scan_state'];
    if (scanState && (scanState.NONE === undefined || scanState.MIN_ACTIVATIONS === undefined)) missing.push('scan_state.NONE / MIN_ACTIVATIONS');
    for (const fn of ['world-info.js getSortedEntries', 'world-info.js parseRegexFromString', 'utils.js getStringHash']) {
        if (internals?.[fn] !== undefined && typeof internals[fn] !== 'function') missing.push(`${fn} as a function`);
    }
    const cache = internals?.['world-info.js worldInfoCache'];
    if (cache !== undefined && !(cache instanceof Map)) missing.push('world-info.js worldInfoCache as a Map');
    // The engine keeps a copy of getStringHash, and the editor writes greeting fingerprints with it that the
    // runtime checks with ST's own. A changed hash would silently mismatch them all.
    const stHash = internals?.['utils.js getStringHash'];
    if (typeof stHash === 'function') {
        let same = false;
        try { same = stHash(HASH_PROBE) === engineHash(HASH_PROBE); } catch { /* reported below */ }
        if (!same) missing.push('utils.js getStringHash as WI Hero knows it (it hashes differently now)');
    }
    return missing;
}

/** What is wrong with WORLDINFO_ENTRIES_LOADED's argument, or null. */
export function probeEntriesLoaded(lore) {
    if (!lore || typeof lore !== 'object') return 'WORLDINFO_ENTRIES_LOADED no longer passes the loaded books';
    const lists = ['globalLore', 'characterLore', 'chatLore', 'personaLore'].map(k => lore[k]);
    if (lists.some(l => l !== undefined && !Array.isArray(l))) return 'WORLDINFO_ENTRIES_LOADED passes the loaded books in a new shape';
    return null;
}

/** What is wrong with WORLDINFO_SCAN_DONE's argument, or null. */
export function probeScanDone(args) {
    if (!(args?.activated?.entries instanceof Map)) return 'WORLDINFO_SCAN_DONE no longer passes the activated entries';
    if (!args.state || !('next' in args.state)) return 'WORLDINFO_SCAN_DONE no longer passes the scan state';
    return null;
}

/**
 * The health WI Hero is in: healthy, or stood down with the reasons. `onChange` hears every change.
 */
export function createHealth(onChange = () => {}) {
    const h = {
        version: null,
        versionText: null,
        problems: [],
        get ok() { return h.problems.length === 0; },
        /** Records a problem found at runtime; the engine stands down. Returns true the first time. */
        fail(reason) {
            if (h.problems.includes(reason)) return false;
            h.problems.push(reason);
            onChange(h);
            return true;
        },
        setVersion(version) {
            h.version = version;
            h.versionText = versionStatus(version).text;
            onChange(h);
        },
    };
    return h;
}

/** The line to show for stood-down health. */
export const standDownText = problems => `WI Hero stood down: SillyTavern no longer has ${problems.join('; ')}. Your World Info works as plain SillyTavern World Info, with no story logic.`;
