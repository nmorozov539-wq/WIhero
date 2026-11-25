// Delegated desktop list and search gestures (N2b) in the browser harness (e2e/desktop/harness.html), no SillyTavern
// needed. At 1366 × 768 a Home row is opened by a tap, Ctrl-click, Enter and its right-click menu while the row node
// itself has no event listeners; a book moves to a folder by drag and the folder head folds; a book-list row selects,
// Ctrl/Shift-selects, opens on double-click, opens a background tab on middle-click and its menu on right-click, and
// rows reorder by drag. The desktop search overlay's rows and a phone search result are delegated too, the phone one
// keeping its 480 ms long press and prevented contextmenu. Every check uses CDP's DOMDebugger.getEventListeners to
// prove the row allocates nothing while its container holds the delegated set.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/delegate-desktop.mjs`; it uses only made-up harness data.
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

/** The event types on the shadow-root node matched by `selector`, through a CDP session for `page`. */
async function listenerTypes(cdp, selector) {
    const expression = `document.querySelector('#wihero-editor').shadowRoot.querySelector(${JSON.stringify(selector)})`;
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    assert.ok(result.objectId, `${selector} exists`);
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
    return listeners.map(l => l.type).sort();
}

/** Every delegated type on a container, with a readable failure. */
function expectTypes(types, want, where) {
    for (const t of want) assert.ok(types.includes(t), `${where} holds the delegated ${t} listener (${types.join(', ')})`);
}

