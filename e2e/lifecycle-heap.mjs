// Raster memory and lifecycle cleanup (A4) in the disposable browser harness (e2e/desktop/harness.html), no
// SillyTavern needed. It uses the real library (`?saves`) and the 500-card "Perf Big" canvas, and instruments the page
// before any script runs:
//
// - every EventTarget listener is counted by target kind (window, document, shadow root, connected element) with
//   WeakRefs, so a detached element is not counted as a live listener and the registry itself cannot retain it;
// - every ResizeObserver/MutationObserver records whether it is observing, so the count is of active observers;
// - CDP `Memory.getDOMCounters` and `Runtime.getHeapUsage` (after `HeapProfiler.collectGarbage`) record DOM nodes and
//   heap bytes.
//
// It then opens Hero on the 500-card canvas, zooms out, and checks the raster policy: no card is promoted, `.world`
// only while a gesture, and the classes/promotions are dropped on hide. Ten show/hide cycles record the heap, DOM
// nodes, listeners and observers after a forced GC and assert a plateau; hide must return the listener and observer
// counts to the retained-canvas baseline. Finally `wihero.dispose()` (the app's `destroy()`) must remove the host,
// take window/document listeners and every observer with it, leave `wihero.library.stats()` readable, and a second
// open must not resurrect a node: destroy is terminal.
//
// Every number is labelled measured-native-browser (unthrottled, 390 × 844 emulation). This is a browser heap, not a
// phone heap snapshot; raster/compositor memory and a real background page stay in PLAN §7.5 / A5 item 6.
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/lifecycle-heap.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
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
const QUERY = '?reset&perf=1&books=40&entries=150&big=1000&canvas=500&chats=0&long=0&closed&saves';
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html${QUERY}`;
const BOOK = 'Perf Big';
const CARDS = 500;
const CYCLES = 10;
const MB = 1024 * 1024;

/** Runs before harness.js: listener/observer bookkeeping with no strong reference to a target. */
const INSTRUMENT = `(() => {
    const targetMaps = new WeakMap();
    const targetRefs = [];
    const seenTargets = new WeakSet();
    const fnIds = new WeakMap();
    let fnSeq = 0;
    const fnId = fn => {
        if (typeof fn !== 'function') return String(fn);
        let id = fnIds.get(fn);
        if (!id) { id = ++fnSeq; fnIds.set(fn, id); }
        return id;
    };
    const connected = t => t === window || t === document || (!!t && t.isConnected === true && (t.nodeType === 1 || t.nodeType === 11));
    const kindOf = t => t === window ? 'window' : t === document ? 'document'
        : (typeof ShadowRoot !== 'undefined' && t instanceof ShadowRoot) ? 'shadow'
        : t?.nodeType === 1 ? 'element' : 'other';
    function mapFor(t, force) {
        if (!force && !connected(t)) return null;
        let map = targetMaps.get(t);
        if (!map) {
            map = new Map();
            targetMaps.set(t, map);
            if (!seenTargets.has(t)) { seenTargets.add(t); targetRefs.push(new WeakRef(t)); }
        }
        return map;
    }
    const captureOf = opts => typeof opts === 'boolean' ? opts : !!opts?.capture;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
        const map = mapFor(this, false);
        if (map && (typeof fn === 'function' || typeof fn === 'object')) {
            const capture = captureOf(opts);
            map.set(type + '|' + capture + '|' + fnId(fn), { type, fn, capture });
        }
        return add.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
        const map = targetMaps.get(this);
        if (map) map.delete(type + '|' + captureOf(opts) + '|' + fnId(fn));
        return remove.call(this, type, fn, opts);
    };
    function listeners() {
        const byKind = { window: 0, document: 0, shadow: 0, element: 0, other: 0 };
        const targetKinds = {};
        const types = {};
        for (let i = targetRefs.length - 1; i >= 0; i--) {
            const t = targetRefs[i].deref();
            if (!t) { targetRefs.splice(i, 1); continue; }
            if (!connected(t)) continue;
            const records = targetMaps.get(t);
            if (!records?.size) continue;
            const k = kindOf(t);
            byKind[k] = (byKind[k] ?? 0) + records.size;
            targetKinds[k] = (targetKinds[k] ?? 0) + 1;
            for (const r of records.values()) (types[k] ??= []).push(r.type + (r.capture ? ':capture' : ''));
        }
        for (const k of Object.keys(types)) types[k].sort();
        return { total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind, targets: targetKinds, types };
    }

    const observers = [];
    for (const name of ['ResizeObserver', 'MutationObserver']) {
        const Orig = window[name];
        if (!Orig) continue;
        class Watched extends Orig {
            constructor(cb) {
                super(cb);
                this.__wiheroObserver = { kind: name, active: false, stack: new Error().stack };
                observers.push(new WeakRef(this));
            }
            observe(...args) {
                this.__wiheroObserver.active = true;
                return super.observe(...args);
            }
            disconnect() {
                this.__wiheroObserver.active = false;
                return super.disconnect();
            }
        }
        Object.defineProperty(Watched, 'name', { value: name });
        window[name] = Watched;
    }
    function observerCounts() {
        const byKind = { ResizeObserver: 0, MutationObserver: 0 };
        const stacks = [];
        for (let i = observers.length - 1; i >= 0; i--) {
            const o = observers[i].deref();
            if (!o) { observers.splice(i, 1); continue; }
            if (!o.__wiheroObserver.active) continue;
            byKind[o.__wiheroObserver.kind] = (byKind[o.__wiheroObserver.kind] ?? 0) + 1;
            stacks.push(o.__wiheroObserver.stack?.split('\\n').slice(2, 5).join(' | '));
        }
        return { total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind, stacks };
    }
    window.__wiheroLife = { listeners, observers: observerCounts };
})();`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const machine = { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model?.trim() ?? null, node: process.versions.node, browser: `chromium ${browser.version()}` };
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const note = msg => console.log(`# ${msg}`);
const errors = [];

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.addInitScript(INSTRUMENT);
await page.goto(BASE);
await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile && window.wiheroHarness && window.__wiheroLife, null, { timeout: 60000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
const boot = await page.evaluate(() => ({ listeners: __wiheroLife.listeners(), observers: __wiheroLife.observers() }));

const state = () => page.evaluate(() => ({
    listeners: __wiheroLife.listeners(),
    observers: __wiheroLife.observers(),
    host: !!wihero.app?.host?.isConnected,
    target: !!document.querySelector('#wihero-editor'),
    stats: wihero.library.stats?.() ?? null,
}));

/** Forced GC, then heap, DOM nodes, listener/observer counts and the library's own accounting. */
async function measure(label) {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const s = await state();
    return { label, usedSize, nodes: dom.nodes, documents: dom.documents, listeners: s.listeners, observers: s.observers, stats: s.stats };
}
const line = (m, extra = {}) => console.log(JSON.stringify({
    step: m.label, label: 'measured-native-browser', machine, viewport: { width: 390, height: 844 },
    heapUsed: m.usedSize, domNodes: m.nodes, listeners: m.listeners.total, listenersByTarget: m.listeners.byKind,
    observers: m.observers.total, observersByKind: m.observers.byKind,
    copies: m.stats?.copies, summaries: m.stats?.summaries, evictions: m.stats?.evictions, ...extra,
}));

// ---- Open the 500-card canvas in Hero mode; keep the harness's app otherwise untouched.
await page.evaluate(async book => {
    await wihero.library.get(book);
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = book;
    S.hero.active = 'canvas';
    S.hero.panel = false;
    wihero.app.show();
    wihero.app.refresh();
}, BOOK);
await page.waitForFunction(n => {
    const sr = document.querySelector('#wihero-editor')?.shadowRoot;
    return (sr?.querySelectorAll('.vp .card').length ?? 0) >= n;
}, CARDS, { timeout: 120000 });
ok(`Hero opened ${BOOK} with ${CARDS} cards (measured-native-browser)`);

// ---- Low zoom: no per-card promotion, and `.world` only while a gesture class is on.
const zout = page.locator('#wihero-editor .canvas-tools button[aria-label="Zoom out"]');
for (let i = 0; i < 6; i++) await zout.click();
await page.waitForTimeout(120);
const lowZoom = await page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const world = sr.querySelector('.vp .world');
    const vp = sr.querySelector('.vp');
    const cards = [...sr.querySelectorAll('.vp .card')];
    const will = n => n ? getComputedStyle(n).willChange : null;
    const promoted = cards.filter(n => { const w = will(n); return w && w !== 'auto'; });
    const before = { cards: cards.length, world: will(world), card: will(cards[0]), promoted: promoted.length };
    vp.classList.add('gesture');
    const during = will(world);
    vp.classList.remove('gesture');
    const after = will(world);
    cards[0]?.classList.add('moving');
    const moving = will(cards[0]);
    cards[0]?.classList.remove('moving');
    const m = /scale\(([\d.]+)\)/.exec(world?.style.transform ?? '');
    return { ...before, during, after, moving, zoom: m ? Number(m[1]) : null };
});
console.log(JSON.stringify({ step: 'low zoom / raster policy', label: 'measured-native-browser', machine, ...lowZoom }));
assert.ok(lowZoom.cards >= CARDS, `the 500 placed cards and their linked neighbours are mounted (${lowZoom.cards})`);
assert.ok(lowZoom.zoom < 0.5, `the camera is at low zoom (${lowZoom.zoom})`);
assert.equal(lowZoom.card, 'auto', 'a card has no will-change at low zoom');
assert.equal(lowZoom.promoted, 0, 'no card is promoted');
assert.equal(lowZoom.world, 'auto', 'the world is not promoted at rest');
assert.match(lowZoom.during, /transform/, 'the world is promoted only while a gesture class is on');
assert.equal(lowZoom.after, 'auto', 'the promotion is gone when the gesture ends');
assert.equal(lowZoom.moving, 'translate', '.card.moving is the one temporary card promotion');
ok(`low zoom ${lowZoom.zoom.toFixed(2)}: ${lowZoom.cards} cards, 0 promoted; .world promoted only during a gesture`);

