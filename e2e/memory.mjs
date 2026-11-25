// Bounded memory (M2) in the disposable browser harness (e2e/desktop/harness.html), no SillyTavern needed. The
// `?saves` profile swaps the stand-in library for the real one (src/ui/st-books.js), so its summary/LRU/pinning code
// is what runs. With the 40-book profile plus the 1,000-entry "Perf Big", this:
//
// - opens Home, lets every count arrive, then does 10 Home → book → Back cycles, recording after a forced GC the
//   `Runtime.getHeapUsage().usedSize` and `wihero.library.stats()` (copies, summaries, evictions, pinned names);
// - checks the plateau: copies stay within `maxCopies` plus pinned books, every book keeps a summary, and heap growth
//   over the last five cycles is small (environment-relative, never an absolute MB promise);
// - redraws Home's rows from summaries (a list/tiles round trip) and asserts the library was not asked to read a book;
// - proves a dirty book and an undo state survive an eviction pass: edit an entry, force clean copies out while it is
//   dirty, let it save, force more evictions while it is only held by its undo state, then undo on the reopened book.
//
// Every number is labelled measured-native-browser (unthrottled, 390 × 844 emulation). This is not a phone heap
// prediction; the device heap snapshot stays in the plan's §7.5 work.
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/memory.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const QUERY = '?reset&perf=1&books=40&entries=150&big=1000&canvas=0&chats=0&long=0&saves';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;
const CYCLES = 10;
const MB = 1024 * 1024;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const machine = { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model?.trim() ?? null, node: process.versions.node, browser: `chromium ${browser.version()}` };
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const checkErrors = label => assert.deepEqual(errors, [], `${label}: no errors in the page`);

async function openPage() {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile && window.wiheroHarness, null, { timeout: 60000 });
    await page.click('#wi-button');
    await page.locator('#wihero-editor .item[data-book="Perf Big"]').waitFor({ timeout: 60000 });
    return page;
}

const countText = sel => sel.locator('.m > span:not(.badge)');
const settleCounts = page => page.waitForFunction(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const rows = [...sr.querySelectorAll('.view .item[data-book]')];
    return rows.length > 0 && rows.every(r => r.querySelector('.m > span:not(.badge)')?.textContent !== '…');
}, null, { timeout: 120000 });

/** Forced GC, then the heap and the library's own cache accounting. */
async function measure(cdp, page) {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const stats = await page.evaluate(() => wihero.library.stats());
    return { usedSize, stats };
}

