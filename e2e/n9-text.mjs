// Trackers with text completion (docs/TRACKERS.md): n9's prompt checks with SillyTavern's Text Completion API
// (generic OpenAI-compatible, the mock's text answers), instruct mode off, or ChatML with INSTRUCT=1. The instruction
// reaches the prompt, the start value then the newest value, old lines out of the history, a swipe rewinding, a
// hidden block mask, a continue keeping its message, and no instruction for a quiet generation. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOG, ev, ok, page, prompts, run, send, slash, start, swipeRight, wait } from './lib.mjs';
const BOOK = 'N9 Text Trackers';
const next = text => fetch(`http://127.0.0.1:${process.env.MOCK_PORT || 5001}/next`, { method: 'POST', body: text });
const prompt = () => JSON.parse(fs.readFileSync(LOG + prompts().pop(), 'utf8')).body.prompt;
const values = () => ev(() => Object.fromEntries(wihero.hooks.values()));
const G = `${BOOK}/gold`, C = `${BOOK}/ship|m:Custom`;
const INSTRUCT = process.env.INSTRUCT === '1';
await run(async () => {
    await start('WIHero-Sample');
    await ev(port => {
        $('#main_api').val('textgenerationwebui').trigger('change');
        $('#textgen_type').val('generic').trigger('change');
        $('#generic_api_url_text').val(`http://127.0.0.1:${port}`).trigger('input');
        $('#streaming_textgenerationwebui').prop('checked', false).trigger('input').trigger('change');
        $('#api_button_textgenerationwebui').trigger('click');
    }, process.env.MOCK_PORT || 5001);
    await page.waitForFunction(() => SillyTavern.getContext().mainApi === 'textgenerationwebui' && SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 });
    if (INSTRUCT) { await slash('/instruct ChatML'); await wait(500); }
    await ev(async b => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        await wihero.library.create(b); await wihero.library.get(b);
        const base = { keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        const teach = { on: true, depth: 1 };
        wihero.library.change(b, d => {
            d.entries[0] = { ...base, uid: 0, displayIndex: 0, comment: 'Gold', key: ['gold'], content: '10 coins', extensions: { wihero: { id: 'gold', glue: { mode: 'hold' }, written: { describe: 'coins the player carries', teach } } } };
            d.entries[1] = { ...base, uid: 1, displayIndex: 1, comment: 'Ship config', key: ['ship'], content: 'Ship: standard config', extensions: { wihero: { id: 'ship', glue: { mode: 'hold' }, masks: [{ name: 'Custom', written: { shape: 'block', show: false, describe: 'a custom config', teach } }] } } };
        });
        await wihero.library.flush();
        wihero.library.setGlobal('WIHero-Sample', false); wihero.library.setGlobal(b, true);
        await wihero.hooks.loadModel();
    }, BOOK);
    ok(`setup (text completion, instruct ${INSTRUCT ? 'ChatML' : 'off'})`);

    await next('[Gold: 7 coins]');
    await send('I check my gold.');
    let p = prompt();
    assert.ok(typeof p === 'string', 'a text-completion prompt');
    assert.match(p, /Story trackers\./, 'instruction sent');
    assert.match(p, /\[Gold: 10 coins\]/, 'start value sent');
    assert.deepEqual(await values(), { [G]: '7 coins' });
    await send('And now?');
    p = prompt();
    assert.match(p, /\[Gold: 7 coins\]/);
    assert.doesNotMatch(p, /10 coins/);
    assert.doesNotMatch(p, /Mock reply \d+\s*\[Gold/, 'old line out of history');
    assert.match(p, /now 7 coins/);
    ok('instruction, start value, newest value, history stripped');

    await next('[Gold: 3 coins]');
    await send('I pay.');
    assert.equal((await values())[G], '3 coins');
    await swipeRight();
    assert.equal((await values())[G], '7 coins');
    ok('swipe rewinds');

    await next('<Ship config · Custom>\nspeed: 9\nhull: 2\n</Ship config · Custom>');
    await send('Configure the ship.');
    assert.equal((await values())[C], 'speed: 9\nhull: 2');
    assert.doesNotMatch(await page.locator('#chat .last_mes .mes_text').textContent(), /speed: 9/);
    await send('Sail.');
    p = prompt();
    assert.match(p, /speed: 9\nhull: 2/);
    assert.doesNotMatch(p, /Ship: standard config/);
    assert.equal((p.match(/speed: 9/g) || []).length, 1, 'value once (history stripped)');
    ok('block mask on, hidden in chat, sent once');

    // continue: the continued message keeps its lines
    await next('[Gold: 4 coins]');
    await send('Spend.');
    const before = prompts().length;
    await slash('/continue');
    for (let i = 0; i < 100 && prompts().length <= before; i++) await wait(100);
    await wait(800);
    p = prompt();
    assert.match(p, /Mock reply \d+\s*\n?\[Gold: 4 coins\]\s*$/, 'continue keeps the continued message intact');
    ok('continue keeps the last message');

    // A quiet generation gets no instruction (it lands nowhere in the chat).
    const q = prompts().length;
    await slash('/gen lock=on Summarize the story in one line.');
    for (let i = 0; i < 100 && prompts().length <= q; i++) await wait(100);
    assert.doesNotMatch(prompt(), /Story trackers\./, 'no instruction for /gen');
    ok('no instruction for a quiet generation');

    await ev(async b => { const { deleteWorldInfo } = await import('/scripts/world-info.js'); wihero.library.setGlobal(b, false); await deleteWorldInfo(b); }, BOOK);
});