// A hide while those classes are still on must take both the classes and the promotions away.
await page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    sr.querySelector('.vp')?.classList.add('gesture');
    sr.querySelector('.vp .card')?.classList.add('moving');
    wihero.app.hide();
});
await page.waitForTimeout(120);
const hiddenGesture = await page.evaluate(() => {
    const sr = document.querySelector('#wihero-editor').shadowRoot;
    const world = sr.querySelector('.vp .world');
    const card = sr.querySelector('.vp .card');
    return {
        gesture: sr.querySelector('.vp').classList.contains('gesture'),
        moving: card.classList.contains('moving'),
        world: getComputedStyle(world).willChange,
        card: getComputedStyle(card).willChange,
        paused: sr.querySelector('.wih').hasAttribute('data-paused'),
    };
});
assert.equal(hiddenGesture.gesture, false, 'hide drops the gesture class');
assert.equal(hiddenGesture.moving, false, 'hide drops .card.moving');
assert.equal(hiddenGesture.world, 'auto', 'a hidden editor keeps no world promotion');
assert.equal(hiddenGesture.card, 'auto', 'a hidden editor keeps no card promotion');
assert.equal(hiddenGesture.paused, true, 'hide parks CSS motion');
ok('hide drops the gesture/moving classes and leaves no computed will-change');

