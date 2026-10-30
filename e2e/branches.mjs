// End-to-end check of railway switches and masks in a real SillyTavern 1.19.0 with the mock model.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, ok, ev, wait, slash, send, injected, lastPrompt, state, status, book, start, run } from './lib.mjs';

const PATHS = ['WIH-9', 'WIH-10', 'WIH-11'];

await run(async () => {
    await start();
    let s = await status();
    assert.deepEqual([s.fork, s.left, s.right], ['open', 'waiting for fork', 'waiting for fork']);
    ok('setup: fork open, both paths waiting');

    // ── Taking one path closes the other ──
    await send('We reach the fork.');
    assert.deepEqual(injected(PATHS), ['WIH-9']);
    await send('We take the right path.');
    assert.deepEqual(injected(PATHS), ['WIH-11']);
    assert.ok((await state()).closed.left, 'left closed');
    assert.equal((await status()).left, 'closed (switch: took right)');
    await send('Was the left path better?');
    assert.deepEqual(injected(PATHS), [], 'the lost path stays out when mentioned');
    ok('switch: taking right closes left, which stays out when mentioned');

    // ── Rewinding past the choice restores both ──
    await slash('/del 4');
    await wait(800);
    s = await status();
    assert.deepEqual([s.left, s.right], ['gate open', 'gate open']);
    assert.ok(!(await state()).closed.left);
    ok('rewind: deleting back past the choice opens both paths again');

    // ── A tie fires only the first path in switch order ──
    await send('Left or right?');
    assert.deepEqual(injected(PATHS), ['WIH-10'], 'one path of the tie is injected');
    assert.deepEqual((await state()).fired.right ?? 0, 0, 'the dropped path did not fire');
    assert.equal((await status()).right, 'closed (switch: took left)');
    ok('tie: only left (first in switch order) is injected and fires; right closes');

    // ── Reopen: the manual escape hatch ──
    await page.locator('#wihero_entries tr', { hasText: /^right/ }).locator('.wihero-reopen').dispatchEvent('click');
    await page.waitForFunction(() => [...document.querySelectorAll('#wihero_entries tr')]
        .some(tr => tr.children[0].firstChild?.textContent === 'right' && tr.children[1].firstChild?.textContent === 'gate open'), null, { timeout: 5000 });
    assert.ok(!(await state()).closed.right);
    const saved = await ev(() => SillyTavern.getContext().chat.at(-1).extra.wihero.closed);
    assert.ok(!saved.right, 'the edit is on the last message');
    await send('We go right after all.');
    assert.deepEqual(injected(PATHS), ['WIH-11']);
    assert.ok((await state()).closed.left, 'taking the reopened path switches again');
    ok('reopen: the closed path comes back and taking it closes the other');

    // ── Masks ──
    const TOWER = { base: '[WIH-12 A tall tower.]', ruined: '[WIH-12 The tower lies in ruins.]', lit: '[WIH-12 Light burns in the tower.]' };
    const tower = () => Object.keys(TOWER).filter(k => lastPrompt().includes(TOWER[k]));
    const towerStatus = async () => (await status()).tower;
    await slash('/newchat');
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1, null, { timeout: 10000 });
    await wait(1500);
    await send('We see the tower.');
    assert.deepEqual(tower(), ['base']);
    await send('A storm rolls in.');
    assert.equal(await towerStatus(), 'open · mask: ruined');
    await send('The tower again.');
    assert.deepEqual(tower(), ['ruined']);
    ok('mask by gate: after the storm the tower injects its "ruined" content');

    await slash('/wihero-mask entry=tower lit');
    await page.waitForFunction(() => wihero.state.masks.tower === 'lit', null, { timeout: 5000 });
    assert.equal(await towerStatus(), 'open · mask: lit');
    await send('Look at the tower.');
    assert.deepEqual(tower(), ['lit']);
    ok('mask by command: /wihero-mask selects "lit" over the gated mask');

    await slash('/wihero-mask entry=lantern dim');
    await page.waitForFunction(() => wihero.state.masks.lantern === 'dim', null, { timeout: 5000 });
    const dim = [];
    for (const text of ['I light the lantern.', 'We walk on.', 'The path bends.', 'We keep going.']) {
        await send(text);
        dim.push(lastPrompt().includes('[WIH-5 The lantern burns low.]'));
        assert.ok(!lastPrompt().includes('[WIH-5 A lantern glows.]'), 'base content never injected while masked');
    }
    assert.deepEqual(dim, [true, true, true, false], 'sticky 5 holds the masked lantern two more turns, as without the mask');
    ok('mask on a sticky entry: the masked lantern keeps its vanilla sticky');

    await slash('/del 10');
    await wait(800);
    assert.equal(await towerStatus(), 'open · mask: lit', 'the selection lives on the reply it was made after');
    await slash('/del 2');
    await wait(800);
    assert.equal(await towerStatus(), 'open · mask: ruined');
    await slash('/del 2');
    await wait(800);
    assert.equal(await towerStatus(), 'open');
    assert.deepEqual((await state()).masks, {});
    ok('rewind: deleting messages takes the selection, then the gated mask, back off');

    const sample = JSON.parse(fs.readFileSync(new URL('../examples/WIHero-Sample.json', import.meta.url), 'utf8'));
    assert.deepEqual(book(), sample);
    ok('the book on disk is unchanged');
});
