// Explain mode (src/ui/explain.js): what a tap in Hero mode opens the Guide at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainAnchor } from '../src/ui/explain.js';

/** A stand-in element: `closest(sel)` finds the first ancestor (itself first) whose selectors list has `sel`. */
function node(chain) {
    const els = chain.map(([sels, data = {}, label = null]) => ({ sels, dataset: data, getAttribute: k => (k === 'aria-label' ? label : null) }));
    return { closest: sel => els.find(x => x.sels.includes(sel)) ?? null };
}
const H = { bar: { edit: null } };

test('a piece chip, a port, a pill and a line open their pieces', () => {
    assert.equal(explainAnchor(node([[['.pchip[data-piece]'], { piece: 'gate' }]]), H), 'opens');
    assert.equal(explainAnchor(node([[['[data-port]'], { port: 'id:mill|cin' }]]), H), 'closes');
    assert.equal(explainAnchor(node([[['.lockp'], { kind: 'wait' }]]), H), 'wait');
    assert.equal(explainAnchor(node([[['.lhit'], { kind: 'ride' }]]), H), 'glue');
});

test('the strip explains the piece it edits; cards, buttons and the rest by kind', () => {
    assert.equal(explainAnchor(node([[['.pstrip']]]), { bar: { edit: { piece: 'glue' } } }), 'glue');
    assert.equal(explainAnchor(node([[['.pstrip']]]), H), 'strip');
    assert.equal(explainAnchor(node([[['.card.moment', '.card']]]), H), 'moment');
    assert.equal(explainAnchor(node([[['.card']]]), H), 'canvas');
    assert.equal(explainAnchor(node([[['button'], {}, 'Tidy layout']]), H), 'tidy');
    assert.equal(explainAnchor(node([[['.also']]]), H), 'also');
    assert.equal(explainAnchor(node([[['.nothing']]]), H), null);
});
