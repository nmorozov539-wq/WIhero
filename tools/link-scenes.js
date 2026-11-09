// Real WI Hero canvases as link engine input: a book is laid out with the canvas code, and its cards, mask stacks
// and pack frames become obstacles, its links become defs. Used by the link engine tests and the gallery.
// Reads src/ui/canvas-graph.js; changes nothing there.
import fs from 'node:fs';
import { CH, CW, LR, TB, buildGraph, canvasBook, canvasSet, computePorts, layout, nodeRects, withFrames } from '../src/ui/canvas-graph.js';

const SIDE = { t: 'top', b: 'bottom', l: 'left', r: 'right' };

export function bookScene(file, dir = TB) {
    const data = JSON.parse(fs.readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
    const m = canvasBook(data);
    const g0 = buildGraph(m);
    const ids = canvasSet(m, g0, []);
    const g = withFrames(m, g0, ids);
    const pos = layout(m, g, ids, { dir });
    const R = nodeRects(m, g, ids, pos);
    const P = computePorts(g, R, {}, { dir });

    const obstacles = [];
    const extra = [];
    for (const r of R.values()) {
        if (r.pack) obstacles.push({ id: r.key, x: r.x, y: r.y, w: r.w, h: r.h, pass: 'members', members: new Set(r.members), pack: true });
        else obstacles.push({ id: r.key, x: r.x, y: r.y, w: r.w, h: r.h });
        if (!r.e?.masks?.length) continue;
        // Mask layers and their ‹ › control, as canvas.js draws them.
        const n = Math.min(2, r.e.masks.length);
        const stack = { id: `${r.key}#stack`, x: r.x, y: r.y - 6 * n, w: CW + 6 * n, h: CH };
        const bottomTaken = [...(P.get(r.key)?.values() ?? [])].some(p => p.side === 'b');
        const nav = bottomTaken ? { x: r.x + CW + 6 * n + 8, y: r.y + CH / 2 - 36, w: 26, h: 72 } : { x: r.x + CW / 2 - 44, y: r.y + CH + 10, w: 88, h: 24 };
        extra.push(stack, { id: `${r.key}#nav`, ...nav });
    }
    // The stack sits behind its own card: links of that card may touch it.
    obstacles.push(...extra);

    const defs = [];
    for (const x of g.edges) {
        const a = P.get(x.from)?.get(x.fromPort);
        const b = P.get(x.to)?.get(x.port);
        if (!a || !b) continue;
        const id = `${x.from}>${x.fromPort}>${x.to}>${x.port}${x.mask != null ? `@${x.mask}` : ''}`;
        if (defs.some(d => d.id === id)) continue;
        const owner = new Set([`${x.from}#stack`, `${x.to}#stack`]);
        defs.push({ id, kind: x.kind, from: { x: a.x, y: a.y, n: SIDE[a.side], card: x.from }, to: { x: b.x, y: b.y, n: SIDE[b.side], card: x.to }, owner });
    }
    return { obstacles, defs, dir };
}

export { LR, TB };
