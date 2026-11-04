// Compatibility (src/compat.js, BUILD_SPEC 17.2): the version check and the health check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, checkHealth, probeEntriesLoaded, probeScanDone, standDownText, stVersion, versionStatus } from '../src/compat.js';
import { getStringHash } from '../src/engine/util.js';

const context = () => ({
    eventSource: { on() {} }, eventTypes: Object.fromEntries(EVENTS.map(e => [e, e.toLowerCase()])),
    chat: [], saveChat() {}, substituteParams() {}, characters: [], chatMetadata: {},
});
const internals = () => ({ 'world-info.js getSortedEntries': () => [], 'world-info.js scan_state': { NONE: 0, MIN_ACTIVATIONS: 3 }, 'utils.js getStringHash': getStringHash });

test('a tested version passes quietly; any other says plainly that versions drifted', () => {
    assert.deepEqual(versionStatus('1.19.0'), { tested: true, text: null });
    assert.equal(versionStatus('1.20.0').text, 'Versions drifted: WI Hero is tested on SillyTavern 1.19.0, and this is 1.20.0. WI Hero is not recommended on it.');
    assert.match(versionStatus(null).text, /couldn't read the SillyTavern version/);
});

test('the version comes from ST\'s /version', async () => {
    assert.equal(await stVersion(async url => ({ ok: url === '/version', json: async () => ({ pkgVersion: '1.19.0' }) })), '1.19.0');
    assert.equal(await stVersion(async () => { throw new Error('offline'); }), null);
});

test('the health check names every missing thread', () => {
    assert.deepEqual(checkHealth(context(), internals()), []);
    const c = context();
    delete c.eventTypes.WORLDINFO_SCAN_DONE;
    delete c.saveChat;
    const i = internals();
    i['world-info.js getSortedEntries'] = undefined;
    i['world-info.js scan_state'] = {};
    assert.deepEqual(checkHealth(c, i), ['getContext().saveChat', 'the WORLDINFO_SCAN_DONE event', 'world-info.js getSortedEntries', 'scan_state.NONE / MIN_ACTIVATIONS']);
    assert.match(standDownText(['x']), /^WI Hero stood down: SillyTavern no longer has x\. Your World Info works as plain/);
});

test('the health check stands down when ST\'s getStringHash no longer matches the engine\'s copy', () => {
    const i = internals();
    i['utils.js getStringHash'] = s => getStringHash(s) + 1;
    assert.deepEqual(checkHealth(context(), i), ['utils.js getStringHash as WI Hero knows it (it hashes differently now)']);
    i['utils.js getStringHash'] = () => { throw new Error('boom'); };
    assert.equal(checkHealth(context(), i).length, 1);
});

test('runtime probes of the scan\'s arguments', () => {
    assert.equal(probeEntriesLoaded({ globalLore: [], chatLore: [] }), null);
    assert.match(probeEntriesLoaded({ globalLore: {} }), /new shape/);
    assert.equal(probeScanDone({ activated: { entries: new Map() }, state: { next: 0 } }), null);
    assert.match(probeScanDone({ activated: { entries: {} } }), /activated entries/);
});
