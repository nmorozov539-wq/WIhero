// Opening an entry in the 1,000-entry "Perf Big" book without the clash scan on the entry-open task (G1), in the
// browser harness (e2e/desktop/harness.html); no SillyTavern needed. The book page warms the per-revision clash
// cache on idle, so the title, key words and Content are drawn at once with their marks and `clashScan` stays at
// 0. A cold book (keys just changed, entry opened before the idle warm) draws the same page unmarked, then patches
// the new keys' marks in place; Back before that patch arrives cancels it. Run
// `CHROMIUM=/usr/bin/google-chrome-stable node e2e/entry-open.mjs`; it uses only made-up harness data.
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
const QUERY = '?reset&perf=1&books=0&entries=0&big=1000&canvas=0&chats=0&long=0';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
const $ = sel => page.locator(`#wihero-editor ${sel}`);
const snapshot = () => page.evaluate(() => window.wihero.perf.snapshot());
const waitBook = () => page.waitForFunction(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    return !sr.querySelector('.main > .view[data-pane="entry"]') && !!sr.querySelector('.main > .view[data-pane="list"]');
}, null, { timeout: 60000 });

/** The first two visible entry rows' uids, so both are in the mounted window. */
const firstTwo = () => page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    return [...sr.querySelectorAll('.main > .view[data-pane="list"] .item.ent')].slice(0, 2).map(r => ({
        uid: Number(r.dataset.uid), title: r.querySelector('.nm').textContent,
    }));
});

