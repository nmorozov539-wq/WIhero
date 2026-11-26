// Typing in the 100 KB entry: the box is capped and scrolls inside, a burst stays off the layout path (the token
// count is deferred and history does not capture per key), and the caret/text stay correct. Runs in the perf
// harness, no SillyTavern needed. Measured-native-browser: it records, it does not assert a time.
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
const TYPED = 'The mill keeps its hour';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}?reset&perf=1&books=0&entries=0&big=1&canvas=0&chats=0&long=100000`);
    await page.waitForFunction(() => window.wihero);
    await page.evaluate(() => wihero.app.openBook('Perf Big'));
    await page.evaluate(() => {
        const S = wihero.app.state;
        S.tabs.find(t => t.id === S.active).history.push({ type: 'entry', book: 'Perf Big', uid: 0 });
        wihero.app.refresh();
    });
    const content = page.locator('#wihero-editor .en textarea');
    await content.waitFor();
    await page.waitForTimeout(100);

    const box = await content.evaluate(el => ({
        value: el.value.length,
        height: el.getBoundingClientRect().height,
        client: el.clientHeight,
        scroll: el.scrollHeight,
        overflow: getComputedStyle(el).overflowY,
        cap: Math.min(Math.round(innerHeight * 0.7), 800),
    }));
    assert.ok(box.value >= 100000, 'the harness entry is 100 KB');
    assert.ok(Math.abs(box.height - box.cap) <= 1, `the box is capped at ${box.cap}px (was ${box.height})`);
    assert.equal(box.overflow, 'auto', 'the capped box scrolls inside');
    assert.ok(box.scroll > box.client, 'the 100 KB text is taller than the box');

    // A real scroll reaches the end, so the long text is reachable inside the box rather than the page.
    const scrolled = await content.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    assert.ok(scrolled > 0, 'the box scrolls to the end of the text');

    await page.evaluate(() => wihero.perf.reset());
    await content.focus();
    await content.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(TYPED, { delay: 20 });

    const typed = await content.evaluate(el => ({
        value: el.value,
        start: el.selectionStart,
        end: el.selectionEnd,
        height: el.getBoundingClientRect().height,
        scrollTop: el.scrollTop,
        cap: Math.min(Math.round(innerHeight * 0.7), 800),
        perf: wihero.perf.snapshot(),
    }));
    assert.ok(typed.value.endsWith(TYPED), 'the typed text is in the entry');
    assert.equal(typed.start, typed.value.length, 'the caret stays at the end');
    assert.equal(typed.end, typed.value.length, 'no text is selected over the burst');
    assert.ok(typed.height <= typed.cap + 1, 'the box does not grow past the cap while typing');
    assert.ok(typed.scrollTop > 0, 'typing stays at the caret inside the scroller');
    assert.ok(typed.perf.tokenCalls <= 1, `no tokenizer call per key during the burst (${typed.perf.tokenCalls} for ${TYPED.length} keys)`);
    assert.ok(typed.perf.historyCaptures < TYPED.length / 2, `history captures do not scale per key (${typed.perf.historyCaptures} for ${TYPED.length} keys)`);
    assert.ok(typed.perf.saveAttempts < TYPED.length / 2, `saves do not run per key (${typed.perf.saveAttempts} for ${TYPED.length} keys)`);

    await page.waitForTimeout(1500);
    const settled = await page.evaluate(() => ({
        perf: wihero.perf.snapshot(),
        long: window.__perf?.long ?? null,
    }));
    assert.equal(settled.perf.tokenCalls, 1, 'one deferred tokenizer call lands after the pause');
    assert.ok(settled.perf.historyCaptures <= 2, 'the run still captures only its boundaries');
    assert.deepEqual(errors, []);
    console.log(`PASS: 100 KB entry capped at ${Math.round(box.height)}px with ${box.scroll}px inside; ${TYPED.length} keys leave the height at ${Math.round(typed.height)}px, the caret at the end, ${typed.perf.historyCaptures} history capture(s), ${typed.perf.saveAttempts} save attempt(s) and finally ${settled.perf.tokenCalls} tokenizer call; measured-native-browser`);
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
