// N3's in-ST checks (ROADMAP N3, BUILD_SPEC 13): at 390px wide, the sample book draws on the Hero canvas; cards and
// ports are dragged, a mask layer flipped, the camera moved, an entry placed from the panel, Tidy undone; chat state
// matches the open chat; and positions, port sides, mask layers and the camera survive a reload. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, ok, page, run, send, start, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'WIHero-Sample';
const $ = sel => page.locator(`${W} ${sel}`);
const opt = text => $(`.opt:has(.lab:text-is("${text}"))`);
const card = key => $(`.card[data-id="${key}"]`);
const memory = () => ev(b => structuredClone(wihero.settings.books[b]?.canvas ?? null), BOOK);
const visible = () => ev(() => !document.getElementById('wihero-editor').hidden);
const shot = name => page.screenshot({ path: `${LOG}n3-${name}.png` });
const transform = () => $('.world').evaluate(n => n.style.transform);

async function menu(...path) {
    if (await $('.scrim').count()) { await page.keyboard.press('Escape'); await wait(100); } // menus stay open after a pick
    await $('.tabbar .iconbtn').click();
    for (const p of path) { await opt(p).click(); await wait(200); }
    if (path.length && await $('.sheet.menu').count()) { await page.keyboard.press('Escape'); await wait(100); }
}
async function drag(locator, dx, dy) {
    const b = await locator.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + dx * i / 8, y + dy * i / 8);
    await page.mouse.up();
    await wait(200);
}
/** Cards on screen and where the settings say they are. */
const drawn = () => $('.card').evaluateAll(cs => cs.map(c => [c.dataset.id, parseFloat(c.style.left), parseFloat(c.style.top)]));
async function toggleEditor() { await page.click('#WI-SP-button .drawer-toggle'); await wait(300); }

