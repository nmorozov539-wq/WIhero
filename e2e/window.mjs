// The windowed phone book list (N4a) in the browser harness (e2e/desktop/harness.html), no SillyTavern needed. At
// 390 × 844 on the 1,000-entry "Perf Big" book only a window of rows is mounted, while the `.view` still scrolls the
// whole book: the middle and bottom show the titles that belong there, a refresh and Back keep a row that stays in
// the window as the same node, a focused row stays mounted when the window moves away from it, select mode and a
// long press work on windowed rows, and a folder head still folds and unfolds. `wihero.perf.snapshot()` records the
// row mounts so the open/refresh/Back costs are printed with the measurements. Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/window.mjs`; it uses only made-up harness data.
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
const wait = ms => page.waitForTimeout(ms);
const CAP = 250;

/** The mounted window: its size, scroll extent and the titles it carries. */
const windowState = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const view = sr.querySelector('.view');
    const rows = [...view.querySelectorAll('.item.ent')];
    return {
        rows: rows.length,
        scrollTop: view.scrollTop,
        scrollHeight: view.scrollHeight,
        clientHeight: view.clientHeight,
        view,
        titles: rows.map(r => r.querySelector('.nm')?.textContent ?? null),
        uids: rows.map(r => Number(r.dataset.uid)),
    };
});

/** The shown entries in the book's own order, so a title can be checked against the row that should be there. */
const expected = () => page.evaluate(() => {
    const data = window.wihero.library.peek('Perf Big');
    const shown = Object.values(data.entries).filter(e => !e.disable)
        .sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid);
    return { uids: shown.map(e => e.uid), titles: shown.map(e => e.comment) };
});

/** Sets the list's scrollTop and gives the one-rAF window draw time to settle. */
const scrollTo = async top => {
    await page.evaluate(y => { document.querySelector('#wihero-editor').shadowRoot.querySelector('.view').scrollTop = y; }, top);
    await wait(120);
};

