// The speed-ups of the engine's hot paths (hashing, the model signature, tracker reads, the panel's view) change
// nothing about what the engine decides. These tests pin that: each fast path against the plain way of working the
// same thing out, and the work that is now skipped (hashing every entry, rebuilding the model) staying skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHooks } from '../src/st-hooks.js';
import { createHealth } from '../src/compat.js';
import { buildModel, FIELD } from '../src/engine/model.js';
import { entryStatus, keywordOnSide, slotValues, stateForScan } from '../src/engine/turn.js';
import { initialState, readState, readWrote } from '../src/engine/state.js';
import { entryHash } from '../src/timers.js';
import { writeSnapshot } from '../src/chat-state.js';
import { getStringHash } from '../src/engine/util.js';
import { e } from './sim.js';

const scan_state = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };

/** createHooks over a stand-in ST: counts how often an entry is hashed, and lets a test shape the chat and timers. */
function rig(book, { chat = [{ is_user: false, mes: 'Hello.', name: 'Char' }], timed = {}, hashFromSorted = () => 1 } = {}) {
    const hashed = { calls: 0 };
    const countingHash = text => { hashed.calls++; return getStringHash(text); };
    const context = {
        chat, characters: [{ avatar: 'Char.png', first_mes: 'Hello.', data: { alternate_greetings: [] } }], characterId: 0, groupId: null,
        chatMetadata: { timedWorldInfo: timed }, substituteParams: t => t, saveChat: async () => {}, setExtensionPrompt: () => {},
        eventTypes: { WORLDINFO_FORCE_ACTIVATE: 'force' }, eventSource: { emit: async () => {} },
    };
    const state = { book };
    const hooks = createHooks({
        ctx: () => context, settings: { enabled: true }, health: createHealth(),
        st: {
            getSortedEntries: async () => {
                const lore = { globalLore: state.book.map(x => structuredClone(x)) };
                hooks.onEntriesLoaded(lore);
                return lore.globalLore.map(x => ({ ...x, decorators: [], hash: hashFromSorted(x) }));
            },
            getStringHash: countingHash, parseRegexFromString: () => null, scan_state, globals: () => ({ depth: 2, caseSensitive: false, matchWholeWords: true }),
        },
    });
    const load = () => hooks.onEntriesLoaded({ globalLore: state.book.map(x => structuredClone(x)) });
    return { hooks, hashed, state, context, load };
}

const bigBook = n => Array.from({ length: n }, (_, i) => e(i, `k${i}`, i % 2 ? { id: `n${i}` } : undefined, { content: `entry ${i} `.repeat(20) }));

test('entries are not hashed on a load when ST holds no sticky effect', () => {
    const r = rig(bigBook(200));
    r.load();
    r.load();
    assert.ok(r.hashed.calls <= 6, `hashed ${r.hashed.calls} times; only the greeting fingerprints should be`);
});

test('a running sticky still holds a closed entry, and only entries with a sticky are hashed for it', async () => {
    const book = bigBook(200);
    book[1].sticky = 3; // configured (odd uid), once, so it closes after firing
    book[1].extensions.wihero.once = true;
    const chat = [{ is_user: false, mes: 'Hello.' }, { is_user: true, mes: 'k1' }, { is_user: false, mes: 'ok' }, { is_user: true, mes: 'x' }];
    const closed = { ...initialState(), at: 2, fired: { 'Book/n1': 1, 'Book/n3': 1 }, closed: { 'Book/n1': { at: 2, by: 'once', wasHolding: false }, 'Book/n3': { at: 2, by: 'once', wasHolding: false } } };
    writeSnapshot(chat[2], closed);
    const raw = structuredClone(book[1]);
    const hash = entryHash(raw, getStringHash);
    const timed = { sticky: { 'Book.1': { hash, start: 2, end: 6, protected: false } } };
    const r = rig(book, { chat, timed });
    await r.hooks.onGenerationStarted('normal', {}, false);
    const lore = { globalLore: book.map(x => structuredClone(x)) };
    r.hooks.onEntriesLoaded(lore);
    assert.ok(lore.globalLore.some(x => x.uid === 1), 'the closed entry stays while its sticky runs');
    assert.ok(!lore.globalLore.some(x => x.uid === 3), 'a closed entry without a sticky is removed as before');
    assert.ok(r.hashed.calls <= 6 + 1, `hashed ${r.hashed.calls} times: the greeting fingerprints and the one sticky entry`);
});