// ---- Ten show/hide cycles: heap, DOM, listeners and observers after forced GC.
const series = [];
const baseline = await measure('baseline after hide');
line(baseline);
series.push(baseline);
for (let i = 0; i < CYCLES; i++) {
    await page.evaluate(() => { wihero.app.show(); wihero.app.refresh(); });
    await page.waitForTimeout(80);
    await page.evaluate(() => wihero.app.hide());
    await page.waitForTimeout(120);
    const m = await measure(`cycle ${i + 1}`);
    line(m);
    series.push(m);
    assert.deepEqual(m.listeners, baseline.listeners, `cycle ${i + 1}: listeners back to the retained-canvas baseline after hide`);
    assert.deepEqual(m.observers, baseline.observers, `cycle ${i + 1}: observers back to the baseline after hide`);
    assert.ok(m.nodes <= baseline.nodes + 2, `cycle ${i + 1}: DOM nodes stay at the hidden baseline (${m.nodes} vs ${baseline.nodes})`);
}
ok(`${CYCLES} show/hide cycles return listeners and observers to the baseline; DOM nodes stay at ${baseline.nodes}`);

const heap = series.map(m => m.usedSize);
const mid = heap[Math.floor(heap.length / 2) - 1];
const growth = Math.max(...heap.slice(-5)) - mid;
const limit = Math.max(4 * MB, mid * 0.125);
console.log(JSON.stringify({ step: 'heap plateau', label: 'measured-native-browser', machine, heapUsed: heap, midCycleHeap: mid, lastFiveGrowth: growth, growthLimit: Math.round(limit) }));
assert.ok(growth < limit, `heap grew ${Math.round(growth / 1024)} KiB over the last five cycles (limit ${Math.round(limit / 1024)} KiB)`);
ok(`heap is a plateau: ${Math.round(growth / 1024)} KiB of growth over the last five cycles (limit ${Math.round(limit / 1024)} KiB)`);

