// A layout/paint recording of the disposable browser harness (e2e/desktop/harness.html), for N5's
// `content-visibility` trial: the windowed phone and desktop book lists, a Home refresh, Explain mode on/off, and
// the non-windowed Hero entry panel. It needs no SillyTavern and never seeds a real library. Everything lives in
// the page's memory and localStorage.
//
// This is a recording, not a pass/fail check: no threshold is asserted. One JSON line per case on stdout; --out
// writes the whole run as an array. Each record is labelled measured-native-browser at --rate 1 (the default) or
// measured-at-6x for any other rate, and carries the machine, viewport, CPU rate, profile, CDP trace counts and
// durations (devtools.timeline + disabled-by-default-devtools.timeline), Performance.getMetrics deltas, DOM node
// counts and mounted row counts.
//
//   node e2e/paint.mjs                   no throttle, 390 × 844 for the phone cases and 1366 × 768 for desktop
//   node e2e/paint.mjs --rate 6          CPU throttled through Emulation.setCPUThrottlingRate
//   node e2e/paint.mjs --out run.json
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/paint.mjs
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
    const out = { rate: 1, out: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--rate') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--rate needs a number');
            out.rate = Number(argv[++i]);
        } else if (arg === '--out') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--out needs a path');
            out.out = argv[++i];
        } else throw new Error(`unknown argument: ${arg}`);
    }
    if (!(Number.isFinite(out.rate) && out.rate >= 1)) throw new Error('--rate must be 1 or more');
    return out;
}

const options = args(process.argv.slice(2));
// The same disposable profile as e2e/perf-harness.mjs: 40 generated books and the 1,000-entry "Perf Big" book with a
// placed canvas, so opening it exercises the windowed lists and Explain mode has cards to outline.
const QUERY = '?reset&perf=1&books=40&entries=150&big=1000&canvas=500&keys=shared&keyCount=4&long=100000&chats=240';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1366, height: 768 };
const LABEL = options.rate === 1 ? 'measured-native-browser' : `measured-at-${options.rate}x`;
// The CDP trace categories from the plan: the top-level timeline plus the detailed one that carries PrePaint/Layerize.
const CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing';
// Counted events; a missing name is simply left out, and `traceNames` names what the trace did carry.
const TRACE_NAMES = ['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'Layerize'];

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
const errors = [];

/** A CDP session with the CPU rate and performance metrics enabled. */
async function instrument(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.rate });
    await cdp.send('Performance.enable');
    return cdp;
}

const metricsMap = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

/** The four requested metric deltas; durations are seconds in CDP and ms here. */
function metricDelta(before, after) {
    const diff = name => (after[name] ?? 0) - (before[name] ?? 0);
    const ms = name => Math.round(diff(name) * 100000) / 100;
    return {
        layoutCount: diff('LayoutCount'),
        recalcStyleCount: diff('RecalcStyleCount'),
        layoutDurationMs: ms('LayoutDuration'),
        recalcStyleDurationMs: ms('RecalcStyleDuration'),
        taskDurationMs: ms('TaskDuration'),
    };
}

/** Counts and total durations of the target trace events inside the measured window. */
function summarize(events) {
    const by = new Map();
    for (const ev of events) {
        if (ev.ph !== 'X') continue;
        let row = by.get(ev.name);
        if (!row) by.set(ev.name, row = { count: 0, dur: 0 });
        row.count++;
        row.dur += ev.dur ?? 0;
    }
    const trace = {};
    const traceMs = {};
    for (const name of TRACE_NAMES) {
        const row = by.get(name);
        if (!row) continue;
        trace[name] = row.count;
        traceMs[name] = Math.round(row.dur) / 1000;
    }
    const out = { trace, traceMs, traceEvents: events.length };
    // "or the closest real names present": if none of the requested names appear, say which top-level ones did.
    if (!Object.keys(trace).length) {
        out.traceNames = [...by.entries()]
            .filter(([name]) => /layout|paint|layer|style|render|frame/i.test(name))
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 12)
            .map(([name, row]) => `${name}:${row.count}`);
    }
    return out;
}

/** Starts a trace, runs the action, ends it and returns the counts. */
async function trace(cdp, action) {
    const events = [];
    const onData = e => { for (const ev of e.value) events.push(ev); };
    cdp.on('Tracing.dataCollected', onData);
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', { categories: CATEGORIES, transferMode: 'ReportEvents' });
    try {
        await action();
    } finally {
        await cdp.send('Tracing.end');
        await done;
        cdp.off('Tracing.dataCollected', onData);
    }
    return summarize(events);
}

/** DOM size and the mounted rows of the surface being measured (shadow root included). */
async function snapshot(page, selector) {
    return page.evaluate(sel => {
        const host = document.getElementById('wihero-editor');
        const sr = host?.shadowRoot;
        const mounted = sel && sr ? sr.querySelectorAll(sel).length : 0;
        return {
            domNodes: document.querySelectorAll('*').length + (sr ? sr.querySelectorAll('*').length : 0),
            mounted,
            mountedSelector: sel ?? null,
        };
    }, selector ?? null);
}

