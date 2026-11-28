// Greetings in Hero mode, in the browser harness (no SillyTavern and no chat): source discovery and switching live
// in the drawer, a sole linked character is automatic, manual choices open the folder, and search keeps the source
// control visible. Greeting cards are still placed explicitly and nicknames stay in WI Hero's settings.
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
const LONG_BOB = 'Bob with an extraordinarily long character name';
const LONG_SERAPHINA = 'Seraphina of the Very Long Character Name';

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
const settingsNames = () => page.evaluate(book => structuredClone(wihero.settings.books[book]?.greetingNames ?? {}), BOOK);

// No chat, one linked character: it is used automatically in the one collapsed drawer row.
await hero();
await $('.vp').waitFor({ timeout: 30000 });
await $('.greethead').waitFor({ timeout: 30000 });
assert.equal(await $('.greetban').count(), 0, 'there is no persistent canvas greeting notice');
assert.match(await $('.greethead').textContent(), /Greetings/);
assert.match(await $('.greethead').textContent(), /Seraphina/);
assert.equal(await $('.greethead button.greetsource').count(), 0, 'a sole linked source needs no picker');
assert.equal((await cards()).length, 0, 'found greetings do not spawn on the canvas');
ok('one valid linked character is automatic and starts collapsed without a canvas notice');

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

// Collapsing is the only hide action; placed cards remain an explicit canvas choice.
await $('.phdr:has-text("Greetings")').click();
assert.equal(await $('.prow.greet').count(), 0, 'collapsing hides the greeting rows');
assert.equal((await cards()).length, 1, 'collapsing does not silently remove a placed card');
ok('collapsing replaces the old Hide action without changing placed cards');

// Several linked characters: the drawer itself asks for a source, and a manual choice expands it immediately.
await page.evaluate(({ book, longBob }) => {
    wihero.library.links = () => [
        { kind: 'char', name: 'Seraphina', avatar: 'Seraphina.png' },
        { kind: 'char', name: longBob, avatar: 'Bob.png' },
    ];
    const h = wihero.app.state.hero;
    h.greet = null;
    h.greetView = null;
    h.openFolders.delete('\u0000greetings');
    h.panel = true;
    wihero.app.refresh();
}, { book: BOOK, longBob: LONG_BOB });
await $('.greethead').waitFor({ timeout: 30000 });
assert.match(await $('.greethead').textContent(), /Choose character/);
assert.equal(await $('.prow.greet').count(), 0);
await $('.greetsource').click();
await $('.sheet.pop .gopt').first().waitFor({ timeout: 30000 });
assert.equal(await $('.sheet.pop .gopt').count(), 2, 'both linked characters are offered with avatars and names');
await $('.sheet.pop .gopt:has-text("Bob")').click();
await page.waitForFunction(() => document.getElementById('wihero-editor').shadowRoot.querySelector('.greethead')?.textContent.includes('Bob'), null, { timeout: 30000 });
assert.equal(await $('.greetsource').getAttribute('title'), LONG_BOB);
assert.equal(await $('.greetsource span').evaluate(n => n.scrollWidth > n.clientWidth), true, 'a long switchable name is ellipsized');
await $('.prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await $('.prow.greet').count(), 2, 'Bob has two greeting rows');
assert.equal(await page.evaluate(() => wihero.app.state.hero.openFolders.has('\u0000greetings')), true, 'manual choice expands the folder');
assert.equal((await cards()).length, 0, 'switching sources does not carry Seraphina cards into Bob');

await $('.panel .phead input').fill('not-a-greeting');
assert.equal(await $('.greethead').count(), 1, 'search never hides the source selector');
assert.equal(await $('.greetempty').textContent(), 'No matching greetings');
await $('.panel .phead input').fill('');
ok('multiple links use the drawer picker, expand after choice, and survive an empty search');
await page.screenshot({ path: '/tmp/st-wihero-greetings-desktop.png', fullPage: true });

// No links and no chat: no banner and no cards.
await $('.panel .phead input').blur();
await page.evaluate(book => {
    wihero.library.links = () => [];
    const h = wihero.app.state.hero;
    h.greet = null;
    h.greetView = null;
    h.panel = true;
    wihero.app.refresh();
}, BOOK);
await page.waitForFunction(() => !document.getElementById('wihero-editor').shadowRoot.querySelector('.greethead'), null, { timeout: 30000 });
assert.equal(await $('.greetban').count(), 0);
assert.equal(await $('.greethead').count(), 0);
assert.equal((await cards()).length, 0);
ok('no linked characters and no chat show no Greetings row or greeting cards');

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

// Phone: the same compact drawer row fits, starts closed, and has no canvas overlay.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
phone.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`phone: ${m.text().slice(0, 300)}`); });
await phone.goto(`${BASE}?reset`);
await phone.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });
await phone.evaluate(({ book, longName }) => {
    wihero.library.links = () => [{ name: longName, kind: 'char', avatar: 'Seraphina.png' }];
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.panel = false;
    wihero.app.refresh();
}, { book: BOOK, longName: LONG_SERAPHINA });
assert.equal(await phone.locator('#wihero-editor .greetban').count(), 0);
assert.equal(await phone.locator('#wihero-editor .vp .card.greet').count(), 0);
await phone.locator('#wihero-editor .panelBtn').click();
const phoneHead = phone.locator('#wihero-editor .greethead');
await phoneHead.waitFor({ timeout: 30000 });
await phone.waitForTimeout(350); // let the narrow drawer finish its slide-in transition before measuring it
assert.match(await phoneHead.textContent(), /Seraphina/);
assert.equal(await phone.locator('#wihero-editor .greetsource.static').getAttribute('title'), LONG_SERAPHINA);
assert.equal(await phone.locator('#wihero-editor .greetsource.static span').evaluate(n => n.scrollWidth > n.clientWidth), true, 'a long static name is ellipsized');
const phoneBox = await phoneHead.boundingBox();
assert.ok(phoneBox.x >= 0 && phoneBox.x + phoneBox.width <= 390, 'the source row fits the narrow drawer');
assert.equal(await phone.locator('#wihero-editor .prow.greet').count(), 0, 'the phone drawer starts closed too');
await phone.locator('#wihero-editor .phdr:has-text("Greetings")').click();
await phone.locator('#wihero-editor .prow.greet').first().waitFor({ timeout: 30000 });
assert.equal(await phone.locator('#wihero-editor .prow.greet').count(), 3);
ok('phone: the compact source row fits and the drawer starts closed');
await phone.screenshot({ path: '/tmp/st-wihero-greetings-narrow.png', fullPage: true });

assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
ok('no errors in either page');

await browser.close();
server.close();
