import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FORM, EMPTY_MASK, slugify, parseIds, parseLines, configToForm, formToConfig, applyConfig, issuesFor, knownIds, knownLabels } from '../src/editor-model.js';

const form = fields => ({ ...EMPTY_FORM, ...fields });

test('slugify makes a valid id from a title', () => {
    assert.equal(slugify('Arrive at the Mill!'), 'arrive-at-the-mill');
    assert.equal(slugify('  Café — Zürich  '), 'cafe-zurich');
    assert.equal(slugify('__x'), 'x');
    assert.equal(slugify(''), '');
});

test('lists: ids split on commas and lines, keywords only on lines', () => {
    assert.deepEqual(parseIds(' a, b\nc,, a '), ['a', 'b', 'c']);
    assert.deepEqual(parseLines('we leave, at last\n\n/x+/i\n'), ['we leave, at last', '/x+/i']);
});

test('an empty form clears the config', () => {
    assert.equal(formToConfig(EMPTY_FORM), null);
    assert.equal(formToConfig(form({ id: '   ' })), null);
});

test('formToConfig leaves defaults out', () => {
    assert.deepEqual(formToConfig(form({ id: 'mill', gates: 'road' })), { id: 'mill', gates: ['road'] });
    assert.deepEqual(formToConfig(form({ id: 'x', gates: 'a, b', gateMode: 'any', closeGates: false })),
        { id: 'x', gates: ['a', 'b'], gateMode: 'any', closeGates: false });
});

test('glue: true with no conditions, an object with them', () => {
    assert.deepEqual(formToConfig(form({ id: 's', glue: true })), { id: 's', glue: true });
    assert.deepEqual(formToConfig(form({ id: 's', glue: true, closeKeywords: 'storm passes\n/calm/i', closeWhenAllFired: 'a,b' })),
        { id: 's', glue: { closeKeywords: ['storm passes', '/calm/i'], closeWhenAllFired: ['a', 'b'] } });
    assert.deepEqual(formToConfig(form({ id: 's', glue: false, closeKeywords: 'ignored' })), { id: 's' });
});

test('configToForm and formToConfig round-trip', () => {
    for (const config of [
        { id: 'road' },
        { id: 'mill', gates: ['road'] },
        { id: 'x', gates: ['a', 'b'], gateMode: 'any', closeGates: false },
        { id: 'storm', glue: true },
        { id: 'bell', glue: { closeKeywords: ['bell stops', 'a, b'], closeWhenFired: ['x'] } },
        { id: 'fork', switch: ['left', 'right'] },
        { id: 'gatehouse', labels: ['town', 'gate'], gatesFor: ['#town'], closes: ['#camp', 'x'] },
        { id: 'tower', masks: [{ name: 'ruined', content: 'Ruins.\n', gates: ['storm'] }, { name: 'lit', content: 'Light.', gates: ['a', 'b'], gateMode: 'any' }] },
    ]) {
        assert.deepEqual(formToConfig(configToForm(config)), config);
    }
    assert.deepEqual(configToForm(undefined), EMPTY_FORM);
    assert.equal(configToForm({ id: 's', glue: {} }).glue, true);
});

test('applyConfig sets or removes the field', () => {
    const entry = { uid: 1, wihero: { id: 'old' } };
    applyConfig(entry, { id: 'new' });
    assert.deepEqual(entry.wihero, { id: 'new' });
    applyConfig(entry, null);
    assert.ok(!('wihero' in entry));
});

test('issuesFor checks the edited config against the other entries', () => {
    const others = [
        { world: 'B', uid: 0, wihero: { id: 'road' } },
        { world: 'B', uid: 1, wihero: { id: 'mill', gates: ['road'] } },
    ];
    const entry = { world: 'B', uid: 2, wihero: { id: 'old' } };
    const messages = config => issuesFor([...others, entry], entry, config).map(i => `${i.warning ? 'warning' : 'problem'}: ${i.message}`);
    assert.deepEqual(messages({ id: 'tunnel', gates: ['mill'] }), []);
    assert.deepEqual(messages({ id: 'mill' }), ['problem: id "mill" is used by more than one entry']);
    assert.deepEqual(messages({ id: 'bad id' }), ['problem: id "bad id" is not valid']);
    assert.deepEqual(messages({ id: 't', gates: ['ghost'] }), ['problem: gates on "ghost", which no entry has']);
    assert.deepEqual(messages({ id: 't', glue: { closeKeywords: ['/(/'] } }), ['problem: glue.closeKeywords: "/(/" is not a valid regex']);
    assert.deepEqual(issuesFor([...others, { ...entry, cooldown: 3 }], { ...entry, cooldown: 3 }, { id: 't', glue: true }).map(i => i.warning), [true]);
    assert.deepEqual(messages(null), []);
});

test('knownIds lists the other entries ids', () => {
    const entries = [{ world: 'A', uid: 0, wihero: { id: 'b' } }, { world: 'B', uid: 0, wihero: { id: 'a' } }, { world: 'B', uid: 1 }, { world: 'B', uid: 2, wihero: { id: 'me' } }];
    assert.deepEqual(knownIds(entries, entries[3]), ['a', 'b']);
});

test('empty mask rows are dropped; a half-filled one is kept for the issues to flag', () => {
    const masks = [{ ...EMPTY_MASK }, { ...EMPTY_MASK, name: 'lit' }, { ...EMPTY_MASK, content: '  ' }];
    assert.deepEqual(formToConfig(form({ id: 't', masks })), { id: 't', masks: [{ name: 'lit', content: '' }] });
    const entries = [{ world: 'B', uid: 1 }];
    assert.deepEqual(issuesFor(entries, entries[0], formToConfig(form({ id: 't', masks }))).map(i => i.message), ['mask "lit": has no content']);
});

test('labels: a leading # is dropped, knownLabels lists every label', () => {
    assert.deepEqual(formToConfig(form({ id: 'a', labels: '#town, camp' })), { id: 'a', labels: ['town', 'camp'] });
    const entries = [{ world: 'B', uid: 0, wihero: { id: 'a', labels: ['town'] } }, { world: 'B', uid: 1, wihero: { id: 'b', labels: ['camp', 'town'] } }, { world: 'B', uid: 2 }];
    assert.deepEqual(knownLabels(entries), ['camp', 'town']);
});
