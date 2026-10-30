// End-to-end check of the WI Hero workspace in a real SillyTavern 1.19.0 with the mock model.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, ok, ev, wait, send, start, run, openBook, book, LOG } from './lib.mjs';

const SHOTS = new URL('../docs/img/', import.meta.url).pathname;
const B = 'WIHero-Sample';
const card = uid => page.locator(`.wihero-ws .wihero-card[data-key="${B}.${uid}"]`);
const cardClass = uid => card(uid).getAttribute('class');
const links = () => ev(() => [...document.querySelectorAll('.wihero-ws .wihero-link')].reduce((n, p) => ({ ...n, [p.dataset.type]: (n[p.dataset.type] ?? 0) + 1 }), {}));
const shown = () => ev(() => [...document.querySelectorAll('.wihero-ws .wihero-card')].map(c => c.dataset.key));
async function openFromPanel() {
    await ev(() => document.querySelector('.wihero-settings .wihero-open-workspace').click());
    await page.locator('.wihero-ws .wihero-card').first().waitFor({ timeout: 10000 });
}
const close = () => page.locator('.wihero-ws-close').click();
async function shot(name) {
    await wait(400);
    await page.screenshot({ path: `${LOG}${name}` });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.copyFileSync(`${LOG}${name}`, `${SHOTS}${name}`);
}

await run(async () => {
    await start();
    await openFromPanel();
    assert.equal(await page.locator('.wihero-ws-book').inputValue(), B);
    assert.deepEqual(await links(), { gate: 6, labelSource: 1, switch: 2, gatesFor: 1, closes: 1, member: 2, mask: 3, maskGate: 1 });
    ok('workspace: opens from the panel on the sample book with every link type');

    assert.match(await cardClass(0), /wihero-status-open/);
    assert.match(await cardClass(1), /wihero-status-waiting/);
    assert.equal(await page.locator(`.wihero-ws .wihero-card[data-key="#town"]`).count(), 1, 'label hub');
    const unlinked = await page.locator('.wihero-ws-sidebar').innerText();
    assert.ok(unlinked.includes('NOT LINKED YET') && unlinked.includes('bell') && unlinked.includes('Village (not gated)'));
    ok('cards: chat-state statuses, the #town hub, and unlinked entries in the sidebar');

    await card(4).hover();
    await page.locator('.wihero-ws-preview.wihero-show').waitFor({ timeout: 3000 });
    assert.ok((await page.locator('.wihero-ws-preview').innerText()).includes('A storm batters the valley'));
    await page.mouse.move(5, 5);
    await card(1).click();
    await page.locator('.wihero-ws-paneltabs [data-tab="links"]').click();
    const summary = await page.locator('.wihero-ws-panel').innerText();
    assert.ok(summary.includes('Mill: arrival') && summary.includes('road → gate') && summary.includes('gate → tunnel'), summary);
    await page.locator('.wihero-ws-paneltabs [data-tab="entry"]').click();
    ok('hover preview shows the content; selecting mill shows its links in the right panel');

    await page.locator('input[name="wihero_local"]').check();
    assert.deepEqual((await shown()).sort(), [`${B}.0`, `${B}.1`, `${B}.2`]);
    await page.locator('input[name="wihero_local"]').uncheck();
    await page.locator('.wihero-ws-ribbon [data-section="labels"]').click();
    await page.locator('.wihero-ws-sidebar .wihero-ws-fold').first().click();
    const folded = await shown();
    assert.ok(folded.includes('group:#town') && !folded.includes(`${B}.13`) && !folded.includes('#town'));
    await card(1).click();
    await page.mouse.move(5, 5);
    await shot('workspace.png');
    await page.locator('.wihero-ws-sidebar .wihero-ws-fold').first().click();
    ok('local graph around mill shows road, mill, tunnel; #town folds into one card');

    await close();
    await send('We stand on the road out of the village, talking about the mill.');
    await send('We reach the mill.');
    await openFromPanel();
    assert.match(await cardClass(0), /wihero-status-closed/);
    assert.match(await cardClass(1), /wihero-status-gate/);
    assert.equal(await page.locator('#wihero_scrub').getAttribute('max'), '4');
    await page.locator('#wihero_scrub').fill('0');
    assert.match(await cardClass(0), /wihero-status-open/);
    assert.match(await cardClass(1), /wihero-status-waiting/);
    assert.equal(await page.locator('label[for="wihero_scrub"]').innerText(), 'Chat state at message #0 of 4');
    await page.locator('.wihero-ws-ribbon [data-section="timeline"]').click();
    assert.ok((await page.locator('.wihero-ws-sidebar').innerText()).includes('fired road'));
    ok('chat state: after two turns road is closed; scrubbing to #0 shows the start');

    await close();
    await openBook();
    await page.locator('.wihero-folders .wihero-open-workspace').click();
    await page.locator('.wihero-ws .wihero-card').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('.wihero-ws-book').inputValue(), B);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.wihero-ws').count(), 0, 'Escape closes it');
    ok("ST's World Info editor opens the workspace on its book; Escape closes it");

    // ── The entry editor in the right panel ──
    await openFromPanel();
    const panel = page.locator('.wihero-ws-panel');
    const tab = name => panel.locator(`.wihero-ws-paneltabs [data-tab="${name}"]`).click();
    const saved = async check => { for (let i = 0; i < 50 && !check(book().entries); i++) await wait(100); assert.ok(check(book().entries), 'saved to disk'); };
    await card(1).click();
    await panel.locator('textarea[name="wihero_entry_content"]').fill('[WIH-2 The mill is abandoned; its wheel turns again.]');
    await panel.locator('input[name="wihero_entry_key"]').fill('mill, millwheel');
    await panel.locator('.wihero-ws-save').click();
    await saved(e => e[1].content.includes('turns again') && e[1].key.includes('millwheel'));
    assert.deepEqual(book().entries[1].wihero, { id: 'mill', gates: ['road'] }, 'story logic untouched');
    ok('entry tab: content and keywords saved to the book on disk');

    await tab('timers');
    await panel.locator('input[name="wihero_entry_sticky"]').fill('3');
    await panel.locator('.wihero-ws-save').click();
    await saved(e => e[1].sticky === 3);
    await tab('logic');
    await panel.locator('input[name="wihero_glue"]').check();
    await panel.locator('.wihero-save').click();
    await saved(e => e[1].wihero?.glue === true);
    assert.match(await page.locator('.wihero-ws-saved').innerText(), /All changes saved/);
    ok('timers and story logic tabs save sticky and glue');

    await card(0).click();
    await tab('links');
    const mention = panel.locator('.wihero-ws-mention', { hasText: 'fork' });
    assert.ok((await mention.innerText()).includes('mentions "road"'));
    await mention.locator('.wihero-ws-gate-on').click();
    await saved(e => e[9].wihero?.gates?.includes('road'));
    assert.deepEqual(book().entries[9].wihero, { id: 'fork', switch: ['left', 'right'], gates: ['road'] });
    await page.locator(`.wihero-ws .wihero-link[data-type="gate"][data-from="${B}.0"][data-to="${B}.9"]`).waitFor({ state: 'attached', timeout: 5000 });
    ok('links tab: "fork" mentions road; one click gates fork on road, and the graph shows the new link');
});