/** A real pointer down and up held past the 480 ms long press. */
async function hold(x, y) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await wait(600);
    await page.mouse.up();
    await wait(80);
}

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await page.evaluate(() => window.wihero.perf.reset());
    await $('.item[data-book="Perf Big"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    await wait(120);
    const book = await expected();
    const openSnap = await snapshot();

    // A bounded window, but the scrollbar still describes 980 shown entries.
    let top = await windowState();
    assert.ok(top.rows > 10 && top.rows < CAP, `only a window of rows is mounted (${top.rows})`);
    assert.ok(top.scrollHeight > 40000, `the view spans the whole book (${top.scrollHeight}px for ${book.uids.length} entries)`);
    assert.equal(top.titles[0], book.titles[0], 'the first row is the book\'s first entry');
    assert.ok(openSnap.rowMounts < CAP, `opening the book mounted ${openSnap.rowMounts} rows, not 980`);
    const totalNodes = await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.view').querySelectorAll('*').length);
    console.log(`# mounted ${top.rows} rows, ${totalNodes} DOM nodes in the view; scrollHeight ${top.scrollHeight}px; open rowMounts ${openSnap.rowMounts}`);
    ok(`the 1,000-entry book mounts ${top.rows} rows and still scrolls ${book.uids.length} entries`);

    // Bottom: the last entry is really there and the count stays bounded.
    await scrollTo(top.scrollHeight);
    let bottom = await windowState();
    assert.ok(bottom.scrollTop > 40000, `the list scrolls deep (${bottom.scrollTop})`);
    assert.ok(bottom.rows > 10 && bottom.rows < CAP, `the bottom window stays bounded (${bottom.rows})`);
    assert.equal(bottom.titles.at(-1), book.titles.at(-1), 'the last mounted row is the book\'s last shown entry');
    ok(`the bottom shows "${book.titles.at(-1)}" with ${bottom.rows} rows mounted`);

    // Middle: the window is around the middle entry, not the top or the bottom.
    const middleRank = Math.floor(book.uids.length / 2);
    const middleTop = Math.floor((bottom.scrollHeight - bottom.clientHeight) / 2);
    await scrollTo(middleTop);
    const middle = await windowState();
    const mountedRank = middle.uids.map(uid => book.uids.indexOf(uid));
    assert.ok(mountedRank.some(r => Math.abs(r - middleRank) <= 30), `the middle window is around entry ${middleRank}`);
    assert.ok(middle.titles.includes(book.titles[middleRank]), 'the middle entry\'s title is mounted');
    assert.ok(middle.titles.every((title, i) => title === book.titles[book.uids.indexOf(middle.uids[i])]), 'every mounted title belongs to its row');
    assert.ok(middle.rows > 10 && middle.rows < CAP, `the middle window stays bounded (${middle.rows})`);
    ok(`the middle shows entry ${middleRank} ("${book.titles[middleRank]}") with every mounted title matching its row`);

    // A row that remains visible across a refresh keeps its DOM node (N1a still applies inside the window).
    const kept = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const box = view.getBoundingClientRect();
        const row = [...view.querySelectorAll('.item.ent')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 20 && b.bottom <= box.bottom - 20;
        });
        window.__keep = { view, row, uid: Number(row.dataset.uid), scroll: view.scrollTop };
        return { uid: window.__keep.uid, scroll: window.__keep.scroll };
    });
    await page.evaluate(() => window.wihero.perf.reset());
    await page.evaluate(() => window.wihero.app.refresh());
    await wait(120);
    const afterRefresh = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__keep;
        const view = sr.querySelector('.view');
        return {
            view: view === d.view,
            row: view.querySelector(`.item.ent[data-uid="${d.uid}"]`) === d.row,
            scroll: view.scrollTop,
            rows: view.querySelectorAll('.item.ent').length,
        };
    });
    const refreshSnap = await snapshot();
    assert.ok(afterRefresh.view && afterRefresh.row, 'the visible row keeps its node under the same .view');
    assert.ok(Math.abs(afterRefresh.scroll - kept.scroll) < 2, `a refresh keeps scrollTop (${kept.scroll} → ${afterRefresh.scroll})`);
    assert.ok(afterRefresh.rows < CAP, `a refresh keeps the window bounded (${afterRefresh.rows})`);
    assert.equal(refreshSnap.rowMounts, 0, 'a refresh on the settled window mounts no rows');
    console.log(`# refresh: rowMounts ${refreshSnap.rowMounts}, appRenders ${refreshSnap.appRenders}, ${afterRefresh.rows} rows mounted`);
    ok(`a refresh keeps the window, its scrollTop and the row node with ${refreshSnap.rowMounts} new row mounts`);

    // Scrolling through the list adds rows only as they come into view; the count never runs away.
    const sweep = await page.evaluate(async () => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        let added = 0;
        const mo = new MutationObserver(ms => {
            for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('item')) added++;
        });
        mo.observe(view, { childList: true });
        const started = performance.now();
        const max = view.scrollHeight - view.clientHeight;
        for (let i = 1; i <= 12; i++) {
            view.scrollTop = Math.round(max * i / 12);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        mo.disconnect();
        return { added, ms: Math.round(performance.now() - started), rows: view.querySelectorAll('.item.ent').length };
    });
    assert.ok(sweep.rows < CAP, `the window stays bounded at the end of a scroll sweep (${sweep.rows})`);
    assert.ok(sweep.added < 1000, `a full scroll sweep mounts rows as they arrive (${sweep.added})`);
    console.log(`# scroll sweep: ${sweep.added} row nodes added, ${sweep.ms} ms over 12 double-rAF steps, ${sweep.rows} rows at the end`);
    ok(`scrolling the whole list keeps the window bounded (${sweep.added} rows mounted across 12 steps)`);

    // Deep entry, then Back: the same rows and scroll come back with the window recomputed.
    await scrollTo(bottom.scrollHeight);
    const deep = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const rows = [...view.querySelectorAll('.item.ent')];
        const row = rows.at(-1);
        window.__deep = { view, row, uid: Number(row.dataset.uid), scroll: view.scrollTop };
        window.wihero.perf.reset();
        return { uid: window.__deep.uid, scroll: window.__deep.scroll };
    });
    await page.evaluate(() => window.__deep.row.click());
    await $('.en h1').waitFor({ timeout: 60000 });
    const openEntrySnap = await snapshot();
    await $('.en-top [aria-label="Up to the book"]').click();
    await page.waitForFunction(() => !window.__deep.view.hidden, null, { timeout: 60000 });
    await wait(120);
    const back = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__deep;
        const view = sr.querySelector('.view');
        return {
            view: view === d.view,
            row: view.querySelector(`.item.ent[data-uid="${d.uid}"]`) === d.row,
            scroll: view.scrollTop,
            rows: view.querySelectorAll('.item.ent').length,
            title: d.row.querySelector('.nm')?.textContent ?? null,
        };
    });
    const backSnap = await snapshot();
    assert.ok(back.view && back.row, 'Back keeps the same .view and deep row node');
    assert.ok(Math.abs(back.scroll - deep.scroll) < 2, `Back restores the deep scroll (${deep.scroll} → ${back.scroll})`);
    assert.equal(back.title, book.titles.at(-1), 'Back has the window recomputed around the last entry');
    assert.ok(back.rows < CAP, `Back keeps the window bounded (${back.rows})`);
    assert.equal(backSnap.rowMounts - openEntrySnap.rowMounts, 0, 'Back mounts no rows for the same window');
    console.log(`# entry open rowMounts ${openEntrySnap.rowMounts}, Back rowMounts ${backSnap.rowMounts - openEntrySnap.rowMounts}, ${back.rows} rows mounted`);
    ok(`opening the last entry and coming Back restores its row, scroll and window with ${backSnap.rowMounts - openEntrySnap.rowMounts} new row mounts`);

    // A focused row stays mounted while the window scrolls away from it, until focus leaves it.
    await scrollTo(0);
    const focusPin = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const row = view.querySelector('.item.ent');
        const sw = row.querySelector('.switch');
        sw.focus({ preventScroll: true });
        window.__pin = { view, row, sw, uid: Number(row.dataset.uid) };
        return { focused: sr.activeElement === sw, uid: window.__pin.uid };
    });
    assert.ok(focusPin.focused, 'the first row\'s switch takes focus');
    await scrollTo(6000);
    await wait(120);
    const pinned = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__pin;
        const view = sr.querySelector('.view');
        return {
            focused: sr.activeElement === d.sw,
            mounted: d.row.isConnected && view.contains(d.row),
            offscreen: d.row.getBoundingClientRect().bottom < view.getBoundingClientRect().top,
            rows: view.querySelectorAll('.item.ent').length,
            scroll: view.scrollTop,
        };
    });
    assert.ok(pinned.focused && pinned.mounted, 'the focused row stays mounted after the window scrolls away');
    assert.ok(pinned.offscreen, 'the pinned row really is outside the viewport');
    assert.ok(pinned.rows < CAP, `the pinned row does not remove the window bound (${pinned.rows})`);
    await page.evaluate(() => window.wihero.app.refresh());
    await wait(120);
    const pinnedRefresh = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__pin;
        return {
            focused: sr.activeElement === d.sw,
            mounted: d.row.isConnected && d.view.contains(d.row),
            scroll: d.view.scrollTop,
        };
    });
    assert.ok(pinnedRefresh.focused && pinnedRefresh.mounted, 'a refresh keeps the focused off-screen row mounted and focused');
    assert.ok(Math.abs(pinnedRefresh.scroll - pinned.scroll) < 2, 'the pinned row does not move the scroll');
    await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.activeElement.blur());
    await wait(120);
    const unpinned = await page.evaluate(() => {
        const d = window.__pin;
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return { mounted: d.row.isConnected, rows: sr.querySelector('.view').querySelectorAll('.item.ent').length };
    });
    assert.ok(!unpinned.mounted, 'once focus leaves, the off-screen row is windowed out again');
    ok(`a focused row stays mounted outside the window (${pinned.rows} rows) and is released when focus leaves`);

    // Select mode and a long press still work on windowed rows.
    await scrollTo(3000);
    const selectRow = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const box = view.getBoundingClientRect();
        const row = [...view.querySelectorAll('.item.ent')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 20 && b.bottom <= box.bottom - 20;
        });
        window.__sel = { view, row, uid: Number(row.dataset.uid) };
        return { uid: window.__sel.uid };
    });
    await $('.bottombar button[aria-label="Select"]').click();
    await wait(80);
    await page.evaluate(() => window.__sel.row.click());
    await wait(80);
    const selected = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__sel;
        return {
            same: d.row.isConnected && sr.querySelector('.view').contains(d.row),
            sel: d.row.classList.contains('sel'),
            role: d.row.getAttribute('role'),
            aria: d.row.getAttribute('aria-checked'),
            rows: sr.querySelector('.view').querySelectorAll('.item.ent').length,
        };
    });
    assert.ok(selected.sel && selected.role === 'checkbox' && selected.aria === 'true', 'select mode marks the windowed row');
    assert.ok(selected.rows < CAP, `select mode keeps the window bounded (${selected.rows})`);
    ok(`select mode marks a windowed row (${selectRow.uid})`);
    await $('.selhead button[aria-label="Leave selection"]').click();
    await wait(80);

    const target = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const box = view.getBoundingClientRect();
        const row = [...view.querySelectorAll('.item.ent')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 20 && b.bottom <= box.bottom - 20 && !r.classList.contains('sel');
        });
        const b = row.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, tabs: sr.querySelectorAll('.tab').length };
    });
    await hold(target.x, target.y);
    const afterHold = await page.evaluate(() => ({
        tabs: document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.tab').length,
        book: !!document.querySelector('#wihero-editor').shadowRoot.querySelector('.bkname'),
    }));
    assert.equal(afterHold.tabs, target.tabs + 1, 'a long press on a windowed row opens a background tab');
    assert.ok(afterHold.book, 'the following click does not leave the book page');
    ok('a long press on a windowed row opens a background tab without opening the entry');

    // The variable-height sorts add the Order button or the size text to mounted rows; the window and scroll stay put.
    const beforeSorts = await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.view').scrollTop);
    for (const [sort, sel] of [['prompt', '.ordb'], ['size', '.tokn']]) {
        await page.evaluate(k => { window.wihero.settings.sortBy = k; window.wihero.app.refresh(); }, sort);
        await wait(150);
        const sorted = await page.evaluate(s => {
            const view = document.querySelector('#wihero-editor').shadowRoot.querySelector('.view');
            return {
                rows: view.querySelectorAll('.item.ent').length,
                extra: view.querySelectorAll(`.item.ent ${s}`).length,
                scroll: view.scrollTop,
                scrollHeight: view.scrollHeight,
            };
        }, sel);
        assert.ok(sorted.rows > 10 && sorted.rows < CAP, `${sort} keeps the window bounded (${sorted.rows})`);
        assert.ok(sorted.extra > 0, `${sort} draws its extra control on the mounted rows`);
        assert.ok(Math.abs(sorted.scroll - beforeSorts) < 2, `${sort} keeps the scroll (${beforeSorts} → ${sorted.scroll})`);
    }
    await page.evaluate(() => { window.wihero.settings.sortBy = 'order'; window.wihero.app.refresh(); });
    await wait(120);
    ok('the prompt-order and size sorts keep the window bounded and the scroll still');

    // A folder head still folds and unfolds a windowed list; the head keeps its node.
    await page.evaluate(() => {
        const s = window.wihero.settings;
        const d = window.wihero.library.peek('Perf Big');
        const folderList = (s.books['Perf Big'] ??= { defaults: {}, folders: {} });
        folderList.folders = {};
        for (const e of Object.values(d.entries)) {
            const id = e.extensions?.wihero?.id;
            folderList.folders[id ? `id:${id}` : `uid:${e.uid}`] = 'Shelf';
        }
        window.wihero.app.refresh();
    });
    await wait(150);
    await scrollTo(0);
    const folder = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const head = [...view.querySelectorAll('.section')].find(s => s.textContent.includes('Shelf'));
        window.__folder = { view, head };
        return { text: head?.textContent.trim() ?? null, expanded: head?.querySelector('button')?.getAttribute('aria-expanded'), rows: view.querySelectorAll('.item.ent').length };
    });
    assert.match(folder.text ?? '', /Shelf · 980/, 'the folder head is mounted with its count');
    assert.equal(folder.expanded, 'true', 'the folder starts open');
    assert.ok(folder.rows > 10 && folder.rows < CAP, `the folder's window is bounded (${folder.rows})`);
    await page.evaluate(() => window.__folder.head.querySelector('button').click());
    await wait(100);
    const folded = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const head = [...view.querySelectorAll('.section')].find(s => s.textContent.includes('Shelf'));
        return { same: head === window.__folder.head, expanded: head?.querySelector('button')?.getAttribute('aria-expanded'), rows: view.querySelectorAll('.item.ent').length };
    });
    assert.ok(folded.same && folded.expanded === 'false', 'folding keeps the same head node');
    assert.equal(folded.rows, 0, 'folding removes every entry row');
    await page.evaluate(() => window.__folder.head.querySelector('button').click());
    await wait(120);
    const unfolded = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const head = [...view.querySelectorAll('.section')].find(s => s.textContent.includes('Shelf'));
        return { same: head === window.__folder.head, expanded: head?.querySelector('button')?.getAttribute('aria-expanded'), rows: view.querySelectorAll('.item.ent').length };
    });
    assert.ok(unfolded.same && unfolded.expanded === 'true', 'unfolding keeps the same head node');
    assert.ok(unfolded.rows > 10 && unfolded.rows < CAP, `unfolding restores a bounded window (${unfolded.rows})`);
    ok(`a folder head folds and unfolds the windowed list (${folder.rows} → 0 → ${unfolded.rows} rows)`);

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
