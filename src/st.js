// The only module that imports SillyTavern internals not exposed on getContext().
// Paths are relative to public/scripts/extensions/third-party/<this extension>/src/.
export {
    getSortedEntries, parseRegexFromString, scan_state,
    world_info_depth, world_info_case_sensitive, world_info_match_whole_words, newWorldInfoEntryTemplate,
} from '../../../../world-info.js';
export { getStringHash } from '../../../../utils.js';
/** world-info.js as a namespace, for its live bindings (selected_world_info, world_info, settings). */
export * as WI from '../../../../world-info.js';
