// Delegated row gestures (N2) in the browser harness (e2e/desktop/harness.html), no SillyTavern needed. At 390px a
// tap opens a Home book, a long press opens it in a background tab without the following click also opening it, an
// 8px move cancels the long press, a ⋯ button keeps its own menu, an entry's switch does not open the row, and select
// mode marks rows while a long press there opens nothing. The same checks run on an entry row of the 1,000-entry
// "Perf Big" book.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/delegate.mjs`; it uses only made-up harness data.
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
const QUERY = '?reset&perf=1&books=4&entries=0&big=1000&canvas=0&chats=0&long=0';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const wait = ms => page.waitForTimeout(ms);
const tabCount = () => $('.tabbar .tab').count();
// The book page is the visible page: an entry open hides its list but keeps the .bkname node (N3b).
const onBook = () => $('.bkname').first().isVisible();

/** The centre of a row, so pointer moves start well inside it. */
async function centre(locator) {
    const box = await locator.boundingBox();
    assert.ok(box, 'the row has a box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real pointer down and up, held past the 480 ms long press. */
async function hold(locator) {
    const p = await centre(locator);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await wait(600);
    await page.mouse.up();
    await wait(60);
}

/** A pointer down, a 12px move (past the 8px cancel), a wait past the long press, then up. Returns the tab count
 *  just before release, when a long press would already have opened its background tab. */
async function holdAndMove(locator) {
    const p = await centre(locator);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y + 12, { steps: 3 });
    await wait(600);
    const tabs = await tabCount();
    await page.mouse.up();
    await wait(60);
    return tabs;
}

async function goHome() {
    if (await onBook()) {
        await $('.tabbar .tab').first().click();
        await wait(30);
    }
    await $('.view .item[data-book]').first().waitFor();
}

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.item[data-book="Perf Book 001"]').waitFor({ timeout: 60000 });
    assert.equal(await $('.view .item[data-book]').count(), 5, 'four seeded books plus Perf Big');

    // A tap opens a book.
    await $('.item[data-book="Perf Book 001"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Book 001' }).waitFor();
    ok('a tap on a Home book row opens the book');
    await goHome();

    // A long press opens a background tab; the click that ends it must not also open the book.
    const beforeLong = await tabCount();
    await hold($('.item[data-book="Perf Book 002"]'));
    assert.equal(await tabCount(), beforeLong + 1, 'the long press adds one background tab');
    assert.ok(!(await onBook()), 'the click after the long press does not open the book too');
    assert.ok((await $('.view .item[data-book]').count()) === 5, 'Home is still the page');
    assert.match(await $('.toast').textContent(), /Opened in a background tab/);
    ok('a long press on a Home row opens a background tab and the following click is swallowed');

    // Moving more than 8px cancels the long press (checking before release, when a long press would have opened
    // its tab). The release may still be an ordinary tap.
    const beforeMove = await tabCount();
    assert.equal(await holdAndMove($('.view .item[data-book="Perf Book 003"]')), beforeMove, 'a moved pointer opens no background tab');
    ok('an 8px move cancels the long press');
    await goHome();

    // A row's ⋯ keeps its own click: a menu, not a book.
    await $('.item[data-book="Perf Book 004"] .more').click();
    await $('.sheet').waitFor();
    assert.ok(!(await onBook()), 'the ⋯ button does not open the book');
    await page.keyboard.press('Escape');
    await wait(30);
    ok('a tap on a Home row\'s ⋯ still opens its menu');

    // Select mode: a tap marks the row; a long press there opens nothing and marks nothing.
    await $('.bottombar button[aria-label="Select"]').click();
    await $('.selhead').waitFor();
    await $('.view .item[data-book="Perf Book 001"]').click();
    await $('.view .item[data-book="Perf Book 001"].sel').waitFor();
    const beforeSelectLong = await tabCount();
    const target = $('.view .item[data-book="Perf Book 002"]');
    await hold(target);
    const selectLong = await target.evaluate(n => ({ sel: n.classList.contains('sel'), pressing: n.classList.contains('pressing') }));
    assert.equal(await tabCount(), beforeSelectLong, 'a long press in select mode opens no background tab');
    assert.ok(!selectLong.sel && !selectLong.pressing, 'a long press in select mode does nothing to the row');
    assert.ok((await $('.view .item[data-book]').count()) === 5, 'Home stays put');
    ok('select mode marks Home rows and a long press there does nothing');
    await $('.selhead button[aria-label="Leave selection"]').click();
    await wait(30);

    // The 1,000-entry book: a tap opens an entry, a long press opens a background tab, the click after it is gone.
    await $('.view .item[data-book="Perf Big"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    const entries = await $('.view .item.ent').count();
    assert.ok(entries > 900, `the big book shows its rows (${entries})`);
    await $('.view .item.ent').first().click();
    await $('.en-top').waitFor();
    assert.ok(!(await onBook()), 'the tap leaves the book for the entry page');
    await $('.en-top button[aria-label="Up to the book"]').click();
    await $('.view .item.ent').first().waitFor();
    ok('a tap on an entry row opens the entry');

    const beforeEntryLong = await tabCount();
    await hold($('.view .item.ent').nth(1));
    assert.equal(await tabCount(), beforeEntryLong + 1, 'the entry long press adds one background tab');
    assert.ok(await onBook(), 'the click after the entry long press stays on the book page');
    assert.match(await $('.toast').textContent(), /Opened in a background tab/);
    ok('a long press on an entry row opens a background tab without also opening the entry');

    const beforeEntryMove = await tabCount();
    assert.equal(await holdAndMove($('.view .item.ent').nth(2)), beforeEntryMove, 'a moved pointer opens no entry background tab');
    if (!(await onBook())) {
        await $('.en-top button[aria-label="Up to the book"]').click();
        await $('.view .item.ent').first().waitFor();
    }
    ok('an 8px move cancels an entry long press');

    // The entry's ⋯ and switch keep their own clicks; the switch must not open the row.
    await $('.view .item.ent').nth(3).locator('.more').click();
    await $('.sheet').waitFor();
    assert.ok(await onBook(), 'the entry ⋯ does not open the entry');
    await page.keyboard.press('Escape');
    await wait(30);
    const sw = $('.view .item.ent').nth(3).locator('.switch');
    const wasOn = (await sw.getAttribute('class')).includes('on');
    await sw.click();
    await wait(30);
    assert.equal((await sw.getAttribute('aria-checked')), String(!wasOn), 'the switch toggles');
    assert.ok(await onBook(), 'the switch does not open the row');
    await sw.click();
    await wait(30);
    ok('an entry row\'s ⋯ opens its menu and its switch toggles without opening the entry');

    // Select mode on entries: a tap marks a row, a long press opens nothing.
    await $('.bottombar button[aria-label="Select"]').click();
    await $('.selhead').waitFor();
    const first = $('.view .item.ent').first();
    await first.click();
    await $('.view .item.ent.sel').first().waitFor();
    const beforeEntrySelectLong = await tabCount();
    await hold($('.view .item.ent').nth(1));
    assert.equal(await tabCount(), beforeEntrySelectLong, 'a long press in entry select mode opens no background tab');
    assert.ok((await $('.view .item.ent').count()) > 900, 'select mode stays on the book page');
    await $('.selhead button[aria-label="Leave selection"]').click();
    await wait(30);
    ok('select mode marks entry rows and a long press there opens no background tab');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
