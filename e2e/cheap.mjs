// The cheap AFTER_V1 additions on desktop, in the browser harness (e2e/desktop/harness.html), no SillyTavern
// needed: Hero's + New book and Duplicate, the keyword clash finder (chips and ☰), the dead branch report (☰),
// lasso to make a pack, sticky notes, the switch's dice, and a Moment's delete with Undo. Screenshots go to e2e/log/cheap-*.png.
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
/** A card's menu: its ⋯ after the hover handles (the right button only moves the view). */
const menuOf = async name => { await card(name).hover(); await $('.hhandles .hh.hmore').click(); };
const entries = (book = BOOK) => page.evaluate(b => Object.values(wihero.library.peek(b).entries), book);
const toHero = async (book = BOOK) => {
    await page.evaluate(b => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = b; wihero.app.refresh(); }, book);
    await $('.vp .card').first().waitFor();
    await page.waitForTimeout(300);
};
const menu = async () => { await $('button[aria-label="Menu"]').filter({ visible: true }).first().click(); await $('.sheet').filter({ hasText: 'Snapshots' }).last().waitFor(); };

// 1. Hero's books menu (the book's name in the entry list) has New book and Import on top; the ⋮ by it is this book's
// menu, with Rename, Duplicate and Delete.
await toHero();
await $('.panelbook').click();
const picker = $('.sheet').last();
for (const name of ['New book', 'Import a file…']) await picker.locator('.opt').filter({ hasText: name }).first().waitFor();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await $('.panelmore').click();
const bookActs = $('.sheet').filter({ hasText: 'Duplicate' }).last();
await bookActs.waitFor();
for (const name of ['Rename', 'Duplicate', 'Delete', 'Snapshots']) assert.ok(await bookActs.locator('.opt').filter({ hasText: name }).first().isVisible(), name);
await bookActs.locator('.opt').filter({ hasText: 'Duplicate' }).first().click();
await page.waitForFunction(b => wihero.app.state.hero.book !== b && wihero.library.names().includes(wihero.app.state.hero.book), BOOK);
const copy = await page.evaluate(() => wihero.app.state.hero.book);
assert.equal((await entries(copy)).length, (await entries()).length, 'the copy has every entry');
ok(`Hero's books menu offers New book and Import; the book's ⋮ duplicates it and opens the copy (${copy})`);
await $('.panelbook').click();
await $('.sheet').last().locator('.opt').filter({ hasText: 'New book' }).first().click();
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
await $('.sheet').last().locator('.clashw', { hasText: 'shared word' }).waitFor();
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

// 4. Lasso: drag a box, P, name the pack.
const a = await card('Left path').boundingBox();
const z = await card('Right path').boundingBox();
await page.mouse.move(Math.min(a.x, z.x) - 10, Math.min(a.y, z.y) - 10);
await page.mouse.down();
await page.mouse.move(Math.max(a.x + a.width, z.x + z.width) + 8, Math.max(a.y + a.height, z.y + z.height) + 8, { steps: 6 });
await page.mouse.up();
await page.keyboard.press('p');
await $('.lasso input').waitFor();
await page.waitForTimeout(100);
await page.keyboard.type('crossing/paths');
await page.screenshot({ path: `${LOG}cheap-lasso.png` });
await page.keyboard.press('Enter');
await page.waitForFunction(b => Object.values(wihero.library.peek(b).entries).filter(e => (e.extensions?.wihero ?? e.wihero)?.packs?.includes('crossing/paths')).length >= 2, BOOK);
ok('a box select, then P, asks for a pack name; Enter packs the cards (crossing/paths)');

