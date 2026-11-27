// Generation and model cost at 150/1,000/3,000/5,000 entries, plus the two counts the plan's 6,002 → 2 claim is
// about: JSON.stringify calls in one generation, and entry hashes. The old generation hashed every entry twice;
// this harness makes that visible again if it comes back.
//
// Measured-native desktop Node. A generation here is: generation started, entries loaded (what ST splices and what
// the engine keeps), one scan settled with a dozen activations, the activated list reported, and a reply received.
import { buildModel } from '../../src/engine/model.js';
import { book, chat as makeChat, SIZES } from './fixture.mjs';
import { sample, sampleAsync, clock } from './timing.mjs';
import { createRig, scan_state } from './rig.mjs';

const SHAPE = { shape: 'mixed', keys: 'unique-multi-word', contentChars: 240 };

/** The chat a generation starts from: a greeting and a user turn, so the reply has somewhere to land. */
const baseChat = () => makeChat({ turns: 1, seed: 11 });

/** The entries a scan activates: a dozen with key words, spread through the book. */
function activation(lore) {
    const usable = lore.filter(x => !x.disable && !x.extensions?.wihero?.moment && Array.isArray(x.key) && x.key.some(k => typeof k === 'string' && k.trim()));
    const step = Math.max(1, Math.floor(usable.length / 12));
    const picked = usable.filter((_, i) => i % step === 0).slice(0, 12);
    return new Map(picked.map(x => [`${x.world}.${x.uid}`, x]));
}

/** One counted generation. Resets the chat each time so a sample is one turn, not a growing chat. */
async function oneGeneration(r) {
    r.context.chat = baseChat();
    const book = structuredClone(r.state.book);
    r.hooks.onGenerationStarted('normal', {}, false);
    const lore = { globalLore: book };
    r.hooks.onEntriesLoaded(lore);
    const map = activation(lore.globalLore);
    await r.hooks.onScanDone({ activated: { entries: map }, sortedEntries: lore.globalLore, state: { next: scan_state.NONE } });
    r.hooks.onWorldInfoActivated([...map.values()]);
    r.context.chat.push({ is_user: false, mes: 'A reply from the character.', name: 'Char' });
    r.hooks.onMessageReceived(r.context.chat.length - 1);
}

/** One generation with JSON.stringify wrapped: how many calls the current path makes, and how many entry hashes. */
async function countOnce(bookEntries) {
    const r = createRig(bookEntries, { chat: baseChat() });
    await oneGeneration(r); // warm: the first load is not what the claim measures
    const hashesBefore = r.hashed.calls;
    let calls = 0;
    const original = JSON.stringify;
    JSON.stringify = (...args) => { calls += 1; return original(...args); };
    try {
        await oneGeneration(r);
    } finally {
        JSON.stringify = original;
    }
    return { jsonStringifyCalls: calls, entryHashes: r.hashed.calls - hashesBefore };
}

export async function run({ smoke = false, sink }) {
    const sizes = smoke ? [40] : SIZES;
    for (const n of sizes) {
        const entries = book(n, { seed: 1000 + n, shape: 'mixed', contentLength: 240 });
        const fixture = { entries: n, ...SHAPE };
        const modelMs = sample(() => buildModel(entries), smoke ? { warmup: 1, minSamples: 3, maxSamples: 5 } : { warmup: 2, minSamples: 9, maxSamples: 15, budgetMs: 1500 });
        sink.add({ bench: 'bench-generation', metric: 'model', fixture, ...modelMs });
        if (!smoke) {
            const r = createRig(entries, { chat: baseChat() });
            const genMs = await sampleAsync(() => oneGeneration(r), { warmup: 2, minSamples: 9, maxSamples: 15, budgetMs: 1500 });
            sink.add({ bench: 'bench-generation', metric: 'generation', fixture: { ...fixture, activations: 12 }, ...genMs });
            const counts = await countOnce(entries);
            sink.add({ bench: 'bench-generation', metric: 'counts', fixture: { ...fixture, activations: 12 }, ...counts });
        } else {
            // In a smoke run the one-generation path still has to be exercised, once, without the timing loop.
            const r = createRig(entries, { chat: baseChat() });
            const t0 = clock();
            await oneGeneration(r);
            sink.add({ bench: 'bench-generation', metric: 'generation', fixture: { ...fixture, activations: 12 }, median: Math.round((clock() - t0) * 1000) / 1000, samples: 1 });
            const counts = await countOnce(entries);
            sink.add({ bench: 'bench-generation', metric: 'counts', fixture: { ...fixture, activations: 12 }, ...counts });
        }
    }
}