try {
    // ---- A. the plateau across Home ↔ book
    const page = await openPage();
    const $ = sel => page.locator(`#wihero-editor ${sel}`);
    await settleCounts(page);
    const names = await page.evaluate(() => wihero.library.names());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    const first = await measure(cdp, page);
    console.log(JSON.stringify({
        step: 'baseline after Home counts', label: 'measured-native-browser', machine, viewport: { width: 390, height: 844 },
        books: names.length, heapUsed: first.usedSize, ...first.stats,
    }));
    assert.equal(first.stats.summaries, names.length, 'every book has a summary after its first count');
    assert.ok(first.stats.evictions > 0, `clean copies were evicted on the way (${first.stats.evictions})`);

    const series = [];
    for (let i = 0; i < CYCLES; i++) {
        const name = names[i % names.length];
        await $(`.view .item[data-book="${name}"]`).click();
        await $('.bkname h1').filter({ hasText: name }).waitFor({ timeout: 60000 });
        await $('.item.ent').first().waitFor({ timeout: 60000 });
        await page.keyboard.press('Escape'); // close the book's tab, back to Home
        await $('.view .item[data-book]').first().waitFor({ timeout: 60000 });
        await settleCounts(page);
        const m = await measure(cdp, page);
        series.push(m);
        console.log(JSON.stringify({
            step: `cycle ${i + 1} (${name})`, label: 'measured-native-browser', machine, heapUsed: m.usedSize,
            copies: m.stats.copies, summaries: m.stats.summaries, evictions: m.stats.evictions,
            pinned: m.stats.pinned, maxCopies: m.stats.maxCopies, estimatedBytes: m.stats.estimatedBytes,
        }));
        assert.ok(m.stats.copies <= m.stats.maxCopies + m.stats.pinned.length,
            `cycle ${i + 1}: ${m.stats.copies} copies for a bound of ${m.stats.maxCopies} plus ${m.stats.pinned.length} pinned`);
        assert.equal(m.stats.summaries, names.length, `cycle ${i + 1}: every book keeps its summary`);
    }
    const last = series.at(-1);
    assert.ok(last.stats.copies <= last.stats.maxCopies + last.stats.pinned.length);
    assert.equal(last.stats.summaries, names.length);
    ok(`${CYCLES} Home → book → Home cycles stay within ${last.stats.maxCopies} copies plus pins, with all ${names.length} summaries`);

    // Heap plateau: compare the last five cycles with the middle of the run. Generous and relative: GC timing and
    // V8's own caches move this around, so an absolute MB figure would flake.
    const heap = series.map(m => m.usedSize);
    const mid = heap[Math.floor(CYCLES / 2) - 1];
    const growth = Math.max(...heap.slice(-5)) - mid;
    const limit = Math.max(4 * MB, mid * 0.125);
    console.log(JSON.stringify({
        step: 'heap plateau', label: 'measured-native-browser', machine, heapUsed: heap,
        midCycleHeap: mid, lastFiveGrowth: growth, growthLimit: Math.round(limit),
    }));
    assert.ok(growth < limit, `heap grew ${Math.round(growth / 1024)} KiB over the last five cycles (limit ${Math.round(limit / 1024)} KiB)`);
    ok(`heap is a plateau: ${Math.round(growth / 1024)} KiB of growth over the last five cycles (limit ${Math.round(limit / 1024)} KiB)`);

    // Home redraws from summaries: a list/tiles round trip rebuilds every row/tile, and still reads no book.
    const readsBefore = await page.evaluate(() => wiheroHarness.loads);
    await $('.head button[aria-label="Show books as tiles"]').click();
    await $('.ptile').first().waitFor();
    await $('.head button[aria-label="Show books as a list"]').click();
    await $('.view .item[data-book]').first().waitFor();
    await settleCounts(page);
    const readsAfter = await page.evaluate(() => wiheroHarness.loads);
    assert.equal(readsAfter, readsBefore, 'Home drew every count from a summary, with no book read');
    assert.equal(await page.evaluate(() => wihero.library.stats().summaries), names.length);
    ok(`Home's rebuilt rows drew ${names.length} counts from summaries (0 book reads)`);
    await page.close();

    // ---- B. a dirty book and an undo state survive eviction
    const edit = await openPage();
    const e$ = sel => edit.locator(`#wihero-editor ${sel}`);
    const NAME = 'Perf Book 005';
    await edit.evaluate(name => wihero.app.openBook(name), NAME);
    await e$('.bkname h1').filter({ hasText: NAME }).waitFor({ timeout: 60000 });
    await e$('.item.ent').first().click();
    await e$('.en h1').waitFor({ timeout: 60000 });
    const uid = await edit.evaluate(() => {
        const S = wihero.app.state;
        return S.tabs.find(t => t.id === S.active).history.at(-1).uid;
    });
    const original = await edit.evaluate(([name, id]) => wihero.library.peek(name).entries[id].content, [NAME, uid]);

    // Keep the save in flight long enough to load other books while the edit is still only in the working copy.
    await edit.evaluate(() => { wiheroHarness.writeDelay = 2000; });
    const content = e$('textarea[aria-label="Content"]');
    await content.focus();
    await edit.keyboard.insertText('HISTORY PROOF ');
    await edit.waitForTimeout(100);
    const dirty = await edit.evaluate(([name, id]) => ({
        pinned: wihero.library.stats().pinned.includes(name),
        copy: !!wihero.library.peek(name),
        text: wihero.library.peek(name)?.entries[id]?.content,
    }), [NAME, uid]);
    assert.ok(dirty.pinned, 'a dirty book (and its pending save) is pinned while the save is delayed');
    assert.ok(dirty.copy);
    assert.ok(dirty.text.includes('HISTORY PROOF') && dirty.text !== original, 'the edit is in the working copy');
    ok('a dirty book is pinned and keeps the only copy of its edit');

    // Force the rest of the cache out while the edit is still dirty. The test reads books the way Home's background
    // counts do (library.get), and no navigation can interrupt the entry page.
    const evicted = await edit.evaluate(async name => {
        const names = wihero.library.names().filter(n => n !== name);
        for (const n of names.slice(0, 12)) await wihero.library.get(n);
        return { stats: wihero.library.stats(), copy: !!wihero.library.peek(name) };
    }, NAME);
    assert.ok(evicted.stats.evictions > 0, `other clean books were evicted (${evicted.stats.evictions})`);
    assert.ok(evicted.copy, 'the dirty book was not among them');
    assert.ok(evicted.stats.pinned.includes(NAME), 'and stats names it as pinned');
    ok(`evictions ran (${evicted.stats.evictions}) while the dirty book stayed loaded`);

    // Let the delayed save finish. The history state now holds the book even though it is clean.
    await edit.evaluate(() => wihero.library.flush());
    const afterSave = await edit.evaluate(name => ({ pinned: wihero.library.stats().pinned.includes(name), copy: !!wihero.library.peek(name) }), NAME);
    assert.ok(afterSave.copy, 'the saved book is still loaded');
    assert.ok(afterSave.pinned, 'its undo state pins it after the save');

    // Back to Home, then open and close enough other books to evict clean copies while this one is not on screen.
    await edit.evaluate(() => wihero.app.back()); // entry → book
    await edit.waitForTimeout(100);
    await edit.evaluate(() => wihero.app.back()); // book tab → Home
    await e$('.view .item[data-book]').first().waitFor({ timeout: 60000 });
    const others = await edit.evaluate(name => wihero.library.names().filter(n => n !== name).slice(0, 10), NAME);
    for (const name of others) {
        await e$(`.view .item[data-book="${name}"]`).click();
        await e$('.bkname h1').filter({ hasText: name }).waitFor({ timeout: 60000 });
        await edit.evaluate(() => wihero.app.back());
        await e$('.view .item[data-book]').first().waitFor({ timeout: 60000 });
    }
    const held = await edit.evaluate(name => ({
        copy: !!wihero.library.peek(name),
        pinned: wihero.library.stats().pinned.includes(name),
        evictions: wihero.library.stats().evictions,
    }), NAME);
    assert.ok(held.copy, 'the book with an undo state was not evicted');
    assert.ok(held.pinned, 'history keeps it pinned');
    assert.ok(held.evictions > evicted.stats.evictions, 'clean books kept being evicted around it');
    ok(`the book with an undo state stayed loaded across ${others.length} book opens (evictions ${held.evictions})`);

    // Reopen it and undo. A pinned copy means the undo applies at once; the text goes back to what it was.
    // Phone Normal has no undo shortcut (the keyboard handler is the desktop one), so the Hero canvas's own Undo
    // arrow is used: it calls the same historyStep on the open book.
    await e$(`.view .item[data-book="${NAME}"]`).click();
    await e$('.bkname h1').filter({ hasText: NAME }).waitFor({ timeout: 60000 });
    await edit.evaluate(name => {
        const S = wihero.app.state;
        S.mode = 'hero';
        S.hero.book = name;
        wihero.app.refresh();
    }, NAME);
    const undo = e$('.histbtns button[aria-label^="Undo"]');
    await undo.waitFor({ timeout: 60000 });
    assert.ok(await undo.isEnabled(), 'the undo arrow is enabled from the kept history');
    await undo.click();
    await edit.waitForTimeout(250);
    const undone = await edit.evaluate(([name, id]) => wihero.library.peek(name).entries[id].content, [NAME, uid]);
    assert.equal(undone, original, 'Undo restored the pre-edit text on the loaded copy');
    ok('the undo state survived eviction and Undo restored the edit');
    await edit.evaluate(() => wihero.library.flush());
    checkErrors('memory');
    ok('no errors in the page');
    await edit.close();
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
