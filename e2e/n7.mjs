// The piece bar's in-ST checks (pieces-one-by-one, LAYOUT "Piece bar"): at 390px wide, on a new book "N7 Test",
// every chip is placed by a tap or a drag, set up in its strip and checked in the saved book; lines and locks
// reopen their strip; Cancel puts the book back; a loop is refused. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, ok, page, run, start, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'N7 Test';
const $ = sel => page.locator(`${W} ${sel}`);
const shot = name => page.screenshot({ path: `${LOG}n7-${name}.png` });
const cfg = title => ev(async ([b, t]) => {
    await wihero.library.flush();
    const d = await SillyTavern.getContext().loadWorldInfo(b);
    return Object.values(d.entries).find(x => x.comment === t)?.extensions?.wihero ?? null;
}, [BOOK, title]);
const card = title => $(`.card:has(.t:text-is("${title}"))`);
const chip = label => $(`.pchip:has-text("${label}")`);
/** The middle of a chip, scrolled into view in the bar first. */
const chipAt = async label => { await chip(label).evaluate(n => n.scrollIntoView({ inline: 'nearest', block: 'nearest' })); return center(chip(label)); };
const strip = () => $('.pstrip');
const say = () => $('.pstrip .say').first().textContent();
async function center(loc) { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
/** Drags from one point to another with the mouse, in steps (a chip or the loose end). */
async function drag(from, to) {
    await page.mouse.move(...from);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8);
    await page.mouse.up();
    await wait(250);
}
/** A point on a line on the screen, by its ends. */
const linePoint = ends => $(`svg.lk path.lhit[data-ends="${ends}"]`).first().evaluate(p => {
    const pt = p.getPointAtLength(p.getTotalLength() * 0.3);
    const m = p.getScreenCTM();
    return [pt.x * m.a + pt.y * m.c + m.e, pt.x * m.b + pt.y * m.d + m.f];
});
const done = async () => { await $('.pstrip .pbtn.done').click(); await wait(250); };
const pick = async text => { await $('.pstrip select.ppick').first().selectOption({ label: text }); await wait(300); };

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
        const names = ['Road', 'Bridge', 'Mill', 'Tunnel', 'Inn', 'Storm'];
        wihero.library.change(b, d => {
            names.forEach((name, uid) => { d.entries[uid] = { ...base, uid, displayIndex: uid, comment: name, key: [name.toLowerCase()], content: `The ${name.toLowerCase()}.` }; });
        });
        await wihero.library.flush();
        const cards = {};
        names.forEach((n, i) => { cards[`uid:${i}`] = { placed: true, x: 24 + (i % 2) * 204, y: 48 + Math.floor(i / 2) * 156 }; });
        wihero.settings.books[b] = { defaults: {}, folders: {}, canvas: { camera: { x: 0, y: 0, zoom: 0.8 }, cards, placed: true } };
        wihero.settings.openInHero = true;
        wihero.settings.pieceBarFolded = false;
    }, BOOK);
    ok('setup: a plain book "N7 Test" with six cards on the canvas, at 390 × 844');

    await page.click('#WI-SP-button .drawer-toggle');
    await $(`.item[data-book="${BOOK}"]`).click();
    await card('Mill').waitFor();
    assert.deepEqual(await $('.pchip').allTextContents(), ['Opens', 'Closes', 'Glue', 'Switch', 'Mask', 'Pack', 'Lock', 'Wait', 'Moment']);
    assert.equal(await $('.pchips .pdiv').count(), 1, 'a divider before Lock and Wait');
    await $('.pfold').click();
    assert.equal(await $('.pchip').count(), 0, 'folded');
    await $('.pfold').click();
    assert.equal(await $('.pchip').count(), 9);
    await shot('bar');
    ok('the bar is under the canvas with its nine chips and a divider, and folds');

    // ── Opens: tap the chip, tap Road (the source, doing the verb), drag the loose end to Mill ──
    await chip('Opens').click();
    assert.equal(await chip('Opens').getAttribute('aria-pressed'), 'true', 'armed');
    assert.match(await $('.armban').textContent(), /Tap the card that opens something/, 'an armed chip says what to tap');
    await chip('Opens').click();
    assert.equal(await chip('Opens').getAttribute('aria-pressed'), 'false', 'a second tap disarms');
    assert.equal(await $('.armban').count(), 0, 'disarmed, the banner goes');
    await chip('Opens').click();
    await card('Road').locator('.t').click();
    await strip().waitFor();
    assert.match(await say(), /Road opens …/);
    assert.match(await $('.pstrip .phint').first().textContent(), /Now tap the card it opens/);
    assert.ok(await $('.pstrip .pbtn.done').isDisabled(), 'Done waits for the link');
    await shot('opens-loose');
    await drag(await center($('.loosend')), await center(card('Mill')));
    assert.match(await say(), /Road opens Mill · Mill waits for Road/);
    await done();
    assert.deepEqual((await cfg('Mill')).gate, [['road']]);
    ok('Opens: tap the chip (a banner; again to disarm), tap Road, drag the loose end onto Mill: Road opens Mill');

    // ── Opens by dragging the chip onto the source; a second link asks both or either ──
    await drag(await chipAt('Opens'), await center(card('Bridge')));
    await strip().waitFor();
    await pick('Mill');
    assert.ok(await $('.pstrip .pbtn.done').isDisabled(), 'Done waits for both or either');
    await $('.pstrip .pseg button:has-text("(both)")').click();
    await wait(250);
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge']]);
    await done();
    ok('Opens: a chip dragged onto Bridge, Mill picked from the list, "both" chosen: one row of two');

    // ── A line reopens its strip; ⇄ turns it around; Cancel puts it back ──
    await page.mouse.click(...await linePoint('id:road>id:mill'));
    await strip().waitFor();
    assert.match(await say(), /Road opens Mill/);
    assert.ok(await $('.pstrip .pbtn.bad:has-text("Remove")').count(), 'a link already there can be removed');
    assert.ok(await $('.pstrip .switch[aria-label="Road closes when Mill fires"]').count(), 'the story moves on, as a switch');
    await $('.pstrip .flipb').click();
    await wait(250);
    assert.match(await say(), /Mill opens Road · Road waits for Mill/);
    assert.match(await $('.pstrip .pnote').textContent(), /Road was needed together with Bridge\. Turned around, it's a rule of its own\./);
    assert.deepEqual((await cfg('Mill')).gate, [['bridge']]);
    assert.deepEqual((await cfg('Road')).gate, [['mill']]);
    await shot('flip');
    await $('.pstrip .pbtn:text-is("Cancel")').click();
    await wait(300);
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge']]);
    assert.equal((await cfg('Road')).gate, undefined);
    ok('a tap on a line opens its strip with Remove; ⇄ turns it around and says it left its row; Cancel puts the book back');

    // ── The story moves on writes a real Closes ──
    await page.mouse.click(...await linePoint('id:road>id:mill'));
    await $('.pstrip .switch[aria-label="Road closes when Mill fires"]').click();
    await wait(250);
    assert.deepEqual((await cfg('Road')).closeGate, [['mill']]);
    await done();
    ok('"Road closes when Mill fires" writes Road\'s close gate');

    // ── A loop is refused; closing itself points to Once ──
    await chip('Opens').click();
    await card('Mill').locator('.t').click();
    await pick('Road');
    assert.match(await $('.pstrip .pnote.bad').textContent(), /^Not done: .*loop/);
    assert.equal((await cfg('Road')).gate, undefined, 'nothing written');
    await $('.pstrip .pbtn:text-is("Cancel")').click();
    await drag(await chipAt('Closes'), await center(card('Storm')));
    await drag(await center($('.loosend')), await center(card('Storm')));
    assert.match(await $('.pstrip .pnote.bad').textContent(), /Once/);
    await $('.pstrip .pbtn:text-is("Cancel")').click();
    await wait(200);
    ok('a link that would make a loop is refused with the reason; a card closing itself points to Once');

    // ── Lock on a line: it joins that row; who says it ──
    await drag(await chipAt('Lock'), await linePoint('id:road>id:mill'));
    await strip().waitFor();
    assert.match(await say(), /Mill opens after Road and Bridge, then when someone says/);
    await $('.pstrip .ptext').fill('the old mill');
    await page.keyboard.press('Enter');
    await wait(300);
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge', { lock: ['the old mill'] }]]);
    await $('.pstrip .ptext').fill('millstone');
    await $('.pstrip .pbtn:text-is("Add")').click();
    await wait(250);
    await $('.pstrip .pseg button:text-is("the character")').click();
    await wait(250);
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge', { lock: ['the old mill', 'millstone'], by: 'char' }]]);
    await shot('lock');
    await done();
    assert.ok(await $('.lockp:has-text("the old mill")').count(), 'the lock shows on the canvas');
    ok('Lock dropped on a line joins its row: phrases as chips (any one), and who says it');

    // ── Wait on the junction: the same row, before the lock ──
    await drag(await chipAt('Wait'), await center($('.junc.jhit').first()));
    await strip().waitFor();
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge', { wait: 2 }, { lock: ['the old mill', 'millstone'], by: 'char' }]], 'the lock is armed after the wait');
    await $('.pstrip .pbtn.sm:text-is("3")').click();
    await wait(250);
    await done();
    assert.deepEqual((await cfg('Mill')).gate, [['road', 'bridge', { wait: 3 }, { lock: ['the old mill', 'millstone'], by: 'char' }]]);
    ok('Wait dropped on the junction joins the same row, ahead of the lock');

    // ── Wait on a card: opens or closes; how many ──
    await chip('Wait').click();
    await card('Tunnel').locator('.t').click();
    await strip().waitFor();
    assert.ok(await $('.pstrip .pbtn.done').isDisabled(), 'opens or closes first');
    await $('.pstrip .pseg button:text-is("closes")').click();
    await wait(250);
    assert.deepEqual((await cfg('Tunnel')).closeGate, [[{ wait: 2 }]]);
    await $('.pstrip .pbtn.sm:text-is("5")').click();
    await $('.pstrip .pseg button:text-is("yours")').click();
    await wait(250);
    assert.deepEqual((await cfg('Tunnel')).closeGate, [[{ wait: 5, by: 'user' }]]);
    await done();
    // A pill reopens its strip.
    await $('.lockp:has-text("5 msgs")').click();
    await strip().waitFor();
    await $('.pstrip .pbtn.bad:has-text("Remove")').click();
    await wait(250);
    assert.equal((await cfg('Tunnel'))?.closeGate, undefined);
    ok('Wait on a card asks opens or closes, counts 5 of your messages; its pill reopens it with Remove');

    // ── Glue: hold says what ends it ──
    await drag(await chipAt('Glue'), await center(card('Inn')));
    await strip().waitFor();
    await $('.pstrip .pseg button:text-is("Hold")').click();
    await wait(250);
    assert.match(await $('.pstrip .pnote').textContent(), /Nothing ends it yet\. Add a Closes to Inn\./);
    assert.deepEqual((await cfg('Inn')).glue, { mode: 'hold' });
    await done();
    // Ride along: one host.
    await drag(await chipAt('Glue'), await center(card('Storm')));
    await $('.pstrip .pseg button:text-is("Ride along")').click();
    await wait(200);
    assert.ok(await card('Inn').evaluate(n => !n.classList.contains('dim')));
    await pick('Tunnel');
    assert.match(await say(), /Storm rides along with Tunnel/);
    assert.deepEqual((await cfg('Storm')).glue, { mode: 'ride', host: 'tunnel' });
    await done();
    ok('Glue: Hold warns that nothing ends it; Ride along links a host');

    // ── Switch: paths in order, waiting for the fork ──
    await drag(await chipAt('Switch'), await center(card('Bridge')));
    await strip().waitFor();
    assert.ok(await $('.pstrip .switch[aria-label="Paths wait for the fork"].on').count(), 'on by default');
    await pick('Inn');
    assert.ok(await $('.pstrip .pbtn.done').isDisabled(), 'two paths at least');
    await drag(await center($('.loosend')), await center(card('Tunnel')));
    assert.deepEqual((await cfg('Bridge')).switch, ['inn', 'tunnel']);
    assert.deepEqual((await cfg('Inn')).gate, [['bridge']]);
    assert.deepEqual((await cfg('Tunnel')).gate, [['bridge']]);
    assert.equal(await $('.pstrip .ppath button[aria-label="Move Tunnel up"]').count(), 0, 'the order is folded away');
    await $('.pstrip .porder').click();
    await $('.pstrip .ppath:has-text("Tunnel") button[aria-label="Move Tunnel up"]').click();
    await wait(250);
    assert.deepEqual((await cfg('Bridge')).switch, ['tunnel', 'inn']);
    await shot('switch');
    await done();
    ok('Switch on Bridge: Inn picked, Tunnel by the loose end; the paths wait for the fork; ↑ reorders them');

    // ── Mask: name, on when ──
    await drag(await chipAt('Mask'), await center(card('Road')));
    await strip().waitFor();
    await $('.pstrip .ptext[aria-label="Mask name"]').fill('ruined');
    await $('.pstrip .ptext[aria-label="Mask name"]').press('Tab');
    await wait(300);
    assert.equal((await cfg('Road')).masks[0].name, 'ruined');
    assert.ok(await $('.pstrip .phint:has-text("used only when picked by hand")').count());
    await pick('Storm');
    assert.deepEqual((await cfg('Road')).masks[0].gate, [['storm']]);
    await $('.pstrip .pbtn:text-is("Off when ▸")').click();
    await $('.pstrip select.ppick[aria-label="pick an entry"]').nth(1).selectOption({ label: 'Bridge' });
    await wait(250);
    assert.deepEqual((await cfg('Road')).masks[0].closeGate, [['bridge']]);
    await shot('mask');
    await done();
    ok('Mask on Road: named "ruined", on when Storm fires, off when Bridge fires');

    // ── Pack ──
    await drag(await chipAt('Pack'), await center(card('Inn')));
    await strip().waitFor();
    assert.ok(await $('.pstrip .pbtn.done').isDisabled());
    await $('.pstrip .pbtn:text-is("+ New pack")').click();
    await $('.dlg input').fill('town/inn');
    await $('.dlg .pri').click();
    await wait(300);
    assert.deepEqual((await cfg('Inn')).packs, ['town/inn']);
    await done();
    // A pack can be a link's end: Storm closes #town (Closes for on Storm), and the frame shows.
    await drag(await chipAt('Closes'), await center(card('Storm')));
    await pick('#town');
    assert.match(await say(), /Storm closes #town/);
    assert.deepEqual((await cfg('Storm')).closesFor, ['#town']);
    await done();
    assert.ok(await $('.packframe[data-pack="town"]').count(), 'the pack\'s frame');
    await shot('pack');
    ok('Pack on Inn: a new pack town/inn (inside town); Storm closes #town, stored as Closes for');

    // ── The inspector says where pieces come from ──
    await card('Mill').locator('.t').click();
    await $('.insp .addpiece:has-text("Add logic")').waitFor();
    ok('the inspector\'s button is "+ Add logic"');
    await ev(async b => { const { deleteWorldInfo } = await import('/scripts/world-info.js'); await deleteWorldInfo(b); delete wihero.settings.books[b]; }, BOOK);
});
