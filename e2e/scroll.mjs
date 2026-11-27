// The scroll gate for the windowed long lists (G3) in the browser harness (e2e/desktop/harness.html), no SillyTavern
// needed. On the 1,000-entry "Perf Big" book, a phone `.view` and a desktop `.bllist` are wheeled, jumped 6,000 and
// 30,000 px, and read at the top, middle and bottom: the rows that belong there are mounted, the mounted count stays
// bounded, `scrollHeight` does not drift, no spacer is ever visible in the viewport (no blank rows), and Back on the
// phone returns the same list, row and scroll. The scroll frames also report `wihero.perf`'s windowing counters and
// assert that a scroll draw measures no node (`windowRectReads` 0) and needs no height correction
// (`windowRoChanged` 0) for the uniform row height. Rows, scroll and counters are measured-native-browser; no CPU
// throttle is applied (the 6× gate is `e2e/perf-harness.mjs`). Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/scroll.mjs`; it uses only made-up harness data.
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
const CAP = 250;

/** One surface: the phone `.view` or the desktop `.bllist`, its row class and its spacer prefix. */
const SURFACES = {
    phone: { host: '.view', row: '.item.ent', prefix: '.head, .bkchips, .offhint' },
    desk: { host: '.bllist', row: '.brow', prefix: '' },
};

async function makePage(viewport, extra) {
    const page = await browser.newPage({ viewport, ...extra });
    page.on('pageerror', e => errors.push(`${viewport.width}x${viewport.height}: ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${viewport.width}x${viewport.height}: ${m.text().slice(0, 300)}`);
    });
    return page;
}

/** The harness book's own order, so a mounted title can be checked against the row that should carry it. */
const expected = page => page.evaluate(() => {
    const data = window.wihero.library.peek('Perf Big');
    const shown = Object.values(data.entries).filter(e => !e.disable)
        .sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid) || a.uid - b.uid);
    return { uids: shown.map(e => e.uid), titles: shown.map(e => e.comment) };
});

/** The mounted window: rows, scroll extent, visible titles and whether a spacer is showing in the viewport. */
const stateOf = (page, kind) => page.evaluate(({ hostSel, rowSel, prefixSel }) => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const host = sr.querySelector(hostSel);
    const box = host.getBoundingClientRect();
    const top = box.top + host.clientTop;
    const bottom = top + host.clientHeight;
    const rows = [...host.querySelectorAll(`:scope > ${rowSel}`)];
    const gaps = [...host.querySelectorAll(':scope > .win-gap')];
    const gapShown = gaps.some(g => {
        const b = g.getBoundingClientRect();
        return b.height > 0 && b.bottom > top + 1 && b.top < bottom - 1;
    });
    // Rows that intersect the viewport must be contiguous; a hole means a blank strip between them. At the very top
    // the header/chips are legitimate content above the first row, and at the end the list's footer padding remains.
    const atEnd = host.scrollTop >= host.scrollHeight - host.clientHeight - 1;
    const onScreen = rows.map(r => r.getBoundingClientRect())
        .filter(b => b.height > 0 && b.bottom > top && b.top < bottom)
        .sort((a, b) => a.top - b.top);
    let hole = false;
    for (let i = 1; i < onScreen.length; i++) if (onScreen[i].top - onScreen[i - 1].bottom > 1) hole = true;
    if (onScreen.length && host.scrollTop > 1 && onScreen[0].top > top + 1) hole = true;
    if (onScreen.length && !atEnd && onScreen[onScreen.length - 1].bottom < bottom - 1) hole = true;
    const prefix = prefixSel ? [...host.querySelectorAll(`:scope > ${prefixSel}`)].reduce((h, n) => h + n.getBoundingClientRect().height, 0) : 0;
    return {
        rows: rows.length,
        scrollTop: host.scrollTop,
        scrollHeight: host.scrollHeight,
        clientHeight: host.clientHeight,
        max: host.scrollHeight - host.clientHeight,
        atEnd,
        prefix,
        gapShown,
        hole,
        titles: rows.map(r => r.querySelector('.nm')?.textContent ?? null),
        uids: rows.map(r => Number(r.dataset.uid)),
        rowH: rows.length ? Math.round(rows[0].getBoundingClientRect().height * 100) / 100 : 0,
    };
}, { hostSel: SURFACES[kind].host, rowSel: SURFACES[kind].row, prefixSel: SURFACES[kind].prefix });

const scrollTo = async (page, kind, y, settle = 140) => {
    await page.evaluate(({ hostSel, y }) => { document.querySelector('#wihero-editor').shadowRoot.querySelector(hostSel).scrollTop = y; }, { hostSel: SURFACES[kind].host, y });
    await page.waitForTimeout(settle);
};

