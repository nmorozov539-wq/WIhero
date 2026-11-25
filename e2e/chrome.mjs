// The retained Hero chrome (V3c) in the browser harness (e2e/desktop/harness.html): no SillyTavern needed. A phone
// and a desktop keep the entry panel's button, aside and search field, and the inspector's `.insp` container and
// header, across refreshes and panel toggles; another card rebuilds the inspector's `.insp`. The list itself is
// refilled on each draw for the open panel, so its rows are rebuilt while the `.plist` container stays.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/chrome.mjs`.
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

async function open(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    await page.evaluate(() => {
        const S = wihero.app.state;
        S.mode = 'hero';
        S.hero.book = 'WIHero-Sample';
        S.hero.active = 'canvas';
        wihero.app.refresh();
    });
    await page.locator('#wihero-editor .vp .card').first().waitFor();
    await page.waitForTimeout(200);
    return page;
}

const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const card = (page, name) => $(page, '.card').filter({ hasText: name }).first();
const wait = (page, ms) => page.waitForTimeout(ms);
const refresh = async (page, n = 1) => {
    for (let i = 0; i < n; i++) await page.evaluate(() => wihero.app.refresh());
    await page.waitForTimeout(150);
};

/** Keeps a shadow-DOM node on the page's window under `name`; returning it across evaluate would lose its identity. */
const tag = (page, name, sel) => page.evaluate(([name, sel]) => {
    window[name] = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return !!window[name];
}, [name, sel]);
/** Whether the kept node is still the one that selector finds, in the editor's shadow root. */
const same = (page, name, sel) => page.evaluate(([name, sel]) => {
    const n = window[name];
    const now = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return !!n && n === now && n.isConnected;
}, [name, sel]);
const gone = (page, name) => page.evaluate(name => !!window[name] && !window[name].isConnected, name);
const rowKeys = page => $(page, '.panel .prow[data-key]').evaluateAll(ns => ns.map(n => n.dataset.key));

async function phone() {
    const page = await open(390, 844);
    await $(page, '.panel').waitFor();
    assert.ok(await $(page, '.panel.closed').count(), 'the phone panel starts closed');

    // Open the panel once, then keep its button, aside, search field and list container.
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    assert.equal(await $(page, '.panel.closed').count(), 0, 'the panel opens');
    assert.equal(await tag(page, '__pb', '.panelBtn'), true);
    assert.equal(await tag(page, '__panel', 'aside.panel'), true);
    assert.equal(await tag(page, '__search', 'aside.panel .phead input'), true);
    assert.equal(await tag(page, '__list', 'aside.panel .plist'), true);
    const keys = await rowKeys(page);
    assert.ok(keys.length, 'the open panel lists rows');

    // Two toggles: closed and open again, with the same nodes.
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    assert.equal(await $(page, '.panel.closed').count(), 1, 'the panel closes');
    assert.ok(await same(page, '__pb', '.panelBtn'), 'closing keeps the panel button');
    assert.ok(await same(page, '__panel', 'aside.panel'), 'closing keeps the aside');
    assert.ok(await same(page, '__search', 'aside.panel .phead input'), 'closing keeps the search field');
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    assert.equal(await $(page, '.panel.closed').count(), 0, 'the panel opens again');
    assert.ok(await same(page, '__pb', '.panelBtn'), 'reopening keeps the panel button');
    assert.ok(await same(page, '__panel', 'aside.panel'), 'reopening keeps the aside');
    assert.ok(await same(page, '__search', 'aside.panel .phead input'), 'reopening keeps the search field');

    // Two refreshes keep the same nodes and the same rows; the rows themselves are rebuilt in the retained list.
    await refresh(page, 2);
    assert.equal(await $(page, '.panel.closed').count(), 0, 'the panel stays open across refreshes');
    assert.ok(await same(page, '__pb', '.panelBtn'), 'refreshes keep the panel button');
    assert.ok(await same(page, '__panel', 'aside.panel'), 'refreshes keep the aside');
    assert.ok(await same(page, '__search', 'aside.panel .phead input'), 'refreshes keep the search field');
    assert.ok(await same(page, '__list', 'aside.panel .plist'), 'refreshes keep the list container');
    assert.deepEqual(await rowKeys(page), keys, 'the same rows are listed; their nodes are rebuilt inside the kept list');

    // The search text is state, so it survives a refresh on the kept field.
    await $(page, 'aside.panel .phead input').fill('mill');
    await wait(page, 120);
    await refresh(page, 1);
    assert.ok(await same(page, '__search', 'aside.panel .phead input'), 'a refresh keeps the search field while searching');
    assert.equal(await $(page, 'aside.panel .phead input').inputValue(), 'mill', 'the search text stays');
    await $(page, 'aside.panel .phead input').fill('');
    await wait(page, 120);
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    ok('phone: panel button, aside, search field and list container keep their nodes across two toggles and refreshes');

    // The inspector keeps its `.insp` and header for the same card across refreshes.
    await card(page, 'Mill: arrival').click();
    await $(page, '.insp .igrab').waitFor();
    assert.match(await $(page, '.insp .ihead h2').textContent(), /Mill: arrival/);
    assert.equal(await tag(page, '__insp', '.insp'), true);
    assert.equal(await tag(page, '__head', '.insp .ihead'), true);
    await refresh(page, 2);
    assert.ok(await same(page, '__insp', '.insp'), 'refreshes keep the same inspector for the same card');
    assert.ok(await same(page, '__head', '.insp .ihead'), 'refreshes keep the inspector header');
    assert.match(await $(page, '.insp .ihead h2').textContent(), /Mill: arrival/, 'the inspector still shows that card');

    // Another card updates the inspector: the shell is rebuilt for the new selection (identity changes).
    await card(page, 'Right path').click();
    await wait(page, 150);
    assert.match(await $(page, '.insp .ihead h2').textContent(), /Right path/, 'the inspector shows the other card');
    assert.ok(await gone(page, '__insp'), 'a different card drops the old inspector shell');
    assert.equal(await tag(page, '__insp2', '.insp'), true);
    await refresh(page, 1);
    assert.ok(await same(page, '__insp2', '.insp'), 'the new selection keeps its inspector across a refresh');
    ok('phone: the inspector and its header survive a refresh for the same card; another card gets a new shell');
    await page.close();
}

