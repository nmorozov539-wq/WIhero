# Link engine

Smooth canvas links that go around cards. Built from the link engine handout (project files,
`wihero/link-engine-handout.md`). Lives on the `link-engine` branch, which is not merged. `src/ui/canvas.js` draws its links with it there; the
old grid router is still in `src/ui/canvas-graph.js`, unused by the canvas.

Code: `src/link-engine/` (pure: no DOM, no ST, no pieces). Tests: `test/link-engine.test.js`.
Tools: `node tools/link-gallery.js` (writes `tools/link-gallery.html`, today's router beside the engine on the
example books), `node tools/link-bench.js` (timings on a 120-card canvas).

## How a link is made

1. Each port gets a short leader along its outward normal, so heads line up.
2. If one S-curve between the leader ends is clear of every card, that's the link. Of the clear shapes tried,
   it takes the one that runs along other links the least (clean crossings).
3. Otherwise: an A* search on a 12px lattice finds a way round, string pulling cuts it to the corners it needs,
   runs that would sit on another link move over a lane, and the corners are rounded as wide as they can be
   without clipping a card.
4. A stored hand-made shape replaces 2 and 3, segment by segment; a segment that would enter a card is laid out
   automatically instead, unless it runs to a dot inside that card.

## API

```js
import { createLinkEngine, addDot, moveDot, removeDot, setSegment, reset, toLocal, toCanvas, crosses } from './src/link-engine/index.js';

const links = createLinkEngine({ grid: 12 });   // options: clearance, margin, stub, radius, laneGap, bend, tension, scales

links.setObstacles([{ id, x, y, w, h, pass?: 'never' | 'members', members?: Set }]);
links.layout([{
    id,
    from: { x, y, n, card? },     // n: 'left' | 'right' | 'top' | 'bottom' | [x, y] | { x, y }; card: obstacle id
    to:   { x, y, n, card? },
    via?: [{ x, y, n? }],         // junctions the link passes through (n = the way it travels)
    owner?: Set,                  // obstacle ids this link may enter
    shape?,                       // a stored hand-made shape, below
}]);                              // → { changed: [ids], removed: [ids] }: redraw only these

links.path(id);       // → { d, startTangent, endTangent, drawn: [per segment], clear }
links.polyline(id);   // → [x0, y0, x1, y1, …] flattened, for tests and hit areas
links.nearest(id, { x, y });  // → { segment, t, dist, x, y }
links.ends(id);       // → { from, to } the anchors a shape's dots are stored against
links.segmentD(id, i);  // → SVG d of segment i alone (the part picked in the editor)
links.midpoints(id);  // → [{ x, y }] halfway along each segment, where the ghost dots sit
```

A 'members' obstacle (a pack frame) lets in links whose end card is a member. `layout` redoes a link only when its
ends, via points, owner or shape change, or when an obstacle near it moved; everything else keeps its exact path.

## Shapes

Stored on the source card in the canvas settings, as the handout says, keyed `<port kind>><target key>`:

```json
{ "dots": [{ "u": 0.5, "v": 0.2 }], "segments": [{ "type": "curve" }, { "type": "arc", "flip": true, "tension": 0.6 }] }
```

- One segment more than dots. Types: `curve`, `arc`, `straight`, `step`. `flip` bows the other way; `tension` 0..1.
- Dots are in the frame of the two cards' centres (`u` along the line between them, `v` across it, in units of its
  length), so a shape stretches and turns when either card moves. `ends` below is `{ from, to }`, each the card's
  rectangle (the same rectangles passed to `setObstacles`).
- Edits are pure and return the new shape (or `null` = auto): `addDot(shape, segment, point, ends)`,
  `moveDot(shape, i, point, ends)`, `removeDot(shape, i)`, `setSegment(shape, i, { type, flip, tension })`, `reset()`.
- `toLocal(point, ends)` / `toCanvas(dot, ends)` convert.
- A shape and `via` don't mix: a shaped link ignores `via`.

## Shaping a link (the editor)

A tap on a line opens its strip, as before; an Opens, Closes or Glue (ride along) strip now also shapes the line.
Links into or out of one port run together near it, so where hit areas overlap a tap (or right-click) goes to the
line nearest the pointer, not the one drawn last: a short line under a longer one can still be picked.

- The other links fade; the picked one gets a band, a ghost dot halfway along each part, and its dots. Only those
  handles catch a drag (32px hit area on a phone, 18px with a mouse). A line itself still pans, picked or not.
- Drag a ghost dot to make a dot there, drag a dot to move it. With a mouse dots go on the grid (Alt: anywhere); on a
  phone a dot level with a neighbour snaps level, so a straight run stays straight. A dot inside a card outlines the
  card, dashed. The line is laid out again every frame of a drag (only it, and whatever lanes it moves, redraw).
- Tap a dot to pick it, tap it again quickly (double-click) to remove it. Tap a part of the line (or its ghost) to
  pick that part. Desktop: double-click the line to add a dot there.
- The strip's Shape row: Curve · Arc · Straight · Step, Flip and Bend (curve and arc), for the picked part or, with
  none picked, the whole line. Then Remove dot, Reset shape and the link's Remove on one row. Desktop keys: 1–4,
  X (flip), Delete (picked dot). Right-click a line: Shape link · Reset shape · Remove.
- Cancel puts the shape back with the rest of the book; a tap on empty canvas is Done.
- A card or a dot held within 32px of the view's edge scrolls the view, faster nearer the edge.
- Phones: a line just picked has its ghost dots panned into view above the strip.
- `e2e/shape.mjs` checks all of this in the desktop harness (1366 × 768 and a phone).

## Not done yet

- Bundling is lanes side by side; links heading the same way don't merge into one line (manual bundling: not now).

The old grid router (`route`, `makeGrid` in `canvas-graph.js`) is gone; `rounded` stays for the short junction
stubs. Benchmarks against it are in git history (`tools/link-bench.js`).