// 5. Sticky note from the card menu.
await menuOf('Rumor');
await $('.sheet.pop').getByText('Add note').click();
await $('.dlg input').fill('TODO: a second way in');
await $('.dlg .pri').click();
await $('.card .sticky').filter({ hasText: 'TODO: a second way in' }).waitFor();
const rumor = (await entries()).find(e => e.comment?.startsWith('Rumor'));
assert.equal(rumor.extensions.wihero.note, 'TODO: a second way in');
await page.screenshot({ path: `${LOG}cheap-sticky.png` });
ok('Add note pins a sticky note on the card, stored in extensions.wihero.note');
await menuOf('Rumor');
await $('.sheet.pop').getByText('Edit note').click();
await $('.dlg input').fill('');
await $('.dlg .pri').click();
await page.waitForTimeout(200);
assert.equal(await $('.card .sticky').count(), 0);
ok('an empty note removes it');

// 6. Dice on the switch strip.
const forkName = await page.evaluate(b => Object.values(wihero.library.peek(b).entries).find(e => Array.isArray((e.extensions?.wihero ?? e.wihero)?.switch)).comment, BOOK);
await menuOf(forkName);
await $('.sheet.pop').getByText('Switch', { exact: true }).click();
await $('.pstrip').getByText('Roll the dice').waitFor();
await $('.pstrip [aria-label="Roll the dice"]').click();
await page.waitForFunction(b => Object.values(wihero.library.peek(b).entries).some(e => (e.extensions?.wihero ?? e.wihero)?.dice === true), BOOK);
await $('.pstrip').getByText(/picked at random/).waitFor();
await page.screenshot({ path: `${LOG}cheap-dice.png` });
ok('the switch strip\'s Roll the dice writes dice: true on the fork');

// 7. A Moment exists only on the canvas: taking an unlinked one off (Delete key) deletes it, with Undo.
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const bare = await page.evaluate(() => {
    const root = document.querySelector('#wihero-editor').shadowRoot;
    const b = root.querySelector('.vp').getBoundingClientRect();
    const free = (x, y) => { for (let dx = -40; dx <= 40; dx += 10) for (let dy = -40; dy <= 40; dy += 10) { const n = root.elementFromPoint(x + dx, y + dy); if (!(n?.classList.contains('vp') || n?.classList.contains('world'))) return false; } return true; };
    for (let y = b.y + b.height * 0.15; y < b.y + b.height * 0.85; y += 13) for (let x = b.x + b.width * 0.15; x < b.x + b.width * 0.85; x += 17) if (free(x, y)) return { x, y };
    return null;
});
assert.ok(bare, 'some bare canvas');
await $('.pchip[data-piece="moment"]').evaluate(n => n.scrollIntoView({ inline: 'nearest' }));
await $('.pchip[data-piece="moment"]').click();
await page.mouse.click(bare.x, bare.y);
await $('.dlg input').fill('Cheap moment');
await $('.dlg .pri').click();
await card('Cheap moment').waitFor();
const momentUid = await page.evaluate(b => Object.values(wihero.library.peek(b).entries).find(e => e.comment === 'Moment: Cheap moment')?.uid, BOOK);
assert.ok(momentUid != null, 'the Moment is in the book');
await page.keyboard.press('Escape');
await card('Cheap moment').click();
await page.keyboard.press('Delete');
await $('.toast').getByText('Deleted Moment: Cheap moment').waitFor();
assert.equal(await card('Cheap moment').count(), 0, 'the card is gone at once');
await $('.toast button').getByText('Undo').click();
await card('Cheap moment').waitFor();
ok('Delete on an unlinked Moment deletes it with Undo (the toast says Deleted Moment: …), and Undo puts the card back');
await card('Cheap moment').click();
await page.keyboard.press('Delete');
await $('.toast').getByText('Deleted Moment: Cheap moment').waitFor();
await page.waitForFunction(([b, u]) => !wihero.library.peek(b).entries[u], [BOOK, momentUid], { timeout: 9000 });
assert.equal(await page.evaluate(([b, u]) => Object.keys(wihero.settings.books[b]?.canvas?.cards ?? {}).some(k => k.includes('cheap-moment')), [BOOK, momentUid]), false, 'its canvas memory is gone too');
ok('when the toast runs out the Moment leaves the book and its canvas memory');

assert.deepEqual(errors, []);
ok('no errors in the page');
await browser.close();
server.close();
