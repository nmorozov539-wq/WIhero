// Home's tile view on phones, in the browser harness (e2e/desktop/harness.html), no SillyTavern needed: the header
// button and the menu switch between the list and tiles, the phone keeps its own choice apart from desktop's, a tap
// opens the book, select mode marks tiles, and folders hold their own grid. Screenshots: e2e/log/tiles-*.png.
//   node e2e/tiles.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = new URL('./log/', import.meta.url).pathname;
fs.mkdirSync(LOG, { recursive: true });
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
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const shot = (page, name) => page.screenshot({ path: `${LOG}tiles-${name}.png` });

async function open(w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}

try {
    const page = await open(390, 844, { hasTouch: true, isMobile: true });
    assert.ok(await $(page, '.item[data-book]').count() > 0, 'phones start on the list');
    assert.equal(await $(page, '.ptile').count(), 0);
    await shot(page, 'list');

    await $(page, '.head button[aria-label="Show books as tiles"]').click();
    await $(page, '.ptile').first().waitFor();
    const rows = await $(page, '.item[data-book]').count();
    assert.equal(rows, 0, 'tiles replace the rows');
    const boxes = await $(page, '.ptile').evaluateAll(n => n.map(t => t.getBoundingClientRect()).map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.width)]));
    if (boxes.length > 1) assert.equal(boxes[0][1], boxes[1][1], 'two tiles to a row at 390px');
    for (const [x, , w] of boxes) assert.ok(x >= 0 && x + w <= 390, 'no tile runs off the screen');
    assert.equal(await page.evaluate(() => wihero.settings.homeView), 'tiles');
    assert.notEqual(await page.evaluate(() => wihero.settings.desk?.homeView), 'tiles', 'desktop keeps its own choice');
    await shot(page, 'tiles');
    ok('the header button turns Home into two-to-a-row tiles on a phone, saved apart from desktop');

    // A folder gets its own grid under its header.
    const book = await $(page, '.ptile').first().getAttribute('data-book');
    await page.evaluate(b => { wihero.settings.bookFolders.Shelf = [b]; wihero.app.refresh(); }, book);
    await $(page, '.section:has-text("Shelf")').waitFor();
    assert.equal(await $(page, `.ptiles:last-of-type .ptile[data-book="${book}"]`).count(), 1, 'the book sits in the folder\'s grid');
    await shot(page, 'folder');
    ok('a book folder holds its own grid');

    // Select mode: a tap marks the tile, ⋯ hides.
    await page.evaluate(() => { const S = wihero.app.state; S.select = new Set(); wihero.app.refresh(); });
    await $(page, `.ptile[data-book="${book}"]`).click();
    await $(page, `.ptile.sel[data-book="${book}"]`).waitFor();
    assert.equal(await $(page, '.ptile .more').count(), 0);
    await shot(page, 'select');
    await page.evaluate(() => { const S = wihero.app.state; S.select = null; wihero.app.refresh(); });
    ok('in select mode a tap marks the tile with a check mark');

    // A tap opens the book.
    await $(page, `.ptile[data-book="${book}"] .t`).click();
    await $(page, '.bkname').waitFor();
    assert.equal(await $(page, '.bkname h1').textContent(), book);
    ok('a tap on a tile opens its book');

    // The menu's switch goes back to the list.
    await $(page, '.tab').first().click();
    await $(page, '.ptile').first().waitFor();
    await $(page, '.tabbar .iconbtn').click();
    await $(page, '.sheet.menu .opt:has(.lab:text-is("Show books as"))').click();
    await page.waitForTimeout(200);
    await $(page, '.sheet .opt:has(.lab:text-is("List")), .sheet button:text-is("List")').first().click();
    await page.waitForTimeout(200);
    if (await $(page, '.scrim').count()) await page.keyboard.press('Escape');
    await $(page, '.item[data-book]').first().waitFor();
    assert.equal(await page.evaluate(() => wihero.settings.homeView), 'list');
    ok('back to the list');

    // Desktop is untouched: still tiles by default.
    const d = await open(1366, 900);
    await d.locator('#wihero-editor .dtiles .tile').first().waitFor();
    ok('desktop still starts on its own tiles');

    assert.deepEqual(errors, [], 'no console errors');
    console.log('console errors: none');
} finally {
    await browser.close();
    server.close();
}
