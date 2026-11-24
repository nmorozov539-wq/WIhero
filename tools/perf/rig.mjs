// The stand-in SillyTavern the engine benches share: `createHooks` over an in-memory book, a chat and a timer set.
// Adapted from the rig in test/perf.test.js (tools never import test files); it counts ST's hash calls so a bench can
// say whether a load hashed every entry or none.
import { createHooks } from '../../src/st-hooks.js';
import { createHealth } from '../../src/compat.js';
import { getStringHash } from '../../src/engine/util.js';

export const scan_state = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };

/**
 * @param {object[]} book entries, in the `e()` shorthand
 * @param {object} [options]
 * @param {object[]} [options.chat] the open chat
 * @param {object} [options.timed] chatMetadata.timedWorldInfo
 * @param {(entry: object) => number} [options.hashFromSorted] what `hash` getSortedEntries returns
 * @param {boolean} [options.countHashes] count entry hashes (default true)
 */
export function createRig(book, {
    chat = [{ is_user: false, mes: 'Hello.', name: 'Char' }],
    timed = {},
    hashFromSorted = () => 1,
    countHashes = true,
} = {}) {
    const hashed = { calls: 0 };
    const countingHash = text => { hashed.calls++; return getStringHash(text); };
    const context = {
        chat,
        characters: [{ avatar: 'Char.png', first_mes: 'Hello.', data: { alternate_greetings: [] } }],
        characterId: 0,
        groupId: null,
        chatMetadata: { timedWorldInfo: timed },
        substituteParams: t => t,
        saveChat: async () => {},
        setExtensionPrompt: () => {},
        eventTypes: { WORLDINFO_FORCE_ACTIVATE: 'force' },
        eventSource: { emit: async () => {} },
    };
    const state = { book };
    const hooks = createHooks({
        ctx: () => context,
        settings: { enabled: true },
        health: createHealth(),
        st: {
            getSortedEntries: async () => {
                const lore = { globalLore: state.book.map(x => structuredClone(x)) };
                hooks.onEntriesLoaded(lore);
                return lore.globalLore.map(x => ({ ...x, decorators: [], hash: hashFromSorted(x) }));
            },
            getStringHash: countHashes ? countingHash : getStringHash,
            parseRegexFromString: () => null,
            scan_state,
            globals: () => ({ depth: 2, caseSensitive: false, matchWholeWords: true }),
        },
    });
    const load = () => hooks.onEntriesLoaded({ globalLore: state.book.map(x => structuredClone(x)) });
    return { hooks, hashed, state, context, load };
}