try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.evaluate(() => { window.wihero.perf.timing = true; });
    await page.click('#wi-button');
    await $('.tab').first().waitFor({ timeout: 60000 });
    await $('.item[data-book="Perf Big"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    // Give two visible rows one shared key word, so the page has a mark to check. The change redraws the book and
    // schedules its warm; the wait below outlasts the quiet window (700 ms) so that warm has painted and cached, as
    // it does before a reader's tap on a settled page.
    const rows = await firstTwo();
    assert.equal(rows.length, 2, 'the book has visible rows to open');
    await page.evaluate(([a, b]) => {
        window.wihero.library.change('Perf Big', d => {
            d.entries[a].key = ['quokka'];
            d.entries[b].key = ['Quokka'];
        });
    }, [rows[0].uid, rows[1].uid]);
    await page.waitForTimeout(1400);

    // 1. The warm book: draw the page and its marks in one task, with no clash scan.
    await page.evaluate(() => window.wihero.perf.reset());
    await $(`.item.ent[data-uid="${rows[0].uid}"]`).click();
    await $('.en h1').waitFor({ timeout: 60000 });
    const warm = await page.evaluate(uid => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.main > .view[data-pane="entry"]');
        const data = window.wihero.library.peek('Perf Big');
        return {
            title: view.querySelector('.en h1').textContent,
            content: view.querySelector('textarea[aria-label="Content"]')?.value,
            expectedContent: data.entries[uid].content,
            chips: [...view.querySelectorAll('.kchip')].map(c => c.textContent),
            keys: data.entries[uid].key,
            marked: view.querySelectorAll('.kchip.clash').length,
            note: view.querySelector('.clashnote')?.textContent ?? '',
            noteHidden: view.querySelector('.clashnote')?.hidden,
            sections: {
                strategy: !!view.querySelector('.srow .switch'),
                parameters: !!view.querySelector('.disc:not(.logich)'),
                content: !!view.querySelector('textarea[aria-label="Content"]'),
                story: !!view.querySelector('.logich'),
            },
        };
    }, rows[0].uid);
    const warmSnap = await snapshot();
    assert.equal(warmSnap.clashScanMs, 0, `no clash scan on the entry-open task (${warmSnap.clashScanMs} ms)`);
    assert.equal(warmSnap.entryPageCalls, 1, 'the entry page is drawn once');
    assert.equal(warm.title, rows[0].title, 'the title is there at once');
    assert.equal(warm.content, warm.expectedContent, 'the Content textarea has the entry text at once');
    assert.deepEqual(warm.chips, warm.keys, 'the key words are there at once');
    assert.ok(warm.sections.strategy && warm.sections.content && warm.sections.parameters, 'strategy/switch, Parameters and Content are on the page');
    assert.ok(warm.marked > 0, 'the key words arrive already marked from the warm cache');
    assert.ok(!warm.noteHidden && /also fires/i.test(warm.note), 'the clash note names what the marked words also fire');
    ok(`a warm book opens the entry with title, Content and key words marked; clashScan ${warmSnap.clashScanMs} ms, entryPage ${warmSnap.entryPageMs} ms`);

    await $('.en-top [aria-label="Up to the book"]').click();
    await waitBook();

    // 2. The quiet window: a fresh revision schedules the warm, but wheel events on the book view keep pushing it
    //    back; it runs only after they stop.
    await page.evaluate(() => {
        window.wihero.library.change('Perf Big', () => {});
        window.wihero.perf.reset();
    });
    await page.evaluate(async () => {
        const view = document.querySelector('#wihero-editor').shadowRoot.querySelector('.main > .view[data-pane="list"]');
        for (let i = 0; i < 5; i++) {
            view.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 120));
        }
    });
    const during = await snapshot();
    assert.equal(during.clashScanCalls, 0, 'wheel events keep the warm waiting');
    await page.waitForTimeout(900);
    const afterQuiet = await snapshot();
    assert.ok(afterQuiet.clashScanCalls > 0, 'the warm runs after the book page has been quiet');
    ok('book-page wheel events hold the warm back; it runs after the quiet window');

    // 3. A cold book: change both rows' keys, then open one before the warm can run. The page must show the
    //    new key words at once, unmarked, and then mark them from the scan that lands later.
    const cold = await page.evaluate(uid => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.wihero.library.change('Perf Big', d => {
            d.entries[uid[0]].key = ['quokka'];
            d.entries[uid[1]].key = ['Quokka'];
        });
        // Same task: no idle callback can have run between the change's redraw and this click.
        sr.querySelector(`.item.ent[data-uid="${uid[0]}"]`).click();
        const view = sr.querySelector('.main > .view[data-pane="entry"]');
        return {
            title: view.querySelector('.en h1').textContent,
            chips: [...view.querySelectorAll('.kchip')].map(c => c.textContent),
            marked: view.querySelectorAll('.kchip.clash').length,
        };
    }, [rows[0].uid, rows[1].uid]);
    assert.equal(cold.title, rows[0].title, 'the cold page shows the title at once');
    assert.deepEqual(cold.chips, ['quokka'], 'the cold page shows the new key word at once');
    assert.equal(cold.marked, 0, 'the cold page is drawn unmarked before the deferred scan');
    await page.waitForFunction(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return !!sr.querySelector('.main > .view[data-pane="entry"] .kchip.clash');
    }, null, { timeout: 60000 });
    const deferred = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        const view = sr.querySelector('.main > .view[data-pane="entry"]');
        const chip = view.querySelector('.kchip.clash');
        return { text: chip?.textContent, title: chip?.title, note: view.querySelector('.clashnote')?.textContent };
    });
    assert.equal(deferred.text, 'quokka', 'the deferred pass marks the new key word');
    assert.match(deferred.title, new RegExp(rows[1].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the mark names the other entry');
    assert.match(deferred.note, /quokka also fires/i, 'the clash note is patched with the new word');
    ok('a cold book draws the new key words unmarked, then patches their marks from the deferred scan');

    await $('.en-top [aria-label="Up to the book"]').click();
    await waitBook();

    // 4. Back before the deferred scan lands: the page is detached and is never patched.
    const gone = await page.evaluate(uid => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        window.wihero.library.change('Perf Big', () => {}); // a fresh revision: the next open is cold again
        sr.querySelector(`.item.ent[data-uid="${uid}"]`).click();
        sr.querySelector('.main > .view[data-pane="entry"] .en-top [aria-label="Up to the book"]').click();
        return !!sr.querySelector('.main > .view[data-pane="entry"]');
    }, rows[0].uid);
    assert.equal(gone, false, 'Back removes the entry page before the deferred pass can run');
    // Outlast the quiet window so the deferred scan does run (and finds the page detached), rather than the test
    // simply finishing before it was ever scheduled.
    await page.waitForTimeout(1200);
    const afterBack = await page.evaluate(() => {
        const sr = document.querySelector('#wihero-editor').shadowRoot;
        return {
            entry: !!sr.querySelector('.main > .view[data-pane="entry"]'),
            list: !!sr.querySelector('.main > .view[data-pane="list"]'),
        };
    });
    assert.equal(afterBack.entry, false, 'no detached entry page comes back');
    assert.equal(afterBack.list, true, 'the book page is still there');
    ok('Back before the deferred clash pass leaves no entry page behind');

    assert.deepEqual(errors, [], 'no errors in the page');
    ok('no errors in the page');
} finally {
    await browser.close();
    server.close();
}
