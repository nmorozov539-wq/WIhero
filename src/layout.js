// Layered auto layout for the workspace graph, left to right. Pure, no DOM.
// A small Sugiyama-style pass: break loops, rank by longest path, order each column by the barycentre of its
// neighbours, then place. Mask pills aren't laid out: they dock under their entry. Computed once per change.

export const CARD = Object.freeze({ w: 176, h: 56, pill: 28, pillGap: 4, col: 248, gap: 28 });

/** Links that decide columns. Masks dock under their entry and don't take part. */
const LAYERED = new Set(['gate', 'labelSource', 'switch', 'gatesFor', 'closes', 'endsGlue', 'member']);

/**
 * @param {{ nodes: Map<string, object>, links: object[] }} graph
 * @returns {{ pos: Map<string, { x: number, y: number, w: number, h: number }>, width: number, height: number }}
 */
export function layout(graph) {
    const keys = [...graph.nodes.values()].filter(n => n.kind !== 'mask').map(n => n.key);
    const index = new Map(keys.map((k, i) => [k, i]));
    const out = new Map(keys.map(k => [k, []]));
    // A gate into a mask pill places the pill's entry after the gate's source, so the link runs forward.
    const owner = key => graph.nodes.get(key)?.kind === 'mask' ? graph.nodes.get(key).owner : key;
    for (const l of graph.links) {
        const to = l.type === 'maskGate' ? owner(l.to) : l.to;
        if ((LAYERED.has(l.type) || l.type === 'maskGate') && index.has(l.from) && index.has(to) && l.from !== to) out.get(l.from).push(to);
    }

    // Break loops: a depth-first search reverses every link back onto its own path.
    const edges = [];
    const state = new Map();
    const visit = k => {
        state.set(k, 1);
        for (const t of out.get(k)) {
            if (state.get(t) === 1) edges.push([t, k]);
            else {
                edges.push([k, t]);
                if (!state.has(t)) visit(t);
            }
        }
        state.set(k, 2);
    };
    for (const k of keys) if (!state.has(k)) visit(k);

    // Rank: the longest path from a source.
    const preds = new Map(keys.map(k => [k, []]));
    const succs = new Map(keys.map(k => [k, []]));
    for (const [a, b] of edges) { preds.get(b).push(a); succs.get(a).push(b); }
    const rank = new Map();
    const rankOf = k => {
        if (rank.has(k)) return rank.get(k);
        rank.set(k, 0); // guards against a loop the search above missed
        const r = preds.get(k).length ? Math.max(...preds.get(k).map(rankOf)) + 1 : 0;
        rank.set(k, r);
        return r;
    };
    keys.forEach(rankOf);

    // Columns, then a few barycentre sweeps: each node moves towards the average place of its neighbours.
    const columns = [];
    for (const k of keys) (columns[rank.get(k)] ??= []).push(k);
    const place = new Map();
    const renumber = () => columns.forEach(col => col.forEach((k, i) => place.set(k, i)));
    renumber();
    const sweep = (col, neighbours) => {
        const centre = k => {
            const ns = neighbours.get(k).filter(n => place.has(n));
            return ns.length ? ns.reduce((s, n) => s + place.get(n), 0) / ns.length : place.get(k);
        };
        const scored = col.map(k => [k, centre(k), index.get(k)]);
        scored.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
        col.splice(0, col.length, ...scored.map(s => s[0]));
    };
    for (let i = 0; i < 4; i++) {
        for (let c = 1; c < columns.length; c++) { sweep(columns[c], preds); renumber(); }
        for (let c = columns.length - 2; c >= 0; c--) { sweep(columns[c], succs); renumber(); }
    }

    // Place: a column's cards stack top to bottom, each with room for its docked mask pills.
    const pills = new Map();
    for (const n of graph.nodes.values()) if (n.kind === 'mask') (pills.get(n.owner) ?? pills.set(n.owner, []).get(n.owner)).push(n.key);
    const pos = new Map();
    let height = 0;
    columns.forEach((col, c) => {
        let y = 0;
        for (const k of col ?? []) {
            const x = c * CARD.col;
            pos.set(k, { x, y, w: CARD.w, h: CARD.h });
            let below = y + CARD.h;
            for (const p of pills.get(k) ?? []) {
                pos.set(p, { x: x + 16, y: below + CARD.pillGap, w: CARD.w - 16, h: CARD.pill });
                below += CARD.pillGap + CARD.pill;
            }
            y = below + CARD.gap;
        }
        height = Math.max(height, y - CARD.gap);
    });
    return { pos, width: Math.max(0, columns.length * CARD.col - (CARD.col - CARD.w)), height: Math.max(0, height) };
}
