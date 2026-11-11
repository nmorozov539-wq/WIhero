// Canvas controls in the browser harness (like desktop.mjs: no SillyTavern needed). Desktop at 1366 × 768: the right
// button moves the view from anywhere and opens no menu, middle and Space+drag pan, a left-drag on empty canvas
// selects (Shift adds), the wheel zooms by the scroll's size (Ctrl zooms, Shift pans sideways, the Scroll setting
// pans), F fits the selection, Shift+0 and the zoom label go to 100%, the card's ⋯ and Shift+F10, a link dropped near
// a card (the magnet), on its own card (nothing) or on empty canvas (Add to canvas here, already linked), a double
// click on empty canvas, a hovered line lighting its cards, P packing a selection, Ctrl D, and Esc stopping at the
// canvas. A phone at 390 × 844 with real touch points (CDP): two fingers pan while they zoom, one finger lifted
// carries on, a third is ignored, a second finger during a grip drag is ignored, a two-finger tap undoes, a loose end
// let go on empty canvas offers Place an entry here, and the inspector's order (Edit text first, Data last).
// Screenshots go to e2e/log/controls-*.png.
//   node e2e/controls.mjs
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
const shot = (page, name) => page.screenshot({ path: `${LOG}controls-${name}.png` });
const BOOK = 'WIHero-Sample';
const R = 'document.querySelector("#wihero-editor").shadowRoot';

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
const card = (page, name) => $(page, '.card').filter({ hasText: name }).first();
const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const cam = page => page.evaluate(b => ({ ...wihero.settings.books[b].canvas.camera }), BOOK);
const liveCam = page => page.evaluate(R => { const t = eval(R).querySelector('.world').style.transform; const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/); return { x: +m[1], y: +m[2], zoom: +m[3] }; }, R);
const entries = page => page.evaluate(b => Object.values(wihero.library.peek(b).entries), BOOK);
const cfg = e => e.extensions?.wihero ?? e.wihero ?? {};
/** A screen point on bare canvas, away from cards and lines, optionally inside a region. */
const emptyAt = async (page, from = 0.15, to = 0.85, reach = 14) => {
    const b = await $(page, '.vp').boundingBox();
    return page.evaluate(([R, b, from, to, reach]) => {
        const root = eval(R);
        const free = (x, y) => { for (let dx = -reach; dx <= reach; dx += 7) for (let dy = -reach; dy <= reach; dy += 7) { const n = root.elementFromPoint(x + dx, y + dy); if (!(n?.classList.contains('vp') || n?.classList.contains('world'))) return false; } return true; };
        for (let y = b.y + b.height * from; y < b.y + b.height * to; y += 13) for (let x = b.x + b.width * from; x < b.x + b.width * to; x += 17) if (free(x, y)) return { x, y };
        return null;
    }, [R, b, from, to, reach]);
};
const lineAt = (page, f = 0.5) => page.evaluate(([R, f]) => {
    const root = eval(R);
    const vp = root.querySelector('.vp').getBoundingClientRect();
    for (const p of root.querySelectorAll('svg.lk path.lhit')) {
        const L = p.getTotalLength();
        if (L < 140) continue;
        const q = p.getPointAtLength(L * f);
        const m = p.getScreenCTM();
        const x = m.a * q.x + m.c * q.y + m.e; const y = m.b * q.x + m.d * q.y + m.f;
        if (x < vp.left + 40 || x > vp.right - 40 || y < vp.top + 40 || y > vp.bottom - 140) continue;
        if (!root.elementsFromPoint(x, y).includes(p) || root.elementFromPoint(x, y)?.closest?.('.card')) continue;
        return { x, y, ends: p.dataset.ends };
    }
    return null;
}, [R, f]);

