// Search indexing, debounce and background loads (M4) in the browser harness (e2e/desktop/harness.html), no
// SillyTavern needed. Opening the phone search or desktop Ctrl K reads no book: only loaded books are searched and the
// rest are offered as "not searched yet". The read log is `wiheroHarnessLoads` (`?slow=`, as in load-priority.mjs);
// `wihero.perf.snapshot().searchRuns` / `searchIndexBuilds` count overlay scans and corpus builds.
//
// Proves: 0 book reads on open; a first query at once, then one debounced run for a 10-key burst with no corpus
// rebuild; folder rows dedupe while off entries search and Moments do not; current-book priority after "Search all
// books", which loads bounded background reads and updates the open overlay; closing search drops its queue; a result
// click and a phone long press open as before; desktop arrows + Enter open the highlighted entry; no page errors.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/search.mjs`; it uses only made-up harness data.
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
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const BOOK = 'WIHero-Sample';
const BURST = 'millwheel9';

async function open(width, height, query, mobile = false) {
    const page = await browser.newPage({ viewport: { width, height }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
    await page.goto(`${BASE}${query}`);
    await page.waitForFunction(() => window.wihero && (!new URLSearchParams(location.search).has('slow') || window.wiheroHarnessLoads), null, { timeout: 60000 });
    // The perf profile starts closed; the plain harness opens itself, so only click when it is not shown yet.
    if (!(await page.locator('#wihero-editor .tab').first().isVisible().catch(() => false))) await page.click('#wi-button');
    await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 60000 });
    return page;
}
const loads = page => page.evaluate(() => ({
    length: wiheroHarnessLoads.log.length,
    names: wiheroHarnessLoads.log.map(l => l.name),
    active: wiheroHarnessLoads.active,
    maxActive: wiheroHarnessLoads.maxActive,
    loaded: [...wiheroHarnessLoads.loaded],
    duplicate: wiheroHarnessLoads.duplicate,
}));
const counters = page => page.evaluate(() => wihero.perf.snapshot());

