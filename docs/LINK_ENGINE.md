# Link engine

Smooth canvas links that go around cards. Built from the link engine handout (project files,
`wihero/link-engine-handout.md`). Lives on the `link-engine` branch and is **not wired into the canvas yet**:
`src/ui/canvas.js` still uses the grid router in `src/ui/canvas-graph.js`.

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

## Not done yet

- Wiring into `src/ui/canvas.js` (after the app.js split): build defs from `buildGraph` and `computePorts`, pass
  cards, mask stacks, their ‹ › control and pack frames as obstacles, draw `path(id).d` in `drawEdge`, keep the
  straight drag guides, store shapes in `canvas.cards[<key>].links`.
- Bundling is lanes side by side; links heading the same way don't merge into one line.
- The editing UI (gestures, handles, where Reset lives).
