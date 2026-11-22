// Explain mode's explicit metadata and activation contract (src/ui/explain-meta.js): what a press resolves to, what
// the first and second activations do, and that a blocked control never acts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLAIN, activationStep, blockRegion, canonicalTarget, describeNode, explainNode } from '../src/ui/explain-meta.js';

/**
 * A stand-in element: `sel` is its tag/class set, `parent` its parent. `closest` finds the first ancestor (itself
 * first) whose selectors include `s`; `matches` is true for any selector it carries.
 */
function node(sel = [], { parent = null, label = null, text = '', data = {} } = {}) {
    const n = {
        sel, parent, dataset: { ...data }, isConnected: true,
        matches: s => (s === '[data-xkey]' ? n.dataset.xkey != null : s === '[data-xblock]' ? n.dataset.xblock != null : s.split(',').some(x => sel.includes(x.trim()))),
        closest(s) { for (let x = n; x; x = x.parentElement) if (x.matches(s)) return x; return null; },
        getAttribute: k => (k === 'aria-label' ? label : k === 'data-xkey' ? n.dataset.xkey ?? null : null),
        setAttribute: (k, v) => { if (k === 'data-xkey') n.dataset.xkey = v; if (k === 'data-xblock') n.dataset.xblock = v; },
        querySelector: s => (s === '.lab' && n.lab ? n.lab : null),
        get textContent() { return text; },
        get parentElement() { return n.parent; },
    };
    return n;
}

test('an icon or label inside a marked control resolves to that control', () => {
    const button = node(['button']);
    const icon = node(['span'], { parent: button });
    explainNode(button, 'nav.open', { text: 'Opens the thing.' });
    assert.equal(canonicalTarget(icon), button);
    assert.deepEqual(describeNode(button), {
        key: 'nav.open', title: 'This', text: 'Opens the thing.', navigate: 'native', guide: null, long: false,
    });
});

test('an unmarked nested button never borrows a marked row\'s permission', () => {
    const row = node(['div']);
    const del = node(['button'], { parent: row });
    explainNode(row, 'nav.open', { text: 'Opens the entry.' });
    assert.equal(canonicalTarget(del), del, 'the nested button is its own canonical target');
    assert.equal(describeNode(del), null, 'and it has no permission of its own');
});

test('first activation arms; the second follows only a navigational target', () => {
    const nav = node(['button']);
    const stop = node(['button']);
    const navD = { navigate: 'native', text: 'Opens.' };
    const stopD = { navigate: false, text: 'Deletes.' };
    const one = activationStep(null, nav, navD);
    assert.equal(one.action, 'tip', 'the first activation only shows the tooltip');
    assert.equal(one.arm, nav);
    const two = activationStep(one.arm, nav, navD);
    assert.equal(two.action, 'native', 'the second lets one normal click through');
    assert.equal(two.arm, null, 'and clears the armed target first');
    const blocked = activationStep(one.arm, stop, stopD);
    assert.equal(blocked.action, 'tip');
    assert.equal(blocked.arm, stop, 'a different target is armed instead');
    const repeat = activationStep(blocked.arm, stop, stopD);
    assert.equal(repeat.action, 'tip', 'a blocked target stays blocked');
    assert.equal(repeat.arm, stop);
});

test('a conceptual target with a Guide page opens the Guide on its second activation', () => {
    const card = node(['.card']);
    const d = { navigate: 'guide', guide: 'canvas', text: 'An entry.' };
    const one = activationStep(null, card, d);
    assert.equal(one.action, 'tip');
    assert.equal(activationStep(one.arm, card, d).action, 'guide');
});

test('a detached or replaced target cannot navigate', () => {
    const old = node(['button']);
    const d = { navigate: 'native', text: 'Opens.' };
    old.isConnected = false;
    const step = activationStep(old, old, d);
    assert.equal(step.action, 'tip', 'a detached target only arms the new node');
    assert.equal(step.arm, old);
});

test('an editor region blocks its controls with a readable general tooltip', () => {
    const region = node(['div']);
    blockRegion(region);
    const field = node(['input'], { parent: region, label: 'Label' });
    assert.equal(canonicalTarget(field), field);
    assert.deepEqual(describeNode(field), {
        key: 'blocked.edit', title: 'Label', text: 'Edits the book.',
        navigate: false, guide: null, long: false,
    });
});

test('a descriptor can name the control and use its own value', () => {
    const row = node(['button'], { text: 'Mill' });
    explainNode(row, 'shell.panel.row', { title: 'Mill', text: 'Opens Mill in a tab of its own.' });
    assert.equal(describeNode(row).title, 'Mill');
    assert.equal(describeNode(row).text, 'Opens Mill in a tab of its own.');
});

test('the catalogue says what a thing does, never what Explain mode will not do', () => {
    for (const [key, d] of Object.entries(EXPLAIN)) {
        if (typeof d.text === 'string') assert.doesNotMatch(d.text, /Explain mode/i, key);
        if (d.navigate === false && d.text) assert.ok(d.text.length > 0, key);
    }
});

test('book actions carry their own copy, and the canvas copy follows the review', () => {
    assert.equal(EXPLAIN['book.global'].text, 'Global = every chat uses this book when a key word matches.');
    assert.match(EXPLAIN['book.delete'].text, /Undo for a few seconds/);
    assert.equal(EXPLAIN['shell.zoomLabel'].text, 'Back to 100%.');
    assert.equal(EXPLAIN['canvas.zoomLabel'].text, 'Back to 100%.');
    assert.match(EXPLAIN['shell.tidy'].text, /resets link ports/);
    assert.equal(EXPLAIN['shell.legend'].text, 'The legend: what the line colors and card marks mean.');
    assert.equal(EXPLAIN['shell.panel.dot'].text, 'Lit when the entry is on the canvas. Drag it to place or move the card.');
});
