// Canvas mode: where cards sit when the user arranges them, and what drawing a link does to the book. Pure, no DOM.
// Positions live in extension settings (settings.canvas[book]), never on entries, so moving a card never
// changes an entry or its timers. Links do change entries, like any edit.
import { FIELD, buildModel } from './engine.js';
import { CARD } from './layout.js';
import { newId } from './entry-model.js';

/** The canvas of a book in settings, created empty. */
export function canvasOf(settings, book) {
    settings.canvas ??= {};
    const c = settings.canvas[book] ??= {};
    c.pos ??= {};
    c.boxes ??= {};
    c.areas ??= [];
    c.notes ??= [];
    return c;
}

/** The key a node's position is saved under: its id, which survives copying a book; else its uid; a hub by its label. */
export function placeKey(node) {
    if (node.kind === 'label' || node.kind === 'group') return node.key;
    return node.id ? `id:${node.id}` : `uid:${node.uid}`;
}

const PAD = 16;
const HEAD = 24;

/** The box around a label's members: their cards plus room for its name. */
export function boxAround(rects) {
    if (!rects.length) return null;
    const x = Math.min(...rects.map(r => r.x)) - PAD;
    const y = Math.min(...rects.map(r => r.y)) - PAD - HEAD;
    const right = Math.max(...rects.map(r => r.x + r.w)) + PAD;
    const bottom = Math.max(...rects.map(r => r.y + r.h)) + PAD;
    return { x, y, w: right - x, h: bottom - y };
}

/**
 * Where everything sits on the canvas: saved places first, the graph layout for the rest; mask pills docked
 * under their entry; a label hub becomes a box around its members (or where the user put it).
 * @returns {{ pos: Map, width: number, height: number }}
 */
export function canvasLayout(graph, auto, canvas) {
    const pos = new Map();
    for (const node of graph.nodes.values()) {
        if (node.kind === 'mask' || node.kind === 'label') continue;
        const saved = canvas.pos[placeKey(node)];
        const a = auto.pos.get(node.key);
        if (!a) continue;
        pos.set(node.key, saved ? { ...a, x: saved.x, y: saved.y } : { ...a });
    }
    const pills = new Map();
    for (const n of graph.nodes.values()) if (n.kind === 'mask') (pills.get(n.owner) ?? pills.set(n.owner, []).get(n.owner)).push(n.key);
    for (const [owner, keys] of pills) {
        const o = pos.get(owner);
        if (!o) continue;
        let below = o.y + o.h;
        for (const k of keys) {
            pos.set(k, { x: o.x + 16, y: below + CARD.pillGap, w: CARD.w - 16, h: CARD.pill });
            below += CARD.pillGap + CARD.pill;
        }
    }
    for (const node of graph.nodes.values()) {
        if (node.kind !== 'label') continue;
        const saved = canvas.boxes[node.key];
        const members = [...graph.nodes.values()].filter(n => n.kind === 'entry' && node.members.includes(n.id)).map(n => pos.get(n.key)).filter(Boolean);
        const box = saved ?? boxAround(members) ?? { ...auto.pos.get(node.key) };
        pos.set(node.key, { ...box, box: true });
    }
    const all = [...pos.values(), ...canvas.areas, ...canvas.notes];
    return {
        pos,
        width: Math.max(0, ...all.map(r => r.x + r.w)),
        height: Math.max(0, ...all.map(r => r.y + r.h)),
    };
}

/** Whether a point is inside a box. */
export const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * What a link drawn from one node onto another can mean.
 * @returns {{ type: string, label: string }[]}
 */
