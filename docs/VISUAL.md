# WI Hero — Visual language

Part 3 of the spec: how WI Hero looks. What things do is in
[CONCEPTS.md](CONCEPTS.md), where they sit is in [LAYOUT.md](LAYOUT.md). The
sketches and the demo it was first drawn in are in the git history; where they
disagree with this page, this page wins.

## 1. Direction

- **Manuscript and map.** Normal mode is the manuscript: pages and lists. Hero
  mode is the map: a board. Both share the chrome, the components, the type and
  the entry page. Only the main area differs.
- **Color is what tells them apart.** Normal mode is nearly monochrome: ST's
  neutrals, the accent, and the strategy stripe. Piece colors live in Hero
  mode, plus the Story logic section on entries. The Hero canvas ground is the
  theme's background made solid, with a faint dot grid.
- **Fit into SillyTavern.** WI Hero takes its colors and type size from the
  user's ST theme, so it looks like part of ST in any theme.

## 2. Theme tokens

Every color and size is a CSS variable. Where ST has a SmartTheme variable,
WI Hero reads it and keeps a fallback for use outside ST:

| Token | Reads | Fallback | Use |
|-------|-------|----------|-----|
| `--fs` | `--mainFontSize` | 15px | Base of the type scale |
| `--sans` | `--mainFontFamily` | Noto Sans | All UI text |
| `--fg` | `--SmartThemeBodyColor` | #e4e2da | Text |
| `--tint` | `--SmartThemeBlurTintColor` | #1d1e22 | The background behind everything |
| `--accent` | `--SmartThemeQuoteColor` | #e3913a | Active tab, focus ring, toggles, mode switch, Moments |
| `--blur`, `--shadow` | `--SmartThemeBlurStrength`, `--SmartThemeShadowColor` | 10px, black at 50% | Backdrop blur, shadows |
| `--bar`, `--surface`, `--raised` | | | Surfaces: the text color mixed over the tint at 4%, 8% and 13% |
| `--line`, `--line2` | | | Borders and dividers: the text color at 20% and 10% |
| `--muted` | | | Secondary text, muted links: the text color at 64% |
| `--canvas`, `--canvas-dot` | | | Hero canvas ground (the tint, solid) and dot grid (the text color at 14%) |

Mixing the surfaces from the theme's own text color over its tint works for
light and dark themes alike; `e2e/n2.mjs` takes screenshots in several of ST's
themes, and `e2e/desktop.mjs` makes a light-theme pass.

## 3. Type

- **Five sizes**, all derived from `--fs`, so ST's font-size slider scales
  everything:

  | Token | Size at 15px | Use |
  |-------|--------------|-----|
  | `--t-xs` | 12 | Labels, meta, section captions |
  | `--t-s` | 13 | Secondary text, help lines |
  | `--t-m` | 15 | Body |
  | `--t-l` | 17 | Section heads |
  | `--t-xl` | 24 | Page titles |

  Nothing uses a size outside the scale.
- **Noto Sans** for everything, **Noto Serif** for entry content (the text that
  gets injected). The content font is a Display setting in ☰ (Serif or Sans),
  so it is easy to go back.

## 4. Icons

- One line-icon set, 24px grid, 2px stroke, round caps and joins, drawn in
  `currentColor`. 22px in buttons, 16px inline.
- No emoji anywhere in the UI.
- The set lives in `src/ui/icons.js`. Every piece has an icon of its own
  (Opens, Closes, Glue, Switch, Mask, Pack, Tracker, Lock, Wait, Moment, Once,
  Who triggers), on the piece bar and in the inspector's rows, so pieces are
  told apart by more than their color.

## 5. Components

- **Tabs**: a thin accent underline on the active tab (MiXplorer style). ×
  shows only on the active tab. Permanent tabs are icon only and come first.
- **Round bubbles** for the entry page's ← and the right-hand pill (entries
  drawer and ⋮).
