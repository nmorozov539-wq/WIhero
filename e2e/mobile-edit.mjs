// Mobile Normal editing against the real save lifecycle and a native editor reload stub.
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
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}?reset&saves`);
    await page.waitForFunction(() => window.wihero);
    await page.evaluate(() => wihero.app.openBook('Moonlit Keep'));
    const host = page.locator('#wihero-editor');
    await host.locator('.bplus').click();
    await page.waitForTimeout(450);
    assert.equal(await host.locator('[aria-label="Entry name"]').count(), 0, 'creating stays on the list');
    const uid = await page.evaluate(() => Math.max(...Object.keys(wihero.library.peek('Moonlit Keep').entries).map(Number)));
    await page.evaluate(uid => {
        const S = wihero.app.state;
        S.tabs.find(t => t.id === S.active).history.push({ type: 'entry', book: 'Moonlit Keep', uid });
        wihero.app.refresh();
    }, uid);
    const tabs = await host.locator('.tab').count();
    const stable = async label => {
        await page.waitForTimeout(450);
        assert.equal(await host.locator('[aria-label="Entry name"]').count(), 1, label);
        assert.equal(await host.locator('.tab').count(), tabs, `${label}: no duplicate tabs`);
    };
    const title = host.locator('[aria-label="Entry name"]');
    await title.fill('Mobile');
    await title.press('End');
    await title.press('Space');
    await title.pressSequentially('title');
    await stable('space while editing a title');
    await title.press('Tab');
    await stable('title blur');
    await host.locator('.kbox').first().click();
    await host.locator('input.kbox').fill('alpha, beta');
    await host.locator('input.kbox').press('Tab');
    await stable('keyword blur');
    const content = host.locator('textarea').first();
    // insertText uses the browser's editing path, including an input event, as pasting does.
    await content.focus();
    await page.keyboard.insertText('Pasted content');
    await stable('pasted content');
    await content.press('Enter');
    await stable('content newline');
    await content.press('Backspace');
    await stable('delete release');
    await host.locator('[aria-label="Entry on"]').click();
    await stable('entry toggle');
    await host.locator('.disc').filter({ hasText: 'Parameters' }).click();
    await host.locator('.prm').filter({ hasText: 'Order' }).click();
    await host.locator('.layer input').fill('123');
    await host.locator('.layer input').press('Enter');
    await stable('parameter change');
    await page.evaluate(() => wihero.library.flush());
    const entry = await page.evaluate(uid => wihero.library.peek('Moonlit Keep').entries[uid], uid);
    assert.equal(entry.comment, 'Mobile title');
    assert.deepEqual(entry.key, ['alpha', 'beta']);
    assert.equal(entry.content, 'Pasted content');
    assert.equal(entry.disable, true);
    assert.equal(entry.order, 123);
    assert.deepEqual(errors, []);
    console.log('PASS: mobile create, title/keywords, paste, newline, delete, toggle and parameter; no navigation or duplicate tabs after saves');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
