import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, initialState, readState, eligibility, removeIneligible, advance, gluedKeys, keywordMatcher, switchLosers, reopen, activeMask, selectMask } from '../src/engine.js';

let nextUid = 0;
const entry = (wihero, extra = {}) => ({ world: 'Book', uid: nextUid++, comment: wihero?.id ?? 'plain', content: 'text', ...(wihero !== undefined && { wihero }), ...extra });

/** Ids of the entries ST may scan. */
const eligibleIds = (entries, model, state) =>
    entries.filter(e => eligibility(e, model, state).eligible).map(e => e.wihero?.id ?? e.comment);

/** Plays rounds, each a list of ids that fire (optionally `{ ids, text }`), and returns the final state. */
function play(entries, rounds) {
    const model = buildModel(entries);
    let state = initialState();
    for (const round of rounds) {
        const { ids, text } = Array.isArray(round) ? { ids: round, text: '' } : round;
        const fired = ids.map(id => entries.find(e => (e.wihero?.id ?? e.comment) === id));
        for (const e of fired) assert.ok(eligibility(e, model, state).eligible, `${e.comment} fired while not eligible`);
        state = advance(state, fired, model, text);
    }
    return { model, state };
}

test('entries without config are always eligible and untouched', () => {
    const plain = entry(undefined);
    const model = buildModel([plain]);
    assert.equal(model.byKey.size, 0);
    assert.deepEqual(eligibility(plain, model, initialState()), { eligible: true, reason: 'not gated' });
});

test('an entry without gates is open from the start', () => {
    const root = entry({ id: 'root' });
    const model = buildModel([root]);
    assert.deepEqual(model.issues, []);
    assert.ok(eligibility(root, model, initialState()).eligible);
});

test('a gated entry waits until its gate has fired, and opens on the next turn', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const model = buildModel([a, b]);
    let state = initialState();
    assert.deepEqual(eligibleIds([a, b], model, state), ['a']);
    assert.equal(eligibility(b, model, state).reason, 'waiting for a');
    state = advance(state, [a], model);
    assert.ok(eligibility(b, model, state).eligible);
});

test('AND gates need every parent, OR gates need one', () => {
    const a = entry({ id: 'a', closeGates: false });
    const b = entry({ id: 'b' });
    const all = entry({ id: 'all', gates: ['a', 'b'] });
    const any = entry({ id: 'any', gates: ['a', 'b'], gateMode: 'any' });
    const model = buildModel([a, b, all, any]);
    const state = advance(initialState(), [a], model);
    assert.deepEqual(eligibleIds([all, any], model, state), ['any']);
    assert.equal(eligibility(all, model, state).reason, 'waiting for b');
    assert.ok(eligibility(all, model, advance(state, [b], model)).eligible);
});

test('a gate stays satisfied after its parent closes', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const c = entry({ id: 'c', gates: ['a'], closeGates: false });
    const { model, state } = play([a, b, c], [['a'], ['b']]);
    assert.ok(state.closed.a);
    assert.ok(eligibility(c, model, state).eligible);
});

test('a chain closes each link when the next one fires', () => {
    const links = [entry({ id: 'l1' }), entry({ id: 'l2', gates: ['l1'] }), entry({ id: 'l3', gates: ['l2'] })];
    const { model, state } = play(links, [['l1'], ['l2']]);
    assert.deepEqual(eligibleIds(links, model, state), ['l2', 'l3']);
    const after = advance(state, [links[2]], model);
    assert.deepEqual(eligibleIds(links, model, after), ['l3']);
    assert.deepEqual(after.closed, { l1: true, l2: true });
});

test('closeGates false keeps the previous link open', () => {
    const links = [entry({ id: 'l1' }), entry({ id: 'l2', gates: ['l1'], closeGates: false })];
    const { model, state } = play(links, [['l1'], ['l2']]);
    assert.deepEqual(eligibleIds(links, model, state), ['l1', 'l2']);
});

test('closed is final: firing again later does not reopen', () => {
    const links = [entry({ id: 'l1' }), entry({ id: 'l2', gates: ['l1'] })];
    const { model, state } = play(links, [['l1'], ['l2'], ['l2'], []]);
    assert.ok(state.closed.l1);
    assert.equal(eligibility(links[0], model, state).reason, 'closed');
});

