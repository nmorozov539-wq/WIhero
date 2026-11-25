// The phone book list kept while an entry is open (N3b) in the browser harness (e2e/desktop/harness.html): no
// SillyTavern needed. At 390 × 844 on the 1,000-entry "Perf Big" book, opening an entry hides the same book `.view`
// instead of replacing it: its rows, scrollTop and focused switch come back on Back, the hidden list is neither
// visible nor focusable, moving to a second entry through the entry drawer keeps the list, and a title edit made
// while the entry is open updates the same row node on Back. `rowMounts` does not move on Back. Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/entry-pane.mjs`; it uses only made-up harness data.
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
const snapshot = () => page.evaluate(() => window.wihero.perf.snapshot());

/** The retained list pane and the entry pane beside it: identity, visibility and focusability. */
const paneState = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const d = window.__d;
    const list = d.view;
    const view = [...sr.querySelectorAll('.main > .view')].find(n => n !== list) ?? null;
    return {
        listSame: sr.querySelector('.main > .view[data-pane="list"]') === list,
        listHidden: list.hidden,
        listDisplay: getComputedStyle(list).display,
        listRects: list.getClientRects().length,
        rowsSame: [...list.querySelectorAll('.item.ent')].length === d.rows.length
            && [...list.querySelectorAll('.item.ent')].every((r, i) => r === d.rows[i]),
        rowSame: list.querySelector(`.item.ent[data-uid="${d.uid}"]`) === d.row,
        entryShown: !!view && !view.hidden,
        // A hidden pane must not take focus, even when focus() is asked.
        hiddenFocusable: (() => { const sw = d.sw; sw.focus(); return sr.activeElement === sw; })(),
        bars: { bottom: sr.querySelectorAll('.bottombar').length, sel: sr.querySelectorAll('.selbar').length },
        pages: sr.querySelectorAll('.main > .view').length,
    };
});

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.item[data-book="Perf Big"]').click();
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    assert.equal(await $('.view .item.ent').count(), 980, 'the 1,000-entry book hides its 20 Moments');

    // Scroll the list, focus a row's switch and remember the view, every row and that row.
    const tagged = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        view.scrollTop = 1200;
        const box = view.getBoundingClientRect();
        const rows = [...view.querySelectorAll('.item.ent')];
        const row = rows.find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 10 && b.bottom <= box.bottom - 10;
        }) ?? rows[3];
        const sw = row.querySelector('.switch');
        sw.focus({ preventScroll: true });
        window.__d = { view, rows, row, uid: Number(row.dataset.uid), sw, entryView: null, scroll: view.scrollTop };
        return { scroll: view.scrollTop, focused: sr.activeElement === sw, uid: window.__d.uid, count: rows.length };
    });
    assert.ok(tagged.scroll > 0, 'the book page scrolls');
    assert.ok(tagged.focused, 'a row switch holds focus before the entry opens');
    await page.evaluate(() => window.wihero.perf.reset());

    // Programmatic click: it goes through the delegated tap without moving focus off the switch.
    await page.evaluate(() => window.__d.row.click());
    await $('.en h1').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return !!sr.querySelector('.main > .view[data-pane="entry"]');
    });
    await page.evaluate(() => { window.__d.entryView = [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.main > .view')].find(n => n !== window.__d.view); });
    const openSnap = await snapshot();
    let state = await paneState();
    assert.ok(state.listSame && state.rowSame && state.rowsSame, 'the book .view, its rows and the chosen row keep their nodes');
    assert.ok(state.listHidden && state.listDisplay === 'none' && state.listRects === 0, 'the hidden list is not laid out');
    assert.ok(!state.hiddenFocusable, 'the hidden list cannot take focus');
    assert.ok(state.entryShown, 'the entry page is a second pane beside it');
    assert.equal(state.pages, 2, 'the entry is drawn beside the hidden list');
    assert.deepEqual(state.bars, { bottom: 0, sel: 0 }, 'no book bar is left under the entry');
    assert.equal(openSnap.appRenders, 1, 'opening the entry is one app render');
    assert.equal(openSnap.rowMounts, 0, 'opening the entry mounts no list rows');
    ok('opening an entry keeps the book .view, its rows and row node, hides it, and shows the entry beside it');

    // Back shows the same list with its scroll and focus; the entry page is gone.
    await $('.en-top [aria-label="Up to the book"]').click();
    await page.waitForFunction(() => !window.__d.view.hidden, null, { timeout: 60000 });
    const backSnap = await snapshot();
    const back = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        return {
            view: sr.querySelector('.main > .view') === d.view,
            row: d.view.querySelector(`.item.ent[data-uid="${d.uid}"]`) === d.row,
            scroll: d.view.scrollTop,
            focus: sr.activeElement === d.sw,
            entryGone: !d.entryView.isConnected,
            bottom: sr.querySelectorAll('.bottombar').length,
            sel: sr.querySelectorAll('.selbar').length,
        };
    });
    assert.ok(back.view && back.row, 'Back keeps the same .view and row node');
    assert.ok(Math.abs(back.scroll - tagged.scroll) < 2, `Back restores scrollTop (${tagged.scroll} → ${back.scroll})`);
    assert.ok(back.focus, 'Back restores focus to the same switch');
    assert.ok(back.entryGone, 'the entry page is removed');
    assert.deepEqual({ bottom: back.bottom, sel: back.sel }, { bottom: 1, sel: 0 }, 'only the book bottom bar is shown');
    assert.equal(backSnap.appRenders - openSnap.appRenders, 1, 'Back is one app render');
    assert.equal(backSnap.rowMounts - openSnap.rowMounts, 0, 'Back mounts no list rows (keyed reconciliation)');
    ok(`Back keeps the list, scroll and focus with 0 new row mounts (${openSnap.rowMounts} → ${backSnap.rowMounts})`);

    // Open the entry again, then move to another one through the entry drawer: only the entry pane is replaced.
    await page.evaluate(() => window.__d.row.click());
    await $('.en h1').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('#wihero-editor').shadowRoot.querySelector('.main > .view[data-pane="entry"]'));
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        d.entry1 = [...sr.querySelectorAll('.main > .view')].find(n => n !== d.view);
        d.rows2 = [...d.view.querySelectorAll('.item.ent')];
        const i = d.rows.indexOf(d.row);
        d.row2 = d.rows[(i + 1) % d.rows.length];
        d.uid2 = Number(d.row2.dataset.uid);
        d.title2 = d.row2.querySelector('.nm').textContent;
        window.wihero.perf.reset();
    });
    const secondTitle = await page.evaluate(() => window.__d.title2);
    await $('.en-top [aria-label="Entries in this book"]').click();
    await $('.sheet').waitFor();
    const picked = await page.evaluate(title => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const opt = [...sr.querySelectorAll('.sheet .opt')].find(o => o.textContent.trim() === title);
        if (opt) opt.click();
        return !!opt;
    }, secondTitle);
    assert.ok(picked, 'the entry drawer lists the second entry');
    await page.waitForFunction(name => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return sr.querySelector('.main > .view[data-pane="entry"] .en h1')?.textContent === name;
    }, secondTitle, { timeout: 60000 });
    const secondSnap = await snapshot();
    const secondState = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        const view = [...sr.querySelectorAll('.main > .view')].find(n => n !== d.view);
        return {
            list: sr.querySelector('.main > .view[data-pane="list"]') === d.view,
            rows: [...d.view.querySelectorAll('.item.ent')].length === d.rows2.length
                && [...d.view.querySelectorAll('.item.ent')].every((r, i) => r === d.rows2[i]),
            hidden: d.view.hidden,
            entryGone: !d.entry1.isConnected,
            entry: !!view && !view.hidden,
            bars: sr.querySelectorAll('.bottombar').length,
        };
    });
    assert.ok(secondState.list && secondState.rows && secondState.hidden, 'moving to a second entry keeps the hidden list, rows and nodes');
    assert.ok(secondState.entryGone && secondState.entry, 'only the entry pane was drawn again');
    assert.equal(secondState.bars, 0, 'the book bar stays off the entry page');
    assert.equal(secondSnap.appRenders, 1, 'the second entry is one app render');
    assert.equal(secondSnap.rowMounts, 0, 'moving entries mounts no list rows');
    ok('moving to a second entry through the drawer replaces only the entry pane');

    // A title edit while the entry is open updates that row in place on Back; no list rows are mounted.
    const editedTitle = 'Retained while open';
    await page.evaluate(title => {
        window.wihero.library.change('Perf Big', d => { d.entries[window.__d.uid2].comment = title; }, { quiet: true });
        window.wihero.app.refresh();
    }, editedTitle);
    await page.waitForFunction(name => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return sr.querySelector('.main > .view[data-pane="entry"] .en h1')?.textContent === name;
    }, editedTitle, { timeout: 60000 });
    const beforeBack = await snapshot();
    await $('.en-top [aria-label="Up to the book"]').click();
    await page.waitForFunction(() => !window.__d.view.hidden, null, { timeout: 60000 });
    const editedSnap = await snapshot();
    const edited = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        const now = [...d.view.querySelectorAll('.item.ent')];
        return {
            view: sr.querySelector('.main > .view') === d.view,
            row: d.row2.isConnected && now.includes(d.row2),
            rows: now.length === d.rows2.length && now.every(r => d.rows2.includes(r)),
            title: d.row2.querySelector('.nm').textContent,
            scroll: d.view.scrollTop,
            focus: sr.activeElement === d.sw,
        };
    });
    assert.ok(edited.view && edited.row && edited.rows, 'Back keeps every row node, including the edited one');
    assert.equal(edited.title, editedTitle, 'the edited title updates the same row');
    assert.ok(Math.abs(edited.scroll - tagged.scroll) < 2, `the saved scrollTop is still restored (${tagged.scroll} → ${edited.scroll})`);
    assert.ok(edited.focus, 'the switch focused before the entry opened still has focus');
    assert.equal(editedSnap.appRenders - beforeBack.appRenders, 1, 'Back after the edit is one app render');
    assert.equal(editedSnap.rowMounts - beforeBack.rowMounts, 0, 'Back after the edit mounts no list rows');
    ok(`a title edit made while the entry was open updates the same row on Back with 0 new row mounts (${beforeBack.rowMounts} → ${editedSnap.rowMounts})`);

    // The list is now the live page again: scrolling it and refreshing keeps the new scroll (N1a's rule).
    const moved = await page.evaluate(() => {
        window.__d.view.scrollTop = 1800;
        return window.__d.view.scrollTop;
    });
    assert.ok(Math.abs(moved - 1800) < 2, 'the list scrolls after Back');
    await page.evaluate(() => window.wihero.app.refresh());
    const refreshed = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            view: sr.querySelector('.main > .view[data-pane="list"]') === window.__d.view,
            scroll: window.__d.view.scrollTop,
        };
    });
    assert.ok(refreshed.view, 'a refresh on the list keeps the same .view');
    assert.ok(Math.abs(refreshed.scroll - moved) < 2, `a refresh after scrolling keeps the new scrollTop (${moved} → ${refreshed.scroll})`);
    ok('a refresh on the list after Back keeps the scroll it has now');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