/** One surface: mounted rows, no blank viewport, exact titles and a stable scroll extent. */
async function checkScroll(page, kind, book, label) {
    const open = await stateOf(page, kind);
    assert.ok(open.rows > 5 && open.rows < CAP, `${label}: a bounded window is mounted (${open.rows})`);
    assert.ok(open.scrollHeight > (kind === 'phone' ? 40000 : 25000), `${label}: the list spans the whole book (${open.scrollHeight}px)`);
    assert.equal(open.titles[0], book.titles[0], `${label}: the first row is the book's first entry`);
    assert.ok(!open.gapShown && !open.hole, `${label}: no spacer shows at the top`);
    const openHeight = open.scrollHeight;
    console.log(`# ${label}: ${open.rows} rows, ${open.scrollHeight}px scrollHeight, row ${open.rowH}px, prefix ${Math.round(open.prefix)}px`);

    // A normal wheel sweep: a servo of 10 × 600 px, 50 ms apart, as the 6× harness scrolls.
    await page.evaluate(() => window.wihero.perf.reset());
    const at = await page.evaluate(hostSel => {
        const b = document.querySelector('#wihero-editor').shadowRoot.querySelector(hostSel).getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, SURFACES[kind].host);
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(50); }
    await page.waitForTimeout(200);
    const wheeled = await stateOf(page, kind);
    const perf = await page.evaluate(() => window.wihero.perf.snapshot());
    assert.ok(wheeled.rows > 5 && wheeled.rows < CAP, `${label}: the wheel sweep stays bounded (${wheeled.rows})`);
    assert.ok(!wheeled.gapShown && !wheeled.hole, `${label}: the wheel sweep leaves no blank viewport`);
    assert.ok(wheeled.titles.every((t, i) => t === book.titles[book.uids.indexOf(wheeled.uids[i])]), `${label}: every wheeled title belongs to its row`);
    assert.ok(perf.windowDraws >= 5, `${label}: the wheel sweep drew the window (${perf.windowDraws} draws)`);
    assert.equal(perf.windowRectReads, 0, `${label}: a scroll draw measured no node (${perf.windowRectReads} rect reads)`);
    assert.equal(perf.windowRoChanged, 0, `${label}: no height correction was needed (${perf.windowRoChanged} changed)`);
    assert.ok(Math.abs(wheeled.scrollHeight - openHeight) <= 2, `${label}: scrollHeight stays put over the wheel sweep (${openHeight} → ${wheeled.scrollHeight})`);
    console.log(`# ${label} wheel: draws ${perf.windowDraws}, rows +${perf.windowRowsAdded}/-${perf.windowRowsRemoved}, scans ${perf.windowScanItems} items, rect reads ${perf.windowRectReads}, RO calls ${perf.windowRoCalls}, RO changes ${perf.windowRoChanged}, gap passes ${perf.windowGapPasses}`);

    // A fast fling: 12 × 800 px, 20 ms apart. Each scrolled frame must be materialized before it paints, so the
    // viewport never shows a spacer even though the window moves further than its overscan in the whole burst.
    for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(20);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const flung = await stateOf(page, kind);
        assert.ok(!flung.gapShown && !flung.hole, `${label}: the fling frame ${i + 1} has no blank viewport (${flung.scrollTop})`);
        assert.ok(flung.rows > 5 && flung.rows < CAP, `${label}: the fling frame ${i + 1} stays bounded (${flung.rows})`);
        assert.ok(flung.titles.every((t, j) => t === book.titles[book.uids.indexOf(flung.uids[j])]), `${label}: fling frame ${i + 1} titles belong to their rows`);
    }
    ok(`${label}: a 12 × 800 px fling never shows a blank viewport and stays bounded`);

    // Middle and bottom: the rows that belong there.
    const n = book.uids.length;
    const middleScroll = Math.floor(openHeight / 2);
    await scrollTo(page, kind, middleScroll);
    const middle = await stateOf(page, kind);
    const mid = Math.floor(n / 2);
    assert.ok(middle.uids.some(uid => Math.abs(book.uids.indexOf(uid) - mid) <= 30), `${label}: the middle window is around entry ${mid}`);
    assert.ok(middle.titles.includes(book.titles[mid]), `${label}: entry ${mid}'s title is mounted`);
    assert.ok(!middle.gapShown && !middle.hole, `${label}: the middle has no blank viewport`);
    assert.ok(middle.titles.every((t, i) => t === book.titles[book.uids.indexOf(middle.uids[i])]), `${label}: every middle title belongs to its row`);
    await scrollTo(page, kind, middle.max);
    const bottom = await stateOf(page, kind);
    assert.ok(bottom.scrollTop > middle.max - 2, `${label}: the list reaches the bottom (${bottom.scrollTop})`);
    assert.equal(bottom.titles.at(-1), book.titles.at(-1), `${label}: the last mounted row is the book's last entry`);
    assert.ok(bottom.rows > 5 && bottom.rows < CAP, `${label}: the bottom window stays bounded (${bottom.rows})`);
    assert.ok(!bottom.gapShown && !bottom.hole, `${label}: the bottom has no blank viewport`);
    assert.ok(Math.abs(bottom.scrollHeight - openHeight) <= 2, `${label}: scrollHeight is stable over top/middle/bottom (${openHeight} → ${bottom.scrollHeight})`);
    ok(`${label}: top/middle/bottom carry the right entries with ${open.rows}/${middle.rows}/${bottom.rows} rows and a stable ${openHeight}px scroll`);

    // A fast jump: the rows for that offset materialize in the next frame, with no spacer in the viewport.
    for (const y0 of [6000, kind === 'desk' ? 20000 : 30000]) {
        const y = Math.min(y0, bottom.max);
        await scrollTo(page, kind, y, 0);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const jump = await stateOf(page, kind);
        assert.ok(Math.abs(jump.scrollTop - y) < 2, `${label}: the ${y0} px jump lands (${jump.scrollTop})`);
        assert.ok(!jump.gapShown && !jump.hole, `${label}: the ${y0} px jump leaves no blank viewport`);
        assert.ok(jump.rows > 5 && jump.rows < CAP, `${label}: the ${y0} px jump stays bounded (${jump.rows})`);
        const rank = Math.floor((jump.scrollTop - jump.prefix) / (jump.rowH || 1));
        const first = jump.uids.map(uid => book.uids.indexOf(uid)).sort((a, b) => a - b)[0];
        // The window starts up to one overscan above the viewport; these bounds allow for that and for rounding.
        const overRows = Math.ceil((jump.clientHeight * 0.75) / (jump.rowH || 1)) + 3;
        assert.ok(first !== undefined && first <= rank + 3 && first >= rank - overRows, `${label}: the ${y0} px jump mounts entries around ${rank} (first ${first})`);
        assert.ok(jump.titles.every((t, i) => t === book.titles[book.uids.indexOf(jump.uids[i])]), `${label}: every title after the ${y0} px jump belongs to its row`);
        const expectedRank = Math.floor((y - jump.prefix) / (jump.rowH || 1));
        assert.ok(Math.abs(rank - expectedRank) <= 4, `${label}: the ${y0} px jump is deep in the book (rank ${rank})`);
        assert.ok(Math.abs(jump.scrollHeight - openHeight) <= 2, `${label}: scrollHeight survives the ${y0} px jump`);
        console.log(`# ${label} jump ${y0}: scrollTop ${jump.scrollTop}, first rank ${first}, viewport rank ${rank}, ${jump.rows} rows`);
    }
    ok(`${label}: 6,000 px and ${kind === 'desk' ? 20000 : 30000} px jumps materialize the right rows with no blank viewport`);

    await scrollTo(page, kind, 0);
    const backTop = await stateOf(page, kind);
    assert.equal(backTop.titles[0], book.titles[0], `${label}: returning to the top restores the first row`);
    assert.ok(Math.abs(backTop.scrollHeight - openHeight) <= 2, `${label}: scrollHeight is unchanged after the whole run`);
    return { openHeight, backTop };
}

