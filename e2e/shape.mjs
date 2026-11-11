// Link shaping checks (the link engine's editing UI) in the browser harness, like desktop.mjs: no SillyTavern needed.
// Desktop at 1366 × 768 and a phone at 390 × 844: a tapped line shows its dots, a ghost dot dragged bends it, the
// strip's line types, Flip and Reset, a dot picked and removed, double-click to add one, Cancel putting the shape
// back, a tap on empty canvas as Done, Reset shape in the strip, and edge-scrolling a card. Screenshots go to
// e2e/log/shape-*.png.
//   node e2e/shape.mjs
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
const shot = (page, name) => page.screenshot({ path: `${LOG}shape-${name}.png` });

async function open(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    await page.evaluate(() => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = 'WIHero-Sample'; wihero.app.refresh(); });
    await $(page, '.vp .card').first().waitFor();
    await page.waitForTimeout(300);
    return page;
}
const R = 'document.querySelector("#wihero-editor").shadowRoot';
/** Screen points of a link: { mid, at(f) } of the first line between two cards that's on screen. */
const lineAt = (page, ends, f = 0.5, below = 140) => page.evaluate(([ends, f, R, below]) => {
    const root = eval(R);
    const vp = root.querySelector('.vp').getBoundingClientRect();
    for (const p of root.querySelectorAll('svg.lk path.lhit')) {
        if (ends && p.dataset.ends !== ends) continue;
        const L = p.getTotalLength();
        if (L < 120) continue;
        const q = p.getPointAtLength(L * f);
        const m = p.getScreenCTM();
        const x = m.a * q.x + m.c * q.y + m.e; const y = m.b * q.x + m.d * q.y + m.f;
        if (x > vp.left + 40 && x < vp.right - 40 && y > vp.top + 40 && y < vp.bottom - below) return { x, y, ends: p.dataset.ends, id: p.dataset.lid };
    }
    return null;
}, [ends, f, R, below]);
const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const shapes = page => page.evaluate(() => Object.fromEntries(Object.entries(wihero.settings.books['WIHero-Sample'].canvas.cards).filter(([, c]) => c.links).map(([k, c]) => [k, c.links])));
const lineD = (page, id) => page.evaluate(([id, R]) => [...eval(R).querySelectorAll('svg.lk path.lhit')].find(p => p.dataset.lid === id)?.getAttribute('d'), [id, R]);
/** A screen point on bare canvas. */
const emptyAt = async page => {
    const b = await $(page, '.vp').boundingBox();
    return page.evaluate(([R, b]) => {
        const root = eval(R);
        for (let y = b.y + 60; y < b.y + b.height - 100; y += 17) for (let x = b.x + 60; x < b.x + b.width - 60; x += 23) {
            const n = root.elementFromPoint(x, y);
            if (n?.classList.contains('vp') || n?.classList.contains('world')) return { x, y };
        }
        return null;
    }, [R, b]);
};
const drag = async (page, from, to, steps = 12) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up(); await page.waitForTimeout(150); };

