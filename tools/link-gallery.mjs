// Draws scenes with the link engine and writes tools/link-gallery.html: small fixture scenes, then the example
// books laid out by the real canvas code, today's grid router beside the engine. Run: node tools/link-gallery.mjs
import { writeFileSync } from 'node:fs';
import { createLinkEngine } from '../src/link-engine/index.js';
import { rounded } from '../src/ui/canvas-graph.js';
import { LR, TB, bookScene } from './link-scenes.js';

const card = (id, x, y, w = 60, h = 60) => ({ id, x, y, w, h });
// A port on a side of a card; t places it along that side (0..1).
const port = (r, side, t = 0.5) => ({
    x: side === 'left' ? r.x : side === 'right' ? r.x + r.w : r.x + r.w * t,
    y: side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : r.y + r.h * t,
    n: side,
    card: r.id,
});
const one = (a, as, b, bs) => c => [['a', port(c[a], as), port(c[b], bs)]];

const scenes = [
    { title: 'Offset, facing: one S', cards: [card('A', 20, 30), card('B', 280, 130)], links: one(0, 'right', 1, 'left') },
    { title: 'Right into top', cards: [card('A', 20, 30, 70, 50), card('B', 240, 120, 70, 60)], links: one(0, 'right', 1, 'top') },
    { title: 'Close cards: short leaders', cards: [card('A', 20, 90, 60, 50), card('B', 92, 105, 60, 50)], links: one(0, 'right', 1, 'left') },
    { title: 'A card in the way', cards: [card('A', 20, 80), card('B', 280, 80), card('M', 150, 60, 60, 100)], links: one(0, 'right', 1, 'left') },
    { title: 'Skip a card in the column', cards: [card('A', 130, 10, 100, 40), card('M', 130, 90, 100, 40), card('B', 130, 170, 100, 40)], links: one(0, 'bottom', 2, 'top') },
    { title: 'Source faces away', cards: [card('A', 160, 80), card('B', 290, 80)], links: one(0, 'left', 1, 'left') },
    { title: 'Both face away', cards: [card('A', 120, 80), card('B', 220, 80)], links: one(0, 'left', 1, 'right') },
    { title: 'A wall of cards', cards: [card('A', 20, 80), card('B', 290, 80), card('M1', 150, 10, 50, 60), card('M2', 150, 80, 50, 60), card('M3', 150, 150, 50, 60)], links: one(0, 'right', 1, 'left') },
    {
        title: 'Fan of three',
        cards: [card('A', 20, 70, 60, 80), card('B1', 280, 10, 60, 50), card('B2', 280, 85, 60, 50), card('B3', 280, 160, 60, 50)],
        links: c => [['f1', port(c[0], 'right', 0.25), port(c[1], 'left')], ['f2', port(c[0], 'right', 0.5), port(c[2], 'left')], ['f3', port(c[0], 'right', 0.75), port(c[3], 'left')]],
    },
];

const COLORS = ['var(--l1)', 'var(--l2)', 'var(--l3)'];
const KIND = { open: 'var(--l1)', close: 'var(--l2)', ride: 'var(--l3)' };

const head = (d, col) => {
    const { x: tx, y: ty } = d.t;
    return `<path d="M${d.x} ${d.y}l${-tx * 9 - ty * 4.5} ${-ty * 9 + tx * 4.5}l${ty * 9} ${-tx * 9}z" fill="${col}"/>`;
};
const rectSvg = r => (r.pack
    ? `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="none" stroke="var(--cardLine)" stroke-dasharray="4 4"/>`
    : r.id.includes('#') ? `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="var(--deco)" stroke="none"/>`
        : `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="var(--card)" stroke="var(--cardLine)"/>`);

function small(scene) {
    const e = createLinkEngine();
    e.setObstacles(scene.cards);
    const defs = scene.links(scene.cards).map(([id, from, to]) => ({ id, from, to }));
    e.layout(defs);
    let out = scene.cards.map(rectSvg).join('');
    defs.forEach((def, i) => {
        const p = e.path(def.id);
        const col = COLORS[i % 3];
        out += `<path d="${p.d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
        out += head({ x: def.to.x, y: def.to.y, t: p.endTangent }, col);
    });
    return `<figure><svg viewBox="0 0 360 220">${out}</svg><figcaption>${scene.title}</figcaption></figure>`;
}

function book(file, dir) {
    const s = bookScene(file, dir);
    const e = createLinkEngine();
    e.setObstacles(s.obstacles);
    const t = performance.now();
    e.layout(s.defs);
    const ms = performance.now() - t;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const r of s.obstacles) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    for (const d of s.defs) for (const pts of [e.polyline(d.id, 4), (s.old.get(d.id) ?? []).flat()]) {
        for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    }
    const vb = `${x0 - 40} ${y0 - 40} ${x1 - x0 + 80} ${y1 - y0 + 80}`;
    const cards = s.obstacles.map(rectSvg).join('');
    let a = ''; let b = '';
    for (const d of s.defs) {
        const col = KIND[d.kind] ?? 'var(--l1)';
        const dash = d.kind === 'close' ? ' stroke-dasharray="6 5"' : '';
        const pts = s.old.get(d.id);
        if (pts) a += `<path d="${rounded(pts)}" fill="none" stroke="${col}" stroke-width="2"${dash}/>`;
        const p = e.path(d.id);
        b += `<path d="${p.d}" fill="none" stroke="${p.clear ? col : 'red'}" stroke-width="2"${dash}/>`;
        b += head({ x: d.to.x, y: d.to.y, t: p.endTangent }, col);
    }
    const st = e.stats();
    return `<h2>${file}, ${dir === TB ? 'top to bottom (phone)' : 'left to right (desktop)'}</h2>
<p>${s.defs.length} links, ${st.routes} routed around something, ${ms.toFixed(1)} ms</p>
<div class="pair"><figure><svg viewBox="${vb}">${cards}${a}</svg><figcaption>Today: grid router</figcaption></figure>
<figure><svg viewBox="${vb}">${cards}${b}</svg><figcaption>Link engine</figcaption></figure></div>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link engine gallery</title>
<style>
:root { --paper:#faf9f6; --ink:#23221e; --card:#ecebe6; --cardLine:#b9b6ab; --deco:#dcd6c8; --l1:#2f6f8f; --l2:#b5563b; --l3:#5d7f3a; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --paper:#1c1b19; --ink:#e8e6df; --card:#2b2a27; --cardLine:#4a4842; --deco:#3a3833; --l1:#6fb3d2; --l2:#e08a6e; --l3:#98bf6f; } }
body { margin:0; padding:16px; background:var(--paper); color:var(--ink); font:15px/1.4 system-ui, sans-serif; }
h1 { font-size:1.2rem; margin:0 0 12px; } h2 { font-size:1rem; margin:24px 0 4px; } p { margin:0 0 8px; font-size:.9rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap:14px; }
.pair { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap:14px; }
figure { margin:0; border:1px solid var(--cardLine); border-radius:6px; padding:8px; }
svg { width:100%; height:auto; display:block; }
figcaption { margin-top:4px; font-size:.85rem; }
</style></head>
<body><h1>Link engine gallery</h1>
<h2>Fixtures</h2>
<div class="grid">${scenes.map(small).join('\n')}</div>
${book('WIHero-Sample.json', TB)}
${book('WIHero-Sample.json', LR)}
${book('WIHero-N1.json', TB)}
</body></html>
`;

writeFileSync(new URL('./link-gallery.html', import.meta.url), html);
console.log('wrote tools/link-gallery.html');
