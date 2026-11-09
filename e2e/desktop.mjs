// Desktop layout checks (LAYOUT "Desktop: normal mode" and "Desktop: Hero mode") against the browser harness
// (e2e/desktop/harness.html): no SillyTavern needed. Runs Normal and Hero mode at 1920 × 1080 (drawer 960px) and
// 1366 × 768 (683px), a window whose drawer is under 640px, a phone (nothing desktop shows), and a light theme
// pass. Screenshots go to e2e/log/desktop-*.png.
//   node e2e/desktop.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = new URL('./log/', import.meta.url).pathname;
fs.mkdirSync(LOG, { recursive: true });

// A static server for the repo: the harness loads src/ and examples/ by relative URLs.
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

async function open(w, h, query = '') {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e.message}`));
    // The harness has no favicon; the browser asks for one at its own pace.
    page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${w}x${h}: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}?reset${query}`);
    await page.locator('#wihero-editor .tab').first().waitFor();
    return page;
}
const $ = (page, sel) => page.locator(`#wihero-editor ${sel}`);
const hostBox = page => page.evaluate(() => { const r = document.querySelector('#wihero-editor').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const shot = (page, name) => page.screenshot({ path: `${LOG}desktop-${name}.png` });
const toHero = async page => {
    await page.evaluate(() => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = 'WIHero-Sample'; wihero.app.refresh(); });
    await $(page, '.vp .card').first().waitFor();
    await page.waitForTimeout(300);
};
const card = (page, name) => $(page, '.card').filter({ hasText: name }).first();
const cardBox = (page, name) => card(page, name).boundingBox();

async function normalMode(w, h, drawer) {
    const page = await open(w, h);
    const box = await hostBox(page);
    assert.equal(Math.round(box.w), drawer, 'Normal mode takes the drawer\'s width');
    assert.equal(Math.round(box.x), Math.round((w - drawer) / 2), 'and sits where the chat column is');
    assert.equal(Math.round(box.y), 35, 'under the top bar');
    ok(`${w}: Normal mode in the drawer box (${drawer}px)`);
    await $(page, '.tile').first().waitFor();
    assert.ok(await $(page, '.dhead .dbtn').filter({ hasText: 'Import' }).isVisible(), 'Import in the header');
    ok(`${w}: Home shows tiles, with Import in the header`);
    assert.equal(await $(page, '.tadd, .dfilter').count(), 0, 'no + tab and no Filter books box');
    assert.equal(await $(page, '.dseg button span').count(), 0, 'the view switch is icons only');
    const loose = await $(page, '.dfolder').filter({ hasText: 'Not in a folder' });
    if (await loose.count()) assert.equal(await loose.isVisible(), await page.evaluate(() => wihero.library.names().some(n => !Object.values(wihero.settings.bookFolders ?? {}).some(l => l.includes(n)))), '"Not in a folder" shows only while it holds a book');
    const tabs = await $(page, '.tab').count();
    await $(page, '.tile').filter({ hasText: 'WIHero-Sample' }).click({ button: 'right' });
    await $(page, '.sheet.pop').getByText('New tab', { exact: true }).click();
    assert.equal(await $(page, '.tab').count(), tabs + 1, 'New tab adds a tab');
    assert.ok(await $(page, '.tile').first().isVisible(), 'and stays on Home');
    await $(page, '.tab').nth(tabs).click();
    await $(page, '.brow').first().waitFor();
    await $(page, '.tab.fixed').click();
    ok(`${w}: Home: no + tab or filter box, icon view switch, New tab stays on Home`);
    await $(page, '.tile').filter({ hasText: 'WIHero-Sample' }).click();
    await $(page, '.brow').first().waitFor();
    assert.ok(await $(page, '.bl').isVisible() && await $(page, '.br').isVisible(), 'two panes');
    await $(page, '.brow').filter({ hasText: 'Mill: arrival' }).click();
    await $(page, '.en-line').waitFor();
    assert.ok(await $(page, '.br').evaluate(n => n.innerText.includes('Mill: arrival') || [...n.querySelectorAll('input, textarea')].some(i => i.value.includes('Mill: arrival'))), 'the entry shows on the right');
    ok(`${w}: a book opens in two panes, a row shows its entry on the right`);
    await $(page, '.br .kchips input').first().click();
    await $(page, '.br button.linkish').filter({ hasText: 'Add condition' }).click();
    await $(page, '.br .fmenu.flab').waitFor();
    ok(`${w}: Add condition shows the condition, with a key word box focused`);
    await $(page, '.brow').filter({ hasText: 'Ferry (sticky' }).click({ button: 'right' });
    await $(page, '.sheet.pop').waitFor();
    const pop = await $(page, '.sheet.pop').boundingBox();
    assert.ok(pop.width < 400, 'the menu is a popover, not a sheet');
    ok(`${w}: right-click opens a popover menu`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await $(page, '.dsearch input').waitFor();
    await page.waitForTimeout(100);
    await page.keyboard.type('ferry');
    await $(page, '.dsr').first().waitFor();
    ok(`${w}: Ctrl K searches`);
    await shot(page, `${w}-normal`);
    await page.keyboard.press('Escape');
    await page.close();
}

async function heroMode(w, h, drawer) {
    const page = await open(w, h);
    await toHero(page);
    let box = await hostBox(page);
    assert.equal(Math.round(box.w), w, 'Hero opens widened');
    assert.equal(Math.round(box.h), h - 35, 'down to the bottom');
    for (const sel of ['.panel.dock', '.vp', '.hinsp', '.pbar']) assert.ok(await $(page, sel).isVisible(), `${sel} shows`);
    ok(`${w}: Hero opens widened with the entry list, canvas, piece bar and inspector`);

    // Left to right: a card sits right of what it waits for.
    const road = await cardBox(page, 'Road: leaving');
    const mill = await cardBox(page, 'Mill: arrival');
    const secret = await cardBox(page, 'Mill: the secret');
    assert.ok(mill.x > road.x + road.width && secret.x > mill.x + mill.width, 'columns run left to right');
    ok(`${w}: the canvas lays out left to right`);

    await card(page, 'Mill: arrival').hover();
    await $(page, '.hhandles .hh.open').waitFor();
    await page.waitForTimeout(450);
    assert.ok(await $(page, '.vp.focusdim').count(), 'resting on a card dims the rest');
    ok(`${w}: hover shows the handles, and dims after a rest`);

    await card(page, 'Mill: arrival').click();
    await $(page, '.hinsp .itabs').waitFor();
    assert.match(await $(page, '.hinsp .ihead h2').textContent(), /Mill: arrival/);
    await card(page, 'Mill: arrival').dblclick();
    await $(page, '.hinsp .itext').waitFor();
    await page.waitForTimeout(100);
    await page.keyboard.type(' Typed here.');
    assert.match(await page.evaluate(() => Object.values(wihero.library.peek('WIHero-Sample').entries).find(e => e.comment === 'Mill: arrival').content), /Typed here\.$/);
    ok(`${w}: click inspects, double-click edits the text in the inspector`);
    await page.keyboard.press('Escape');

    await card(page, 'Ferry (sticky').click({ button: 'right' });
    await $(page, '.sheet.pop').filter({ hasText: 'Add piece' }).waitFor();
    ok(`${w}: right-click a card: Inspect, Open entry, Edit text, Add piece`);
    await page.keyboard.press('Escape');

    // A link dragged from a hover handle opens the strip; Cancel (Escape) puts the book back.
    const before = await page.evaluate(() => JSON.stringify(wihero.library.peek('WIHero-Sample').entries));
    await card(page, 'Left path').hover();
    const hh = await $(page, '.hh.open').boundingBox();
    const to = await cardBox(page, 'Rumor');
    await page.mouse.move(hh.x + 7, hh.y + 7);
    await page.mouse.down();
    await page.mouse.move(hh.x + 80, hh.y + 40, { steps: 4 });
    await page.mouse.move(to.x + 40, to.y + 20, { steps: 6 });
    await page.mouse.up();
    await $(page, '.pstrip').filter({ hasText: 'waits for' }).waitFor();
    ok(`${w}: dragging a handle onto a card links them, in the strip`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => JSON.stringify(wihero.library.peek('WIHero-Sample').entries)), before);
    ok(`${w}: Escape cancels the strip and the book is as it was`);

    const a = await cardBox(page, 'Ferry (sticky');
    const z = await cardBox(page, 'Right path');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 12, a.y - 12);
    await page.mouse.down();
    await page.mouse.move(z.x + z.width + 8, z.y + z.height + 8, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await $(page, '.hinsp h2').filter({ hasText: 'cards selected' }).waitFor();
    ok(`${w}: Shift-drag selects several, and the inspector offers group actions`);
    await page.keyboard.press('Escape');

    await page.keyboard.press('o');
    await $(page, '.armban').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await $(page, '.armban').count(), 0);
    ok(`${w}: O arms Opens with a banner, Escape disarms`);

    await $(page, '.tab[aria-label="Preview"]').click();
    await $(page, '.pv2 .prep').waitFor();
    ok(`${w}: Preview is a tab of its own, in two columns`);
    await shot(page, `${w}-hero-preview`);
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.prow').filter({ hasText: 'Tower' }).dblclick();
    await $(page, '.en-line').filter({ hasText: 'Show on canvas' }).waitFor();
    ok(`${w}: double-clicking a list row opens the entry in a tab, with Show on canvas`);
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.vp .card').first().waitFor();
    await shot(page, `${w}-hero`);

    // Explain mode: the "?" in the tab row, then a click on a lock pill opens the Guide at Lock, not the pill's strip.
    await $(page, '.tright .explainq').click();
    await $(page, '.explainban').waitFor();
    assert.ok(await page.evaluate(() => wihero.app.state.hero.explain), 'explain mode is on');
    const pillBox = await $(page, '.lockp').first().boundingBox();
    await page.mouse.click(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await $(page, '.guide .gpage[data-anchor="lock"]').waitFor();
    assert.equal(await $(page, '.pstrip').count(), 0, 'the pill did not open its strip');
    assert.equal(await $(page, '.explainban').count(), 0, 'one click, then explain mode ends');
    await shot(page, `${w}-guide`);
    await $(page, '.tab[aria-label="Canvas"]').click();
    await $(page, '.vp .card').first().waitFor();
    await page.keyboard.press('?');
    await $(page, '.explainban').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await $(page, '.explainban').count(), 0, 'Escape cancels explain mode');
    ok(`${w}: explain mode: "?" outlines, a click on a lock pill opens the Guide at Lock; ? and Escape`);

    // The entry list: a click on a row's hollow dot places it; a click on the row only inspects.
    const hollow = $(page, '.panel.dock .prow').filter({ has: page.locator('.dotc:not(.in)') }).first();
    if (await hollow.count()) {
        const key = await hollow.getAttribute('data-key');
        const name = (await hollow.locator('.nm').textContent()).trim();
        await hollow.locator('.dotc').click();
        await $(page, `.prow[data-key="${key}"] .dotc.in`).waitFor();
        assert.ok(await card(page, name.replace(/\s*\(.*$/, '')).isVisible(), `${name}: its card is on the canvas`);
        ok(`${w}: a click on an entry's hollow dot places it on the canvas`);
    }

    await $(page, '.tright .iconbtn[aria-label="Drawer size"]').click();
    await page.waitForTimeout(200);
    box = await hostBox(page);
    assert.equal(Math.round(box.w), drawer, 'Drawer size shrinks Hero to the drawer');
    assert.equal(await $(page, '.panel.dock').count(), 0, 'and the entry list starts hidden');
    assert.equal(await page.evaluate(() => wihero.settings.desk.heroWide), false, 'remembered');
    ok(`${w}: Drawer size shrinks Hero to ${drawer}px, the list starts hidden`);
    await shot(page, `${w}-hero-drawer`);
    await $(page, '.tmode').click();
    await $(page, '.tab[aria-label="Home"]').click();
    await $(page, '.tile').first().waitFor();
    const homeW = await $(page, '.dhome').evaluate(n => n.getBoundingClientRect().width);
    assert.ok(homeW > drawer - 40, `Home fills the drawer after Hero (${homeW}px)`);
    ok(`${w}: back in Normal mode, Home fills the drawer again`);
    await page.close();
}

async function narrow() {
    // 1200px wide: the drawer is 600px, under the 640px where the book shows its list, then an entry.
    const page = await open(1200, 800);
    await $(page, '.tile').filter({ hasText: 'WIHero-Sample' }).click();
    await $(page, '.en-line, .bl').first().waitFor();
    assert.equal(Math.round((await hostBox(page)).w), 600);
    const shows = sel => $(page, sel).first().isVisible();
    assert.ok(await shows('.bk .bl'), 'the book opens on its entry list');
    assert.ok(!(await shows('.bk .br')), 'with no empty entry pane beside it');
    const listW = await $(page, '.bk .bl').evaluate(n => n.getBoundingClientRect().width);
    assert.ok(listW > 560, `the list fills the drawer (${listW}px)`);
    await shot(page, 'narrow-book');
    ok('a 600px drawer: the book opens on its entry list, full width');
    await $(page, '.brow').first().click();
    await $(page, '.br .en h1').waitFor();
    assert.ok(!(await shows('.bk .bl')), 'an entry fills the book');
    await shot(page, 'narrow-entry');
    await $(page, '.br .en-line .lbtn').first().click();
    assert.ok(await shows('.bk .bl'), '← goes back to the list');
    assert.ok(!(await shows('.bk .br')));
    ok('a 600px drawer: an entry fills the drawer, ← goes back to the list');
    // Widen: the whole window (no side panel open), still above the send form; the two panes come back.
    await $(page, '.tright .iconbtn[aria-label="Widen"]').click();
    let box = await hostBox(page);
    assert.equal(Math.round(box.w), 1200, 'widened, WI Hero takes the window\'s width');
    assert.equal(Math.round(box.y + box.h), 800 - 47, 'and stops above the send form');
    assert.ok(await shows('.bk .bl') && await shows('.bk .br'), 'with the list and the entry side by side');
    await shot(page, 'widened-book');
    // An open side panel: WI Hero keeps clear of it (ST's panel is half of what Chat width leaves: 300px here).
    await page.evaluate(() => wihero.app.host.classList.add('pl'));
    box = await hostBox(page);
    assert.equal(Math.round(box.x), 299);
    await page.evaluate(() => wihero.app.host.classList.remove('pl'));
    assert.equal(await page.evaluate(() => wihero.settings.desk.normalWide), true, 'remembered');
    await $(page, '.tright .iconbtn[aria-label="Drawer size"]').click();
    assert.equal(Math.round((await hostBox(page)).w), 600, 'Drawer size puts it back');
    ok('Widen in Normal mode: the window\'s width beside side panels, remembered, and back');
    await page.evaluate(() => { wihero.settings.desk = { heroWide: false }; });
    await toHero(page);
    assert.equal(await $(page, '.hinsp').count(), 0, 'the inspector starts hidden in a narrow drawer');
    await card(page, 'Mill: arrival').click();
    await $(page, '.hinsp .ihead').waitFor();
    ok('a 600px drawer in Hero: list and inspector start hidden, a click shows the inspector');
    await shot(page, 'narrow-hero');
    await page.close();
}

async function phone() {
    const page = await open(390, 844);
    assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').dataset.desk), '');
    assert.equal(await $(page, '.tright').count(), 0);
    await toHero(page);
    assert.equal(await $(page, '.panel.dock, .hinsp, .hhandles').count(), 0);
    await card(page, 'Mill: arrival').click();
    await $(page, '.insp .igrab').waitFor();
    const box = await hostBox(page);
    assert.equal(Math.round(box.w), 390);
    ok('phone: no desktop layout, the inspector is the half sheet');
    await shot(page, 'phone-hero');
    await page.close();
}

async function light() {
    const page = await open(1920, 1080, '&theme=light');
    await toHero(page);
    await card(page, 'Fork').click();
    await $(page, '.hinsp .itabs').waitFor();
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#wihero-editor').shadowRoot.querySelector('.hinsp')).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    assert.ok((r + g + b) / 3 > 180, `the inspector is light (${bg})`);
    ok('light theme: Hero\'s columns follow the theme');
    await shot(page, 'light-hero');
    await page.close();
}

try {
    await normalMode(1920, 1080, 960);
    await normalMode(1366, 768, 683);
    await heroMode(1920, 1080, 960);
    await heroMode(1366, 768, 683);
    await narrow();
    await phone();
    await light();
    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
