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
    await page.evaluate(() => {
        window.__copied = 0;
        try { navigator.clipboard.writeText = async () => { window.__copied++; }; }
        catch { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { window.__copied++; } }, configurable: true }); }
    });
    return page;
}
const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const refresh = page => page.evaluate(() => wihero.app.refresh());
const hero = page => page.evaluate(() => {
    const w = document.querySelector('#wihero-editor').shadowRoot?.querySelector('.vp .world') ?? document.querySelector('#wihero-editor .vp .world');
    const m = new DOMMatrix(w ? getComputedStyle(w).transform : 'none');
    const H = wihero.app.state.hero;
    return { explain: H.explain, active: H.active, panel: H.panel, insp: H.insp?.key ?? null, cam: { tx: m.e, ty: m.f } };
});
const tipText = page => $(page, '.explaintip').innerText();
const booksJson = page => page.evaluate(() => JSON.stringify(wihero.library.peek('WIHero-Sample')));
const cardsJson = page => page.evaluate(() => JSON.stringify(wihero.settings.books['WIHero-Sample']?.canvas?.cards ?? {}));
const copied = page => page.evaluate(() => window.__copied);
const sheets = page => $(page, '.sheet').count();
const waitTip = page => $(page, '.explaintip').waitFor({ state: 'visible' });

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
async function phonePage() {
    const page = await open(390, 844, { hasTouch: true, isMobile: true });
    const T = await touch(page);
    const tap = async loc => { try { await loc.scrollIntoViewIfNeeded(); } catch {} const c = await centre(loc); await T([[c.x, c.y]]); await T([]); await page.waitForTimeout(120); };
    const tapAt = async (x, y) => { await T([[x, y]]); await T([]); await page.waitForTimeout(120); };
    return { page, T, tap, tapAt };
}

