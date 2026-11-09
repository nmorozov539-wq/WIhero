// Draws a set of fixture scenes with the engine and writes gallery.html (and gallery-sheet.svg,
// a fixed-colour copy for quick previews). Run: node tools/link-gallery.mjs
import { writeFileSync } from 'node:fs';
import { createLinkEngine } from '../src/link-engine.js';

const W = 360, H = 220;

const card = (id, x, y, w, h) => ({ id, x, y, w, h });
// A port on a side of a card; t places it along that side (0..1).
const port = (r, side, t = 0.5) => ({
    x: side === 'left' ? r.x : side === 'right' ? r.x + r.w : r.x + r.w * t,
    y: side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : r.y + r.h * t,
    n: side,
    card: r.id,
});

const A = (x, y, w = 60, h = 60) => card('A', x, y, w, h);
const B = (x, y, w = 60, h = 60) => card('B', x, y, w, h);

const scenes = [
    { title: 'Aligned, facing', cards: [A(20, 80), B(280, 80)], links: (c) => [['a', port(c[0], 'right'), port(c[1], 'left')]] },
    { title: 'Offset, facing: one S', cards: [A(20, 30), B(280, 130)], links: (c) => [['a', port(c[0], 'right'), port(c[1], 'left')]] },
    { title: 'Right into top', cards: [A(20, 30, 70, 50), B(240, 120, 70, 60)], links: (c) => [['a', port(c[0], 'right'), port(c[1], 'top')]] },
    { title: 'Close cards: short leaders', cards: [A(20, 90, 60, 50), B(92, 105, 60, 50)], links: (c) => [['a', port(c[0], 'right'), port(c[1], 'left')]] },
    { title: 'Bottom into top', cards: [A(40, 20, 80, 50), B(220, 140, 80, 50)], links: (c) => [['a', port(c[0], 'bottom'), port(c[1], 'top')]] },
    { title: 'Source faces away', cards: [A(160, 80), B(290, 80)], links: (c) => [['a', port(c[0], 'left'), port(c[1], 'left')]] },
    { title: 'Both face away', cards: [A(150, 80), B(250, 80)], links: (c) => [['a', port(c[0], 'left'), port(c[1], 'right')]] },
    { title: 'Overlapping cards: straight fallback', cards: [A(100, 60, 100, 80), B(160, 100, 100, 80)], links: (c) => [['a', port(c[0], 'right'), port(c[1], 'left')]] },
    {
        title: 'Fan of three',
        cards: [A(20, 70, 60, 80), card('B1', 280, 10, 60, 50), card('B2', 280, 85, 60, 50), card('B3', 280, 160, 60, 50)],
        links: (c) => [
            ['f1', port(c[0], 'right', 0.25), port(c[1], 'left')],
            ['f2', port(c[0], 'right', 0.5), port(c[2], 'left')],
            ['f3', port(c[0], 'right', 0.75), port(c[3], 'left')],
        ],
    },
];

const LINK_COLORS = ['LINK1', 'LINK2', 'LINK3'];

function panel(scene, c) {
    const e = createLinkEngine();
    e.setObstacles(scene.cards);
    const defs = scene.links(scene.cards).map(([id, from, to]) => ({ id, from, to }));
    e.layout(defs);
    let out = '';
    for (const r of scene.cards) {
        out += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="${c.card}" stroke="${c.cardLine}"/>`;
    }
    defs.forEach((def, i) => {
        const p = e.path(def.id);
        const col = c[LINK_COLORS[i % 3]];
        out += `<path d="${p.d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
        const { x: tx, y: ty } = p.endTangent;
        const { x: ex, y: ey } = def.to;
        // Arrowhead drawn from the engine's end tangent, to check that heads line up.
        out += `<path d="M${ex} ${ey}l${-tx * 9 - ty * 4.5} ${-ty * 9 + tx * 4.5}l${ty * 9} ${-tx * 9}z" fill="${col}"/>`;
        out += `<circle cx="${def.from.x}" cy="${def.from.y}" r="2.5" fill="${col}"/>`;
    });
    return out;
}

const light = { card: '#ecebe6', cardLine: '#b9b6ab', LINK1: '#2f6f8f', LINK2: '#b5563b', LINK3: '#5d7f3a', ink: '#23221e', paper: '#faf9f6' };
const dark = { card: 'var(--card)', cardLine: 'var(--cardLine)', LINK1: 'var(--l1)', LINK2: 'var(--l2)', LINK3: 'var(--l3)' };

const figures = scenes
    .map((s) => `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${s.title}">${panel(s, dark)}</svg><figcaption>${s.title}</figcaption></figure>`)
    .join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link engine gallery</title>
<style>
:root { --paper:#faf9f6; --ink:#23221e; --card:#ecebe6; --cardLine:#b9b6ab; --l1:#2f6f8f; --l2:#b5563b; --l3:#5d7f3a; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --paper:#1c1b19; --ink:#e8e6df; --card:#2b2a27; --cardLine:#4a4842; --l1:#6fb3d2; --l2:#e08a6e; --l3:#98bf6f; } }
body { margin:0; padding:16px; background:var(--paper); color:var(--ink); font:15px/1.4 system-ui, sans-serif; }
h1 { font-size:1.1rem; margin:0 0 12px; }
main { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap:14px; }
figure { margin:0; border:1px solid var(--cardLine); border-radius:6px; padding:8px; }
svg { width:100%; height:auto; display:block; }
figcaption { margin-top:4px; font-size:.85rem; }
</style></head>
<body><h1>Link engine, phase 2: leaders and one S-curve</h1>
<main>
${figures}
</main></body></html>
`;

const cols = 3;
const sheetBody = scenes
    .map((s, i) => {
        const x = (i % cols) * (W + 10), y = Math.floor(i / cols) * (H + 36);
        return `<g transform="translate(${x} ${y})"><rect width="${W}" height="${H}" fill="${light.paper}" stroke="${light.cardLine}"/>${panel(s, light)}<text x="6" y="${H + 16}" font-size="13" fill="${light.ink}" font-family="sans-serif">${s.title}</text></g>`;
    })
    .join('');
const rows = Math.ceil(scenes.length / cols);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * (W + 10)}" height="${rows * (H + 36)}"><rect width="100%" height="100%" fill="#fff"/>${sheetBody}</svg>`;

writeFileSync(new URL('./link-gallery.html', import.meta.url), html);
writeFileSync(new URL('./link-gallery-sheet.svg', import.meta.url), sheet);
console.log(`wrote gallery.html and gallery-sheet.svg (${scenes.length} scenes)`);
