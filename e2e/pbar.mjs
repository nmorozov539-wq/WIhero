// The retained piece bar (V3b) in the browser harness (e2e/desktop/harness.html): no SillyTavern needed. Hero's
// draws keep the bar, its chips and its fold button, so a refresh, arming a chip, folding and unfolding, and
// switching to Preview and back all keep the same nodes. Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/pbar.mjs`.
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

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset`);
await page.locator('#wihero-editor .tab').first().waitFor();

const $ = sel => page.locator(`#wihero-editor ${sel}`);
const wait = ms => page.waitForTimeout(ms);

/** Keeps a shadow-DOM node on the page's window under `name`; returning it across evaluate would lose its identity. */
const tag = (name, sel) => page.evaluate(([name, sel]) => {
    window[name] = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return !!window[name];
}, [name, sel]);
/** Whether the kept node is still the one that selector finds, in the editor's shadow root. */
const same = (name, sel) => page.evaluate(([name, sel]) => {
    const n = window[name];
    const now = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return !!n && n === now && n.isConnected;
}, [name, sel]);

await page.evaluate(() => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = 'WIHero-Sample';
    S.hero.active = 'canvas';
    wihero.app.refresh();
});
await $('.vp .card').first().waitFor();
await wait(200);

await $('.pbar').waitFor();
assert.equal(await tag('__bar', '.pbar'), true);
assert.equal(await tag('__chip', '.pchip[data-piece="opens"]'), true);
assert.equal(await tag('__fold', '.pfold'), true);
assert.equal(await $('.pchip').count(), 10, 'all ten piece chips');
assert.equal(await page.evaluate(() => window.__bar.classList.contains('folded')), false, 'the bar starts unfolded');

// Two draws keep the bar, a chip and the fold button.
await page.evaluate(() => { wihero.app.refresh(); wihero.app.refresh(); });
await wait(150);
assert.ok(await same('__bar', '.pbar'), 'two refreshes keep the bar node');
assert.ok(await same('__chip', '.pchip[data-piece="opens"]'), 'two refreshes keep the chip node');
assert.ok(await same('__fold', '.pfold'), 'two refreshes keep the fold button');

// A real click arms Opens in place: the same chip, no new bar, a banner asking for a card.
await $('.pchip[data-piece="opens"]').click();
await wait(100);
assert.ok(await same('__chip', '.pchip[data-piece="opens"]'), 'arming keeps the chip node');
assert.equal(await $('.pchip[data-piece="opens"]').getAttribute('aria-pressed'), 'true', 'the armed chip is pressed');
assert.ok(await page.evaluate(() => window.__chip.classList.contains('armed')), 'the armed chip has armed');
assert.ok(await same('__bar', '.pbar'), 'arming keeps the bar');
assert.match(await $('.armban').innerText(), /Tap the card that opens something/, 'the banner says what to tap');
assert.equal(await $('.armban .pbtn').innerText(), 'Cancel', 'the banner offers Cancel');

// Fold keeps the bar and its fold button; unfold brings back the very same chips.
await $('.pfold').click();
await wait(100);
assert.ok(await same('__bar', '.pbar'), 'folding keeps the bar node');
assert.ok(await same('__fold', '.pfold'), 'folding keeps the fold button');
assert.ok(await $('.pbar.folded').count() === 1, 'the bar is folded');
assert.equal(await $('.pchip').count(), 0, 'a folded bar shows no chips');
assert.equal(await page.evaluate(() => window.__chip.isConnected), false, 'the chips wait off the folded bar');
await $('.pfold').click();
await wait(100);
assert.ok(await same('__bar', '.pbar'), 'unfolding keeps the bar node');
assert.ok(await same('__chip', '.pchip[data-piece="opens"]'), 'unfolding brings back the same chip node');
assert.ok(await same('__fold', '.pfold'), 'unfolding keeps the fold button');
assert.equal(await $('.pchip').count(), 10, 'all ten chips are back');
assert.equal(await $('.armban').count(), 0, 'folding took the banner away');

// Preview and back draw a new canvas, but the bar keeps its nodes.
await $('.tab[aria-label="Preview"]').click();
await wait(150);
assert.equal(await $('.pbar').count(), 0, 'Preview shows no piece bar');
await $('.tab[aria-label="Canvas"]').click();
await $('.vp .card').first().waitFor();
await wait(150);
assert.ok(await same('__bar', '.pbar'), 'returning to Canvas keeps the bar node');
assert.ok(await same('__chip', '.pchip[data-piece="opens"]'), 'returning keeps the chip node');
assert.ok(await same('__fold', '.pfold'), 'returning keeps the fold button');
assert.equal(await $('.pchip').count(), 10, 'and all ten chips');

// A draw after the return updates the same bar: arming still works on the kept chip.
await $('.pchip[data-piece="closes"]').click();
await wait(100);
assert.equal(await $('.pchip[data-piece="closes"]').getAttribute('aria-pressed'), 'true', 'the returned bar still arms chips');
assert.match(await $('.armban').innerText(), /Tap the card that closes something/, 'and shows its banner');

await browser.close();
await new Promise(r => server.close(r));

assert.deepEqual(errors, [], 'no page errors');
ok('no page errors in the console');
console.log(`\n${step} passed`);
