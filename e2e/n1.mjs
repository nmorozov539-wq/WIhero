// N1's in-ST checks (BUILD_SPEC 13): in a real SillyTavern 1.19.0 with the mock model, a chain advances, a swipe
// rewinds it, a rider rides, a lock opens in the same reply, a hold holds, a mask swaps in with macros, an old-build
// book still works, and a card round trip keeps the story logic.
// Setup: see e2e/README.md (copy examples/WIHero-N1.json and examples/WIHero-Sample.json into the worlds folder).
import assert from 'node:assert/strict';
import { ev, injected, lastPrompt, ok, run, send, slash, start, state, swipeRight, wait } from './lib.mjs';

const BOOK = 'WIHero-N1';
const K = id => `${BOOK}/${id}`;
const tags = () => injected(['N1-0', 'N1-1', 'N1-2', 'N1-3', 'N1-4', 'N1-5', 'N1-6', 'N1-7']);

await run(async () => {
    await start(BOOK);
    await slash('/world state=off silent=true WIHero-Sample'); // a run before may have left it on
    ok('setup');
    assert.deepEqual((await ev(() => wihero.model.issues)).filter(i => i.book === 'WIHero-N1'), []);
    ok('the N1 book loads without problems');

    // ── A chain advances ──
    await send('We talk about the mill.');
    assert.deepEqual(tags(), [], 'the mill waits for the road');
    await send('We take the road.');
    assert.deepEqual(tags(), ['N1-0']);
    assert.equal((await state()).fired[K('road')], 1);
    await send('The road brings us to the mill.');
    assert.deepEqual(tags(), ['N1-1'], 'the road closes as the mill fires: closing beats opening');
    let s = await state();
    assert.equal(s.closed[K('road')].by, `closesFor:${K('mill')}`);
    ok('a chain advances, each entry closing the one before');

    // ── A swipe rewinds ──
    await swipeRight();
    assert.deepEqual(tags(), ['N1-1']);
    s = await state();
    assert.equal(s.fired[K('mill')], 1, 'the swiped turn is worked out again, not counted twice');
    await ev(async () => { const c = SillyTavern.getContext(); c.chat.splice(c.chat.length - 2, 2); await c.saveChat(); await c.reloadCurrentChat(); });
    await wait(1500);
    s = await state();
    assert.equal(s.fired[K('mill')], undefined, 'deleting the turn rewinds it');
    assert.equal(s.closed[K('road')], undefined);
    await send('The road brings us to the mill.');
    assert.deepEqual(tags(), ['N1-1']);
    ok('a swipe and a delete rewind the story');

    // ── A rider rides with its host ──
    await send('Behind the wheel.');
    assert.deepEqual(tags(), ['N1-2', 'N1-3'], 'the echo rides along with the tunnel, through the extra scan pass');
    await send('zzzecho');
    assert.ok(!tags().includes('N1-3'), 'no host, no ride');
    ok('a rider rides only with its host');

    // ── A lock opens in the same reply ──
    await send('At the gatehouse.');
    assert.ok(!tags().includes('N1-4'), 'the lock waits for its phrase');
    await send('At the gatehouse a man with a red beard waves.');
    assert.ok(tags().includes('N1-4'), 'the phrase in the user message opens it in this reply (D1)');
    ok('a lock in the user message opens in the same reply');

    // ── A hold, and a mask with a macro ──
    await send('A storm rolls in.');
    assert.ok(tags().includes('N1-5'));
    await send('We wait.');
    assert.ok(tags().includes('N1-5'), 'held every turn');
    await send('Look at the tower.');
    assert.match(lastPrompt(), /The tower of Seraphina's youth lies in ruins/);
    await send('At last the rain stops.');
    assert.ok(!tags().includes('N1-5'), 'the close gate lock ends the hold in the same reply');
    ok('a hold holds until its close gate, and a mask swaps in with macros');

    // ── The off switch is a pause ──
    await ev(async () => {
        const c = SillyTavern.getContext();
        const data = await c.loadWorldInfo('WIHero-N1');
        data.entries[7].disable = true;
        await c.saveWorldInfo('WIHero-N1', data, true);
    });
    await send('The village.');
    assert.ok(!tags().includes('N1-7'));
    await ev(async () => {
        const c = SillyTavern.getContext();
        const data = await c.loadWorldInfo('WIHero-N1');
        data.entries[7].disable = false;
        await c.saveWorldInfo('WIHero-N1', data, true);
    });
    ok('the on/off switch still works');

    // ── An old-build book behaves as before ──
    await slash('/world silent=true WIHero-Sample');
    await send('On the road.');
    assert.ok(injected(['WIH-1']).length, 'the old book\'s root fires');
    await send('To the mill.');
    assert.ok(injected(['WIH-2']).length, 'and its chain advances');
    assert.ok((await state()).closed['WIHero-Sample/road'], 'the old "story moves on" default closed the road');
    ok('an old-build book loads with the same behavior');

    // ── A card round trip keeps the logic ──
    const trip = await ev(async () => {
        const c = SillyTavern.getContext();
        const headers = c.getRequestHeaders();
        delete headers['Content-Type'];
        const form = new FormData();
        for (const [k, v] of Object.entries({ ch_name: 'WIHero Card Trip', description: 'x', first_mes: 'Hi.', world: 'WIHero-N1' })) form.append(k, v);
        const created = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
        const avatar = (await created.text()).trim();
        const got = await fetch('/api/characters/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar }) });
        const card = await got.json();
        const { convertCharacterBook } = await import('/scripts/world-info.js');
        const book = convertCharacterBook(card.data.character_book);
        await fetch('/api/characters/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, delete_chats: true }) });
        const original = await c.loadWorldInfo('WIHero-N1');
        return { back: Object.values(book.entries).map(e => e.extensions?.wihero ?? null), original: Object.values(original.entries).map(e => e.extensions?.wihero ?? null) };
    });
    assert.equal(trip.original.filter(Boolean).length, 7, 'seven entries carry story logic');
    assert.deepEqual(trip.back, trip.original);
    ok('a book embedded in a card and imported back keeps its story logic');
});