try {
    // ---------------------------------------------------------------- phone
    const phone = await makePage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
    await phone.goto(BASE);
    await phone.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await phone.click('#wi-button');
    await phone.locator('#wihero-editor .tab').first().waitFor({ timeout: 60000 });
    await phone.evaluate(() => window.wihero.perf.reset());
    await phone.locator('#wihero-editor .item[data-book="Perf Big"]').click();
    await phone.locator('#wihero-editor .bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await phone.locator('#wihero-editor .view .item.ent').first().waitFor({ timeout: 60000 });
    await phone.waitForTimeout(200);
    const phoneBook = await expected(phone);
    const phoneRun = await checkScroll(phone, 'phone', phoneBook, 'phone');

    // Back from an entry at a deep, jumped position: the same view, row and scroll come back, still unblanked.
    await scrollTo(phone, 'phone', Math.min(30000, phoneRun.backTop.max));
    const deep = await stateOf(phone, 'phone');
    await phone.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.view');
        const box = view.getBoundingClientRect();
        const row = [...view.querySelectorAll('.item.ent')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 20 && b.bottom <= box.top + box.height - 20;
        });
        window.__deep = { view, row, uid: Number(row.dataset.uid), scroll: view.scrollTop };
        row.click();
    });
    await phone.locator('#wihero-editor .en h1').waitFor({ timeout: 60000 });
    await phone.locator('#wihero-editor .en-top [aria-label="Up to the book"]').click();
    await phone.waitForFunction(() => !window.__deep.view.hidden, null, { timeout: 60000 });
    await phone.waitForTimeout(160);
    const back = await phone.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__deep;
        return {
            sameView: sr.querySelector('.view') === d.view,
            sameRow: d.row.isConnected && d.view.contains(d.row),
            scroll: d.view.scrollTop,
            rows: d.view.querySelectorAll('.item.ent').length,
        };
    });
    assert.ok(back.sameView && back.sameRow, 'phone Back keeps the same list and the deep row node');
    assert.ok(Math.abs(back.scroll - deep.scrollTop) <= 2, `phone Back restores the deep scroll (${deep.scrollTop} → ${back.scroll})`);
    assert.ok(back.rows > 5 && back.rows < CAP, `phone Back keeps the window bounded (${back.rows})`);
    const backState = await stateOf(phone, 'phone');
    assert.ok(!backState.gapShown && !backState.hole, 'phone Back leaves no blank viewport');
    console.log(`# phone Back: scroll ${deep.scrollTop} → ${back.scroll}, ${back.rows} rows, same row ${back.sameRow}`);
    ok(`phone Back at ${deep.scrollTop}px restores the same view, row and scroll with no blank rows`);

    // ---------------------------------------------------------------- desktop
    const desk = await makePage({ width: 1366, height: 768 });
    await desk.goto(BASE);
    await desk.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await desk.click('#wi-button');
    await desk.locator('#wihero-editor .tab').first().waitFor({ timeout: 60000 });
    await desk.locator('#wihero-editor .dhome .tile').first().waitFor({ timeout: 60000 });
    await desk.evaluate(() => window.wihero.perf.reset());
    await desk.locator('#wihero-editor .tile').filter({ hasText: 'Perf Big' }).click();
    await desk.locator('#wihero-editor .bkname2 b').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await desk.locator('#wihero-editor .bllist .brow').first().waitFor({ timeout: 60000 });
    await desk.waitForTimeout(200);
    const deskBook = await expected(desk);
    const deskRun = await checkScroll(desk, 'desk', deskBook, 'desktop');

    // Desktop's "Back" is the right pane: clicking a row selects it, the list and its scroll stay put.
    const deskDeep = await scrollTo(desk, 'desk', Math.min(20000, deskRun.backTop.max)).then(() => stateOf(desk, 'desk'));
    const deskOpened = await desk.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const list = sr.querySelector('.bllist');
        const box = list.getBoundingClientRect();
        const row = [...list.querySelectorAll('.brow')].find(r => {
            const b = r.getBoundingClientRect();
            return b.top >= box.top + 20 && b.bottom <= box.top + box.height - 20;
        });
        window.__desk = { list, row, uid: Number(row.dataset.uid), scroll: list.scrollTop };
        row.click();
        return { uid: window.__desk.uid, scroll: window.__desk.scroll };
    });
    await desk.locator('#wihero-editor .br .view').first().waitFor({ timeout: 60000 });
    await desk.waitForTimeout(160);
    const deskBack = await desk.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const d = window.__desk;
        const list = sr.querySelector('.bllist');
        return {
            sameList: list === d.list,
            sameRow: d.row.isConnected && list.contains(d.row),
            scroll: list.scrollTop,
            rows: list.querySelectorAll('.brow').length,
            selected: d.row.classList.contains('on'),
        };
    });
    assert.ok(deskBack.sameList && deskBack.sameRow, 'desktop selection keeps the same .bllist and row node');
    assert.ok(Math.abs(deskBack.scroll - deskDeep.scrollTop) <= 2, `desktop selection keeps the deep scroll (${deskDeep.scrollTop} → ${deskBack.scroll})`);
    assert.ok(deskBack.selected, 'desktop selection marks the clicked row');
    assert.ok(deskBack.rows > 5 && deskBack.rows < CAP, `desktop selection keeps the window bounded (${deskBack.rows})`);
    const deskBackState = await stateOf(desk, 'desk');
    assert.ok(!deskBackState.gapShown && !deskBackState.hole, 'desktop selection leaves no blank viewport');
    console.log(`# desktop Back: scroll ${deskDeep.scrollTop} → ${deskBack.scroll}, ${deskBack.rows} rows, same row ${deskBack.sameRow}, selected ${deskBack.selected}`);
    ok(`desktop selection at ${deskDeep.scrollTop}px keeps the list, row and scroll`);

    assert.equal(errors.length, 0, `no page errors: ${errors.join('; ')}`);
    ok('no errors in either page');
} finally {
    await browser.close();
    server.close();
}
