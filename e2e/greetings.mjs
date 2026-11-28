// Greetings in Hero mode, in the browser harness (no SillyTavern and no chat): a linked character is offered for
// editing, choosing her shows greeting cards without firing one, the panel renames them, Clear restores the
// canonical label, and Hide takes the cards away. Nicknames stay in WI Hero's settings.
//   CHROMIUM=/path/to/chrome node e2e/greetings.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
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
const BOOK = 'WIHero-N1';

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset`);
await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });

const $ = sel => page.locator(`#wihero-editor ${sel}`);
const hero = () => page.evaluate(book => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.panel = false;
    S.hero.insp = null;
    wihero.app.refresh();
}, BOOK);
const cards = () => page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    return [...root.querySelectorAll('.vp .card.greet')].map(c => ({
        id: c.dataset.id,
        title: c.querySelector('.t')?.textContent ?? '',
        detail: c.querySelector('.k')?.textContent ?? '',
        tag: c.querySelector('.tag')?.textContent ?? '',
    }));
});
const bannerText = () => page.evaluate(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban')?.textContent ?? '');
const settingsNames = () => page.evaluate(book => structuredClone(wihero.settings.books[book]?.greetingNames ?? {}), BOOK);

// No chat, one linked character: a slim notice, no cards until one is placed.
await hero();
await $('.vp').waitFor({ timeout: 30000 });
await $('.greetban').waitFor({ timeout: 30000 });
assert.match(await bannerText(), /1 linked char found\./);
assert.match(await bannerText(), /Pick/);
assert.equal((await cards()).length, 0, 'found greetings do not spawn on the canvas');
ok('no chat with one linked character shows the notice, without showing cards');

// Pick opens a dropdown at the control, and choosing her starts the editing view but still no cards.
await $('.greetban .gpick').click();
await $('.sheet.pop .gopt').first().waitFor({ timeout: 30000 });
assert.equal(await $('.sheet.pop .gopt').count(), 1);
const geo = await page.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const p = root.querySelector('.greetban .gpick').getBoundingClientRect();
    const m = root.querySelector('.sheet.pop').getBoundingClientRect();
    const layer = root.querySelector('.layer')?.getBoundingClientRect();
    return { pickRight: p.right, popLeft: m.left, popW: m.width, layerW: layer?.width, layerLeft: layer?.left };
});
assert.ok(geo.popLeft >= geo.pickRight - 1, 'the dropdown opens to the right of Pick');
await $('.sheet.pop .gopt:has-text("Seraphina")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban')?.textContent.includes('Greetings: Seraphina'), null, { timeout: 30000 });
assert.equal((await cards()).length, 0, 'picking starts the drawer view only');
assert.equal(await page.evaluate(() => !!wihero.app.state.hero.greet), true);
ok('Pick opens a dropdown and selects Seraphina without spawning greeting cards');

// The panel's Greetings drawer starts closed; opening it lists the rows. Rename is settings-only.
await page.evaluate(() => { wihero.app.state.hero.panel = true; wihero.app.refresh(); });
await $('.phdr:has-text("Greetings")').waitFor({ timeout: 30000 });
assert.equal(await $('.prow.greet').count(), 0, 'the Greetings folder starts closed');
await $('.phdr:has-text("Greetings")').click();
await $('.prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await $('.prow.greet').count(), 3);
assert.equal(await $('.prow.greet .rowact').count(), 3, 'each greeting row has Rename');
await $('.prow.greet[data-key="greet:Seraphina.png:1"] .rowact').click();
await $('.nickin').waitFor({ timeout: 30000 });
assert.equal(await $('.nickin').inputValue(), '', 'no nickname yet');
await $('.nickin').fill('The market');
await $('.greetrow .pri').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.prow.greet[data-key="greet:Seraphina.png:1"] b')?.textContent === 'The market', null, { timeout: 30000 });
const names = await settingsNames();
assert.equal(names['Seraphina.png']?.[1]?.name, 'The market');
assert.equal(typeof names['Seraphina.png']?.[1]?.fp, 'string');
assert.equal(await page.evaluate(book => {
    const data = wihero.library.peek(book);
    return JSON.stringify(data).includes('The market');
}, BOOK), false, 'the nickname is not written into the book');
ok('the Greetings drawer starts closed; Rename stores a settings nickname only');

// Placing Alt 1 from its row dot puts that one card on the canvas, with the nickname and canonical secondary.
await $('.prow.greet[data-key="greet:Seraphina.png:1"] .dotc').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelectorAll('.vp .card.greet').length === 1, null, { timeout: 30000 });
const renamed = (await cards()).find(c => c.id.endsWith(':1'));
assert.equal(renamed.title, 'The market');
assert.match(renamed.detail, /Alt 1/, 'the alternate stays visible');
ok('a greeting card appears only when placed, with its nickname and Alt 1 secondary');

