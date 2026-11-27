// Tracker read cost: `slotValues` and the Extensions panel's real `view()` at 20/60/120 tracker slots.
// Half the slots are written mains and half are written masks, and every slot holds a value, because the plan warns
// that a view() measurement without written masks is incomplete.
import { buildModel, FIELD } from '../../src/engine/model.js';
import { initialState } from '../../src/engine/state.js';
import { slotValues, stateForScan } from '../../src/engine/turn.js';
import { e, TRACKER_SIZES } from './fixture.mjs';
import { sample } from './timing.mjs';
import { createRig } from './rig.mjs';

/** Exactly `slots` written slots: each entry has a written main, and half the entries add a written mask. */
function trackerBook(slots) {
    const entries = [];
    let total = 0;
    for (let i = 0; total < slots; i++) {
        const withMask = total + 2 <= slots;
        entries.push(e(i, `tracker ${i}`, {
            id: `tracker-${i}`,
            written: { label: `Stat ${i}`, describe: `the value of stat ${i}` },
            ...(withMask ? { masks: [{ name: 'Night', written: { label: `Night ${i}`, describe: `the night value of ${i}` } }] } : {}),
        }, { content: String(i) }));
        total += withMask ? 2 : 1;
    }
    return entries;
}

/** A chat whose newest message carries a snapshot pointing at a reply that wrote every slot. */
function trackerChat(model) {
    const keys = [...model.slots.keys()];
    const wrote = Object.fromEntries(keys.map((key, i) => [key, `value ${i}`]));
    const written = Object.fromEntries(keys.map(key => [key, 1]));
    return [
        { is_user: false, mes: 'Hello.', name: 'Char' },
        { is_user: false, mes: 'The reply.', name: 'Char', extra: { [FIELD]: { ...initialState(), at: 1, wrote } } },
        { is_user: true, mes: 'Next.', name: 'User', extra: { [FIELD]: { ...initialState(), at: 2, written } } },
    ];
}

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [8] : TRACKER_SIZES;
    for (const slots of sizes) {
        const entries = trackerBook(slots);
        const model = buildModel(entries);
        const chat = trackerChat(model);
        const state = stateForScan(chat, model);
        const values = slotValues(model, state, chat);
        const fixture = { entries: entries.length, slots: model.slots.size, masks: entries.filter(x => x.extensions?.wihero?.masks).length, values: values.size };

        const readMs = sample(() => slotValues(model, state, chat), smoke ? { warmup: 1, minSamples: 3, maxSamples: 5 } : { warmup: 3, minSamples: 7, maxSamples: 60 });
        sink.add({ bench: 'bench-trackers', metric: 'slotValues', fixture, ...readMs });

        const r = createRig(entries, { chat });
        r.load();
        const viewMs = sample(() => r.hooks.view(), smoke ? { warmup: 1, minSamples: 3, maxSamples: 5 } : { warmup: 3, minSamples: 7, maxSamples: 40 });
        sink.add({ bench: 'bench-trackers', metric: 'view', fixture, ...viewMs });
    }
}
