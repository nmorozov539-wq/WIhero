// Status-only updates (V6) in the browser harness with `?perf=1`: a chat-state change patches the badge and classes
// on the cards already drawn instead of drawing the canvas again. Show chat state itself still draws once each way.
//   node e2e/badges.mjs
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
const BOOK = 'Perf Big';

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset&perf=1`);
await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 120000 });
await page.click('#wi-button');
await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });

const $ = sel => page.locator(`#wihero-editor ${sel}`);
const renders = () => page.evaluate(() => wihero.perf.snapshot().canvasRenders);
const probe = key => page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const card = [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k);
    if (!card) return null;
    const badge = card.querySelector('.fired, .badge1');
    return {
        probe: card.dataset.badgeProbe ?? null,
        cls: card.className,
        text: card.querySelector('.k')?.textContent ?? null,
        tag: card.querySelector('.tag')?.textContent ?? null,
        badge: badge?.textContent ?? null,
        badgeCls: badge?.className ?? null,
    };
}, key);

// Hero on Perf Big with Show chat state on: cards are built with their status nodes.
await page.evaluate(book => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.chatState = true;
    wihero.app.refresh();
}, BOOK);
await $('.vp .card').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(300);

// One ordinary placed card and, if the fixture has one, a Moment.
const targets = await page.evaluate(book => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const data = wihero.library.peek(book);
    const entries = Object.values(data.entries);
    const out = {};
    for (const card of root.querySelectorAll('.vp .card')) {
        const key = card.dataset.id;
        if (!key?.startsWith('id:')) continue;
        const entry = entries.find(e => e.extensions?.wihero?.id === key.slice(3));
        if (!entry) continue;
        if (entry.extensions.wihero.moment) {
            out.moment ??= { key, stateKey: `${book}/${key.slice(3)}` };
            if (!card.dataset.badgeProbe) card.dataset.badgeProbe = 'same';
        } else {
            out.normal ??= { key, stateKey: `${book}/${key.slice(3)}` };
            if (!card.dataset.badgeProbe) card.dataset.badgeProbe = 'same';
        }
    }
    return out;
}, BOOK);
assert.ok(targets.normal, 'a placed ordinary card on the canvas');
const target = targets.normal;

let current = await probe(target.key);
assert.equal(current.probe, 'same');
const before = await renders();

// Fired: the same card gets the fired badge, with no draw.
await page.evaluate(key => {
    wihero.hooks.state().fired[key] = 2;
    wihero.app.refresh();
}, target.stateKey);
await page.waitForTimeout(200);
current = await probe(target.key);
assert.equal(await renders(), before, 'a fired change did not draw the canvas');
assert.equal(current.probe, 'same', 'the same card node is still there');
assert.equal(current.badge, '2×');
assert.match(current.badgeCls, /\bfired\b/);
ok('a fired change patches the same card\'s badge without a draw');

// Closed: the card class and its line change in place.
await page.evaluate(key => {
    wihero.hooks.state().closed[key] = { at: 1, by: 'once', wasHolding: false };
    wihero.app.refresh();
}, target.stateKey);
await page.waitForTimeout(200);
current = await probe(target.key);
assert.equal(await renders(), before, 'a closed change did not draw the canvas');
assert.equal(current.probe, 'same');
assert.match(current.cls, /\bclosed\b/);
assert.equal(current.text, 'CLOSED · by Once, after it fired');
ok('a closed change patches the class and line without a draw');

// Holding: closed goes away, holding arrives, and the fired badge goes with the fired state.
await page.evaluate(key => {
    const state = wihero.hooks.state();
    delete state.closed[key];
    delete state.fired[key];
    state.holding[key] = { since: 1 };
    wihero.app.refresh();
}, target.stateKey);
await page.waitForTimeout(200);
current = await probe(target.key);
assert.equal(await renders(), before, 'a holding change did not draw the canvas');
assert.equal(current.probe, 'same');
assert.match(current.cls, /\bholding\b/);
assert.doesNotMatch(current.cls, /\bclosed\b/);
assert.notEqual(current.badge, '2×');
ok('a holding change patches the classes without a draw');

// A Moment's tag is patched too (HAPPENED / NOT YET).
if (targets.moment) {
    const moment = targets.moment;
    await page.evaluate(key => {
        wihero.hooks.state().fired[key] = 1;
        wihero.app.refresh();
    }, moment.stateKey);
    await page.waitForTimeout(200);
    let m = await probe(moment.key);
    assert.equal(await renders(), before, 'a Moment happening did not draw the canvas');
    assert.equal(m.probe, 'same');
    assert.equal(m.tag, 'HAPPENED');
    await page.evaluate(key => {
        wihero.hooks.state().fired[key] = 0;
        wihero.app.refresh();
    }, moment.stateKey);
    await page.waitForTimeout(200);
    m = await probe(moment.key);
    assert.equal(await renders(), before, 'a Moment going back did not draw the canvas');
    assert.equal(m.tag, 'NOT YET');
    ok('a Moment tag is patched from HAPPENED to NOT YET without a draw');
}

// Show chat state still redraws once each way: the cards are built with or without status nodes.
const beforeToggle = await renders();
await page.evaluate(() => {
    wihero.app.state.hero.chatState = false;
    wihero.app.refresh();
});
await page.waitForTimeout(200);
const offRenders = await renders();
assert.equal(offRenders, beforeToggle + 1, 'turning Show chat state off drew once');
current = await probe(target.key);
assert.doesNotMatch(current.cls, /\bholding\b/, 'the off draw has no status class');
await page.evaluate(() => {
    wihero.app.state.hero.chatState = true;
    wihero.app.refresh();
});
await page.waitForTimeout(200);
assert.equal(await renders(), offRenders + 1, 'turning Show chat state on drew once');
current = await probe(target.key);
assert.match(current.cls, /\bholding\b/, 'the on draw came back with its status class');
ok('Show chat state draws once off and once on');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
