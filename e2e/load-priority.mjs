// The shared loader (M1) and Home count cancellation (M3) in the browser harness (e2e/desktop/harness.html), no
// SillyTavern needed. The `?slow=1` profile delays every library read and keeps `peek` empty until that read finishes,
// so Home's counts are genuinely in the background; the harness exposes `wiheroHarnessLoads` (read log, active/max
// concurrency, duplicate flag, loaded names).
//
// Proves: Home's background reads stay bounded at three; a tapped book starts ahead of the queued counts and opens
// before they finish; leaving Home drops the rest of the queue; coming back reloads the visible counts; and a Home
// redraw with a queue pending does not start a second read of a book.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/load-priority.mjs`; it uses only made-up harness data.
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
// 12 empty books plus the one-entry "Perf Big": enough for a queue, small enough to read. `slow=400` makes each read
// long enough to observe without asserting any absolute time.
const QUERY = '?reset&perf=1&books=12&entries=0&big=1&canvas=0&chats=0&long=0&slow=400';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;
const TOTAL = 13;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const loadState = () => page.evaluate(() => ({
    names: wiheroHarnessLoads.log.map(l => l.name),
    length: wiheroHarnessLoads.log.length,
    active: wiheroHarnessLoads.active,
    maxActive: wiheroHarnessLoads.maxActive,
    duplicate: wiheroHarnessLoads.duplicate,
    loaded: [...wiheroHarnessLoads.loaded],
}));
const rowFor = name => $(`.view .item[data-book="${name}"]`);

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile && window.wiheroHarnessLoads, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.item[data-book="Perf Big"]').waitFor({ timeout: 60000 });
    await page.waitForFunction(n => wiheroHarnessLoads.log.length >= n, 3);

    const initial = await loadState();
    assert.ok(initial.length >= 3, 'Home starts reading books on its own');
    assert.equal(initial.maxActive, 3, `at most three background reads at once (saw ${initial.maxActive})`);
    assert.ok(initial.length < TOTAL, 'books are still queued for counting');
    console.log(`# Home counts: ${initial.length} reads started, ${initial.active} running, max ${initial.maxActive}, ${TOTAL - initial.length} not started`);
    ok('Home reads counts three books at a time and leaves the rest queued');

    // Tap a book whose count is still queued. It must start at once and open before the remaining counts run.
    const target = await page.evaluate(() => {
        const started = wiheroHarnessLoads.log.map(l => l.name);
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return [...sr.querySelectorAll('.view .item[data-book]')].map(r => r.dataset.book).find(n => !started.includes(n)) ?? null;
    });
    assert.ok(target, 'a book is still waiting for its count');
    assert.equal(await $(`.view .item[data-book="${target}"] .m > span:not(.badge)`).textContent(), '…', 'its count is still pending');

    const beforeTap = (await loadState()).length;
    await rowFor(target).click();
    await $('.bkname h1').filter({ hasText: target }).waitFor({ timeout: 60000 });
    const opened = await loadState();
    const targetIndex = opened.names.indexOf(target);
    assert.ok(targetIndex >= beforeTap && targetIndex <= beforeTap + 1, `the tapped book starts next (${target} at ${targetIndex}, ${beforeTap} running before)`);
    assert.equal(opened.length, targetIndex + 1, 'no queued count starts while the book opens');
    assert.ok(opened.length < TOTAL, `the book opened before the remaining ${TOTAL - opened.length} counts (${opened.length} reads started)`);
    assert.equal(opened.duplicate, false, 'the book was not read twice');
    console.log(`# tap: ${target} started ${targetIndex - beforeTap} request(s) after the running counts; opened with ${TOTAL - opened.length} books still uncounted`);
    ok('a tapped book jumps the count queue and opens before the remaining counts');

    // The queued counts were dropped when Home was left. Only the reads already running may finish.
    await page.waitForTimeout(1000);
    const afterOpen = await loadState();
    assert.equal(afterOpen.length, opened.length, 'no count read starts after leaving Home');
    assert.equal(afterOpen.active, 0, 'the foreground read finished');
    assert.equal(afterOpen.duplicate, false, 'no duplicate reads');
    ok('leaving Home drops the queued count reads; only the in-flight ones finish');

    // Back Home: the books still uncounted are read again, and the visible rows get their real counts.
    await $('.tab.fixed[aria-label="Home"]').click();
    await $('.item[data-book="Perf Big"]').waitFor({ timeout: 60000 });
    const check = await page.evaluate(loaded => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return [...sr.querySelectorAll('.view .item[data-book]')].map(r => r.dataset.book).find(n => !loaded.includes(n)) ?? null;
    }, afterOpen.loaded);
    assert.ok(check, 'a book is still uncounted on the way back');

    // A redraw that replaces Home's rows while the queue is pending must not queue a book twice.
    await $('.head button[aria-label="Show books as tiles"]').click();
    await $('.ptile').first().waitFor();
    await $('.head button[aria-label="Show books as a list"]').click();
    await $('.item[data-book]').first().waitFor();
    const rebuilt = await loadState();
    assert.equal(rebuilt.duplicate, false, 'the list/tiles rebuild did not double-queue a count');
    assert.ok(rebuilt.maxActive <= 4, `bounded by three background reads plus the opened book (max ${rebuilt.maxActive})`);

    await page.waitForFunction(name => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const row = [...sr.querySelectorAll('.view .item[data-book]')].find(r => r.dataset.book === name);
        return row?.querySelector('.m > span:not(.badge)')?.textContent === '0 entries';
    }, check, { timeout: 60000 });
    // Every visible count resolves, each book was read once, and no read duplicated another.
    await page.waitForFunction(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return [...sr.querySelectorAll('.view .item[data-book]')]
            .every(r => r.querySelector('.m > span:not(.badge)')?.textContent !== '…');
    }, null, { timeout: 60000 });
    const reloaded = await loadState();
    assert.equal(reloaded.duplicate, false, 'no duplicate reads on the way back');
    assert.equal(reloaded.loaded.length, TOTAL, 'every book was read for its count');
    assert.equal(new Set(reloaded.names).size, reloaded.names.length, 'no book was read twice');
    assert.ok(reloaded.names.includes(check), `the returning Home draw loaded ${check}`);
    assert.ok(reloaded.maxActive <= 4, `background reads stayed bounded on the way back (max ${reloaded.maxActive})`);
    console.log(`# return: ${reloaded.names.length} total reads for ${TOTAL} books, max ${reloaded.maxActive} at once, every count shown`);
    ok('returning Home reloads the counts that are still needed, without double-queueing');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
