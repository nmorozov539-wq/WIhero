// The freeze polish on desktop, in the browser harness (e2e/desktop/harness.html), no SillyTavern needed: the
// checks chip on the canvas, turning keyword clash marking off, warnings on ST parameters that work against story
// pieces, undo history (the canvas arrows, Ctrl+Z and Ctrl+Shift+Z), and drag to reorder in the book list.
// Screenshots: e2e/log/polish-*.png.
//   node e2e/polish.mjs
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

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset`);
await page.locator('#wihero-editor .tab').first().waitFor();
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const card = name => $('.card').filter({ hasText: name }).first();
const entries = (book = BOOK) => page.evaluate(b => Object.values(wihero.library.peek(b).entries), book);
const toHero = async (book = BOOK) => {
    await page.evaluate(b => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = b; wihero.app.refresh(); }, book);
    await $('.vp .card').first().waitFor();
    await page.waitForTimeout(300);
};
const menu = async () => { await $('button[aria-label="Menu"]').filter({ visible: true }).first().click(); await $('.sheet').filter({ hasText: 'Snapshots' }).last().waitFor(); };
const cfg = e => e.extensions?.wihero ?? e.wihero ?? {};
const toNormal = async (book = BOOK) => { await page.evaluate(b => { wihero.app.state.mode = 'normal'; wihero.app.openBook(b); wihero.app.refresh(); }, book); await $('.brow').first().waitFor(); };

// 1. The checks chip: none on a clean book; a shared key word shows "1 clash", and a tap opens Keyword clashes.
await toHero();
const chipBefore = await $('.vp .checkchip').count();
await page.evaluate(b => wihero.library.change(b, d => {
    const [a, c] = Object.values(d.entries).filter(e => !e.constant && !(e.extensions?.wihero ?? e.wihero)?.moment && (e.key ?? []).length);
    a.key = [...a.key, 'shared word'];
    c.key = [...c.key, 'Shared Word'];
}), BOOK);
await toHero();
const chip = $('.vp .checkchip');
await chip.waitFor();
assert.match(await chip.textContent(), /clash/);
await page.screenshot({ path: `${LOG}polish-chip.png` });
await chip.click();
await $('.sheet').last().getByText('“shared word”').waitFor();
ok(`the canvas chip counts the book's checks (${(await chip.textContent()).trim()}; ${chipBefore} before the clash) and opens the sheet`);
await page.keyboard.press('Escape');

// 2. Mark keyword clashes off: no chip count, no outline on the entry page; the ⌄ row stays.
await menu();
await $('.sheet').last().locator('.opt, .swrow, div').filter({ hasText: /^Mark keyword clashes/ }).last().locator('[role="switch"], input, button').first().click();
await page.waitForFunction(() => wihero.settings.markClashes === false);
await page.keyboard.press('Escape');
await toHero();
const chipText = await $('.vp .checkchip').count() ? await $('.vp .checkchip').textContent() : '';
assert.doesNotMatch(chipText, /clash/);
const clashed = (await entries()).find(e => (e.key ?? []).includes('shared word'));
await toNormal();
await $('.brow').filter({ hasText: clashed.comment }).first().click();
await $('.br .en').first().waitFor();
assert.equal(await $('.kchip.clash').count(), 0);
assert.ok(await $('.clashnote').first().isHidden());
await menu();
assert.ok(await $('.sheet').last().getByText(/Keyword clashes \(\d+\)/).isVisible());
await page.keyboard.press('Escape');
ok('Mark keyword clashes off: the chip and the entry page stop marking clashes, the ⌄ row stays');

// 3. A probability on an entry with story pieces gets a warning line; one without pieces doesn't.
const gated = (await entries()).find(e => Array.isArray(cfg(e).gate) && cfg(e).gate.length && !cfg(e).moment);
const all = await entries();
// Plain: no pieces of its own, and nothing else points at it (its id appears in no other entry's logic).
const plain = all.find(e => !Object.keys(cfg(e)).some(k => k !== 'id' && k !== 'note') && !e.constant
    && !all.some(o => o !== e && cfg(e).id && JSON.stringify(cfg(o)).includes(`"${cfg(e).id}"`)));
