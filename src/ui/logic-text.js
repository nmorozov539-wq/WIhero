// The entry page's Story logic section (LAYOUT "Entry page"): one plain sentence per rule, in the piece's
// family color, including the rules other entries put on this one. Pure, read from the model (src/engine/model.js).
import { entryKey } from '../engine/model.js';
import { isObject } from '../engine/util.js';

const READING = /^#([^:]+)(?::(all|\d+))?$/;

/** Piece families (VISUAL 6.2) → CSS color variable. */
export const FAMILY_COLOR = { open: 'var(--p-open)', close: 'var(--p-close)', glue: 'var(--p-glue)', mask: 'var(--p-mask)', pack: 'var(--p-pack)', by: 'var(--muted)' };

export const and = (list, word = 'and') => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${word} ${list.at(-1)}`;
const greetingName = n => n === 0 ? 'Greeting' : `Alt ${n}`;

/**
 * Names and row sentences for one entry's rules: `nameOf(stateKey)`, `idName(id)`, `rowText(raw row)`.
 * @param {object} node a model node
 * @param {object} model buildModel's result for the node's book
 */
export function wording(node, model) {
    const nameOf = key => {
        if (key.startsWith('@')) {
            const g = model.greetings?.get(key);
            return g ? `${g.ref.name || g.ref.char}'s ${greetingName(g.ref.greeting)}` : 'a greeting';
        }
        return model.nodes.get(key)?.label ?? key.slice(key.indexOf('/') + 1);
    };
    const idName = id => nameOf(entryKey(node.book, id));
    const packName = (name, mode) => `${mode === 'all' ? 'all' : mode ? mode : 'any'} of #${name}`;

    const refText = ref => {
        if (typeof ref === 'string') {
            const r = READING.exec(ref);
            return r ? packName(r[1], r[2]) : idName(ref);
        }
        return null;
    };
    /** One row: what has to have fired, then what has to be said or have passed. */
    const rowText = row => {
        const fired = row.filter(x => typeof x === 'string').map(refText);
        const rest = [];
        for (const x of row) {
            if (!isObject(x)) continue;
            if ('lock' in x) {
                const phrases = and((x.lock ?? []).map(p => `"${p}"`), 'or');
                rest.push(x.by === 'user' ? `you say ${phrases}` : x.by === 'char' ? `the character says ${phrases}` : `${phrases} is said`);
            }
            else if ('wait' in x) rest.push(`${x.wait} message${x.wait === 1 ? '' : 's'} have passed`);
            else if ('greeting' in x) rest.push(`the chat opened with ${x.name || x.char}'s ${greetingName(x.greeting)}`);
        }
        const parts = [];
        if (fired.length) parts.push(`${and(fired)} ${fired.length === 1 && !/^(any|all|\d+) of/.test(fired[0]) ? 'has' : 'have'} fired`);
        parts.push(...rest);
        return and(parts);
    };
    return { nameOf, idName, rowText };
}

/**
 * @param {object} node a model node
 * @param {object} model buildModel's result for the node's book
 * @returns {{ family: string, label: string, text: string }[]}
 */
