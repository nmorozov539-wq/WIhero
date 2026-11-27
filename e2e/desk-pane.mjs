// The retained desktop book page (N3) in the browser harness (e2e/desktop/harness.html): no SillyTavern needed. At
// 1366 × 768, opening WIHero-Sample in Normal desktop keeps the book's wrap, left list, filter box and every row
// across an entry selection, Book settings and the way back; only the right pane is drawn again, and the selected
// row's on/aria follow. A filter change rebuilds the list on the next draw, as before. Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/desk-pane.mjs`.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;

// A static server for the repo: the harness loads src/ and examples/ by relative URLs.
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

async function open(w = 1366, h = 768) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);

/** Marks the book's wrap, list, rows, filter box and right pane for an identity check after the next draw. */
const tagBook = (page, scrollTo) => page.evaluate(top => {
    const root = document.querySelector('#wihero-editor').shadowRoot;
    const list = root.querySelector('.bk .bllist');
    list.scrollTop = top;
    const box = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('.brow')];
    const visible = rows.filter(r => {
        const b = r.getBoundingClientRect();
        return b.top >= box.top && b.bottom <= box.bottom;
    });
    const target = visible.find(r => !r.classList.contains('on')) ?? visible[0] ?? rows[0];
    const old = rows.find(r => r.classList.contains('on')) ?? null;
    window.__d = {
        wrap: root.querySelector('.bk'), bl: root.querySelector('.bl'), list,
        rows, filter: root.querySelector('.blfilter input'), pane: root.querySelector('.br'),
        entry: root.querySelector('.br .en'), scroll: list.scrollTop, target, old,
        targetName: target.querySelector('.nm').textContent,
    };
    return { scroll: list.scrollTop, rows: rows.length, visible: visible.length, targetUid: target.dataset.uid, targetName: window.__d.targetName, oldUid: old?.dataset.uid ?? null };
}, scrollTo);

/** The parts of the tagged book page still in place, and the rows' selection markup now. */
const bookState = page => page.evaluate(() => {
    const root = document.querySelector('#wihero-editor').shadowRoot;
    const d = window.__d;
    const rows = [...root.querySelectorAll('.bk .bllist .brow')];
    return {
        wrap: root.querySelector('.bk') === d.wrap,
        bl: root.querySelector('.bl') === d.bl,
        list: root.querySelector('.bllist') === d.list,
        filter: root.querySelector('.blfilter input') === d.filter,
        pane: root.querySelector('.br') === d.pane,
        entry: root.querySelector('.br .en') === d.entry,
        rows: rows.length === d.rows.length && rows.every((r, i) => r === d.rows[i]),
        scroll: d.list.scrollTop,
        targetOn: d.target.classList.contains('on'),
        targetAria: d.target.getAttribute('aria-selected'),
        oldOn: d.old ? d.old.classList.contains('on') : null,
        oldAria: d.old ? d.old.getAttribute('aria-selected') : null,
        title: root.querySelector('.br .en h1')?.textContent ?? null,
    };
});

const waitTitle = (page, title) => page.waitForFunction(name => {
    const root = document.querySelector('#wihero-editor').shadowRoot;
    return root.querySelector('.br .en h1')?.textContent === name;
}, title);

