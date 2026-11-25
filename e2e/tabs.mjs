// Keyed tab rows (V3a) in the browser harness (e2e/desktop/harness.html): no SillyTavern needed. A draw keeps a
// tab's node and listeners instead of clearing the strip, so refreshing twice, opening and closing another tab,
// switching tabs and books, and going into an entry and Back all keep the nodes that survive. Covers Hero on a
// phone, Normal mode's tab row on a phone, and desktop's tab row and .tright. Run `node e2e/tabs.mjs`.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = new URL('./log/', import.meta.url).pathname;
fs.mkdirSync(LOG, { recursive: true });

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

async function open(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const wait = (page, ms) => page.waitForTimeout(ms);

/** Keeps a tab row node on the page's window under `name`; returning it across evaluate would lose its identity. */
const tag = (page, name, sel) => page.evaluate(([name, sel]) => {
    window[name] = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return !!window[name];
}, [name, sel]);

/** Whether every node kept in window[name] is still in the tab row, and whether the row has no new nodes. */
const kept = (page, name) => page.evaluate(name => {
    const now = [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.tab')];
    return window[name].every(n => n.isConnected && now.includes(n));
}, name);
const isSame = (page, name) => page.evaluate(name => {
    const n = window[name];
    return !!n && n.isConnected && n.getRootNode()?.host?.id === 'wihero-editor';
}, name);
const activeIs = (page, name) => page.evaluate(name => window[name].classList.contains('active'), name);
const textOf = (page, name, sel = '.name') => page.evaluate(([name, sel]) => window[name].querySelector(sel)?.textContent ?? '', [name, sel]);
const dotOf = (page, name) => page.evaluate(name => {
    const d = window[name].querySelector('.sd');
    return d ? d.style.background : null;
}, name);
const tagAllTabs = (page, name) => page.evaluate(name => {
    window[name] = [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.tab')];
    return window[name].length;
}, name);

async function heroPhone() {
    const page = await open(390, 844);
    await page.evaluate(() => {
        const S = wihero.app.state;
        S.mode = 'hero';
        S.hero.book = 'WIHero-Sample';
        wihero.app.refresh();
    });
    await $(page, '.vp .card').first().waitFor();
    assert.equal(await $(page, '.tab.fixed').count(), 2, 'Hero starts with Canvas and Preview');
    await tag(page, '__canvas', '.tab[aria-label="Canvas"]');
    await tag(page, '__preview', '.tab[aria-label="Preview"]');
    assert.equal(await tagAllTabs(page, '__first'), 2);

    // Open an entry in a tab from the panel, and remember its node, label and strategy dot.
    await $(page, '.panelBtn[aria-label="Entries"]').click();
    await $(page, '.panel .prow .nm').first().waitFor();
    await $(page, '.panel .prow').filter({ hasText: 'Mill: arrival' }).locator('.nm').click();
    await $(page, '.tab.active .name').filter({ hasText: 'Mill: arrival' }).waitFor();
    await tag(page, '__entry', '.tab.active');
    const label = await textOf(page, '__entry');
    const dot = await dotOf(page, '__entry');
    assert.equal(label, 'Mill: arrival');
    assert.ok(dot, 'the entry tab has a strategy dot');

    // Two plain draws keep every node, its listener, its label and its dot.
    await page.evaluate(() => { wihero.app.refresh(); wihero.app.refresh(); });
    await wait(page, 40);
    assert.ok(await kept(page, '__first'), 'refresh keeps the fixed tabs');
    assert.ok(await isSame(page, '__entry') && await activeIs(page, '__entry'), 'refresh keeps the entry tab, still active');
    assert.equal(await textOf(page, '__entry'), label, 'the label is unchanged');
    assert.equal(await dotOf(page, '__entry'), dot, 'the strategy dot is unchanged');

    // Preview and Canvas are the same nodes after switching away and back.
    await $(page, '.tab[aria-label="Preview"]').click();
    assert.ok(await isSame(page, '__preview') && await activeIs(page, '__preview'), 'Preview keeps its node and becomes active');
    assert.ok(!await activeIs(page, '__entry'), 'the entry tab is no longer active');
    await $(page, '.tab[aria-label="Canvas"]').click();
    assert.ok(await isSame(page, '__canvas') && await activeIs(page, '__canvas'), 'Canvas keeps its node and becomes active again');
    assert.ok(await isSame(page, '__entry'), 'the entry tab survives the switches');

    // A second entry tab appears while every older node stays put.
    assert.equal(await tagAllTabs(page, '__beforeSecond'), 3);
    await $(page, '.panelBtn[aria-label="Entries"]').click();
    await $(page, '.panel .prow .nm').first().waitFor();
    await $(page, '.panel .prow').filter({ hasText: 'Road: leaving' }).locator('.nm').click();
    await $(page, '.tab.active .name').filter({ hasText: 'Road: leaving' }).waitFor();
    assert.ok(await kept(page, '__beforeSecond'), 'opening a second entry tab keeps the existing nodes');
    assert.equal(await $(page, '.tab').count(), 4, 'and adds one');
    await tag(page, '__second', '.tab.active');

    // Closing it puts the first entry tab back, with the same node and listener.
    await $(page, '.tab.active .x').click();
    assert.ok(await isSame(page, '__entry') && await activeIs(page, '__entry'), 'closing the second tab keeps and reactivates the first');
    assert.equal(await $(page, '.tab').count(), 3);

    // A rename updates the retained tab's label and tooltip in place.
    await page.evaluate(() => {
        wihero.library.change('WIHero-Sample', d => { d.entries[1].comment = 'Mill: arrival renamed'; }, { quiet: true });
        wihero.app.refresh();
    });
    assert.ok(await isSame(page, '__entry'), 'the renamed tab is the same node');
    assert.equal(await textOf(page, '__entry'), 'Mill: arrival renamed', 'the label updates in place');
    assert.equal(await dotOf(page, '__entry'), dot, 'the dot still matches');

    await page.close();
    ok('Hero phone: refresh, entry tabs, tab switches, close and rename keep the surviving tab nodes');
}

async function normalPhone() {
    const page = await open(390, 844);
    await $(page, '.item').filter({ hasText: 'WIHero-Sample' }).click();
    await $(page, '.item.ent').first().waitFor();
    await tag(page, '__home', '.tab.fixed');
    await tag(page, '__book', '.tab:not(.fixed)');
    assert.equal(await textOf(page, '__book'), 'WIHero-Sample');
    assert.equal(await tagAllTabs(page, '__first'), 2);

    // Into an entry: the book tab keeps its node and takes the entry's label.
    await $(page, '.item.ent').filter({ hasText: 'Mill: arrival' }).first().click();
    await wait(page, 40);
    assert.ok(await isSame(page, '__book') && await activeIs(page, '__book'), 'the book tab keeps its node when an entry opens in it');
    assert.equal(await textOf(page, '__book'), 'Mill: arrival', 'its label follows the page');
    assert.ok(await isSame(page, '__home'), 'Home keeps its node');

    // Back (Escape is Back on a phone) returns to the book, still on the same node.
    await page.keyboard.press('Escape');
    await wait(page, 40);
    assert.ok(await isSame(page, '__book'), 'Back returns to the same book tab node');
    assert.equal(await textOf(page, '__book'), 'WIHero-Sample', 'and the label follows back');
    assert.ok(await isSame(page, '__home'));

    // Another book gets a new tab; the first book tab and Home stay.
    await $(page, '.tab.fixed').click();
    await $(page, '.item').filter({ hasText: 'Moonlit Keep' }).click();
    await $(page, '.item.ent').first().waitFor();
    assert.ok(await isSame(page, '__book'), 'opening a second book keeps the first book tab');
    assert.ok(await isSame(page, '__home'), 'and Home');
    assert.equal(await $(page, '.tab').count(), 3);
    assert.equal(await $(page, '.tab.active .name').textContent(), 'Moonlit Keep');
    // Clicking the older tab node brings it back with the same node and label.
    await page.evaluate(() => window.__book.click());
    await wait(page, 40);
    assert.ok(await isSame(page, '__book') && await activeIs(page, '__book'), 'the older book tab is still the same node');
    assert.equal(await textOf(page, '__book'), 'WIHero-Sample');

    await page.close();
    ok('Normal phone: a book, an entry and Back keep tab nodes; a second book adds one and switches back');
}

async function heroDesktop() {
    const page = await open(1366, 768);
    await page.evaluate(() => {
        const S = wihero.app.state;
        S.mode = 'hero';
        S.hero.book = 'WIHero-Sample';
        wihero.app.refresh();
    });
    await $(page, '.vp .card').first().waitFor();
    await tag(page, '__canvas', '.tab[aria-label="Canvas"]');
    await tag(page, '__search', '.tright .tsearch');
    await tag(page, '__explain', '.tright .explainq');
    await tag(page, '__widen', '.tright .iconbtn[aria-label="Drawer size"]');
    assert.equal(await $(page, '.tright .tbook').count(), 0, 'the book picker is not needed on the canvas with the list open');

    // An entry tab from the list: its tab and the book picker it brings in.
    await $(page, '.panel.dock .prow').filter({ hasText: 'Mill: arrival' }).dblclick();
    await $(page, '.tab.active .name').filter({ hasText: 'Mill: arrival' }).waitFor();
    await tag(page, '__entry', '.tab.active');
    await tag(page, '__book', '.tright .tbook');
    assert.ok(await isSame(page, '__canvas') && await isSame(page, '__search'), 'the fixed tab and .tright survive opening an entry tab');
    assert.equal(await page.evaluate(() => window.__book.querySelector('span').textContent), 'WIHero-Sample');

    // Two draws keep the Hero tab row and all of .tright, the book picker included.
    await page.evaluate(() => { wihero.app.refresh(); wihero.app.refresh(); });
    await wait(page, 40);
    assert.ok(await isSame(page, '__entry') && await activeIs(page, '__entry'), 'the entry tab and its active class survive two draws');
    assert.ok(await isSame(page, '__search') && await isSame(page, '__explain') && await isSame(page, '__widen'), 'Search, Explain and Widen are the same nodes');
    assert.ok(await isSame(page, '__book'), 'the book picker is the same node');

    // Drawer size updates the retained Widen button in place.
    await $(page, '.tright .iconbtn[aria-label="Drawer size"]').click();
    await wait(page, 40);
    assert.ok(await isSame(page, '__widen'), 'Drawer size keeps the Widen node');
    assert.equal(await page.evaluate(() => window.__widen.getAttribute('aria-label')), 'Widen');
    assert.equal(await page.evaluate(() => wihero.settings.desk.heroWide), false, 'Drawer size is remembered');

    await page.close();
    ok('Hero desktop: the tab row and .tright (Search, Explain, Widen, book picker) keep their nodes');
}

async function desktop() {
    const page = await open(1366, 768);
    await $(page, '.tile').filter({ hasText: 'WIHero-Sample' }).click();
    await $(page, '.brow').first().waitFor();
    await tag(page, '__home', '.tab.fixed');
    await tag(page, '__book', '.tab:not(.fixed)');
    await tag(page, '__search', '.tright .tsearch');
    await tag(page, '__widen', '.tright .iconbtn');
    assert.equal(await tagAllTabs(page, '__first'), 2);

    // A single click shows an entry in the book's tab: same node, same book label.
    await $(page, '.brow').filter({ hasText: 'Mill: arrival' }).click();
    await $(page, '.en-line').waitFor();
    assert.ok(await isSame(page, '__book') && await activeIs(page, '__book'), 'showing an entry keeps the book tab node');
    assert.equal(await textOf(page, '__book'), 'WIHero-Sample', 'a book tab stays named for its book');

    // A double-click opens a tab of its own; the older nodes stay.
    await $(page, '.brow').filter({ hasText: 'Mill: arrival' }).dblclick();
    await $(page, '.tab.active .name').filter({ hasText: 'Mill: arrival' }).waitFor();
    assert.ok(await kept(page, '__first'), 'the entry tab is added beside the same tab nodes');
    assert.equal(await $(page, '.tab').count(), 3);
    await tag(page, '__entry', '.tab.active');
    await tag(page, '__searchBefore', '.tright .tsearch');
    assert.ok(await isSame(page, '__search') && await isSame(page, '__widen'), 'the .tright buttons are the same nodes');
    assert.ok(await page.evaluate(() => window.__search === window.__searchBefore), 'the search button was not rebuilt');

    // Closing the entry tab keeps the book tab's node and its active class.
    await $(page, '.tab.active .x').click();
    assert.ok(await isSame(page, '__book') && await activeIs(page, '__book'), 'closing the entry tab reactivates the same book tab');

    // Two draws leave the tab row and .tright alone.
    await page.evaluate(() => { wihero.app.refresh(); wihero.app.refresh(); });
    await wait(page, 40);
    assert.ok(await kept(page, '__first'), 'refresh keeps the tab row nodes');
    assert.ok(await isSame(page, '__search') && await isSame(page, '__widen'), 'refresh keeps the .tright nodes');

    // Widen updates its label on the same button, and back again.
    await $(page, '.tright .iconbtn[aria-label="Widen"]').click();
    await wait(page, 40);
    assert.ok(await isSame(page, '__widen'), 'Widen keeps its node');
    assert.equal(await page.evaluate(() => window.__widen.getAttribute('aria-label')), 'Drawer size');
    assert.equal(await page.evaluate(() => wihero.settings.desk.normalWide), true, 'Widen is remembered');
    await $(page, '.tright .iconbtn[aria-label="Drawer size"]').click();
    await wait(page, 40);
    assert.ok(await isSame(page, '__widen'), 'Drawer size keeps the same node');
    assert.equal(await page.evaluate(() => window.__widen.getAttribute('aria-label')), 'Widen');

    await page.close();
    ok('Desktop: book and entry tabs, refresh, close and .tright (Search and Widen) keep their nodes');
}

try {
    await heroPhone();
    await normalPhone();
    await heroDesktop();
    await desktop();
    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
