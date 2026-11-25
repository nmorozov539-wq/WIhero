// The autosize fallback for browsers without `field-sizing: content`: the entry textarea is fitted in rAF, so a
// 100 KB entry sizes from its content and grows on input. Runs in the perf harness, no SillyTavern needed.
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
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Before any page script: report no support, so autoText takes the measured fallback.
    await page.addInitScript(() => {
        const supports = CSS.supports.bind(CSS);
        Object.defineProperty(CSS, 'supports', {
            configurable: true,
            value: (...args) => (String(args[0]).includes('field-sizing') ? false : supports(...args)),
        });
    });
    await page.goto(`${BASE}?reset&perf=1&books=0&entries=0&big=1&canvas=0&chats=0&long=100000`);
    await page.waitForFunction(() => window.wihero);
    assert.equal(await page.evaluate(() => CSS.supports('field-sizing', 'content')), false, 'field sizing is reported unsupported');
    await page.evaluate(() => wihero.app.openBook('Perf Big'));
    await page.evaluate(() => {
        const S = wihero.app.state;
        S.tabs.find(t => t.id === S.active).history.push({ type: 'entry', book: 'Perf Big', uid: 0 });
        wihero.app.refresh();
    });
    const content = page.locator('#wihero-editor .en textarea');
    await content.waitFor();
    await page.waitForTimeout(100);
    const before = await content.evaluate(el => ({ value: el.value.length, height: el.getBoundingClientRect().height, inline: el.style.height }));
    assert.ok(before.value >= 100000, 'the harness entry is 100 KB');
    assert.match(before.inline, /^\d+px$/, 'the fallback set its measured height');
    assert.ok(before.height > 200, 'the textarea grew past its minimum');
    await content.focus();
    await content.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.insertText('\nThe mill keeps one more hour.');
    await page.waitForTimeout(100);
    const after = await content.evaluate(el => ({ value: el.value.length, height: el.getBoundingClientRect().height }));
    assert.ok(after.value > before.value, 'the typed text is in the entry');
    assert.ok(after.height > before.height, 'one frame later the textarea grew again');
    assert.deepEqual(errors, []);
    console.log('PASS: without field-sizing, the 100 KB entry textarea is measured on the first frame and grows on input');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
