// The cheap AFTER_V1 additions on desktop, in the browser harness (e2e/desktop/harness.html), no SillyTavern
// needed: Hero's + New book and Duplicate, the keyword clash finder (chips and ☰), the dead branch report (☰),
// lasso to make a pack, sticky notes, and the switch's dice. Screenshots go to e2e/log/cheap-*.png.
//   node e2e/cheap.mjs
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

// 1. + New book and Duplicate in Hero's book picker.
await toHero();
await $('.tbook').click();
const picker = $('.sheet').last();
// The actions are icon buttons at the top of the picker (#34).
await picker.locator('.pkacts button[aria-label="New book"]').waitFor();
assert.ok(await picker.locator(`.pkacts button[aria-label="Duplicate ${BOOK}"]`).isVisible());
await picker.locator(`.pkacts button[aria-label="Duplicate ${BOOK}"]`).click();
await page.waitForFunction(b => wihero.app.state.hero.book !== b && wihero.library.names().includes(wihero.app.state.hero.book), BOOK);
const copy = await page.evaluate(() => wihero.app.state.hero.book);
assert.equal((await entries(copy)).length, (await entries()).length, 'the copy has every entry');
ok(`Hero's book picker duplicates the book and opens the copy (${copy})`);
await $('.tbook').click();
await $('.sheet').last().locator('.pkacts button[aria-label="New book"]').click();
await $('.dlg input').fill('Cheap New');
await $('.dlg .pri').click();
await page.waitForFunction(() => wihero.app.state.hero.book === 'Cheap New');
ok('+ New book asks for a name, makes the book and opens it in Hero mode');
await toHero();

// 2. Keyword clashes: two entries share a key word.
await page.evaluate(b => wihero.library.change(b, d => {
    const [a, c] = Object.values(d.entries).filter(e => !e.constant && !(e.extensions?.wihero ?? e.wihero)?.moment && (e.key ?? []).length);
    a.key = [...a.key, 'shared word'];
    c.key = [...c.key, 'Shared Word'];
}), BOOK);
await menu();
const clashRow = $('.sheet').last().getByText(/Keyword clashes \(\d+\)/);
await clashRow.waitFor();
await clashRow.click();
await $('.sheet').last().getByText('“shared word”').waitFor();
ok('☰ lists Keyword clashes, and the sheet groups entries by the word');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const clashed = (await entries()).find(e => (e.key ?? []).includes('shared word'));
await page.evaluate(b => { wihero.app.state.mode = 'normal'; wihero.app.openBook(b); wihero.app.refresh(); }, BOOK);
await $('.brow').filter({ hasText: clashed.comment }).first().click();
await $('.kchip.clash').first().waitFor();
assert.match(await $('.clashnote').first().textContent(), /shared word also fires/i);
await page.screenshot({ path: `${LOG}cheap-clash.png` });
ok('the entry page marks the clashing key word and says what else it fires');

// 3. Dead branches: a row that needs both paths of a switch.
await page.evaluate(b => wihero.library.change(b, d => {
    const uid = Math.max(...Object.keys(d.entries).map(Number)) + 1;
    const fork = Object.values(d.entries).find(e => Array.isArray((e.extensions?.wihero ?? e.wihero)?.switch));
    const [p1, p2] = (fork.extensions?.wihero ?? fork.wihero).switch;
    d.entries[uid] = { uid, comment: 'Both paths', key: ['both'], content: 'x', extensions: { wihero: { id: 'both-paths', gate: [[p1, p2]] } } };
}), BOOK);
await toHero();
await menu();
await $('.sheet').last().getByText(/Dead branches \(\d+\)/).click();
await $('.sheet').last().getByText('Both paths').waitFor();
assert.match(await $('.sheet').last().textContent(), /two paths of the .* switch/);
ok('☰ lists Dead branches; a row needing both paths of a switch can never open');
await page.keyboard.press('Escape');
await toHero();

// 4. Lasso: Shift-drag a box, name the pack.
const a = await card('Left path').boundingBox();
const z = await card('Right path').boundingBox();
await page.keyboard.down('Shift');
await page.mouse.move(Math.min(a.x, z.x) - 10, Math.min(a.y, z.y) - 10);
await page.mouse.down();
await page.mouse.move(Math.max(a.x + a.width, z.x + z.width) + 8, Math.max(a.y + a.height, z.y + z.height) + 8, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Shift');
await $('.lasso input').waitFor();
await page.waitForTimeout(100);
await page.keyboard.type('crossing/paths');
await page.screenshot({ path: `${LOG}cheap-lasso.png` });
await page.keyboard.press('Enter');
await page.waitForFunction(b => Object.values(wihero.library.peek(b).entries).filter(e => (e.extensions?.wihero ?? e.wihero)?.packs?.includes('crossing/paths')).length >= 2, BOOK);
ok('a box select asks for a pack name; Enter packs the cards (crossing/paths)');

// 5. Sticky note from the card menu.
await card('Rumor').click({ button: 'right' });
await $('.sheet.pop').getByText('Add note').click();
await $('.dlg input').fill('TODO: a second way in');
await $('.dlg .pri').click();
await $('.card .sticky').filter({ hasText: 'TODO: a second way in' }).waitFor();
const rumor = (await entries()).find(e => e.comment?.startsWith('Rumor'));
assert.equal(rumor.extensions.wihero.note, 'TODO: a second way in');
await page.screenshot({ path: `${LOG}cheap-sticky.png` });
ok('Add note pins a sticky note on the card, stored in extensions.wihero.note');
await card('Rumor').click({ button: 'right' });
await $('.sheet.pop').getByText('Edit note').click();
await $('.dlg input').fill('');
await $('.dlg .pri').click();
await page.waitForTimeout(200);
assert.equal(await $('.card .sticky').count(), 0);
ok('an empty note removes it');

// 6. Dice on the switch strip.
const forkName = await page.evaluate(b => Object.values(wihero.library.peek(b).entries).find(e => Array.isArray((e.extensions?.wihero ?? e.wihero)?.switch)).comment, BOOK);
await card(forkName).click({ button: 'right' });
await $('.sheet.pop').getByText('Switch', { exact: true }).click();
await $('.pstrip').getByText('Roll the dice').waitFor();
await $('.pstrip [aria-label="Roll the dice"]').click();
await page.waitForFunction(b => Object.values(wihero.library.peek(b).entries).some(e => (e.extensions?.wihero ?? e.wihero)?.dice === true), BOOK);
await $('.pstrip').getByText(/picked at random/).waitFor();
await page.screenshot({ path: `${LOG}cheap-dice.png` });
ok('the switch strip\'s Roll the dice writes dice: true on the fork');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
