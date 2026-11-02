// Preview (src/ui/preview.js) on the sample book: every block reason in CONCEPTS 7 shows up, the reply counts
// from the next message (D1), and Preview agrees with a chat played through the engine (BUILD_SPEC 16, N5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel } from '../src/engine/model.js';
import { explain, keyHits, runPreview } from '../src/ui/preview.js';
import { Sim } from './sim.js';

const book = JSON.parse(fs.readFileSync(new URL('../examples/WIHero-Sample.json', import.meta.url), 'utf8'));
const entries = () => Object.values(structuredClone(book.entries)).map(e => ({ ...e, world: 'Book' }));
const uidOf = comment => Number(Object.values(book.entries).find(e => e.comment.startsWith(comment)).uid);
const stKey = comment => `Book.${uidOf(comment)}`;

/** A pretend chat: each exchange's snapshot comes from the one before, as in a real chat. */
function chatOf(turns) {
    const list = entries();
    const model = buildModel(list);
    let base = [];
    let last = null;
    for (const [user, reply] of turns) {
        last = runPreview({ entries: list, model, base, user, reply });
        base = [...base, { is_user: true, mes: user }, { is_user: false, mes: reply, extra: { wihero: last.next } }];
    }
    return { list, model, base, run: (user, reply = '') => runPreview({ entries: list, model, base, user, reply }) };
}
const why = (run, comment) => run.results.get(stKey(comment))?.why;
const status = (run, comment) => run.results.get(stKey(comment))?.status;

test('waiting on an entry, wrong side, turned off; Also active lists the permanent entry', () => {
    const { run } = chatOf([]);
    const p = run('The mill, a shrine, a storm.', 'You hear a whisper.');
    assert.equal(why(p, 'Mill: arrival'), 'its gate is waiting for Road: leaving the village');
    assert.equal(why(p, 'Shrine'), 'the entry is turned off');
    assert.equal(status(p, 'Storm'), 'fires');
    assert.deepEqual(p.also, [stKey('Sky')]);
    const whisper = p.hits.reply.find(h => h.stKey === stKey('Whisper'));
    assert.equal(whisper.ok, false);
    assert.equal(whisper.next.why, 'only your messages trigger it, and this was in the reply');
    assert.match(explain(whisper.next, 'whisper', { next: true }), /^"whisper": it is in the reply, so it counts from the next message/);
    assert.ok(p.hits.user.some(h => h.stKey === stKey('Shrine') && !h.ok), 'a turned off entry\'s phrase is struck');
});

