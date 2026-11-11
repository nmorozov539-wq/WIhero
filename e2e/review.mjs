// The polish from the 2026-11-11 review, in the browser harness (e2e/desktop/harness.html), no SillyTavern needed:
// the inspector showing a card's rules before its settings, on a phone's half sheet and in a narrow desktop column.
// Screenshots: e2e/log/review-*.png.
//   node e2e/review.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = new URL('./log/', import.meta.url).pathname;
fs.mkdirSync(LOG, { recursive: true });
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
const BOOK = 'WIHero-Sample';

async function open(w, h, query = '') {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset${query}`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const card = (page, name) => $(page, '.vp .card').filter({ hasText: name }).first();
const shot = (page, name) => page.screenshot({ path: `${LOG}review-${name}.png` });
const toHero = async (page, book = BOOK) => {
    await page.evaluate(b => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = b; wihero.app.refresh(); }, book);
    await $(page, '.vp .card').first().waitFor();
    await page.waitForTimeout(300);
};
const inView = (page, sel, root) => page.evaluate(([s, r]) => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const n = sr.querySelector(s); const box = sr.querySelector(r);
    if (!n || !box) return null;
    const a = n.getBoundingClientRect(); const b = box.getBoundingClientRect();
    return { top: a.top, bottom: a.bottom, right: a.right, boxBottom: Math.min(b.bottom, innerHeight), boxRight: b.right, visible: a.top >= b.top && a.top + 24 <= Math.min(b.bottom, innerHeight) };
}, [sel, root]);

// 1. Phone, half sheet: Storm's first rule shows without scrolling; its settings are folded below the rules.
{
    const page = await open(390, 844);
    await toHero(page);
    await card(page, 'Storm').click();
    await $(page, '.insp .igrab').waitFor();
    await page.waitForTimeout(400);
    const first = await inView(page, '.insp .pc', '.insp');
    assert.ok(first?.visible, `Storm's first rule is in view: ${JSON.stringify(first)}`);
    const pieces = await $(page, '.insp .pc').evaluateAll(n => n.map(x => x.dataset.piece));
    assert.equal(pieces.at(-1), 'settings', pieces.join());
    assert.equal(await $(page, '.insp .isetpc.open').count(), 0, 'settings start folded on a card with rules');
    await shot(page, 'phone-storm');
    ok('phone: Storm\'s first rule shows on the half sheet without scrolling, its settings folded below');
    await $(page, '.insp .isetpc .pct').click();
    await $(page, '.insp .isetpc.open .tgrid').waitFor();
    ok('phone: the Settings row opens to Who triggers, Once, Tracker and ST timing');
    await page.close();
}

// 2. Desktop with a 320px inspector: nothing runs off its right edge, and a card without rules opens on its settings.
{
    const page = await open(1366, 768);
    await toHero(page);
    await page.evaluate(() => { const sr = document.querySelector('#wihero-editor').shadowRoot; const h = sr.querySelector('.hinsp'); if (h) h.style.width = '320px'; });
    await page.evaluate(() => { const sr = document.querySelector('#wihero-editor').shadowRoot; const h = sr.querySelector('.hinsp'); h.style.width = '320px'; h.style.flex = '0 0 320px'; });
    await $(page, '.prow').filter({ hasText: /^Village \(not gated\)/ }).first().click();
    await $(page, '.hinsp .ihead').filter({ hasText: /Village \(not gated\)/ }).waitFor();
    await $(page, '.hinsp .isetpc.open').waitFor();
    await page.evaluate(() => { const sr = document.querySelector('#wihero-editor').shadowRoot; const h = sr.querySelector('.hinsp'); h.style.width = '320px'; h.style.flex = '0 0 320px'; });
    await page.waitForTimeout(200);
    const seg = await inView(page, '.hinsp .iseg', '.hinsp');
    assert.ok(seg && seg.right <= seg.boxRight + 0.5, `Anyone / You / Character fits: ${JSON.stringify(seg)}`);
    await shot(page, 'desk-320');
    const cells = await $(page, '.hinsp .tcell').evaluateAll(n => n.map(c => Math.round(c.getBoundingClientRect().top)));
    assert.equal(new Set(cells).size, 2, `ST timing in two rows at 320px: ${cells}`);
    ok('desktop, 320px inspector: a card with no rules opens on its settings; Anyone / You / Character and ST timing fit');
    await page.close();
}

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
