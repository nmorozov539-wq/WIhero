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
    assert.equal(await $(page, '.vp.focusdim').count(), 1, 'the canvas dims around the tapped card');
    assert.equal(await $(page, '.vp .card.lit').filter({ hasText: /^Storm/ }).count(), 1);
    assert.equal(await $(page, '.vp .card.lit').filter({ hasText: 'Lantern' }).count(), 0);
    const titleLines = await $(page, '.vp .card').filter({ hasText: 'Road: leaving' }).locator('.t').evaluate(n => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)));
    assert.equal(titleLines, 2, 'a long title wraps to two lines on a phone');
    ok('phone: a tapped card lights its links and dims the rest; a long title wraps to two lines');
    ok('phone: Storm\'s first rule shows on the half sheet without scrolling, its settings folded below');
    await $(page, '.insp .isetpc .pct').click();
    await $(page, '.insp .isetpc.open .tgrid').waitFor();
    ok('phone: the Settings row opens to Who triggers, Once, Tracker and ST timing');
    await page.close();
}

// 1b. Phone, empty canvas: a long press let go offers "Place an entry here" instead of opening the picker; a slip
// under 18px is still a press, not a box; a tap elsewhere drops the offer.
{
    const page = await open(390, 844);
    await toHero(page);
    const vp = await $(page, '.vp').boundingBox();
    const spot = async () => {
        for (let y = vp.y + 120; y < vp.y + vp.height - 120; y += 20) for (let x = vp.x + 30; x < vp.x + vp.width - 30; x += 20) {
            const free = await page.evaluate(([px, py]) => { const sr = document.querySelector('#wihero-editor').shadowRoot; const n = sr.elementFromPoint(px, py); return !!n && !n.closest('.card, [data-port], [data-pack], [data-flip], [data-open], [data-row], .lbl, .plabel, .pbar, svg path'); }, [x, y]);
            if (free) return [x, y];
        }
        throw new Error('no free spot');
    };
    const [hx, hy] = await spot();
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.move(hx + 10, hy + 6, { steps: 3 });
    await page.mouse.up();
    await $(page, '.placeoffer').waitFor();
    assert.equal(await $(page, '.sheet').count(), 0, 'no picker until the offer is tapped');
    assert.equal(await $(page, '.selbox').count(), 0, 'a 12px slip draws no box');
    await shot(page, 'phone-place');
    await page.mouse.click(vp.x + vp.width / 2, vp.y + 60);
    await page.waitForTimeout(200);
    assert.equal(await $(page, '.placeoffer').count(), 0, 'a tap elsewhere drops the offer');
    ok('phone: a long press let go offers Place an entry here; a slip is not a box; a tap elsewhere drops it');
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
    await $(page, '.pbar.more-r .pmore').waitFor();
    const momentHidden = await $(page, '.pchip[data-piece="moment"]').evaluate(n => n.getBoundingClientRect().right > n.closest('.pchips').getBoundingClientRect().right);
    assert.ok(momentHidden, 'with the inspector docked the bar is cut before Moment');
    await $(page, '.pmore').click();
    await page.waitForTimeout(600);
    assert.ok(await $(page, '.pbar.more-l').count(), 'scrolled on, the left edge fades');
    const momentShown = await $(page, '.pchip[data-piece="moment"]').evaluate(n => n.getBoundingClientRect().right <= n.closest('.pchips').getBoundingClientRect().right + 1);
    assert.ok(momentShown, 'the arrow brings Moment into view');
    await shot(page, 'desk-pbar');
    ok('desktop: a piece bar wider than its room fades at the cut and its arrow scrolls Moment into view');
    const cells = await $(page, '.hinsp .tcell').evaluateAll(n => n.map(c => Math.round(c.getBoundingClientRect().top)));
    assert.equal(new Set(cells).size, 2, `ST timing in two rows at 320px: ${cells}`);
    ok('desktop, 320px inspector: a card with no rules opens on its settings; Anyone / You / Character and ST timing fit');
    await page.close();
}

// 3. Light theme: the piece colors deepen, so glue, the pack frame and its ANY label read on a pale canvas.
{
    const page = await open(1366, 768, '&theme=light');
    await toHero(page);
    assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').dataset.tone), 'light');
    const contrast = await page.evaluate(() => {
        const wih = document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih');
        const rgb = v => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const cs = getComputedStyle(wih);
        const bg = lum(rgb(getComputedStyle(wih.querySelector('.vp')).backgroundColor));
        const out = {};
        for (const k of ['--p-glue', '--p-pack', '--p-open', '--p-close', '--p-mask', '--p-track']) { const l = lum(rgb(cs.getPropertyValue(k).trim())); out[k] = +((Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)).toFixed(2); }
        return out;
    });
    for (const [k, v] of Object.entries(contrast)) assert.ok(v >= 3, `${k} reads on the light canvas (${v}:1)`);
    await shot(page, 'light');
    ok(`light theme: every piece color is at least 3:1 against the canvas (${Object.values(contrast).join(', ')})`);
    await page.close();
}

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