test('with an OR gate, only the parents that fired close', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b' });
    const c = entry({ id: 'c', gates: ['a', 'b'], gateMode: 'any' });
    const { state } = play([a, b, c], [['a'], ['c']]);
    assert.deepEqual(state.closed, { a: true });
});

test('a parent and child firing in the same round both count', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const model = buildModel([a, b]);
    const s1 = advance(initialState(), [a], model);
    const s2 = advance(s1, [a, b], model);
    assert.deepEqual(s2.fired, { a: 2, b: 1 });
    assert.deepEqual(s2.closed, { a: true });
});

test('fire counts accumulate and round lists everything that fired', () => {
    const plain = entry(undefined);
    const a = entry({ id: 'a' });
    const model = buildModel([plain, a]);
    let state = advance(initialState(), [a, plain, a], model);
    state = advance(state, [a], model);
    assert.deepEqual(state.fired, { a: 2 });
    assert.deepEqual(state.round, [`Book.${a.uid}`]);
});

test('advance takes world.uid keys as well as entries', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const model = buildModel([a, b]);
    const s1 = advance(initialState(), [`Book.${a.uid}`, 'Other.7'], model);
    assert.deepEqual(s1.fired, { a: 1 });
    assert.deepEqual(s1.round, [`Book.${a.uid}`, 'Other.7']);
    assert.deepEqual(advance(s1, [`Book.${b.uid}`], model).closed, { a: true });
});

test('advance does not change the state it was given', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const model = buildModel([a, b]);
    const s1 = advance(initialState(), [a], model);
    const copy = structuredClone(s1);
    advance(s1, [b], model);
    assert.deepEqual(s1, copy);
});

test('removeIneligible splices every lore list in place and keeps plain entries', () => {
    const plain = entry(undefined);
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const lore = { globalLore: [plain, a, b], characterLore: [b], chatLore: [], personaLore: [] };
    const model = buildModel([plain, a, b]);
    const globalLore = lore.globalLore;
    assert.equal(removeIneligible(lore, model, initialState()), 2);
    assert.equal(lore.globalLore, globalLore);
    assert.deepEqual(lore.globalLore, [plain, a]);
    assert.deepEqual(lore.characterLore, []);
});

test('removeIneligible leaves the entries in `keep` whatever their gates say', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', gates: ['a'] });
    const c = entry({ id: 'c', gates: ['a'] });
    const lore = { globalLore: [a, b, c] };
    const model = buildModel([a, b, c]);
    const state = { ...initialState(), closed: { a: true } };
    assert.equal(removeIneligible(lore, model, state, new Set([`Book.${a.uid}`, `Book.${b.uid}`])), 1);
    assert.deepEqual(lore.globalLore, [a, b]);
    assert.equal(removeIneligible({ globalLore: [a] }, model, state, new Map([[`Book.${a.uid}`, 7]])), 0, 'a Map works too');
});

test('removeIneligible never edits the entries it keeps', () => {
    const a = entry({ id: 'a' });
    const before = structuredClone(a);
    removeIneligible({ globalLore: [a] }, buildModel([a]), initialState());
    assert.deepEqual(a, before);
});

// ── Config problems: a broken entry never fires ───────────────────────

const messages = model => model.issues.map(i => `${i.id ?? i.label}: ${i.message}`);

test('missing or invalid ids are reported and the entry is blocked', () => {
    const noId = entry({ gates: [] }, { comment: 'No id' });
    const badId = entry({ id: 'has space' });
    const model = buildModel([noId, badId]);
    assert.deepEqual(messages(model), ['No id: has no id', 'has space: id "has space" is not valid']);
    assert.deepEqual(eligibleIds([noId, badId], model, initialState()), []);
});

test('duplicate ids block every entry that uses them', () => {
    const a1 = entry({ id: 'a' });
    const a2 = entry({ id: 'a' });
    const b = entry({ id: 'b' });
    const model = buildModel([a1, a2, b]);
    assert.deepEqual(messages(model), ['a: id "a" is used by more than one entry', 'a: id "a" is used by more than one entry']);
    assert.deepEqual(eligibleIds([a1, a2, b], model, initialState()), ['b']);
});

