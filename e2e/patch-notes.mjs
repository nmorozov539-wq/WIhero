// The Patch notes sheet (☰ → Patch notes): the in-app changelog in both modes, on the desktop browser harness
// (e2e/desktop/harness.html), no SillyTavern needed: the menu row shows the released version, the sheet names that
// version and its date, its groups and lines are readable, the Known line is there, and Escape closes it.
//   node e2e/patch-notes.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CHANGELOG } from '../src/changelog.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const VERSION = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
const ENTRY = CHANGELOG.find(x => x.version === VERSION) ?? CHANGELOG[0];
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

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset`);
await page.locator('#wihero-editor .tab').first().waitFor();
const $ = sel => page.locator(`#wihero-editor ${sel}`);

async function openNotes() {
    await $('button[aria-label="Menu"]').filter({ visible: true }).first().click();
    const row = $('.sheet.menu .opt').filter({ hasText: 'Patch notes' }).first();
    await row.waitFor();
    assert.equal(await row.locator('.val').textContent(), VERSION, 'the menu row shows the released version');
    await row.click();
    const sheet = $('.sheet.notes').last();
    await sheet.waitFor();
    return sheet;
}

async function checkSheet(mode) {
    const sheet = await openNotes();
    assert.equal(await sheet.locator('h2').textContent(), 'Patch notes');
    assert.equal(await sheet.locator('.note h3').first().textContent(), VERSION);
    assert.equal(await sheet.locator('.notedate').first().textContent(), ENTRY.date);
    const groups = await sheet.locator('.notegroup').allTextContents();
    assert.ok(groups.includes(ENTRY.groups[0].title), `${mode}: the first group`);
    const items = await sheet.locator('.notelist li').allTextContents();
    assert.ok(items.includes(ENTRY.groups[0].items[0]), `${mode}: a readable line`);
    assert.ok(items.every(x => x.trim()), `${mode}: no blank lines`);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    ok(`${mode}: ☰ → Patch notes shows ${VERSION}, its groups and lines, and Escape closes it`);
}

await checkSheet('Normal mode');

await page.evaluate(() => { const S = wihero.app.state; S.mode = 'hero'; S.hero.book = 'WIHero-Sample'; wihero.app.refresh(); });
await $('.vp .card').first().waitFor();
await page.waitForTimeout(300);
await checkSheet('Hero mode');

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
server.close();
console.log('patch notes: ok');
