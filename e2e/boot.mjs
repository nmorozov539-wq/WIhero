// L1 boot check: the real index.js on a minimal SillyTavern page (e2e/desktop/boot.html), with the editor chunk
// absent at boot. It proves, from the server's request log and the page's resource entries, that app.js and the
// editor modules are not requested until the World Info drawer opens, that opening it loads the chunk once, that
// wihero.ready resolves and Home draws a row, that a fast open/close leaves no wihero-under and no placeholder, that
// the idle prefetch loads the chunk with the drawer closed, that a requested book opens, and that a failed import
// puts ST's own drawer back. No SillyTavern, no real data.
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/boot.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const requests = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/version') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ pkgVersion: '1.19.1' }));
        return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    // The snapshot seed on first open: ST's file upload, answered in memory.
    if (url.pathname === '/api/files/upload') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ path: '/snapshots/boot.json' }));
        return;
    }
    requests.push(url.pathname);
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/boot.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = message => console.log(`ok ${++step} - ${message}`);
const EDITOR_MODULES = ['/src/ui/app.js', '/src/ui/canvas.js', '/src/ui/normal.js', '/src/ui/desk.js', '/src/ui/menus.js', '/src/link-engine/index.js'];
const count = p => requests.filter(one => one === p).length;

/** A fresh context, so module caching and the prefetch timer never leak between scenarios. */
async function open({ viewport = { width: 390, height: 844 } } = {}) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
    await page.goto(BASE);
    await page.waitForFunction(() => globalThis.wihero && globalThis.wiheroBoot, null, { timeout: 30000 });
    return { context, page, errors };
}

const resources = page => page.evaluate(() => performance.getEntriesByType('resource').map(e => new URL(e.name).pathname));
const appRows = page => page.locator('#wihero-editor').locator('.item[data-book="Boot Book"]');

{
    // (a) and (c): boot has no editor chunk; opening the drawer loads it once, ready resolves, Home draws a row.
    requests.length = 0;
    const { context, page, errors } = await open();
    assert.equal(await page.evaluate(() => globalThis.wihero.app), null, 'wihero.app starts null');
    const bootResources = await resources(page);
    for (const module of EDITOR_MODULES) assert.equal(bootResources.includes(module), false, `${module} is not fetched at boot`);
    assert.equal(bootResources.includes('/src/ui/app.css'), false, 'app.css is not fetched at boot');
    assert.equal(bootResources.includes('/style.css'), true, 'style.css stays eager');
    for (const module of EDITOR_MODULES) assert.equal(count(module), 0, `${module} is not requested at boot`);
    ok('boot requests no editor module and no app.css (resource entries + server log)');

    const started = Date.now();
    await page.evaluate(() => globalThis.wiheroBoot.openDrawer());
    await page.waitForFunction(() => document.getElementById('WorldInfo')?.classList.contains('wihero-under'));
    assert.equal(await page.locator('#wihero-loading').count(), 1, 'the placeholder stands in while the chunk loads');
    await appRows(page).waitFor({ timeout: 30000 });
    const firstRowMs = Date.now() - started;
    assert.equal(await page.evaluate(() => globalThis.wihero.ready.then(app => app === globalThis.wihero.app)), true, 'ready resolves with the app');
    for (const module of EDITOR_MODULES) assert.equal(count(module), 1, `${module} is requested exactly once`);
    assert.equal(count('/src/ui/app.css'), 1, 'app.css arrives with the chunk, once');
    assert.equal(await page.locator('#wihero-loading').count(), 0, 'the placeholder is gone once the editor shows');
    assert.deepEqual(errors, [], 'no page errors');
    ok(`the drawer open loads one editor chunk and draws a Home row (${firstRowMs} ms, measured-native-browser)`);
    await context.close();
}

