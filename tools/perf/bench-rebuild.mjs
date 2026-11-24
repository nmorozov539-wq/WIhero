// Model rebuild count across four generations and one `loadModel`, with the rig shape from test/perf.test.js.
// Before #48 every generation rebuilt the model because the signature covered more than buildModel reads; the
// count is the thing to keep at zero, and the entry-hash count is the other half of that story.
import { book, chat as makeChat, SIZES } from './fixture.mjs';
import { createRig } from './rig.mjs';
import { FIELD } from '../../src/engine/model.js';

/** The entries a scan activates: up to three with key words, never a Moment. */
function activation(lore) {
    return new Map(lore
        .filter(x => !x.disable && x.extensions?.[FIELD]?.moment !== true && Array.isArray(x.key) && x.key.some(k => k.trim()))
        .slice(0, 3)
        .map(x => [`${x.world}.${x.uid}`, x]));
}

/** One generation: start, load the books, settle a scan, report what fired, land a reply. */
async function generation(r, entries) {
    r.context.chat = makeChat({ turns: 1, seed: 17 });
    r.hooks.onGenerationStarted('normal', {}, false);
    const lore = { globalLore: structuredClone(entries) };
    r.hooks.onEntriesLoaded(lore);
    const map = activation(lore.globalLore);
    await r.hooks.onScanDone({ activated: { entries: map }, sortedEntries: lore.globalLore });
    r.hooks.onWorldInfoActivated([...map.values()]);
    r.context.chat.push({ is_user: false, mes: 'A reply.', name: 'Char' });
    r.hooks.onMessageReceived(r.context.chat.length - 1);
}

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [30] : SIZES;
    for (const n of sizes) {
        const entries = book(n, { seed: 3000 + n, shape: 'mixed' });
        const r = createRig(entries, { chat: makeChat({ turns: 1, seed: 17 }) });
        r.load();
        let model = r.hooks.model;
        let rebuilds = 0;
        for (let g = 0; g < 4; g++) {
            await generation(r, entries);
            if (r.hooks.model !== model) { rebuilds += 1; model = r.hooks.model; }
        }
        const beforeLoad = r.hooks.model;
        await r.hooks.loadModel();
        if (r.hooks.model !== beforeLoad) rebuilds += 1;
        sink.add({
            bench: 'bench-rebuild',
            metric: 'rebuilds',
            fixture: { entries: n, shape: 'mixed', generations: 4, loadModel: 1 },
            rebuilds,
            entryHashes: r.hashed.calls,
        });
    }
}