test('lock not armed, then armed and waiting; a lock phrase in the reply opens it from the next message (D1)', () => {
    let p = chatOf([]).run('', 'A guard with a red beard.');
    const lock = p.hits.reply.find(h => h.lock === 'red beard');
    assert.match(lock.why, /isn't armed yet: it arms once Mill: arrival has fired/);
    const c = chatOf([['road', 'ok'], ['mill', 'ok']]);
    p = c.run('the cave');
    assert.equal(why(p, 'Cave'), 'its lock is armed and waiting for "red beard"');
    p = c.run('the cave', 'A guard with a red beard.');
    const hit = p.hits.reply.find(h => h.lock === 'red beard');
    assert.ok(hit.ok);
    assert.equal(`"red beard": ${hit.why}.`, '"red beard": opens the lock on Cave (lock: "red beard", after the mill)\'s gate from the next message.');
    assert.equal(status(p, 'Cave'), 'blocked', 'not in this reply');
    assert.ok(p.changes.some(x => x.text.startsWith('The lock on Cave') && x.when === 'From the next message'));
    // In the user's own message it opens for this reply.
    p = c.run('the cave, and a red beard');
    assert.equal(status(p, 'Cave'), 'fires');
});

test('a wait that hasn\'t run out', () => {
    const p = chatOf([['road', 'ok']]).run('the bridge');
    assert.equal(why(p, 'Bridge'), 'its wait hasn\'t run out: 1 more message');
    assert.ok(p.changes.some(x => x.text === 'Bridge (two messages after the road)\'s gate opens from the next message'));
});

test('closed earlier, Once, closed this turn by another entry, and the switch already picked', () => {
    const c = chatOf([['road', 'ok'], ['mill fork omen', 'ok']]);
    const p = c.run('road mill left right omen');
    assert.equal(why(p, 'Road'), 'it was closed earlier in the chat, by Mill: arrival');
    assert.equal(why(p, 'Omen'), 'it fires once, and it already fired');
    assert.equal(why(p, 'Mill: arrival'), 'Mill: the secret closes it this turn, and closing beats opening');
    assert.equal(why(p, 'Right path'), 'Fork (switch: left or right)\'s switch already picked Left path');
    assert.equal(status(p, 'Left path'), 'fires');
    assert.ok(p.changes.some(x => x.when === 'This turn' && x.text.startsWith('Right path closes')));
    assert.deepEqual(p.start.closed, ['Road: leaving the village', 'Omen (once)']);
});

test('close gate met: the storm passes in your message', () => {
    const c = chatOf([['storm', 'ok']]);
    let p = c.run('quiet');
    assert.equal(status(p, 'Storm'), 'fires');
    assert.ok(p.also.includes(stKey('Storm')), 'a hold is Also active');
    p = c.run('the storm passes');
    assert.equal(why(p, 'Storm'), 'its close gate is met ("storm passes" is said)');
});

test('what would change: closes, holds, masks, and key words in the reply from the next message', () => {
    const p = chatOf([]).run('road and storm', 'The mill wheel turns.');
    const texts = p.changes.map(x => x.text);
    assert.ok(texts.some(t => t.startsWith('Storm (glued until it passes) holds: it stays on until "storm passes" is said')));
    assert.ok(texts.includes('Tower (masks: ruined after the storm, lit when selected) switches to its "ruined" mask'));
    assert.ok(texts.includes('Mill: arrival fires on the next message: key word "mill" is in the reply'));
    assert.ok(p.results.get(stKey('Storm')).changes.some(x => x.text.includes('holds')), 'an entry explains its own changes');
});

test('key words follow ST\'s matching: case, whole words, regex', () => {
    const e = { key: ['Red', '/b[ae]ll/i'] };
    assert.deepEqual(keyHits(e, 'red bell', {}).map(h => [h.a, h.b]), [[0, 3], [4, 8]]);
    assert.deepEqual(keyHits(e, 'red', { caseSensitive: true }), []);
    assert.deepEqual(keyHits({ key: ['red'] }, 'reddish', { matchWholeWords: true }), []);
});

test('Preview and a chat played through the engine agree, turn by turn', () => {
    const turns = [['road', 'The road.'], ['mill and a bridge', 'A guard with a red beard.'], ['the cave, the fork', 'The left path.'], ['left and right, the bridge', 'ok'], ['wheel, the storm', 'ok'], ['tower', 'ok']];
    const sim = new Sim(entries());
    sim.chat = [];
    const list = entries();
    const model = buildModel(list);
    let base = [];
    for (const [user, reply] of turns) {
        const p = runPreview({ entries: list, model, base, user, reply, globals: { depth: 2 } });
        const fired = sim.send(user, reply).sort((a, b) => a - b);
        const said = [...p.results.values()].filter(r => r.status === 'fires').map(r => r.uid).sort((a, b) => a - b);
        assert.deepEqual(said, fired, `after "${user}"`);
        const sorted = st => ({ ...st, round: [...st.round].sort() }); // ST's activation order isn't ours to copy
        assert.deepEqual(sorted(p.next), sorted(sim.chat.at(-1).extra.wihero), `the state after "${user}"`);
        base = [...base, { is_user: true, mes: user }, { is_user: false, mes: reply, extra: { wihero: p.next } }];
    }
});