async function open(width, height, mobile = false) {
    const page = await browser.newPage({ viewport: { width, height }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}

const page = await open(1366, 768);
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const wait = ms => page.waitForTimeout(ms);
const cdp = await page.context().newCDPSession(page);
const rowTitle = r => r.locator('.nm').textContent();
const paneTitle = () => page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.br .en h1')?.textContent ?? null);

try {
    // Home starts on tiles; its list view is where the `.drow` rows are.
    await $('.dhome .tile').first().waitFor();
    await $('button[aria-label="List"]').click();
    await $('.drow.dbook').first().waitFor();
    assert.equal(await $('.drow.dbook').count(), 7, 'the harness lists its seven books');

    const homeRow = '.drow.dbook[data-book="WIHero-Sample"]';
    assert.deepEqual(await listenerTypes(cdp, homeRow), [], 'a Home row allocates no listeners');
    const homeTypes = await listenerTypes(cdp, '.dhome');
    expectTypes(homeTypes, ['click', 'auxclick', 'mousedown', 'keydown', 'contextmenu', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop'], '.dhome');
    ok(`the Home row has no listeners and .dhome holds the delegated set (${homeTypes.length}: ${homeTypes.join(', ')})`);

    // A Ctrl-click opens a background tab and leaves Home where it is.
    const tabsBefore = await $('.tab').count();
    await $(homeRow).click({ modifiers: ['Control'] });
    await wait(80);
    assert.equal(await $('.tab').count(), tabsBefore + 1, 'Ctrl-click adds one tab');
    assert.equal(await $('.dhome').count(), 1, 'Home is still the page');
    assert.match(await $('.toast').textContent(), /opened in a new tab/);
    ok('a Ctrl-click on a Home row opens a background tab and stays on Home');

    // The right-click menu is the book's, not the browser's.
    await $('.drow.dbook[data-book="Moonlit Keep"]').click({ button: 'right' });
    await $('.sheet').last().waitFor();
    assert.match(await $('.sheet').last().textContent(), /Snapshots/);
    await page.keyboard.press('Escape');
    await wait(40);
    ok('a right-click on a Home row opens the book menu');

    // Enter opens the focused row; Space marks it in selection.
    await $('.drow.dbook[data-book="Sky Ruins"]').evaluate(n => n.focus());
    await page.keyboard.press('Enter');
    await $('.bkname2 b').filter({ hasText: 'Sky Ruins' }).waitFor();
    ok('Enter on a focused Home row opens the book');

    await $('.tab').first().click();
    await $('.dhome').waitFor();
    const oldNotes = $('.drow.dbook[data-book="Old Notes"]');
    await oldNotes.evaluate(n => n.focus());
    await page.keyboard.press(' ');
    await wait(50);
    assert.ok((await oldNotes.getAttribute('class')).includes('sel'), 'Space marks the row');
    await $('button[aria-label="Clear the selection"]').click();
    await wait(40);
    ok('Space on a focused Home row toggles selection');

    // A folder head folds and unfolds the same row set.
    const allRows = await $('.drow.dbook').count();
    await $('.dfolder[data-folder="Campaigns"]').click();
    await wait(50);
    assert.ok((await $('.drow.dbook').count()) < allRows, 'the folder folds its rows away');
    await $('.dfolder[data-folder="Campaigns"]').click();
    await wait(50);
    assert.equal(await $('.drow.dbook').count(), allRows, 'and unfolds them back');
    ok('a Home folder head folds and unfolds its books');

    // Drag a loose book onto the folder head: the book moves, the toast says so.
    await $('.drow.dbook[data-book="Harbor Town"]').dragTo($('.dfolder[data-folder="Campaigns"]'));
    await wait(150);
    assert.ok(await page.evaluate(() => wihero.settings.bookFolders.Campaigns.includes('Harbor Town')), 'the book is in Campaigns');
    assert.match(await $('.toast').textContent(), /Moved to Campaigns/);
    ok('dragging a Home row onto a folder head moves the book');

    // The book page's list is the other delegated surface.
    await $('.drow.dbook[data-book="WIHero-Sample"]').click();
    await $('.bllist .brow').first().waitFor();
    assert.deepEqual(await listenerTypes(cdp, '.bllist .brow'), [], 'a .brow allocates no listeners');
    const listTypes = await listenerTypes(cdp, '.bllist');
    expectTypes(listTypes, ['click', 'dblclick', 'auxclick', 'mousedown', 'contextmenu', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop', 'keydown'], '.bllist');
    ok(`the book-list row has no listeners and .bllist holds the delegated set (${listTypes.length}: ${listTypes.join(', ')})`);

    const rows = $('.bllist .brow');
    assert.ok((await rows.count()) > 4, 'the sample book has rows to work with');

    // Plain click selects, Ctrl adds, Shift extends; the same row nodes stay.
    const firstTitle = await rowTitle(rows.nth(0));
    await rows.nth(0).click();
    await page.waitForFunction(t => document.querySelector('#wihero-editor').shadowRoot.querySelector('.br .en h1')?.textContent === t, firstTitle);
    assert.ok((await rows.nth(0).getAttribute('class')).includes('on'), 'the row is on');
    await rows.nth(1).click({ modifiers: ['Control'] });
    await wait(50);
    assert.equal(await $('.bllist .brow.on').count(), 2, 'Ctrl-click selects a second row');
    await $('.br .bulk').waitFor();
    await rows.nth(3).click({ modifiers: ['Shift'] });
    await wait(50);
    assert.ok((await $('.bllist .brow.on').count()) >= 3, 'Shift-click extends the range');
    ok('a book-list row selects, Ctrl-click adds and Shift-click extends');

    // Double-click opens the entry in its own tab.
    await rows.nth(0).click();
    await wait(40);
    const tabsBeforeEntry = await $('.tab').count();
    await rows.nth(0).dblclick();
    await wait(120);
    assert.equal(await $('.tab').count(), tabsBeforeEntry + 1, 'double-click adds an entry tab');
    await $('.tab').filter({ hasText: 'WIHero-Sample' }).first().click();
    await $('.bllist .brow').first().waitFor();
    ok('double-click on a book-list row opens the entry in a new tab');

    // Right-click opens the entry menu; middle-click opens a background tab.
    await rows.nth(1).click({ button: 'right' });
    await $('.sheet').last().waitFor();
    assert.match(await $('.sheet').last().textContent(), /Open in new tab/);
    await page.keyboard.press('Escape');
    await wait(40);
    const tabsBeforeMiddle = await $('.tab').count();
    await rows.nth(2).click({ button: 'middle' });
    await wait(120);
    assert.equal(await $('.tab').count(), tabsBeforeMiddle + 1, 'middle-click adds one background tab');
    assert.match(await $('.toast').textContent(), /Opened in a new tab/);
    ok('a right-click opens the entry menu and a middle-click opens a background tab');

    // Drag to reorder: the row dropped above lands first; the Order parameter is untouched.
    await rows.nth(0).click();
    await wait(40);
    const names = await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent));
    await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 3 } });
    await wait(200);
    assert.equal(await rowTitle($('.bllist .brow').nth(0)), names[2], 'the dragged row is first');
    ok('dragging a book-list row reorders it');

    // A folder head on the book page folds, and takes a dropped row into its folder.
    await page.evaluate(book => {
        const b = (wihero.settings.books ??= {})[book] ??= { defaults: {}, folders: {} };
        (b.folderList ??= []).push('Test folder');
        wihero.app.refresh();
    }, 'WIHero-Sample');
    await $('.blfold').first().waitFor();
    const expanded = await $('.blfold .ft').first().getAttribute('aria-expanded');
    await $('.blfold .ft').first().click();
    await wait(50);
    assert.equal(await $('.blfold .ft').first().getAttribute('aria-expanded'), String(expanded !== 'true'), 'the folder folds');
    await $('.blfold .ft').first().click();
    await wait(50);
    await $('.bllist .brow').nth(1).dragTo($('.blfold').first());
    await wait(200);
    assert.ok(await page.evaluate(() => Object.values(wihero.settings.books['WIHero-Sample'].folders ?? {}).includes('Test folder')), 'the entry is in Test folder');
    assert.match(await $('.toast').textContent(), /Moved to Test folder/);
    ok('a book-list folder head folds and takes a dropped row');

    // Desktop search: rows resolve their hit from the live result list.
    await page.keyboard.press('Control+k');
    await $('.dsearch .dsbar input').waitFor();
    await $('.dsearch .dsbar input').fill('mill');
    await $('.dsres .dsr').first().waitFor();
    assert.deepEqual(await listenerTypes(cdp, '.dsres .dsr'), [], 'a search result allocates no listeners');
    const searchTypes = await listenerTypes(cdp, '.dsres');
    expectTypes(searchTypes, ['mousemove', 'click', 'auxclick'], '.dsres');
    ok(`the desktop search result has no listeners and .dsres holds the delegated set (${searchTypes.length}: ${searchTypes.join(', ')})`);

    // Hover moves the keyboard cursor; middle-click opens a background tab; a click opens and closes search.
    const results = $('.dsres .dsr');
    assert.ok((await results.count()) > 1, 'the search finds several rows');
    await results.nth(2).hover();
    await wait(40);
    assert.ok((await results.nth(2).getAttribute('class')).includes('at'), 'hover marks the row');
    const tabsBeforeSearch = await $('.tab').count();
    await results.nth(2).click({ button: 'middle' });
    await wait(100);
    assert.equal(await $('.tab').count(), tabsBeforeSearch + 1, 'a middle-click on a result adds a background tab');
    await $('.dsres .dsr').first().click();
    await wait(120);
    assert.equal(await $('.dsearch').count(), 0, 'a click resolves the hit and closes search');
    ok('desktop search results hover, middle-click and open, and search closes');

    // A phone search result keeps the 480 ms long press and the prevented contextmenu.
    const phone = await open(390, 844, true);
    const p$ = sel => phone.locator(`#wihero-editor ${sel}`);
    try {
        const pcdp = await phone.context().newCDPSession(phone);
        await p$('.bottombar button[aria-label="Search"]').click();
        await p$('.search input').waitFor();
        await p$('.search input').fill('road');
        await p$('.res .item').first().waitFor();
        assert.deepEqual(await listenerTypes(pcdp, '.res .item'), [], 'a phone search result allocates no listeners');
        const mainTypes = await listenerTypes(pcdp, '.main');
        expectTypes(mainTypes, ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'click', 'contextmenu'], '.main');
        ok(`the phone search result has no listeners and .main holds the delegated set (${mainTypes.length}: ${mainTypes.join(', ')})`);

        // Long press opens a background tab and swallows the click that ends it.
        const beforeLong = await p$('.tab').count();
        const box = await p$('.res .item').first().boundingBox();
        assert.ok(box, 'the result has a box');
        await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await phone.mouse.down();
        await wait(600);
        await phone.mouse.up();
        await wait(60);
        assert.equal(await p$('.tab').count(), beforeLong + 1, 'the long press adds one background tab');
        assert.equal(await p$('.search').count(), 1, 'the search stays open');
        assert.match(await p$('.toast').textContent(), /Opened in a background tab/);
        const prevented = await p$('.res .item').first().evaluate(n => {
            const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            n.dispatchEvent(ev);
            return ev.defaultPrevented;
        });
        assert.equal(prevented, true, 'the contextmenu is prevented where a long press exists');
        ok('a long press on a phone search result opens a background tab and contextmenu is prevented');

        // A tap opens in a new tab and leaves search.
        const beforeTap = await p$('.tab').count();
        await p$('.res .item').first().click();
        await wait(120);
        assert.equal(await p$('.tab').count(), beforeTap + 1, 'the tap adds a tab');
        assert.equal(await p$('.search').count(), 0, 'the phone search closes on a tap');
        ok('a tap on a phone search result opens it and closes search');
    } finally {
        await phone.close();
    }

    assert.deepEqual(errors, [], 'no errors in the pages');
    ok('no errors in the pages');
} finally {
    await page.close();
    await browser.close();
    server.close();
}
