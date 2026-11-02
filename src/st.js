// The only module that imports SillyTavern internals not exposed on getContext().
// Paths are relative to public/scripts/extensions/third-party/<this extension>/src/.
// Namespace imports only: a named import that a later ST no longer exports would stop the whole extension from
// loading with no word to the user. This way a missing function is just undefined, and the health check
// (src/compat.js) reports it and stands the engine down.
import * as WIModule from '../../../../world-info.js';
import * as Utils from '../../../../utils.js';

/** world-info.js as a namespace, for its live bindings (selected_world_info, world_info, settings). */
export const WI = WIModule;

export const getSortedEntries = (...args) => WIModule.getSortedEntries(...args);
export const parseRegexFromString = (...args) => WIModule.parseRegexFromString(...args);
export const newWorldInfoEntryTemplate = WIModule.newWorldInfoEntryTemplate;
export const getStringHash = (...args) => Utils.getStringHash(...args);
export const scan_state = WIModule.scan_state;

/** ST's World Info scan settings, read live (they change in ST's settings). */
export const scanGlobals = () => ({
    depth: WIModule.world_info_depth,
    caseSensitive: WIModule.world_info_case_sensitive,
    matchWholeWords: WIModule.world_info_match_whole_words,
});

/** What the health check looks at: each internal WI Hero pulls from ST, by name. */
export const internals = () => ({
    'world-info.js getSortedEntries': WIModule.getSortedEntries,
    'world-info.js parseRegexFromString': WIModule.parseRegexFromString,
    'world-info.js scan_state': WIModule.scan_state,
    'world-info.js world_info_depth': WIModule.world_info_depth,
    'world-info.js newWorldInfoEntryTemplate': WIModule.newWorldInfoEntryTemplate,
    'world-info.js deleteWorldInfo': WIModule.deleteWorldInfo,
    'world-info.js METADATA_KEY': WIModule.METADATA_KEY,
    'utils.js getStringHash': Utils.getStringHash,
});