test('gates on unknown ids or on itself are reported', () => {
    const a = entry({ id: 'a', gates: ['ghost'] });
    const b = entry({ id: 'b', gates: ['b'] });
    const model = buildModel([a, b]);
    assert.deepEqual(messages(model), ['a: gates on "ghost", which no entry has', 'b: gates on itself']);
    assert.deepEqual(eligibleIds([a, b], model, initialState()), []);
});

test('gate loops are reported for every entry in the loop', () => {
    const root = entry({ id: 'root' });
    const a = entry({ id: 'a', gates: ['c', 'root'], gateMode: 'any' });
    const b = entry({ id: 'b', gates: ['a'] });
    const c = entry({ id: 'c', gates: ['b'] });
    const tail = entry({ id: 'tail', gates: ['root'] });
    const model = buildModel([root, a, b, c, tail]);
    assert.equal(model.issues.length, 3);
    assert.ok(model.issues.every(i => i.message.startsWith('is in a gate loop: ')));
    assert.deepEqual(model.issues.map(i => i.id).sort(), ['a', 'b', 'c']);
    assert.deepEqual(eligibleIds([root, a, b, c, tail], model, advance(initialState(), [root], model)), ['root', 'tail']);
});

test('wrong field types are reported', () => {
    const model = buildModel([
        entry('nope', { comment: 'string' }),
        entry({ id: 'g', gates: 'a' }),
        entry({ id: 'm', gateMode: 'xor' }),
        entry({ id: 'c', closeGates: 'yes' }),
    ]);
    assert.deepEqual(messages(model), [
        'string: config is not an object',
        'g: gates must be a list of ids',
        'm: gateMode "xor" must be "all" or "any"',
        'c: closeGates must be true or false',
    ]);
});

test('an entry gated on a broken entry just waits', () => {
    const a = entry({ id: 'a', gateMode: 'xor' });
    const b = entry({ id: 'b', gates: ['a'] });
    const model = buildModel([a, b]);
    assert.equal(model.issues.length, 1);
    assert.equal(eligibility(b, model, initialState()).reason, 'waiting for a');
});

test('readState accepts its own output and rejects anything else', () => {
    const state = { v: 1, fired: { a: 1 }, closed: { b: true }, glued: { c: { seen: [] } }, masks: { c: 'x' }, round: ['Book.1'] };
    assert.deepEqual(readState(structuredClone(state)), state);
    assert.equal(readState(null), null);
    assert.equal(readState({ v: 2 }), null);
    assert.deepEqual(readState({ v: 1, fired: [], closed: null }), { v: 1, fired: {}, closed: {}, glued: {}, masks: {}, round: [] });
});

// ── Glue ──────────────────────────────────────────────────────────────

const key = e => `${e.world}.${e.uid}`;

test('a glued entry is forced every turn from its first firing', () => {
    const a = entry({ id: 'a', glue: true });
    const b = entry({ id: 'b' });
    const model = buildModel([a, b]);
    assert.deepEqual(gluedKeys(model, initialState()), []);
    let state = advance(initialState(), [a], model);
    assert.deepEqual(gluedKeys(model, state), [key(a)]);
    assert.equal(eligibility(a, model, state).reason, 'glued');
    state = advance(state, [b], model);
    state = advance(state, [], model);
    assert.deepEqual(gluedKeys(model, state), [key(a)]);
});

test('a glued chain link stays open when the chain advances', () => {
    const l1 = entry({ id: 'l1', glue: { closeWhenFired: ['l3'] } });
    const l2 = entry({ id: 'l2', gates: ['l1'] });
    const l3 = entry({ id: 'l3', gates: ['l2'] });
    const { model, state } = play([l1, l2, l3], [['l1'], ['l1', 'l2']]);
    assert.deepEqual(state.closed, {});
    assert.ok(state.glued.l1);
    const after = advance(state, [l1, l3], model);
    assert.deepEqual(after.glued, {});
    assert.deepEqual(after.closed, { l1: true, l2: true });
});

