// Times the link engine on a large made-up canvas, the way the canvas uses it: a full layout on load, then a
// relayout after one card is dragged and dropped. Run: node tools/link-bench.js
import { createLinkEngine } from '../src/link-engine/index.js';

export function bigScene({ cols = 8, rows = 15, links = 220, seed = 7 } = {}) {
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const cards = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cards.push({ id: `c${j}_${i}`, x: i * 228, y: j * 132, w: 168, h: 60 });
    const defs = [];
    for (let k = 0; k < links; k++) {
        const a = cards[Math.floor(rnd() * cards.length)];
        const near = cards.filter(c => c !== a && Math.abs(c.y - a.y) <= 3 * 132 && Math.abs(c.x - a.x) <= 3 * 228);
        const b = near[Math.floor(rnd() * near.length)];
        const down = b.y > a.y;
        const fx = a.x + 24 + 24 * Math.floor(rnd() * 6); const tx = b.x + 24 + 24 * Math.floor(rnd() * 6);
        defs.push({
            id: `l${k}`,
            from: { x: fx, y: down ? a.y + a.h : a.y, n: down ? 'bottom' : 'top', card: a.id },
            to: { x: tx, y: down ? b.y : b.y + b.h, n: down ? 'top' : 'bottom', card: b.id },
        });
    }
    return { cards, defs };
}

const time = (f, n = 5) => {
    const t = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return t[Math.floor(n / 2)];
};

if (import.meta.url === `file://${process.argv[1]}`) {
    const { cards, defs } = bigScene();
    const fullMs = time(() => { const e = createLinkEngine(); e.setObstacles(cards); e.layout(defs); });
    const e = createLinkEngine();
    e.setObstacles(cards);
    e.layout(defs);
    const moved = cards.map(c => (c.id === 'c7_3' ? { ...c, x: c.x + 36, y: c.y + 24 } : c));
    const movedDefs = defs.map(d => ({ ...d, from: d.from.card === 'c7_3' ? { ...d.from, x: d.from.x + 36, y: d.from.y + 24 } : d.from, to: d.to.card === 'c7_3' ? { ...d.to, x: d.to.x + 36, y: d.to.y + 24 } : d.to }));
    let changed = 0;
    let flip = false;
    const dropMs = time(() => {
        flip = !flip;
        e.setObstacles(flip ? moved : cards);
        changed = e.layout(flip ? movedDefs : defs).changed.length;
    });
    console.log(`${cards.length} cards, ${defs.length} links`);
    console.log(`link engine, full layout:     ${fullMs.toFixed(1)} ms (${e.stats().routes} of the first layout's links needed a route)`);
    console.log(`link engine, drop one card:   ${dropMs.toFixed(1)} ms (${changed} links redone)`);
}
