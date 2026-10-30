// The workspace graph: nodes and links for one book, built from the engine's model. Pure, no DOM.
// A node is an entry, a #label hub, or a mask pill docked beside its entry. Links carry a type:
//   gate, labelSource (#label → entry), switch, gatesFor, closes, endsGlue, member (entry → its #label),
//   mask (entry → its pill), maskGate (→ pill).
import { FIELD, UI_FIELDS, entryKey } from './engine.js';
import { folderOf } from './bulk.js';

export const maskKey = (key, name) => `${key}#mask:${name}`;
export const labelKey = name => `#${name}`;

/** Whether an entry's config does more than file it (folder, color). */
const gated = entry => {
    const config = entry?.[FIELD];
    return !!config && typeof config === 'object' && !Object.keys(config).every(k => UI_FIELDS.includes(k));
};

/**
 * @param {object[]} entries The book's entries, with `world` set.
 * @param {object} model buildModel() of the loaded entries plus this book.
 * @param {string} book The book's name.
 * @returns {{ nodes: Map<string, object>, links: object[], unlinked: object[] }}
 *   `unlinked` are the book's entries that aren't on the graph (no config, or config but no links).
 */
export function buildGraph(entries, model, book) {
    const nodes = new Map();
    const links = [];
    const add = node => { if (!nodes.has(node.key)) nodes.set(node.key, node); return nodes.get(node.key); };
    const entryNode = mnode => add({
        key: mnode.key, kind: 'entry', id: mnode.id, uid: mnode.uid, world: mnode.world, title: mnode.label,
        external: mnode.world !== book, folder: '', color: '', node: mnode,
    });
    const byWorldUid = new Map(entries.map(e => [entryKey(e), e]));
    /** Node key a reference stands for, creating its hub or (for another book's entry) its node. */
    const ref = r => {
        if (r.startsWith('#')) {
            const name = r.slice(1);
            if (!model.labels?.has(name)) return null;
            return add({ key: labelKey(name), kind: 'label', id: r, title: r, members: model.labels.get(name) }).key;
        }
        const target = model.nodes.get(r);
        return target ? entryNode(target).key : null;
    };
    const link = (from, to, type) => { if (from && to && from !== to) links.push({ from, to, type }); };

    for (const entry of entries) {
        if (!gated(entry)) continue;
        const mnode = model.byKey.get(entryKey(entry));
        if (!mnode) continue;
        const node = entryNode(mnode);
        node.folder = folderOf(entry);
        node.color = entry[FIELD]?.color ?? '';
        node.content = entry.content ?? '';
        node.keys = entry.key ?? [];
    }
    for (const node of [...nodes.values()]) {
        if (node.kind !== 'entry' || node.external) continue;
        const m = node.node;
        for (const g of m.gates) link(ref(g), node.key, g.startsWith('#') ? 'labelSource' : 'gate');
        for (const p of m.switch) link(node.key, ref(p), 'switch');
        for (const t of m.gatesFor) link(node.key, ref(t), 'gatesFor');
        for (const t of m.closes) link(node.key, ref(t), 'closes');
        for (const r of m.glue ? [...m.glue.closeWhenFired, ...m.glue.closeWhenAllFired] : []) link(ref(r), node.key, 'endsGlue');
        for (const name of m.labels) link(node.key, ref(`#${name}`), 'member');
        for (const mask of m.masks) {
            const pill = add({ key: maskKey(node.key, mask.name), kind: 'mask', id: mask.name, title: mask.name, owner: node.key, mask });
            link(node.key, pill.key, 'mask');
            for (const g of mask.gates) link(ref(g), pill.key, 'maskGate');
        }
    }
    const touched = new Set(links.flatMap(l => [l.from, l.to]));
    for (const node of nodes.values()) {
        if (node.kind === 'entry' && !node.external) node.content ??= byWorldUid.get(node.key)?.content ?? '';
    }
    const unlinked = entries.filter(e => !touched.has(entryKey(e)));
    for (const e of unlinked) nodes.delete(entryKey(e));
    return { nodes, links, unlinked };
}

/**
 * The graph with groups folded into one node each: '#label' (its members) or 'folder:Path' (subfolders included).
 * Links are moved onto the group node; links inside a group and repeats are dropped.
 */
export function collapse(graph, groups) {
    if (!groups?.size) return graph;
    const owner = new Map();
    const nodes = new Map(graph.nodes);
    for (const group of groups) {
        const isLabel = group.startsWith('#');
        const members = [...graph.nodes.values()].filter(n => n.kind === 'entry' && (isLabel
            ? n.node.labels.includes(group.slice(1))
            : n.folder === group.slice(7) || n.folder.startsWith(`${group.slice(7)}/`)));
        if (!members.length) continue;
        const key = `group:${group}`;
        nodes.set(key, { key, kind: 'group', id: group, title: isLabel ? group : group.slice(7), count: members.length });
        for (const m of members) {
            owner.set(m.key, key);
            nodes.delete(m.key);
        }
        // A label's hub folds into the group too.
        if (isLabel) { owner.set(labelKey(group.slice(1)), key); nodes.delete(labelKey(group.slice(1))); }
    }
    for (const node of graph.nodes.values()) {
        if (node.kind === 'mask' && owner.has(node.owner)) { owner.set(node.key, owner.get(node.owner)); nodes.delete(node.key); }
    }
    const seen = new Set();
    const links = [];
    for (const l of graph.links) {
        const from = owner.get(l.from) ?? l.from;
        const to = owner.get(l.to) ?? l.to;
        const id = `${from}>${to}>${l.type}`;
        if (from === to || seen.has(id)) continue;
        seen.add(id);
        links.push({ ...l, from, to });
    }
    return { ...graph, nodes, links };
}

/** The part of the graph within `depth` links of a node, either direction (Obsidian's local graph). */
export function neighborhood(graph, key, depth = 1) {
    if (!graph.nodes.has(key)) return graph;
    const keep = new Set([key]);
    let frontier = [key];
    for (let d = 0; d < depth; d++) {
        const next = [];
        for (const l of graph.links) {
            for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) {
                if (frontier.includes(a) && !keep.has(b)) { keep.add(b); next.push(b); }
            }
        }
        frontier = next;
    }
    // Masks stay with their entry.
    for (const n of graph.nodes.values()) if (n.kind === 'mask' && keep.has(n.owner)) keep.add(n.key);
    return {
        ...graph,
        nodes: new Map([...graph.nodes].filter(([k]) => keep.has(k))),
        links: graph.links.filter(l => keep.has(l.from) && keep.has(l.to)),
    };
}
