// End-to-end check of labels in a real SillyTavern 1.19.0 with the mock model: a label as a gate source,
// gatesFor on a label (ANDed with an entry's own gate), closes retiring a label, the panel filter, and rewind.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM.
import assert from 'node:assert/strict';
import { ok, ev, wait, slash, send, injected, status, start, run } from './lib.mjs';

const TAGS = ['WIH-13', 'WIH-14', 'WIH-15', 'WIH-16', 'WIH-17'];
const town = async () => { const s = await status(); return { tavern: s.tavern, market: s.market, rumor: s.rumor }; };

await run(async () => {
    await start();
    assert.deepEqual(await town(), {
        tavern: 'waiting for gatehouse (via #town)',
        market: 'waiting for tavern and gatehouse (via #town)',
        rumor: 'waiting for #town',
    });
    ok('setup: #town waits for the gatehouse, the rumor for #town');

    await send('We hear a rumor about the tavern.');
    assert.deepEqual(injected(TAGS), [], 'nothing in #town before the gatehouse');
    await send('We pass the gatehouse.');
    assert.deepEqual(injected(TAGS), ['WIH-16']);
    assert.deepEqual(await town(), { tavern: 'gate open', market: 'waiting for tavern', rumor: 'waiting for #town' });
    ok('gatesFor: the gatehouse opens #town; the market still needs its own gate');

    await send('Into the tavern.');
    assert.deepEqual(injected(TAGS), ['WIH-13']);
    assert.deepEqual(await town(), { tavern: 'gate open', market: 'gate open', rumor: 'gate open' });
    await send('A rumor spreads through the market.');
    assert.deepEqual(injected(TAGS), ['WIH-14', 'WIH-15']);
    ok('label as source: the tavern firing opens the rumor (#town) and the market (its own gate + the gatehouse)');

    const labelsShown = await ev(() => [...document.querySelectorAll('#wihero_entries .wihero-labels')].map(e => e.textContent));
    assert.ok(labelsShown.includes('#town'), 'labels shown on rows');
    const pick = value => ev(v => { const f = document.getElementById('wihero_label_filter'); f.value = v; f.dispatchEvent(new Event('change')); }, value);
    await pick('town');
    const filtered = await ev(() => [...document.querySelectorAll('#wihero_entries tr.wihero-entry-row')].map(tr => tr.children[0].firstChild.textContent));
    assert.deepEqual(filtered, ['tavern', 'market']);
    await pick('');
    ok('panel: labels on rows, the filter shows only #town');

    await send('A blaze sweeps the town.');
    assert.deepEqual(injected(TAGS), ['WIH-17']);
    assert.deepEqual(await town(), { tavern: 'closed', market: 'closed', rumor: 'gate open' });
    await send('Back to the tavern and the market.');
    assert.deepEqual(injected(TAGS), [], 'closed #town stays out');
    ok('closes: the blaze retires all of #town');

    await slash('/del 4');
    await wait(800);
    assert.deepEqual(await town(), { tavern: 'gate open', market: 'gate open', rumor: 'gate open' });
    ok('rewind: deleting the blaze turn reopens #town');
});