/** Runs one case: performance metrics before and after, a trace around the action, then the page's own counts. */
async function measureCase(page, cdp, name, viewport, selector, action) {
    const before = await metricsMap(cdp);
    const t0 = Date.now();
    const traced = await trace(cdp, action);
    const ms = Date.now() - t0;
    const after = await metricsMap(cdp);
    emit({
        case: name,
        label: LABEL,
        machine,
        viewport,
        cpuRate: options.rate,
        ms,
        ...traced,
        metrics: metricDelta(before, after),
        ...(await snapshot(page, selector)),
    });
}

/** Two frames plus a short settle, so the browser's style/layout/paint for the action lands inside the trace. */
const settle = async page => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(80);
};

/** A wheel scroll of 6,000 px over the element at the viewport point, in 10 steps with a frame between. */
async function wheelScroll(page, point) {
    await page.mouse.move(point.x, point.y);
    for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(50);
    }
}

async function openHarness(viewport, extra = {}) {
    const page = await browser.newPage({ viewport, ...extra });
    page.on('pageerror', e => errors.push(`${viewport.width}x${viewport.height}: ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${viewport.width}x${viewport.height}: ${m.text().slice(0, 300)}`);
    });
    await page.goto(BASE);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 60000 });
    await page.click('#wi-button');
    await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(300);
    return page;
}

async function phoneRun() {
    const page = await openHarness(PHONE, { hasTouch: true, isMobile: true });
    const cdp = await instrument(page);
    const $ = sel => page.locator(`#wihero-editor ${sel}`);
    const viewBox = async () => {
        const box = await $('.view').boundingBox();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    // (c) A Home refresh on the settled 40-book Home.
    await measureCase(page, cdp, 'home-refresh', PHONE, '.item[data-book], .ptile', async () => {
        await page.evaluate(() => window.wihero.app.refresh());
        await settle(page);
    });

    // (a) The phone book list: open Perf Big, then scroll 6,000 px through the windowed rows.
    await $('.item[data-book="Perf Big"]').click();
    await $('.bkname h1').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.view .item.ent').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(200);
    const phonePoint = await viewBox();
    await measureCase(page, cdp, 'phone-scroll-6000', PHONE, '.view .item.ent', async () => {
        await wheelScroll(page, phonePoint);
        await page.waitForTimeout(100);
    });

    // (d) Explain mode on/off on the placed Perf Big canvas. Fit first, so the outlines are on visible cards.
    await page.evaluate(() => {
        const S = window.wihero.app.state;
        S.mode = 'hero';
        S.hero.book = 'Perf Big';
        window.wihero.app.refresh();
    });
    await $('.vp .card').first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(300);
    await $('button[aria-label="Fit to screen"]').click();
    await page.waitForTimeout(300);
    await measureCase(page, cdp, 'explain-on', PHONE, '.vp .card', async () => {
        await $('.explainq').click();
        await $('.explainban').waitFor();
        await settle(page);
    });
    await measureCase(page, cdp, 'explain-off', PHONE, '.vp .card', async () => {
        await $('.explainban button').click();
        await page.waitForFunction(() => window.wihero.app.state.hero.explain === false);
        await settle(page);
    });

    // A non-windowed list for the narrower variant: the Hero entry panel builds every `.prow` at once, so
    // `content-visibility` here would skip ~950 rows that the windowed lists do not have.
    await measureCase(page, cdp, 'hero-panel-open', PHONE, '.plist .prow', async () => {
        await $('.panelBtn').click();
        await $('.plist .prow').first().waitFor();
        await settle(page);
    });
    const plist = await $('.plist').boundingBox();
    const panelPoint = { x: plist.x + plist.width / 2, y: plist.y + plist.height / 2 };
    await measureCase(page, cdp, 'hero-panel-scroll-6000', PHONE, '.plist .prow', async () => {
        await wheelScroll(page, panelPoint);
        await page.waitForTimeout(100);
    });
    await page.close();
}

async function deskRun() {
    const page = await openHarness(DESK);
    const cdp = await instrument(page);
    const $ = sel => page.locator(`#wihero-editor ${sel}`);

    // (b) The desktop book list: open Perf Big, then scroll its `.bllist` by 6,000 px.
    await $('.dhome .tile').filter({ hasText: 'Perf Big' }).first().click();
    await $('.bkname2 b').filter({ hasText: 'Perf Big' }).waitFor({ timeout: 60000 });
    await $('.bllist .brow').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(200);
    const box = await $('.bllist').boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await measureCase(page, cdp, 'desk-scroll-6000', DESK, '.bllist .brow', async () => {
        await wheelScroll(page, point);
        await page.waitForTimeout(100);
    });
    await page.close();
}

let failure = null;
try {
    await phoneRun();
    await deskRun();
    if (options.out) {
        fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
        fs.writeFileSync(path.resolve(options.out), JSON.stringify(records, null, 2) + '\n');
        process.stderr.write(`${records.length} records written to ${options.out}\n`);
    }
} catch (error) {
    failure = error;
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
if (errors.length) {
    failure ??= new Error(`page error: ${errors.join(' | ')}`);
}
if (failure) {
    process.stderr.write(`paint harness failed: ${failure.message}\n`);
    process.exitCode = 1;
}