// ---- Terminal teardown.
const beforeDestroy = await state();
assert.equal(beforeDestroy.host, true);
await page.evaluate(() => wihero.dispose());
await page.waitForTimeout(120);
await cdp.send('HeapProfiler.collectGarbage');
const after = await state();
const domAfter = await cdp.send('Memory.getDOMCounters');
console.log(JSON.stringify({
    step: 'destroy', label: 'measured-native-browser', machine,
    heapUsed: (await cdp.send('Runtime.getHeapUsage')).usedSize, domNodes: domAfter.nodes,
    listeners: after.listeners.total, listenersByTarget: after.listeners.byKind,
    observers: after.observers.total, observersByKind: after.observers.byKind,
    hostConnected: after.host, hostInDocument: after.target, statsReadable: !!after.stats,
}));
assert.equal(after.host, false, 'the host is detached');
assert.equal(after.target, false, 'no #wihero-editor remains in the document');
const PW_LISTENERS = new Set(['__playwright_global_listeners_check__', 'auxclick', 'click', 'contextmenu', 'dblclick', 'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointerup', 'touchcancel', 'touchend', 'touchstart']);
const appWindowListeners = (after.listeners.types.window ?? []).filter(t => !PW_LISTENERS.has(t.split(':')[0]));
const appObservers = (after.observers.stacks ?? []).filter(s => !String(s).includes('InjectedScript'));
assert.deepEqual(appWindowListeners, [], 'no editor window listener remains');
assert.equal(after.listeners.byKind.document, 0, 'no document listeners remain');
assert.equal(after.listeners.byKind.shadow, 0, 'no shadow-root listeners remain');
assert.deepEqual(appObservers, [], 'every editor observer is disconnected');
assert.equal(after.observers.byKind.ResizeObserver, 0, 'no ResizeObserver remains');
assert.equal(typeof after.stats?.copies, 'number', 'wihero.library.stats() still answers after destroy');
ok(`destroy removed the host, window/document/shadow listeners and all observers (${beforeDestroy.listeners.total} → ${after.listeners.total} listeners)`);

// A second open is refused: destroy is terminal and no stale node comes back.
await page.evaluate(() => { wihero.app.show(); wihero.app.refresh(); wihero.dispose(); });
await page.waitForTimeout(100);
const again = await state();
assert.equal(again.host, false, 'show() after destroy does not reattach the host');
assert.equal(again.target, false, 'no editor node resurfaces');
assert.deepEqual(again.listeners.byKind, after.listeners.byKind, 'a second dispose and a refused show add no listener');
assert.equal(again.observers.total, after.observers.total, 'no observer comes back');
ok('a second open after destroy resurrects nothing (destroy is terminal)');

const booted = boot.listeners.total;
note(`boot (hidden, no canvas): ${booted} listeners, ${boot.observers.total} observers`);
note('what this cannot prove: raster/compositor memory on a phone, a real background tab or app switch, and layers in the compositor. Those stay PLAN §7.5 and A5 item 6.');
assert.deepEqual(errors, [], 'no errors in the page');
ok('no errors in the page');

await browser.close();
await new Promise(resolve => server.close(resolve));
