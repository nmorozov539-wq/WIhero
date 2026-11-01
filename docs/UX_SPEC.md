# WI Hero — Editor and Hero mode spec

This is the agreed UX design for the next phase. It replaces the editor parts of
DESIGN.md (sections 4 and 5) where the two differ. Nothing here is built yet.

Phone first. The same layout scales up to desktop.

## Base editor

WI Hero replaces SillyTavern's World Info drawer outright. There is no Classic
fallback: turning the extension off brings ST's own editor back.

### Tabs

- Top row, left to right: a ⌄ menu (view options and tab actions), the Home tab,
  then the other tabs, which scroll sideways. No tab list.
- The Home tab is an icon only. It can't be closed and always shows Home.
- Anything opened from Home opens in a new tab. Long press opens it in a
  background tab.
- Pulling the tab row past its end shows a ghost tab; let go and it becomes a new tab.
- × shows only on the active tab.
- Back on a tab's first screen, or when the next step back would be Home, closes
  the tab instead of turning it into a second Home.

### Bottom bar

Search, + New and Select. Hidden on the entry page.

Search is universal: books, folders and entries, current book first. No commands.

### Home

- The list of books, which can be put in folders the same way entries can.
- WI settings ⋮: Budget, Scan depth and Recursive scan first; everything else
  under "More settings".
- + New book asks for a name and opens the book in a new tab.
- Delete shows an Undo toast. The book file is removed only after the toast is gone.

### Book page

- The book name ▾ switches the view: List or Story.
- A Global chip turns the book on globally. A Linked chip shows the first linked
  character plus a count, truncated; tapping it opens a sheet of links with
  Unlink. No master switch.
- A folded "New entry defaults" section (ST books have no settings of their own).
- Entry rows have a color stripe: green for keywords, blue for permanent,
  purple for vectorized, gray when off.
- Group by (in ⌄): none, strategy, or folders. Folder headers have their own +.
- + opens a new entry page. An entry left empty is discarded.

### Selection mode

- Top bar: ✕, count, All/None, Invert, Delete (with Undo).
- Bottom bar: Move (to a folder, No folder, or + New folder), On, Off, and Edit…
  for bulk parameters, where differing values show as "Mixed".
- A folder header has a checkbox that selects every entry inside it.

### Entry page

- ← on the left goes up to the book. The right bubble holds the entries drawer,
  the reading/editing toggle and ⋮.
- The title is edited in place.
- A thin strategy line (Keywords, Permanent, Vectorized) with the entry's on/off switch.
- Keywords: one line, comma separated, scrolls sideways. Empty shows a dim
  "key words, comma separated list". Reading mode shows them as bubbles.
- Permanent hides the keywords. Vectorized keeps them: checked in ST's source,
  keywords still match and the vector match is added on top
  (WORLDINFO_FORCE_ACTIVATE). It needs Vector Storage with World Info turned
  on, and entries with empty content are skipped.
- + Add condition adds secondary keywords: "And any of", "And all of",
  "But none of", "But not all of these".
- A folded Parameters section, whose header sums up the values that aren't default.
- Content has no box, like Obsidian: a dim "Type here" when empty.
- A Hero section next to Parameters: reading mode shows the entry's story logic
  in plain words, editing mode shows the raw `wihero` data.

### Not in this version

Styling, the Classic editor, a command palette in search, master switches.

## Hero mode

Hero mode (formerly the story view or node editor) is a canvas of entries joined
by puzzle pieces.

### Layout

Hero mode is an advanced editor of the same World Info, not a separate system.
It can create entries and edit their logic; the entry page is shared with the base editor.

- A side panel (Obsidian style) slides in from the left over most of the canvas.
  It lists the book's entries, sorted by folders, packs, A–Z or ID. Each row has a
  strategy stripe on the left (gray and dimmed when off) and a dot on the right.
- The dot is the canvas control. Filled: on the canvas, tap to jump there. Hollow:
  tap to place it in the middle of the view, or drag it onto the canvas. While
  dragging the panel slides away, the canvas scrolls near its edges, and a ✕
  circle cancels the drop.
- Tap a row to open the entry in a tab. Long press starts selection: All/None,
  Invert, Delete (with Undo), then On, Off, Move (folders, No folder, + New
  folder), Edit… (bulk parameters), Place, Pack, Add to a gate (one row of all
  selected). A folder header's checkbox selects everything in it.
