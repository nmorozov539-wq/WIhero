// End-to-end check of the workspace on a phone-sized screen and of the Ctrl K palette, plus a 500-entry book
// for responsiveness, in a real SillyTavern 1.19.0. Writes docs/img/phone.png and docs/img/palette.png.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, ok, ev, wait, start, run, book, BOOK_FILE, LOG } from './lib.mjs';

const SHOTS = new URL('../docs/img/', import.meta.url).pathname;
const B = 'WIHero-Sample';
const BIG = 'WIHero-Big';
const BIG_FILE = BOOK_FILE.replace(/WIHero-Sample\.json$/, `${BIG}.json`);
const card = (uid, b = B) => page.locator(`.wihero-ws .wihero-card[data-key="${b}.${uid}"]`);
const visible = sel => page.locator(sel).isVisible();
async function shot(name) {
    await wait(400);
    await page.screenshot({ path: `${LOG}${name}` });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.copyFileSync(`${LOG}${name}`, `${SHOTS}${name}`);
}
async function palette(text) {
    await page.locator('input[name="wihero_palette"]').fill(text);
    await page.keyboard.press('Enter');
    await wait(300);
}
const panelTitle = () => page.locator('.wihero-ws-panel .wihero-ws-title').innerText();

/** A book of 500 gated entries: 50 chains of 10, every fifth entry carrying a label, a few masks. */
function bigBook() {
    const sample = JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8')).entries[3];
    const entries = {};
    for (let i = 0; i < 500; i++) {
        const chain = Math.floor(i / 10);
        const wihero = { id: `e${i}`, ...(i % 10 && { gates: [`e${i - 1}`] }), ...(i % 5 === 0 && { labels: [`part${chain % 7}`] }) };
        if (i % 50 === 9) wihero.masks = [{ name: 'later', content: `[BIG-${i} later]`, gates: [`e${i - 5}`] }];
        if (i % 10 === 0 && chain > 0) wihero.gates = [`#part${(chain - 1) % 7}`];
        entries[i] = { ...sample, uid: i, displayIndex: i, comment: `Entry ${i}`, key: [`big${i}`], content: `[BIG-${i}]`, wihero };
    }
    return { entries };
}

