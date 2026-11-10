// The ST wiring (src/st-hooks.js) against a stand-in for SillyTavern that emits the events of one generation
// in ST 1.19.0's order: GENERATION_STARTED, GENERATION_AFTER_COMMANDS, the user message, then the World Info
// scan (WORLDINFO_ENTRIES_LOADED, scan loops with WORLDINFO_SCAN_DONE, forced activations), WORLD_INFO_ACTIVATED,
// the reply, MESSAGE_RECEIVED.
import { test } from 'node:test';
import { GREETINGS } from '../src/engine/model.js';
import assert from 'node:assert/strict';
import { createHooks } from '../src/st-hooks.js';
import { getStringHash } from '../src/engine/util.js';
import { e } from './sim.js';
import { createHealth } from '../src/compat.js';
import { bubbleData } from '../src/bubble.js';

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
            setExtensionPrompt: (key, value, position, depth) => { this.extensionPrompt = { key, depth, position }; this.extensionText = value; },
            eventTypes: { WORLDINFO_FORCE_ACTIVATE: 'force' },
            eventSource: { emit: async (type, list) => { if (type === 'force') for (const x of list) this.forced.set(`${x.world}.${x.uid}`, x); } },
        };
        this.settings = { enabled: true };
        this.health = createHealth();
        this.hooks = createHooks({
            ctx: () => context,
            settings: this.settings,
            health: this.health,
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

test('greetings: a greeting edited to the same length is seen as changed', { skip: !GREETINGS && 'greetings are retired for v1 (#33)' }, async () => {
    const character = { avatar: 'Sera.png', first_mes: 'Main.', data: { alternate_greetings: ['AAAA'] } };
    const fp = String(getStringHash('AAAA'));
    const st = new FakeST([e(0, 'forest', { id: 'forest', gate: [[{ greeting: 1, char: 'Sera.png', name: 'Sera', fp }]] })], { character });
    st.chat[0] = { is_user: false, mes: 'AAAA', swipe_id: 1, swipes: ['Main.', 'AAAA'] };
    await st.send('hello');
    assert.equal(st.hooks.model.greetings.get('@Sera.png:1').ok, true);
    character.data.alternate_greetings[0] = 'BBBB';
    await st.send('hello');
    assert.equal(st.hooks.model.greetings.get('@Sera.png:1').ok, false, 'the model was rebuilt');
});

// ---- N6 (BUILD_SPEC 17)

const chain = () => [
    e(0, 'road', { id: 'road' }),
    e(1, 'mill', { id: 'mill', gate: [['road']], closesFor: ['road'] }),
    e(2, 'tunnel', { id: 'tunnel', gate: [['mill']], closesFor: ['mill'] }),
    e(3, 'storm', { id: 'storm', glue: { mode: 'hold' }, closeGate: [[{ lock: ['storm passes'] }]] }),
];
const play = [['road'], ['storm'], ['mill'], ['quiet'], ['tunnel'], ['the storm passes'], ['road mill']];

test('off for some turns, then Catch up replays them oldest first and lands where always-on play would', async () => {
    const on = new FakeST(chain());
    for (const [t] of play) await on.send(t);
    const off = new FakeST(chain());
    await off.send(play[0][0]);
    off.settings.enabled = false;
    for (const [t] of play.slice(1, 5)) await off.send(t);
    off.settings.enabled = true;
    const gap = off.hooks.gap();
    assert.deepEqual(gap.skipped, [4, 6, 8, 10], 'the four replies written with WI Hero off');
    assert.equal(gap.from, 2);
    assert.equal(await off.hooks.fixGap('catchUp'), 4);
    assert.equal(off.hooks.gap(), null);
    for (const [t] of play.slice(5)) await off.send(t);
    const strip = s => ({ ...s, round: [...s.round].sort() });
    assert.deepEqual(strip(off.state), strip(on.state));
});

test('Keep as is carries the old state on; Start from here starts it again', async () => {
    const st = new FakeST(chain());
    await st.send('road');
    st.settings.enabled = false;
    await st.send('mill');
    st.settings.enabled = true;
    await st.hooks.fixGap('keep');
    assert.equal(st.hooks.gap(), null);
    assert.equal(st.state.fired['Book/mill'], undefined, 'the skipped mill never counted');
    assert.equal(st.state.fired['Book/road'], 1);
    st.settings.enabled = false;
    await st.send('quiet');
    st.settings.enabled = true;
    await st.hooks.fixGap('fresh');
    assert.deepEqual(Object.keys(st.state.fired), GREETINGS ? ['@Char.png:0'] : [], 'only the opening greeting, if greetings are on');
});

test('what reached the model is stored on each reply, also with the engine off; a continue adds to it', async () => {
    const st = new FakeST(chain());
    assert.deepEqual(bubbleData(st.chat), { count: null, sent: null }, 'a greeting alone has nothing to show');
    await st.send('road and storm');
    assert.deepEqual(bubbleData(st.chat).sent.map(x => x.title), ['road', 'storm']);
    st.settings.enabled = false;
    await st.send('mill');
    assert.deepEqual(bubbleData(st.chat).sent.map(x => x.title), ['mill'], 'off: plain ST sends the mill, and the bubble says so');
});

test('a scan that no longer looks as expected stands the engine down: entries are left to plain ST', async () => {
    const st = new FakeST(chain());
    st.hooks.onEntriesLoaded('nonsense');
    assert.equal(st.health.ok, false);
    assert.match(st.health.problems[0], /WORLDINFO_ENTRIES_LOADED/);
    assert.deepEqual(await st.send('mill'), [1], 'the mill fires though its gate is shut: WI Hero stood down');
    assert.equal(st.chat.at(-1).extra.wihero, undefined, 'and writes no snapshot');
});

test('a loaded book under a name a rename left behind keeps its own state (review finding 2)', async () => {
    const st = new FakeST([e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill', gate: [['road']] })]);
    st.settings.renamed = { Book: 'Book v2', Other: 'Other v2' };
    await st.send('road');
    assert.deepEqual(st.settings.renamed, { Other: 'Other v2' });
    assert.equal(st.state.fired['Book/road'], 1);
    assert.deepEqual(await st.send('mill'), [1], 'the gate reads the road under its own book');
});

test('a generation\'s read during loadModel is still gated, and loadModel keeps every entry (review finding 4)', async () => {
    const st = new FakeST([e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill', gate: [['road']] })]);
    await st.hooks.onGenerationStarted('normal', {}, false);
    // The generation's own WORLDINFO_ENTRIES_LOADED lands while loadModel waits on its read.
    let generationLore = null;
    const real = st.sorted.bind(st);
    st.sorted = () => { const out = real(); generationLore = out; return out; };
    const entries = await st.hooks.loadModel();
    assert.deepEqual(entries.map(x => x.uid).sort(), [0, 1], 'loadModel sees the closed mill too');
    assert.deepEqual(generationLore.map(x => x.uid), [0], 'the read was gated: the mill waits for the road');
    assert.ok(st.hooks.pending.working, 'the turn has its working state, so its snapshot gets written');
    assert.equal(st.hooks.model.nodes.size, 2);
});

test('a reply WI Hero didn\'t run for loses a snapshot copied from the swipe before (review finding 13)', async () => {
    const st = new FakeST([e(0, 'road', { id: 'road' })]);
    await st.send('road');
    const reply = st.chat.at(-1);
    assert.ok(reply.extra.wihero);
    st.settings.enabled = false;
    // ST starts a new swipe as a copy of the current one's extra (script.js saveReply / swipe).
    reply.swipe_id = 1;
    reply.swipe_info = [{ extra: structuredClone(reply.extra) }, { extra: structuredClone(reply.extra) }];
    await st.hooks.onGenerationStarted('swipe', {}, false);
    st.hooks.onWorldInfoActivated([]);
    st.hooks.onMessageReceived(st.chat.length - 1, 'swipe');
    assert.equal(reply.extra.wihero, undefined);
    assert.equal(reply.swipe_info[1].extra.wihero, undefined);
    assert.ok(reply.swipe_info[0].extra.wihero, 'the other swipe keeps its own');
    assert.ok(st.hooks.gap(), 'the reply shows as one WI Hero missed');
});

test('trackers: the written value replaces the scan copy, the instruction is set, old lines are stripped from copies', async () => {
    const st = new FakeST([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: { teach: { on: true, depth: 2 } } }, { comment: 'Gold', content: '10' })]);
    await st.send('gold', 'Found coins. [Gold: 7]');
    assert.deepEqual(st.prompts.at(-1), ['[Gold: 10]'], 'the start value, with its label');
    await st.send('more');
    assert.deepEqual(st.prompts.at(-1), ['[Gold: 7]'], 'the written value, on the scan copy');
    assert.equal(st.book[0].content, '10', 'never the book');
    const list = [...st.chat];
    const original = list[2];
    st.hooks.stripPrompt(list, 'normal');
    assert.equal(list[2].mes, 'Found coins.');
    assert.equal(original.mes, 'Found coins. [Gold: 7]', 'the chat\'s own message is untouched');
    assert.equal(st.chat.at(-1).extra.wiheroSent[0].written, true, 'the bubble marks it written');
    assert.deepEqual(st.extensionPrompt, { key: 'wihero_trackers', depth: 2, position: 1 }, 'set before the scan, at the book\'s depth');
    assert.match(st.extensionText, /\[Gold: \(value\)\]/);
    // A quiet generation or an impersonation lands nowhere in the chat: no instruction for it.
    for (const type of ['quiet', 'impersonate']) {
        await st.hooks.onAfterCommands(type, {}, false);
        assert.equal(st.extensionText, '', `no instruction for ${type}`);
    }
    await st.hooks.onAfterCommands('normal', {}, false);
    assert.match(st.extensionText, /Story trackers\./, 'back for the next reply');
});
