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
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const shot = (page, name) => page.screenshot({ path: `${LOG}explain-${name}.png` });
const BOOK = 'WIHero-Sample';
const G = 12;

async function open(w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    await page.evaluate(b => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = b; wihero.app.refresh(); }, BOOK);
    await $(page, '.vp .card').first().waitFor();
    await page.waitForTimeout(300);
    return page;
}
const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const mem = (page, key) => page.evaluate(([b, k]) => ({ ...wihero.settings.books[b].canvas.cards[k] }), [BOOK, key]);
const refresh = page => page.evaluate(() => wihero.app.refresh());

/** Real touch points through CDP (as in controls.mjs): every finger still down as [x, y]; [] lifts them all. */
async function touch(page) {
    const s = await page.context().newCDPSession(page);
    let down = new Map();
    return async points => {
        const pts = points.map(([x, y, id], i) => ({ x, y, id: id ?? i }));
        const now = new Map(pts.map(p => [p.id, p]));
        const lifted = [...down.values()].filter(p => !now.has(p.id));
        if (lifted.length) await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lifted });
        if (pts.length) {
            const moved = pts.some(p => down.has(p.id) && (down.get(p.id).x !== p.x || down.get(p.id).y !== p.y));
            const fresh = pts.some(p => !down.has(p.id));
            if (fresh) await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
            else if (moved || !lifted.length) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
        }
        down = now;
    };
}
const T_STEPS = 8;
async function swipe(T, from, to, { hold = 0 } = {}) {
    await T([[from.x, from.y]]);
    if (hold) await new Promise(r => setTimeout(r, hold));
    for (let i = 1; i <= T_STEPS; i++) await T([[from.x + (to.x - from.x) * i / T_STEPS, from.y + (to.y - from.y) * i / T_STEPS]]);
}
const tipText = page => $(page, '.explaintip').innerText();
const hero = page => page.evaluate(() => {
    const w = document.querySelector('#wihero-editor').shadowRoot?.querySelector('.vp .world') ?? document.querySelector('#wihero-editor .vp .world');
    const m = new DOMMatrix(w ? getComputedStyle(w).transform : 'none');
    return { explain: wihero.app.state.hero.explain, active: wihero.app.state.hero.active, cam: { tx: m.e, ty: m.f } };
});

async function phone() {
    const page = await open(390, 844, { hasTouch: true, isMobile: true });
    const T = await touch(page);
    const tap = async loc => { const c = await centre(loc); await T([[c.x, c.y]]); await T([]); await page.waitForTimeout(120); };
    await $(page, 'button[aria-label="Fit to screen"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    await page.waitForTimeout(100);
    assert.ok(await $(page, '.vp .card.xok').count() > 3, 'cards are outlined');
    assert.equal(await $(page, 'button[aria-label="Menu"].xno').count(), 1, 'the menu button has nothing to say: set aside');
    await shot(page, 'phone-on');

    // A tap on a card: a tooltip about that card, and explain mode stays on.
    const mill = $(page, '.vp .card').filter({ hasText: 'Mill' }).first();
    await tap(mill.locator('.t'));
    await $(page, '.explaintip').waitFor();
    assert.match(await tipText(page), /Mill/);
    assert.ok((await hero(page)).explain, 'a tap keeps explain mode on');
    await shot(page, 'phone-card');

    // A lock pill: its phrase; More opens the Guide at Lock.
    await tap($(page, '.lockp[data-kind="lock"]').first());
    assert.match(await tipText(page), /^Lock Holds its row until someone says "/);
    await shot(page, 'phone-lock');
    await tap($(page, '.explaintip button'));
    await $(page, '.guide .gpage[data-anchor="lock"]').waitFor();
    ok('phone: "?" outlines what can be explained and sets the rest aside; a tap shows a tooltip about that thing; More opens its Guide page');

    // Nothing to say: the menu button does nothing at all.
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    await tap($(page, 'button[aria-label="Menu"]'));
    assert.equal(await $(page, '.explaintip').count(), 0, 'no tooltip');
    assert.equal(await page.locator('#wihero-editor .sheet').count(), 0, 'no menu opened');
    assert.ok((await hero(page)).explain);
    ok('phone: a tap on something with nothing to explain does nothing (no toast, no menu)');

    // One finger on empty canvas still moves the view.
    const before = (await hero(page)).cam;
    const vp = await $(page, '.vp').boundingBox();
    const cards = await $(page, '.vp .card').evaluateAll(n => n.map(c => c.getBoundingClientRect()).map(r => [r.left, r.top, r.right, r.bottom]));
    let spot = null;
    for (let y = vp.y + 120; y < vp.y + vp.height - 160 && !spot; y += 20) for (let x = vp.x + 20; x < vp.x + vp.width - 60 && !spot; x += 20)
        if (!cards.some(([l, t, r, b]) => x > l - 30 && x < r + 30 && y > t - 30 && y < b + 30)) spot = { x, y };
    assert.ok(spot, 'an empty spot on the canvas');
    await swipe(T, spot, { x: spot.x + 60, y: spot.y + 40 });
    await T([]);
    await page.waitForTimeout(150);
    const after = (await hero(page)).cam;
    assert.ok(Math.abs((after.tx ?? 0) - (before.tx ?? 0)) > 30, `the view moved (${before.tx} → ${after.tx})`);
    assert.ok((await hero(page)).explain, 'still explaining');
    ok('phone: one finger on empty canvas still pans the view in explain mode');

    // A long press opens the Guide straight away.
    const jc = await centre($(page, '.vp .packframe').first().locator('.pn'));
    await swipe(T, jc, jc, { hold: 650 });
    await T([]);
    await $(page, '.guide .gpage[data-anchor="pack"]').waitFor();
    assert.equal((await hero(page)).explain, false, 'the Guide ends explain mode');
    ok('phone: a long press on a pack name opens the Guide at Pack');

    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban button').click();
    await page.waitForTimeout(100);
    assert.equal(await $(page, '.explainban').count(), 0);
    assert.equal(await $(page, '.xno').count(), 0, 'nothing left set aside');
    ok('phone: Done ends explain mode');
    await page.context().close();
}

async function desktop() {
    const page = await open(1366, 768);
    await $(page, '.tright .explainq').click();
    await $(page, '.explainban').waitFor();
    const pill = $(page, '.lockp').first();
    await pill.hover();
    await $(page, '.explaintip').waitFor();
    assert.match(await tipText(page), /^(Lock|Wait) Holds its row/);
    assert.equal(await $(page, '.explaintip button').count(), 0, 'hover: no More button, a click is the way in');
    await shot(page, 'desk-hover');
    await pill.click();
    await $(page, '.guide .gpage[data-anchor="lock"], .guide .gpage[data-anchor="wait"]').first().waitFor();
    ok('desktop: hovering shows the tooltip; a click opens the Guide');
    await page.context().close();
}

try {
    await phone();
    await desktop();
    assert.deepEqual(errors, []);
    console.log('all explain checks passed');
} catch (e) {
    console.error('FAILED:', e);
    process.exitCode = 1;
} finally {
    await browser.close();
    server.close();
}
