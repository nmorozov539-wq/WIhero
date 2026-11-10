// Trackers (docs/TRACKERS.md): text slots the model writes. Played through the engine with the stand-in scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/model.js';
import { slotValues } from '../src/engine/turn.js';
import { compileSyntax, DEFAULT_SYNTAX, sample, syntaxProblems, syntaxWarnings } from '../src/engine/written.js';
import { e, Sim } from './sim.js';

const K = id => `Book/${id}`;
const slots = (...list) => list.map(([key, label, shape = 'line']) => ({ key, label, shape }));

test('reader: line and block, last match wins, labels ignore case and spaces, empty clears', () => {
    const r = compileSyntax(DEFAULT_SYNTAX, slots(['g', 'Gold'], ['a', 'Anna · Inventory'], ['c', 'Custom', 'block']));
    const got = r.read('Text.\n[gold: 7]\n[GOLD:  9 ]\n[anna   ·  inventory: sword, 12 gold]\n<Custom>\nspeed: 3\nhull: 2\n</custom>');
    assert.deepEqual(Object.fromEntries(got), { g: '9', a: 'sword, 12 gold', c: 'speed: 3\nhull: 2' });
    assert.equal(r.read('[Gold: ]').get('g'), '');
    assert.equal(r.read('<Custom></Custom>').get('c'), '');
    assert.equal(r.read('[Gold: 7\nmore]').has('g'), false, 'a line value stays on one line');
    assert.equal(r.read('[Silver: 7]').size, 0, 'unknown labels are ignored');
    assert.equal(r.strip('Hi.\n\n[Gold: 7]\n<Custom>x</Custom>'), 'Hi.');
    assert.equal(r.stripOnly('Hi. [Gold: 7] [Anna · Inventory: x]', new Set(['g'])), 'Hi.  [Anna · Inventory: x]');
});

test('reader: other syntaxes, and a line with no closing mark', () => {
    const html = compileSyntax({ line: '<!-- {label}={value} -->', open: '<x>', close: '</x>' }, slots(['g', 'Gold']));
    assert.equal(html.read('<!-- Gold=12 gold and a ruby -->').get('g'), '12 gold and a ruby');
    const bare = compileSyntax({ line: '{label}: {value}', open: '', close: '' }, slots(['t', 'Time'], ['l', 'Loc']));
    assert.deepEqual(Object.fromEntries(bare.read('Time: noon\nLoc: the inn')), { t: 'noon', l: 'the inn' });
    const one = compileSyntax({ line: 'Gold={value};', open: '', close: '' }, slots(['g', 'Gold']));
    assert.equal(one.read('Gold=5;').get('g'), '5', 'one slot needs no {label}');
    // A closing mark that repeats the label, as in XML: it must be the same label.
    const tag = { line: '<{label}>{value}</{label}>', open: '<{label}>', close: '</{label}>' };
    const xml = compileSyntax(tag, slots(['g', 'Gold'], ['m', 'Mood'], ['c', 'Custom', 'block']));
    assert.deepEqual(Object.fromEntries(xml.read('Hi.\n<Gold>12</Gold>\n<mood> calm </MOOD>\n<Custom>\nx\n</Custom>')), { g: '12', m: 'calm', c: 'x' });
    assert.equal(xml.read('<Gold>12</Mood>').size, 0, 'a different closing label is not a line');
    assert.equal(xml.strip('Hi.\n<Gold>12</Gold>'), 'Hi.');
    assert.deepEqual(syntaxWarnings(tag, slots(['g', 'Gold'], ['m', 'Mood']), ['<Gold>3</Gold>']), [], 'no "more than one line" warning');
});

test('syntax problems and warnings', () => {
    assert.deepEqual(syntaxProblems({ line: '[{label}]', open: '<a>', close: '</a>' }, slots(['g', 'Gold'])), ['the line template has no {value}']);
    assert.match(syntaxProblems({ line: '[{value}]', open: '', close: '' }, slots(['g', 'Gold'], ['s', 'Silver']))[0], /no \{label\}/);
    const w = syntaxWarnings(DEFAULT_SYNTAX, slots(['g', 'Gold'], ['gb', 'Gold bag'], ['h', 'Hull'], ['h2', 'Hulk']));
    assert.ok(w.includes('"Gold" is the start of "Gold bag"'));
    assert.ok(w.includes('"Hull" and "Hulk" are very alike'));
    assert.ok(w.some(x => x.includes('closes with "]"')));
    const t = syntaxWarnings(DEFAULT_SYNTAX, slots(['c', 'Custom', 'block'], ['g', 'Gold']), ['<Custom>\nspeed', '[Gold: 1\n2]']);
    assert.ok(t.includes('a test reply opens a block and never closes it'));
    assert.ok(t.some(x => x.includes('"Gold" was written over more than one line')));
    assert.equal(sample(DEFAULT_SYNTAX, { label: 'Gold', shape: 'line' }, '7'), '[Gold: 7]');
});