await run(async () => {
    await start(BOOK);
    await page.setViewportSize({ width: 390, height: 844 });
    await ev(b => { if (wihero.settings.books[b]) delete wihero.settings.books[b].canvas; wihero.settings.openInHero = false; }, BOOK);
    // Close ST's extension drawer that start() opened, so the World Info button is the only open thing.
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    await wait(300);
    ok('setup: a chat with the sample book, at 390 × 844');

    // ── First open: arranged once (D8) ──
    await toggleEditor();
    await $('.view h1:text-is("World Info")').waitFor();
    await menu('Open books in', 'Hero mode');
    assert.equal(await ev(() => wihero.settings.openInHero), true);
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.card').first().waitFor();
    assert.equal(await $('.tab.active').getAttribute('aria-label'), 'Canvas');
    const mem0 = await memory();
    assert.equal(mem0.placed, true);
    const cards = await drawn();
    assert.equal(cards.length, 17, 'every linked entry is a card; Village, Lantern, Bell and the N5 extras without links aren\'t');
    for (const [key, x, y] of cards) assert.deepEqual([x, y], [mem0.cards[key].x, mem0.cards[key].y], key);
    assert.equal(await $('.packframe .pn').textContent(), '#town');
    assert.ok(await $('.junc:text-is("or")').count(), 'an OR junction');
    assert.ok(await $('.layercard').count() >= 2, 'Tower is a stack of mask layers');
    assert.equal(await $('.mnav span').first().textContent(), 'main');
    assert.ok(await $('svg.lk path').count() >= 15);
    await shot('canvas');
    ok('Open books in Hero mode: the sample book draws once arranged, with a pack frame, an OR junction, a mask stack and links');

    // ── Card, port, mask, camera ──
    const road = 'id:road';
    const before = mem0.cards[road];
    // Find Road from the panel: its dot is filled (it is on the canvas), and tapping it centers it.
    await $('.panelBtn').click();
    await $('.prow:has(.nm:text-is("Road: leaving the village")) .dotc.in').click();
    await wait(300);
    const zoom = (await memory()).camera.zoom;
    await drag($(`.card[data-id="${road}"] .grip`), 0, 48 * zoom);
    let mem = await memory();
    assert.equal(mem.cards[road].x, before.x);
    assert.equal(mem.cards[road].y, before.y + 48, `snapped to the 12px grid: ${JSON.stringify([before, mem.cards[road], zoom, mem.camera])}`);
    assert.deepEqual([parseFloat(await card(road).evaluate(n => n.style.top))], [before.y + 48]);
    ok('a card dragged by its grip moves and snaps; the new place is saved');

    const port = $(`circle[data-port="${road}|gout"]`);
    const pb = await port.boundingBox();
    const cb = await card(road).boundingBox();
    await drag(port, cb.x + cb.width + 4 - (pb.x + pb.width / 2), cb.y + cb.height / 2 - (pb.y + pb.height / 2));
    mem = await memory();
    assert.equal(mem.cards[road].ports?.gout, 'right');
    assert.equal(await $('.toast.show span').textContent(), 'Port moved');
    ok('a port dragged to another side stays there');

    await $('[data-flip="id:tower"][data-d="1"]').click();
    await wait(200);
    mem = await memory();
    assert.equal(mem.cards['id:tower'].layer, 'ruined');
    assert.equal(await card('id:tower').locator('.k').textContent(), 'mask: ruined');
    assert.ok(await $('svg.lk path').count() > 15, 'the shown layer\'s gate (Storm) is drawn');
    ok('the mask stack flips to a layer, and that layer\'s links are drawn');

    await $('.canvas-tools button[aria-label="Zoom in"]').click();
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(150, 350, { steps: 5 });
    await page.mouse.up();
    await wait(600);
    mem = await memory();
    assert.ok(Math.abs(mem.camera.zoom - Math.min(2, zoom * 1.2)) < 0.01);
    assert.notEqual(await transform(), '');
    ok('zoom and pan move the camera, which is saved');

    // ── The entry panel ──
    await $('.panelBtn').click();
    await $('.panel:not(.closed)').waitFor();
    await $('.panel .phead input').fill('vill');
    assert.deepEqual(await $('.prow .nm').allTextContents(), ['Road: leaving the village', 'Village (not gated)']);
    await $('.prow:has(.nm:text-is("Village (not gated)")) .dotc').click();
    await card('uid:3').waitFor();
    assert.ok(await $('.panel.closed').count(), 'placing closes the panel');
    mem = await memory();
    assert.equal(mem.cards['uid:3'].placed, true);
    assert.ok(Number.isFinite(mem.cards['uid:3'].x));
    assert.ok(await card('uid:3').evaluate(n => n.classList.contains('hit')));
    await $('.panelBtn').click();
    await $('.panel .phead input').fill('');
    assert.equal(await $('.prow:has(.nm:text-is("Lantern (sticky 5)")) .dotc.in').count(), 0);
    assert.equal(await $('.prow:has(.nm:text-is("Village (not gated)")) .dotc.in').count(), 1);
    // Dragging a dot out of the panel places the card where it is dropped.
    const lantern = $('.prow:has(.nm:text-is("Lantern (sticky 5)"))');
    const lkey = await lantern.getAttribute('data-key');
    await lantern.scrollIntoViewIfNeeded();
    await wait(400); // the panel's slide
    const vpBox = await $('.vp').boundingBox();
    let dot = await lantern.locator('.dotc').boundingBox();
    // Dropped on the red ×, nothing is placed.
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(dot.x - 20, dot.y + 20);
    await $('.dropcancel').waitFor();
    const x = await $('.dropcancel').boundingBox();
    for (let i = 1; i <= 6; i++) await page.mouse.move(dot.x + (x.x + 32 - dot.x) * i / 6, dot.y + (x.y + 32 - dot.y) * i / 6);
    assert.ok(await $('.dropcancel.over').count(), 'the × lights up under the finger');
    await page.mouse.up();
    await wait(300);
    assert.equal(await $('.dropcancel').count(), 0);
    assert.equal((await memory()).cards[lkey]?.placed, undefined, 'dropped on the ×: not placed');
    assert.ok(await $('.panel:not(.closed)').count(), 'and the panel comes back');
    await wait(400);
    dot = await lantern.locator('.dotc').boundingBox();
    const [tx, ty] = [vpBox.x + vpBox.width - 100, vpBox.y + vpBox.height - 140];
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(dot.x + (tx - dot.x) * i / 10, dot.y + (ty - dot.y) * i / 10);
    await page.mouse.up();
    await card(lkey).waitFor();
    const lc = await card(lkey).boundingBox();
    assert.ok(Math.abs(lc.x + lc.width / 2 - tx) < 40 && Math.abs(lc.y + lc.height / 2 - ty) < 40, `dropped at ${tx},${ty}, drawn at ${lc.x + lc.width / 2},${lc.y + lc.height / 2}`);
    assert.equal((await memory()).cards[lkey].placed, true);
    // A long press on a row opens its menu.
    await $('.panelBtn').click();
    await $('.panel:not(.closed)').waitFor();
    await $('.prow:has(.nm:text-is("Ferry (sticky 7)"))').scrollIntoViewIfNeeded();
    await wait(400);
    const ferry = await $('.prow:has(.nm:text-is("Ferry (sticky 7)"))').boundingBox();
    await page.mouse.move(ferry.x + 40, ferry.y + ferry.height / 2);
    await page.mouse.down();
    await wait(650);
    await page.mouse.up();
    await $('.sheet h2:text-is("Ferry (sticky 7)")').waitFor();
    await opt('Open entry').click();
    await $('.en h1:text-is("Ferry (sticky 7)")').waitFor();
    ok('the panel filters, places an unlinked entry beside the view with its dot or where its dot is dropped, and opens an entry in a tab (tap or long press)');

    // ── Entry tabs ──
    assert.equal(await $('.tab.active .name').textContent(), 'Ferry (sticky 7)');
    assert.ok(await $('.disc.fixed:has(h2:text-is("Story logic"))').count(), 'Story logic is always open in Hero mode');
    await $('.logic .linkish:has-text("Show on canvas")').click();
    await card('id:ferry').waitFor();
    assert.ok(await card('id:ferry').evaluate(n => n.classList.contains('hit')));
    assert.equal(await $('.tab').count(), 3, 'the Ferry tab stays open, after Canvas and Preview');
    await card('id:mill').locator('.t').click();
    await $('.insp .ihead h2:text-is("Mill: arrival")').waitFor();
    await $('.insp .iedit').click(); // phones: Edit text at the top opens the entry
    await $('.en h1:text-is("Mill: arrival")').waitFor();
    assert.equal(await $('.tab').count(), 4);
    await page.keyboard.press('Escape');
    await $('.en h1:text-is("Ferry (sticky 7)")').waitFor();
    await page.keyboard.press('Escape');
    await card('id:mill').waitFor();
    assert.equal(await $('.tab').count(), 2, 'Back closes the entry tabs one by one, then shows the canvas');
    ok('the inspector\'s Edit text opens the entry in a tab; Show on canvas finds it again; Back closes the tabs');

    // The canvas scrolls rather than shrinks on a phone: pan the frame into view first.
    {
        const fb = await $('.packframe').boundingBox();
        const vb = await $('.vp').boundingBox();
        const dy = (vb.y + vb.height / 3) - (fb.y + 30);
        const dx = (vb.x + 40) - fb.x;
        const sx = vb.x + vb.width / 2; const sy = vb.y + vb.height / 2;
        for (let left = [dx, dy]; Math.abs(left[0]) > 1 || Math.abs(left[1]) > 1;) {
            const step = [Math.max(-250, Math.min(250, left[0])), Math.max(-250, Math.min(250, left[1]))];
            await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + step[0], sy + step[1], { steps: 6 }); await page.mouse.up();
            left = [left[0] - step[0], left[1] - step[1]];
            await wait(150);
        }
    }
    await $('.packframe').click({ position: { x: 6, y: 30 } });
    await $('.sheet h2:text-is("#town")').waitFor();
    assert.deepEqual(await $('.sheet .opt .lab').allTextContents(), ['Rename', 'Tavern (#town)', 'Market (#town, after the tavern)', 'Rumor (after anything in #town)', 'Gatehouse (opens all of #town)', 'Blaze (closes all of #town)']);
    await page.keyboard.press('Escape');
    ok('a pack frame lists its members and who uses it');

    // ── Tidy, with Undo ──
    const placedNow = await memory();
    await menu('Tidy layout');
    assert.equal(await $('.toast.show span').textContent(), 'Tidied');
    const tidied = await memory();
    assert.equal(tidied.cards[road].ports, undefined, 'ports go back to their default sides');
    assert.notEqual(tidied.cards[road].y, placedNow.cards[road].y);
    await $('.toast button:text-is("Undo")').click();
    await wait(200);
    assert.deepEqual((await memory()).cards, placedNow.cards);
    ok('Tidy rearranges everything, and Undo puts it back');

    // ── Chat state (D17) ──
    await toggleEditor();
    await send('We take the road out of the village.');
    await send('At last the mill comes into view.');
    await toggleEditor();
    assert.equal(await $('.card .fired').count(), 0, 'off by default');
    await menu('Show chat state');
    await $('.card .fired').first().waitFor();
    const expected = await ev(b => {
        const s = wihero.state;
        return Object.fromEntries(Object.entries(s.fired).filter(([k]) => k.startsWith(`${b}/`)).map(([k, n]) => [`id:${k.slice(b.length + 1)}`, n]));
    }, BOOK);
    const shown = Object.fromEntries(await $('.card:has(.fired)').evaluateAll(cs => cs.map(c => [c.dataset.id, parseInt(c.querySelector('.fired').textContent, 10)])));
    assert.deepEqual(shown, expected);
    assert.ok(expected['id:road'] >= 1 && expected['id:mill'] >= 1);
    const closed = await ev(b => Object.keys(wihero.state.closed).filter(k => k.startsWith(`${b}/`)).map(k => `id:${k.slice(b.length + 1)}`).sort(), BOOK);
    assert.deepEqual((await $('.card.closed').evaluateAll(cs => cs.map(c => c.dataset.id))).sort(), closed);
    assert.ok(closed.includes(road));
    assert.equal(await card(road).locator('.k').textContent(), 'CLOSED · by Mill: arrival');
    assert.ok(await card('id:left').evaluate(n => n.classList.contains('waiting')), 'Left path waits for the fork');
    assert.ok(!await card('id:tunnel').evaluate(n => n.classList.contains('waiting')), 'Mill: the secret is open now the mill fired');
    await shot('chat-state');
    ok('Show chat state: fired counts and closed cards match the open chat; a gated card waits');

    // ── A reload keeps it all (D7) ──
    const kept = await memory();
    await wait(1500);
    await page.reload();
    const welcome = page.locator('.popup:has-text("Welcome to SillyTavern") .popup-button-ok');
    await welcome.waitFor({ timeout: 15000 }).then(() => welcome.click(), () => {});
    await page.waitForFunction(() => window.wihero?.app, null, { timeout: 60000 });
    assert.deepEqual(await memory(), kept, 'the canvas memory was saved');
    await toggleEditor();
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.card').first().waitFor();
    for (const [key, x, y] of await drawn()) assert.deepEqual([x, y], [kept.cards[key].x, kept.cards[key].y], key);
    assert.equal(await card('id:tower').locator('.k').textContent(), 'mask: ruined');
    assert.equal(await transform(), `translate(${kept.camera.x}px, ${kept.camera.y}px) scale(${kept.camera.zoom})`);
    assert.ok(await $(`circle[data-port="${road}|gout"]`).count());
    assert.equal((await memory()).cards[road].ports.gout, 'right');
    ok('after a reload: card positions, the moved port, the mask layer and the camera are as they were');

    // ── Back to normal mode ──
    await menu();
    await $('.modebtn').click();
    assert.equal(await $('.modebtn span').textContent(), 'Tap again to switch to Normal mode');
    await $('.modebtn').click();
    await $(`.bkname h1:text-is("${BOOK}")`).waitFor();
    await $('.item.ent:has(.nm:text-is("Mill: arrival"))').click();
    await $('.disc:has(h2:text-is("Story logic"))').click();
    await $('.logic .linkish:has-text("Open in Hero mode")').click();
    await card('id:mill').waitFor();
    assert.ok(await card('id:mill').evaluate(n => n.classList.contains('hit')));
    await ev(() => { wihero.settings.openInHero = false; SillyTavern.getContext().saveSettingsDebounced(); });
    await wait(1500);
    await toggleEditor();
    assert.ok(!await visible());
    ok('the mode switch arms then switches to the book\'s page; "Open in Hero mode" finds the card');
});
