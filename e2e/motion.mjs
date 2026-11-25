// Reduced motion and hidden-page pause (A3) in the browser harness (e2e/desktop/harness.html): no SillyTavern needed.
// Emulates `prefers-reduced-motion: reduce` with CDP and reads the editor's computed styles in its shadow root, then
// clears it and checks the normal motion is back. For a hidden page it overrides `document.visibilityState` and
// dispatches `visibilitychange`, because a real background tab cannot be driven from here: the shim proves the app's
// own listener, CSS attribute and frame parking, not the browser's background throttling or a phone switching apps.
// Run `CHROMIUM=/usr/bin/google-chrome-stable node e2e/motion.mjs`.
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
const BOOK = 'WIHero-Sample';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const note = msg => console.log(`# ${msg}`);
const errors = [];

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text().slice(0, 300)); });
await page.goto(`${BASE}?reset`);
await page.locator('#wihero-editor .tab').first().waitFor();
const cdp = await page.context().newCDPSession(page);

/** A computed property of a shadow-root node (or its pseudo-element). */
const css = (sel, prop, pseudo = null) => page.evaluate(([sel, prop, pseudo]) => {
    const n = document.querySelector('#wihero-editor').shadowRoot.querySelector(sel);
    return n ? getComputedStyle(n, pseudo)[prop] : null;
}, [sel, prop, pseudo]);

/** The live camera from the world transform, or null before a canvas is drawn. */
const camera = () => page.evaluate(() => {
    const w = document.querySelector('#wihero-editor').shadowRoot.querySelector('.vp .world');
    const m = w && /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(w.style.transform);
    return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null;
});
const savedCamera = () => page.evaluate(b => wihero.settings.books[b]?.canvas?.camera ?? null, BOOK);
const renders = () => page.evaluate(() => wihero.perf.snapshot());
const wait = ms => page.waitForTimeout(ms);
const near = (a, b, by = 1.5) => !!a && !!b && Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by && Math.abs(a.zoom - b.zoom) <= 0.001;

/** Probe nodes for rules whose real UI is a transient sheet/toast: the CSS is the editor's, the node is only here. */
await page.evaluate(() => {
    const wih = document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih');
    const add = (cls, parent = wih) => { const n = document.createElement('div'); n.className = cls; parent.append(n); return n; };
    add('sheet probe-sheet');
    add('switch probe-switch');
    add('loosend probe-loose');
    const toast = add('toast probe-toast');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ttimer');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    svg.append(rect);
    toast.append(svg);
});
await page.evaluate(b => {
    const S = wihero.app.state;
    S.mode = 'hero';
    S.hero.book = b;
    S.hero.active = 'canvas';
    wihero.app.refresh();
}, BOOK);
await page.locator('#wihero-editor .vp .card').first().waitFor();
await wait(250);

// The eager shell's placeholder lives outside the shadow root: it respects reduced motion through its own rule, and
// an unrelated ST-page element keeps its transition (the editor's `*` rule does not leak out of the shadow tree).
await page.evaluate(() => new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = '@keyframes stprobe { 50% { opacity: .5 } }';
    document.head.append(style);
    // The harness page does not load the eager shell's style.css; its placeholder rule is what this checks.
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '../../style.css';
    css.onload = resolve;
    css.onerror = resolve;
    document.head.append(css);
}));
await page.evaluate(() => {
    const load = document.createElement('div');
    load.id = 'wihero-loading';
    load.style.animation = 'stprobe 1s linear infinite';
    document.body.append(load);
    const st = document.createElement('div');
    st.id = 'st-probe';
    st.style.transition = 'opacity .2s';
    document.body.append(st);
});
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#wihero-loading')).animationName), 'stprobe');
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#st-probe')).transitionProperty), 'opacity');
ok('the eager placeholder animates normally and an ST-page element keeps its own transition');

// ---- Reduced motion: the media query reaches the shadow tree and takes every transition/animation with it.
assert.equal(await css('.probe-switch', 'transitionProperty', '::after'), 'transform, background');
assert.equal(await css('.probe-sheet', 'animationName'), 'up');
assert.equal(await css('.probe-loose', 'animationName'), 'pulse');
assert.equal(await css('.probe-toast .ttimer rect', 'animationName'), 'tdrain');
ok('normal motion: the switch transitions, the sheet and loose end animate, the toast ring drains');