await page.evaluate(([b, g, p]) => wihero.library.change(b, d => { for (const u of [g, p]) { d.entries[u].probability = 50; d.entries[u].useProbability = true; } }), [BOOK, gated.uid, plain?.uid ?? gated.uid]);
await $('.brow').filter({ hasText: gated.comment }).first().click();
const params = $('.br .disc').filter({ hasText: 'Parameters' }).first();
if (!(await params.getAttribute('class')).includes('open')) await params.click();
await $('.br .pnote').filter({ hasText: 'failed roll' }).first().waitFor();
await page.screenshot({ path: `${LOG}polish-param-note.png` });
if (plain) {
    await $('.brow').filter({ hasText: plain.comment }).first().click();
    await page.waitForTimeout(200);
    assert.equal(await $('.br .pnote').filter({ hasText: 'failed roll' }).count(), 0);
}
ok(`Probability on an entry with story pieces says how it works against them${plain ? '; a plain entry stays quiet' : ''}`);

// 4. Undo history: a gate item removed, the canvas's undo arrow puts it back, redo takes it away, Ctrl+Z again.
await toHero();
await card(gated.comment).click();
const gatePiece = $('.pc[data-piece="gate"]');
await gatePiece.waitFor();
if (!(await gatePiece.getAttribute('class')).includes('open')) await gatePiece.locator('.pct').click();
const gateBefore = JSON.stringify(cfg((await entries()).find(e => e.uid === gated.uid)).gate);
await $('.pc[data-piece="gate"].open .chip button').first().click();
await page.waitForTimeout(100);
const undoBtn = $('.histbtns button[aria-label^="Undo"]');
const redoBtn = $('.histbtns button[aria-label^="Redo"]');
assert.ok(await undoBtn.isEnabled());
assert.notEqual(JSON.stringify(cfg((await entries()).find(e => e.uid === gated.uid)).gate ?? null), gateBefore);
await page.screenshot({ path: `${LOG}polish-undo.png` });
const gateNow = () => page.evaluate(([b, u]) => JSON.stringify((wihero.library.peek(b).entries[u].extensions?.wihero ?? {}).gate), [BOOK, gated.uid]);
await undoBtn.click();
await page.waitForTimeout(100);
assert.equal(await gateNow(), gateBefore, 'the undo arrow puts the gate back');
assert.ok(await redoBtn.isEnabled());
await redoBtn.click();
await page.waitForTimeout(100);
assert.notEqual(await gateNow(), gateBefore, 'redo takes it away again');
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
assert.equal(await gateNow(), gateBefore, 'Ctrl+Z puts it back');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);
assert.notEqual(await gateNow(), gateBefore, 'Ctrl+Shift+Z redoes');
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
assert.equal(await gateNow(), gateBefore);
ok('removing a gate item: the canvas arrows and Ctrl+Z / Ctrl+Shift+Z undo and redo it');

// 4b. ST timing in the Hero inspector: Sticky set there is written to the entry and shows on the card.
await card(gated.comment).click();
const sticky = $('.itiming input#it-sticky');
await sticky.waitFor();
await sticky.fill('4');
await sticky.press('Enter');
await sticky.blur();
await page.waitForFunction(([b, u]) => Number(wihero.library.peek(b).entries[u].sticky) === 4, [BOOK, gated.uid]);
await card(gated.comment).locator('.timing').filter({ hasText: 'S4' }).waitFor();
assert.ok(await $('.itiming .pnote').filter({ hasText: 'sticky' }).count());
await page.screenshot({ path: `${LOG}polish-timing.png` });
ok('the inspector\'s ST timing writes Sticky to the entry, the card shows "S4", and the story pieces warning shows');

// 5. Drag to reorder in the book list (Order sort): displayIndex changes, the Order parameter doesn't.
await toNormal();
const rows = $('.bllist .brow');
const names = await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent));
const orderBefore = Object.fromEntries((await entries()).map(e => [e.uid, e.order]));
const from = rows.nth(2);
const to = rows.nth(0);
const box = await to.boundingBox();
await from.dragTo(to, { targetPosition: { x: 20, y: 3 } });
await page.waitForTimeout(200);
const after = await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent));
assert.equal(after[0], names[2], `"${names[2]}" is first now (${after.slice(0, 3).join(', ')})`);
assert.deepEqual(Object.fromEntries((await entries()).map(e => [e.uid, e.order])), orderBefore, 'the Order parameter is untouched');
await rows.first().click();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
assert.deepEqual((await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent))).slice(0, 3), names.slice(0, 3));
ok(`dragging a row onto the top of another moves it there by displayIndex only; Ctrl+Z puts it back (box ${Math.round(box.height)}px)`);

// 6. A–Z sort: no reordering.
await page.evaluate(() => { wihero.settings.sortBy = 'az'; wihero.app.refresh(); });
await page.waitForTimeout(200);
const az = await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent));
await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 3 } });
await page.waitForTimeout(200);
assert.deepEqual(await rows.evaluateAll(rs => rs.map(r => r.querySelector('.nm').textContent)), az);
ok('in the A–Z sort a drop on a row changes nothing');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
