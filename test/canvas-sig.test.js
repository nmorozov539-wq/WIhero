// The canvas input projection (V2): everything the cards draw reaches the signature, body text does not, order never
// does, and the expensive entry side is built once per model rather than once per Hero draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasElementSig, canvasInputSig } from '../src/ui/canvas-sig.js';

const element = (over = {}) => ({
    id: 'id:a', uid: 1, title: 'Alpha', keys: ['alpha'], strategy: 'keys', off: false, folder: '', problem: false,
    gate: [['id:b']], gatesFor: [], closeGate: [], closesAfter: null, closesFor: [], fromGreetings: [],
    glue: null, switch: [], packs: ['p'], note: '', once: false, by: null,
    masks: [{ name: 'one', content: 'MASK-BODY', gate: [['id:b']], closeGate: [] }],
    entry: { content: 'ENTRY-BODY' },
    ...over,
});

const elements = () => [
    element(),
    element({ id: 'id:b', uid: 2, title: 'Beta', keys: ['beta'], gate: [], packs: [], masks: [] }),
];

const base = (over = {}) => ({
    model: { canvasElementSig: canvasElementSig(elements()) },
    cards: {
        'id:a': {
            x: 12, y: 24, ports: { gin: 'top' }, layer: null, placed: true,
            links: { 'gout>id:b': { dots: [{ u: 0.5, v: 0.1 }], segments: [{ type: 'curve' }, { type: 'arc' }] } },
        },
        'id:b': { x: 120, y: 24, ports: { cout: 'bottom' }, layer: null, placed: false },
    },
    placed: true,
    hidden: new Set([2, 10]),
    chat: ['chat-a', 'character-a'],
    ...over,
});

const withFirstElement = (over, change = e => e) => {
    const list = elements();
    list[0] = change({ ...list[0], ...over });
    return list;
};
const withCards = change => {
    const cards = structuredClone(base().cards);
    change(cards);
    return { cards };
};

test('entry text and canvas bookkeeping are not in the projection', () => {
    const a = canvasElementSig(elements());
    const marked = withFirstElement({
        edited: 'EDITED-MARKER', seen: 'SEEN-MARKER', snapshots: { x: 'SNAPSHOTS-MARKER' },
        folders: { f: 'FOLDERS-MARKER' }, defaults: { d: 'DEFAULTS-MARKER' },
        chatState: 'CHAT-STATE-MARKER', chat: 'CHAT-MARKER', chatId: 'CHAT-ID-MARKER',
    }, e => ({
        ...e,
        content: 'CONTENT-MARKER',
        entry: { content: 'CONTENT-MARKER' },
        masks: e.masks.map(m => ({ ...m, content: 'CONTENT-MARKER' })),
    }));
    assert.equal(canvasElementSig(marked), a);
    for (const marker of ['EDITED-MARKER', 'SEEN-MARKER', 'SNAPSHOTS-MARKER', 'FOLDERS-MARKER', 'DEFAULTS-MARKER', 'CHAT-STATE-MARKER', 'CHAT-MARKER', 'CHAT-ID-MARKER', 'CONTENT-MARKER', 'ENTRY-BODY', 'MASK-BODY']) {
        assert.ok(!a.includes(marker), `${marker} is not in the projection`);
    }
});

test('a title, key words, off/on, strategy, problem, folder or logic change gives a different signature', () => {
    const a = canvasElementSig(elements());
    const differs = list => assert.notEqual(canvasElementSig(list), a);
    differs(withFirstElement({ title: 'Renamed' }));
    differs(withFirstElement({ keys: ['alpha', 'gamma'] }));
    differs(withFirstElement({ off: true }));
    differs(withFirstElement({ strategy: 'perm' }));
    differs(withFirstElement({ strategy: 'vec' }));
    differs(withFirstElement({ problem: true }));
    differs(withFirstElement({ folder: 'Campaigns' }));
    differs(withFirstElement({ gate: [['id:c']] }));
    differs(withFirstElement({ gatesFor: ['id:b'] }));
    differs(withFirstElement({ closeGate: [['id:b']] }));
    differs(withFirstElement({ closesAfter: 2 }));
    differs(withFirstElement({ closesFor: ['id:b'] }));
    differs(withFirstElement({ fromGreetings: [{ from: 'greet:x:0', to: 'id:a', kind: 'open' }] }));
    differs(withFirstElement({ glue: { mode: 'hold' } }));
    differs(withFirstElement({ switch: ['id:b'] }));
    differs(withFirstElement({ packs: ['q'] }));
    differs(withFirstElement({ note: 'sticky' }));
    differs(withFirstElement({ once: true }));
    differs(withFirstElement({ by: 'char' }));
    differs(withFirstElement({ masks: [{ name: 'two', content: 'x', gate: [], closeGate: [] }] }));
});

test('Moment phrases and who says them change the signature', () => {
    const moment = (phrases, by) => canvasElementSig(withFirstElement({ moment: { phrases, by } }));
    assert.notEqual(moment(['said'], 'user'), moment(['said', 'again'], 'user'));
    assert.notEqual(moment(['said'], 'user'), moment(['said'], 'char'));
});

test('card geometry, placed, hidden and chat identity change the saved-memory side', () => {
    const a = canvasInputSig(base());
    const differs = over => assert.notEqual(canvasInputSig({ ...base(), ...over }), a);
    differs(withCards(cards => { cards['id:a'].x += 12; }));
    differs(withCards(cards => { cards['id:a'].ports.gin = 'left'; }));
    differs(withCards(cards => { cards['id:a'].layer = 'one'; }));
    differs(withCards(cards => { cards['id:a'].links['gout>id:b'].dots[0].v = 0.4; }));
    differs(withCards(cards => { cards['id:a'].placed = false; }));
    differs({ placed: false });
    differs({ hidden: new Set([3]) });
    differs({ chat: ['chat-b', 'character-a'] });
});

test('element, card, port, link and hidden order do not matter', () => {
    const a = base();
    const reversed = {
        ...a,
        cards: Object.fromEntries(Object.entries(a.cards).reverse().map(([key, card]) => [key, {
            ...card,
            ports: Object.fromEntries(Object.entries(card.ports).reverse()),
            links: card.links ? Object.fromEntries(Object.entries(card.links).reverse()) : card.links,
        }])),
        hidden: [10, 2],
    };
    assert.equal(canvasInputSig(a), canvasInputSig(reversed));
    assert.equal(canvasElementSig(elements()), canvasElementSig([...elements()].reverse()));
});

test('the entry side is built once for a model and reused across two canvasSig calls', () => {
    const model = {};
    let builds = 0;
    const build = () => { builds++; return elements(); };
    const memory = { cards: base().cards, placed: true, hidden: [2], chat: ['chat-a', 'character-a'] };
    const a = canvasInputSig({ model, elements: build, ...memory });
    const b = canvasInputSig({ model, elements: build, ...memory });
    assert.equal(builds, 1);
    assert.equal(a, b);
    assert.equal(model.canvasElementSig, canvasElementSig(elements()));
    let again = false;
    canvasInputSig({ model, elements: () => { again = true; return []; }, ...memory });
    assert.equal(again, false, 'a model with its entry side already built does not build it again');
});