export function linkOptions(from, to) {
    const name = n => n.kind === 'label' ? n.title : n.kind === 'mask' ? `mask ${n.title}` : n.id ?? n.title;
    if (!from || !to || from.key === to.key) return [];
    if (from.kind === 'label' && to.kind === 'entry') return [{ type: 'gate', label: `Gate: ${name(to)} fires only after anything in ${name(from)}` }];
    if (from.kind === 'label' && to.kind === 'mask') return [{ type: 'maskGate', label: `Mask gate: ${name(to)} is used once anything in ${name(from)} fired` }];
    if (from.kind !== 'entry') return [];
    if (to.kind === 'label') {
        return [
            { type: 'gatesFor', label: `Gates for ${name(to)}: all of it waits for ${name(from)}` },
            { type: 'closes', label: `Closes ${name(to)}: ${name(from)} firing retires all of it` },
        ];
    }
    if (to.kind === 'mask') return [{ type: 'maskGate', label: `Mask gate: ${name(to)} is used once ${name(from)} fired` }];
    if (to.kind !== 'entry' || to.external) return [];
    const options = [
        { type: 'gate', label: `Gate: ${name(to)} fires only after ${name(from)}` },
        { type: 'closes', label: `Closes: ${name(from)} firing retires ${name(to)}` },
        { type: 'endsGlue', label: `Ends glue: ${name(to)} lets go when ${name(from)} fires` },
    ];
    if (from.node?.switch?.length) options.push({ type: 'switch', label: `Switch path: ${name(to)} becomes one of ${name(from)}'s paths` });
    return options;
}

/** Gives an entry an id if it has none, from its title, unique among `taken`. */
function ensureId(entry, taken) {
    entry[FIELD] ??= {};
    if (!entry[FIELD].id) {
        entry[FIELD].id = newId(entry, taken);
        taken.add(entry[FIELD].id);
    }
    return entry[FIELD].id;
}
const addTo = (list, value) => [...new Set([...(list ?? []), value])];

/**
 * Applies a drawn link to a book's data (in place).
 * @param {object} data The book's data.
 * @param {object} from, to Graph nodes (entry, label or mask).
 * @param {Set<string>} taken Ids in use.
 * @returns {number[]} Uids of the entries changed.
 */
export function applyLink(data, from, to, type, taken) {
    const entry = node => data.entries[node.kind === 'mask' ? ownerUid(node) : node.uid];
    const ownerUid = mask => Number(mask.owner.split('.').pop());
    const ref = node => node.kind === 'label' ? node.title : ensureId(entry(node), taken);
    const source = ref(from);
    if (type === 'gate') {
        const t = entry(to);
        ensureId(t, taken);
        t[FIELD].gates = addTo(t[FIELD].gates, source);
        return [t.uid];
    }
    if (type === 'maskGate') {
        const t = entry(to);
        const mask = t[FIELD]?.masks?.find(m => m.name === to.mask.name);
        if (mask) mask.gates = addTo(mask.gates, source);
        return [t.uid];
    }
    const s = entry(from);
    if (type === 'gatesFor' || type === 'closes') {
        s[FIELD][type] = addTo(s[FIELD][type], ref(to));
        return [s.uid];
    }
    if (type === 'switch') {
        s[FIELD].switch = addTo(s[FIELD].switch, ref(to));
        return [s.uid];
    }
    if (type === 'endsGlue') {
        const t = entry(to);
        ensureId(t, taken);
        const glue = t[FIELD].glue && typeof t[FIELD].glue === 'object' ? t[FIELD].glue : {};
        t[FIELD].glue = { ...glue, closeWhenFired: addTo(glue.closeWhenFired, source) };
        return [t.uid];
    }
    return [];
}

/** Adds or removes a label on an entry (in place). */
export function setLabel(entry, label, on, taken) {
    ensureId(entry, taken);
    const labels = new Set(entry[FIELD].labels ?? []);
    if (on) labels.add(label); else labels.delete(label);
    if (labels.size) entry[FIELD].labels = [...labels];
    else delete entry[FIELD].labels;
}

/**
 * Problems a change to a book would add for the entries it touches: the engine's own messages.
 * @param {object[]} others Loaded entries of other books.
 * @param {string} book
 * @param {object} before, after The book's data before and after.
 * @param {number[]} uids Entries the change touched.
 */
export function newProblems(others, book, before, after, uids) {
    const model = data => buildModel([...others, ...Object.values(data.entries).map(e => ({ ...e, world: book }))]);
    const keys = new Set(uids.map(uid => `${book}.${uid}`));
    const old = new Set(model(before).issues.filter(i => !i.warning).map(i => `${i.key} ${i.message}`));
    return model(after).issues.filter(i => !i.warning && keys.has(i.key) && !old.has(`${i.key} ${i.message}`)).map(i => `${i.id ?? i.label}: ${i.message}`);
}

/** Undo: the last few canvas states of a book. */
export function pushUndo(stack, canvas, limit = 20) {
    stack.push(JSON.stringify(canvas));
    if (stack.length > limit) stack.shift();
}