await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
assert.equal(await css('.probe-switch', 'transitionProperty', '::after'), 'none');
assert.equal(await css('.probe-switch', 'transitionDuration', '::after'), '0s');
assert.equal(await css('.probe-sheet', 'animationName'), 'none');
assert.equal(await css('.probe-loose', 'animationName'), 'none');
assert.equal(await css('.probe-toast .ttimer rect', 'animationName'), 'none');
assert.equal(await css('.probe-sheet', 'transitionProperty'), 'none');
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#wihero-loading')).animationName), 'none');
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#st-probe')).transitionProperty), 'opacity');
await page.evaluate(() => { document.querySelector('#wihero-loading')?.remove(); document.querySelector('#st-probe')?.remove(); });
ok('reduced motion: the editor shadow tree has no transition or animation (switch, sheet, loose end, toast ring)');
ok('reduced motion also reaches the eager placeholder and does not touch an ST-page element');

// The dimming that is the canvas's feedback is opacity, not motion: it is still applied and readable.
assert.equal(await page.evaluate(() => {
    const r = document.querySelector('#wihero-editor').shadowRoot;
    const card = r.querySelector('.vp .card');
    card.classList.add('off');
    const o = getComputedStyle(card).opacity;
    card.classList.remove('off');
    return o;
}), '0.5');
ok('reduced motion leaves non-motion feedback alone (a dimmed card still reads at 0.5)');

await cdp.send('Emulation.setEmulatedMedia', { features: [] });
assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), false);
assert.equal(await css('.probe-switch', 'transitionProperty', '::after'), 'transform, background');
assert.equal(await css('.probe-sheet', 'animationName'), 'up');
assert.equal(await css('.probe-loose', 'animationName'), 'pulse');
assert.equal(await css('.probe-toast .ttimer rect', 'animationName'), 'tdrain');
ok('clearing the emulation brings the normal transitions and animations back');

