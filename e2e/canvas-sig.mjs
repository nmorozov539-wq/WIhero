// The canvas signature projection (V2) in the browser harness with `?perf=1`: a content edit to an entry on Perf
// Big leaves the canvas and its card DOM alone; a title edit redraws it.
//   node e2e/canvas-sig.mjs
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
const cardProbe = key => page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k)?.dataset.sigProbe ?? null;
}, key);

// Hero mode on Perf Big, the placed canvas from the perf fixture.
await page.evaluate(book => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    wihero.app.refresh();
}, BOOK);
await $('.vp .card').first().waitFor({ timeout: 120000 });
await page.waitForTimeout(300);

const target = await page.evaluate(book => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const data = wihero.library.peek(book);
    for (const card of root.querySelectorAll('.vp .card')) {
        const key = card.dataset.id;
        if (!key?.startsWith('id:')) continue;
        const entry = Object.values(data.entries).find(e => e.extensions?.wihero?.id === key.slice(3));
        if (entry && !entry.extensions.wihero.moment) return { key, uid: entry.uid };
    }
    return null;
}, BOOK);
assert.ok(target, 'a placed entry card on the canvas');
assert.equal(await page.evaluate(k => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const card = [...root.querySelectorAll('.vp .card')].find(n => n.dataset.id === k);
    if (!card) return false;
    card.dataset.sigProbe = 'same';
    return true;
}, target.key), true);

// A content edit changes no canvas input: no draw, and the card element is the one that was there.
const contentBefore = await renders();
await page.evaluate(([book, uid]) => {
    wihero.library.change(book, d => { d.entries[uid].content += ' (content change)'; }, { quiet: true });
    wihero.app.refresh();
}, [BOOK, target.uid]);
await page.waitForTimeout(200);
const contentAfter = await renders();
assert.equal(contentAfter, contentBefore, 'a content edit did not draw the canvas');
assert.equal(await cardProbe(target.key), 'same', 'the card DOM is the same node');
ok('a content edit leaves canvasRenders alone and keeps the card DOM');

// Key words are drawn on the card: changing them draws again.
await page.evaluate(([book, uid]) => {
    wihero.library.change(book, d => {
        const entry = d.entries[uid];
        entry.key = [...(entry.key ?? []), 'sig probe'];
    }, { quiet: true });
    wihero.app.refresh();
}, [BOOK, target.uid]);
await page.waitForTimeout(200);
const keyAfter = await renders();
assert.ok(keyAfter > contentAfter, `a key-word edit draws the canvas (${contentAfter} → ${keyAfter})`);
ok('a key-word edit draws the canvas again');

// Off/on is drawn too.
await page.evaluate(([book, uid]) => {
    wihero.library.change(book, d => { d.entries[uid].disable = !d.entries[uid].disable; }, { quiet: true });
    wihero.app.refresh();
}, [BOOK, target.uid]);
await page.waitForTimeout(200);
const offAfter = await renders();
assert.ok(offAfter > keyAfter, `an off/on toggle draws the canvas (${keyAfter} → ${offAfter})`);
ok('an off/on toggle draws the canvas again');

// A title edit is a canvas input as well: it draws again.
await page.evaluate(([book, uid]) => {
    wihero.library.change(book, d => { d.entries[uid].comment += ' (title change)'; }, { quiet: true });
    wihero.app.refresh();
}, [BOOK, target.uid]);
await page.waitForTimeout(200);
const titleAfter = await renders();
assert.ok(titleAfter > offAfter, `a title edit draws the canvas (${offAfter} → ${titleAfter})`);
assert.notEqual(await cardProbe(target.key), 'same', 'the redrawn card is a new node');
ok('a title edit draws the canvas again');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
