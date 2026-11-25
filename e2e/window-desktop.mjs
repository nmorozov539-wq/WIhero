// The windowed desktop book list (N4b) in the browser harness (e2e/desktop/harness.html), no SillyTavern needed. At
// 1366 × 768 the 1,000-entry "Perf Big" book's `.bllist` mounts only a bounded window of `.brow` rows while its
// scrollHeight still covers the whole book. The test checks the top/middle/bottom windows against the book's own
// order, the `aria-setsize`/`aria-posinset` counters, Arrow Up/Down moving through the whole order while the selected
// row is outside the window, Ctrl/Shift selection, the N3a identity of the list and rows across selection and pane
// changes, a focused Order input staying mounted when the window scrolls away, a filter rebuilding and windowing the
// list, folder fold/unfold, drag reorder between visible rows, and a drop onto a visible folder head. Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/window-desktop.mjs`; it uses only made-up harness data.
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
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const wait = ms => page.waitForTimeout(ms);
const CAP = 250;

/** The mounted window: its size, scroll extent and the rows it carries. */
const windowState = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const list = sr.querySelector('.bllist');
    const rows = [...list.querySelectorAll('.brow')];
    return {
        rows: rows.length,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        titles: rows.map(r => r.querySelector('.nm')?.textContent ?? null),
        uids: rows.map(r => Number(r.dataset.uid)),
    };
});

/** The shown entries in the book's own order, so a mounted title can be checked against its row. */
const expected = () => page.evaluate(() => {
    const data = window.wihero.library.peek('Perf Big');
    const shown = Object.values(data.entries).filter(e => !e.disable)
        .sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid);
    return { uids: shown.map(e => e.uid), titles: shown.map(e => e.comment) };
});

