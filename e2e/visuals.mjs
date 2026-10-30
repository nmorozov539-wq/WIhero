// End-to-end check of the visuals in a real SillyTavern 1.19.0: status badges and color stripes on ST's
// World Info entry rows, and the panel grouped by folder. Writes the README screenshots to docs/img/.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, ok, ev, wait, send, book, start, run, openBook, openEntry, openBlock, LOG } from './lib.mjs';

const SHOTS = new URL('../docs/img/', import.meta.url).pathname;
const badges = () => ev(() => Object.fromEntries([...document.querySelectorAll('#world_popup_entries_list .world_entry')]
    .map(row => [row.getAttribute('uid'), row.querySelector('.wihero-badge')?.textContent ?? null])));
async function shot(locator, name) {
    await locator.scrollIntoViewIfNeeded();
    await wait(400);
    await locator.screenshot({ path: `${LOG}${name}` });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.copyFileSync(`${LOG}${name}`, `${SHOTS}${name}`);
}
async function file(uid, folder, color) {
    const block = await openBlock(await openEntry(uid));
    await block.locator('input[name="wihero_folder"]').fill(folder);
    await block.locator('select[name="wihero_color"]').selectOption(color);
    await block.locator('.wihero-save').click();
    for (let i = 0; i < 50 && book().entries[uid].wihero?.folder !== folder; i++) await wait(100);
    await page.locator(`#world_popup_entries_list .world_entry[uid="${uid}"] .wihero-entry input[name="wihero_folder"]`).waitFor({ state: 'visible', timeout: 6000 });
}

await run(async () => {
    await start();
    await openBook();
    await wait(800);
    let b = await badges();
    assert.deepEqual([b[0], b[1], b[2], b[3], b[12]], ['open', 'waiting', 'waiting', null, 'open']);
    const title = await ev(() => document.querySelector('.world_entry[uid="1"] .wihero-badge').title);
    assert.equal(title, 'WI Hero: waiting for road');
    ok('badges: road open, mill and tunnel waiting, the vanilla village has none; the title has the full reason');

    await file(0, 'Valley', 'green');
    await file(1, 'Valley', 'blue');
    await file(4, 'Weather', 'teal');
    const striped = await ev(() => [...document.querySelectorAll('#world_popup_entries_list .world_entry.wihero-colored')]
        .map(row => [row.getAttribute('uid'), row.style.getPropertyValue('--wihero-color')]));
    assert.deepEqual(striped.sort(), [['0', '#4fa65a'], ['1', '#4a7fd1'], ['4', '#2fa39a']]);
    ok('stripes: entries with a color get it on their row');

    await page.click('#WIDrawerIcon');
    await send('We stand on the road out of the village, talking about the mill.');
    await send('We reach the mill.');
    await openBook();
    await wait(800);
    b = await badges();
    assert.deepEqual([b[0], b[1], b[2]], ['closed', 'open', 'open']);
    ok('badges after two turns: road closed, mill and tunnel open');

    const rows = await ev(() => [...document.querySelectorAll('#wihero_entries tr')].map(tr => tr.className === 'wihero-folder-row' ? `[${tr.textContent}]` : tr.children[0].firstChild?.textContent));
    assert.deepEqual(rows.slice(rows.indexOf('[Valley]'), rows.indexOf('[Valley]') + 3), ['[Valley]', 'road', 'mill']);
    assert.ok(rows.includes('[Weather]'));
    ok('panel: rows grouped under their folders');

    await shot(page.locator('#world_popup_entries_list .world_entry').first().locator('xpath=..'), 'badges.png');
    await page.click('#WIDrawerIcon');
    await page.click('#extensions-settings-button .drawer-toggle');
    await wait(500);
    if (!await page.isVisible('#wihero_entries')) {
        await page.click('.wihero-settings .inline-drawer-toggle');
        await wait(500);
    }
    await shot(page.locator('.wihero-settings'), 'panel.png');
    await page.setViewportSize({ width: 420, height: 900 });
    await wait(1000);
    if (!await page.isVisible('#wihero_entries')) {
        await page.click('#extensions-settings-button .drawer-toggle');
        await wait(800);
    }
    await shot(page.locator('.wihero-settings'), 'panel-narrow.png');
    const overflow = await ev(() => { const t = document.getElementById('wihero_entries'); return t.scrollWidth - t.clientWidth; });
    assert.ok(overflow <= 1, `the panel table fits the narrow layout (overflow ${overflow}px)`);
    ok('screenshots: desktop panel, badges, and the panel at 420px wide without overflow');
});