{
    // (b) the idle prefetch: with the drawer closed, the chunk arrives after ~3 s and nothing is shown.
    requests.length = 0;
    const { context, page, errors } = await open();
    await page.waitForFunction(() => globalThis.wihero.app, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.getElementById('WorldInfo').classList.contains('openDrawer')), false, 'the drawer stayed closed');
    assert.equal(await page.evaluate(() => document.getElementById('WorldInfo').classList.contains('wihero-under')), false, 'the prefetch did not hide ST\'s drawer');
    assert.equal(await page.locator('#wihero-loading').count(), 0, 'the prefetch shows no placeholder');
    assert.equal(count('/src/ui/app.js'), 1, 'the prefetch loads the chunk once');
    assert.deepEqual(errors, [], 'no page errors');
    ok('the idle prefetch loads the editor chunk with the drawer closed');
    await context.close();
}

{
    // (d) a fast open/close while the chunk is in flight: never leave wihero-under or the placeholder behind.
    requests.length = 0;
    const { context, page, errors } = await open();
    await page.route('**/src/ui/app.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.continue();
    });
    await page.evaluate(() => globalThis.wiheroBoot.openDrawer());
    await page.locator('#wihero-loading').waitFor({ timeout: 5000 });
    await page.evaluate(() => globalThis.wiheroBoot.closeDrawer());
    await page.waitForFunction(() => document.getElementById('WorldInfo')?.classList.contains('wihero-under') === false);
    await page.waitForFunction(() => globalThis.wihero.app, null, { timeout: 15000 }); // the late load still finishes
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById('WorldInfo').classList.contains('wihero-under')), false, 'wihero-under is not stuck');
    assert.equal(await page.locator('#wihero-loading').count(), 0, 'the placeholder is gone');
    assert.equal(await page.evaluate(() => globalThis.wihero.app.host.hidden), true, 'the late editor stayed hidden');
    assert.equal(count('/src/ui/app.js'), 1, 'the chunk was requested once');
    assert.deepEqual(errors, [], 'no page errors');
    ok('a fast open/close leaves no wihero-under, no placeholder and a hidden editor');
    await context.close();
}

{
    // A book ST asked for before the editor existed still opens it.
    requests.length = 0;
    const { context, page, errors } = await open();
    await page.evaluate(() => globalThis.wiheroBoot.selectBook(0));
    await page.evaluate(() => globalThis.wiheroBoot.openDrawer());
    await page.locator('#wihero-editor .bkname h1').waitFor({ timeout: 30000 });
    assert.equal((await page.locator('#wihero-editor .bkname h1').first().textContent()).trim(), 'Boot Book', 'the requested book opened');
    assert.equal(count('/src/ui/app.js'), 1, 'the chunk was requested once');
    assert.deepEqual(errors, [], 'no page errors');
    ok('a book requested through ST\'s dropdown opens when the drawer follows');
    await context.close();
}

{
    // A failed import reports, puts ST's drawer back, and leaves wihero.app null.
    requests.length = 0;
    const { context, page } = await open();
    await page.route('**/src/ui/app.js', route => route.abort('failed'));
    await page.evaluate(() => globalThis.wiheroBoot.openDrawer());
    const failure = await page.evaluate(() => globalThis.wihero.ready.then(() => null, error => String(error)));
    assert.ok(failure, 'ready rejects');
    assert.equal(await page.evaluate(() => globalThis.wihero.app), null, 'no app was created');
    assert.equal(await page.evaluate(() => document.getElementById('WorldInfo').classList.contains('wihero-under')), false, 'ST\'s drawer is visible again');
    assert.equal(await page.locator('#wihero-loading').count(), 0, 'the placeholder is gone');
    const toasts = await page.evaluate(() => globalThis.__wiheroBootToasts.map(t => t.kind));
    assert.ok(toasts.includes('error'), 'the failure is reported to the reader');
    ok('a failed editor import restores ST\'s drawer and reports it');
    await context.close();
}

await browser.close();
server.close();
console.log('# all boot checks passed');
