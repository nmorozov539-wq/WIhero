// N4's in-ST checks (ROADMAP N4, BUILD_SPEC 13): at 390px wide, every piece of CONCEPTS 3 is added, edited and
// removed from the inspector and lands in the book; ports and Problems open the inspector; mask text is written
// through the entry page's chips; greetings stay hidden (retired for v1); and Reopen works and rewinds. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, ok, page, run, send, start, swipeRight, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'N4 Test';
const SAMPLE = 'WIHero-Sample';
const $ = sel => page.locator(`${W} ${sel}`);
const opt = text => $(`.opt:has(.lab:text-is("${text}"))`);
const piece = key => $(`.insp .pc[data-piece="${key}"]`);
const shot = name => page.screenshot({ path: `${LOG}n4-${name}.png` });
/** The stored story logic of an entry, by its title, from the saved book. */
const cfg = (title, book = BOOK) => ev(async ([b, t]) => {
    await wihero.library.flush();
    const d = await SillyTavern.getContext().loadWorldInfo(b);
    const e = Object.values(d.entries).find(x => x.comment === t);
    return e?.extensions?.wihero ?? null;
}, [book, title]);
const entryOf = (title, book = BOOK) => ev(async ([b, t]) => {
    await wihero.library.flush();
    const d = await SillyTavern.getContext().loadWorldInfo(b);
    return Object.values(d.entries).find(x => x.comment === t);
}, [book, title]);

async function ask(value) {
    await $('.dlg input').fill(value);
    await $('.dlg .pri').click();
    await wait(250);
}
async function menu(...path) {
    if (await $('.scrim').count()) { await page.keyboard.press('Escape'); await wait(100); } // menus stay open after a pick
    await $('.tabbar .iconbtn').click();
    for (const p of path) { await opt(p).click(); await wait(200); }
    if (path.length && await $('.sheet.menu').count()) { await page.keyboard.press('Escape'); await wait(100); }
}
/** Finds an entry from the panel (placing it if needed), then taps its card: the inspector opens. */
async function inspect(title) {
    if (await $('.insp').count()) await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await $('.panelBtn').click();
    await $('.panel:not(.closed)').waitFor();
    await $('.panel .phead input').fill('');
    // The key first: placing or showing the card closes the panel.
    const key = await $(`.prow:has(.nm:text-is("${title}"))`).getAttribute('data-key');
    await $(`.prow:has(.nm:text-is("${title}")) .dotc`).click();
    await wait(250);
    await $(`.card[data-id="${key}"] .t`).click();
    await $(`.insp .ihead h2:text-is("${title}")`).waitFor();
    return key;
}
async function addPiece(label) {
    await $('.insp .addpiece').click();
    await opt(label).click();
    await wait(200);
}
/** "+ add" (or "+ Another row (OR)") in the open piece, then picks a target. */
async function pick(addText, ...path) {
    await $(`.insp .pc.open .addb:text-is("${addText}")`).last().click();
    for (const p of path) { await opt(p).first().click(); await wait(200); }
    await wait(200);
}

