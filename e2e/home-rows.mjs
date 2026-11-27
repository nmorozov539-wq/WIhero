// The retained Home list (N1b) in the browser harness (e2e/desktop/harness.html), no SillyTavern needed. With the
// seeded profile's 40 books, a draw for the same Home page keeps the `.view`, each row, its count span and the folder
// heads; select mode, a folder fold and a scroll update in place, while a list/tiles switch is expected to replace the
// row nodes (the two view types have different children).
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/home-rows.mjs`; it uses only made-up harness data.
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
// 40 fast, empty books plus a one-entry "Perf Big" so Home has a real count and enough rows to scroll.
const QUERY = '?reset&perf=1&books=40&entries=0&big=1&canvas=0&chats=0&long=0';
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
const homeState = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const row = sr.querySelector('.view .item[data-book="Perf Big"]');
    return {
        row: row === window.__row,
        view: sr.querySelector('.view') === window.__view,
        count: row?.querySelector('.m > span') === window.__count,
        countText: row?.querySelector('.m > span')?.textContent ?? null,
        rows: sr.querySelectorAll('.view .item[data-book]').length,
    };
});

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.item[data-book="Perf Big"]').waitFor({ timeout: 60000 });
    assert.equal(await $('.view .item[data-book]').count(), 41, '40 seeded books plus Perf Big');

    // Remember a row and its count span, then draw again: both survive with the count text intact.
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const row = sr.querySelector('.view .item[data-book="Perf Big"]');
        window.__row = row;
        window.__view = sr.querySelector('.view');
        window.__count = row.querySelector('.m > span');
        window.__countText = window.__count.textContent;
    });
    assert.equal(await page.evaluate(() => window.__countText), '1 entries', 'the seeded count shows');
    await page.evaluate(() => wihero.app.refresh());
    const drawn = await homeState();
    assert.ok(drawn.row, 'the Home row keeps its node');
    assert.ok(drawn.view, 'Home keeps its .view node');
    assert.ok(drawn.count, 'the count span keeps its node');
    assert.equal(drawn.countText, '1 entries', 'the count text is still there, not reset to "…"');
    assert.equal(drawn.rows, 41, 'no rows are added or lost');
    ok('a refresh keeps the Home view, the row and its count span, with the count text preserved');

    // Select mode updates the same row: a check mark, the sel class and aria-checked.
    await $('.bottombar button[aria-label="Select"]').click();
    await wait(30);
    await $('.view .item[data-book="Perf Big"]').click();
    const selected = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const row = sr.querySelector('.view .item[data-book="Perf Big"]');
        return {
            same: row === window.__row,
            sel: row.classList.contains('sel'),
            role: row.getAttribute('role'),
            aria: row.getAttribute('aria-checked'),
            check: !!row.querySelector('.ic svg') && row.querySelector('.ic').dataset.icon.startsWith('check'),
            count: row.querySelector('.m > span') === window.__count,
            noMore: !row.querySelector('.more'),
        };
    });
    assert.ok(selected.same && selected.sel && selected.role === 'checkbox' && selected.aria === 'true' && selected.check && selected.noMore,
        'select mode updates the retained row in place');
    assert.ok(selected.count, 'the count span survives select mode too');
    await $('.selhead button[aria-label="Leave selection"]').click();
    await wait(30);
    const left = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const row = sr.querySelector('.view .item[data-book="Perf Big"]');
        return {
            same: row === window.__row,
            sel: row.classList.contains('sel'),
            role: row.getAttribute('role'),
            more: !!row.querySelector('.more'),
        };
    });
    assert.ok(left.same && !left.sel && left.role === null && left.more, 'leaving selection restores the same row and its menu button');
    ok('selection and leaving it update the same Home row and its check mark');

    // Put two books in a folder. The loose rows stay; fold the folder and the same loose row survives.
    await page.evaluate(() => {
        wihero.settings.bookFolders.Shelf = ['Perf Book 001', 'Perf Book 002'];
        wihero.app.refresh();
    });
    await $('.section:has-text("Shelf")').waitFor();
    const beforeFold = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.__head = sr.querySelector('.view > .section:has(button)');
        window.__folderRows = [...sr.querySelectorAll('.view .item[data-book="Perf Book 001"], .view .item[data-book="Perf Book 002"]')];
        return {
            same: sr.querySelector('.view .item[data-book="Perf Big"]') === window.__row,
            folderRows: window.__folderRows.length,
        };
    });
    assert.ok(beforeFold.same, 'the loose row survives the folder move');
    assert.equal(beforeFold.folderRows, 2, 'the folder holds both books');
    await $('.view > .section:has-text("Shelf") > button').click();
    await wait(30);
    const folded = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            same: sr.querySelector('.view .item[data-book="Perf Big"]') === window.__row,
            head: sr.querySelector('.view > .section:has(button)') === window.__head,
            folderRows: window.__folderRows.filter(n => n.isConnected).length,
            open: sr.querySelector('.view > .section:has(button) > button').classList.contains('open'),
        };
    });
    assert.ok(folded.same, 'folding keeps the surviving loose row node');
    assert.ok(folded.head, 'the folder head keeps its node');
    assert.equal(folded.folderRows, 0, 'its rows leave the view');
    assert.ok(!folded.open, 'the head shows closed');
    await $('.view > .section:has-text("Shelf") > button').click();
    await wait(30);
    const unfolded = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            same: sr.querySelector('.view .item[data-book="Perf Big"]') === window.__row,
            open: sr.querySelector('.view > .section:has(button) > button').classList.contains('open'),
            folderRows: sr.querySelectorAll('.view .item[data-book="Perf Book 001"], .view .item[data-book="Perf Book 002"]').length,
        };
    });
    assert.ok(unfolded.same && unfolded.open, 'unfolding keeps the same row and head state');
    assert.equal(unfolded.folderRows, 2, 'the folder rows come back');
    ok('folding and unfolding keep the surviving row and the folder head, dropping only the folder rows');

    // List to tiles and back: the rows are expected to be fresh, since the two view types build different children.
    await $('.head button[aria-label="Show books as tiles"]').click();
    await $('.ptile').first().waitFor();
    assert.equal(await $('.view .item[data-book]').count(), 0, 'tiles replace the rows');
    const tiled = await page.evaluate(() => ({
        view: document.querySelector('#wihero-editor').shadowRoot.querySelector('.view') === window.__view,
        oldRowGone: !window.__row.isConnected,
        tiles: document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.ptile').length,
    }));
    assert.ok(tiled.view, 'switching to tiles keeps the Home .view');
    assert.ok(tiled.oldRowGone, 'the list rows are replaced by tiles');
    assert.equal(tiled.tiles, 41, 'every book has a tile');
    await $('.head button[aria-label="Show books as a list"]').click();
    await $('.item[data-book]').first().waitFor();
    const back = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const row = sr.querySelector('.view .item[data-book="Perf Big"]');
        return {
            view: sr.querySelector('.view') === window.__view,
            fresh: row !== window.__row,
            rows: sr.querySelectorAll('.view .item[data-book]').length,
        };
    });
    assert.ok(back.view, 'coming back to the list keeps the .view');
    assert.ok(back.fresh, 'the list rows are fresh nodes after a list/tiles round trip (expected)');
    assert.equal(back.rows, 41, 'all the rows are back');
    ok('a list/tiles round trip keeps the Home view and rebuilds the row nodes, as expected');

    // Scroll, then draw again: the view and its scrollTop survive.
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.__row = sr.querySelector('.view .item[data-book="Perf Big"]');
        window.__view.scrollTop = 600;
    });
    const scrolled = await page.evaluate(() => window.__view.scrollTop);
    assert.ok(scrolled > 0, 'Home scrolls');
    await page.evaluate(() => wihero.app.refresh());
    const afterScroll = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            view: sr.querySelector('.view') === window.__view,
            scroll: window.__view.scrollTop,
            row: sr.querySelector('.view .item[data-book="Perf Big"]') === window.__row,
        };
    });
    assert.ok(afterScroll.view, 'a refresh after scrolling keeps the Home .view');
    assert.ok(Math.abs(afterScroll.scroll - scrolled) < 2, `scrollTop is kept (${scrolled} → ${afterScroll.scroll})`);
    assert.ok(afterScroll.row, 'the rows keep their nodes after scrolling too');
    ok('a refresh keeps Home\'s .view, its scrollTop and its rows');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