test('a close keyword in the turn releases glue and closes the entry', () => {
    const a = entry({ id: 'a', glue: { closeKeywords: ['leave the mill', '/\\bexit\\b/i'] } });
    const model = buildModel([a]);
    let state = advance(initialState(), [a], model, 'we arrive and could leave the mill later');
    assert.ok(state.glued.a, 'keywords in the turn that starts the glue do not count');
    state = advance(state, [a], model, 'nothing yet');
    assert.ok(state.glued.a);
    state = advance(state, [a], model, 'We LEAVE THE MILL.');
    assert.deepEqual(state.glued, {});
    assert.ok(state.closed.a);
    assert.equal(eligibility(a, model, state).reason, 'closed');
    const viaRegex = advance(advance(initialState(), [a], model), [a], model, 'Exit, stage left');
    assert.ok(viaRegex.closed.a);
});

test('closeWhenFired releases on any listed entry firing', () => {
    const a = entry({ id: 'a', glue: { closeWhenFired: ['x', 'y'] } });
    const x = entry({ id: 'x' });
    const y = entry({ id: 'y' });
    const { state } = play([a, x, y], [['a'], ['a'], ['a', 'y']]);
    assert.ok(state.closed.a);
});

test('closeWhenAllFired waits until every listed entry has fired since the glue began', () => {
    const a = entry({ id: 'a', glue: { closeWhenAllFired: ['x', 'y'] } });
    const x = entry({ id: 'x' });
    const y = entry({ id: 'y' });
    const { model, state } = play([a, x, y], [['x'], ['a'], ['a', 'x']]);
    assert.deepEqual(state.glued.a, { seen: ['x'] }, 'x before the glue does not count, x after does');
    const after = advance(state, [a, y], model);
    assert.ok(after.closed.a);
});

test('glue with no close condition holds for good', () => {
    const a = entry({ id: 'a', glue: {} });
    const { state } = play([a], [['a'], ['a'], ['a'], ['a']]);
    assert.ok(state.glued.a);
});

test('glue never restarts on a closed entry', () => {
    const a = entry({ id: 'a', glue: { closeKeywords: ['bye'] } });
    const model = buildModel([a]);
    let state = advance(advance(initialState(), [a], model), [a], model, 'bye');
    assert.ok(state.closed.a);
    state = advance(state, [a], model);
    assert.deepEqual(state.glued, {});
});

test('glue that was removed from an entry is dropped from the state', () => {
    const a = entry({ id: 'a', glue: true });
    const state = advance(initialState(), [a], buildModel([a]));
    const plainModel = buildModel([entry({ id: 'a' })]);
    assert.deepEqual(advance(state, [], plainModel).glued, {});
});

test('advance does not change the glue state it was given', () => {
    const a = entry({ id: 'a', glue: { closeWhenAllFired: ['x', 'y'] } });
    const x = entry({ id: 'x' });
    const model = buildModel([a, x, entry({ id: 'y' })]);
    const s1 = advance(initialState(), [a], model);
    const copy = structuredClone(s1);
    advance(s1, [x], model);
    assert.deepEqual(s1, copy);
});

test('bad glue configs are reported', () => {
    const model = buildModel([
        entry({ id: 'g1', glue: 'yes' }),
        entry({ id: 'g2', glue: { closeKeywords: 'bye' } }),
        entry({ id: 'g3', glue: { closeWhenFired: ['ghost'] } }),
        entry({ id: 'g4', glue: { closeKeywords: ['/(/'] } }),
        entry({ id: 'g5', glue: { closeOn: [] } }),
    ]);
    assert.deepEqual(messages(model), [
        'g1: glue must be true or an object',
        'g2: glue.closeKeywords must be a list of strings',
        'g4: glue.closeKeywords: "/(/" is not a valid regex',
        'g5: glue has unknown field closeOn',
        'g3: glue closes on "ghost", which no entry has',
    ]);
});

test('keywordMatcher: substrings ignore case, /regex/ uses its flags', () => {
    assert.ok(keywordMatcher('Mill')('the old mill'));
    assert.ok(!keywordMatcher('/Mill/')('the old mill'));
    assert.ok(keywordMatcher('/mi+l/i')('MIIIL'));
    assert.equal(keywordMatcher('/[/'), null);
});