await run(async () => {
    await start(SAMPLE);
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    // A plain book to build on.
    await ev(async b => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        await wihero.library.create(b);
        await wihero.library.get(b);
        const base = { keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        wihero.library.change(b, d => {
            ['Hall', 'Key', 'Door', 'Inn', 'Market', 'Storm'].forEach((name, uid) => {
                d.entries[uid] = { ...base, uid, displayIndex: uid, comment: name, key: [name.toLowerCase()], content: `The ${name.toLowerCase()}.` };
            });
        });
        await wihero.library.flush();
        wihero.settings.openInHero = true;
    }, BOOK);
    ok('setup: a chat with the sample book, and a plain book "N4 Test" at 390 × 844');

    await page.click('#WI-SP-button .drawer-toggle');
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.cv-empty').waitFor();
    assert.ok(await $('.cv-empty .cv-ic svg').count(), 'the hint shows the panel\'s icon');
    // A long press on the empty canvas picks an entry to place there.
    const vp = await $('.vp').boundingBox();
    const [hx, hy] = [vp.x + vp.width / 2, vp.y + vp.height / 3];
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await wait(800);
    await page.mouse.up();
    await $('.sheet h2:text-is("Place here")').waitFor();
    await $('.sheet .pick-q').fill('inn');
    await $('.sheet .opt:has(.lab:text-is("Inn"))').click();
    const inn = $('.card:has-text("Inn")');
    await inn.waitFor();
    const ib = await inn.boundingBox();
    assert.ok(Math.abs(ib.x + ib.width / 2 - hx) < 40 && Math.abs(ib.y + ib.height / 2 - hy) < 40, 'placed where the finger was');
    ok('a book with no pieces opens to an empty canvas (D8); a long press there places an entry on that spot');

    // ── Packs ──
    await inspect('Inn');
    await addPiece('Packs');
    await pick('+ add', 'New pack…');
    await ask('town');
    assert.deepEqual((await cfg('Inn')).packs, ['town']);
    assert.equal((await cfg('Inn')).id, 'inn', 'an entry gets an id from its name when it gets a piece');
    await inspect('Market');
    await addPiece('Packs');
    await pick('+ add', '#town');
    assert.deepEqual((await cfg('Market')).packs, ['town']);
    ok('Packs: a new pack and an existing one');

    // ── Gate, with a pack reading, a lock, a wait; Story moves on ──
    const door = await inspect('Door');
    assert.equal(door, 'uid:2');
    await addPiece('Waits for');
    await pick('+ add', 'Key');
    assert.deepEqual((await cfg('Door')).gate, [['key']]);
    await pick('+ add', '#town', 'All of them');
    assert.deepEqual((await cfg('Door')).gate, [['key', '#town:all']]);
    assert.ok(await $('.packframe:has(.pn:text-is("#town"))').count(), 'a pack read by a rule gets its frame');
    await pick('+ Another row (OR)', 'Lock phrase…');
    await ask('open sesame, knock knock');
    await $('.insp .pc.open .rowbox').nth(1).locator('.addb').click();
    await opt('Wait…').click();
    await ask('3');
    assert.deepEqual((await cfg('Door')).gate, [['key', '#town:all'], [{ lock: ['open sesame', 'knock knock'] }, { wait: 3 }]]);
    await $('.insp .pc.open .chip:has-text("all of #town") button').click();
    await wait(200);
    assert.deepEqual((await cfg('Door')).gate, [['key'], [{ lock: ['open sesame', 'knock knock'] }, { wait: 3 }]]);
    assert.equal(await $('.insp .ihead h2').textContent(), 'Door', 'the inspector stays on Door, now id:door');
    assert.ok(await $('.card[data-id="id:door"]').count());
    await $('.insp .pc.open .addb.mo').click();
    await wait(200);
    assert.deepEqual((await cfg('Door')).closesFor, ['key']);
    assert.ok(await $('.insp .pc[data-piece="gate"] .phelp:has-text("already closes Key")').count());
    await shot('gate');
    ok('Gate: an entry, a pack reading, a lock and a wait in two rows; a chip removed; Story moves on writes Closes for');

    // ── Close gate, Closes for ──
    await addPiece('Closes when');
    await pick('+ add', 'Storm');
    assert.deepEqual((await cfg('Door')).closeGate, [['storm']]);
    await piece('closesFor').locator('.pct').click();
    await pick('+ add', '#town');
    assert.deepEqual((await cfg('Door')).closesFor, ['key', '#town']);
    await piece('closesFor').locator('.chip:has-text("Key") button').click();
    await wait(200);
    assert.deepEqual((await cfg('Door')).closesFor, ['#town']);
    ok('Close gate and Closes for: added, a pack target, a target removed');

    // ── Masks; mask text through the entry page's chips (D15) ──
    await addPiece('Masks');
    await $('.insp .pc.open .addb:text-is("+ Mask")').click();
    await ask('ruined');
    await $('.insp .pc.open .mlayer .addb').first().click();
    await opt('Storm').click();
    await wait(200);
    let door2 = await cfg('Door');
    assert.equal(door2.masks[0].name, 'ruined');
    assert.deepEqual(door2.masks[0].gate, [['storm']]);
    assert.equal(door2.masks[0].content, 'The door.', 'a new mask starts as a copy of the main text');
    await $('.insp .mlayer .mtext').click(); // the first line of the mask's text opens it (#27)
    await $('.en h1:text-is("Door")').waitFor();
    assert.equal(await $('.mchip.on').textContent(), 'ruined');
    await $('.en textarea').fill('The door hangs off its hinges.');
    await $('.mchip:has-text("Main")').click();
    assert.equal(await $('.en textarea').inputValue(), 'The door.');
    door2 = await cfg('Door');
    assert.equal(door2.masks[0].content, 'The door hangs off its hinges.');
    assert.equal((await entryOf('Door')).content, 'The door.');
    await page.keyboard.press('Escape');
    await $('.card').first().waitFor();
    ok('Masks: a mask with an On when row; its text is written on its chip and the main text stays');

    // ── Gates for, Glue, Switch, Once, Who triggers ──
    await inspect('Key');
    await addPiece('Opens');
    await pick('+ add', 'Market');
    assert.deepEqual((await cfg('Key')).gatesFor, ['market']);
    // Who triggers is a selector at the top of the inspector, not a piece (#14).
    await $('.insp .isets [aria-label="Who triggers"] button:text-is("You")').click();
    await wait(200);
    assert.equal((await cfg('Key')).by, 'user');
    await $('.insp .isets [aria-label="Who triggers"] button:text-is("Character")').click();
    await wait(200);
    assert.equal((await cfg('Key')).by, 'char');

    await inspect('Storm');
    await addPiece('Glue');
    assert.deepEqual((await cfg('Storm')).glue, { mode: 'hold' });
    assert.ok(await piece('glue').locator('.phelp:has-text("Nothing ends it yet")').count());
    assert.equal(await $('.insp .isets .switch[aria-label^="Once"]').count(), 0, 'Once isn\'t offered on a glued entry');
    await piece('glue').locator('.seg button:text-is("Ride along")').click();
    await opt('Key').click();
    await wait(200);
    assert.deepEqual((await cfg('Storm')).glue, { mode: 'ride', host: 'key' });
    await piece('glue').locator('.pq[aria-label="Remove Glue"]').click();
    await wait(200);
    assert.equal((await cfg('Storm')).glue, undefined);

    await inspect('Hall');
    await addPiece('Switch');
    await pick('+ add', 'Inn');
    await pick('+ add', 'Market');
    assert.deepEqual((await cfg('Hall')).switch, ['inn', 'market']);
    // Once is a switch at the top of the inspector, not a piece (#31).
    await $('.insp .isets .switch[aria-label^="Once"]').click();
    await wait(200);
    assert.equal((await cfg('Hall')).once, true);
    await $('.insp .isets .switch[aria-label^="Once"]').click();
    await wait(200);
    assert.equal((await cfg('Hall')).once, undefined);
    await shot('switch');
    ok('Gates for, Who triggers, Glue (hold, then ride, then removed), Switch and Once are added, edited and removed');

    // ── Ports and the From other entries list ──
    await inspect('Market');
    assert.deepEqual((await $('.insp .opt .lab').allTextContents()).sort(), ['Door', 'Inn', 'Key'], 'Market lists Key (gates for it), Door (closes #town) and Inn (the other path of the fork)');
    await $('.insp .opt:has(.lab:text-is("Key"))').click();
    await $('.insp .ihead h2:text-is("Key")').waitFor();
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await inspect('Door');
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await $('circle[data-port="id:door|gin"]').click({ force: true });
    await $('.insp .pc.open[data-piece="gate"]').waitFor();
    ok('a port opens the inspector on its piece; From other entries jumps to the source');

    // ── Problems open the inspector (D19) ──
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await ev(b => wihero.library.change(b, d => { d.entries[9] = { ...d.entries[0], uid: 9, displayIndex: 9, comment: 'Tower', key: ['tower'], extensions: { wihero: { id: 'tower', gate: [['nowhere']] } } }; }), BOOK);
    await wait(300);
    await $('.tabbar .iconbtn').click();
    await $('.opt.probs').click();
    await $('.sheet .opt:has(.lab:text-is("Tower"))').click();
    await $('.insp .ihead h2:text-is("Tower")').waitFor();
    assert.ok(await $('.insp .iprob:has-text("nowhere")').count());
    assert.ok(await $('.card[data-id="id:tower"] .cbang').count());
    ok('Problems in the Hero menu opens the inspector, with the problem in it and "!" on the card');

    // ── Greetings are retired for v1 (#33): no panel rows, no cards ──
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await $('.panelBtn').click();
    await wait(300);
    assert.equal(await $('.prow.greet:not(.moment)').count(), 0, 'no greeting rows in the panel');
    assert.equal(await $('.card.greet:not(.moment)').count(), 0, 'no greeting cards');
    await $('.canvas-tools button[aria-label="Fit to screen"]').click();
    await wait(300);
    await shot('fit');
    await $('.panelBtn').click(); // the panel covers the canvas on a phone
    await wait(300);
    await $('.card[data-id="id:tower"] .t').click();
    ok('greetings are retired: no greeting rows or cards');

    // ── Reopen, and it rewinds (D18) ──
    await $('.insp .ihead button[aria-label="Close the inspector"]').click();
    await page.click('#WI-SP-button .drawer-toggle');
    await send('We take the road out of the village.');
    await send('At last the mill comes into view.');
    const roadKey = `${SAMPLE}/road`;
    assert.ok(await ev(k => !!wihero.state.closed[k], roadKey), 'the mill closed the road');
    await page.click('#WI-SP-button .drawer-toggle');
    await $('.tabbar .iconbtn').click();
    await opt('Switch book').click();
    await opt(SAMPLE).click();
    await inspect('Road: leaving the village');
    await $('.insp .ireopen:has-text("Mill: arrival")').waitFor();
    await $('.insp .ireopen button:text-is("Reopen")').click();
    await page.waitForFunction(k => !wihero.state.closed[k], roadKey);
    await $('.insp .ireopen').waitFor({ state: 'detached' });
    await page.click('#WI-SP-button .drawer-toggle');
    await swipeRight();
    assert.ok(await ev(k => !!wihero.state.closed[k], roadKey), 'a swipe of the reopened message rewinds the Reopen');
    ok('Reopen opens a closed entry from the inspector; swiping that message rewinds it');

    // ── Leftovers ──
    await ev(async b => {
        const { deleteWorldInfo } = await import('/scripts/world-info.js');
        await wihero.library.flush();
        await deleteWorldInfo(b);
        delete wihero.settings.books[b];
        wihero.settings.openInHero = false;
        SillyTavern.getContext().saveSettingsDebounced();
    }, BOOK);
    await wait(1500);
    ok('cleaned up');
});
