// Grouped model issues (C2): problemsOf, warningsOf and Hero mode's blocking set answer from the map modelOf
// attaches, and give exactly what filtering model.issues gave before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/model.js';
import { blockingUids, groupIssues, problemsOf, warningsOf } from '../src/ui/model-issues.js';
import { e } from './sim.js';

const PLAIN = 'Book';
const grouped = model => { model.issuesByStKey = groupIssues(model.issues); return model; };
const scanProblems = (model, uid, book) => model.issues.filter(i => i.stKey === `${book}.${uid}` && !i.warning && i.blocking !== false);
const scanWarnings = (model, uid, book) => model.issues.filter(i => i.stKey === `${book}.${uid}` && (i.warning || i.blocking === false));
const scanBlocking = (model, book) => new Set(model.issues
    .filter(i => !i.warning && i.blocking !== false && i.stKey?.startsWith(`${book}.`))
    .map(i => Number(i.stKey.slice(book.length + 1))));

/** One book: a fine entry, a blocking issue, a warning, a non-blocking note, and an entry that uses the Moment. */
const book = () => [
    e(0, 'fine', { id: 'fine' }),
    e(1, 'bad', { id: 'bad id' }),
    e(2, 'warn', { id: 'warn', bogus: true }),
    e(3, 'held', { id: 'held', moment: true, written: true }),
    e(4, 'use', { id: 'use', gate: [['held']] }),
];

test('problems, warnings and blocking uids match a scan, with an issue that has no stKey', () => {
    const model = buildModel(book());
    model.issues.push({ key: '@greet', stKey: null, book: null, id: null, label: 'a greeting', message: 'cannot fire', blocking: false });
    const before = structuredClone(model.issues);
    grouped(model);
    assert.deepEqual(model.issues, before, 'grouping leaves model.issues alone');
    assert.ok(model.issuesByStKey instanceof Map);

    for (const uid of [0, 1, 2, 3, 4, 5, 99]) {
        assert.deepEqual(problemsOf(model, uid, PLAIN), scanProblems(model, uid, PLAIN), `problems of ${uid}`);
        assert.deepEqual(warningsOf(model, uid, PLAIN), scanWarnings(model, uid, PLAIN), `warnings of ${uid}`);
    }
    assert.deepEqual(problemsOf(model, 1, 'Other'), [], 'another book names nobody');
    assert.deepEqual([...blockingUids(PLAIN, model)].sort(), [...scanBlocking(model, PLAIN)].sort());
    assert.deepEqual([...blockingUids('Other', model)], [], 'another book has no blocked entries');
    assert.equal(blockingUids(PLAIN, model).has(3), false, 'a non-blocking note is not a problem');
});

test('a model with no issues answers empty everywhere', () => {
    const model = grouped(buildModel([e(0, 'plain', { id: 'plain' })]));
    assert.deepEqual(model.issues, []);
    assert.deepEqual(problemsOf(model, 0, PLAIN), []);
    assert.deepEqual(warningsOf(model, 0, PLAIN), []);
    assert.deepEqual([...blockingUids(PLAIN, model)], []);
});

test('fixing an entry drops its issue; breaking another adds one', () => {
    const entries = book();
    let model = grouped(buildModel(entries));
    assert.deepEqual(problemsOf(model, 1, PLAIN).map(i => i.id), [null]);
    assert.ok(blockingUids(PLAIN, model).has(1));

    entries[1] = e(1, 'bad', { id: 'bad' });
    entries[0] = e(0, 'fine', { id: 'fine', gate: [['nowhere']] });
    model = grouped(buildModel(entries));
    assert.deepEqual(problemsOf(model, 1, PLAIN), []);
    assert.deepEqual(warningsOf(model, 1, PLAIN), []);
    assert.equal(blockingUids(PLAIN, model).has(1), false);
    assert.ok(problemsOf(model, 0, PLAIN).length, 'the new broken gate is reported');
    assert.ok(blockingUids(PLAIN, model).has(0));
});
