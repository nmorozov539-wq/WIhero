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

// No chat, one linked character: an offer, no cards until it is taken.
await hero();
await $('.vp').waitFor({ timeout: 30000 });
await $('.greetban').waitFor({ timeout: 30000 });
assert.match(await bannerText(), /Use Seraphina's greetings while editing this book\?/);
assert.equal((await cards()).length, 0, 'no greetings before a manual pick');
ok('no chat with one linked character offers her greetings, without showing cards');

// Use greetings: three start cards, editing only (the harness has no chat state to fire).
await $('.greetban button:has-text("Use greetings")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelectorAll('.vp .card.greet').length === 3, null, { timeout: 30000 });
assert.match(await bannerText(), /Greetings: Seraphina/);
assert.match(await bannerText(), /Change/);
assert.match(await bannerText(), /Hide/);
const shown = await cards();
assert.deepEqual(shown.map(c => c.id).sort(), ['greet:Seraphina.png:0', 'greet:Seraphina.png:1', 'greet:Seraphina.png:2']);
assert.equal(shown.find(c => c.id.endsWith(':1')).title, 'Alt 1');
assert.equal(await page.evaluate(() => !!wihero.app.state.hero.greet), true);
ok('Use greetings shows the editing cards and the Change/Hide control');

// The panel's Greetings drawer: nickname primary, canonical secondary, saved in settings only.
await page.evaluate(() => { wihero.app.state.hero.panel = true; wihero.app.refresh(); });
await $('.prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await $('.prow.greet').count(), 3);
assert.equal(await $('.prow.greet .rowact').count(), 3, 'each greeting row has Rename');
await $('.prow.greet[data-key="greet:Seraphina.png:1"] .rowact').click();
await $('.nickin').waitFor({ timeout: 30000 });
assert.equal(await $('.nickin').inputValue(), '', 'no nickname yet');
await $('.nickin').fill('The market');
await $('.greetrow .pri').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.prow.greet[data-key="greet:Seraphina.png:1"] b')?.textContent === 'The market', null, { timeout: 30000 });
const renamed = (await cards()).find(c => c.id.endsWith(':1'));
assert.equal(renamed.title, 'The market');
assert.match(renamed.detail, /Alt 1/, 'the alternate stays visible');
const names = await settingsNames();
assert.equal(names['Seraphina.png']?.[1]?.name, 'The market');
assert.equal(typeof names['Seraphina.png']?.[1]?.fp, 'string');
assert.equal(await page.evaluate(book => {
    const data = wihero.library.peek(book);
    return JSON.stringify(data).includes('The market');
}, BOOK), false, 'the nickname is not written into the book');
ok('Rename stores a settings nickname; the card shows it with Alt 1 secondary and the book is untouched');

// Clear restores the canonical label.
await $('.prow.greet[data-key="greet:Seraphina.png:1"] .rowact').click();
await $('.nickin').waitFor({ timeout: 30000 });
assert.equal(await $('.nickin').inputValue(), 'The market', 'prefilled with the current nickname');
await $('.greetrow button:has-text("Clear")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.prow.greet[data-key="greet:Seraphina.png:1"] b')?.textContent === 'Alt 1', null, { timeout: 30000 });
assert.equal((await cards()).find(c => c.id.endsWith(':1')).title, 'Alt 1');
assert.deepEqual(await settingsNames(), {});
ok('Clear removes the nickname and restores Alt 1');

// Hide takes the cards and the control away; nothing is marked fired.
await $('.greetban button:has-text("Hide")').click();
await page.waitForFunction(() => !document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban'), null, { timeout: 30000 });
assert.equal((await cards()).length, 0, 'Hide removes the greeting cards');
assert.equal(await page.evaluate(() => !!wihero.app.state.hero.greet), false);
ok('Hide clears the manual choice, cards and control');

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
assert.match(await bannerText(), /Choose a character's greetings while editing this book/);
await $('.greetban button:has-text("Choose")').click();
assert.equal(await $('.sheet .gopt').count(), 2, 'both linked characters are offered with avatars and names');
await $('.sheet .gopt:has-text("Bob")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelectorAll('.vp .card.greet').length === 2, null, { timeout: 30000 });
assert.match(await bannerText(), /Greetings: Bob/);
assert.deepEqual((await cards()).map(c => c.id).sort(), ['greet:Bob.png:0', 'greet:Bob.png:1']);
await $('.greetban button:has-text("Hide")').click();
await page.waitForFunction(() => !document.getElementById('wihero-editor').shadowRoot.querySelector('.greetban'), null, { timeout: 30000 });
ok('several linked characters offer a picker; choosing Bob switches the greeting cards');

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

// Phone: the same offer and cards, in the phone layout; the bar takes its own row and covers no cards.
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
assert.match(await pban.textContent(), /Use Seraphina's greetings while editing this book\?/);
await phone.locator('#wihero-editor .greetban button:has-text("Use greetings")').click();
await phone.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelectorAll('.vp .card.greet').length === 3, null, { timeout: 30000 });
const rows = await phone.evaluate(() => {
    const root = document.getElementById('wihero-editor').shadowRoot;
    const b = root.querySelector('.greetban').getBoundingClientRect();
    const vp = root.querySelector('.vp').getBoundingClientRect();
    return { barBottom: b.bottom, canvasTop: vp.top, barLeft: b.left, barRight: b.right, width: innerWidth };
});
assert.ok(rows.barBottom <= rows.canvasTop + 1, 'the bar has its own row above the canvas');
assert.ok(rows.barLeft >= 0 && rows.barRight <= rows.width, 'the bar fits the phone width');
await phone.locator('#wihero-editor .panelBtn').click();
await phone.locator('#wihero-editor .prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await phone.locator('#wihero-editor .prow.greet').count(), 3);
ok('phone: the offer, cards and panel rows fit, with the bar above the canvas');

assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
ok('no errors in either page');

await browser.close();
server.close();