test('the model is rebuilt for what it reads, and only for that', async () => {
    const book = bigBook(60);
    const r = rig(book);
    r.load();
    const first = r.hooks.model;
    r.load();
    assert.equal(r.hooks.model, first, 'same books, same model');

    book[2].content += ' (a plain entry, edited)'; // even uid: no story logic
    book[2].order = 5;
    r.load();
    assert.equal(r.hooks.model, first, 'an entry without story logic never reaches the model');

    book[1].extensions.wihero.once = true;
    r.load();
    const second = r.hooks.model;
    assert.notEqual(second, first, 'story logic changed');
    book[1].disable = true;
    r.load();
    assert.notEqual(r.hooks.model, second, 'a field buildModel reads (disable) changed');
    assert.equal(r.hooks.model.nodes.get('Book/n1').disabled, true);
    const third = r.hooks.model;
    book[1].comment = 'renamed';
    r.load();
    assert.notEqual(r.hooks.model, third, 'the label is read too');
});

test('loadModel and a generation\'s load give the model one signature, so it is not rebuilt between them', async () => {
    const r = rig(bigBook(80));
    r.load();
    const model = r.hooks.model;
    await r.hooks.loadModel(); // entries as getSortedEntries returns them: with `hash` and `decorators`
    assert.equal(r.hooks.model, model);
    r.load();
    assert.equal(r.hooks.model, model);
});

test('the hash check warns once, on a mismatch, and stays quiet when ST hashes as we do', async () => {
    const warned = [];
    const was = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
        const book = bigBook(30);
        const bad = rig(book, { hashFromSorted: () => 1 });
        for (let i = 0; i < 3; i++) { await bad.hooks.onGenerationStarted('normal', {}, false); await bad.hooks.onAfterCommands('normal', {}, false); }
        assert.equal(warned.filter(w => w.includes('hashes differ')).length, 1, 'once');

        warned.length = 0;
        const good = rig(book, { hashFromSorted: x => entryHash(x, getStringHash) });
        for (let i = 0; i < 3; i++) { await good.hooks.onGenerationStarted('normal', {}, false); await good.hooks.onAfterCommands('normal', {}, false); }
        assert.equal(warned.filter(w => w.includes('hashes differ')).length, 0);
    } finally {
        console.warn = was;
    }
});

test('readWrote gives what readState(...).wrote gives', () => {
    const snaps = [undefined, null, 5, 'x', [], {}, { v: 1 }, { v: 1, fired: { a: 1 } }, { v: 2 }, { v: 2, wrote: null }, { v: 2, wrote: [] },
        { v: 2, wrote: { a: 'x', 'B/c': '' } }, { v: 3, wrote: { a: 1 } }, { ...initialState(), wrote: { k: 'v' } }];
    const shape = x => (x && typeof x === 'object' && !Array.isArray(x) ? JSON.stringify(x) : 'none');
    for (const s of snaps) for (const renamed of [undefined, {}, { Old: 'New' }]) {
        assert.equal(shape(readWrote(s, { renamed })), shape(readState(s, { renamed })?.wrote), JSON.stringify([s, renamed]));
    }
    const renamed = readWrote({ v: 2, wrote: { 'Old/gold': '5' } }, { renamed: { Old: 'New' } });
    assert.deepEqual(renamed, { 'New/gold': '5' }, 'with renames the full reader maps the keys');
});