test('model: labels, duplicate labels, Moments, syntax problems, never fires', () => {
    const model = buildModel([
        e(0, 'gold', { id: 'gold', written: {} }, { comment: 'Gold' }),
        e(1, 'ship', { id: 'ship', masks: [{ name: 'Custom', written: { shape: 'block' } }] }, { comment: 'Ship config' }),
        e(2, 'a', { id: 'a', written: { label: 'Twin' } }), e(3, 'b', { id: 'b', written: { label: 'twin' } }),
        e(4, 'm', { id: 'm', moment: true, written: {} }),
        e(5, null, { id: 'dead', written: {} }),
    ]);
    assert.equal(model.slots.get(K('gold')).label, 'Gold');
    assert.equal(model.slots.get(`${K('ship')}|m:Custom`).label, 'Ship config · Custom');
    assert.equal(model.slots.get(`${K('ship')}|m:Custom`).shape, 'block');
    const msgs = model.issues.map(i => `${i.id}: ${i.message}`);
    assert.ok(msgs.some(m => m.startsWith('a: ') && m.includes('neither is read')));
    assert.ok(msgs.some(m => m.startsWith('b: ') && m.includes('neither is read')));
    assert.ok(msgs.some(m => m.startsWith('m: ') && m.includes('Moment')));
    assert.ok(!model.slots.has(K('m')));
    assert.ok(msgs.some(m => m.startsWith('dead: ') && m.includes('never fire')));
    assert.ok(!model.nodes.get(K('gold')).blocked, 'tracker problems never block the entry');
    const bad = buildModel([e(0, 'g', { id: 'g', written: { syntax: { line: '[{label}]' } } }), e(1, 'h', { id: 'h', written: {} })]);
    assert.equal(bad.trackers.get('Book').reader, null);
    assert.ok(bad.issues.some(i => i.message.includes('no {value}')));
    const teach = buildModel([e(0, 'g', { id: 'g', written: { teach: { on: true } } })]);
    assert.ok(teach.issues.some(i => i.warning && i.message.includes('no description')));
});

test('gold: a written main injects the newest value from the next message; no line keeps it; empty clears', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold', content: '10' })]);
    s.send('gold', 'You find coins. [Gold: 7]');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 10]', 'the reply that wrote it still used the start value, with its label');
    s.send('next', 'Nothing.');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 7]');
    s.send('again', 'Still nothing. [Gold: 3] and later [Gold: 4]');
    s.send('next');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 4]', 'the last match in the message wins');
    s.send('x', 'Lost it all. [Gold: ]');
    s.send('y');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 10]', 'cleared: the start value again');
});

test('a value is stored once, on the message that wrote it; later snapshots point there', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold' })]);
    s.send('gold', '[Gold: 7]');
    s.send('a');
    s.send('b');
    const last = s.chat.at(-1).extra.wihero;
    assert.deepEqual(last.wrote, {});
    assert.equal(last.written[K('gold')], 2);
    assert.deepEqual(s.chat[2].extra.wihero.wrote, { [K('gold')]: '7' });
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '7');
});

test('swipes and continues rewind and reread', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold' })]);
    s.send('gold', '[Gold: 7]');
    s.send('a', '[Gold: 8]');
    s.swipe('No change.');
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '7', 'the swipe rewound 8');
    s.continue(' [Gold: 9]');
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '9', 'a continue reads the whole message');
});

test('only open entries read; a closed or waiting tracker ignores its line', () => {
    const s = new Sim([
        e(0, 'door', { id: 'door' }),
        e(1, 'gold', { id: 'gold', gate: [['door']], glue: { mode: 'hold' }, written: {} }, { comment: 'Gold' }),
    ]);
    s.send('hi', '[Gold: 5]');
    assert.equal(slotValues(s.model, s.state, s.chat).has(K('gold')), false, 'waiting on its gate');
    s.send('door', 'Door opens.');
    s.send('gold', '[Gold: 6]');
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '6');
});

test('who: the user writes it when by is "user", for the reply to that message', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', by: 'user', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold' })]);
    s.send('gold');
    s.send('I pay. [Gold: 2]', '[Gold: 99]');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 2]', 'used in the reply to the same message');
    s.send('next');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 2]', "the character's line is not read");
});

