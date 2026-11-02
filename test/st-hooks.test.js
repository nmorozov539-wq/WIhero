// The ST wiring (src/st-hooks.js) against a stand-in for SillyTavern that emits the events of one generation
// in ST 1.19.0's order: GENERATION_STARTED, GENERATION_AFTER_COMMANDS, the user message, then the World Info
// scan (WORLDINFO_ENTRIES_LOADED, scan loops with WORLDINFO_SCAN_DONE, forced activations), WORLD_INFO_ACTIVATED,
// the reply, MESSAGE_RECEIVED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHooks } from '../src/st-hooks.js';
import { getStringHash } from '../src/engine/util.js';
import { e } from './sim.js';

const scan_state = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };

class FakeST {
    constructor(entries, { character } = {}) {
        this.book = entries;
        this.chat = [{ is_user: false, mes: character?.first_mes ?? 'Hello.', name: 'Char' }];
        this.forced = new Map();
        this.prompts = [];
        this.character = character ?? { avatar: 'Char.png', first_mes: 'Hello.', data: { alternate_greetings: [] } };
        const context = {
            chat: this.chat,
            characters: [this.character],
            characterId: 0,
            groupId: null,
            chatMetadata: {},
            substituteParams: text => text.replaceAll('{{char}}', 'Sera'),
            saveChat: async () => {},
            eventTypes: { WORLDINFO_FORCE_ACTIVATE: 'force' },
            eventSource: { emit: async (type, list) => { if (type === 'force') for (const x of list) this.forced.set(`${x.world}.${x.uid}`, x); } },
        };
        this.hooks = createHooks({
            ctx: () => context,
            settings: { enabled: true },
            st: {
                getSortedEntries: async () => this.sorted(),
                getStringHash,
                parseRegexFromString: () => null,
                scan_state,
                globals: () => ({ depth: 2, caseSensitive: false, matchWholeWords: true }),
            },
        });
    }

    sorted() {
        const lore = { globalLore: this.book.map(x => structuredClone(x)) };
        this.hooks.onEntriesLoaded(lore);
        return lore.globalLore.map(x => ({ ...x, hash: 1 }));
    }

    async send(text, reply = 'Reply.', type = 'normal') {
        await this.hooks.onGenerationStarted(type, {}, false);
        await this.hooks.onAfterCommands(type, {}, false);
        if (type === 'normal') this.chat.push({ is_user: true, mes: text, name: 'User' });
        if (type === 'swipe') this.chat.pop();
        // getWorldInfoPrompt → checkWorldInfo
        const sortedEntries = this.sorted();
        const map = new Map();
        const text2 = this.chat.filter(m => !m.is_system).slice(-2).map(m => m.mes).join('\n').toLowerCase();
        let state = scan_state.INITIAL;
        for (let loop = 0; state !== scan_state.NONE && loop < 10; loop++) {
            for (const entry of sortedEntries) {
                const k = `${entry.world}.${entry.uid}`;
                if (map.has(k) || entry.disable) continue;
                if (this.forced.has(k)) map.set(k, this.forced.get(k));
                else if (state !== scan_state.MIN_ACTIVATIONS && (entry.constant || entry.key.some(w => text2.includes(w.toLowerCase())))) map.set(k, entry);
            }
            const args = { state: { current: state, next: scan_state.NONE }, activated: { entries: map }, sortedEntries };
            await this.hooks.onScanDone(args);
            state = args.state.next;
        }
        this.forced.clear();
        this.prompts.push([...map.values()].map(x => x.content));
        this.hooks.onWorldInfoActivated([...map.values()]);
        this.chat.push({ is_user: false, mes: reply, name: 'Char' });
        this.hooks.onMessageReceived(this.chat.length - 1, type);
        return [...map.values()].map(x => x.uid).sort((a, b) => a - b);
    }

    get state() { return this.hooks.state(); }
}

