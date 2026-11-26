// Hero's interaction contract on the disposable `?perf=1` harness (G4): measured-native-browser. Opening the 500-card
// "Perf Big" canvas draws it once and fills in the rest; a card tap keeps the card node and does not draw the canvas
// or route a link; Show chat state patches the cards in place; a wheel gesture moves the camera without a redraw or
// a route compute. No absolute time is asserted; the numbers are in the plan's G4 table.
//   node e2e/hero-perf.mjs        (CHROMIUM=/usr/bin/google-chrome-stable for the Chromium build)
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
const QUERY = '?reset&perf=1&books=40&entries=150&big=1000&canvas=500&keys=shared&keyCount=4&long=100000&chats=240';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const BOOK = 'Perf Big';

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}${QUERY}`);
await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 120000 });
await page.click('#wi-button');
await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });

const $ = sel => page.locator(`#wihero-editor ${sel}`);
const counts = () => page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const perf = wihero.perf.snapshot();
    return {
        cards: root.querySelectorAll('.vp .card').length,
        links: root.querySelectorAll('.vp .ln').length,
        hits: root.querySelectorAll('.vp .lhit').length,
        ports: root.querySelectorAll('.vp .port').length,
        renders: perf.canvasRenders,
        routes: perf.routeComputes,
        dom: root.querySelectorAll('*').length,
    };
});

// Hero on Perf Big, the placed canvas from the perf fixture. The first draw puts the cards up and fills the links
// in over the next few tasks; wait for that fill before counting anything.
await page.evaluate(book => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.chatState = false;
    wihero.app.refresh();
}, BOOK);
await page.waitForFunction(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return root.querySelectorAll('.vp .card').length >= 600 && root.querySelectorAll('.vp .ln').length > 0;
}, null, { timeout: 120000 });
await page.waitForTimeout(400);

const opened = await counts();
assert.ok(opened.cards >= 600, `the whole placed canvas is drawn (${opened.cards} cards)`);
assert.ok(opened.links > 0 && opened.hits > 0, `the links arrived (${opened.links} lines, ${opened.hits} hit paths)`);
assert.ok(opened.ports > 0, 'the ports are drawn');
assert.equal(opened.renders, 1, 'one canvas draw for the open');
ok('Hero opens the whole canvas: cards, links and ports are drawn once');

// The phone's first open starts at the top of a 500-card canvas; Fit is a reader's control, so use it (outside any
// measurement) before looking for a card to tap.
await $('button[aria-label="Fit to screen"]').click();
await page.waitForTimeout(300);

// A card on screen, clear of the panel and the piece bar. The tap must leave the canvas alone: no draw, no routing.
const at = await page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const vp = root.querySelector('.vp');
    const r = vp.getBoundingClientRect();
    const x0 = r.left + 12, x1 = r.right - 12, y0 = r.top + 60, y1 = r.bottom - 120;
    const hit = (x, y) => (root.elementFromPoint(x, y)?.closest('.card') ? { x, y } : null);
    for (const card of root.querySelectorAll('.vp .card')) {
        const b = card.getBoundingClientRect();
        const x = (Math.max(b.left, x0) + Math.min(b.right, x1)) / 2;
        const y = (Math.max(b.top, y0) + Math.min(b.bottom, y1)) / 2;
        if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
        const found = hit(x, y);
        if (found) return { ...found, key: card.dataset.id };
    }
    return null;
});
assert.ok(at, 'a card is on screen to tap');
await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k).dataset.tapProbe = 'same';
}, at.key);
const beforeTap = await counts();
await page.touchscreen.tap(at.x, at.y);
await $('.insp .ihead').waitFor({ timeout: 30000 });
const afterTap = await counts();
const tapProbe = await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k)?.dataset.tapProbe ?? null;
}, at.key);
assert.equal(afterTap.renders, beforeTap.renders, 'a tap did not draw the canvas');
assert.equal(afterTap.routes, beforeTap.routes, 'a tap did not route a link');
assert.ok(afterTap.dom > beforeTap.dom, 'a tap added the inspector only');
assert.equal(tapProbe, 'same', 'the tapped card is the same node');
ok('a card tap opens the inspector on the same card, with no canvas draw and no route compute');

// Show chat state is patched, not drawn: give one card a fired state, then toggle on and off and watch that same
// node gain and lose the badge while the canvas render count stays put.
const target = await page.evaluate(book => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const data = wihero.library.peek(book);
    for (const card of root.querySelectorAll('.vp .card')) {
        const key = card.dataset.id;
        if (!key?.startsWith('id:')) continue;
        const entry = Object.values(data.entries).find(e => e.extensions?.wihero?.id === key.slice(3));
        if (!entry || entry.extensions.wihero.moment || entry.extensions.wihero.once || entry.extensions.wihero.closesAfter != null) continue;
        return { key, stateKey: `${book}/${key.slice(3)}` };
    }
    return null;
}, BOOK);
assert.ok(target, 'a plain placed card to patch');
await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k).dataset.statusProbe = 'same';
}, target.key);
await page.keyboard.press('Escape'); // close the inspector; the canvas card stays
await page.waitForTimeout(250);
await page.evaluate(k => { wihero.hooks.state().fired[k] = 2; }, target.stateKey);
const beforeChat = await counts();
await page.evaluate(() => { wihero.app.state.hero.chatState = true; wihero.app.refresh(); });
await page.waitForTimeout(250);
const onChat = await counts();
const on = await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const card = [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k);
    return { probe: card?.dataset.statusProbe ?? null, badge: card?.querySelector('.fired, .badge1')?.textContent ?? null, cls: card?.className ?? '' };
}, target.key);
assert.equal(onChat.renders, beforeChat.renders, 'Show chat state on did not draw the canvas');
assert.equal(onChat.routes, beforeChat.routes, 'Show chat state on did not route');
assert.equal(on.probe, 'same', 'Show chat state on kept the card node');
assert.equal(on.badge, '2×', 'Show chat state on patched the fired badge');
await page.evaluate(() => { wihero.app.state.hero.chatState = false; wihero.app.refresh(); });
await page.waitForTimeout(250);
const offChat = await counts();
const off = await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const card = [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k);
    return { probe: card?.dataset.statusProbe ?? null, badge: card?.querySelector('.fired, .badge1')?.textContent ?? null, cls: card?.className ?? '' };
}, target.key);
assert.equal(offChat.renders, beforeChat.renders, 'Show chat state off did not draw the canvas');
assert.equal(offChat.routes, beforeChat.routes, 'Show chat state off did not route');
assert.equal(off.probe, 'same', 'Show chat state off kept the card node');
assert.equal(off.badge, null, 'Show chat state off patched the fired badge away');
ok('Show chat state patches the same cards on and off, with no canvas draw and no route compute');

// The wheel moves the camera: one transform, no canvas draw, no route compute. (On this phone layout the wheel is
// the zoom control; the harness calls the step "pan".)
const beforePan = await counts();
const camBefore = await page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return root.querySelector('.vp .world').style.transform;
});
await page.mouse.move(195, 420);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(50); }
await page.waitForTimeout(200);
const afterPan = await counts();
const camAfter = await page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return root.querySelector('.vp .world').style.transform;
});
assert.equal(afterPan.renders, beforePan.renders, 'the wheel did not draw the canvas');
assert.equal(afterPan.routes, beforePan.routes, 'the wheel did not route a link');
assert.notEqual(camAfter, camBefore, 'the wheel moved the camera');
ok('a wheel gesture moves the camera with no canvas draw and no route compute');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
