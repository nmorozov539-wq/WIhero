// The entry panel and canvas polish from the owner's Features note (2026-11-21), in the browser harness
// (e2e/desktop/harness.html), no SillyTavern needed. On a phone with real touch (CDP): nested folders, Select with
// Place, Move, On, Off and Edit…, the selection lit on the canvas, a lassoed or placed group dragged together, the
// drag ghost the size of the card it drops, the list keeping its scroll place, keyword clashes in the panel (not on
// the canvas), and no ST timing badge on cards. On desktop: Select in the docked list and Edit parameters… for a
// canvas selection. Screenshots: e2e/log/drawer-*.png.
//   node e2e/drawer.mjs
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
const shot = (page, name) => page.screenshot({ path: `${LOG}drawer-${name}.png` });
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

async function phone() {
    const page = await open(390, 844, { hasTouch: true, isMobile: true });
    const T = await touch(page);

    // No ST timing badge on cards (Features 7), and no clash count on the canvas (Features 8).
    await page.evaluate(b => wihero.library.change(b, d => { const e = Object.values(d.entries)[0]; e.sticky = 3; }), BOOK);
    await page.waitForTimeout(300);
    assert.equal(await $(page, '.card .timing').count(), 0, 'no timing badge on any card');
    // A clash: two entries share a key word.
    const keys = await page.evaluate(b => {
        const es = Object.values(wihero.library.peek(b).entries).filter(e => !String(e.comment).startsWith('Moment'));
        wihero.library.change(b, d => { d.entries[es[0].uid].key = [...(es[0].key ?? []), 'zzclash']; d.entries[es[1].uid].key = [...(es[1].key ?? []), 'zzclash']; });
        return es.map(e => e.uid);
    }, BOOK);
    await page.waitForTimeout(300);
    for (const t of await $(page, '.checkchip').allInnerTexts()) assert.doesNotMatch(t, /clash/i, 'the canvas chip says nothing about clashes');
    await $(page, '.panelBtn').click();
    await $(page, '.panel:not(.closed) .pclash').waitFor();
    assert.match(await $(page, '.pclash').innerText(), /\d+ keyword clash/);
    await $(page, '.pclash').click();
    await $(page, '.sheet:has-text("zzclash")').waitFor();
    // One card per clash word, and the key that fires on it is marked in each entry's key line.
    assert.ok(await $(page, '.sheet .clashg').count() >= 1, 'clash groups are cards');
    assert.ok(await $(page, '.sheet .clashg:has(.clashw:text-is("zzclash")) mark').count() >= 2, 'the clashing key is marked');
    await shot(page, 'clashes');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('phone: no timing badge on cards; keyword clashes are a row in the entry panel, not a chip on the canvas');

    // Nested folders (Features 2).
    const rowKeys = await $(page, '.panel .prow[data-key]').evaluateAll(ns => ns.map(n => n.dataset.key));
    await page.evaluate(([b, ks]) => {
        const f = wihero.settings.books[b].folders ??= {};
        f[ks[0]] = 'Places/Town'; f[ks[1]] = 'Places/Town'; f[ks[2]] = 'Places';
    }, [BOOK, rowKeys]);
    await refresh(page);
    if (await $(page, '.panel.closed').count()) await $(page, '.panelBtn').click();
    const places = $(page, '.panel .phdr').filter({ hasText: /^Places/ }).first();
    await places.waitFor();
    assert.equal(await places.locator('small').innerText(), '3', 'Places counts the entries in Town too');
    const town = $(page, '.panel .pgrp .phdr').filter({ hasText: 'Town' });
    assert.equal(await town.locator('small').innerText(), '2');
    assert.equal(await $(page, '.panel .pgrp .pgrp .prow').count(), 2, 'Town\'s two entries sit inside Places');
    await shot(page, 'folders');
    ok('phone: folders nest in the entry panel (Places › Town), each counting what is inside it');

    // Select, then Place (Features 1): pick two entries that aren't on the canvas.
    const off = await $(page, '.panel .prow:has(.dotc:not(.in))').evaluateAll(ns => ns.map(n => n.dataset.key));
    assert.ok(off.length >= 2, `at least two entries off the canvas (${off.length})`);
    // The toggle redraws only the list: the panel button stays the same element, so it doesn't jump.
    await $(page, '.panelBtn').evaluate(n => { n.dataset.mark = '1'; });
    await $(page, '.panel .ptools button[aria-label="Select entries"]').click();
    assert.equal(await $(page, '.panelBtn[data-mark="1"]').count(), 1, 'the panel button wasn\'t rebuilt');
    for (const k of off.slice(0, 2)) await $(page, `.panel .prow[data-key="${k}"] .nm`).click();
    assert.match(await $(page, '.pselhead .cnt').innerText(), /2 selected/);
    assert.equal(await $(page, '.panel .prow.sel').count(), 2);
    await shot(page, 'select');
    await $(page, '.pselacts button:has-text("Place")').click();
    await $(page, `.vp .card[data-id="${off[0]}"]`).waitFor();
    await $(page, `.vp .card[data-id="${off[1]}"]`).waitFor();
    assert.equal(await $(page, '.panel.closed').count(), 1, 'the panel steps aside');
    assert.equal(await $(page, '.vp .card.picked').count(), 2, 'the placed pair is picked on the canvas');
    assert.equal(await page.evaluate(() => wihero.app.state.hero.psel), null, 'Place ends Select');
    ok('phone: Select picks two entries in the panel (the panel button stays put); Place puts both on the canvas, picked, and ends Select');

    // The picked pair moves together by either grip (Features 5).
    const a0 = await mem(page, off[0]);
    const b0 = await mem(page, off[1]);
    const grip = await centre($(page, `.vp .card[data-id="${off[0]}"] .grip`));
    await swipe(T, grip, { x: grip.x + 60, y: grip.y + 48 });
    await T([]);
    await page.waitForTimeout(300);
    const a1 = await mem(page, off[0]);
    const b1 = await mem(page, off[1]);
    assert.ok(a1.x !== a0.x || a1.y !== a0.y, 'the dragged card moved');
    assert.deepEqual([b1.x - b0.x, b1.y - b0.y], [a1.x - a0.x, a1.y - a0.y], 'the other picked card moved by as much');
    ok('phone: dragging one of the picked cards moves both');

    // On, Off and Edit… act on the selection; the selection lights the canvas.
    await $(page, '.panelBtn').click();
    await page.waitForTimeout(300);
    await $(page, '.panel .ptools button[aria-label="Select entries"]').click();
    for (const k of off.slice(0, 2)) await $(page, `.panel .prow[data-key="${k}"] .nm`).click();
    await $(page, '.pselacts button:has-text("Off")').click();
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => [...wihero.app.state.hero.psel]);
    assert.equal(sel.length, 2);
    let ents = await page.evaluate(b => wihero.library.peek(b).entries, BOOK);
    assert.ok(sel.every(u => ents[u].disable === true), 'Off turned both off');
    await $(page, '.pselacts button:has-text("On")').click();
    await page.waitForTimeout(300);
    ents = await page.evaluate(b => wihero.library.peek(b).entries, BOOK);
    assert.ok(sel.every(u => ents[u].disable === false), 'On turned both on');
    await $(page, '.pselacts button:has-text("Edit")').click();
    await $(page, '.sheet:has-text("Edit 2 entries")').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Move puts both in a folder, from the same sheet as Normal mode's.
    await $(page, '.pselacts button:has-text("Move")').click();
    await $(page, '.sheet .opt:has-text("Places")').first().click();
    await page.waitForTimeout(400);
    const fs2 = await page.evaluate(b => wihero.settings.books[b].folders, BOOK);
    assert.ok(off.slice(0, 2).every(k => fs2[k] === 'Places'), 'Move put both in Places');
    assert.equal(await page.evaluate(() => wihero.app.state.hero.psel), null, 'Move ends Select');
    ok('phone: Off, On, Edit… (2 entries) and Move act on the selection; Move ends Select');

    // The list keeps its scroll place after a placement (Features 4).
    if (await $(page, '.panel.closed').count()) await $(page, '.panelBtn').click();
    await page.waitForTimeout(300);
    const list = $(page, '.panel .plist');
    await list.evaluate(n => { n.scrollTop = 120; n.dispatchEvent(new Event('scroll')); });
    const top0 = await list.evaluate(n => n.scrollTop);
    assert.ok(top0 > 60, `the list scrolls (${top0})`);
    const dot = $(page, '.panel .prow:has(.dotc:not(.in)) .dotc').first();
    const dkey = await dot.evaluate(n => n.closest('.prow').dataset.key);
    // Drag its dot onto the canvas: over the canvas the ghost is the card as it lands.
    const d0 = await centre(dot);
    const vp = await $(page, '.vp').boundingBox();
    const to = { x: vp.x + vp.width * 0.55, y: vp.y + vp.height * 0.45 };
    await swipe(T, d0, to);
    await page.waitForTimeout(100);
    const ghost = await page.evaluate(() => {
        const g = document.querySelector('#wihero-editor').shadowRoot.querySelector('.dragghost');
        const r = g.getBoundingClientRect();
        return { real: g.classList.contains('real'), x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const zoom = await page.evaluate(b => wihero.settings.books[b].canvas.camera?.zoom ?? 1, BOOK);
    await shot(page, 'ghost');
    await T([]);
    await page.waitForTimeout(400);
    const placed = $(page, `.vp .card[data-id="${dkey}"]`);
    await placed.waitFor();
    const pr = await placed.boundingBox();
    const pm = await mem(page, dkey);
    assert.ok(ghost.real, 'the ghost takes the card\'s shape over the canvas');
    assert.ok(pm.x % G === 0 && pm.y % G === 0, `the card lands on the grid (${pm.x}, ${pm.y})`);
    assert.ok(Math.abs(ghost.x - pr.x) < 2 && Math.abs(ghost.y - pr.y) < 2 && Math.abs(ghost.w - pr.width) < 2 && Math.abs(ghost.h - pr.height) < 2,
        `the ghost was where the card landed (${JSON.stringify(ghost)} vs ${JSON.stringify(pr)}, zoom ${zoom})`);
    await $(page, '.panelBtn').click();
    await page.waitForTimeout(300);
    const top1 = await $(page, '.panel .plist').evaluate(n => n.scrollTop);
    assert.ok(Math.abs(top1 - top0) < 2, `the list kept its place (${top0} → ${top1})`);
    await $(page, '.panelBtn').click();
    ok('phone: a dot dragged onto the canvas shows the card as it lands (size, grid), and the panel reopens where it was');

    // A picked row's dot drags every picked entry: one ghost per card, in the column they land in.
    await $(page, '.panelBtn').click();
    await page.waitForTimeout(300);
    await $(page, '.panel .ptools button[aria-label="Select entries"]').click();
    const two2 = await $(page, '.panel .prow:has(.dotc:not(.in))').evaluateAll(ns => ns.slice(0, 2).map(n => n.dataset.key));
    assert.equal(two2.length, 2, 'two more entries off the canvas');
    for (const k of two2) await $(page, `.panel .prow[data-key="${k}"] .nm`).click();
    const gd = await centre($(page, `.panel .prow[data-key="${two2[1]}"] .dotc`));
    const to2 = { x: vp.x + vp.width * 0.4, y: vp.y + vp.height * 0.3 };
    await swipe(T, gd, to2);
    await page.waitForTimeout(100);
    const gs = await page.evaluate(() => [...document.querySelector('#wihero-editor').shadowRoot.querySelectorAll('.dragghost')].map(g => { const r = g.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, real: g.classList.contains('real'), t: g.textContent }; }));
    await shot(page, 'groupghost');
    await T([]);
    await page.waitForTimeout(400);
    assert.equal(gs.length, 2, `a ghost per picked entry (${JSON.stringify(gs)})`);
    const c0 = await $(page, `.vp .card[data-id="${two2[1]}"]`).boundingBox();
    const c1 = await $(page, `.vp .card[data-id="${two2[0]}"]`).boundingBox();
    const near = (g, c) => Math.abs(g.x - c.x) < 2 && Math.abs(g.y - c.y) < 2 && Math.abs(g.w - c.width) < 2;
    const lead = gs[gs.length - 1]; // the dragged entry's ghost is added last, over the others
    assert.ok(near(lead, c0), `the dragged entry's ghost was where it landed (${JSON.stringify(lead)} vs ${JSON.stringify(c0)})`);
    assert.ok(near(gs[0], c1), `the other ghost was where it landed under it (${JSON.stringify(gs[0])} vs ${JSON.stringify(c1)})`);
    assert.equal(await page.evaluate(() => wihero.app.state.hero.psel), null, 'the drop ends Select');
    ok('phone: dragging a picked dot shows a ghost for each picked entry where it lands, and ends Select');

    // A lasso on a phone picks cards without opening the keyboard; dragging one moves them all.
    await page.evaluate(b => { wihero.settings.books[b].canvas.camera = { x: 20, y: 20, zoom: 0.6 }; wihero.app.refresh(); }, BOOK);
    await page.waitForTimeout(300);
    const rects = await $(page, '.vp .card').evaluateAll(ns => ns.map(n => { const r = n.getBoundingClientRect(); return { id: n.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height }; }));
    const vb = await $(page, '.vp').boundingBox();
    const inView = rects.filter(r => r.y > vb.y + 30 && r.y + r.h < vb.y + vb.height - 160 && r.x > vb.x + 10 && r.x + r.w < vb.x + vb.width - 10).sort((a, b) => a.y - b.y);
    const two = inView.slice(0, 2);
    assert.equal(two.length, 2, 'two cards in view to lasso');
    const box = { x0: Math.min(...two.map(r => r.x)) - 8, y0: Math.min(...two.map(r => r.y)) - 8, x1: Math.max(...two.map(r => r.x + r.w)) + 8, y1: Math.max(...two.map(r => r.y + r.h)) + 8 };
    // A long press needs empty canvas: start just above the top card's corner.
    const hold = { x: box.x0, y: box.y0 };
    const under = await page.evaluate(([x, y]) => document.querySelector('#wihero-editor').shadowRoot.elementFromPoint(x, y)?.className, [hold.x, hold.y]);
    assert.ok(/vp|world/.test(String(under?.baseVal ?? under)), `the lasso starts on empty canvas (${under})`);
    await swipe(T, hold, { x: box.x1, y: box.y1 }, { hold: 650 });
    await T([]);
    await page.waitForTimeout(300);
    const pickedIds = await $(page, '.vp .card.picked').evaluateAll(ns => ns.map(n => n.dataset.id));
    assert.ok(two.every(r => pickedIds.includes(r.id)), `both lassoed cards are picked (${pickedIds})`);
    await $(page, '.lasso.phone').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.activeElement?.tagName ?? null), null, 'no keyboard: the pack box isn\'t focused');
    await shot(page, 'lasso');
    const m0 = await Promise.all(pickedIds.map(k => mem(page, k)));
    const g2 = await centre($(page, `.vp .card[data-id="${two[0].id}"] .grip`));
    await swipe(T, g2, { x: g2.x + 40, y: g2.y + 60 });
    await T([]);
    await page.waitForTimeout(300);
    const m1 = await Promise.all(pickedIds.map(k => mem(page, k)));
    const dx = m1.map((m, i) => m.x - m0[i].x);
    const dy = m1.map((m, i) => m.y - m0[i].y);
    assert.ok(dx[0] || dy[0], 'they moved');
    assert.ok(dx.every(v => v === dx[0]) && dy.every(v => v === dy[0]), `all picked cards moved together (${dx} / ${dy})`);
    assert.equal(await $(page, '.lasso').count(), 0, 'the pack box steps aside for the drag');
    ok('phone: a lasso picks cards without the keyboard, and dragging one moves them all');
    await page.context().close();
}