async function desktop() {
    const page = await open(1366, 768);

    // Right-drag over a card pans, and no menu opens.
    const ferry = await centre(card(page, 'Ferry (sticky'));
    const c0 = await cam(page);
    const pos0 = await page.evaluate(b => ({ ...wihero.settings.books[b].canvas.cards['id:ferry'] }), BOOK);
    await page.mouse.move(ferry.x, ferry.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(ferry.x + 120, ferry.y + 60, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(600);
    let c1 = await cam(page);
    assert.ok(Math.abs(c1.x - c0.x - 120) < 2 && Math.abs(c1.y - c0.y - 60) < 2, `right-drag over a card pans (${c0.x},${c0.y} → ${c1.x},${c1.y})`);
    const pos1 = await page.evaluate(b => ({ ...wihero.settings.books[b].canvas.cards['id:ferry'] }), BOOK);
    assert.deepEqual(pos1, pos0, 'the card stayed where it was');
    assert.equal(await $(page, '.sheet').count(), 0, 'no menu');
    await page.mouse.click(ferry.x + 120, ferry.y + 60, { button: 'right' });
    await page.waitForTimeout(200);
    assert.equal(await $(page, '.sheet').count(), 0, 'a right-click without moving opens nothing');
    ok('1366: right-drag over a card pans the view and moves no card; a right-click opens no menu');

    // Middle-drag and Space+drag pan from anywhere too.
    let e0 = await emptyAt(page);
    c1 = await cam(page);
    await page.mouse.move(e0.x, e0.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(e0.x - 80, e0.y, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(600);
    let c2 = await cam(page);
    assert.ok(Math.abs(c2.x - c1.x + 80) < 2, `middle-drag pans (${c1.x} → ${c2.x})`);
    const mill = await centre(card(page, 'Mill: arrival'));
    await page.mouse.move(mill.x, mill.y);
    await page.keyboard.down(' ');
    await page.mouse.down();
    await page.mouse.move(mill.x, mill.y + 70, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    await page.waitForTimeout(600);
    const c3 = await cam(page);
    assert.ok(Math.abs(c3.y - c2.y - 70) < 2, `Space+drag over a card pans (${c2.y} → ${c3.y})`);
    ok('1366: middle-drag and Space+drag pan, even starting on a card');

    // Wheel: a notch zooms about 10% around the pointer; Ctrl zooms; Shift pans sideways; the Scroll setting pans.
    e0 = await emptyAt(page);
    await page.mouse.move(e0.x, e0.y);
    let z0 = (await liveCam(page)).zoom;
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    let z1 = (await liveCam(page)).zoom;
    assert.ok(z1 < z0 && z1 > z0 * 0.88, `a notch zooms out about 10% (${z0} → ${z1})`);
    await page.mouse.wheel(0, 8);
    await page.waitForTimeout(100);
    const z2 = (await liveCam(page)).zoom;
    assert.ok(z2 < z1 && z2 > z1 * 0.98, `a small trackpad event zooms a little (${z1} → ${z2})`);
    let v0 = await liveCam(page);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 60);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
    let v1 = await liveCam(page);
    assert.ok(Math.abs(v1.x - v0.x + 60) < 2 && v1.zoom === v0.zoom, `Shift+wheel pans sideways (${v0.x} → ${v1.x})`);
    await page.evaluate(() => { wihero.settings.desk.wheel = 'scroll'; });
    v0 = await liveCam(page);
    await page.mouse.wheel(30, 50);
    await page.waitForTimeout(100);
    v1 = await liveCam(page);
    assert.ok(Math.abs(v1.x - v0.x + 30) < 2 && Math.abs(v1.y - v0.y + 50) < 2 && v1.zoom === v0.zoom, 'Scroll: the wheel pans');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -5);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    assert.ok((await liveCam(page)).zoom > v1.zoom, 'Scroll: Ctrl+wheel (a pinch) still zooms');
    await page.evaluate(() => { wihero.settings.desk.wheel = 'zoom'; });
    ok('1366: the wheel zooms by the size of the scroll; Ctrl zooms, Shift pans sideways, the Scroll setting pans');

    // ☰ › Canvas has the Mouse wheel switch.
    await $(page, '.tabbar .iconbtn').first().click();
    await $(page, '.sheet').getByText('Mouse wheel').waitFor();
    await page.keyboard.press('Escape');
    ok('1366: ☰ › Canvas offers Mouse wheel: Zoom or Scroll');

    // Shift+0 and the zoom label go to 100%.
    await page.keyboard.press('Shift+Digit0');
    await page.waitForTimeout(100);
    assert.equal((await liveCam(page)).zoom, 1);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
    await $(page, '.zlabel').click();
    await page.waitForTimeout(100);
    assert.equal((await liveCam(page)).zoom, 1);
    assert.equal(await $(page, '.zlabel').textContent(), '100%');
    ok('1366: Shift+0 and a click on the zoom label go to 100%');

    // A left-drag on empty canvas selects; Shift adds; no pack-name box; P asks for one.
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    const a = await card(page, 'Left path').boundingBox();
    const z = await card(page, 'Right path').boundingBox();
    const boxAround = async (b, mods = []) => {
        for (const m of mods) await page.keyboard.down(m);
        await page.mouse.move(b.x - 10, b.y - 10);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width + 8, b.y + b.height + 8, { steps: 5 });
        await page.mouse.up();
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(150);
    };
    await boxAround(a);
    const picked = () => page.evaluate(R => [...eval(R).querySelectorAll('.card.picked')].map(n => n.dataset.id), R);
    assert.deepEqual(await picked(), ['id:left']);
    await boxAround(z, ['Shift']);
    assert.deepEqual((await picked()).sort(), ['id:left', 'id:right']);
    assert.equal(await $(page, '.lasso').count(), 0, 'no pack-name box after a box');
    await shot(page, 'box');
    ok('1366: a left-drag on empty canvas selects; Shift-drag adds to it; no pack prompt');

    // F fits the selection.
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    const zSel = (await liveCam(page)).zoom;
    const la = await card(page, 'Left path').boundingBox();
    const vb = await $(page, '.vp').boundingBox();
    assert.ok(la.x > vb.x && la.x + la.width < vb.x + vb.width, 'the picked cards are in view');
    assert.ok(zSel >= 0.99, `fitting two cards zooms in to 100% (${zSel})`);

    // P with several selected: the pack-name box under them.
    await page.keyboard.press('p');
    await $(page, '.lasso input').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await $(page, '.lasso').count(), 0);
    ok('1366: F fits the selected cards; P with several selected asks for a pack name');

    // Ctrl D duplicates the selected cards, without links, placed beside them and selected.
    const before = await entries(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    const after = await entries(page);
    assert.equal(after.length, before.length + 2, 'two copies');
    const copies = after.filter(e => !before.some(b => b.uid === e.uid));
    for (const c of copies) {
        assert.match(c.comment, / copy$/);
        for (const f of ['gate', 'gatesFor', 'closeGate', 'closesFor', 'switch']) assert.ok(!cfg(c)[f], `${c.comment} has no ${f}`);
    }
    assert.equal((await picked()).length, 2, 'the copies are selected');
    await $(page, '.toast').getByText(/without links/).waitFor();
    await shot(page, 'duplicate');
    ok('1366: Ctrl D duplicates the selected cards without their links, selected');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    assert.equal((await entries(page)).length, before.length, 'Ctrl Z takes the copies away');
    ok('1366: Ctrl Z undoes the duplicate');

    // The card's ⋯, and Shift+F10 on a selected card.
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    await card(page, 'Rumor').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+F10');
    await $(page, '.sheet').filter({ hasText: 'Add piece' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    ok('1366: Shift+F10 opens the selected card\'s menu');

    // A link dragged from a handle: let go on its own card = nothing; near a card = linked (magnet).
    const linkDrag = async (from, to) => {
        await card(page, from).hover();
        const hh = await $(page, '.hh.open').boundingBox();
        await page.mouse.move(hh.x + 7, hh.y + 7);
        await page.mouse.down();
        await page.mouse.move(hh.x + 40, hh.y + 60, { steps: 4 });
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(250);
    };
    const src = await card(page, 'Left path').boundingBox();
    await linkDrag('Left path', { x: src.x + 30, y: src.y + 10 });
    assert.equal(await $(page, '.pstrip').count(), 0, 'let go on its own card: nothing');
    assert.equal(await $(page, '.sheet').count(), 0);
    const tgt = await card(page, 'Rumor').boundingBox();
    await linkDrag('Left path', { x: tgt.x + tgt.width + 12, y: tgt.y + tgt.height / 2 });
    await $(page, '.pstrip').filter({ hasText: 'waits for' }).waitFor();
    assert.match(await $(page, '.pstrip').textContent(), /Rumor/);
    ok('1366: a link let go on its own card does nothing; 12px off a card it snaps to it (magnet)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Let go on empty canvas: Add to canvas here, and the entry picked arrives already linked.
    const spot = await emptyAt(page, 0.55, 0.8, 42); // beyond the 24px magnet of any card
    await linkDrag('Left path', spot);
    await $(page, '.sheet').filter({ hasText: 'Add to canvas here' }).waitFor();
    await shot(page, 'link-empty');
    const pick = (await $(page, '.sheet .opt').nth(1).textContent()).trim(); // the first entry after New entry here
    await $(page, '.sheet .opt').nth(1).click();
    await $(page, '.pstrip').filter({ hasText: 'waits for' }).waitFor();
    assert.match(await $(page, '.pstrip').textContent(), new RegExp(pick.replace(/[()]/g, '.')));
    const placed = await card(page, pick).boundingBox();
    assert.ok(Math.hypot(placed.x + placed.width / 2 - spot.x, placed.y + placed.height / 2 - spot.y) < 60, 'placed where the link was let go');
    ok(`1366: a link let go on empty canvas opens Add to canvas here; ${pick} lands there, linked, in the strip`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Double-click empty canvas: Add to canvas here.
    const e2 = await emptyAt(page);
    await page.mouse.dblclick(e2.x, e2.y);
    await $(page, '.sheet').filter({ hasText: 'Add to canvas here' }).waitFor();
    assert.equal(await $(page, '.sheet').getByText('Tidy layout').count(), 0, 'no Fit or Tidy rows in it');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    ok('1366: a double-click on empty canvas opens Add to canvas here');

    // Hovering a line lights it and its two cards.
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    const ln = await lineAt(page);
    assert.ok(ln, 'a line on screen');
    await page.mouse.move(ln.x, ln.y);
    await page.mouse.move(ln.x + 1, ln.y);
    await page.waitForTimeout(450);
    const lit = await page.evaluate(R => [...eval(R).querySelectorAll('.card.lit')].map(n => n.dataset.id).sort(), R);
    assert.ok(await $(page, '.vp.focusdim').count(), 'the rest dims');
    assert.deepEqual(lit, ln.ends.split('>').filter(k => !k.startsWith('pack:')).sort());
    await shot(page, 'line-hover');
    ok('1366: resting on a line lights it and its two cards');

    // Esc never closes WI Hero on desktop.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => !document.querySelector('#wihero-editor').hidden), 'still open');
    ok('1366: Esc steps back but never closes WI Hero');

    await page.close();
}

/** A finger on the desktop layout keeps the phone's rules: it pans where a mouse would box-select. */
async function deskTouch() {
    const page = await open(1366, 768, { hasTouch: true });
    const T = await touch(page);
    const e0 = await emptyAt(page);
    const v0 = await liveCam(page);
    for (let i = 0; i <= 5; i++) await T([[e0.x + i * 12, e0.y + i * 6]]);
    await T([]);
    await page.waitForTimeout(200);
    const v1 = await liveCam(page);
    assert.ok(Math.abs(v1.x - v0.x - 60) < 3 && Math.abs(v1.y - v0.y - 30) < 3, `a finger pans (${v0.x},${v0.y} → ${v1.x},${v1.y})`);
    assert.equal(await $(page, '.selbox').count(), 0, 'no box');
    ok('1366 touch: one finger on empty canvas pans, as on the phone');
    await page.close();
}

/**
 * Real touch points through CDP: each call gives every finger still down as [x, y] or [x, y, id] (the id defaults to
 * its place in the list). A finger left out is lifted (CDP's touchEnd releases the points it lists); an empty list
 * lifts them all.
 */
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

async function phone() {
    const page = await open(390, 844, { hasTouch: true, isMobile: true });
    const T = await touch(page);
    const e0 = await emptyAt(page, 0.3, 0.6);

    // Two fingers moving together pan (and the point under them stays under them).
    let v0 = await liveCam(page);
    await T([[e0.x - 40, e0.y], [e0.x + 40, e0.y]]);
    for (let i = 1; i <= 6; i++) await T([[e0.x - 40 + i * 10, e0.y + i * 5], [e0.x + 40 + i * 10, e0.y + i * 5]]);
    await T([]);
    await page.waitForTimeout(200);
    let v1 = await liveCam(page);
    assert.ok(Math.abs(v1.x - v0.x - 60) < 3 && Math.abs(v1.y - v0.y - 30) < 3 && Math.abs(v1.zoom - v0.zoom) < 0.01, `two fingers pan (${v0.x},${v0.y} → ${v1.x},${v1.y})`);
    // Spreading them zooms around their middle, while drifting.
    v0 = v1;
    await T([[e0.x - 40, e0.y], [e0.x + 40, e0.y]]);
    for (let i = 1; i <= 6; i++) await T([[e0.x - 40 - i * 5 + i * 4, e0.y], [e0.x + 40 + i * 5 + i * 4, e0.y]]);
    await page.waitForTimeout(100);
    v1 = await liveCam(page);
    await T([]);
    await page.waitForTimeout(200);
    const vb = await $(page, '.vp').boundingBox();
    const mx = e0.x + 24 - vb.x;
    assert.ok(v1.zoom > v0.zoom * 1.3, 'spreading zooms in');
    assert.ok(Math.abs((mx - v1.x) / v1.zoom - (e0.x - vb.x - v0.x) / v0.zoom) < 2, 'the point under the fingers stays under them');
    ok('phone: two fingers pan while they zoom');

    // One finger lifted after a pinch carries on panning; a third finger is ignored.
    v0 = await liveCam(page);
    await T([[e0.x - 40, e0.y], [e0.x + 40, e0.y]]);
    await T([[e0.x - 40, e0.y], [e0.x + 40, e0.y], [e0.x, e0.y + 100]]);
    await T([[e0.x - 30, e0.y], [e0.x + 50, e0.y], [e0.x, e0.y + 100]]);
    let mid = await liveCam(page);
    assert.ok(Math.abs(mid.x - v0.x - 10) < 3, `a third finger doesn't freeze the pinch (${v0.x} → ${mid.x})`);
    await T([[e0.x - 30, e0.y]]); // lift two: one left
    v0 = await liveCam(page);
    for (let i = 1; i <= 4; i++) await T([[e0.x - 30, e0.y + i * 15]]);
    await page.waitForTimeout(100);
    mid = await liveCam(page);
    assert.ok(Math.abs(mid.y - v0.y - 60) < 3, `the finger left pans on (${v0.y} → ${mid.y})`);
    await T([]);
    await page.waitForTimeout(150);
    assert.equal(await $(page, '.insp').count(), 0, 'lifting the last finger is no tap');
    ok('phone: one finger left after a pinch pans on, a third is ignored, and nothing counts as a tap');

    // A two-finger tap undoes. First make an edit: move a card by its grip.
    const grip = await centre($(page, '.card .grip').first());
    const id = await $(page, '.card .grip').first().evaluate(n => n.dataset.grip);
    const p0 = await page.evaluate(([b, id]) => ({ ...wihero.settings.books[b].canvas.cards[id] }), [BOOK, id]);
    await T([[grip.x, grip.y]]);
    for (let i = 1; i <= 5; i++) await T([[grip.x + i * 10, grip.y + i * 6]]);
    // A second finger during the drag is ignored: the drag carries on.
    await T([[grip.x + 50, grip.y + 30], [grip.x + 150, grip.y + 200]]);
    await T([[grip.x + 60, grip.y + 36], [grip.x + 150, grip.y + 200]]);
    await T([[grip.x + 150, grip.y + 200, 1]]); // the dragging finger lifts first
    await T([]);
    await page.waitForTimeout(300);
    const p1 = await page.evaluate(([b, id]) => ({ ...wihero.settings.books[b].canvas.cards[id] }), [BOOK, id]);
    assert.ok(p1.x !== p0.x || p1.y !== p0.y, 'the card moved');
    v0 = await liveCam(page);
    assert.ok(Math.abs(v0.zoom - mid.zoom) < 0.001, 'the second finger didn\'t pinch');
    ok('phone: a second finger during a grip drag is ignored; the drag finishes and saves');
    const e1 = await emptyAt(page);
    await T([[e1.x - 30, e1.y]]);
    await T([[e1.x - 30, e1.y], [e1.x + 30, e1.y]]);
    await T([[e1.x - 30, e1.y]]);
    await T([]);
    await $(page, '.toast').getByText('Undone').waitFor();
    const p2 = await page.evaluate(([b, id]) => ({ ...wihero.settings.books[b].canvas.cards[id] }), [BOOK, id]);
    assert.deepEqual({ x: p2.x, y: p2.y }, { x: p0.x, y: p0.y }, 'the move was undone');
    ok('phone: a two-finger tap undoes (Undone)');

    // The phone inspector: Edit text and Add note first, Take off canvas and Data last, no footer of four.
    await page.keyboard.press('f').catch(() => {});
    await $(page, '.canvas-tools button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(200);
    const c = await centre($(page, '.card .t').first());
    await T([[c.x, c.y]]);
    await T([]);
    await $(page, '.insp .iacts .iedit').waitFor();
    const order = await page.evaluate(R => [...eval(R).querySelector('.insp .ibody').children].map(n => n.className.split(' ')[0]), R);
    assert.equal(order[0], 'ihead');
    assert.equal(order[1], 'iacts', 'the action row comes right after the header');
    assert.equal(order.at(-1), 'ifoot', 'the quiet row is last');
    const foot = await $(page, '.insp .ifoot').textContent();
    assert.ok(/Data/.test(foot) && !/Open entry|Add note/.test(foot), `the bottom row: ${foot}`);
    assert.match(await $(page, '.insp .iacts').textContent(), /Edit text.*(Add|Edit) note/s);
    await shot(page, 'phone-inspector');
    ok('phone: the inspector leads with Edit text and Add note, and ends with Data');
    await $(page, '.insp .iedit').click();
    await $(page, '.en h1').waitFor();
    ok('phone: Edit text opens the entry');
    await page.close();
}

try {
    await desktop();
    await deskTouch();
    await phone();
    assert.deepEqual(errors, []);
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
