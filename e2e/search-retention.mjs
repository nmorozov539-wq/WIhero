// Search cache ownership against the real bounded working-copy library. An indexed entry must become collectable when
// its clean book is evicted; reloading and reopening search rebuild the same result ordering.
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/search-retention.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html?reset&perf=1&books=12&entries=20&big=20&canvas=0&chats=0&long=0&saves`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text().slice(0, 300)); });
let step = 0;
const ok = message => console.log(`ok ${++step} - ${message}`);

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero?.library?.stats && window.wiheroHarnessProfile, null, { timeout: 120000 });
    await page.click('#wi-button');
    const $ = selector => page.locator(`#wihero-editor ${selector}`);
    await $('.view .item[data-book]').first().waitFor({ timeout: 120000 });
    await page.waitForFunction(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        const rows = [...root.querySelectorAll('.view .item[data-book]')];
        return rows.length && rows.every(row => row.querySelector('.m > span:not(.badge)')?.textContent !== '…');
    }, null, { timeout: 120000 });

    const picked = await page.evaluate(() => {
        const names = wihero.library.names();
        const target = names.find(name => wihero.library.peek(name));
        const entry = Object.values(wihero.library.peek(target).entries)[19];
        window.__searchEntry = new WeakRef(entry);
        return { target, copies: wihero.library.stats().copies, max: wihero.library.stats().maxCopies };
    });
    assert.ok(picked.target);
    assert.ok(picked.copies <= picked.max);

    await $('.bottombar button[aria-label="Search"]').click();
    await $('.search input').waitFor();
    const indexed = await page.evaluate(() => wihero.app.searchCacheSize);
    assert.equal(indexed, await page.evaluate(() => wihero.library.names().length), 'the open overlay has one record per named book (empty for unloaded books)');

    const eviction = await page.evaluate(async target => {
        // Touch every other live copy after the target, making the target the oldest without repeatedly touching it
        // during the eviction loop itself.
        const missing = [];
        for (const name of wihero.library.names()) if (name !== target && !wihero.library.peek(name)) missing.push(name);
        for (const name of missing) await wihero.library.get(name);
        return {
            gone: wihero.library.peek(target) === null,
            cache: wihero.app.searchCacheSize,
            stats: wihero.library.stats(),
        };
    }, picked.target);
    assert.equal(eviction.gone, true, 'the chosen clean working copy was evicted');
    assert.ok(eviction.cache < indexed, 'its search corpus was released at the same eviction');
    assert.ok(eviction.stats.copies <= eviction.stats.maxCopies + eviction.stats.pinned.length, 'the real library remains bounded');
    await page.waitForTimeout(50);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    assert.equal(await page.evaluate(() => window.__searchEntry.deref()), undefined, 'the indexed entry object is collectable while search remains open');
    ok(`eviction released the indexed data object while search stayed open (${eviction.stats.copies}/${eviction.stats.maxCopies} copies)`);

    // Reload the book, then let the existing overlay rescan. It must rebuild from the fresh working copy and expose
    // the same entry hits/ranking rules as an ordinary search.
    await page.evaluate(target => wihero.library.get(target), picked.target);
    const reloadedKey = await page.evaluate(target => Object.values(wihero.library.peek(target)?.entries ?? {}).at(19)?.key, picked.target);
    const query = reloadedKey[0].split(/\s+/)[0];
    await $('.search input').fill(query);
    await page.waitForTimeout(300);
    const beforeClose = await $('.res .item[data-book]').evaluateAll(rows => rows.map(row => row.dataset.book));
    assert.ok(beforeClose.includes(picked.target), `the reloaded book is searchable again (${picked.target}, query ${query})`);
    assert.ok((await page.evaluate(() => wihero.app.searchCacheSize)) > 0);
    ok('reloading an evicted book rebuilds its corpus and restores its entry result');

    await $('.search button[aria-label="Close search"]').click();
    await $('.search').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => wihero.app.searchCacheSize), 0, 'closing the overlay releases every corpus');
    await $('.bottombar button[aria-label="Search"]').click();
    await $('.search input').waitFor();
    await $('.search input').fill(query);
    await page.waitForTimeout(300);
    const reopened = await $('.res .item[data-book]').evaluateAll(rows => rows.map(row => row.dataset.book));
    assert.deepEqual(reopened, beforeClose, 'closing and reopening preserves result ranking after rebuilding');
    assert.ok((await page.evaluate(() => wihero.app.searchCacheSize)) > 0, 'reopening rebuilt corpora for the live copies');
    ok('closing clears all corpora; reopening rebuilds the same ranked results from live working copies');

    assert.deepEqual(errors, []);
    ok('no page errors');
} finally {
    await page.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