test('keywordOnSide matches the reference reading, on random chats', () => {
    // The reading before it was made to stop at the end of the chat: filter, last `depth`, side, then every key.
    const reference = (entry, chat, side, globals) => {
        const depth = Number.isInteger(entry.scanDepth) ? entry.scanDepth : globals.depth;
        if (!(depth > 0)) return false;
        const messages = (chat ?? []).filter(m => m && !m.is_system).slice(-depth).filter(m => (m.is_user ? 'user' : 'char') === side);
        const cs = entry.caseSensitive ?? globals.caseSensitive;
        const whole = entry.matchWholeWords ?? globals.matchWholeWords;
        const tf = s => (cs ? s : s.toLowerCase());
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = (hay, key) => {
            const re = key.startsWith('/') && key.lastIndexOf('/') > 0 ? (() => { try { return new RegExp(key.slice(1, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)); } catch { return null; } })() : null;
            if (re) { re.lastIndex = 0; return re.test(hay); }
            const h = tf(hay), k = tf(key);
            if (!whole || k.split(/\s+/).length > 1) return h.includes(k);
            return new RegExp(`(?:^|\\W)(${esc(k)})(?:$|\\W)`).test(h);
        };
        return (entry.key ?? []).filter(k => typeof k === 'string' && k.trim()).some(key => messages.some(m => match(m.mes ?? '', key.trim())));
    };
    const parseRegexFromString = key => {
        const m = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(key);
        if (!m) return null;
        try { return new RegExp(m[1], m[2]); } catch { return null; }
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const W = ['wolf', 'Wolf', 'raven', 'a wolf', 'tower', 'ash', '/wol+f/i', '/^the/', 'castle keep', 'Wolfgang', 'wolves'];
    for (let t = 0; t < 1500; t++) {
        const chat = Array.from({ length: Math.floor(rnd() * 12) }, () => ({ is_user: rnd() < 0.5, is_system: rnd() < 0.15, mes: Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => W[Math.floor(rnd() * W.length)]).join(' ') }));
        if (rnd() < 0.1 && chat.length) chat.splice(Math.floor(rnd() * chat.length), 0, null);
        const entry = {
            key: Array.from({ length: Math.floor(rnd() * 4) }, () => (rnd() < 0.1 ? '  ' : W[Math.floor(rnd() * W.length)])),
            ...(rnd() < 0.4 ? { scanDepth: Math.floor(rnd() * 6) - 1 } : {}), ...(rnd() < 0.3 ? { caseSensitive: rnd() < 0.5 } : {}), ...(rnd() < 0.3 ? { matchWholeWords: rnd() < 0.5 } : {}),
        };
        const globals = { depth: 1 + Math.floor(rnd() * 5), caseSensitive: rnd() < 0.5, matchWholeWords: rnd() < 0.5, parseRegexFromString };
        const side = rnd() < 0.5 ? 'user' : 'char';
        assert.equal(keywordOnSide(entry, chat, side, globals), reference(entry, chat, side, globals), JSON.stringify({ entry, chat, side }));
    }
});

test('entryStatus gives the same answer with the tracker values worked out once as without', () => {
    const entries = [];
    for (let i = 0; i < 12; i++) {
        entries.push(e(i, `t${i}`, { id: `t${i}`, glue: { mode: 'hold' }, written: { label: `Stat${i}` }, masks: [{ name: 'Custom', written: { label: `Note${i}` } }] }, { content: '0' }));
    }
    const model = buildModel(entries);
    const chat = [{ is_user: false, mes: 'Hello.' }];
    for (let i = 0; i < 12; i++) {
        chat.push({ is_user: true, mes: `t${i}` }, { is_user: false, mes: `ok [Stat${i}: ${i}]${i % 2 ? ` [Note${i}: n${i}]` : ''}` });
        const prior = stateForScan(chat.slice(0, -1), model);
        const base = { ...prior, at: chat.length - 1, written: { ...prior.written, [`Book/t${i}`]: chat.length - 1, ...(i % 2 ? { [`Book/t${i}|m:Custom`]: chat.length - 1 } : {}) }, wrote: {} };
        chat.at(-1).extra = { [FIELD]: { ...base, wrote: { [`Book/t${i}`]: String(i), ...(i % 2 ? { [`Book/t${i}|m:Custom`]: `n${i}` } : {}) } } };
    }
    const state = stateForScan(chat, model);
    const values = slotValues(model, state, chat);
    assert.ok(values.size > 0);
    for (const node of model.nodes.values()) {
        assert.deepEqual(entryStatus(node, state, chat, model, values), entryStatus(node, state, chat, model), node.key);
    }
});