async function desktop() {
    const page = await open(1366, 768);
    const ln = await lineAt(page, null);
    assert.ok(ln, 'a line on screen');
    await page.mouse.click(ln.x, ln.y);
    await $(page, '.pstrip .pshape').waitFor();
    assert.equal(await $(page, '.vp.shaping').count(), 1);
    assert.equal(await $(page, 'svg.hd .ghost').count(), 1, 'one ghost dot on an unshaped line');
    assert.equal(await $(page, 'svg.hd .sdot').count(), 0);
    ok('1366: a clicked line opens its strip with the Shape row, the others fade, one ghost dot');
    await shot(page, 'desk-selected');

    // Drag the ghost: a dot, on the grid, stored on the source card.
    const before = await lineD(page, ln.id);
    const g = await centre($(page, 'svg.hd .ghost'));
    await drag(page, g, { x: g.x + 37, y: g.y - 61 });
    assert.equal(await $(page, 'svg.hd .sdot').count(), 1, 'the ghost became a dot');
    assert.equal(await $(page, 'svg.hd .ghost').count(), 2, 'a ghost on each part');
    assert.notEqual(await lineD(page, ln.id), before, 'the line moved');
    const s1 = await shapes(page);
    const [from] = ln.ends.split('>');
    assert.equal(Object.values(s1[from] ?? {})[0]?.dots.length, 1, 'stored on the source card');
    ok('1366: dragging the ghost dot makes a dot and bends the line, stored with the link');
    await shot(page, 'desk-dot');

    // Line types: Arc, Straight by key 3, Flip.
    const d1 = await lineD(page, ln.id);
    await $(page, '.pshape button').filter({ hasText: 'Arc' }).click();
    await page.waitForTimeout(100);
    const d2 = await lineD(page, ln.id);
    assert.notEqual(d2, d1, 'Arc changes the line');
    await page.keyboard.press('3');
    await page.waitForTimeout(100);
    assert.equal(await $(page, '.pshape button.on').textContent(), 'Straight', '3 picks Straight');
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    await page.keyboard.press('x');
    await page.waitForTimeout(100);
    assert.equal(await $(page, '.pshape .pbtn.on').filter({ hasText: 'Flip' }).count(), 1, 'X flips');
    ok('1366: the line types by click and by keys 1–4, X flips');

    // Pick the dot, Delete removes it.
    const dot = await centre($(page, 'svg.hd .sdot'));
    await page.mouse.click(dot.x, dot.y);
    await $(page, '.pstrip button').filter({ hasText: 'Remove dot' }).waitFor();
    await page.waitForTimeout(400); // not a double click
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    assert.equal(await $(page, 'svg.hd .sdot').count(), 0, 'Delete took the dot away');
    ok('1366: a clicked dot is picked; Delete removes it');

    // Double-click the line adds a dot; double-click the dot removes it.
    const p2 = await lineAt(page, ln.ends, 0.3);
    await page.mouse.dblclick(p2.x, p2.y);
    await page.waitForTimeout(150);
    assert.equal(await $(page, 'svg.hd .sdot').count(), 1, 'double-click adds a dot');
    const dd = await centre($(page, 'svg.hd .sdot'));
    await page.mouse.dblclick(dd.x, dd.y);
    await page.waitForTimeout(150);
    assert.equal(await $(page, 'svg.hd .sdot').count(), 0, 'double-click on a dot removes it');
    ok('1366: double-click on the line adds a dot, on a dot removes it');

    // Cancel puts the shape back as it was when the strip opened (no shape).
    const g2 = await centre($(page, 'svg.hd .ghost'));
    await drag(page, g2, { x: g2.x + 20, y: g2.y + 50 });
    await $(page, '.pstrip .pbtn').filter({ hasText: 'Cancel' }).click();
    await page.waitForTimeout(150);
    assert.equal(await $(page, '.vp.shaping').count(), 0);
    assert.equal(Object.keys(await shapes(page)).length, 0, 'Cancel restored the shape');
    ok('1366: Cancel puts the shape back');

    // Shape again, then a click on empty canvas is Done and keeps it.
    const ln2 = await lineAt(page, ln.ends);
    await page.mouse.click(ln2.x, ln2.y);
    await $(page, '.pstrip .pshape').waitFor();
    const g3 = await centre($(page, 'svg.hd .ghost'));
    await drag(page, g3, { x: g3.x - 30, y: g3.y + 40 });
    const empty = await emptyAt(page);
    await page.mouse.click(empty.x, empty.y);
    await page.waitForTimeout(200);
    assert.equal(await $(page, '.pstrip').count(), 0, 'the strip closed');
    assert.equal(Object.keys(await shapes(page)).length, 1, 'the shape stayed');
    ok('1366: a click on empty canvas is Done and keeps the shape');
    await shot(page, 'desk-done');

    // The line's strip has Reset shape (the right-click menu is gone: the right button only moves the view).
    const ln3 = await lineAt(page, ln.ends);
    await page.mouse.click(ln3.x, ln3.y);
    await $(page, '.pstrip button').filter({ hasText: 'Reset shape' }).click();
    await page.waitForTimeout(150);
    assert.equal(Object.keys(await shapes(page)).length, 0, 'Reset shape from the strip');
    await $(page, '.pstrip .pbtn').filter({ hasText: 'Done' }).click();
    await page.waitForTimeout(150);
    ok('1366: the line\'s strip resets its shape');

    // Edge-scrolling: a card held at the view's edge moves the camera.
    const cam0 = await page.evaluate(() => ({ ...wihero.settings.books['WIHero-Sample'].canvas.camera }));
    const c = await centre($(page, '.vp .card').first());
    const vb = await $(page, '.vp').boundingBox();
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(vb.x + vb.width - 6, c.y, { steps: 10 });
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const cam1 = await page.evaluate(() => ({ ...wihero.settings.books['WIHero-Sample'].canvas.camera }));
    assert.ok(cam1.x < cam0.x - 50, `the camera scrolled (${cam0.x} → ${cam1.x})`);
    ok('1366: a card held at the view\'s edge scrolls the canvas');
    await page.close();
}

async function phone() {
    const page = await open(390, 844);
    const e0 = await emptyAt(page);
    await drag(page, e0, { x: e0.x - 110, y: e0.y });
    const ln = await lineAt(page, 'id:fork>id:left');
    assert.ok(ln, 'a line on screen');
    await page.mouse.click(ln.x, ln.y);
    await $(page, '.pstrip .pshape').waitFor();
    const hit = await page.evaluate(R => { const c = eval(R).querySelector('svg.hd .hhit').getBoundingClientRect(); return c.width; }, R);
    assert.ok(hit >= 31, `the ghost dot's hit area is 32px (${hit})`);
    const g = await centre($(page, 'svg.hd .ghost'));
    await drag(page, g, { x: g.x + 50, y: g.y + 4 });
    assert.equal(await $(page, 'svg.hd .sdot').count(), 1);
    ok('phone: a tapped line shows its handles; a ghost dot drags out a dot');
    await shot(page, 'phone');
    await page.close();
}

try {
    await desktop();
    await phone();
    assert.deepEqual(errors, []);
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