async function desktop() {
    const page = await open(1366, 768);
    // The docked list has Select too; Edit… opens the parameter sheet for the picked entries.
    await $(page, '.panel.dock .phead button[aria-label="Select entries"]').click();
    const rows = $(page, '.panel.dock .prow[data-key]');
    await rows.nth(0).click();
    await rows.nth(1).click();
    assert.match(await $(page, '.pselhead .cnt').innerText(), /2 selected/);
    await $(page, '.pselacts button:has-text("Edit")').click();
    await $(page, '.sheet:has-text("Edit 2 entries"), .pop:has-text("Edit 2 entries")').first().waitFor();
    await page.keyboard.press('Escape');
    await $(page, '.panel.dock .phead button[aria-label="Leave selection"]').click();
    // A box selection on the canvas offers Edit parameters… in its pane.
    const vp = await $(page, '.vp').boundingBox();
    const cards = await $(page, '.vp .card').evaluateAll(ns => ns.slice(0, 2).map(n => n.dataset.id));
    await page.evaluate(ids => wihero.app.state.hero && 0, cards);
    await page.mouse.move(vp.x + 6, vp.y + 6);
    await page.mouse.down();
    await page.mouse.move(vp.x + vp.width - 6, vp.y + vp.height - 6, { steps: 8 });
    await page.mouse.up();
    await $(page, '.insp.group').waitFor();
    await $(page, '.insp.group .opt:has-text("Edit parameters")').click();
    await $(page, '.sheet:has-text("Edit"), .pop:has-text("Edit")').first().waitFor();
    await shot(page, 'desktop');
    ok('desktop: Select in the docked list with Edit… for two entries, and Edit parameters… for a canvas selection');
    await page.context().close();
}

try {
    await phone();
    await desktop();
    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
    console.log(`\n${step} passed`);
} catch (e) {
    console.error(e);
    console.error('errors:', errors);
    process.exitCode = 1;
} finally {
    await browser.close();
    server.close();
}