- **Thin lines** for one-choice controls: "Strategy: Keywords ▾", the
  secondary-keyword logic line. Tapping opens a sheet.
- **Keyword box**: bordered, with chips.
- **Toggles**: a light knob on every theme (it doesn't follow the text color,
  which is dark on a light theme); the On track is the accent mixed about 50%
  with the background; Off is gray. In the phone book list an entry's switch
  is quiet while on (gray track) and stands out only when off (accent outline).
- **Badges** like "Global" mix their color about 60% toward the text color, so
  they read on light themes too.
- **Sheets** from the bottom, with a dimmed backdrop. Rows show their current
  value at the right. Section captions are `--t-xs`, muted, uppercase.
- **Story logic rows**: a short stripe in the piece's color, a small label, a
  plain sentence. The link under them is muted gray, not accent.
- **Focus**: a 2px accent outline, offset 2px, on every control.

## 6. Color

### 6.1 Strategy

Strategy colors follow ST's own convention (🟢 Normal, 🔵 Constant, 🔗
Vectorized), so green, blue and purple belong to strategy and to nothing else.

| Strategy | Color | Also |
|----------|-------|------|
| Keywords | #6fd09a green | |
| Permanent | #6fa8ff blue | |
| Vectorized | #b48cff purple | A dashed stripe and a chain icon, so shape carries it too |
| Off | #6b6d72 gray | Dimmed row |

Strategy shows as the stripe on entry rows and canvas cards, the dot before
"Strategy:", and the six-dot grip on canvas cards.

### 6.2 Pieces

Pieces are grouped into families, each with one color. Within a family, shape
tells the pieces apart.

| Family | Color | Pieces |
|--------|-------|--------|
| Opens | #45c9bd teal | Gate, Gates for |
| Closes | #ff6f61 coral red | Close gate, Closes for, Switch, Once |
| Glue | #f2cf4a yellow | Glue (ride along, hold) |
| Mask | #f07cc8 pink | Masks |
| Pack | #cfccc2 light gray | Packs, drawn dashed |
| Tracker | #d9a066 bronze | Tracker (a written slot), its value on the card |
| Moment | the theme's accent (orange by default) | Moments |

Who triggers has no color of its own; it uses `--muted`. Neither do Lock and
Wait: on the canvas they take their row's color (teal in a gate, red in a close
gate), and their piece bar chips use `--muted`.

### 6.3 Checks

- Sketch 1 checked an earlier set (with a blue for opens). Rechecked for the
  current set (Machado 2009 simulation, ΔE in CIELAB): under deutan and protan,
  opens (teal) comes within about ΔE 7 of masks and packs. That is what the
  color vision modes (6.4) are for. Each mode keeps every pair at least ΔE 20
  apart under its own kind of color blindness.
- Color never carries meaning alone: closes are dashed, vectorized is dashed,
  in and out are told apart by shape, locks have an icon, blocked Preview
  highlights are struck through.

### 6.4 Color vision modes

☰ Display → Colors. Each mode swaps the piece colors (and, when built, the
strategy colors) for a set that stays apart under one kind of color blindness.
The surfaces, the accent and the shapes don't change. There is no other color
customizing. Drawn in sketch 7 (in the git history).

| Mode | Opens | Closes | Glue | Mask | Pack | Tracker |
|------|-------|--------|------|------|------|---------|
| Standard | #45c9bd | #ff6f61 | #f2cf4a | #f07cc8 | #cfccc2 | #d9a066 |
| Red-green safe | #56b4e9 | #e8681a | #f0e442 | #cc79a7 | #cfccc2 | #c9a26b |
| Blue-yellow safe | #2fc4c4 | #ff4a4a | #f5f5f5 | #ff9ad5 | #8a8f99 | #d9a066 |

Strategy sets for the modes are chosen and checked the same way when they are
built.

## 7. The canvas

### 7.1 Cards

