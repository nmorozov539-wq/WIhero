// Phone-speed profile of opening WI Hero (not a pass/fail check): CPU throttled 6x, 390 × 844, many books.
// Makes 40 "Stress" books if they aren't there (and leaves them). Prints how long Home takes to settle, how many times it redraws, the long tasks, and whether a tap lands.
import { chromium } from 'playwright';

const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const RATE = Number(process.env.CPU_RATE || 6);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto(ST_URL);
const welcome = page.locator('.popup:has-text("Welcome to SillyTavern") .popup-button-ok');
await welcome.waitFor({ timeout: 15000 }).then(() => welcome.click(), () => {});
await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
// 40 books of 150 entries, the first five with story logic (each third entry waits on the one three before it).
await page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const have = new Set(c.getWorldInfoNames());
    const words = 'ash bay cove dale elm fen glen hall isle keep lake mead moor oak pass ridge spire tor vale well'.split(' ');
    for (let b = 1; b <= 40; b++) {
        const name = `Stress ${String(b).padStart(2, '0')}`;
        if (have.has(name)) continue;
        const entries = {};
        for (let u = 0; u < 150; u++) {
            const k = words[u % 20] + u;
            entries[u] = {
                uid: u, key: [k, `${k}s`], keysecondary: [], comment: `Entry ${u} of book ${b}`, content: `Lore text for ${k}. `.repeat(20),
                constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0,
                probability: 100, useProbability: true, depth: 4, displayIndex: u,
            };
            if (b <= 5 && u % 3 === 0) entries[u].extensions = { wihero: u > 3 ? { id: `e${u}`, gate: [[`e${u - 3}`]] } : { id: `e${u}` } };
        }
        await fetch('/api/worldinfo/edit', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name, data: { entries } }) });
    }
});
await page.evaluate(async () => { await SillyTavern.getContext().updateWorldInfoList(); wihero.settings.openInHero = false; });
const books = await page.evaluate(() => SillyTavern.getContext().getWorldInfoNames().length);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await page.evaluate(() => {
    window.__perf = { long: [], renders: 0 };
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    const host = document.getElementById('wihero-editor');
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('view')) window.__perf.renders++; })
        .observe(host.shadowRoot.querySelector('.main'), { childList: true });
});
const t0 = Date.now();
await page.click('#WI-SP-button .drawer-toggle');
const $ = sel => page.locator(`#wihero-editor ${sel}`);
await $('.item[data-book]').first().waitFor();
const firstRow = Date.now() - t0;
// Tap the first book while it is still loading.
const tapAt = Date.now();
await $('.item[data-book="Stress 02"]').tap({ timeout: 20000 }).catch(e => console.log('tap failed:', e.message.split('\n')[0]));
const opened = await $('.bkname h1').first().waitFor({ timeout: 20000 }).then(() => Date.now() - tapAt, () => null);
// Settle: no redraw for 2 s.
let last = -1;
for (let i = 0; i < 120; i++) {
    const r = await page.evaluate(() => window.__perf.renders);
    if (r === last) break;
    last = r;
    await page.waitForTimeout(2000);
}
const settled = Date.now() - t0;
const perf = await page.evaluate(() => window.__perf);
const total = perf.long.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ step: 'home', books, cpu: `${RATE}x`, firstRowMs: firstRow, tapToOpenMs: opened, settledMs: settled, redraws: perf.renders, longTasks: perf.long.length, longTaskMs: total, worstMs: Math.max(0, ...perf.long) }));

/** Runs a step and reports its time and the long tasks during it. */
async function step(name, fn) {
    await page.evaluate(() => { window.__perf.long = []; });
    const t = Date.now();
    const extra = await fn();
    const ms = Date.now() - t;
    await page.waitForTimeout(300);
    const long = await page.evaluate(() => window.__perf.long);
    console.log(JSON.stringify({ step: name, ms, longTasks: long.length, worstMs: Math.max(0, ...long), ...extra }));
}
await step('scroll the book page', async () => {
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(50); }
    return { rows: await $('.item.ent').count() };
});
await step('open an entry', async () => {
    await $('.item.ent').nth(3).tap();
    await $('.en h1').waitFor();
});
await step('Hero mode on a book with story logic', async () => {
    await page.evaluate(() => { wihero.settings.openInHero = true; });
    await $('.tab.fixed[aria-label="Home"]').tap();
    await $('.item[data-book="Stress 01"]').tap();
    await $('.card').first().waitFor({ timeout: 60000 });
    return { cards: await $('.card').count() };
});
await step('tap a card', async () => {
    await $('.card .t').first().tap();
    await $('.insp .ihead').waitFor();
});
await step('pan the canvas', async () => {
    await page.evaluate(() => wihero.app);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(50); }
});
await page.evaluate(() => { wihero.settings.openInHero = false; SillyTavern.getContext().saveSettingsDebounced(); });
await browser.close();
