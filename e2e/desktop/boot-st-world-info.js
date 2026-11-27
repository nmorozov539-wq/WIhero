// ST's world-info.js for e2e/desktop/boot.html (L1), reached through the page's import map. Only what index.js and
// src/st.js touch at boot: one book, the functions the health check names, and the live settings the engine reads.
export const world_names = ['Boot Book'];
export const selected_world_info = [];
export const world_info = { charLore: [] };
export const world_info_depth = 2;
export const world_info_case_sensitive = false;
export const world_info_match_whole_words = false;
export const world_info_recursive = false;
export const world_info_max_recursion_steps = 0;
export const world_info_min_activations = 0;
export const world_info_min_activations_depth_max = 0;
export const world_info_include_names = true;
export const world_info_use_group_scoring = false;
export const world_info_budget = 25;
export const world_info_budget_cap = 0;
export const world_info_overflow_alert = false;
export const world_info_character_strategy = 1;
export const scan_state = Object.freeze({ NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 });
export const newWorldInfoEntryTemplate = {
    key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true,
    selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4,
    group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null,
    useGroupScoring: null, automationId: '', role: null, sticky: null, cooldown: null, delay: null,
};
export const worldInfoCache = new Map();
export const METADATA_KEY = 'wihero';
export const getSortedEntries = () => [];
export const parseRegexFromString = text => new RegExp(text);
export async function deleteWorldInfo() { return true; }
export async function importWorldInfo() { return true; }
export function onWorldInfoChange() {}
export function setWorldInfoButtonClass() {}
export function charSetAuxWorlds() {}