/** Sets `.bllist.scrollTop` and gives the one-rAF window draw time to settle. */
const scrollTo = async top => {
    await page.evaluate(y => { document.querySelector('#wihero-editor').shadowRoot.querySelector('.bllist').scrollTop = y; }, top);
    await wait(140);
};

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.dhome .tile').first().waitFor({ timeout: 60000 });
    await page.evaluate(() => window.wihero.perf.reset());
    await $('.tile').filter({ hasText: 'Perf Big' }).click();
    await $('.bkname2 b').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.bllist .brow').first().waitFor({ timeout: 60000 });
    await wait(160);
    const book = await expected();
    const openSnap = await page.evaluate(() => window.wihero.perf.snapshot());

    // A bounded window, while the list still describes the whole book.
    let top = await windowState();
    assert.ok(top.rows > 10 && top.rows < CAP, `only a window of rows is mounted (${top.rows})`);
    assert.ok(top.scrollHeight > 25000, `the list spans the whole book (${top.scrollHeight}px for ${book.uids.length} entries)`);
    assert.equal(top.titles[0], book.titles[0], 'the first row is the book\'s first entry');
    assert.ok(openSnap.rowMounts < CAP, `opening the book mounted ${openSnap.rowMounts} rows, not 980`);
    const totalNodes = await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.bllist').querySelectorAll('*').length);
    console.log(`# mounted ${top.rows} rows, ${totalNodes} DOM nodes in the list; scrollHeight ${top.scrollHeight}px; open rowMounts ${openSnap.rowMounts}`);
    ok(`the desktop 1,000-entry book mounts ${top.rows} rows and still scrolls ${book.uids.length} entries`);

    // Bottom and middle: the right titles, and the window stays bounded.
    await scrollTo(top.scrollHeight);
    let bottom = await windowState();
    assert.ok(bottom.scrollTop > 25000, `the list scrolls deep (${bottom.scrollTop})`);
    assert.ok(bottom.rows > 10 && bottom.rows < CAP, `the bottom window stays bounded (${bottom.rows})`);
    assert.equal(bottom.titles.at(-1), book.titles.at(-1), 'the last mounted row is the book\'s last shown entry');
    ok(`the bottom shows "${book.titles.at(-1)}" with ${bottom.rows} rows mounted`);

    const middleRank = Math.floor(book.uids.length / 2);
    await scrollTo(Math.floor((bottom.scrollHeight - bottom.clientHeight) / 2));
    const middle = await windowState();
    assert.ok(middle.titles.includes(book.titles[middleRank]), 'the middle entry\'s title is mounted');
    assert.ok(middle.titles.every((title, i) => title === book.titles[book.uids.indexOf(middle.uids[i])]), 'every mounted title belongs to its row');
    assert.ok(middle.rows > 10 && middle.rows < CAP, `the middle window stays bounded (${middle.rows})`);
    ok(`the middle shows entry ${middleRank} ("${book.titles[middleRank]}") with every mounted title matching its row`);

    // The mounted rows still describe the whole list to assistive tech.
    await scrollTo(0);
    const aria = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const rows = [...list.querySelectorAll('.brow')];
        const row = rows.find(r => {
            const b = r.getBoundingClientRect(), box = list.getBoundingClientRect();
            return b.top >= box.top && b.bottom <= box.bottom;
        }) ?? rows[0];
        return {
            uid: Number(row.dataset.uid),
            setsize: row.getAttribute('aria-setsize'),
            posinset: row.getAttribute('aria-posinset'),
            role: row.getAttribute('role'),
            listRole: list.getAttribute('role'),
            listTabIndex: list.tabIndex,
        };
    });
    const ariaIndex = book.uids.indexOf(aria.uid);
    assert.equal(aria.listRole, 'listbox', 'the list keeps its listbox role');
    assert.equal(aria.listTabIndex, 0, 'the list is still focused as a whole');
    assert.equal(aria.role, 'option', 'a row is still an option');
    assert.equal(aria.setsize, String(book.uids.length), `aria-setsize is the whole visible order (${aria.setsize})`);
    assert.equal(aria.posinset, String(ariaIndex + 1), `aria-posinset is the row's place in it (${aria.posinset} vs ${ariaIndex + 1})`);
    ok(`a mounted row says ${aria.posinset} of ${aria.setsize} while the listbox stays focused as a whole`);

    // Arrow Down/Up move through the whole order even when the selected row is outside the mounted window.
    await $('.bllist .brow').first().click();
    await wait(60);
    const selectedUid = await page.evaluate(() => Number(document.querySelector('#wihero-editor').shadowRoot.querySelector('.bllist .brow.on').dataset.uid));
    assert.equal(selectedUid, book.uids[0], 'the first row is selected');
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        sr.querySelector('.bllist').focus({ preventScroll: true });
        sr.querySelector('.bllist').scrollTop = 20000;
    });
    await wait(160);
    let far = await windowState();
    assert.ok(!far.uids.includes(selectedUid), 'the selected row is outside the mounted window');
    await page.keyboard.press('ArrowDown');
    await wait(160);
    let afterKey = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const row = list.querySelector('.brow.on');
        const b = row?.getBoundingClientRect(), box = list.getBoundingClientRect();
        return {
            uid: row ? Number(row.dataset.uid) : null,
            mounted: !!row,
            visible: !!b && b.top >= box.top && b.bottom <= box.bottom,
            aria: row?.getAttribute('aria-selected') ?? null,
            scrollTop: list.scrollTop,
            rows: list.querySelectorAll('.brow').length,
        };
    });
    assert.equal(afterKey.uid, book.uids[1], 'Arrow Down moves to the next entry in the whole order');
    assert.ok(afterKey.mounted && afterKey.visible && afterKey.aria === 'true', 'the window brings the new row into view and marks it selected');
    assert.ok(afterKey.scrollTop < 20000, `the list scrolled back to the selected row (${afterKey.scrollTop})`);
    assert.ok(afterKey.rows < CAP, `the keyboard scroll keeps the window bounded (${afterKey.rows})`);
    await page.keyboard.press('ArrowUp');
    await wait(160);
    afterKey = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const row = list.querySelector('.brow.on');
        const b = row?.getBoundingClientRect(), box = list.getBoundingClientRect();
        return {
            uid: row ? Number(row.dataset.uid) : null,
            mounted: !!row,
            visible: !!b && b.top >= box.top && b.bottom <= box.bottom,
        };
    });
    assert.equal(afterKey.uid, book.uids[0], 'Arrow Up returns to the previous entry');
    assert.ok(afterKey.mounted && afterKey.visible, 'and that row is mounted and visible again');
    console.log(`# keyboard: selected row was unmounted at scrollTop 20000; Arrow Down ${book.uids[1]}, Arrow Up ${book.uids[0]}`);
    ok('Arrow Down/Up move through the whole order across unmounted rows and scroll the window with them');

    // A focused Order input keeps its row mounted when the window scrolls away, then releases it on blur.
    await page.evaluate(() => { window.wihero.settings.sortBy = 'prompt'; window.wihero.app.refresh(); });
    await wait(160);
    await scrollTo(0);
    const pin = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const row = list.querySelector('.brow');
        const input = row.querySelector('.ordin');
        input.focus({ preventScroll: true });
        window.__pin = { list, row, input };
        list.scrollTop = 6000;
        return { focused: sr.activeElement === input, uid: Number(row.dataset.uid) };
    });
    assert.ok(pin.focused, 'the Prompt-order input takes focus');
    await wait(200);
    const pinned = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__pin;
        return {
            focused: sr.activeElement === d.input,
            mounted: d.row.isConnected && d.list.contains(d.row),
            offscreen: d.row.getBoundingClientRect().bottom < d.list.getBoundingClientRect().top,
            rows: d.list.querySelectorAll('.brow').length,
        };
    });
    assert.ok(pinned.focused && pinned.mounted, 'the focused row stays mounted after the window scrolls away');
    assert.ok(pinned.offscreen, 'the pinned row really is outside the viewport');
    assert.ok(pinned.rows < CAP, `the pinned row does not remove the window bound (${pinned.rows})`);
    await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.activeElement.blur());
    await wait(160);
    const unpinned = await page.evaluate(() => {
        const d = window.__pin;
        return { mounted: d.row.isConnected, rows: d.list.querySelectorAll('.brow').length };
    });
    assert.ok(!unpinned.mounted, 'once focus leaves, the off-screen row is windowed out again');
    await page.evaluate(() => { window.wihero.settings.sortBy = 'order'; window.wihero.app.refresh(); });
    await wait(160);
    ok(`a focused Order input stays mounted outside the window (${pinned.rows} rows) and is released when focus leaves`);

    // Ctrl/Shift selection still works on mounted rows.
    await scrollTo(0);
    const rows = $('.bllist .brow');
    await rows.nth(0).click();
    await wait(50);
    await rows.nth(2).click({ modifiers: ['Control'] });
    await wait(50);
    let on = await page.evaluate(() => [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.bllist .brow.on')].map(r => Number(r.dataset.uid)));
    assert.equal(on.length, 2, 'Ctrl-click selects a second row');
    await rows.nth(4).click({ modifiers: ['Shift'] });
    await wait(50);
    on = await page.evaluate(() => [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.bllist .brow.on')].map(r => Number(r.dataset.uid)));
    assert.ok(on.length >= 3, `Shift-click extends the range (${on.length} rows)`);
    await page.keyboard.press('Escape');
    await wait(50);
    const leftSelection = await page.evaluate(() => [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.bllist .brow.on')].map(r => Number(r.dataset.uid)));
    assert.deepEqual(leftSelection, [book.uids[0]], 'Escape leaves the multi-selection, keeping the primary row');
    ok('a mounted row selects, Ctrl-click adds and Shift-click extends');

    // N3a still holds on the window: selection and Book settings keep the list and row nodes, and the scroll.
    await scrollTo(180);
    const tagged = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const box = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll('.brow')];
        const visible = rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= box.top + 10 && b.bottom <= box.bottom - 10; });
        const target = visible[1] ?? visible[0] ?? rows[0];
        window.__d = { list, row: rows[0], target, wrap: sr.querySelector('.bk'), pane: sr.querySelector('.br'), scroll: list.scrollTop, name: target.querySelector('.nm').textContent };
        return { uid: Number(target.dataset.uid), name: window.__d.name, scroll: window.__d.scroll, rows: rows.length };
    });
    await page.evaluate(() => window.__d.target.click());
    await page.waitForFunction(t => document.querySelector('#wihero-editor').shadowRoot.querySelector('.br .en h1')?.textContent === t, tagged.name, { timeout: 60000 });
    await wait(60);
    let identity = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        const rows = [...sr.querySelectorAll('.bllist .brow')];
        return {
            wrap: sr.querySelector('.bk') === d.wrap,
            list: sr.querySelector('.bllist') === d.list,
            row: rows[0] === d.row,
            scroll: d.list.scrollTop,
            pane: sr.querySelector('.br') === d.pane,
            title: sr.querySelector('.br .en h1')?.textContent,
        };
    });
    assert.ok(identity.wrap && identity.list && identity.row, 'selecting another entry keeps the wrap, list and row nodes');
    assert.ok(Math.abs(identity.scroll - tagged.scroll) < 2, `and the list's scrollTop (${tagged.scroll} → ${identity.scroll})`);
    assert.ok(identity.pane, 'the right pane column is kept');
    assert.equal(identity.title, tagged.name, 'and shows the clicked entry');
    await $('.blfoot button').filter({ hasText: 'Book settings' }).click();
    await $('.br .bset').waitFor({ timeout: 60000 });
    identity = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__d;
        return {
            wrap: sr.querySelector('.bk') === d.wrap,
            list: sr.querySelector('.bllist') === d.list,
            row: sr.querySelector('.bllist .brow') === d.row,
            scroll: d.list.scrollTop,
        };
    });
    assert.ok(identity.wrap && identity.list && identity.row, 'Book settings keeps the list and row nodes');
    assert.ok(Math.abs(identity.scroll - tagged.scroll) < 2, 'and the scroll');
    ok(`N3a on the window: the same list and row node across a selection and Book settings (${tagged.rows} rows mounted)`);

    // A refresh on the settled window keeps the same nodes and scroll, and mounts no rows.
    await scrollTo(600);
    const kept = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const row = [...list.querySelectorAll('.brow')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= list.getBoundingClientRect().top + 10 && b.bottom <= list.getBoundingClientRect().bottom - 10;
        }) ?? list.querySelector('.brow');
        window.__keep = { list, row, scroll: list.scrollTop };
        window.wihero.perf.reset();
        return { uid: Number(row.dataset.uid), scroll: window.__keep.scroll };
    });
    await page.evaluate(() => window.wihero.app.refresh());
    await wait(160);
    const keptAfter = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__keep;
        const list = sr.querySelector('.bllist');
        return {
            list: list === d.list,
            row: list.querySelector(`.brow[data-uid="${d.row.dataset.uid}"]`) === d.row,
            scroll: list.scrollTop,
            rows: list.querySelectorAll('.brow').length,
        };
    });
    const refreshSnap = await page.evaluate(() => window.wihero.perf.snapshot());
    assert.ok(keptAfter.list && keptAfter.row, 'a refresh keeps the list and the visible row node');
    assert.ok(Math.abs(keptAfter.scroll - kept.scroll) < 2, `and its scrollTop (${kept.scroll} → ${keptAfter.scroll})`);
    assert.ok(keptAfter.rows < CAP, `a refresh keeps the window bounded (${keptAfter.rows})`);
    assert.equal(refreshSnap.rowMounts, 0, 'a refresh on the settled window mounts no rows');
    console.log(`# refresh: rowMounts ${refreshSnap.rowMounts}, appRenders ${refreshSnap.appRenders}, ${keptAfter.rows} rows mounted`);
    ok(`a refresh keeps the window, its scrollTop and the row node with ${refreshSnap.rowMounts} new row mounts`);

    // Drag reorder between two visible rows (Order sort, displayIndex only).
    await $('.br [aria-label="Close Book settings"]').click();
    await wait(60);
    await scrollTo(0);
    const names = await $('.bllist .brow').evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent));
    const ordersBefore = await page.evaluate(() => Object.fromEntries(Object.values(window.wihero.library.peek('Perf Big').entries).map(e => [e.uid, e.order])));
    await $('.bllist .brow').nth(2).dragTo($('.bllist .brow').nth(0), { targetPosition: { x: 30, y: 3 } });
    await wait(250);
    const afterDrag = await windowState();
    assert.equal(afterDrag.titles[0], names[2], `"${names[2]}" is first after the drop`);
    assert.ok(afterDrag.rows < CAP, `the reordered window stays bounded (${afterDrag.rows})`);
    const ordersAfter = await page.evaluate(() => Object.fromEntries(Object.values(window.wihero.library.peek('Perf Big').entries).map(e => [e.uid, e.order])));
    assert.deepEqual(ordersAfter, ordersBefore, 'the Order parameter is untouched');
    ok('dragging one visible row above another reorders the windowed list');

    // Typing a filter rebuilds and windows the list; a later draw rebuilds the container as N3a always did.
    await $('.blfilter input').fill('Perf long');
    await wait(120);
    let filtered = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        return { rows: [...list.querySelectorAll('.brow')].map(r => r.querySelector('.nm').textContent) };
    });
    assert.equal(filtered.rows.length, 1, `the filter leaves one row (${filtered.rows.length})`);
    assert.match(filtered.rows[0], /Perf long/i, 'and it is the long entry');
    await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.__f = { list: sr.querySelector('.bllist') };
        sr.querySelector('.blfilter input').blur();
        window.wihero.app.refresh();
    });
    await wait(160);
    const rebuilt = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        return {
            same: list === window.__f.list,
            old: window.__f.list.isConnected,
            rows: [...list.querySelectorAll('.brow')].map(r => r.querySelector('.nm').textContent),
            value: sr.querySelector('.blfilter input').value,
        };
    });
    assert.ok(!rebuilt.same && !rebuilt.old, 'a draw after the filter change rebuilds the list container');
    assert.equal(rebuilt.value, 'Perf long', 'the filter keeps its text');
    assert.equal(rebuilt.rows.length, 1, 'and shows the one match');
    await $('.blfilter input').fill('');
    await wait(150);
    const cleared = await windowState();
    assert.ok(cleared.rows > 10 && cleared.rows < CAP, `clearing the filter returns a bounded window (${cleared.rows})`);
    console.log(`# filter: "Perf long" → ${filtered.rows.length} row; rebuilt → ${rebuilt.rows.length}; cleared → ${cleared.rows} rows`);
    ok('a filter rebuilds and windows the desktop list; clearing it returns the whole-book window');

    // Folders: a head folds the whole window away and unfolds it back; a drop on a visible head moves the entry.
    await page.evaluate(() => {
        const s = window.wihero.settings;
        const d = window.wihero.library.peek('Perf Big');
        const b = (s.books['Perf Big'] ??= { defaults: {}, folders: {} });
        b.folderList = ['Archive', 'Shelf'];
        b.folders = {};
        for (const e of Object.values(d.entries)) {
            const id = e.extensions?.wihero?.id;
            b.folders[id ? `id:${id}` : `uid:${e.uid}`] = 'Shelf';
        }
        // The filter box still has focus: a refresh while typing is deferred, so leave it first.
        document.querySelector('#wihero-editor').shadowRoot.activeElement?.blur?.();
        window.wihero.app.refresh();
    });
    await wait(200);
    await scrollTo(0);
    assert.equal(await $('.blfold').count(), 2, 'both folder heads are mounted');
    const shelf = await $('.blfold[data-folder="Shelf"] small').textContent();
    assert.equal(shelf, String(book.uids.length), `the Shelf head counts the whole book (${shelf})`);
    const openRows = (await windowState()).rows;
    assert.ok(openRows > 10 && openRows < CAP, `the folder window is bounded (${openRows})`);
    await $('.blfold[data-folder="Shelf"] .ft').click();
    await wait(120);
    assert.equal((await windowState()).rows, 0, 'folding the folder removes every entry row');
    assert.equal(await $('.blfold[data-folder="Shelf"] .ft').getAttribute('aria-expanded'), 'false', 'and says it is folded');
    await $('.blfold[data-folder="Shelf"] .ft').click();
    await wait(160);
    const unfolded = await windowState();
    assert.ok(unfolded.rows > 10 && unfolded.rows < CAP, `unfolding restores a bounded window (${unfolded.rows})`);
    ok(`a folder head folds and unfolds the windowed list (${openRows} → 0 → ${unfolded.rows} rows)`);

    await scrollTo(0);
    const dragUid = Number(await $('.bllist .brow').first().getAttribute('data-uid'));
    await $('.bllist .brow').first().dragTo($('.blfold[data-folder="Archive"]'));
    await wait(250);
    const dropped = await page.evaluate(uid => {
        const s = window.wihero.settings.books['Perf Big'];
        const e = window.wihero.library.peek('Perf Big').entries[uid];
        const id = e.extensions?.wihero?.id;
        return {
            folder: s.folders?.[id ? `id:${id}` : `uid:${uid}`] ?? null,
            archive: window.document.querySelector('#wihero-editor').shadowRoot.querySelector('.blfold[data-folder="Archive"] small')?.textContent ?? null,
            toast: window.document.querySelector('#wihero-editor').shadowRoot.querySelector('.toast')?.textContent ?? '',
            rows: window.document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.bllist .brow').length,
        };
    }, dragUid);
    assert.equal(dropped.folder, 'Archive', 'the dragged entry moved into Archive');
    assert.equal(dropped.archive, '1', 'the Archive head shows its one entry');
    assert.match(dropped.toast, /Moved to Archive/);
    assert.ok(dropped.rows < CAP, `the drop keeps the window bounded (${dropped.rows})`);
    ok(`a row can be dropped on a visible folder head (${dragUid} → Archive)`);

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
