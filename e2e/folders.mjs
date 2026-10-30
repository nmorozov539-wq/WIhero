// End-to-end check of folders in a real SillyTavern 1.19.0: folders and colors set in the entry editor,
// the folder filter on ST's entry list, bulk actions through ST's save path, and gating unaffected.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import { page, ok, ev, wait, send, injected, status, book, start, run, openBook, openEntry, openBlock, listedUids } from './lib.mjs';

/** Sets folder (and color) on an entry through the WI Hero block, and waits for the save. */
async function file(uid, folder, color = '') {
    const block = await openBlock(await openEntry(uid));
    await block.locator('input[name="wihero_folder"]').fill(folder);
    await block.locator('select[name="wihero_color"]').selectOption(color);
    await block.locator('.wihero-save').click();
    for (let i = 0; i < 50 && book().entries[uid].wihero?.folder !== folder; i++) await wait(100);
    await page.locator(`#world_popup_entries_list .world_entry[uid="${uid}"] .wihero-entry input[name="wihero_folder"]`).waitFor({ state: 'visible', timeout: 6000 });
}
const pickFolder = async folder => {
    await ev(f => { const s = document.getElementById('wihero_folder_filter'); s.value = f; s.dispatchEvent(new Event('change')); }, folder);
    await wait(1200);
};
async function bulk(action, value) {
    await ev(([a, v]) => {
        const bar = document.querySelector('.wihero-bulk');
        const pick = (name, x) => { const e = bar.querySelector(`[name="${name}"]`); e.value = x; e.dispatchEvent(new Event('change')); };
        pick('wihero_bulk_action', a);
        if (v !== undefined) pick(a === 'prefix' ? 'wihero_bulk_text' : a === 'color' ? 'wihero_bulk_color' : 'wihero_bulk_number', v);
        bar.querySelector('.wihero-bulk-apply').click();
    }, [action, value]);
    await page.locator('.popup .popup-button-ok').click({ timeout: 5000 });
    await wait(1500);
}

await run(async () => {
    await start();
    await openBook();
    await file(0, 'Valley/Road', 'green');
    await file(1, 'Valley/Mill');
    await file(3, 'Valley');
    const entries = book().entries;
    assert.deepEqual(entries[0].wihero, { id: 'road', folder: 'Valley/Road', color: 'green' });
    assert.deepEqual(entries[1].wihero, { id: 'mill', gates: ['road'], folder: 'Valley/Mill' });
    assert.deepEqual(entries[3].wihero, { folder: 'Valley' });
    const s = await status();
    assert.ok(!('Village (not gated)' in s) && !Object.values(s).includes('config problem'), 'a folder alone does not gate an entry');
    assert.deepEqual([s.road, s.mill], ['open', 'waiting for road']);
    ok('editor: folders and a color saved; the vanilla entry with only a folder stays not gated');

    await pickFolder('Valley');
    assert.deepEqual((await listedUids()).sort((a, b) => a - b), [0, 1, 3]);
    await pickFolder('Valley/Mill');
    assert.deepEqual(await listedUids(), [1]);
    await pickFolder('Valley');
    ok('filter: Valley lists its subfolders too; Valley/Mill only the mill');

    await bulk('disable');
    let after = book().entries;
    assert.deepEqual(Object.values(after).map(e => !!e.disable), Object.values(after).map(e => [0, 1, 3].includes(e.uid)));
    await bulk('enable');
    assert.ok(!Object.values(book().entries).some(e => e.disable));
    await bulk('probability', '55');
    after = book().entries;
    assert.deepEqual([after[0].probability, after[1].probability, after[3].probability, after[2].probability], [55, 55, 55, 100]);
    await bulk('probability', '100');
    ok('bulk: disable, enable and trigger % change only the folder, on disk');

    await pickFolder('');
    assert.ok((await listedUids()).length > 3, 'all folders lists everything again');
    await page.click('#WIDrawerIcon');
    await send('We stand on the road out of the village, talking about the mill.');
    assert.deepEqual(injected(['WIH-0', 'WIH-1', 'WIH-2']), ['WIH-0', 'WIH-1']);
    assert.deepEqual([(await status()).road, (await status()).mill], ['open', 'gate open']);
    ok('gating: same as without folders (road fires, the mill is held back)');
});