const page1 = await open();
try {
    await $(page1, '.tile').filter({ hasText: 'WIHero-Sample' }).click();
    await $(page1, '.brow').first().waitFor();
    // A first selection gives the right pane an entry to replace.
    await $(page1, '.brow').first().click();
    await $(page1, '.br .en h1').waitFor();

    // Scroll the list, then remember the list, every row and the selected row before choosing another entry.
    const first = await tagBook(page1, 180);
    assert.ok(first.visible > 1, `several rows are in view (${first.visible})`);
    assert.ok(first.oldUid !== null, 'a row is selected before the click');
    assert.notEqual(first.targetUid, first.oldUid, 'the clicked row is a different one');

    await page1.evaluate(() => window.__d.target.click());
    await waitTitle(page1, first.targetName);
    await page1.waitForTimeout(60);
    let state = await bookState(page1);
    assert.ok(state.wrap && state.bl && state.list && state.filter, 'the wrap, list and filter box survive a selection');
    assert.ok(state.rows, 'every row node survives a selection');
    assert.equal(state.scroll, first.scroll, 'the list keeps its scrollTop');
    assert.ok(state.pane, 'the right pane is the same column');
    assert.ok(!state.entry, 'only the right pane was drawn again');
    assert.equal(state.title, first.targetName);
    assert.ok(state.targetOn, 'the clicked row is on');
    assert.equal(state.targetAria, 'true', 'and says it is selected');
    assert.ok(!state.oldOn, 'the row that was selected is off');
    assert.equal(state.oldAria, 'false', 'and says it is not selected');
    ok('selecting another entry keeps the wrap, list, rows, filter box and scroll; only the right pane changes');

    // Book settings swaps the right pane and leaves the left list alone.
    await $(page1, '.blfoot button').filter({ hasText: 'Book settings' }).click();
    await $(page1, '.br .bset').waitFor();
    state = await bookState(page1);
    assert.ok(state.wrap && state.bl && state.list && state.rows, 'Book settings keeps the left list and rows');
    assert.equal(state.scroll, first.scroll, 'Book settings keeps the scrollTop');
    assert.ok(state.pane, 'the right pane column is kept');
    ok('Book settings keeps the left list, rows and scroll');

    // Closing it brings back an entry, still on the same list.
    await $(page1, '.br [aria-label="Close Book settings"]').click();
    await waitTitle(page1, first.targetName);
    state = await bookState(page1);
    assert.ok(state.wrap && state.bl && state.list && state.rows, 'the way back to an entry keeps the left list and rows');
    assert.equal(state.scroll, first.scroll, 'and the scrollTop');
    assert.ok(!state.entry, 'the entry pane was drawn again');
    ok('the way back to an entry keeps the left list, rows and scroll');

    // Ctrl-click enters multi-select through the same kept rows; a plain click leaves it on the same nodes.
    const multi = await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        const list = root.querySelector('.bllist');
        const box = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll('.brow')];
        const visible = r => { const b = r.getBoundingClientRect(); return b.top >= box.top && b.bottom <= box.bottom; };
        const row = rows.find(r => !r.classList.contains('on') && visible(r)) ?? rows.find(r => !r.classList.contains('on'));
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        return { uid: row.dataset.uid };
    });
    let multiState = await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        const rows = [...root.querySelectorAll('.bllist .brow')];
        return {
            list: root.querySelector('.bllist') === window.__d.list,
            rows: rows.length === window.__d.rows.length && rows.every((r, i) => r === window.__d.rows[i]),
            on: rows.filter(r => r.classList.contains('on')).map(r => ({ uid: r.dataset.uid, aria: r.getAttribute('aria-selected') })),
            bulk: !!root.querySelector('.br .bulk'),
        };
    });
    assert.ok(multiState.list && multiState.rows, 'multi-select keeps the list and rows');
    assert.equal(multiState.on.length, 2, 'two rows are on');
    assert.ok(multiState.on.every(r => r.aria === 'true'), 'and both say they are selected');
    assert.ok(multiState.on.some(r => r.uid === multi.uid), 'the Ctrl-clicked row is one of them');
    assert.ok(multiState.bulk, 'the right pane shows the bulk pane');

    const plainName = await page1.evaluate(uid => {
        const row = window.__d.rows.find(r => r.dataset.uid === uid);
        row.click();
        return row.querySelector('.nm').textContent;
    }, multi.uid);
    await waitTitle(page1, plainName);
    await page1.waitForTimeout(40);
    multiState = await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        const rows = [...root.querySelectorAll('.bllist .brow')];
        return {
            list: root.querySelector('.bllist') === window.__d.list,
            rows: rows.length === window.__d.rows.length && rows.every((r, i) => r === window.__d.rows[i]),
            on: rows.filter(r => r.classList.contains('on')).map(r => r.dataset.uid),
            scroll: window.__d.list.scrollTop,
        };
    });
    assert.ok(multiState.list && multiState.rows, 'leaving multi-select keeps the list and rows');
    assert.equal(multiState.on.length, 1, 'only the clicked row is on');
    assert.equal(multiState.scroll, first.scroll, 'and the scrollTop is still there');
    ok('multi-select and back to one entry keep the same list and rows');

    // Filter text is a list input: after it changes, the next draw rebuilds the list (rows and container).
    await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        window.__f = { list: root.querySelector('.bllist'), rows: [...root.querySelectorAll('.bllist .brow')] };
    });
    await $(page1, '.blfilter input').fill('Mill');
    await page1.waitForTimeout(50);
    assert.ok(await page1.evaluate(() => [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.bllist .brow')].length < window.__f.rows.length), 'the filter rebuilds the rows at once');
    const filtered = await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        return {
            list: root.querySelector('.bllist') === window.__f.list,
            rows: [...root.querySelectorAll('.bllist .brow')].map(r => r.querySelector('.nm').textContent),
            value: root.querySelector('.blfilter input').value,
        };
    });
    assert.ok(filtered.list, 'typing in the filter keeps the list box');
    assert.equal(filtered.value, 'Mill');
    assert.ok(filtered.rows.length > 0 && filtered.rows.every(t => /mill/i.test(t)), 'the rows match the filter');

    await page1.evaluate(() => {
        const input = document.querySelector('#wihero-editor').shadowRoot.querySelector('.blfilter input');
        input.blur();
        wihero.app.refresh();
    });
    await page1.waitForTimeout(80);
    const rebuilt = await page1.evaluate(() => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        const list = root.querySelector('.bllist');
        return {
            oldList: window.__f.list.isConnected,
            sameList: list === window.__f.list,
            rows: [...list.querySelectorAll('.brow')].map(r => r.querySelector('.nm').textContent),
            value: root.querySelector('.blfilter input').value,
        };
    });
    assert.ok(!rebuilt.sameList && !rebuilt.oldList, 'a draw after the filter change rebuilds the list');
    assert.equal(rebuilt.value, 'Mill', 'the filter keeps its text');
    assert.ok(rebuilt.rows.length > 0 && rebuilt.rows.every(t => /mill/i.test(t)), 'and shows the same matches');
    ok('a filter change rebuilds the list on the next draw');

    // A narrow drawer swaps the list and the entry with wrap classes; the kept list and rows survive both ways.
    const page2 = await open(1200, 800);
    try {
        await $(page2, '.tile').filter({ hasText: 'WIHero-Sample' }).click();
        await $(page2, '.brow').first().waitFor();
        const narrowState = () => page2.evaluate(() => {
            const root = document.querySelector('#wihero-editor').shadowRoot;
            const list = root.querySelector('.bllist');
            const rows = [...list.querySelectorAll('.brow')];
            return {
                list: root.querySelector('.bllist') === window.__n.list,
                rows: rows.length === window.__n.rows.length && rows.every((r, i) => r === window.__n.rows[i]),
                wrap: root.querySelector('.bk') === window.__n.wrap,
                narrow: window.__n.wrap.classList.contains('narrow'),
                lpage: window.__n.wrap.classList.contains('lpage'),
                title: root.querySelector('.br .en h1')?.textContent ?? null,
            };
        });
        await page2.evaluate(() => {
            const root = document.querySelector('#wihero-editor').shadowRoot;
            const list = root.querySelector('.bllist');
            window.__n = { wrap: root.querySelector('.bk'), list, rows: [...list.querySelectorAll('.brow')] };
        });
        let narrow = await narrowState();
        assert.ok(narrow.narrow && narrow.lpage, 'the 600px drawer opens on the list');
        const firstName = await $(page2, '.brow .nm').first().textContent();
        await $(page2, '.brow').first().click();
        await waitTitle(page2, firstName);
        await page2.waitForTimeout(40);
        narrow = await narrowState();
        assert.ok(narrow.list && narrow.rows && narrow.wrap, 'selecting keeps the list and rows');
        assert.ok(!narrow.lpage, 'the entry fills the drawer');
        await $(page2, '.br [aria-label="Back to the entries"]').click();
        await page2.waitForTimeout(40);
        narrow = await narrowState();
        assert.ok(narrow.list && narrow.rows && narrow.wrap, 'the way back keeps the list and rows');
        assert.ok(narrow.lpage, 'and the list fills the drawer again');
        ok('a narrow drawer keeps the list and rows while an entry and the way back swap the panes');
    } finally {
        await page2.close();
    }

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await page1.close();
    await browser.close();
    server.close();
}
