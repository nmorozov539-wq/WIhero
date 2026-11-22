// The entry page's Content copy button and the ⋮ menus' Copy content (phone, Normal mode), in the browser harness.
//   node e2e/copy.mjs
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
const ok = (n, msg) => console.log(`ok ${n} - ${msg}`);
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}?reset`);
    await page.waitForFunction(() => window.wihero);
    await page.evaluate(() => wihero.app.openBook('Moonlit Keep'));
    const host = page.locator('#wihero-editor');
    await host.locator('.item .more').first().waitFor();
    const e = await page.evaluate(() => Object.values(wihero.library.peek('Moonlit Keep').entries).find(x => (x.content ?? '').trim()));
    const clip = () => page.evaluate(() => navigator.clipboard.readText());

    // The book list's ⋮: Copy content copies the content alone.
    await host.locator('.item').filter({ hasText: e.comment }).first().locator('.more').click();
    await host.locator('.sheet .opt', { hasText: 'Copy content' }).click();
    assert.equal(await clip(), e.content);
    ok(1, 'book list ⋮: Copy content copies the content only');

    // The entry page: a copy button by Content, and no copy row in its ⋮.
    await page.evaluate(uid => { const S = wihero.app.state; S.tabs.find(t => t.id === S.active).history.push({ type: 'entry', book: 'Moonlit Keep', uid }); wihero.app.refresh(); }, e.uid);
    await host.locator('.content-h .ccopy').waitFor();
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await host.locator('.content-h .ccopy').click();
    await page.waitForTimeout(400);
    assert.equal(await clip(), e.content);
    await page.screenshot({ path: `${LOG}copy-entry.png` });
    await host.locator('[aria-label="Entry actions"]:visible').first().click();
    await host.locator('.sheet .opt', { hasText: 'Duplicate' }).waitFor();
    assert.equal(await host.locator('.sheet .opt', { hasText: /Copy/ }).count(), 0, 'no copy row on the entry page ⋮');
    ok(2, 'entry page: the Content copy button copies the content; its ⋮ has no copy row');
    assert.deepEqual(errors, []);
    ok(3, 'no errors in the page');
} finally { await browser.close(); server.close(); }
