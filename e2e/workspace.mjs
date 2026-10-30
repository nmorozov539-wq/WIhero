// End-to-end check of the WI Hero workspace in a real SillyTavern 1.19.0 with the mock model.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, ok, ev, wait, send, start, run, openBook, book, dismissWelcome, LOG } from './lib.mjs';

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
    // A previous run leaves its canvas and mode in ST's saved settings.
    await ev(() => { const s = SillyTavern.getContext().extensionSettings.wihero; s.workspaceMode = 'graph'; s.canvas = {}; s.bookmarks = {}; s.ignoredMentions = {}; });
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

    // ── Canvas mode ──
    const canvasOf = () => ev(b => SillyTavern.getContext().extensionSettings.wihero.canvas?.[b], B);
    // The workspace re-renders after each save; a card can be between two renders for a moment.
    const centre = async locator => {
        for (let i = 0; i < 20; i++) {
            const r = await locator.boundingBox().catch(() => null);
            if (r) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            await wait(100);
        }
        throw new Error('element not on screen');
    };
    async function dragTo(locator, to, steps = 8) {
        const from = await centre(locator);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps });
        await page.mouse.up();
        await wait(400);
    }
    await page.locator('.wihero-ws-modes [data-mode="canvas"]').click();
    await page.locator('.wihero-ws .wihero-box-label').waitFor({ timeout: 5000 });
    const millAt = await centre(card(1));
    await dragTo(card(1), { x: millAt.x + 120, y: millAt.y + 260 });
    const saved1 = (await canvasOf()).pos['id:mill'];
    assert.ok(saved1 && saved1.y > (await canvasOf()).pos['id:road'].y + 100, 'mill position saved in settings');
    assert.deepEqual(book().entries[1].wihero.gates, ['road'], 'moving a card never edits the entry');
    await wait(2000);
    await page.reload();
    await dismissWelcome();
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await openFromPanel();
    assert.equal(await page.locator('.wihero-ws-modes [data-mode="canvas"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await card(1).evaluate(c => c.style.left), `${saved1.x}px`);
    ok('canvas: dragging mill saves its place in settings (not the entry); it survives a reload');

    await dragTo(card(5).locator('.wihero-handle'), await centre(card(12)));
    await page.locator('.wihero-link-menu [data-type="gate"]').click();
    for (let i = 0; i < 50 && !book().entries[12].wihero.gates?.includes('lantern'); i++) await wait(100);
    assert.deepEqual(book().entries[12].wihero.gates, ['lantern']);
    await page.locator(`.wihero-ws .wihero-link[data-type="gate"][data-from="${B}.5"][data-to="${B}.12"]`).waitFor({ state: 'attached', timeout: 5000 });
    await dragTo(card(2).locator('.wihero-handle'), await centre(card(0)));
    await page.locator('.wihero-link-menu [data-type="gate"]').click();
    const toast = await page.locator('.toast-warning').first().innerText({ timeout: 5000 });
    assert.match(toast, /Not linked: road: is in a gate loop: road → (mill → tunnel|tunnel → mill) → road/);
    assert.deepEqual(book().entries[0].wihero, { id: 'road' }, 'refused link not saved');
    ok('linking: lantern → tower as a gate lands on disk; tunnel → road is refused with the engine\'s reason');

    const corner = await centre(page.locator('.wihero-box-label .wihero-box-corner'));
    const boxBefore = (await canvasOf()).boxes['#town'];
    await dragTo(page.locator('.wihero-box-label .wihero-box-corner'), { x: corner.x + 150, y: corner.y });
    assert.ok((await canvasOf()).boxes['#town'].w > boxBefore.w + 100, 'the box resized');
    const box = await page.locator('.wihero-box-label').boundingBox();
    await dragTo(card(6), { x: box.x + box.width - 70, y: box.y + box.height / 2 + 8 });
    await page.locator('.popup .popup-button-ok').click({ timeout: 5000 });
    for (let i = 0; i < 50 && !book().entries[6].wihero.labels; i++) await wait(100);
    assert.deepEqual(book().entries[6].wihero.labels, ['town']);
    await card(1).click();
    await page.mouse.move(5, 5);
    await ev(() => toastr.clear());
    await shot('canvas.png');
    ok('label box: resized, then dropping bell into #town adds the label, after asking');

    await page.locator('.wihero-ws-canvas-tool', { hasText: 'Area' }).click();
    await page.locator('.wihero-ws-canvas-tool', { hasText: 'Note' }).click();
    assert.equal(await page.locator('.wihero-box-area').count(), 1);
    await page.locator('.wihero-box-note textarea').fill('Act one ends at the mill.');
    await page.locator('.wihero-box-note textarea').blur();
    assert.equal((await canvasOf()).notes[0].text, 'Act one ends at the mill.');
    await page.locator('.wihero-ws-canvas-tool', { hasText: 'Undo' }).click();
    assert.equal((await canvasOf()).notes[0].text, '', 'undo takes the text back');
    await page.locator('.wihero-ws-canvas-tool', { hasText: 'Undo' }).click();
    assert.equal((await canvasOf()).notes.length, 0, 'and then the note');
    ok('areas and notes on the canvas, saved in settings; undo steps back');

    const before = (await canvasOf()).pos['id:mill'];
    await page.locator('.wihero-ws-canvas-tool', { hasText: 'Tidy' }).click();
    await page.locator('.popup .popup-button-ok').click({ timeout: 5000 });
    await page.waitForFunction(([b, y]) => SillyTavern.getContext().extensionSettings.wihero.canvas[b].pos['id:mill']?.y !== y, [B, before.y], { timeout: 5000 });
    ok('Tidy lays the cards out automatically again');
});
