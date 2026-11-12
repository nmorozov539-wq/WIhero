// Moments' in-ST checks (CONCEPTS 3.13, LAYOUT "Piece bar"): at 390px wide, on a new global book "N8 Test", a
// Moment is made from the piece bar on empty canvas and on an entry, a lock becomes one with Make it a Moment, the
// panel lists them, Normal mode hides them, and in a real chat a Moment said in the user message opens its entry
// in the reply to it while sending nothing itself. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, injected, lastPrompt, ok, page, run, send, start, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'N8 Test';
const $ = sel => page.locator(`${W} ${sel}`);
const shot = name => page.screenshot({ path: `${LOG}n8-${name}.png` });
const entries = () => ev(async b => {
    await wihero.library.flush();
    return Object.values((await SillyTavern.getContext().loadWorldInfo(b)).entries);
}, BOOK);
const byTitle = async t => (await entries()).find(x => x.comment === t);
const card = title => $(`.card:has(.t:text-is("${title}"))`);
const chip = label => $(`.pchip:has-text("${label}")`);
async function center(loc) { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function drag(from, to) {
    await page.mouse.move(...from);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8);
    await page.mouse.up();
    await wait(300);
}
async function ask(value) {
    await $('.dlg input').fill(value);
    await $('.dlg .pri').click();
    await wait(400);
}
const addPhrase = async text => { await $('.insp input[aria-label="Add a phrase"]').fill(text); await page.keyboard.press('Enter'); await wait(400); };