async function phone() {
    const { page, T, tap, tapAt } = await phonePage();
    await $(page, 'button[aria-label="Fit to screen"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    await page.waitForTimeout(100);
    assert.equal((await $(page, '.explainban span').innerText()).trim(), 'Tap again to follow · hold for the Guide', 'the banner keeps only the follow hint');
    assert.ok(await $(page, '.vp .card.xok').count() > 3, 'cards are outlined');
    assert.equal(await $(page, 'button[aria-label="Menu"].xok').count(), 1, 'the menu button is explainable');
    const undo = $(page, '.histbtns button').first();
    assert.equal(await undo.isDisabled(), true, 'Undo starts disabled');
    await tap(undo);
    await waitTip(page);
    assert.match(await tipText(page), /^Undo /, 'a disabled control can still be explained');
    assert.match(await tipText(page), /Explain mode won't run this/, 'the caveat is one uniform line, not part of the copy');
    assert.ok((await hero(page)).explain);
    await shot(page, 'phone-on');

    // Piece chips keep their own conceptual sentences; the second activation opens that piece's Guide.
    const opensChip = $(page, '.pchip').filter({ hasText: 'Opens' }).first();
    await tap(opensChip);
    await waitTip(page);
    const opensTip = await tipText(page);
    assert.match(opensTip, /^Opens /);
    assert.match(opensTip, /Keeps .+ shut until .+ has fired/);
    const packChip = $(page, '.pchip').filter({ hasText: 'Pack' }).first();
    await tap(packChip);
    await waitTip(page);
    const packTip = await tipText(page);
    assert.match(packTip, /^Pack /);
    assert.match(packTip, /Groups entries/);
    assert.notEqual(opensTip, packTip);
    assert.doesNotMatch(packTip, /Starts setting up|Explain mode will/);
    await tap(packChip);
    await $(page, '.guide .gpage[data-anchor="pack"]').waitFor();
    assert.equal((await hero(page)).explain, false, 'the chip Guide ends Explain mode');
    await $(page, '.tab[aria-label="Canvas"]').click();
    await page.waitForTimeout(120);
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    ok('phone: piece chips explain their concept and their second tap opens the piece Guide');

    // 1–3: menu: tooltip first, then it opens; Explain stays on.
    const menuBtn = $(page, 'button[aria-label="Menu"]');
    await tap(menuBtn);
    await waitTip(page);
    assert.match(await tipText(page), /Tap again to open/, 'a navigational tooltip offers the second tap');
    assert.equal(await sheets(page), 0, 'the first tap does not open the menu');
    assert.ok((await hero(page)).explain);
    await tap(menuBtn);
    await $(page, '.sheet.menu').waitFor();
    assert.ok((await hero(page)).explain, 'opening the menu keeps Explain on');
    ok('phone: the menu opens on the second tap, not the first, and Explain stays on');

    // 4–5: a submenu row: tooltip first, then the nested sheet.
    const colors = $(page, '.sheet .opt').filter({ hasText: 'Colors' }).first();
    await tap(colors);
    await waitTip(page);
    assert.equal(await $(page, '.sheet').filter({ hasText: 'The colors of the story pieces' }).count(), 0, 'the first tap does not open Colors');
    await tap(colors);
    await $(page, '.sheet').filter({ hasText: 'The colors of the story pieces' }).waitFor();
    await page.waitForTimeout(250);
    assert.ok((await hero(page)).explain, 'nested sheets keep Explain on');
    ok('phone: a submenu row opens on the second tap and Explain survives nested sheets');

    // 9a: switching a colour choice is blocked.
    const redGreen = $(page, '.sheet .opt').filter({ hasText: 'Red-green safe' }).first();
    await tap(redGreen);
    await waitTip(page);
    await tap(redGreen);
    assert.equal(await page.evaluate(() => wihero.settings.colorMode ?? 'standard'), 'standard', 'a colour choice was not picked');
    ok('phone: a choice inside a nested sheet is tooltip-only and changes no setting');

    // 8: close/back one layer through two stages, and stay in Explain.
    await tapAt(372, 60);
    await waitTip(page);
    assert.ok(await sheets(page) > 0, 'the first scrim tap only explains closing');
    await tapAt(372, 60);
    await page.waitForTimeout(150);
    assert.equal(await sheets(page), 0, 'the second scrim tap closes the sheet');
    assert.ok((await hero(page)).explain, 'closing a sheet keeps Explain on');
    ok('phone: the scrim closes one layer on the second tap and Explain stays on');

    // 6b: a switch row (Legend) never changes.
    await tap(menuBtn); await tap(menuBtn); // tooltip, then open
    await $(page, '.sheet.menu').waitFor();
    const legend = $(page, '.sheet .opt').filter({ hasText: 'Legend' }).first();
    const legendBefore = await page.evaluate(() => wihero.app.state.hero.legend);
    await tap(legend); await waitTip(page);
    await tap(legend);
    assert.equal(await page.evaluate(() => wihero.app.state.hero.legend), legendBefore, 'Legend did not switch');
    assert.ok(await sheets(page) > 0, 'the menu is still open after a blocked switch');
    ok('phone: a switch is tooltip-only and never changes the setting');

    // 6c: Tidy changes no canvas memory.
    const tidy = $(page, '.sheet .opt').filter({ hasText: 'Tidy layout' }).first();
    const cardsBefore = await cardsJson(page);
    await tap(tidy); await waitTip(page);
    await tap(tidy);
    assert.equal(await cardsJson(page), cardsBefore, 'Tidy did not change the canvas layout');
    assert.ok(await sheets(page) > 0, 'the menu stays open after blocked Tidy');
    await tapAt(372, 60); await tapAt(372, 60);
    await page.waitForTimeout(150);
    assert.equal(await $(page, '.layer .xok, .layer .xno, .layer .hit').count(), 0, 'closing a sheet leaves no marks in the layer');
    ok('phone: Tidy is tooltip-only and leaves the saved layout untouched');

    // 9: entry panel, row menu, and a read-only destination.
    const panelBtn = $(page, '.panelBtn');
    await tap(panelBtn);
    await waitTip(page);
    await tap(panelBtn);
    assert.equal((await hero(page)).panel, true, 'the entry panel opened on the second tap');
    await $(page, '.panel .plist').waitFor();

    const mill = $(page, '.panel .prow').filter({ hasText: 'Mill: arrival' }).first();
    await tap(mill);
    await waitTip(page);
    await tap(mill);
    await page.waitForTimeout(200);
    assert.equal(typeof (await hero(page)).active, 'number', 'the entry opened in a tab on the second tap');
    assert.ok((await hero(page)).explain, 'opening an entry tab keeps Explain on');
    await $(page, '.en h1').waitFor();
    ok('phone: an entry row opens in a tab on the second tap and Explain stays on');

    // 7: entry actions → Show on canvas, recursively; also the inspector row expands.
    const actions = $(page, 'button[aria-label="Entry actions"]').first();
    await tap(actions);
    await waitTip(page);
    await tap(actions);
    await $(page, '.sheet').waitFor();
    await page.waitForTimeout(250);
    assert.equal(await $(page, '.sheet .opt').filter({ hasText: 'Show on canvas' }).count(), 0, 'entry actions no longer duplicate the panel dot');
    const inspectRow = $(page, '.sheet .opt').filter({ hasText: 'Inspect' }).first();
    await tap(inspectRow);
    await waitTip(page);
    await tap(inspectRow);
    await page.waitForTimeout(250);
    assert.ok((await hero(page)).insp, 'Inspect opened the inspector');
    assert.ok((await hero(page)).explain, 'the inspector keeps Explain on');
    await $(page, '.insp .pc[data-piece="gate"] .pct').waitFor();
    const row = $(page, '.insp .pc[data-piece="gate"] .pct').first();
    await tap(row);
    await waitTip(page);
    await tap(row);
    await page.waitForTimeout(150);
    assert.equal(await $(page, '.insp .pc[data-piece="gate"].open').count(), 1, 'the inspector piece row expanded');
    ok('phone: entry actions, Inspect and an inspector piece row all navigate on the second tap');

    // 11: a Guide destination from the inspector opens the Guide and ends Explain.
    const q = $(page, '.insp .pc[data-piece="gate"] .pq').first();
    await tap(q);
    await waitTip(page);
    await tap(q);
    await $(page, '.guide .gpage[data-anchor="opens"]').waitFor();
    assert.equal((await hero(page)).explain, false, 'the Guide ends Explain mode');
    ok('phone: the inspector "?" opens its Guide page and ends Explain mode');

    // Back through nested navigation keeps Explain on.
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    await tap(panelBtn); await tap(panelBtn);
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(100);
    assert.equal((await hero(page)).insp, null, 'Back closed the inspector');
    assert.ok((await hero(page)).explain, 'Back kept Explain on');
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(100);
    assert.equal((await hero(page)).panel, false, 'then Back closed the entry panel');
    assert.ok((await hero(page)).explain, 'Back still kept Explain on');
    ok('phone: Back through the inspector and entry panel keeps Explain mode on');

    // 12: a blocked copy: no clipboard write, no content change.
    await tap(panelBtn); await tap(panelBtn);
    await page.waitForTimeout(150);
    await tap($(page, '.panel .prow').filter({ hasText: 'Mill: arrival' }).first());
    await tap($(page, '.panel .prow').filter({ hasText: 'Mill: arrival' }).first());
    await $(page, '.en h1').waitFor();
    const contentBefore = await page.evaluate(() => JSON.stringify(wihero.library.peek('WIHero-Sample').entries));
    const copy = $(page, '.ccopy').first();
    await tap(copy); await waitTip(page);
    await tap(copy);
    assert.equal(await copied(page), 0, 'Copy content was not invoked');
    assert.equal(await page.evaluate(() => JSON.stringify(wihero.library.peek('WIHero-Sample').entries)), contentBefore);
    ok('phone: Copy content is blocked and the clipboard is untouched');

    // An unplaced card cannot be "shown": that would place it and save the canvas layout.
    await page.evaluate(() => wihero.app.back()); // close the entry tab, keeping Explain on
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).active, 'canvas', 'Back returned to the canvas');
    assert.ok((await hero(page)).explain, 'Back kept Explain on');
    assert.equal(await $(page, '.vp .card').filter({ hasText: 'Village (not gated)' }).count(), 0, 'Village starts off the canvas');
    await tap(panelBtn); await tap(panelBtn);
    await page.waitForTimeout(150);
    const village = $(page, '.panel .prow').filter({ hasText: 'Village (not gated)' }).first();
    const villageDot = village.locator('.dotc');
    const canvasBefore = await cardsJson(page);
    await tap(villageDot); await waitTip(page);
    assert.match(await tipText(page), /Lit when the entry is on the canvas/);
    assert.match(await tipText(page), /Explain mode won't run this/);
    await tap(villageDot);
    assert.equal(await cardsJson(page), canvasBefore, 'the entry panel dot did not place an unplaced card');
    assert.ok((await hero(page)).explain, 'the blocked placement kept Explain on');
    assert.equal((await hero(page)).panel, true, 'the blocked placement stayed in the entry panel');
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).panel, false, 'Back closed the entry panel');
    assert.ok((await hero(page)).explain);
    ok('phone: the entry panel dot is the place/find affordance, and it is blocked for an unplaced card');

    // 10: Preview: source picker opens, its choice is blocked; a highlight explains; Open entry navigates.
    await $(page, '.tab[aria-label="Canvas"]').click();
    await page.evaluate(() => {
        const H = wihero.app.state.hero;
        H.pv = { seed: 'fresh', user: 'I take the old road', reply: 'The mill appears.', edit: null, page: null };
        wihero.app.refresh();
    });
    const previewTab = $(page, '.tab[aria-label="Preview"]');
    await tap(previewTab); await waitTip(page);
    await tap(previewTab);
    await $(page, '.ppage').first().waitFor();
    assert.ok((await hero(page)).explain, 'Preview keeps Explain on');
    await page.waitForTimeout(200);
    const srcChip = $(page, '.srcchip');
    const seedBefore = await page.evaluate(() => wihero.app.state.hero.pv?.seed);
    await tap(srcChip); await waitTip(page);
    await tap(srcChip);
    await $(page, '.sheet').filter({ hasText: 'Fresh start' }).waitFor();
    const chatSeed = $(page, '.sheet .opt').filter({ hasText: 'Fresh start' }).first();
    await tap(chatSeed); await waitTip(page);
    await tap(chatSeed);
    assert.equal(await page.evaluate(() => wihero.app.state.hero.pv?.seed), seedBefore, 'the Preview seed did not change');
    await tapAt(372, 60); await tapAt(372, 60);
    await page.waitForTimeout(150);
    const hit = $(page, '.hlx').filter({ hasText: 'road' }).first();
    await tap(hit); await waitTip(page);
    await tap(hit);
    await $(page, '.sheet.explain').waitFor();
    const open = $(page, '.sheet.explain .opt').filter({ hasText: 'Open entry' }).first();
    await tap(open); await waitTip(page);
    await tap(open);
    await page.waitForTimeout(200);
    assert.equal(typeof (await hero(page)).active, 'number', 'Open entry opened a tab');
    assert.ok((await hero(page)).explain, 'Open entry keeps Explain on');
    ok('phone: Preview source choice is blocked; a highlight and Open entry navigate safely');

    // 14: one finger still pans the canvas.
    await tap($(page, '.tab[aria-label="Canvas"]'));
    await tap($(page, '.tab[aria-label="Canvas"]'));
    await page.waitForTimeout(150);
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
    ok('phone: one finger on empty canvas still pans in Explain mode');

    // §5: a press that is not the armed control ends the first activation, a pan included.
    await tap(panelBtn);
    await waitTip(page);
    await swipe(T, spot, { x: spot.x + 60, y: spot.y + 40 });
    await T([]);
    await page.waitForTimeout(150);
    await tap(panelBtn);
    assert.equal((await hero(page)).panel, false, 'panning cleared the armed control');
    assert.ok(await $(page, '.explaintip').count() > 0, 'the next tap only explains it again');
    await tapAt(10, 300);
    ok('phone: panning clears the armed control, so a later tap only explains');

    // Back from Preview's report returns to Preview, then to Canvas, keeping Explain until the Canvas root.
    await tap(previewTab); await waitTip(page);
    await tap(previewTab);
    await page.waitForTimeout(200);
    const reportBtn = $(page, '.report').first();
    await tap(reportBtn); await waitTip(page);
    await tap(reportBtn);
    await $(page, '.rtitle').waitFor();
    assert.equal(await page.evaluate(() => wihero.app.state.hero.pv?.page), 'report');
    assert.ok((await hero(page)).explain);
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => wihero.app.state.hero.pv?.page), null, 'Back left the report');
    assert.equal((await hero(page)).active, 'preview', 'and stayed in Preview');
    assert.ok((await hero(page)).explain, 'Back from the report kept Explain on');
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).active, 'canvas', 'Back left Preview for Canvas');
    assert.ok((await hero(page)).explain, 'Back from Preview kept Explain on');
    await page.evaluate(() => wihero.app.back());
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).explain, false, 'Back at the Canvas root ended Explain');
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    ok('phone: Preview report → Preview → Canvas keeps Explain on; only the Canvas root ends it');

    // 13: long press a canvas concept reaches its Guide page.
    const jc = await centre($(page, '.vp .packframe').first().locator('.pn'));
    await swipe(T, jc, jc, { hold: 650 });
    await T([]);
    await $(page, '.guide .gpage[data-anchor="pack"]').waitFor();
    assert.equal((await hero(page)).explain, false, 'the Guide ends Explain mode');
    ok('phone: a long press on a pack name opens the Guide at Pack');

    // 12 (Done): ends and clears everything.
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.explainq').click();
    await $(page, '.explainban button').click();
    await page.waitForTimeout(120);
    assert.equal(await $(page, '.explainban').count(), 0);
    assert.equal(await $(page, '.xno').count(), 0, 'nothing left set aside');
    assert.equal(await $(page, '.explaintip').count(), 0);
    ok('phone: Done ends Explain mode and clears outlines and tooltips');
    await page.context().close();
}

