// The coarse search behind a routed link: A* on a lattice, cards as walls. The engine only uses its corners;
// the drawn curve is fitted through them afterwards. Buffers live on the grid and are reused between routes,
// because on a phone the garbage collector was a large share of routing (see canvas-graph.js).

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Covers the bounds with cells of size `step`; `count` holds how many grown obstacles cover each cell. */
export function makeGrid(bounds, step) {
    const x0 = Math.floor(bounds.x / step) * step;
    const y0 = Math.floor(bounds.y / step) * step;
    const W = Math.ceil((bounds.x + bounds.w - x0) / step) + 1;
    const H = Math.ceil((bounds.y + bounds.h - y0) / step) + 1;
    return { x0, y0, W, H, step, count: new Uint16Array(W * H), search: null };
}

/** Adds (by = 1) or takes away (by = -1) one obstacle, grown by pad, from the cell counts. */
export function mark(grid, r, pad, by) {
    const { x0, y0, W, H, step, count } = grid;
    const a = Math.max(0, Math.floor((r.x - pad - x0) / step) + 1);
    const b = Math.min(W - 1, Math.ceil((r.x + r.w + pad - x0) / step) - 1);
    const c = Math.max(0, Math.floor((r.y - pad - y0) / step) + 1);
    const d = Math.min(H - 1, Math.ceil((r.y + r.h + pad - y0) / step) - 1);
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) count[j * W + i] += by;
}

export const inside = (grid, x, y) => x >= grid.x0 && y >= grid.y0 && x <= grid.x0 + (grid.W - 1) * grid.step && y <= grid.y0 + (grid.H - 1) * grid.step;

/** A binary min-heap of (state, priority) on flat arrays. */
function heap() {
    const xs = [];
    const ps = [];
    let n = 0;
    return {
        push(x, p) {
            let i = n++;
            while (i > 0) { const q = (i - 1) >> 1; if (ps[q] <= p) break; xs[i] = xs[q]; ps[i] = ps[q]; i = q; }
            xs[i] = x; ps[i] = p;
        },
        pop() {
            const top = xs[0];
            const x = xs[--n]; const p = ps[n];
            let i = 0;
            for (;;) {
                const l = 2 * i + 1; if (l >= n) break;
                const r = l + 1; const m = r < n && ps[r] < ps[l] ? r : l;
                if (ps[m] >= p) break;
                xs[i] = xs[m]; ps[i] = ps[m]; i = m;
            }
            if (n) { xs[i] = x; ps[i] = p; }
            return top;
        },
        get size() { return n; },
        clear() { n = 0; },
    };
}

function buffers(grid) {
    if (!grid.search) {
        const size = grid.W * grid.H * 4;
        grid.search = { cost: new Float32Array(size), prev: new Int32Array(size), stamp: new Uint32Array(size), gen: 0, h: heap() };
    }
    const b = grid.search;
    if (++b.gen === 0xffffffff) { b.stamp.fill(0); b.gen = 1; }
    b.h.clear();
    return b;
}

const dirOf = (v) => (Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] >= 0 ? 0 : 2) : (v[1] >= 0 ? 1 : 3));

/**
 * The corners of a lattice path from s to e, leaving s along `sn` and arriving at e travelling along `en`,
 * or null. Each turn costs `bend` cells, so the search prefers few long runs. The two end cells are always open.
 */
export function search(grid, s, sn, e, en, { bend = 4, limit = 80000 } = {}) {
    const { x0, y0, W, H, step, count } = grid;
    const si = Math.round((s[0] - x0) / step); const sj = Math.round((s[1] - y0) / step);
    const ei = Math.round((e[0] - x0) / step); const ej = Math.round((e[1] - y0) / step);
    if (si < 0 || sj < 0 || si >= W || sj >= H || ei < 0 || ej < 0 || ei >= W || ej >= H) return null;
    const S0 = sj * W + si; const E0 = ej * W + ei;
    const sd = dirOf(sn); const ed = dirOf(en);
    const { cost, prev, stamp, gen, h } = buffers(grid);
    const st = S0 * 4 + sd;
    stamp[st] = gen; cost[st] = 0; prev[st] = -1; h.push(st, 0);
    let found = -1;
    let n = 0;
    while (h.size && n++ < limit) {
        const s1 = h.pop(); const c = s1 >> 2; const d = s1 & 3; const cc = cost[s1];
        if (c === E0) { found = s1; break; }
        const ci = c % W; const cj = (c / W) | 0;
        for (let nd = 0; nd < 4; nd++) {
            if (nd === ((d + 2) & 3)) continue; // no doubling back
            const ni = ci + DIRS[nd][0]; const nj = cj + DIRS[nd][1];
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const k = nj * W + ni;
            if (k !== E0 && count[k]) continue;
            let nc = cc + 1 + (nd !== d ? bend : 0);
            if (k === E0 && nd !== ed) nc += nd === ((ed + 2) & 3) ? 3 * bend : bend;
            const ns = k * 4 + nd;
            if (stamp[ns] !== gen || nc < cost[ns]) {
                stamp[ns] = gen; cost[ns] = nc; prev[ns] = s1;
                // Manhattan distance, plus one turn when the end is off both axes (still a lower bound, so still A*).
                const hi = Math.abs(ni - ei); const hj = Math.abs(nj - ej);
                h.push(ns, nc + hi + hj + (hi && hj ? bend : 0));
            }
        }
    }
    if (found < 0) return null;
    // Walk back, keeping only the cells where the direction changes.
    const out = [];
    let last = -1;
    for (let q = found; q >= 0; q = prev[q]) {
        const c = q >> 2; const d = q & 3;
        if (d !== last || prev[q] < 0) out.push([x0 + (c % W) * step, y0 + ((c / W) | 0) * step]);
        last = d;
    }
    out.reverse();
    // Pinned to the true ends, not their cells.
    out[0] = [s[0], s[1]];
    if (out.length === 1) out.push([e[0], e[1]]); else out[out.length - 1] = [e[0], e[1]];
    return out;
}