- A card shows the title, the keywords (or "Permanent"), the strategy stripe
  and the six-dot grip in the strategy color. Off cards are dimmed.
- Pieces are drawn as **marks on the card** (ports) and **links between
  cards**, never as blocks wrapping the card or as boxes between cards.
- Cards move only by the grip.
- On desktop the title takes up to two lines, so a name like "Road: leaving
  the village" reads whole at 100%. Phones keep one line.
- **ST timing**: a card whose entry has Probability under 100% or a Sticky,
  Cooldown or Delay shows a quiet badge at its bottom right, "50% · S5 · C3 ·
  D2" (the full words on hover).
- A **sticky note** sits over the card's top right edge: a small pale yellow
  slip, tilted a little, up to three lines (the whole note on hover). It is the
  author's own and never reaches the model.

### 7.2 Ports

- **Socket = in, knob = out.** A socket is a notch cut into the card's edge; a
  knob is a half disc standing out of it. Shape, not side, carries the
  direction.
- Ports take their family color: a teal socket for the gate, a teal knob for
  what this entry opens, a red socket for the close gate, a red knob for what
  it closes. A fork's knob is solid red (Switch).
- **Sides**: a port sits on a free side, by default the one facing the entries
  it links to. Drag a port to move it to another free side; Tidy puts it back.
- **Capacity**: long (top and bottom) edges hold up to three ports, short
  edges one. A card with masks keeps its bottom edge for the mask control and
  gives up its right edge to the layer stack. One port per kind per card: all
  rows of a gate enter one socket.
- A knob whose links all go to a hidden mask layer is drawn **hollow and
  dashed**. Tapping it flips the target card to that layer.

### 7.3 Links

| Piece | Drawn as |
|-------|----------|
| Gate, Gates for | Solid teal, from the source's knob to the target's gate socket |
| Close gate, Closes for | Dashed red, ending in an arrow and a bar at the closed entry's red socket |
| The story moves on | Nothing of its own: its Closes for links, which run back alongside the gate links |
| Switch | The fork's solid red knob; its paths' gate links leave from it |
| Glue, ride along | Solid yellow line from the host's knob to the rider's socket, no arrowhead (like Opens) |
| Glue, hold | A yellow bar along the held card's right edge; it ends through the red close gate |
| Lock, Wait | A chip (lock icon and phrase, or clock and message count) sitting on its row's line: on the link when the row has one, on the line from the AND junction to the card when it has several, on a short line out of the socket when it has none. A chip never sits on a card: it moves out along its line until it is clear |
| Pack | A dashed light-gray frame around the members on the canvas, `#name` on it. It shows as soon as one member is on the canvas (not only once a rule reads or targets the pack), so "Pack into…" makes a frame at once and a link can be dropped on it. A link that reads the pack carries its reading by the frame's knob: "any", "all", "2+" |

- **Junctions**: where a gate (or close gate) has more than one item, its
  items meet at a small junction chip in the gate's color before the socket,
  labelled "and" or "or". Items in one row meet at an "and" chip; rows meet at
  an "or" chip, each row of several items with its own "and" chip feeding it.
  A gate with a single item has no junction.
- **Routing**: the link engine ([LINK_ENGINE.md](LINK_ENGINE.md)) draws
  smooth curves that go around cards, keep a lane apart from each other and
  cross cleanly. They **never pass through a card**, and a line can be shaped
  by hand (dots, curve, arc, straight or step). No stubs: every link is drawn
  whole.

### 7.4 Masks

- Masks are drawn as a **stack of layer cards** behind the entry, offset up and
  to the right, up to two visible.
- Under the card, a ‹ › control shows which layer is on top: "main", "1/2",
  "2/2". When the bottom edge is taken, it sits vertically on a side.
- The shown layer's links are drawn as usual, the other layers' links faded;
  switching the layer swaps which are faded. The entry's own links (gate, glue
  and the rest) always show.