async function narrow() {
    const page = await open(320, 700, { hasTouch: true, isMobile: true });
    await $(page, '.explainq').click();
    await $(page, '.explainban').waitFor();
    await page.waitForTimeout(150);
    const b = await $(page, '.explainban').boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 320, `the banner fits a 320 px screen (${b.x} + ${b.width})`);
    assert.match(await $(page, '.explainban span').innerText(), /Tap again to follow/);
    ok('phone: the Explain banner fits a 320 px screen');
    await page.context().close();
}

async function desktop() {
    const page = await open(1366, 768);
    await $(page, '.tright .explainq').click();
    await $(page, '.explainban').waitFor();

    // Hover shows a tip without arming; one click arms (More appears), a second follows the Guide.
    const pill = $(page, '.lockp').first();
    await pill.hover();
    await $(page, '.explaintip').waitFor();
    assert.match(await tipText(page), /^(Lock|Wait) Holds its rule/);
    assert.equal(await $(page, '.explaintip button').count(), 0, 'hover: no More button');
    await shot(page, 'desk-hover');
    await pill.click();
    await $(page, '.explaintip button').waitFor();
    assert.equal(await $(page, '.guide').count(), 0, 'the first click did not open the Guide');
    await shot(page, 'desk-armed');
    await pill.click();
    await $(page, '.guide .gpage[data-anchor="lock"], .guide .gpage[data-anchor="wait"]').first().waitFor();
    ok('desktop: hover shows a tip; the first click arms; the second opens the Guide');

    // Keyboard shortcuts cannot mutate behind Explain's tooltip-first contract.
    await $(page, '.tab[aria-label="Canvas"]').click();
    await page.waitForTimeout(120);
    await $(page, '.vp .card').first().waitFor();
    const millCard = $(page, '.vp .card').filter({ hasText: 'Mill' }).first();
    await millCard.click();
    await page.waitForTimeout(120);
    assert.ok(await $(page, '.vp .card.picked').count() > 0, 'a canvas card is selected');
    const entriesBeforeKeys = await booksJson(page);
    const cardsBeforeKeys = await cardsJson(page);
    await $(page, '.tright .explainq').click();
    await $(page, '.explainban').waitFor();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    assert.equal(await booksJson(page), entriesBeforeKeys, 'Ctrl+D did not duplicate an entry');
    assert.ok((await hero(page)).explain, 'Ctrl+D kept Explain on');
    await page.keyboard.press('t');
    await page.waitForTimeout(150);
    assert.equal(await cardsJson(page), cardsBeforeKeys, 'T did not run Tidy');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    assert.equal(await cardsJson(page), cardsBeforeKeys, 'Delete did not take a card off the canvas');
    assert.equal(await booksJson(page), entriesBeforeKeys, 'no keyboard shortcut changed the book');
    assert.ok((await hero(page)).explain, 'the blocked shortcuts kept Explain on');
    await page.keyboard.press('?');
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).explain, false, '? still ends Explain mode');
    assert.equal(await page.locator('#wihero-editor').evaluate(n => n.hidden), false, '? did not close WI Hero');
    ok('desktop: Ctrl+D, Tidy and Delete cannot mutate in Explain mode; ? still ends it');

    // Hover must not count as activation one: one click on the menu arms, the second opens.
    await $(page, '.tright .explainq').click();
    await $(page, '.explainban').waitFor();
    const menuBtn = $(page, 'button[aria-label="Menu"]');
    await menuBtn.hover();
    await page.waitForTimeout(350);
    await menuBtn.click();
    await waitTip(page);
    assert.equal(await sheets(page), 0, 'a hovered control still needs two clicks');
    await menuBtn.click();
    await $(page, '.sheet.menu').waitFor();
    assert.ok(await $(page, '.sheet.menu .opt.xok').count() > 3, 'popup rows are marked explainable');
    ok('desktop: hover does not count as the first activation; a popup menu receives Explain marks');

    // A blocked command does nothing after repeated clicks.
    const cardsBefore = await cardsJson(page);
    const tidy = $(page, '.sheet .opt').filter({ hasText: 'Tidy layout' }).first();
    await tidy.click(); await waitTip(page);
    await tidy.click();
    assert.equal(await cardsJson(page), cardsBefore, 'Tidy changed nothing');
    assert.ok(await sheets(page) > 0, 'the menu stayed open');
    ok('desktop: Tidy is tooltip-only and changes no layout');

    // Escape ends Explain without closing WI Hero.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    assert.equal((await hero(page)).explain, false, 'Escape ended Explain mode');
    assert.equal(await page.locator('#wihero-editor').evaluate(n => n.hidden), false, 'WI Hero stayed open');
    ok('desktop: Escape ends Explain mode without closing WI Hero');

    // Nested Preview: highlight explanation and report rows navigate; Explain survives.
    await page.mouse.click(1200, 400); // close the still-open menu
    await page.waitForTimeout(100);
    await $(page, '.tright .explainq').click();
    await page.evaluate(() => {
        const H = wihero.app.state.hero;
        H.pv = { seed: 'fresh', user: 'I follow the old road', reply: 'The mill appears.', edit: null, page: null };
        wihero.app.refresh();
    });
    const previewTab = $(page, '.tab[aria-label="Preview"]');
    await previewTab.click();
    await page.waitForTimeout(100);
    await previewTab.click();
    await page.waitForTimeout(200);
    assert.ok((await hero(page)).explain, 'Preview keeps Explain on');
    const reportRow = $(page, '.prep .rrow').first();
    if (await reportRow.count()) {
        await reportRow.click(); await waitTip(page);
        await reportRow.click();
        await page.waitForTimeout(200);
        assert.ok((await hero(page)).insp, 'a report row jumped to the card');
        assert.ok((await hero(page)).explain, 'the report row kept Explain on');
        await previewTab.click(); await waitTip(page);
        await previewTab.click();
        await page.waitForTimeout(200);
    }
    const hit = $(page, '.hlx').filter({ hasText: 'road' }).first();
    await hit.click(); await waitTip(page);
    await hit.click();
    await $(page, '.sheet.explain').waitFor();
    const openRow = $(page, '.sheet.explain .opt').filter({ hasText: 'Open entry' }).first();
    await openRow.click(); await waitTip(page);
    await openRow.click();
    await page.waitForTimeout(200);
    assert.equal(typeof (await hero(page)).active, 'number', 'Open entry opened a tab');
    assert.ok((await hero(page)).explain, 'nested Preview navigation keeps Explain on');
    const actions = $(page, 'button[aria-label="Entry actions"]').first();
    await actions.click(); await waitTip(page);
    await actions.click();
    await $(page, '.sheet').waitFor();
    await page.waitForTimeout(150);
    const inspectRow = $(page, '.sheet .opt').filter({ hasText: 'Inspect' }).first();
    await inspectRow.click(); await waitTip(page);
    await inspectRow.click();
    await page.waitForTimeout(200);
    assert.ok((await hero(page)).insp, 'Inspect opened the inspector');
    assert.ok((await hero(page)).explain, 'the inspector keeps Explain on');
    ok('desktop: a Preview highlight, Open entry and Inspect navigate safely and keep Explain on');
    await shot(page, 'desk-preview');
    await page.context().close();
}

try {
    await phone();
    await narrow();
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
