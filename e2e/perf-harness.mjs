// A phone-speed profile of the disposable browser harness (`?perf=1` in e2e/desktop/harness.html): 390 × 844, one
// long chat, 41 generated books, a 1,000-entry "Perf Big" with a placed canvas and a 100 KB entry. It needs no
// SillyTavern and never touches a real library; everything lives in the page's memory and localStorage.
//
// This is a recording, not a pass/fail check: no absolute time is asserted. One JSON line per step on stdout; --out
// writes the whole run as an array. Each record is labelled measured-at-6x (any --rate but 1) or
// measured-native-browser, and carries the machine, viewport, CPU rate and profile.
//
//   node e2e/perf-harness.mjs                  6× CPU, 390 × 844
//   node e2e/perf-harness.mjs --rate 1         no throttle
//   node e2e/perf-harness.mjs --runs 3         three fresh pages, each with its own measurements
//   node e2e/perf-harness.mjs --out run.json
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('..', import.meta.url).pathname;

// A static server for the repo: the harness loads src/, tools/perf/ and examples/ by relative URLs.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

function args(argv) {
    const out = { rate: 6, out: null, runs: 1 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--rate') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--rate needs a number');
            out.rate = Number(argv[++i]);
        } else if (arg === '--out') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--out needs a path');
            out.out = argv[++i];
        } else if (arg === '--runs') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--runs needs a number');
            out.runs = Math.floor(Number(argv[++i]));
        } else throw new Error(`unknown argument: ${arg}`);
    }
    if (!(Number.isFinite(out.rate) && out.rate >= 1)) throw new Error('--rate must be 1 or more');
    if (!(Number.isFinite(out.runs) && out.runs >= 1)) throw new Error('--runs must be 1 or more');
    return out;
}

const options = args(process.argv.slice(2));
const QUERY = '?reset&perf=1&books=40&entries=150&big=1000&canvas=500&keys=shared&keyCount=4&long=100000&chats=240';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;
const VIEWPORT = { width: 390, height: 844 };
const LABEL = options.rate !== 1 ? 'measured-at-6x' : 'measured-native-browser';
// The typing step's 50 characters, kept in one place.
const TYPED = 'The mill by the harbor keeps its own quiet hours on the long road.'.slice(0, 50);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const machine = {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model?.trim() ?? null,
    node: process.versions.node,
    browser: `chromium ${browser.version()}`,
};
const records = [];
const emit = record => {
    records.push(record);
    console.log(JSON.stringify(record));
};

