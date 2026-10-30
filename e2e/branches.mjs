// End-to-end check of railway switches and masks in a real SillyTavern 1.19.0 with the mock model.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import assert from 'node:assert/strict';
import { page, ok, ev, wait, slash, send, injected, state, status, start, run } from './lib.mjs';

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
        .some(tr => tr.children[0].textContent === 'right' && tr.children[1].firstChild?.textContent === 'gate open'), null, { timeout: 5000 });
    assert.ok(!(await state()).closed.right);
    const saved = await ev(() => SillyTavern.getContext().chat.at(-1).extra.wihero.closed);
    assert.ok(!saved.right, 'the edit is on the last message');
    await send('We go right after all.');
    assert.deepEqual(injected(PATHS), ['WIH-11']);
    assert.ok((await state()).closed.left, 'taking the reopened path switches again');
    ok('reopen: the closed path comes back and taking it closes the other');
});