test('a glued entry with a trigger chance below 100% gets a warning but still works', () => {
    const a = entry({ id: 'a', glue: true }, { probability: 50, useProbability: true });
    const b = entry({ id: 'b', glue: true }, { probability: 50, useProbability: false });
    const model = buildModel([a, b]);
    assert.deepEqual(model.issues.map(i => [i.id, i.warning]), [['a', true]]);
    assert.ok(eligibility(a, model, initialState()).eligible);
});

test('a glued entry with a cooldown gets a warning', () => {
    const a = entry({ id: 'a', glue: true }, { cooldown: 5 });
    const b = entry({ id: 'b' }, { cooldown: 5 });
    const model = buildModel([a, b]);
    assert.deepEqual(model.issues.map(i => [i.id, i.warning, i.message]), [['a', true, "has a cooldown, so glue can't hold it every turn"]]);
    assert.ok(eligibility(a, model, initialState()).eligible);
});

// ── Railway switch ────────────────────────────────────────────────────

const fork = () => {
    const f = entry({ id: 'fork', switch: ['left', 'right'] });
    const left = entry({ id: 'left', gates: ['fork'], closeGates: false });
    const right = entry({ id: 'right', gates: ['fork'], closeGates: false });
    return [f, left, right];
};

test('taking one path closes the others for good', () => {
    const entries = fork();
    const { model, state } = play(entries, [['fork'], ['right']]);
    assert.deepEqual(state.closed, { left: true });
    assert.equal(eligibility(entries[1], model, state).reason, 'closed (switch: took right)');
    assert.ok(eligibility(entries[2], model, state).eligible);
    assert.deepEqual(eligibleIds(entries, model, state), ['fork', 'right']);
});

test('a tie closes every path but the first in switch order', () => {
    const entries = fork();
    const { state } = play(entries, [['fork']]);
    const model = buildModel(entries);
    const after = advance(state, [entries[2], entries[1]], model);
    assert.deepEqual(after.closed, { right: true });
});

test('switchLosers drops all but the first activated path in switch order', () => {
    const [f, left, right] = fork();
    const model = buildModel([f, left, right]);
    const key = e => `${e.world}.${e.uid}`;
    assert.deepEqual(switchLosers(model, [key(right), key(f), key(left)]), [key(right)]);
    assert.deepEqual(switchLosers(model, [key(right), key(f)]), []);
    assert.deepEqual(switchLosers(model, ['Other.1']), []);
});

test('a broken switch does nothing and its fork never fires', () => {
    const f = entry({ id: 'fork', switch: ['left', 'ghost'] });
    const left = entry({ id: 'left', gates: ['fork'] });
    const model = buildModel([f, left]);
    assert.deepEqual(model.switches, []);
    assert.equal(eligibility(f, model, initialState()).reason, 'config problem');
});

test('bad switch configs are reported', () => {
    const model = buildModel([
        entry({ id: 's1', switch: ['a'] }),
        entry({ id: 's2', switch: ['s2', 'a'] }),
        entry({ id: 's3', switch: ['a', 'b'] }),
        entry({ id: 's4', switch: ['b', 'c'] }),
        entry({ id: 'a', gates: ['s3'] }),
        entry({ id: 'b', gates: ['s3'] }),
        entry({ id: 'c', gates: ['s4'] }),
    ]);
    assert.deepEqual(model.issues.map(i => `${i.id}: ${i.message}${i.warning ? ' (warning)' : ''}`), [
        's1: switch must list at least two ids',
        's2: switch lists itself',
        's2: switch path "a" is also in the switch of s3',
        's3: switch path "a" is also in the switch of s2',
        's3: switch path "b" is also in the switch of s4',
        's4: switch path "b" is also in the switch of s3',
    ]);
});

test('a switch path that does not gate on the fork gets a warning', () => {
    const model = buildModel([entry({ id: 'fork', switch: ['left', 'right'] }), entry({ id: 'left' }), entry({ id: 'right', gates: ['fork'] })]);
    assert.deepEqual(model.issues.map(i => [i.id, i.warning, i.message]),
        [['fork', true, "switch path \"left\" doesn't gate on fork, so it can be taken before the fork"]]);
    assert.equal(model.switches.length, 1);
});

