// N6's in-ST checks (BUILD_SPEC 17): at 390px wide, the chat bubble counts and names what reached the model;
// replies written with WI Hero off are caught up oldest first (or kept, from the bubble); a version WI Hero isn't
// tested on is named plainly; and a missing thread stands the engine down to plain World Info. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, lastPrompt, ok, page, run, send, slash, start, state, wait } from './lib.mjs';

const BOOK = 'WIHero-Sample';
const shot = name => page.screenshot({ path: `${LOG}n6-${name}.png` });
const bubble = page.locator('#wihero_bubble');
const sentNow = () => ev(() => SillyTavern.getContext().chat.at(-1).extra?.wiheroSent ?? null);
const setEnabled = on => ev(v => { const b = document.getElementById('wihero_enabled'); if (b.checked !== v) b.click(); }, on);
const offPopup = page.locator('.popup:has-text("WI Hero was off")');
const snapshots = () => ev(() => SillyTavern.getContext().chat.map(m => !!m.extra?.wihero));

await run(async () => {
    await start(BOOK);
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    await bubble.waitFor();
    assert.equal(await bubble.locator('.wihero-bubble-n').textContent(), '–', 'no reply yet');
    ok('setup: a new Seraphina chat with the sample book; the bubble shows "–" before any reply');

    // ── The bubble ──
    await send('We take the road.');
    await wait(400);
    const sent = await sentNow();
    assert.equal(await bubble.locator('.wihero-bubble-n').textContent(), String(sent.length));
    const titles = sent.map(x => x.title);
    assert.ok(titles.includes('Road: leaving the village') && titles.includes('Sky (permanent)'), titles.join(', '));
    const book = await ev(async b => (await SillyTavern.getContext().loadWorldInfo(b)).entries, BOOK);
    const prompt = lastPrompt();
    for (const x of sent.filter(y => y.world === BOOK)) assert.ok(prompt.includes(book[x.uid].content), `${x.title} reached the prompt`);
    assert.ok(!prompt.includes(book[1].content), 'and the gated mill did not');
    await bubble.click();
    await page.locator('.wihero-bubble-menu:not([hidden])').waitFor();
    assert.equal(await page.locator('.wihero-bubble-head').textContent(), `Sent with the last reply · ${sent.length}`);
    assert.deepEqual(await page.locator('.wihero-bubble-row .wihero-bubble-title').allTextContents(), titles);
    await shot('bubble');
    await page.mouse.click(20, 400);
    assert.ok(await page.locator('.wihero-bubble-menu[hidden]').count(), 'a tap outside closes it');
    // It never covers the input, even after WI Hero's editor was open over the chat.
    await page.click('#WI-SP-button .drawer-toggle');
    await page.locator('#wihero-editor:not([hidden])').waitFor();
    await page.click('#WI-SP-button .drawer-toggle');
    await wait(400);
    const [b, f] = await ev(() => ['wihero_bubble', 'form_sheld'].map(id => document.getElementById(id).getBoundingClientRect().toJSON()));
    assert.ok(b.bottom <= f.top, `the bubble (${b.bottom}) sits above the input (${f.top})`);
    ok('the bubble counts what reached the model, and names it');

    // ── Off for two replies, then Catch up ──
    await setEnabled(false);
    await send('The mill and a bridge.');
    await send('Deeper: the wheel turns.');
    assert.deepEqual((await snapshots()).slice(-4), [false, false, false, false], 'no story state while off');
    assert.ok((await sentNow()).some(x => x.title === 'Mill: the secret'), 'the bubble still counts what plain ST sent');
    await setEnabled(true);
    await offPopup.waitFor({ timeout: 10000 });
    assert.match(await offPopup.textContent(), /WI Hero was off for 2 replies/);
    await shot('catch-up');
    await offPopup.locator('.popup-button-ok').click();
    await wait(800);
    assert.deepEqual((await snapshots()).slice(-4), [false, true, false, true], 'both skipped replies have a snapshot now');
    let s = await state();
    assert.equal(s.fired[`${BOOK}/mill`], 1, 'the mill counted, in order: the road had fired before it');
    assert.equal(s.fired[`${BOOK}/tunnel`], 1, 'then the wheel opened the secret');
    assert.equal(s.closed[`${BOOK}/mill`]?.by, `closesFor:${BOOK}/tunnel`);
    assert.equal(await page.locator('#wihero_gap .wihero-gap-box').count(), 0);
    ok('two replies with WI Hero off: turning it on offers Catch up, which replays them oldest first');

    // ── From the bubble: Keep as is ──
    await setEnabled(false);
    await send('A storm is coming.');
    await setEnabled(true);
    await offPopup.waitFor({ timeout: 10000 });
    await offPopup.locator('.popup-button-cancel').click();
    await wait(400);
    assert.ok(await page.locator('#wihero_bubble_root.wihero-has-gap').count(), 'Not now leaves a dot on the bubble');
    await bubble.click();
    await page.locator('.wihero-bubble-gap').waitFor();
    assert.match(await page.locator('.wihero-bubble-gap').textContent(), /WI Hero was off for 1 reply/);
    await page.locator('.wihero-bubble-gap .menu_button[data-how="keep"]').click();
    await wait(800);
    assert.equal(await page.locator('#wihero_bubble_root.wihero-has-gap').count(), 0);
    s = await state();
    assert.equal(s.fired[`${BOOK}/storm`], undefined, 'kept: the skipped storm never counted');
    await page.mouse.click(20, 400);
    ok('Not now leaves the choice on the bubble, where Keep as is carries the old state on');

    // ── The bubble's switch ──
    await ev(() => document.getElementById('wihero_bubble_on').click());
    await wait(400);
    assert.ok(await page.locator('#wihero_bubble_root[hidden]').count(), 'switched off in the extension settings, the bubble goes');
    await ev(() => document.getElementById('wihero_bubble_on').click());
    await wait(400);
    assert.ok(await page.locator('#wihero_bubble_root:not([hidden])').count());
    ok('the Chat bubble switch in the extension settings hides and shows it');

    // A catch-up popup cannot outlive the chat whose gap it describes.
    await setEnabled(false);
    await send('Another skipped reply.');
    await setEnabled(true);
    await offPopup.waitFor({ timeout: 10000 });
    await slash('/newchat');
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1);
    await offPopup.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal((await state()).at, -1);
    assert.equal((await snapshots())[0], false);
    ok('switching chats closes the old catch-up offer without changing the new chat');

    // ── Compatibility ──
    assert.equal(await ev(() => wihero.health.version), '1.19.0');
    assert.equal(await ev(() => wihero.health.ok), true);
    assert.equal(await page.locator('#wihero_notice div').count(), 0, 'a tested version says nothing');
    await ev(() => wihero.health.setVersion('1.99.0'));
    await page.locator('.toast-warning:has-text("Versions drifted")').waitFor();
    assert.equal(await page.locator('#wihero_notice div').first().textContent(), 'Versions drifted: WI Hero is tested on SillyTavern 1.19.0, and this is 1.99.0. WI Hero is not recommended on it.');
    await ev(() => wihero.health.fail('the WORLDINFO_SCAN_DONE event'));
    await page.locator('.toast-warning:has-text("WI Hero stood down")').waitFor();
    await shot('stood-down');
    const before = (await snapshots()).length;
    await send('A cave, past the left path.');
    assert.ok(lastPrompt().includes(book[18].content), 'stood down: the gated cave goes through as plain World Info');
    assert.equal((await snapshots()).length, before + 2);
    assert.equal((await snapshots()).at(-1), false, 'and no snapshot is written');
    ok('an untested version is named plainly; a missing thread stands the engine down to plain World Info');
    await page.reload();
    await page.waitForFunction(() => window.wihero, null, { timeout: 60000 });
});
