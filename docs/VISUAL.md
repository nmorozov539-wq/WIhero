# WI Hero — Visual language

Part 3 of the spec: how WI Hero looks. What things do is in
[CONCEPTS.md](CONCEPTS.md), where they sit is in [LAYOUT.md](LAYOUT.md). The
[demo](../demo/wihero-demo.html) is built to this page, and the
[sketches](sketches/README.md) record how it was reached; where a sketch
disagrees with this page, this page wins.

## 1. Direction

- **Manuscript and map.** Normal mode is the manuscript: pages and lists. Hero
  mode is the map: a board. Both share the chrome, the components, the type and
  the entry page. Only the main area differs.
- **Color is what tells them apart.** Normal mode is nearly monochrome: ST's
  neutrals, the accent, and the strategy stripe. Piece colors live in Hero
  mode, plus the Story logic section on entries. The Hero canvas ground is a
  little darker and cooler than the app.
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
| `--accent` | `--SmartThemeQuoteColor` | #e3913a | Active tab, focus ring, toggles, mode switch |
| `--ground`, `--app`, `--bar`, `--surface`, `--raised` | | #121315 to #2f3238 | Surfaces, darkest to lightest |
| `--line`, `--line2` | | #3a3d44, #2a2c31 | Borders and dividers |
| `--muted` | | #a3a49d | Secondary text, muted links |
| `--canvas`, `--canvas-dot` | | #16171b, #2a2c33 | Hero canvas ground and dot grid |

The building step should map the surfaces onto ST's blur tint and border
colors (`--SmartThemeBlurTintColor`, `--SmartThemeBorderColor`) and check the
result in ST's default themes, light ones included.

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
  gets injected). The content font is a Display setting in ⌄ (Serif or Sans),
  so it is easy to go back.

## 4. Icons

- One line-icon set, 24px grid, 2px stroke, round caps and joins, drawn in
  `currentColor`. 22px in buttons, 16px inline.
- No emoji anywhere in the UI.
- The set: down, right, left, back, x, check, home, canvas, eye, search, plus,
  minus, select, more, book, folder, entry, drawer, chain, lock, user, bot,
  fit, tidy, panel, trash, code, on, off, move, gear, edit, tab.

## 5. Components

- **Tabs**: a thin accent underline on the active tab (MiXplorer style). ×
  shows only on the active tab. Permanent tabs are icon only and come first.
- **Round bubbles** for the entry page's ← and the right-hand pill (entries
  drawer and ⋮).
- **Thin lines** for one-choice controls: "Strategy: Keywords ▾", the
  secondary-keyword logic line. Tapping opens a sheet.
- **Keyword box**: bordered, with chips.
- **Toggles**: a light knob; the On track is the accent mixed about 50% with
  the background; Off is gray.
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

Who triggers has no color of its own; it uses `--muted`.

### 6.3 Checks

- Every pair of piece colors stays more than ΔE 20 apart under deutan, protan
  and tritan simulation ([sketch 1](sketches/1-piece-colors.html)).
- Color never carries meaning alone: closes are dashed, vectorized is dashed,
  in and out are told apart by shape, locks have an icon, blocked Preview
  highlights are struck through.

## 7. The canvas

### 7.1 Cards

- A card shows the title, the keywords (or "Permanent"), the strategy stripe
  and the six-dot grip in the strategy color. Off cards are dimmed.
- Pieces are drawn as **marks on the card** (ports) and **links between
  cards**, never as blocks wrapping the card or as boxes between cards.
- Cards move only by the grip.

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
| Glue, ride along | Solid yellow arrow, host to rider |
| Glue, hold | A yellow bar along the held card's right edge; it ends through the red close gate |
| Lock | A chip with the lock icon and the phrase, joined to its row by a short dotted line |
| Pack | A dashed light-gray frame around the members, `#name` on it. A link that reads the pack carries its reading by the frame's knob: "any", "all", "2+" |

- **Junctions**: where a gate (or close gate) has more than one item, its
  items meet at a small junction chip in the gate's color before the socket,
  labelled "and" or "or". Items in one row meet at an "and" chip; rows meet at
  an "or" chip, each row of several items with its own "and" chip feeding it.
  A gate with a single item has no junction.
- **Routing**: links run on a 12px lattice, with rounded corners. They may
  cross other links but **never pass through a card**. The layout leaves lanes
  between cards, and links reroute while a card is dragged. No stubs: every
  link is drawn whole.

### 7.4 Masks

- Masks are drawn as a **stack of layer cards** behind the entry, offset up and
  to the right, up to two visible.
- Under the card, a ‹ › control shows which layer is on top: "main", "1/2",
  "2/2". When the bottom edge is taken, it sits vertically on a side.
- Only the links of the shown layer are drawn; the entry's own links (gate,
  glue and the rest) always show.
- The mask that is active in the open chat gets a dot after its number
  ("‹ 1/2 • ›").

### 7.5 Layout and view

- Layered automatic layout, top to bottom, from the links. Tidy reruns it.
- The canvas fits itself to the screen on first open. Fit, + and − sit on the
  right; the zoom level shows bottom left.
- The legend, when shown, names the five link colors.

## 8. Preview

- Highlights use the **strategy color** of the entry they trigger: solid
  underline and tint for entries with pieces, dotted for plain entries.
- Lock phrases use the opens teal (or closes red for a close-gate lock) with
  the lock icon.
- Blocked highlights are struck through.

## 9. Still open

- Mapping the surface tokens onto ST's SmartTheme colors (section 2), and a
  light-theme pass.
- Desktop layout.
