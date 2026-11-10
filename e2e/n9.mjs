// Trackers' in-ST checks (docs/TRACKERS.md): on a new global book "N9 Trackers" in WI Hero's own mode, a written
// main (Gold) and a written block mask (Ship config · Custom, hidden in chat). In a real chat with the mock model:
// the instruction reaches the prompt, the start value is sent until the model writes one, the newest value is sent
// from the next message, old lines are taken out of the history, a swipe rewinds a value, a block mask switches on
// and off, Show in chat hides its lines, /wihero-set and an edit of the latest reply, and the editor's Tracker piece,
// value line and syntax builder. Setup: e2e/README.md. Needs the mock's /next (e2e/mock.mjs).
import assert from 'node:assert/strict';
import { LOG, ev, lastPrompt, ok, page, run, send, slash, start, swipeRight, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'N9 Trackers';
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT || 5001}`;
const $ = sel => page.locator(`${W} ${sel}`);
const shot = name => page.screenshot({ path: `${LOG}n9-${name}.png` });
const next = text => fetch(`${MOCK}/next`, { method: 'POST', body: text });
/** The prompt's history and injections, without the system instruction. */
const prompt = () => lastPrompt();
const values = () => ev(() => Object.fromEntries(wihero.hooks.values()));
const G = `${BOOK}/gold`;
const C = `${BOOK}/ship|m:Custom`;

await run(async () => {
    await start('WIHero-Sample');
    await ev(async b => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        await wihero.library.create(b);
        await wihero.library.get(b);
        const base = { keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        const teach = { on: true, depth: 1 };
        wihero.library.change(b, d => {
            d.entries[0] = { ...base, uid: 0, displayIndex: 0, comment: 'Gold', key: ['gold'], content: 'Purse: 10 coins',
                extensions: { wihero: { id: 'gold', glue: { mode: 'hold' }, written: { describe: 'coins the player carries', teach } } } };
            d.entries[1] = { ...base, uid: 1, displayIndex: 1, comment: 'Ship config', key: ['ship'], content: 'Ship: standard config',
                extensions: { wihero: { id: 'ship', glue: { mode: 'hold' }, masks: [{ name: 'Custom', written: { shape: 'block', show: false, describe: 'a custom config', teach } }] } } };
        });
        await wihero.library.flush();
        const cards = { 'id:gold': { placed: true, x: 24, y: 48 }, 'id:ship': { placed: true, x: 228, y: 48 } };
        wihero.settings.books[b] = { defaults: {}, folders: {}, canvas: { camera: { x: 0, y: 0, zoom: 0.8 }, cards, placed: true } };
        wihero.library.setGlobal('WIHero-Sample', false);
        wihero.library.setGlobal(b, true);
        await wihero.hooks.loadModel();
    }, BOOK);
    const issues = await ev(() => wihero.hooks.model.issues.filter(i => !i.warning).map(i => i.message));
    assert.deepEqual(issues, []);
    ok('setup: a global book with a written main (Gold) and a written block mask (Ship config · Custom), WI Hero teaching');

    // ── Teaching, the start value, the newest value from the next message ──
    await next('[Gold: 7 coins]');
    await send('I check my gold.');
    let p = prompt();
    assert.match(p, /Story trackers\./, 'the instruction is sent');
    assert.match(p, /\[Gold: \(value\)\]\n {2}\(coins the player carries; now Purse: 10 coins\)/, 'the start value as the current one');
    assert.match(p, /Purse: 10 coins/, 'the start value, before anything is written');
    assert.deepEqual(await values(), { [G]: '7 coins' });
    await send('And now?');
    p = prompt();
    assert.match(p, /\n7 coins|^7 coins/m, 'the written value is sent as the entry');
    assert.doesNotMatch(p, /Purse: 10 coins/);
    assert.doesNotMatch(p, /\[Gold: 7 coins\]/, 'the old line is out of the history');
    assert.match(p, /now 7 coins/, 'the instruction carries the current value');
    ok('the instruction reaches the prompt; the start value until a value is written; then the value, with the old line stripped');

    // ── A swipe rewinds a value ──
    await next('[Gold: 3 coins]');
    await send('I pay.');
    assert.equal((await values())[G], '3 coins');
    await swipeRight();
    assert.equal((await values())[G], '7 coins', 'the swiped reply had no line: back to 7');
    ok('a swipe rewinds the value');

    // ── A block mask: on while written, hidden in chat, off when cleared ──
    await next('<Ship config · Custom>\nspeed: 9\nhull: 2\n</Ship config · Custom>');
    await send('Configure the ship.');
    assert.equal((await values())[C], 'speed: 9\nhull: 2');
    const shown = await page.locator('#chat .last_mes .mes_text').textContent();
    assert.doesNotMatch(shown, /speed: 9/, 'hidden in chat');
    assert.equal(await ev(() => SillyTavern.getContext().chat.at(-1).mes.includes('speed: 9')), true, 'still in the message');
    await send('Sail.');
    p = prompt();
    assert.match(p, /speed: 9\nhull: 2/, 'the mask\'s value is sent');
    assert.doesNotMatch(p, /Ship: standard config/);
    await next('<Ship config · Custom></Ship config · Custom>');
    await send('Back to normal.');
    await send('Sail again.');
    p = prompt();
    assert.match(p, /Ship: standard config/, 'cleared: the main text again');
    assert.doesNotMatch(p, /speed: 9/);
    ok('a written block mask switches on when written and off when cleared, and its lines are hidden in chat');

    // ── The bubble ──
    await next('[Gold: 5 coins]');
    await send('Spend two.');
    await page.click('#wihero_bubble');
    assert.match(await page.locator('.wihero-bubble-menu').textContent(), /Gold → 5 coins/);
    await page.click('#wihero_bubble');
    ok('the bubble lists what the last reply wrote');

    // ── /wihero-set and an edit of the latest reply ──
    await slash('/wihero-set entry=gold 99 coins');
    await wait(300);
    assert.equal((await values())[G], '99 coins');
    await ev(async () => {
        const c = SillyTavern.getContext();
        const id = c.chat.length - 1;
        c.chat[id].mes = c.chat[id].mes.replace(/\[Gold:[^\]]*\]/, '[Gold: 6 coins]');
        await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, id);
    });
    await wait(300);
    assert.equal((await values())[G], '6 coins', 'the latest reply read again');
    await slash('/wihero-set entry=gold');
    await wait(300);
    assert.equal((await values())[G], '');
    await send('Count.');
    assert.match(prompt(), /Purse: 10 coins/, 'cleared by hand: the start value');
    ok('/wihero-set sets and clears; an edit of the latest reply reads it again');

    // ── The editor: Tracker piece, value line, builder ──
    await slash('/wihero-set entry=gold 12 coins');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    await ev(() => { wihero.settings.openInHero = true; });
    await page.click('#WI-SP-button .drawer-toggle');
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.card:has(.t:text-is("Gold"))').waitFor();
    await $('button[aria-label="Fit to screen"]').click().catch(() => {});
    await $('.card:has(.t:text-is("Gold")) .t').click();
    await $('.insp .pc[data-piece="written"]').waitFor();
    await $('.insp .pc[data-piece="written"] .pct').click();
    await $('.insp .trkval .v:text-is("12 coins")').waitFor();
    await shot('inspector');
    await $('.insp button:has-text("Syntax and teaching")').click();
    await $('.sheet.trkb').waitFor();
    assert.match(await $('.sheet.trkb .trkpre').textContent(), /\[Gold: \(value\)\]/);
    await $('.sheet.trkb .addb:has-text("HTML comment")').click();
    assert.match(await $('.sheet.trkb .trkpre').textContent(), /<!-- Gold=\(value\) -->/);
    await shot('builder');
    await $('.sheet.trkb .pri').click();
    await wait(600);
    const stored = await ev(async b => { await wihero.library.flush(); return Object.values((await SillyTavern.getContext().loadWorldInfo(b)).entries).map(e => e.extensions.wihero); }, BOOK);
    assert.equal(stored[0].written.syntax.line, '<!-- {label}={value} -->');
    assert.equal(stored[1].masks[0].written.syntax.line, '<!-- {label}={value} -->', 'copied onto every written slot');
    ok('the inspector shows the Tracker piece with the value; the builder previews the instruction and saves the syntax onto every slot');
    await ev(async b => {
        const { deleteWorldInfo } = await import('/scripts/world-info.js');
        wihero.library.setGlobal(b, false);
        await deleteWorldInfo(b);
    }, BOOK);
});