- Bottom of the panel: + New entry, Search, Sort, Collapse all, then the book
  picker with the Global and Linked chips, and ⋮ for Global, links, Rename,
  Export, Delete.
- One canvas per book. Switching books switches the canvas. Several books on one
  canvas is out of scope. Tapping the canvas closes the panel.
- Tabs work as in the base editor, with a Canvas tab in Home's place.
- Anything with a link is on the canvas. Linking to an entry puts it there. An
  entry with links can't be taken off; remove its links first.
- Pieces pick what they point at from a searchable list, or by tapping the canvas.
- In: book name ▾ → Hero, or "Open books in Hero mode" in ⌄. Back closes a sheet,
  an entry tab, selection or search, the panel, then the focus; on the Canvas
  tab it closes the drawer. Back never switches between List and Hero.

### Data model

There are no special objects. Everything is a field in each entry's `wihero`
data; Hero mode only draws it. The one exception is the canvas layout, which is
kept in the extension settings.

The set of pieces is fixed. No variables, loops or math.

### Pieces and sides

Each piece sticks to one side of an entry:

| Side  | Pieces                       |
|-------|------------------------------|
| In    | Gate                         |
| Out   | Gates for, Closes, Switch    |
| Third | Mask                         |
| Fourth| Glue                         |

The sides turn with the flow direction (left to right, or top to bottom). The
canvas has a ⇄/⇅ toggle.

A gate has two placements for the same rule. On the entry's in side it is stored
as `gates` on that entry. On the source's out side it is stored as `gatesFor` on
the source, and applies to the entries it links to.

### Gate rows

A gate holds rows. Each row means "all of these"; any complete row opens the
gate. This replaces `gates` plus `gateMode`.

A merge (several rows into one entry) is different from a fork (a Switch, where
only one way goes on).

### Packs

Packs replace labels.

- A pack is a tag on entries. Nesting is in the name: `town/inn` is inside `town`.
- How a pack is read lives on the reader: `#town` (any member fired),
  `#town:all` (every member fired), `#town:2` (at least two).
- On the canvas a pack is a frame. Its in port is stored as `gatesFor` or
  `closes` on the source; its out side shows reading chips like "all ▶".

### Locks

A lock is a gate row item: `{"lock": ["red beard", "red-bearded"]}`.

- It is checked against the newest user message and the newest reply.
- It is armed only after the rest of its row has fired.
- It injects nothing. A lock can list several phrases.
- Later, the panel shows "armed, waiting for…" with an Open button.

### Waits

A wait is a gate row item: `{"wait": 3}`.

- It runs out three messages after the rest of its row has fired. A row that
  holds only a wait counts from the start of the chat.
- `{"wait": 3, "by": "user"}` counts only the user's messages, `"char"` only replies.
- A row can hold a wait and a lock. The lock is armed once the wait has run out.
- On the canvas a wait is a chip in its gate row: "⏱ 3".

### Once

`"once": true` closes an entry after its first firing, so it never fires again
in that chat. It is a checkbox in the entry's Hero section; on the canvas the
entry shows a "1×" badge. A glued entry doesn't offer it: glue has its own close
conditions.

### Who triggers

`"by": "any" | "user" | "char"` sets whose messages an entry's keywords are
matched against. The default is Anyone; a book can set its own default under
New entry defaults.

- It is in the entry's Parameters: Triggered by Anyone, Me or Character.
- A lock takes the same field: `{"lock": ["red beard"], "by": "user"}`.
- On the canvas an entry that isn't Anyone shows a small person or bot icon.
- ST has no per-entry source filter, so for these entries the extension blocks
  ST's own keyword match and checks the keywords itself, within the entry's scan
  depth, against the chosen side's messages only.

### Zoom

- Far: pieces show as notches.
- Normal: pieces show as chips.
- Focus (tap an entry): full text and all its links; everything else dims.
  Mask and glue links show only on the focused entry.

### Example

```json
{ "gates": [["tunnel", {"lock": ["red beard"]}]],
  "switch": ["marsh", "ridge"],
  "gatesFor": ["#town"] }
```

```json
{ "gates": [["#town:all", "tower"]], "closes": ["storm"] }
```

```json
{ "gates": [["storm", {"wait": 3, "by": "user"}]], "once": true, "by": "user" }
```