fs.rmSync(BIG_FILE, { force: true });
await run(async () => {
    await start();
    await ev(b => { const s = SillyTavern.getContext().extensionSettings.wihero; s.workspaceMode = 'graph'; s.workspaceBook = b; s.canvas = {}; }, B);
    await ev(() => document.querySelector('.wihero-settings .wihero-open-workspace').click());
    await page.locator('.wihero-ws .wihero-card').first().waitFor({ timeout: 10000 });

    // ── Ctrl K on a desktop ──
    await page.keyboard.press('Control+k');
    assert.ok(await visible('.wihero-ws-palette'));
    await page.locator('input[name="wihero_palette"]').fill('tun');
    await shot('palette.png');
    await page.keyboard.press('Enter');
    assert.equal(await panelTitle(), 'Mill: the secret');
    await page.keyboard.press('Control+k');
    await palette('>next problem');
    assert.equal(await panelTitle(), 'Bell (cooldown 5, glued until it stops)');
    await page.keyboard.press('Control+k');
    await palette('>outline');
    assert.ok(await page.locator('.wihero-ws-outline-row').count() > 10);
    await page.keyboard.press('Control+k');
    await palette('>graph view');
    ok('Ctrl K: jumps to an entry; > runs commands (next problem, outline and graph views)');

    // ── A phone ──
    await page.setViewportSize({ width: 390, height: 844 });
    await wait(500);
    assert.ok(await visible('.wihero-ws-menu') && await visible('.wihero-ws-phone-search') && !await visible('.wihero-ws-ribbon') && !await visible('.wihero-ws-panel'));
    await page.locator('.wihero-ws-menu').click();
    assert.ok(await visible('.wihero-ws-drawerhead .wihero-ws-book') && await visible('.wihero-ws-drawerhead .wihero-ws-modes'));
    await page.locator('.wihero-ws-menu').click();
    assert.ok(!await visible('.wihero-ws-side'));
    ok('phone: top bar with menu, search and entry; the drawer holds the book, views and lists');

    await card(0).click();
    assert.ok(await visible('.wihero-ws-sheet'));
    await shot('phone.png');
    await page.locator('.wihero-ws-sheet-edit').click();
    assert.ok(await visible('.wihero-ws-panel') && (await panelTitle()).startsWith('Road'));
    await page.locator('.wihero-ws-back').click();
    assert.ok(!await visible('.wihero-ws-panel'));
    await card(0).click();
    await page.locator('.wihero-ws-sheet-link').click();
    await card(12).click();
    await page.locator('.wihero-link-menu [data-type="gate"]').click();
    for (let i = 0; i < 50 && !book().entries[12].wihero.gates; i++) await wait(100);
    assert.deepEqual(book().entries[12].wihero.gates, ['road']);
    ok('phone: tapping a card raises Link and Edit; Edit is a full-screen page with Back; Link then tap gates tower on road');

    const scale = () => ev(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.wihero-world').style.transform)[1]));
    const k = await scale();
    await page.locator('.wihero-zoom button[aria-label="Zoom in"]').click();
    assert.ok(await scale() > k);
    await page.locator('.wihero-ws-phone-search').click();
    await palette('mill');
    assert.ok(await visible('.wihero-ws-sheet'));
    assert.ok((await page.locator('.wihero-ws-sheet').innerText()).startsWith('Mill: arrival'));
    ok('phone: zoom buttons zoom; the search box finds an entry and raises its sheet');

    // ── 500 entries on a 390px screen ──
    fs.writeFileSync(BIG_FILE, JSON.stringify(bigBook()));
    process.on('exit', () => fs.rmSync(BIG_FILE, { force: true }));
    await ev(() => SillyTavern.getContext().updateWorldInfoList());
    await page.locator('.wihero-ws-menu').click();
    const t0 = Date.now();
    await page.locator('.wihero-ws-drawerhead .wihero-ws-book').selectOption(BIG);
    await page.locator(`.wihero-ws .wihero-card[data-key^="${BIG}."]`).first().waitFor({ timeout: 20000 });
    const openMs = Date.now() - t0;
    await page.locator('.wihero-ws-menu').click();
    const drawn = await page.locator('.wihero-ws .wihero-card').count();
    assert.ok(drawn < 500, `only cards near the screen are in the page (${drawn})`);
    const t1 = Date.now();
    for (let i = 0; i < 10; i++) await page.locator(`.wihero-zoom button[aria-label="${i < 5 ? 'Zoom in' : 'Zoom out'}"]`).click();
    const zoomMs = (Date.now() - t1) / 10;
    const box = await page.locator('.wihero-stage').boundingBox();
    const t2 = Date.now();
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + 200 - i * 20, box.y + 300 - i * 15);
    await page.mouse.up();
    const panMs = (Date.now() - t2) / 30;
    const afterPan = await page.locator('.wihero-ws .wihero-card').count();
    await page.locator('.wihero-zoom button[aria-label="Show everything"]').click();
    await wait(300);
    const onScreen = await ev(() => {
        const stage = document.querySelector('.wihero-stage').getBoundingClientRect();
        return [...document.querySelectorAll('.wihero-ws .wihero-card-entry')].find(c => {
            const r = c.getBoundingClientRect();
            return r.left >= stage.left && r.right <= stage.right && r.top >= stage.top + 10 && r.bottom <= stage.bottom - 10;
        })?.dataset.key;
    });
    const target = page.locator(`.wihero-ws .wihero-card[data-key="${onScreen}"]`);
    const t3 = Date.now();
    await target.click();
    await page.locator('.wihero-ws-sheet.wihero-show').waitFor({ timeout: 5000 });
    const selectMs = Date.now() - t3;
    console.log(`  500 entries at 390x844: open ${openMs} ms; ${drawn} cards in the page (${afterPan} after panning); zoom step ${zoomMs.toFixed(0)} ms; pan step ${panMs.toFixed(0)} ms; select ${selectMs} ms`);
    assert.ok(openMs < 5000 && zoomMs < 250 && panMs < 100 && selectMs < 1500, 'responsive');
    fs.rmSync(BIG_FILE, { force: true });
    ok('500 entries: culling keeps the page small; opening, zooming, panning and selecting stay quick');
});