test('a greeting seeds the starting value', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold' })], { greetingText: 'Welcome. [Gold: 50]' });
    s.send('gold');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 50]');
    s.send('x', '[Gold: 40]');
    s.send('y');
    assert.equal(s.lastSettle.text.get('Book.0'), '[Gold: 40]');
});

test('ship config: a written mask is on while it holds a value, and falls back to main when cleared', () => {
    const s = new Sim([e(0, 'ship', { id: 'ship', glue: { mode: 'hold' }, masks: [{ name: 'Custom', written: { shape: 'block' } }] }, { comment: 'Ship config', content: 'standard' })]);
    s.send('ship', 'Configuring.\n<Ship config · Custom>\nspeed: 9\n</Ship config · Custom>');
    s.send('go');
    assert.equal(s.maskOf(0), 'Custom');
    assert.equal(s.lastSettle.text.get('Book.0'), '<Ship config · Custom>\nspeed: 9\n</Ship config · Custom>');
    s.send('done', 'Event over. <Ship config · Custom></Ship config · Custom>');
    s.send('next');
    assert.equal(s.maskOf(0), null, 'cleared: main again');
    assert.equal(s.lastSettle.text.has('Book.0'), false, 'the book content, the standard config');
    s.send('again', '<Ship config · Custom>speed: 1</Ship config · Custom>');
    s.send('next');
    assert.equal(s.maskOf(0), 'Custom', 'on again, as often as the story needs');
});

test('manual set, edit of the latest reply, the instruction, prompt stripping, show in chat, the bubble', async () => {
    const { setSlot } = await import('../src/engine/manual.js');
    const { rereadReply, stateForScan } = await import('../src/engine/turn.js');
    const { instruction } = await import('../src/engine/written.js');
    const { shownText } = await import('../src/show-in-chat.js');
    const { wroteLines } = await import('../src/bubble.js');
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: { show: false, describe: 'coins the player carries', teach: { on: true, depth: 2 } } }, { comment: 'Gold' })]);
    s.send('gold', 'Found coins. [Gold: 7]');
    assert.deepEqual(wroteLines(s.chat, k => s.model.slots.get(k)), ['Gold → 7']);
    assert.equal(shownText(s.chat.at(-1).mes, s.model), 'Found coins.');
    assert.equal(shownText('Spaced\n\n\n\nout.', s.model), null, 'no hidden line: left to ST, blank lines and all');
    assert.equal(shownText('One.\n[Gold: 7]\n\n\nTwo.', s.model), 'One.\n\n\nTwo.', 'only the tracker\'s line goes');
    // Edit the latest reply: read again.
    const last = s.chat.length - 1;
    s.chat[last].mes = 'Found coins. [Gold: 8]';
    const before = s.chat.slice(0, last);
    s.chat[last].extra.wihero = rereadReply(s.chat[last].extra.wihero, stateForScan(before, s.model, {}), s.model, s.chat, last);
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '8');
    // By hand, on the latest message.
    s.send('x');
    const at = s.chat.length - 1;
    s.chat[at].extra.wihero = setSlot(s.chat[at].extra.wihero, K('gold'), '100', at);
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '100');
    s.chat[at].extra.wihero = setSlot(s.chat[at].extra.wihero, K('gold'), '', at);
    assert.equal(slotValues(s.model, s.state, s.chat).get(K('gold')), '');
    const t = s.model.trackers.get('Book');
    assert.equal(t.teach.depth, 2);
    const text = instruction(t, t.slots, new Map([[K('gold'), '8']]));
    assert.match(text, /\[Gold: \(value\)\]\n {2}\(coins the player carries; now 8\)/);
    assert.equal(t.reader.strip('Hi. [Gold: 3]'), 'Hi.');
});

test('the instruction gives a line tracker\'s start value until one is written', async () => {
    const { instruction } = await import('../src/engine/written.js');
    const model = buildModel([e(0, 'gold', { id: 'gold', written: { teach: { on: true } } }, { comment: 'Gold', content: '10' })]);
    const t = model.trackers.get('Book');
    assert.match(instruction(t, t.slots, new Map()), /now 10/);
    assert.match(instruction(t, t.slots, new Map([[K('gold'), '15']])), /now 15/);
    assert.match(instruction(t, t.slots, new Map([[K('gold'), '']])), /now 10/, 'cleared: the start value again');
});

test('Send with its label off: the bare value, and the book text untouched until a value is written', () => {
    const s = new Sim([e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: { labelled: false } }, { comment: 'Gold', content: '10' })]);
    s.send('gold', '[Gold: 7]');
    assert.equal(s.lastSettle.text.has('Book.0'), false, 'the book text as it is');
    s.send('next');
    assert.equal(s.lastSettle.text.get('Book.0'), '7');
});