async function desktop() {
    const page = await open(1366, 768);
    await $(page, '.panel.dock').waitFor();
    assert.equal(await tag(page, '__pb', '.panelBtn'), true);
    assert.equal(await tag(page, '__panel', '.panel.dock'), true);
    assert.equal(await tag(page, '__search', '.panel.dock .phead input'), true);
    assert.equal(await tag(page, '__list', '.panel.dock .plist'), true);
    const keys = await rowKeys(page);
    // The docked panel's button hides and shows it; the kept aside comes back as the same node.
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    assert.equal(await $(page, '.panel.dock').count(), 0, 'the button hides the docked list');
    assert.ok(await same(page, '__pb', '.panelBtn'), 'hiding keeps the panel button');
    await $(page, '.panelBtn').click();
    await wait(page, 120);
    assert.equal(await $(page, '.panel.dock').count(), 1, 'the list is back');
    assert.ok(await same(page, '__panel', '.panel.dock'), 'showing reattaches the same aside');
    assert.ok(await same(page, '__search', '.panel.dock .phead input'), 'and the same search field');
    await refresh(page, 2);
    assert.ok(await same(page, '__pb', '.panelBtn'), 'refreshes keep the panel button');
    assert.ok(await same(page, '__panel', '.panel.dock'), 'refreshes keep the aside');
    assert.ok(await same(page, '__search', '.panel.dock .phead input'), 'refreshes keep the search field');
    assert.ok(await same(page, '__list', '.panel.dock .plist'), 'refreshes keep the list container');
    assert.deepEqual(await rowKeys(page), keys, 'the same rows are listed; their nodes are rebuilt inside the kept list');
    ok('desktop: the docked panel button, aside, search field and list container keep their nodes across a toggle and refreshes');

    // The inspector column and `.insp` keep their nodes for the same card; another card rebuilds `.insp`.
    await card(page, 'Mill: arrival').click();
    await $(page, '.hinsp .insp.entry .ihead').waitFor();
    assert.match(await $(page, '.hinsp .insp .ihead h2').textContent(), /Mill: arrival/);
    assert.equal(await tag(page, '__hinsp', '.hinsp'), true);
    assert.equal(await tag(page, '__insp', '.hinsp .insp'), true);
    assert.equal(await tag(page, '__head', '.hinsp .insp .ihead'), true);
    await refresh(page, 2);
    assert.ok(await same(page, '__hinsp', '.hinsp'), 'refreshes keep the inspector column');
    assert.ok(await same(page, '__insp', '.hinsp .insp'), 'refreshes keep the same inspector for the same card');
    assert.ok(await same(page, '__head', '.hinsp .insp .ihead'), 'refreshes keep the inspector header');
    assert.match(await $(page, '.hinsp .insp .ihead h2').textContent(), /Mill: arrival/);
    await card(page, 'Road: leaving').click();
    await wait(page, 150);
    assert.match(await $(page, '.hinsp .insp .ihead h2').textContent(), /Road: leaving/);
    assert.ok(await same(page, '__hinsp', '.hinsp'), 'another card keeps the inspector column');
    assert.ok(await gone(page, '__insp'), 'another card drops the old inspector shell');
    assert.equal(await tag(page, '__insp2', '.hinsp .insp'), true);
    await refresh(page, 1);
    assert.ok(await same(page, '__insp2', '.hinsp .insp'), 'the new selection keeps its inspector across a refresh');
    ok('desktop: the inspector column and header survive a refresh for the same card; another card gets a new `.insp`');
    await page.close();
}

try {
    await phone();
    await desktop();
    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
    console.log(`\n${step} passed`);
} catch (e) {
    console.error(e);
    console.error('errors:', errors);
    process.exitCode = 1;
} finally {
    await browser.close();
    server.close();
}