// Clear restores the canonical label.
await page.evaluate(() => { wihero.app.state.hero.panel = true; wihero.app.refresh(); });
await $('.prow.greet[data-key="greet:Seraphina.png:1"] .rowact').click();
await $('.nickin').waitFor({ timeout: 30000 });
assert.equal(await $('.nickin').inputValue(), 'The market', 'prefilled with the current nickname');
await $('.greetrow button:has-text("Clear")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.prow.greet[data-key="greet:Seraphina.png:1"] b')?.textContent === 'Alt 1', null, { timeout: 30000 });
assert.equal((await cards()).find(c => c.id.endsWith(':1')).title, 'Alt 1');
assert.deepEqual(await settingsNames(), {});
ok('Clear removes the nickname and restores Alt 1');

// Hide takes the editing view away; nothing is marked fired.
await $('.greetban button:has-text("Hide")').click();
await page.waitForFunction(() => !document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban'), null, { timeout: 30000 });
assert.equal((await cards()).length, 0, 'Hide removes the greeting cards');
assert.equal(await page.evaluate(() => !!wihero.app.state.hero.greet), false);
ok('Hide clears the manual choice, cards and notice');

// Several linked characters: the banner offers the picker, and choosing another character switches the cards.
await page.evaluate(book => {
    wihero.library.links = () => [
        { kind: 'char', name: 'Seraphina', avatar: 'Seraphina.png' },
        { kind: 'char', name: 'Bob', avatar: 'Bob.png' },
    ];
    const h = wihero.app.state.hero;
    h.greet = null;
    h.greetDismissed = null;
    h.greetView = null;
    h.panel = true;
    wihero.app.refresh();
}, BOOK);
await $('.greetban').waitFor({ timeout: 30000 });
assert.match(await bannerText(), /2 linked chars found\./);
await $('.greetban .gpick').click();
await $('.sheet.pop .gopt').first().waitFor({ timeout: 30000 });
assert.equal(await $('.sheet.pop .gopt').count(), 2, 'both linked characters are offered with avatars and names');
await $('.sheet.pop .gopt:has-text("Bob")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban')?.textContent.includes('Greetings: Bob'), null, { timeout: 30000 });
assert.equal((await cards()).length, 0, 'switching characters does not spawn cards either');
await page.evaluate(() => { wihero.app.state.hero.panel = true; wihero.app.refresh(); });
if (!(await $('.prow.greet').count())) await $('.phdr:has-text("Greetings")').click();
await $('.prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await $('.prow.greet').count(), 2, 'Bob has two greeting rows');
await $('.greetban button:has-text("Hide")').click();
await page.waitForFunction(() => !document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban'), null, { timeout: 30000 });
ok('several linked characters offer a dropdown; choosing Bob switches the drawer without cards');

// No links and no chat: no banner and no cards.
await page.evaluate(book => {
    wihero.library.links = () => [];
    const h = wihero.app.state.hero;
    h.greet = null;
    h.greetDismissed = null;
    h.greetView = null;
    h.panel = true;
    wihero.app.refresh();
}, BOOK);
await page.waitForTimeout(200);
assert.equal(await $('.greetban').count(), 0);
assert.equal((await cards()).length, 0);
ok('no linked characters and no chat show no banner and no greeting cards');

// A stored rule whose character is gone is listed in the book menu and can be repointed to a real greeting.
await page.evaluate(book => {
    wihero.library.change(book, d => {
        const first = Object.values(d.entries)[0];
        const raw = first.extensions?.wihero ?? {};
        first.extensions = { ...(first.extensions ?? {}), wihero: { ...raw, id: raw.id ?? 'orphan-test', gatedBy: [{ greeting: 0, char: 'Gone.png', name: 'Gone', fp: 'old' }] } };
    });
    wihero.app.state.hero.panel = true;
    wihero.app.refresh();
}, BOOK);
await $('.panelmore').click();
await $('.sheet .opt:has-text("Unavailable greeting rules")').click();
await $('.sheet .opt:has-text("Gone")').click();
await $('.sheet .opt:has-text("Seraphina")').click();
await $('.sheet .opt:has-text("Alt 1")').click();
const repointed = await page.evaluate(book => {
    const data = wihero.library.peek(book);
    for (const e of Object.values(data.entries)) {
        const ref = e.extensions?.wihero?.gatedBy?.find(x => x?.greeting !== undefined);
        if (ref) return ref;
    }
    return null;
}, BOOK);
assert.equal(repointed?.char, 'Seraphina.png');
assert.equal(repointed?.greeting, 1);
assert.equal(repointed?.name, 'Seraphina');
ok('an orphaned greeting rule is listed and Repoint rewrites it to a real greeting');

// Phone: the slim notice sits under the top controls and the drawer still starts closed.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
phone.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`phone: ${m.text().slice(0, 300)}`); });
await phone.goto(`${BASE}?reset`);
await phone.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });
await phone.evaluate(book => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.panel = false;
    wihero.app.refresh();
}, BOOK);
const pban = phone.locator('#wihero-editor .greetban');
await pban.waitFor({ timeout: 30000 });
assert.match(await pban.textContent(), /1 linked char found\./);
await phone.locator('#wihero-editor .greetban .gpick').click();
await phone.locator('#wihero-editor .sheet.pop .gopt').first().waitFor({ timeout: 30000 });
await phone.locator('#wihero-editor .sheet.pop .gopt:has-text("Seraphina")').click();
await phone.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban')?.textContent.includes('Greetings: Seraphina'), null, { timeout: 30000 });
const rows = await phone.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const b = root.querySelector('.greetban').getBoundingClientRect();
    const vp = root.querySelector('.vp').getBoundingClientRect();
    const controls = [...root.querySelectorAll('.panelBtn, .explainq')].map(n => n.getBoundingClientRect().bottom);
    return { barTop: b.top, barLeft: b.left, barRight: b.right, width: innerWidth, vpTop: vp.top, vpBottom: vp.bottom, controlBottom: Math.max(...controls) };
});
assert.ok(rows.barTop >= rows.controlBottom, 'the notice is below the canvas top controls');
assert.ok(rows.barTop > rows.vpTop && rows.barLeft >= 0 && rows.barRight <= rows.width, 'the notice is a fitting overlay inside the canvas');
assert.equal(await phone.locator('#wihero-editor .vp .card.greet').count(), 0);
await phone.locator('#wihero-editor .panelBtn').click();
await phone.locator('#wihero-editor .phdr:has-text("Greetings")').waitFor({ timeout: 30000 });
assert.equal(await phone.locator('#wihero-editor .prow.greet').count(), 0, 'the phone drawer starts closed too');
await phone.locator('#wihero-editor .phdr:has-text("Greetings")').click();
await phone.locator('#wihero-editor .prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await phone.locator('#wihero-editor .prow.greet').count(), 3);
ok('phone: the notice fits below the top controls and the drawer starts closed');

assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
ok('no errors in either page');

await browser.close();
server.close();