test('a chain advances and the snapshot lands on the reply', async () => {
    const st = new FakeST([e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill', gate: [['road']], closesFor: ['road'] })]);
    assert.deepEqual(await st.send('mill'), []);
    assert.deepEqual(await st.send('road'), [0]);
    assert.equal(st.chat.at(-1).extra.wihero.fired['Book/road'], 1);
    assert.deepEqual(await st.send('mill road'), [1], 'the road closes as the mill fires (closing beats opening)');
    assert.deepEqual(await st.send('road'), []);
});

test('a hold is forced in every turn', async () => {
    const st = new FakeST([e(0, 'storm', { id: 'storm', glue: { mode: 'hold' }, closeGate: [[{ lock: ['storm passes'] }]] })]);
    await st.send('storm');
    assert.deepEqual(await st.send('quiet'), [0]);
    assert.deepEqual(await st.send('the storm passes'), [], 'the user\'s phrase closes it in the same reply');
});

test('a rider comes in through the extra pass, only with its host', async () => {
    const st = new FakeST([e(0, 'tunnel', { id: 'tunnel' }), e(1, 'echo', { id: 'echo', glue: { mode: 'ride', host: 'tunnel' } })]);
    assert.deepEqual(await st.send('echo'), []);
    assert.deepEqual(await st.send('tunnel'), [0, 1]);
});

test('a mask swaps the scan copy\'s content, with macros, and never the book', async () => {
    const st = new FakeST([e(0, 'storm', { id: 'storm' }), e(1, 'tower', { id: 'tower', masks: [{ name: 'ruined', content: '{{char}} sees ruins', gate: [['storm']] }] })]);
    await st.send('storm');
    await st.send('tower');
    assert.ok(st.prompts.at(-1).includes('Sera sees ruins'));
    assert.equal(st.book[1].content, '[1]');
});

test('who triggers drops an entry only the other side mentioned', async () => {
    const st = new FakeST([e(0, 'wolf', { id: 'wolf', by: 'user' })]);
    await st.send('hi', 'A wolf howls.');
    assert.deepEqual(await st.send('quiet'), [], 'only the reply said it');
    assert.deepEqual(await st.send('a wolf'), [0]);
});

test('a swipe rewinds and a quiet generation writes nothing', async () => {
    const st = new FakeST([e(0, 'road', { id: 'road', once: true })]);
    assert.deepEqual(await st.send('road'), [0]);
    assert.ok(st.state.closed['Book/road']);
    assert.deepEqual(await st.send(null, 'Swiped.', 'swipe'), [0], 'the swipe starts from before the replaced reply');
    await st.hooks.onGenerationStarted('quiet', {}, false);
    st.hooks.onWorldInfoActivated([st.book[0]]);
    st.hooks.onMessageReceived(st.chat.length - 1, 'quiet');
    assert.equal(st.chat.at(-1).extra.wihero.fired['Book/road'], 1);
});

test('Reopen is written on the latest message', async () => {
    const st = new FakeST([e(0, 'omen', { id: 'omen', once: true })]);
    await st.send('omen');
    await st.hooks.reopenEntry('Book/omen');
    assert.ok(!st.state.closed['Book/omen']);
    assert.deepEqual(await st.send('omen'), [0]);
});

test('greetings: the chat\'s opening greeting opens its scenario', async () => {
    const character = { avatar: 'Sera.png', first_mes: 'Main.', data: { alternate_greetings: ['Alt.'] } };
    const fp = String(getStringHash('Alt.'));
    const st = new FakeST([e(0, 'forest', { id: 'forest', gate: [[{ greeting: 1, char: 'Sera.png', name: 'Sera', fp }]] })], { character });
    st.chat[0] = { is_user: false, mes: 'Alt.', swipe_id: 1, swipes: ['Main.', 'Alt.'] };
    assert.deepEqual(await st.send('forest'), [0]);
    assert.deepEqual(st.hooks.model.issues, []);
});