test('reopen takes an entry out of closed without touching the state it was given', () => {
    const entries = fork();
    const { model, state } = play(entries, [['fork'], ['right']]);
    const copy = structuredClone(state);
    const opened = reopen(state, 'left');
    assert.deepEqual(state, copy);
    assert.deepEqual(opened.closed, {});
    assert.equal(eligibility(entries[1], model, opened).reason, 'gate open');
    assert.deepEqual(advance(opened, [entries[1]], model).closed, { right: true }, 'taking the reopened path switches again');
});

// ── Masks ─────────────────────────────────────────────────────────────

const tower = () => [
    entry({ id: 'tower', masks: [
        { name: 'ruined', content: 'ruins', gates: ['storm'] },
        { name: 'lit', content: 'light' },
        { name: 'rebuilt', content: 'new', gates: ['storm', 'spring'], gateMode: 'all' },
    ] }),
    entry({ id: 'storm' }),
    entry({ id: 'spring' }),
];
const maskName = (entries, rounds, edit = s => s) => {
    const { model, state } = play(entries, rounds);
    return activeMask(model.nodes.get('tower'), edit(state))?.name ?? null;
};

test('a mask is active once its gates have fired; the last such mask wins', () => {
    const entries = tower();
    assert.equal(maskName(entries, []), null, 'base content at first');
    assert.equal(maskName(entries, [['storm']]), 'ruined');
    assert.equal(maskName(entries, [['storm'], ['spring']]), 'rebuilt');
});

test('a selected mask wins, a mask without gates needs selecting, clearing goes back to the gates', () => {
    const entries = tower();
    assert.equal(maskName(entries, [['storm']], s => selectMask(s, 'tower', 'lit')), 'lit');
    assert.equal(maskName(entries, [], s => selectMask(s, 'tower', 'lit')), 'lit');
    assert.equal(maskName(entries, [['storm']], s => selectMask(selectMask(s, 'tower', 'lit'), 'tower', '')), 'ruined');
    assert.equal(maskName(entries, [['storm']], s => selectMask(s, 'tower', 'ghost')), null, 'an unknown selection means base content');
});

test('the selection is carried by every later snapshot and never changes the state it was given', () => {
    const [t, storm] = tower();
    const model = buildModel([t, storm]);
    const selected = selectMask(initialState(), 'tower', 'lit');
    assert.deepEqual(initialState().masks, {});
    const later = advance(advance(selected, [storm], model), [], model);
    assert.deepEqual(later.masks, { tower: 'lit' });
    assert.deepEqual(readState(structuredClone(later)).masks, { tower: 'lit' });
});

test('malformed masks are reported and skipped; the entry still works', () => {
    const t = entry({ id: 't', masks: [
        { name: 'ok', content: 'fine', gates: ['t2'] },
        { content: 'no name' },
        { name: 'bad name', content: 'x' },
        { name: 'ok', content: 'twice' },
        { name: 'empty', content: '  ' },
        { name: 'g', content: 'x', gates: 'storm' },
        { name: 'm', content: 'x', gateMode: 'some' },
        { name: 'u', content: 'x', extra: 1 },
        { name: 'ghost', content: 'x', gates: ['nobody'] },
        'text',
    ] });
    const model = buildModel([t, entry({ id: 't2' })]);
    assert.deepEqual(messages(model), [
        't: mask 2: has no name',
        't: mask "bad name": name is not valid',
        't: mask "ok": name is used twice',
        't: mask "empty": has no content',
        't: mask "g": gates must be a list of ids',
        't: mask "m": gateMode must be "all" or "any"',
        't: mask "u": has unknown field extra',
        't: mask 10: is not an object',
        't: mask "ghost" gates on "nobody", which no entry has',
    ]);
    assert.deepEqual(model.nodes.get('t').masks.map(m => m.name), ['ok']);
    assert.ok(eligibility(t, model, initialState()).eligible);
    assert.equal(activeMask(model.nodes.get('t'), selectMask(initialState(), 't', 'ghost')), null);
    assert.deepEqual(messages(buildModel([entry({ id: 'x', masks: {} })])), ['x: masks must be a list']);
});