// ---- Hidden page: the root attribute parks CSS motion and a draw requested while hidden waits for visibility.
const setHidden = hidden => page.evaluate(hidden => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

const before = await renders();
await setHidden(true);
assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').hasAttribute('data-paused')), true);
assert.equal(await css('.probe-loose', 'animationPlayState'), 'paused');
assert.equal(await css('.probe-toast', 'transitionDuration'), '0s');
ok('hidden: the root carries data-paused, infinite animation is paused and transitions are off');

await page.evaluate(b => {
    wihero.library.change(b, data => { const e = Object.values(data.entries)[0]; e.comment = `${e.comment ?? ''} (hidden edit)`; });
    wihero.app.refresh();
}, BOOK);
await wait(300);
const parked = await renders();
assert.equal(parked.appRenders - before.appRenders, 0, 'no app draw while hidden');
assert.equal(parked.canvasRenders - before.canvasRenders, 0, 'no canvas draw while hidden');
ok('hidden: a library change and refresh draw neither the app nor the canvas');

await setHidden(false);
await wait(300);
const caughtUp = await renders();
assert.equal(caughtUp.appRenders - parked.appRenders, 1, 'the pending draw runs once when visible');
assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').hasAttribute('data-paused')), false);
assert.equal(await css('.probe-loose', 'animationPlayState'), 'running');
assert.match(await page.evaluate(b => Object.values(wihero.library.peek(b).entries)[0].comment, BOOK), /\(hidden edit\)$/);
ok('visible again: one catch-up draw, the pause attribute gone and the animation running (the hidden edit landed)');

// ---- A pan interrupted by hiding keeps the view it reached, then stops (no rAF keeps moving it).
const freeAt = async () => {
    const box = await page.locator('#wihero-editor .vp').boundingBox();
    return page.evaluate(([box]) => {
        const root = document.querySelector('#wihero-editor').shadowRoot;
        for (let y = box.y + box.height * 0.2; y < box.y + box.height * 0.75; y += 17) {
            for (let x = box.x + box.width * 0.2; x < box.x + box.width * 0.7; x += 19) {
                const hit = root.elementFromPoint(x, y);
                if (hit?.classList.contains('vp') || hit?.classList.contains('world')) return { x, y };
            }
        }
        return null;
    }, [box]);
};
const start = await freeAt();
assert.ok(start, 'a bare canvas point is available');
await page.mouse.move(start.x, start.y);
await page.mouse.down({ button: 'middle' });
for (let i = 1; i <= 4; i++) await page.mouse.move(start.x + 20 * i, start.y + 12 * i);
await wait(60);
const panCam = await camera();
assert.ok(panCam, 'the middle drag moved the camera');
await setHidden(true);
await wait(250);
assert.ok(near(await camera(), panCam), 'the hidden page does not keep panning');
const panSaved = await savedCamera();
assert.ok(near(panSaved, panCam), 'the pan reached before hiding is kept in the book');
await setHidden(false);
await wait(200);
assert.ok(near(await camera(), panCam), 'the view does not jump when visible again');
ok('a pan interrupted by hiding keeps its camera (saved) and stops; visible again it does not move on');

await page.mouse.up({ button: 'middle' });

// ---- A card drag at the edge: its edge loop must not keep running or resume, and its last position is kept.
const vp = await page.locator('#wihero-editor .vp').boundingBox();
const card = await page.locator('#wihero-editor .vp .card').first().boundingBox();
assert.ok(card, 'a card is there to drag');
const cardKey = await page.evaluate(() => {
    const el = document.querySelector('#wihero-editor').shadowRoot.querySelector('.vp .card');
    return el?.dataset.id ?? null;
});
assert.ok(cardKey, 'the dragged card has a key');
const cardStart = await page.evaluate(([b, k]) => { const c = wihero.settings.books[b]?.canvas?.cards?.[k]; return c ? { x: c.x, y: c.y } : null; }, [BOOK, cardKey]);
await page.mouse.move(card.x + Math.min(card.width / 2, 60), card.y + card.height / 2);
await page.mouse.down();
for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    await page.mouse.move(card.x + Math.min(card.width / 2, 60) + (vp.x + vp.width - 8 - (card.x + Math.min(card.width / 2, 60))) * t, card.y + card.height / 2);
}
await wait(150);
const beforeDrag = await renders();
await setHidden(true);
const hiddenCam = await camera();
assert.ok(hiddenCam, 'the camera was moved by the edge drag');
const cardAtHide = await page.evaluate(([b, k]) => { const c = wihero.settings.books[b]?.canvas?.cards?.[k]; return c ? { x: c.x, y: c.y } : null; }, [BOOK, cardKey]);
assert.ok(cardAtHide && (!cardStart || cardAtHide.x !== cardStart.x || cardAtHide.y !== cardStart.y), 'the drag position reached before hiding is saved');
await wait(300);
assert.ok(near(await camera(), hiddenCam), 'the edge loop does not keep scrolling while hidden');
await setHidden(false);
await wait(300);
assert.ok(near(await camera(), hiddenCam), 'the edge loop does not resume when visible again');
const afterDrag = await renders();
assert.equal(afterDrag.appRenders - beforeDrag.appRenders, 1, 'one draw catches up after the interrupted drag');
ok('a card drag at the edge stops its loop while hidden, does not resume, and keeps the dragged position');

await page.mouse.up();

// ---- The editor host hidden by its own close path parks motion too, and showing it clears the attribute.
await page.evaluate(() => wihero.app.hide());
assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').hidden), true);
assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').hasAttribute('data-paused')), true);
await page.evaluate(() => wihero.app.show());
await wait(150);
assert.equal(await page.evaluate(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.wih').hasAttribute('data-paused')), false);
ok('a closed editor host also carries data-paused; showing it clears the pause');

note('measured-native-browser (Chromium, 1366 x 768, fake visibility): the shim proves the listener, root attribute,');
note('computed pause, parked app/canvas draws, one catch-up draw, and that a mid-gesture pan/card edge loop stops and');
note('does not resume. It cannot prove real background-tab throttling, a phone switching apps, or compositor pause');
note('on the weakest device; those stay device evidence (PLAN 7.5).');

await browser.close();
await new Promise(r => server.close(r));

assert.deepEqual(errors, [], 'no page errors');
ok('no page errors in the console');
console.log(`\n${step} passed`);