try {
    // ── Phone: no bulk load, loaded-book results, index reuse and the not-searched state ──
    const phone = await open(390, 844, '?reset&slow=400', true);
    const $ = sel => phone.locator(`#wihero-editor ${sel}`);
    await $('.view .item[data-book="WIHero-Sample"]').waitFor({ timeout: 60000 });
    await $('.view .item[data-book="WIHero-Sample"]').click();
    await $('.bkname h1').filter({ hasText: 'WIHero-Sample' }).waitFor({ timeout: 60000 });
    await $('.item.ent').first().waitFor({ timeout: 60000 });
    // Home's remaining count reads were dropped when the book opened; let the in-flight ones finish so nothing
    // changes under the measured search.
    await phone.waitForTimeout(300);

    // Two entries in one folder, one off entry and one Moment, set through the harness library as a reader's edits
    // would be. The Moment has its own words; the off entry keeps its title and key.
    await phone.evaluate(book => {
        const data = wihero.library.peek(book);
        const uids = Object.keys(data.entries).map(Number).sort((a, b) => a - b);
        const keyOf = e => {
            const id = e.extensions?.wihero?.id ?? e.wihero?.id;
            return id ? `id:${id}` : `uid:${e.uid}`;
        };
        const b = (wihero.settings.books[book] ??= { defaults: {}, folders: {} });
        (b.folders ??= {})[keyOf(data.entries[uids[0]])] = 'Mill race';
        b.folders[keyOf(data.entries[uids[1]])] = 'Mill race';
        wihero.library.change(book, d => { d.entries[uids[2]].disable = true; }, { quiet: true });
        const source = d => d.entries[uids[3]];
        wihero.library.change(book, d => {
            d.entries[999] = {
                ...source(d), uid: 999, comment: 'Momentmill', key: ['momentmill'],
                extensions: { wihero: { id: 'moment-mill', moment: true } },
            };
        }, { quiet: true });
        // Moments only live on the canvas: place it, or opening the book would prune it before search sees it.
        const mem = (b.canvas ??= { camera: null, cards: {} });
        (mem.cards ??= {})['id:moment-mill'] = { placed: true };
        wihero.app.refresh();
    }, BOOK);
    await $('.item.ent').first().waitFor();

    await phone.evaluate(() => wihero.perf.reset());
    const beforeOpen = await loads(phone);
    await $('.bottombar button[aria-label="Search"]').click();
    await $('.search input').waitFor();
    assert.equal((await counters(phone)).searchRuns, 1, 'the empty first query runs immediately, before the debounce');
    await phone.waitForTimeout(250);
    const afterOpen = await loads(phone);
    assert.equal(afterOpen.length, beforeOpen.length, 'opening search reads no book at all');

    const total = await phone.evaluate(() => wihero.library.names().length);
    const still = total - afterOpen.loaded.length;
    const note = $('.res .snote');
    await note.waitFor();
    assert.match(await note.textContent(), new RegExp(`${still} books? not searched yet`), 'the unloaded books are named');
    assert.ok(still > 0, 'the profile has books that are not loaded');
    ok(`opening search read 0 books and named ${still} of ${total} as not searched yet`);

    // A 10-key burst: one run after the trailing debounce, and not one corpus rebuild (the open built them once).
    await phone.evaluate(() => wihero.perf.reset());
    await $('.search input').click();
    await phone.keyboard.type(BURST, { delay: 20 });
    await phone.waitForTimeout(400);
    const burst = await counters(phone);
    assert.equal(burst.searchRuns, 1, `the 10-key burst searched once (saw ${burst.searchRuns})`);
    assert.equal(burst.searchIndexBuilds, 0, 'the loaded book\'s corpus was reused, not rebuilt per keystroke');
    ok('a 10-key burst runs search once, from cached corpora');

    await $('.search input').fill('Mill: the secret');
    await $('.res .item').first().waitFor();
    assert.equal(await $('.res .item.st-off').count(), 1, 'an off entry is still searchable, as before');
    await $('.search input').fill('momentmill');
    await phone.waitForTimeout(250);
    assert.equal(await $('.res .item').count(), 0, 'a Moment is never in search');
    assert.match(await $('.res .empty-note').textContent(), /Nothing found/);
    ok('off entries search; Moments do not');

    await $('.search input').fill('mill');
    await $('.res .item').first().waitFor();
    const folders = $('.res .item[data-kind="folder"]');
    assert.equal(await folders.count(), 1, 'one folder row for two entries in it');
    assert.equal(await folders.getAttribute('data-folder'), 'Mill race');
    ok('folder rows dedupe by book and folder');

    // "Search all books": bounded background reads; the overlay stays open, keeps focus and updates as they arrive.
    // The harness's maxActive is for the whole page (Home's counts and the book read are past); measure from here.
    await phone.evaluate(() => { wiheroHarnessLoads.maxActive = wiheroHarnessLoads.active; });
    const beforeAll = await loads(phone);
    await $('.res .snote button').click();
    assert.match(await $('.res .snote').first().textContent(), /Searching \d+ more book/);
    // Keep typing while the reads land: the overlay must not be rebuilt under the field.
    await $('.search input').focus();
    await $('.search input').evaluate(n => { n.dataset.keep = '1'; });
    await phone.waitForFunction(book => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return [...sr.querySelectorAll('.res .item[data-book]')].some(n => n.dataset.book !== book);
    }, BOOK, { timeout: 60000 });
    assert.equal(await $('.search').count(), 1, 'search stays open while the rest load');
    assert.equal(await phone.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.activeElement?.tagName), 'INPUT', 'the field keeps the focus');
    assert.equal(await $('.search input').getAttribute('data-keep'), '1', 'and it is the same field node, not a redrawn overlay');
    const rows = $('.res .item[data-book]');
    assert.equal(await rows.first().getAttribute('data-book'), BOOK, 'the open book\'s entries stay first');
    await $('.res .snote').waitFor({ state: 'detached', timeout: 60000 });
    const all = await loads(phone);
    assert.equal(all.length - beforeAll.length, still, 'Search all books read exactly the unloaded books');
    assert.ok(all.maxActive <= 3, `its reads stay bounded at three (max ${all.maxActive})`);
    assert.equal(all.duplicate, false, 'no book was read twice');
    ok(`Search all books loaded in the background (max ${all.maxActive} at once, ${all.length - beforeAll.length} reads) and results updated in place`);

    // A tap opens in a new tab and leaves search, as before.
    const tabs = await $('.tab').count();
    await $('.res .item').first().click();
    await phone.waitForTimeout(150);
    assert.equal(await $('.search').count(), 0, 'a tapped result closes search');
    assert.equal(await $('.tab').count(), tabs + 1, 'and opens in a new tab');
    await phone.keyboard.press('Escape');
    await $('.bkname h1').filter({ hasText: BOOK }).waitFor();

    // Long press still opens a background tab and keeps search open.
    await $('.bottombar button[aria-label="Search"]').click();
    await $('.search input').fill('mill');
    await $('.res .item').first().waitFor();
    const beforeLong = await $('.tab').count();
    const box = await $('.res .item').first().boundingBox();
    assert.ok(box);
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.waitForTimeout(600);
    await phone.mouse.up();
    await phone.waitForTimeout(80);
    assert.equal(await $('.tab').count(), beforeLong + 1, 'the long press opens a background tab');
    assert.equal(await $('.search').count(), 1, 'and search stays open');
    assert.match(await $('.toast').textContent(), /Opened in a background tab/);
    ok('a result tap and a phone long press still open as before');

    console.log(`# phone: ${afterOpen.length} reads before search, ${all.length} after Search all books, ${still} initially unsearched`);
    await phone.close();

    // ── Closing search drops its queued loads ──
    const cancelPage = await open(390, 844, '?reset&perf=1&books=12&entries=4&big=2&canvas=0&chats=0&long=0&slow=400', true);
    const c$ = sel => cancelPage.locator(`#wihero-editor ${sel}`);
    await c$('.view .item[data-book="Perf Book 001"]').waitFor({ timeout: 60000 });
    await c$('.view .item[data-book="Perf Book 001"]').click();
    await c$('.bkname h1').filter({ hasText: 'Perf Book 001' }).waitFor({ timeout: 60000 });
    await cancelPage.waitForTimeout(500);
    await c$('.bottombar button[aria-label="Search"]').click();
    await c$('.search input').fill('Perf');
    await c$('.res .item').first().waitFor();
    const beforeCancel = await loads(cancelPage);
    await c$('.res .snote button').click();
    await cancelPage.waitForFunction(n => wiheroHarnessLoads.log.length > n, beforeCancel.length, { timeout: 60000 });
    await c$('.search button[aria-label="Close search"]').click();
    const atClose = await loads(cancelPage);
    assert.equal(await c$('.search').count(), 0, 'the overlay closed');
    await cancelPage.waitForTimeout(800);
    const cancelled = await loads(cancelPage);
    assert.equal(cancelled.length, atClose.length, 'no queued search read starts after search closes');
    assert.ok(cancelled.length < (await cancelPage.evaluate(() => wihero.library.names().length)) + 1, 'the library was not read whole');
    ok(`closing search dropped its queue (${cancelled.length} reads, ${atClose.active} still in flight)`);
    await cancelPage.close();

    // ── Desktop: Ctrl K, debounce, arrows and Enter ──
    const desk = await open(1366, 768, '?reset&slow=400');
    const d$ = sel => desk.locator(`#wihero-editor ${sel}`);
    await d$('.tile').filter({ hasText: BOOK }).first().click();
    await d$('.brow').first().waitFor({ timeout: 60000 });
    await desk.waitForTimeout(300);
    await desk.keyboard.press('Control+k');
    await d$('.dsearch .dsbar input').waitFor();
    await d$('.dsearch .snote').waitFor();
    assert.match(await d$('.dsearch .snote').textContent(), /not searched yet/);
    await d$('.dsearch .dsbar input').fill('mill');
    await d$('.dsres .dsr').first().waitFor({ timeout: 60000 });
    const titles = await d$('.dsres .dsr').evaluateAll(rs => rs.slice(0, 2).map(r => r.querySelector('b').textContent));
    assert.ok(titles.length === 2);
    await desk.keyboard.press('ArrowDown');
    await desk.keyboard.press('Enter');
    await desk.waitForFunction(() => !document.querySelector('#wihero-editor').shadowRoot.querySelector('.dsearch'));
    assert.equal((await d$('.br .en h1').textContent()).trim(), titles[1], 'Enter opens the highlighted hit in the right pane');
    ok('Ctrl K searches loaded books; arrows and Enter open the highlighted entry');

    // ── The typing budget: one character, 40-book profile, current book loaded, 6× CPU ──
    const speed = await open(390, 844, '?reset&perf=1&books=40&entries=150&big=1000&canvas=0&chats=0&long=0', true);
    const s$ = sel => speed.locator(`#wihero-editor ${sel}`);
    await s$('.view .item[data-book="Perf Big"]').waitFor({ timeout: 60000 });
    await s$('.view .item[data-book="Perf Big"]').click();
    await s$('.item.ent').first().waitFor({ timeout: 60000 });
    await s$('.bottombar button[aria-label="Search"]').click();
    await s$('.search input').waitFor();
    await speed.waitForTimeout(400); // the open's corpus build is outside the typing measurement
    await speed.evaluate(() => {
        window.__typing = { long: [] };
        new PerformanceObserver(list => { for (const e of list.getEntries()) window.__typing.long.push(Math.round(e.duration)); })
            .observe({ type: 'longtask', buffered: false });
    });
    const cdp = await speed.context().newCDPSession(speed);
    await cdp.send('Performance.enable');
    const taskSeconds = async () => {
        const { metrics } = await cdp.send('Performance.getMetrics');
        return metrics.find(m => m.name === 'TaskDuration')?.value ?? 0;
    };
    /** One keystroke after the open has warmed the corpora; Playwright's own click and wait are outside. */
    const measureType = async (ch, rate) => {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        await s$('.search input').click();
        await speed.waitForTimeout(80);
        await speed.evaluate(() => { window.__typing.long = []; wihero.perf.timing = true; wihero.perf.reset(); });
        const taskBefore = await taskSeconds();
        const start = Date.now();
        await speed.keyboard.type(ch);
        await speed.waitForTimeout(300);
        const out = await speed.evaluate(() => {
            const p = wihero.perf.snapshot();
            return { long: window.__typing.long, runs: p.searchRuns, builds: p.searchIndexBuilds, searchMs: p.searchMs, searchCalls: p.searchCalls };
        });
        await speed.evaluate(() => { wihero.perf.timing = false; });
        out.worst = Math.max(0, ...out.long);
        out.ms = Date.now() - start;
        out.taskMs = Math.round(((await taskSeconds()) - taskBefore) * 1000);
        return out;
    };
    const at6x = await measureType('m', 6);
    const at1x = await measureType('i', 1);
    for (const [label, t] of [['6x', at6x], ['1x', at1x]]) {
        assert.equal(t.runs, 1, `one character is one search run at ${label}`);
        assert.equal(t.builds, 0, `and no corpus rebuild at ${label}`);
        console.log(`# typing at ${label}: scan ${t.searchMs} ms (${t.searchCalls} call), task duration ${t.taskMs} ms, worst long task ${t.worst} ms (${t.long.length} over 50 ms), ${t.runs} run, ${t.builds} builds, step ${t.ms} ms`);
    }
    ok('one character at 6× and 1×: one run, no rebuild, task recorded');
    await speed.close();

    assert.deepEqual(errors, [], 'no errors in the pages');
    ok('no errors in the pages');
} finally {
    await browser.close();
    server.close();
}