export function logicLines(node, model) {
    if (!node?.key) return [];
    const c = node.config ?? {};
    const { nameOf, idName, rowText } = wording(node, model);
    const rowsText = rows => (Array.isArray(rows) ? rows : []).filter(r => Array.isArray(r) && r.length).map(rowText).join('; or when ');
    const targets = list => and((Array.isArray(list) ? list : []).map(t => (t.startsWith('#') ? `#${t.slice(1)}` : idName(t))));

    const lines = [];
    const add = (family, label, text) => lines.push({ family, label, text });

    // The entry's own pieces, in matrix order, each followed by what other entries aim at it.
    if (Array.isArray(c.gate) && c.gate.length) add('open', 'Gate', `Opens when ${rowsText(c.gate)}`);
    const heldBy = node.opens.all.filter(i => i.type === 'entry').map(i => nameOf(i.source));
    if (heldBy.length) add('open', 'Held back by', `Waits until ${and(heldBy)} ${heldBy.length === 1 ? 'has' : 'have'} fired`);
    const startsWith = node.opens.all.filter(i => i.type === 'greeting').map(i => nameOf(i.key));
    if (startsWith.length) add('open', 'Started by', `Opens only in a chat that opened with ${and(startsWith, 'or')}`);
    if (Array.isArray(c.gatesFor) && c.gatesFor.length) add('open', 'Gates for', `Holds back ${targets(c.gatesFor)} until this fires`);
    if (Array.isArray(c.closeGate) && c.closeGate.length) add('close', 'Close gate', `Closes when ${rowsText(c.closeGate)}`);
    const closedBy = node.closes.filter(cl => cl.kind === 'closesFor' && cl.source !== node.key && !(Array.isArray(c.closeGate) && cl.source?.startsWith('@')));
    if (closedBy.length) add('close', 'Closed by', `${and(closedBy.map(cl => nameOf(cl.source)), 'or')} when it fires`);
    if (Array.isArray(c.closesFor) && c.closesFor.length) add('close', 'Closes for', `When it fires, closes ${targets(c.closesFor)}`);
    if (c.glue?.mode === 'ride') add('glue', 'Glue', `Rides along with ${idName(c.glue.host)}: fires when it fires`);
    if (c.glue?.mode === 'hold') add('glue', 'Glue', node.closes.some(cl => cl.kind !== 'once')
        ? 'Holds: once fired it stays on until its close gate'
        : 'Holds: once fired it stays on; nothing ends it yet');
    const riders = (model.riders?.get(node.key) ?? []).map(nameOf);
    if (riders.length) add('glue', 'Ridden by', `${and(riders)} ${riders.length === 1 ? 'rides' : 'ride'} along when it fires`);
    if (Array.isArray(c.switch) && c.switch.length) add('close', 'Switch', c.dice === true ? `A fork that rolls dice: when it first fires, one of ${and(c.switch.map(idName), 'or')} is picked at random` : `A fork: only one of ${and(c.switch.map(idName))} can follow`);
    const fork = node.closes.filter(cl => cl.kind === 'switch').map(cl => nameOf(cl.source));
    if (fork.length) add('close', 'Switch path', `Closes when ${and(fork, 'or')} fires: only one path of the fork can follow`);
    if (Array.isArray(c.masks) && c.masks.length) {
        add('mask', 'Masks', c.masks.filter(isObject).map(m => `${m.name}${Array.isArray(m.gate) && m.gate.length ? ` (when ${rowsText(m.gate)})` : ''}`).join('; '));
    }
    if (node.packs.length) add('pack', 'Packs', `In ${node.packs.map(p => `#${p}`).join(', ')}`);
    if (node.once) add('close', 'Once', 'Fires one time, then closes');
    if (node.by) add('by', 'Who triggers', node.by === 'user' ? 'Only your messages trigger it' : 'Only the character\'s replies trigger it');
    return lines;
}

/** The folded header: the labels in one line. */
export const logicSummary = lines => [...new Set(lines.map(l => l.label))].join(', ');

/**
 * "Closed in this chat by …" for a closed entry (D18), from the state's `by`.
 * @param {string} by e.g. 'closesFor:Book/mill', 'switch:Book/ridge', 'closeGate', 'once'
 * @param {(key: string) => string | null} nameOf the name of a loaded entry or greeting, null if it is gone
 */
export function closedText(by, nameOf) {
    if (by === 'closeGate') return 'its close gate';
    if (by === 'once') return 'Once, after it fired';
    if (by === 'earlier version') return 'an earlier version of WI Hero';
    const m = /^(closesFor|switch|dice):(.+)$/.exec(String(by ?? ''));
    const name = m ? nameOf(m[2]) : null;
    if (m?.[1] === 'dice') return name ? `the dice, which picked ${name}` : 'the dice';
    return name ?? 'a rule that no longer exists';
}
