// Deferred first-big-draw link ownership and lifecycle in the disposable browser harness. The test slows only the
// gap between batches so it can reproducibly interrupt one: production still uses zero-delay progressive batches.
//   CHROMIUM=/usr/bin/google-chrome-stable node e2e/deferred-links.mjs
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/e2e/desktop/harness.html`;
const QUERY = '?reset&perf=1&books=2&entries=4&big=1000&canvas=500&keys=shared&keyCount=4&long=0&chats=0';
const BOOK = 'Perf Big';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = message => console.log(`ok ${++step} - ${message}`);

async function open() {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text().slice(0, 300)); });
    await page.route('**/src/ui/canvas.js', async route => {
        let source = fs.readFileSync(path.join(ROOT, 'src/ui/canvas.js'), 'utf8');
        source = source.replace('if (at < queue.length) later(next, 0);', 'if (at < queue.length) later(next, 60);');
        source = source.replace(
            '    return {\n        render, fit, centerOn, reveal, tidy, flip, pointAt, screenRect, overlay, looseStart, hitAt, markTarget, zoomAt, zoomTo, packPrompt,',
            '    return globalThis.__reviewCanvas = {\n        render, fit, centerOn, reveal, tidy, flip, pointAt, screenRect, overlay, looseStart, hitAt, markTarget, zoomAt, zoomTo, packPrompt,',
        );
        assert.match(source, /globalThis\.__reviewCanvas/);
        await route.fulfill({ contentType: 'text/javascript', body: source });
    });
    await page.goto(`${BASE}${QUERY}`);
    await page.waitForFunction(() => window.wihero && window.wiheroHarnessProfile, null, { timeout: 120000 });
    await page.click('#wi-button');
    await page.locator('#wihero-editor .tab').first().waitFor({ timeout: 120000 });
    return { page, errors };
}

const setHidden = (page, hidden) => page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

const snapshot = page => page.evaluate(() => {
    const root = document.querySelector('#wihero-editor').shadowRoot;
    const canvas = globalThis.__reviewCanvas;
    const visible = [...root.querySelectorAll('.vp .lhit')];
    const links = canvas?.view?.links ?? [];
    const linkIndexes = visible.map(node => Number(node.dataset.link));
    return {
        renders: wihero.perf.snapshot().canvasRenders,
        routes: wihero.perf.snapshot().routeComputes,
        visible: visible.length,
        internal: links.length,
        queue: canvas?.view?.queue?.length ?? 0,
        byLid: canvas?.view?.byLid?.size ?? 0,
        hits: canvas?.view?.hit?.size ?? 0,
        lines: canvas?.view?.ln?.size ?? 0,
        connectedHits: [...(canvas?.view?.hit?.values() ?? [])].filter(node => node.isConnected).length,
        indexedLines: [...(canvas?.view?.ln?.values() ?? [])].flat().length,
        connectedLines: [...(canvas?.view?.ln?.values() ?? [])].flat().filter(node => node.isConnected).length,
        linkIndexes,
        pending: canvas?.pending?.(),
    };
});

function assertComplete(s, label) {
    assert.ok(s.queue >= 200, `${label}: fixture takes the deferred path (${s.queue} links)`);
    assert.equal(s.internal, s.queue, `${label}: every queued link has one current record`);
    assert.equal(s.visible, s.queue, `${label}: every queued link has one visible hit target`);
    assert.equal(s.byLid, s.queue, `${label}: route definitions belong to the current canvas`);
    assert.equal(s.hits, s.queue, `${label}: hit index belongs to the current canvas`);
    assert.equal(s.lines, s.queue, `${label}: line index belongs to the current canvas`);
    assert.equal(s.connectedHits, s.queue, `${label}: every indexed hit node is connected`);
    assert.equal(s.connectedLines, s.indexedLines, `${label}: every indexed line/head node is connected`);
    assert.equal(new Set(s.linkIndexes).size, s.queue, `${label}: visible hit indexes are unique`);
    assert.deepEqual([...s.linkIndexes].sort((a, b) => a - b), Array.from({ length: s.queue }, (_, i) => i), `${label}: visible hit indexes address the current link records`);
    assert.equal(s.pending.links, false, `${label}: no deferred batch remains`);
}

async function openHero(page) {
    await page.evaluate(book => {
        const S = wihero.app.state;
        S.mode = 'hero';
        S.hero.book = book;
        S.hero.active = 'canvas';
        wihero.app.refresh();
    }, BOOK);
    await page.locator('#wihero-editor .vp .card').first().waitFor({ timeout: 120000 });
}

try {
    // A geometry-changing render before the first batch owns a new CV, new route maps and new SVG layers.
    {
        const { page, errors } = await open();
        await page.evaluate(book => {
            const S = wihero.app.state;
            S.mode = 'hero'; S.hero.book = book; S.hero.active = 'canvas';
            wihero.app.refresh();
            const cards = wihero.settings.books[book].canvas.cards;
            const key = Object.keys(cards).find(k => Number.isFinite(cards[k]?.x));
            cards[key].x += 280;
            window.__movedCard = { key, x: cards[key].x };
            wihero.app.refresh();
        }, BOOK);
        await page.waitForFunction(() => globalThis.__reviewCanvas?.view?.links?.length === globalThis.__reviewCanvas?.view?.queue?.length, null, { timeout: 120000 });
        await page.waitForTimeout(500);
        const s = await snapshot(page);
        assertComplete(s, 'render interruption');
        const geometry = await page.evaluate(() => {
            const root = document.querySelector('#wihero-editor').shadowRoot;
            const card = [...root.querySelectorAll('.vp .card')].find(node => node.dataset.id === window.__movedCard.key);
            return { saved: window.__movedCard.x, view: globalThis.__reviewCanvas.view.R.get(window.__movedCard.key)?.x, dom: parseFloat(card?.style.left) };
        });
        assert.deepEqual(geometry, { saved: geometry.saved, view: geometry.saved, dom: geometry.saved }, 'the replacement routes and card use the changed geometry');
        assert.equal(s.renders, 2, 'the geometry change made exactly one replacement canvas render');
        assert.deepEqual(errors, []);
        ok(`a changed-geometry render before batch one leaves ${s.queue} current links and no detached-map writes`);
        await page.close();
    }

    // A geometry-changing replacement between batches cancels the partial owner and rebuilds every map from zero.
    {
        const { page, errors } = await open();
        await openHero(page);
        await page.waitForFunction(() => {
            const c = globalThis.__reviewCanvas;
            return c?.view?.links?.length > 0 && c.view.links.length < c.view.queue.length;
        }, null, { timeout: 120000 });
        const partial = await snapshot(page);
        await page.evaluate(book => {
            const cards = wihero.settings.books[book].canvas.cards;
            const key = Object.keys(cards).find(k => Number.isFinite(cards[k]?.x));
            cards[key].x += 280;
            window.__movedCard = { key, x: cards[key].x };
            wihero.app.refresh();
        }, BOOK);
        await page.waitForFunction(() => globalThis.__reviewCanvas?.view?.links?.length === globalThis.__reviewCanvas?.view?.queue?.length, null, { timeout: 120000 });
        await page.waitForTimeout(500);
        const replaced = await snapshot(page);
        assertComplete(replaced, 'between-batch geometry replacement');
        assert.equal(replaced.renders, partial.renders + 1);
        const geometry = await page.evaluate(() => ({
            saved: window.__movedCard.x,
            view: globalThis.__reviewCanvas.view.R.get(window.__movedCard.key)?.x,
        }));
        assert.equal(geometry.view, geometry.saved, 'the replacement view owns the changed geometry');
        assert.deepEqual(errors, []);
        ok(`a changed-geometry render between batches replaces the partial ${partial.internal}/${partial.queue} maps cleanly`);
        await page.close();
    }

    // Visibility pause before the first batch cancels all work; visibility return redraws despite an unchanged sig.
    {
        const { page, errors } = await open();
        await openHero(page);
        await setHidden(page, true);
        await page.waitForTimeout(500);
        const parked = await snapshot(page);
        assert.equal(parked.visible, 0, 'no first batch draws after visibility pause');
        assert.equal(parked.internal, 0, 'no link records are written after visibility pause');
        assert.equal(parked.pending.paused, true);
        const parkedRoutes = parked.routes;
        await page.waitForTimeout(300);
        assert.equal((await snapshot(page)).routes, parkedRoutes, 'paused canvas performs no later route work');
        await setHidden(page, false);
        await page.waitForFunction(() => globalThis.__reviewCanvas?.view?.links?.length === globalThis.__reviewCanvas?.view?.queue?.length, null, { timeout: 120000 });
        const resumed = await snapshot(page);
        assertComplete(resumed, 'visibility resume');
        assert.equal(resumed.renders, parked.renders + 1, 'unchanged Hero input still gets the owed full render');
        assert.deepEqual(errors, []);
        ok('visibility pause before batch one does no later work and resume completes one current link set');
        await page.close();
    }

    // Hide between batches freezes the partial fill. show() renders while the canvas is still paused, then resumes it.
    {
        const { page, errors } = await open();
        await openHero(page);
        await page.waitForFunction(() => {
            const c = globalThis.__reviewCanvas;
            return c?.view?.links?.length > 0 && c.view.links.length < c.view.queue.length;
        }, null, { timeout: 120000 });
        await page.evaluate(() => wihero.app.hide());
        const parked = await snapshot(page);
        await page.waitForTimeout(500);
        const later = await snapshot(page);
        assert.equal(later.internal, parked.internal, 'hide cancels the timer between batches');
        assert.equal(later.visible, parked.visible, 'hide appends no later DOM');
        assert.ok(later.internal > 0 && later.internal < later.queue, 'the test interrupted a partial fill');
        assert.equal(later.routes, parked.routes, 'hidden editor performs no later route work');
        await page.evaluate(() => wihero.app.show());
        await page.waitForFunction(() => globalThis.__reviewCanvas?.view?.links?.length === globalThis.__reviewCanvas?.view?.queue?.length, null, { timeout: 120000 });
        const shown = await snapshot(page);
        assertComplete(shown, 'editor show');
        assert.equal(shown.renders, parked.renders + 1, 'hide/show pays one replacement render');
        assert.deepEqual(errors, []);
        ok(`editor hide between batches freezes at ${parked.internal}/${parked.queue}; show completes without duplicates`);
        await page.close();
    }

    // Leaving Hero disposes a partial canvas. Its queued timer can neither route nor put nodes back afterwards.
    {
        const { page, errors } = await open();
        await openHero(page);
        await page.waitForFunction(() => {
            const c = globalThis.__reviewCanvas;
            return c?.view?.links?.length > 0 && c.view.links.length < c.view.queue.length;
        }, null, { timeout: 120000 });
        const partial = await snapshot(page);
        await page.evaluate(() => { wihero.app.state.hero.active = 'preview'; wihero.app.refresh(); });
        const disposedRoutes = (await snapshot(page)).routes;
        await page.waitForTimeout(500);
        const after = await snapshot(page);
        assert.equal(after.routes, disposedRoutes, 'disposed canvas performs no later route work');
        assert.equal(after.visible, 0, 'disposed canvas appends no later link DOM');
        assert.equal(after.internal, 0, 'disposed canvas releases its route/link view');
        assert.equal(await page.locator('#wihero-editor .vp').count(), 0, 'the old viewport stays gone');
        assert.ok(partial.internal > 0 && partial.internal < partial.queue, 'the test disposed a partial fill');
        assert.deepEqual(errors, []);
        ok(`dispose during a partial ${partial.internal}/${partial.queue} fill cancels all later route and DOM work`);
        await page.close();
    }
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
