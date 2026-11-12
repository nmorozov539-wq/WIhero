// Book transactions and failed deletion through the real library in the browser harness.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = new URL('./log/', import.meta.url).pathname;
fs.mkdirSync(LOG, { recursive: true });

// A static server for the repo: the harness loads src/ and examples/ by relative URLs.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/files/sanitize-filename', route => route.fulfill({ json: { fileName: route.request().postDataJSON().fileName } }));
    await page.goto(`${BASE}?reset&saves`);
    await page.waitForFunction(() => window.wihero);
    await page.evaluate(() => { wihero.app.openBook('Moonlit Keep'); wiheroHarness.writeDelay = 300; });
    const host = page.locator('#wihero-editor');
    await host.locator('.bkname').click();
    await host.locator('.opt').filter({ hasText: /^Rename/ }).click();
    await host.locator('.dlg input').fill('Renamed Keep');
    await host.locator('.dlg input').press('Enter');
    await host.locator('.operation-status').waitFor();
    assert.equal(await host.locator('.main').evaluate(n => n.inert), true);
    assert.match(await host.locator('.operation-status').textContent(), /Renaming Moonlit Keep/);
    await host.locator('.bkname h1').filter({ hasText: 'Renamed Keep' }).waitFor();
    assert.equal(await host.locator('.main').evaluate(n => n.inert), false);
    console.log('PASS: rename holds editing with a waiting status and unlocks on completion');
    await page.evaluate(() => {
        wiheroHarness.failDelete = true;
        window.removedBackups = [];
        wiheroHarness.snapshots.removeAll = async name => { removedBackups.push(name); };
        wihero.settings.books['Renamed Keep'].snapshots = [{ name: 'Backup', at: 1, path: 'keep.json' }];
    });
    await host.locator('.bkname').click();
    await host.locator('.opt').filter({ hasText: /^Delete$/ }).click();
    // Expire the Undo toast without a five-second sleep: closing flushes it through the normal UI path.
    await page.evaluate(() => wihero.app.hide());
    await page.waitForFunction(() => !wihero.library.operationText());
    await page.evaluate(() => wihero.app.show());
    await page.waitForFunction(() => !wihero.app.state.hiddenBooks.has('Renamed Keep'));
    assert.equal(await page.evaluate(() => wihero.library.names().includes('Renamed Keep')), true);
    assert.deepEqual(await page.evaluate(() => removedBackups), []);
    assert.equal(await page.evaluate(() => wihero.settings.books['Renamed Keep'].snapshots[0].path), 'keep.json');
    assert.match(await host.locator('.toast').textContent(), /Could not delete/);
    await page.evaluate(async () => {
        await wihero.library.get('Renamed Keep');
        wihero.library.change('Renamed Keep', d => {
            d.entries = {
                0: { uid: 0, comment: 'Moment: Arrival', key: ['arrived'], disable: true, content: '',
                    extensions: { wihero: { id: 'arrival', moment: true } } },
                1: { uid: 1, comment: 'Room', key: ['room'], content: 'An open room.',
                    extensions: { wihero: { id: 'room', gate: [['arrival']] } } },
            };
        });
        await wihero.library.flush();
        window.previewBookBefore = JSON.stringify(wihero.library.peek('Renamed Keep'));
        const S = wihero.app.state;
        S.mode = 'hero'; S.hero.book = 'Renamed Keep'; S.hero.active = 'preview';
        S.hero.pv = { seed: 'fresh', user: 'I arrived at the room.', reply: '', edit: null, page: null };
        wihero.app.refresh();
    });
    await host.locator('.report').waitFor();
    assert.match(await host.locator('.report').textContent(), /1 fire, 0 blocked/);
    await host.locator('.hlx[data-key="Renamed Keep.0"]').click();
    assert.match(await host.locator('.sheet').textContent(), /Arrival/);
    await page.keyboard.press('Escape');
    await host.locator('.report').click();
    const report = await host.locator('.rbody').textContent();
    assert.match(report, /Room/);
    assert.match(report, /Arrival happened/);
    assert.equal(await page.evaluate(() => JSON.stringify(wihero.library.peek('Renamed Keep')) === previewBookBefore), true);
    console.log('PASS: actual Preview UI includes a Moment, opens its gated entry and does not save changes');
    assert.deepEqual(errors, []);
    console.log('PASS: failed delayed deletion restores the book to the list and keeps backups/settings, with an error');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