/** One fresh page (its own localStorage is cleared by `?reset`) and the whole scenario. */
async function runOnce(run) {
    const page = await browser.newPage({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) pageErrors.push(m.text().slice(0, 300));
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.rate });
    const $ = sel => page.locator(`#wihero-editor ${sel}`);
    let currentStep = 'page load';
    let profile = null;
    let seeded = null;
    const base = () => ({ label: LABEL, machine, viewport: VIEWPORT, cpuRate: options.rate, profile, seeded, ...(options.runs > 1 ? { run } : {}) });
    const resetPerf = () => page.evaluate(() => { window.__perf.long = []; window.__perf.renders = 0; });
    const snapshot = () => page.evaluate(() => {
        const host = document.getElementById('wihero-editor');
        const sr = host?.shadowRoot;
        const long = window.__perf.long;
        return {
            appRenders: window.__perf.renders,
            longTasks: long.length,
            longTaskMs: long.reduce((a, b) => a + b, 0),
            worstMs: Math.max(0, ...long),
            domNodes: document.querySelectorAll('*').length + (sr ? sr.querySelectorAll('*').length : 0),
            rowsMounted: sr ? sr.querySelectorAll('.view .item, .view .ptile, .vp .card, .prow, .brow').length : 0,
        };
    });
    /** Runs a step and reports its time, long tasks, worst task, DOM size and mounted rows. */
    const step = async (name, fn) => {
        currentStep = name;
        await resetPerf();
        const t0 = Date.now();
        const extra = (await fn()) ?? {};
        const ms = Date.now() - t0;
        await page.waitForTimeout(300);
        emit({ step: name, ...base(), ms, ...(await snapshot()), ...extra });
    };
    const perfSnapshot = () => page.evaluate(() => wihero.perf.snapshot());
    const perfDelta = (before, after) => {
        const out = {};
        for (const key of Object.keys(after)) {
            if (typeof after[key] !== 'number') continue;
            out[key] = Math.round((after[key] - (before[key] ?? 0)) * 1000) / 1000;
        }
        return out;
    };
    /** A step with the app's counters and timing regions turned on; `perf` is the delta for that step alone. */
    const perfStep = async (name, fn) => {
        currentStep = name;
        await page.evaluate(() => wihero.perf.timing = true);
        await page.evaluate(() => wihero.perf.reset());
        const before = await perfSnapshot();
        await resetPerf();
        const t0 = Date.now();
        const extra = (await fn()) ?? {};
        const ms = Date.now() - t0;
        await page.waitForTimeout(300);
        const after = await perfSnapshot();
        await page.evaluate(() => wihero.perf.timing = false);
        emit({ step: name, ...base(), ms, ...(await snapshot()), ...extra, perf: perfDelta(before, after) });
    };
    const openMenu = async () => {
        await $('button[aria-label="Menu"]').click();
        await $('.sheet').waitFor();
    };
    const home = async () => {
        await $('.tab.fixed[aria-label="Home"]').click();
        await $('.item[data-book]').first().waitFor();
    };
    /** A real touch on a card that is actually on screen, clear of the panel and the piece bar. */
    const tapCard = async () => {
        const at = await page.evaluate(() => {
            const sr = document.getElementById('wihero-editor').shadowRoot;
            const vp = sr.querySelector('.vp');
            const r = vp.getBoundingClientRect();
            const x0 = r.left + 12, x1 = r.right - 12, y0 = r.top + 60, y1 = r.bottom - 120;
            const cardAt = (x, y) => (sr.elementFromPoint(x, y)?.closest('.card') ? { x, y } : null);
            for (const card of sr.querySelectorAll('.vp .card')) {
                const b = card.getBoundingClientRect();
                const x = (Math.max(b.left, x0) + Math.min(b.right, x1)) / 2;
                const y = (Math.max(b.top, y0) + Math.min(b.bottom, y1)) / 2;
                if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
                const hit = cardAt(x, y);
                if (hit) return hit;
            }
            for (let y = y0 + 4; y < y1; y += 12) for (let x = x0 + 4; x < x1; x += 12) {
                const hit = cardAt(x, y);
                if (hit) return hit;
            }
            return null;
        });
        if (!at) throw new Error('no card is on screen to tap');
        await page.touchscreen.tap(at.x, at.y);
    };

    try {
        await page.goto(BASE);
        await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
        profile = await page.evaluate(() => globalThis.wiheroHarnessProfile);
        seeded = await page.evaluate(() => {
            const big = wihero.library.peek('Perf Big');
            return {
                books: wihero.library.names().length,
                bigEntries: Object.keys(big.entries).length,
                placedCards: Object.keys(wihero.settings.books['Perf Big'].canvas.cards).length,
                longEntryChars: Object.values(big.entries).find(e => e.comment === 'Perf long entry')?.content.length ?? 0,
                chatMessages: globalThis.wiheroHarnessProfile.chats * 2 + 1,
            };
        });
        // Observe the app's own redraws and long tasks from before the first draw.
        await page.evaluate(() => {
            window.__perf = { long: [], renders: 0 };
            new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.long.push(Math.round(e.duration)); })
                .observe({ type: 'longtask', buffered: false });
            const host = document.getElementById('wihero-editor');
            new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('view')) window.__perf.renders++; })
                .observe(host.shadowRoot.querySelector('.main'), { childList: true });
        });

        currentStep = 'cold Home';
        await resetPerf();
        const t0 = Date.now();
        await page.click('#wi-button');
        await $('.tab').first().waitFor({ timeout: 60000 });
        const firstTabMs = Date.now() - t0;
        await $('.item[data-book]').first().waitFor({ timeout: 60000 });
        const firstRowMs = Date.now() - t0;
        await page.waitForTimeout(300);
        emit({ step: 'cold Home', ...base(), ms: firstRowMs, firstTabMs, firstRowMs, ...(await snapshot()) });

        await step('earliest tap on a book (no loading wait)', async () => {
            await $('.item[data-book="Perf Book 010"]').click();
            await $('.bkname h1').filter({ hasText: 'Perf Book 010' }).waitFor();
            await $('.item.ent').first().waitFor();
        });

        await step('warm Home (Home to book to Home)', async () => {
            await home();
            await $('.item[data-book="Perf Book 001"]').click();
            await $('.bkname h1').waitFor();
            await $('.item.ent').first().waitFor();
            await home();
        });

        await step('Home settled (no redraw for 1 s)', async () => {
            const started = Date.now();
            let last = await page.evaluate(() => window.__perf.renders);
            let quiet = Date.now();
            while (Date.now() - quiet < 1000 && Date.now() - started < 20000) {
                await page.waitForTimeout(200);
                const renders = await page.evaluate(() => window.__perf.renders);
                if (renders !== last) { last = renders; quiet = Date.now(); }
            }
            return { quietMs: Date.now() - quiet };
        });

        await perfStep('open the 1,000-entry book', async () => {
            await $('.item[data-book="Perf Big"]').click();
            await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
            await $('.item.ent').first().waitFor({ timeout: 60000 });
        });

        await step('scroll the book page', async () => {
            await page.mouse.move(195, 420);
            for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(50); }
        });

        await perfStep('open an entry', async () => {
            await $('.item.ent').nth(3).click();
            await $('.en h1').waitFor();
        });
        currentStep = 'back to the book';
        await page.keyboard.press('Escape');
        await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor();

        await step('A–Z sort', async () => {
            await openMenu();
            await $('.opt').filter({ hasText: 'Sort by' }).click();
            await $('.opt').filter({ hasText: 'A–Z' }).click();
            await $('.item.ent').first().waitFor();
            await page.keyboard.press('Escape');
            return { sort: await page.evaluate(() => wihero.settings.sortBy) };
        });
        // Put the order back through the same menu, untimed: later Hero steps should not inherit the A–Z list.
        currentStep = 'sort back to List order';
        await openMenu();
        await $('.opt').filter({ hasText: 'Sort by' }).click();
        await $('.opt').filter({ hasText: 'List order' }).click();
        await page.keyboard.press('Escape');

        await step('search typing', async () => {
            await $('.bsearch').click();
            await $('.search input').waitFor();
            await $('.search input').click();
            await page.keyboard.type('mill', { delay: 150 });
            await $('.res .item').first().waitFor({ timeout: 60000 });
            return { results: await $('.res .item').count() };
        });
        currentStep = 'close search';
        await page.keyboard.press('Escape');
        await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor();

        // Hero mode, chosen through its menu, then opening Perf Big from Home (the way a reader does).
        currentStep = 'choose Hero mode';
        await home();
        await openMenu();
        await $('.opt').filter({ hasText: 'Open books in' }).click();
        await $('.opt').filter({ hasText: 'Hero mode' }).click();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => wihero.settings.openInHero === true);

        await step('Hero mode opening Perf Big', async () => {
            await $('.item[data-book="Perf Big"]').click();
            await $('.vp .card').first().waitFor({ timeout: 120000 });
            await page.waitForTimeout(200);
            return { cards: await $('.vp .card').count() };
        });

        // The phone's first open fits the width and starts at the top, so a card to tap can be off screen on this
        // 500-card canvas. Fit is a reader's control, not a harness shortcut; it is outside the steps below.
        currentStep = 'fit the canvas';
        await $('button[aria-label="Fit to screen"]').click();
        await page.waitForTimeout(300);

        await step('tap a card', async () => {
            await tapCard();
            await $('.insp .ihead').waitFor();
        });

        await step('pan the canvas', async () => {
            await page.mouse.move(195, 420);
            for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(50); }
        });

        await step('inspector toggle (chat state off)', async () => {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(100);
            await tapCard();
            await $('.insp .ihead').waitFor();
            await page.keyboard.press('Escape');
            await page.waitForTimeout(100);
        });

        await step('Show chat state on', async () => {
            await openMenu();
            await $('.opt').filter({ hasText: 'Show chat state' }).click();
            await page.keyboard.press('Escape');
            return { chatState: await page.evaluate(() => wihero.app.state.hero.chatState) };
        });

        await step('inspector toggle (chat state on)', async () => {
            await tapCard();
            await $('.insp .ihead').waitFor();
            await page.keyboard.press('Escape');
            await page.waitForTimeout(100);
        });

        // Back to Normal mode to type into the 100 KB entry: the entry page's tokenizer call is what T0 changes.
        currentStep = 'back to Normal mode';
        await openMenu();
        await $('.modebtn').click();
        await $('.modebtn').click();
        await page.waitForFunction(() => wihero.app.state.mode === 'normal');
        await home();
        // Normal mode is a setting, chosen through its menu too: tapping a book must open the book, not Hero.
        await openMenu();
        await $('.opt').filter({ hasText: 'Open books in' }).click();
        await $('.opt').filter({ hasText: 'Normal mode' }).click();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => wihero.settings.openInHero === false);
        await $('.item[data-book="Perf Big"]').click();
        await $('.item.ent').first().waitFor({ timeout: 60000 });
        await $('.item.ent').filter({ hasText: 'Perf long entry' }).click();
        await $('.en h1').waitFor({ timeout: 60000 });
        await page.waitForTimeout(150);
        await page.evaluate(() => { globalThis.__perfTokenCalls = 0; });

        await step('type 50 chars into the 100 KB entry', async () => {
            await $('textarea[aria-label="Content"]').click();
            await page.keyboard.type(TYPED, { delay: 20 });
            await page.waitForTimeout(700);
            return { chars: TYPED.length, tokenCalls: await page.evaluate(() => globalThis.__perfTokenCalls) };
        });

        await home();
        await step('leave Home and close', async () => {
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => document.getElementById('wihero-editor').hidden);
        });

        if (pageErrors.length) throw new Error(`pageerror: ${pageErrors.join(' | ')}`);
    } catch (error) {
        throw new Error(`step "${currentStep}" failed: ${error.message}`);
    } finally {
        await page.close();
    }
    return seeded;
}

let failure = null;
try {
    for (let run = 1; run <= options.runs; run++) {
        const seeded = await runOnce(run);
        if (run === 1) process.stderr.write(`seeded ${seeded.books} books (${seeded.bigEntries} in Perf Big, ${seeded.placedCards} placed cards, ${seeded.longEntryChars} chars in the long entry); ${records.length} records so far\n`);
    }
    if (options.out) {
        fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
        fs.writeFileSync(options.out, JSON.stringify(records, null, 2) + '\n');
        process.stderr.write(`${records.length} records written to ${options.out}\n`);
    }
} catch (error) {
    failure = error;
    process.stderr.write(`perf-harness failed: ${error.message}\n`);
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
if (failure) process.exitCode = 1;
