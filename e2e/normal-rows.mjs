// The retained Normal book page (N1a) in the browser harness (e2e/desktop/harness.html), no SillyTavern needed. On a
// phone with the 1,000-entry "Perf Big" book, a draw for the same page keeps the `.view` and every entry row's node:
// a title change updates the same row, the switch keeps its node and state, a refresh after scrolling keeps the same
// view and its scrollTop, and a re-sort moves the surviving rows without replacing them.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/normal-rows.mjs`; it uses only made-up harness data.
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
const QUERY = '?reset&perf=1&books=0&entries=0&big=1000&canvas=0&chats=0&long=0';
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
const rowState = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const row = sr.querySelector(`.view .item.ent[data-uid="${window.__uid}"]`);
    return {
        row: row === window.__row,
        view: sr.querySelector('.view') === window.__view,
        head: sr.querySelector('.view > .head') === window.__head,
        chips: sr.querySelector('.view > .bkchips') === window.__chips,
        title: row?.querySelector('.nm')?.textContent ?? null,
        count: sr.querySelectorAll('.view .item.ent').length,
    };
});

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.item[data-book="Perf Big"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    const firstWindow = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        return { rows: view.querySelectorAll('.item.ent').length, scrollHeight: view.scrollHeight, clientHeight: view.clientHeight };
    });
    // N4a windows the list: the 980 shown entries are not all mounted, but the scrollbar still spans the book.
    assert.ok(firstWindow.rows > 10 && firstWindow.rows < 250, `only a window of rows is mounted (${firstWindow.rows})`);
    assert.ok(firstWindow.scrollHeight > 40000, `the view still spans the whole book (${firstWindow.scrollHeight}px)`);
    ok(`the 1,000-entry book mounts a bounded window of rows (${firstWindow.rows} of 980)`);

    // Remember the fourth row and the view, then rename that entry and draw again.
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const rows = [...sr.querySelectorAll('.view .item.ent')];
        window.__row = rows[3];
        window.__uid = Number(window.__row.dataset.uid);
        window.__view = sr.querySelector('.view');
        window.__head = sr.querySelector('.view > .head');
        window.__chips = sr.querySelector('.view > .bkchips');
        window.__count = rows.length;
    });
    await page.evaluate(() => {
        wihero.library.change('Perf Big', d => { d.entries[window.__uid].comment = 'Retained row title'; }, { quiet: true });
        wihero.app.refresh();
    });
    const renamed = await rowState();
    assert.ok(renamed.row, 'the renamed entry keeps its row node');
    assert.ok(renamed.view, 'the book page keeps its .view node');
    assert.ok(renamed.head, 'the header keeps its node');
    assert.ok(renamed.chips, 'the chips keep their node');
    assert.equal(renamed.title, 'Retained row title', 'the row title updates in place');
    assert.ok(Math.abs(renamed.count - await page.evaluate(() => window.__count)) <= 6, 'the window stays about the same size');
    ok('a title change updates the same row, header and chips under the same .view, with the same row count');

    // The switch is late-bound to the uid: it keeps its own node and toggles off and back on.
    await page.evaluate(() => { window.__sw = window.__row.querySelector('.switch'); });
    const on = await page.evaluate(() => window.__sw.classList.contains('on'));
    await $(`.view .item.ent[data-uid="${await page.evaluate(() => window.__uid)}"] .switch`).click();
    let switched = await page.evaluate(() => ({
        row: document.querySelector('#wihero-editor').shadowRoot.querySelector(`.view .item.ent[data-uid="${window.__uid}"]`) === window.__row,
        same: window.__row.querySelector('.switch') === window.__sw,
        on: window.__sw.classList.contains('on'),
        aria: window.__sw.getAttribute('aria-checked'),
    }));
    assert.ok(switched.row && switched.same, 'toggling off keeps the row and switch nodes');
    assert.equal(switched.on, !on, 'the switch changes state');
    assert.equal(switched.aria, String(!on), 'its aria-checked follows');
    await $(`.view .item.ent[data-uid="${await page.evaluate(() => window.__uid)}"] .switch`).click();
    switched = await page.evaluate(() => ({
        row: document.querySelector('#wihero-editor').shadowRoot.querySelector(`.view .item.ent[data-uid="${window.__uid}"]`) === window.__row,
        same: window.__row.querySelector('.switch') === window.__sw,
        on: window.__sw.classList.contains('on'),
        aria: window.__sw.getAttribute('aria-checked'),
    }));
    assert.ok(switched.row && switched.same, 'toggling back on keeps the same nodes');
    assert.equal(switched.on, on, 'the switch returns to its state');
    assert.equal(switched.aria, String(on), 'and its aria-checked');
    ok('off and on keep the same row and switch nodes, class and aria');

    // Scrolling down, focusing the switch and drawing again keeps the view, its scrollTop and the focus.
    await page.evaluate(() => {
        window.__sw.focus({ preventScroll: true });
        window.__view.scrollTop = 1200;
    });
    const scrolled = await page.evaluate(() => window.__view.scrollTop);
    assert.ok(scrolled > 0, 'the book page scrolls');
    await page.evaluate(() => wihero.app.refresh());
    const afterScroll = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            view: sr.querySelector('.view') === window.__view,
            scroll: window.__view.scrollTop,
            focus: sr.activeElement === window.__sw,
        };
    });
    assert.ok(afterScroll.view, 'a refresh after scrolling keeps the .view node');
    assert.ok(Math.abs(afterScroll.scroll - scrolled) < 2, `scrollTop is kept (${scrolled} → ${afterScroll.scroll})`);
    assert.ok(afterScroll.focus, 'the focused switch keeps focus');
    ok('a refresh keeps the view node, its scrollTop and the focused switch');

    // Re-sort through the menu: rows that remain in the window keep their node, only the order changes.
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.__rows = [...sr.querySelectorAll('.view .item.ent')];
        window.__byUid = new Map(window.__rows.map(r => [r.dataset.uid, r]));
        window.__order = window.__rows.map(r => r.dataset.uid);
    });
    await $('button[aria-label="Menu"]').click();
    await $('.sheet').waitFor();
    await $('.sheet .opt.has-choices').filter({ hasText: 'Sort by' }).click();
    await $('.sheet .choices .opt[data-k="az"]').click();
    await page.keyboard.press('Escape');
    await wait(60);
    const sorted = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const now = [...sr.querySelectorAll('.view .item.ent')];
        return {
            reused: now.filter(n => window.__byUid.get(n.dataset.uid) === n).length,
            view: sr.querySelector('.view') === window.__view,
            scroll: sr.querySelector('.view').scrollTop,
            order: now.map(r => r.dataset.uid),
            count: now.length,
        };
    });
    assert.ok(sorted.reused > 0, 'rows still in the window survive the re-sort as the same nodes');
    assert.ok(sorted.view, 'the re-sort keeps the .view node');
    assert.ok(sorted.count < 250, `the re-sort keeps the window bounded (${sorted.count})`);
    assert.ok(Math.abs(sorted.scroll - scrolled) < 2, `the re-sort keeps scrollTop (${scrolled} → ${sorted.scroll})`);
    assert.notDeepEqual(sorted.order.slice(0, 20), await page.evaluate(() => window.__order.slice(0, 20)), 'the rows really are in a new order');
    ok(`the A–Z re-sort moves the surviving window rows without replacing them (${sorted.reused} nodes reused)`);

    // Selection mode updates a mounted row: a check mark and aria-checked, no switch; leaving puts them back.
    await page.evaluate(() => { window.__view.scrollTop = 0; });
    await wait(50);
    const uid = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const rows = [...sr.querySelectorAll('.view .item.ent')];
        window.__row = rows[0];
        window.__uid = Number(rows[0].dataset.uid);
        return window.__uid;
    });
    await $('.bottombar button[aria-label="Select"]').click();
    await wait(30);
    await $(`.view .item.ent[data-uid="${uid}"]`).click();
    const selected = await page.evaluate(() => {
        const row = window.__row;
        return {
            same: document.querySelector('#wihero-editor').shadowRoot.querySelector(`.view .item.ent[data-uid="${window.__uid}"]`) === row,
            sel: row.classList.contains('sel'),
            role: row.getAttribute('role'),
            aria: row.getAttribute('aria-checked'),
            check: !!row.querySelector('.ic svg'),
            noSwitch: !row.querySelector('.switch'),
        };
    });
    assert.ok(selected.same && selected.sel && selected.role === 'checkbox' && selected.aria === 'true' && selected.check && selected.noSwitch,
        'selection updates the retained row in place');
    await $('.selhead button[aria-label="Leave selection"]').click();
    await wait(30);
    const left = await page.evaluate(() => {
        const row = window.__row;
        return {
            same: document.querySelector('#wihero-editor').shadowRoot.querySelector(`.view .item.ent[data-uid="${window.__uid}"]`) === row,
            sel: row.classList.contains('sel'),
            role: row.getAttribute('role'),
            aria: row.getAttribute('aria-checked'),
            switch: !!row.querySelector('.switch'),
        };
    });
    assert.ok(left.same && !left.sel && left.role === null && left.aria === null && left.switch, 'leaving selection puts the same row and switch back');
    ok('selection and leaving it update the same row and its switch');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