await run(async () => {
    await start('WIHero-Sample');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    await ev(async b => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        await wihero.library.create(b);
        await wihero.library.get(b);
        const base = { keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        const names = ['Road', 'Dentist', 'Tower'];
        wihero.library.change(b, d => {
            names.forEach((name, uid) => { d.entries[uid] = { ...base, uid, displayIndex: uid, comment: name, key: [name.toLowerCase()], content: `[N8-${name} The ${name.toLowerCase()}.]` }; });
            // A lock on Tower's close gate, to make a Moment from.
            d.entries[2].extensions = { wihero: { id: 'tower', closeGate: [[{ lock: ['red beard'] }]] } };
        });
        await wihero.library.flush();
        const cards = {};
        names.forEach((n, i) => { cards[i === 2 ? 'id:tower' : `uid:${i}`] = { placed: true, x: 24 + (i % 2) * 204, y: 48 + Math.floor(i / 2) * 200 }; });
        wihero.settings.books[b] = { defaults: {}, folders: {}, canvas: { camera: { x: 0, y: 0, zoom: 0.8 }, cards, placed: true } };
        wihero.settings.openInHero = true;
        wihero.settings.pieceBarFolded = false;
        wihero.library.setGlobal('WIHero-Sample', false);
        wihero.library.setGlobal(b, true);
    }, BOOK);
    await page.click('#WI-SP-button .drawer-toggle');
    // ST may have selected the character's native lorebook while the hidden drawer initialized.
    await $('.tab[aria-label="Home"]').click();
    await $(`.item[data-book="${BOOK}"]`).click();
    await card('Dentist').waitFor();
    ok('setup: a global book "N8 Test" (Road, Dentist, Tower with a lock), at 390 × 844');

    // ── A Moment on empty canvas ──
    await chip('Moment').evaluate(n => n.scrollIntoView({ inline: 'nearest' }));
    await chip('Moment').click();
    assert.match(await $('.armban').textContent(), /a card that reacts to a new Moment, or empty canvas/);
    const vp = await $('.vp').boundingBox();
    await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height - 80);
    await ask('Missing tooth');
    await $('.insp .ihead h2:text-is("Missing tooth")').waitFor();
    await addPhrase('missing tooth');
    await addPhrase('lost a tooth');
    let tooth = await byTitle('Moment: Missing tooth');
    assert.deepEqual(tooth.key, ['missing tooth', 'lost a tooth']);
    assert.equal(tooth.disable, true, 'stored with ST\'s switch off');
    assert.equal(tooth.content, '');
    assert.equal(tooth.extensions.wihero.moment, true);
    await $('.insp .iseg button:text-is("You")').click();
    await wait(300);
    tooth = await byTitle('Moment: Missing tooth');
    assert.equal(tooth.extensions.wihero.by, 'user', 'who says it');
    await card('Missing tooth').waitFor();
    assert.match(await card('Missing tooth').textContent(), /MOMENT · YOU/);
    await shot('card');
    ok('the Moment chip on empty canvas: named, placed, phrases added in its inspector, stored off with no content');

    // ── A Moment dropped on an entry: it opens the Dentist ──
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await $('button[aria-label="Fit to screen"]').click();
    await wait(300);
    await chip('Moment').evaluate(n => n.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
    await drag(await center(chip('Moment')), await center(card('Dentist')));
    await ask('Storm breaks');
    await $('.sheet .opt:has(.lab:text-is("opens"))').click();
    await wait(400);
    const storm = await byTitle('Moment: Storm breaks');
    const dentist = await byTitle('Dentist');
    assert.deepEqual(dentist.extensions.wihero.gate, [[storm.extensions.wihero.id]]);
    ok('the Moment chip dropped on Dentist: a new Moment that opens it (Dentist\'s gate)');

    // ── Make it a Moment: Tower's lock ──
    await $('.insp .ihead button[aria-label="Close the inspector"]').click().catch(() => {});
    await $('button[aria-label="Fit to screen"]').click();
    await wait(300);
    await $('.lockp:has-text("red beard")').click();
    await $('.pstrip').waitFor();
    await $('.pstrip button:has-text("Make it a Moment")').click();
    await wait(400);
    const beard = await byTitle('Moment: Red beard');
    assert.deepEqual(beard.key, ['red beard']);
    assert.deepEqual((await byTitle('Tower')).extensions.wihero.closeGate, [[beard.extensions.wihero.id]], 'the lock became a link from the Moment');
    await card('Red beard').waitFor();
    ok('Make it a Moment: the lock\'s phrases move to a new Moment, and Tower closes when it happens');

    // ── The panel lists them; Missing tooth opens Dentist too ──
    await ev(async b => { wihero.library.change(b, d => { const t = Object.values(d.entries).find(x => x.comment === 'Moment: Missing tooth'); t.extensions.wihero.gatesFor = ['dentist']; const den = Object.values(d.entries).find(x => x.comment === 'Dentist'); den.extensions.wihero = { id: 'dentist' }; }); await wihero.library.flush(); }, BOOK);
    await $('.panelBtn').click();
    await $('.panel:not(.closed)').waitFor();
    assert.deepEqual(await $('.prow.moment .nm b').allTextContents(), ['Missing tooth', 'Red beard', 'Storm breaks']);
    assert.equal(await $('.prow:not(.moment) .nm:has-text("Moment:")').count(), 0, 'not in the entry list');
    await shot('panel');
    ok('the panel\'s Moments group lists all three; the entry list has none of them');
    // From here Missing tooth opens Dentist (Gates for), and Storm breaks no longer does.

    // ── Explain mode on a phone: "?" then a tap on a Moment card opens the Guide at Moment ──
    await $('.panelBtn').click();
    await $('button[aria-label="Fit to screen"]').click();
    await $('.explainq').click();
    await $('.explainban').waitFor();
    const mb = await card('Missing tooth').boundingBox();
    await page.mouse.click(mb.x + mb.width / 2, mb.y + 10);
    await $('.guide .gpage[data-anchor="moment"]').waitFor();
    assert.equal(await $('.insp').count(), 0, 'the tap did not inspect the card');
    await shot('guide');
    await $('.tab[aria-label="Canvas"]').click();
    await card('Missing tooth').locator('.t').click();
    await $('.insp .pc[data-piece="gatesFor"] .pq').first().click();
    await $('.guide .gpage[data-anchor="opens"]').waitFor();
    await $('.tab[aria-label="Canvas"]').click();
    ok('explain mode on a phone: "?" then a tap on a Moment opens the Guide at Moment; an inspector row\'s "?" opens its page');

    // ── Normal mode hides them ──
    await ev(() => { wihero.settings.openInHero = false; });
    await $('.panelBtn').click();
    await ev(() => { const S = wihero.app.state; S.mode = 'normal'; wihero.app.refresh(); });
    if (!await ev(() => !document.getElementById('wihero-editor').hidden)) await page.click('#WI-SP-button .drawer-toggle');
    await $('.tab[aria-label="Home"]').click().catch(() => {});
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.item.ent').first().waitFor();
    assert.deepEqual(await $('.item.ent .nm').allTextContents(), ['Road', 'Dentist', 'Tower']);
    await ev(() => { wihero.app.state.search = { query: 'tooth' }; wihero.app.refresh(); });
    await wait(300);
    assert.ok(!await ev(() => document.getElementById('wihero-editor').shadowRoot.textContent.includes('Missing tooth')), 'search leaves them out');
    await page.keyboard.press('Escape');
    ok('Normal mode: no Moments in the book\'s list or in search');

    // ── In a chat: said in the user message, it opens Dentist in the same reply; it sends nothing itself ──
    if (await ev(() => !document.getElementById('wihero-editor').hidden)) await page.click('#WI-SP-button .drawer-toggle');
    await wait(300);
    await send('I lost a tooth, I need a dentist.');
    assert.deepEqual(injected(['N8-Dentist']), ['N8-Dentist'], 'Dentist in the reply to the message that said it');
    assert.ok(!lastPrompt().includes('Moment:'), 'the Moment itself never reaches the prompt');
    const st = await ev(b => wihero.state ? Object.keys(wihero.state.fired ?? {}).filter(k => k.startsWith(`${b}/`)) : [], BOOK);
    assert.ok(st.some(k => /missing-tooth/.test(k)), 'it happened');
    ok('a real chat: "lost a tooth" in the user message makes the Moment happen, Dentist fires in that reply, the Moment sends nothing');

    await ev(async b => {
        const { deleteWorldInfo } = await import('/scripts/world-info.js');
        await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        wihero.library.setGlobal('WIHero-Sample', true);
    }, BOOK);
});