- The mask that is active in the open chat gets a dot after its number
  ("‹ 1/2 • ›").

### 7.5 Chat state, problems, Moments and greetings

- **Show chat state** (☰, off by default) marks each card with the open chat's
  state at its latest message: a small "2×" fired count top right; closed cards
  dimmed, the title struck through in red, "CLOSED" and "by *X*"; a holding
  card's glue bar glows; a card still waiting on its gate is hollow (dashed
  border, hollow grip dots).
- **Problems**: a red round "!" on the card's top left corner, whether chat
  state is on or not.
- **Moment cards** turn the start card around: rounded on the right, dashed,
  a spark icon, "MOMENT" (with "· YOU" or "· CHARACTER" when only one side
  can say it) above the name, the phrases in quotes in the content font, in
  italics. No strategy stripe and never dimmed (it is stored off on purpose).
  Out ports, plus the gate socket when it has a gate. With chat state on the
  tag reads "HAPPENED" (solid accent border) or "NOT YET".
- **Trackers**: a card whose text the model writes shows its value in the
  open chat in bronze.
- **Greeting cards** (retired for V1, CONCEPTS 3.12, so not drawn now) are start cards: rounded on the left like a speech bubble,
  a chat icon, "START" above the name ("Greeting", "Alt 2"), the greeting's
  opening words in the content font, in italics. No color of their own; out
  ports only. A missing character's greeting is drawn dashed and faded.

### 7.6 Layout and view

- Layered automatic layout from the links. On phones it runs top to bottom: a
  layer wider than two cards wraps onto more rows, so the canvas grows down.
  On desktop (LAYOUT, "Desktop: Hero mode") it runs **left to right**: each
  layer is a column, ordered by where its sources sit and centered against the
  tallest column; a pack's unlinked members join a linked member's column so
  the frame stays whole. Tidy reruns it.
- **Port sides follow the layout.** A link between cards that stand side by
  side leaves the source's right edge and enters the target's left edge;
  between cards above one another it uses bottom and top (7.2's capacity
  rules apply per edge). A port with no partner card (a lone lock or wait)
  sits on the top edge. On side edges the ports run, top to bottom: opens,
  glue, closes.
- On desktop, resting the pointer on a card for 350ms dims everything not
  linked to it, the same look as a phone's tap-to-focus.
- On phones a Closes line that runs back up the canvas (its closer sits below
  the card it closes) is drawn faint until one of its two cards is inspected,
  so the long lines climbing the page don't drown the story running down it.
- The canvas fits itself to the screen on first open. On phones that means the
  width, never below 80% zoom, from the top; the canvas then scrolls down. Fit
  zooms out until every card shows. Fit, + and − sit on the right; the zoom
  level shows bottom left.
- The undo and redo arrows sit top left, beside the panel button: round
  buttons, greyed out when there is nothing to step to.
- The checks chip (LAYOUT, "Buttons on the canvas") sits top right: a pill
  with a yellow mark, red when anything is dead.
- The legend, when shown, names the five link colors.

### 7.7 Explain mode and the Guide

- Explain mode outlines each explainable element with a 1.5px dashed accent
  line, 2px out; the canvas and the piece bar dim slightly (less saturation,
  a little darker). The banner is a pill with an accent border over the piece
  bar, its text in `--t-s`, Cancel as a small button.
- Guide pages carry a stripe in their piece's family color down the left
  edge; the anchor a page was opened at flashes a faint accent tint. Pictures
  are small SVGs drawn with the same card, line, knob and chip shapes and
  colors as the canvas. The example is set in the content font.

## 8. Preview

- Highlights use the **strategy color** of the entry they trigger: solid
  underline and tint for entries with pieces, dotted for plain entries.
- Lock phrases use the opens teal (or closes red for a close-gate lock) with
  the lock icon.
- Blocked highlights are struck through.

## 9. Still open

- The strategy colors for the color vision modes (6.4).
