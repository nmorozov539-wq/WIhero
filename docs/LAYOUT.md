# WI Hero — Layout map

Part 2 of the spec: every screen, every control on it, and what it does. The
rules behind the story logic are in [CONCEPTS.md](CONCEPTS.md); colors, type and
how pieces are drawn are in [VISUAL.md](VISUAL.md). The
[demo](../demo/wihero-demo.html) follows this map; the few parts it leaves out
are listed at the end.

Phone first. Desktop comes later and mostly lays the same screens side by side.

The two modes are **manuscript and map**: normal mode reads like pages, Hero
mode like a board. They share the chrome, the components, the type and the
entry page; only the main area differs (lists and pages, or the canvas with its
panel).

Contents: [Shared](#shared) · [Normal mode](#normal-mode) · [Hero mode](#hero-mode) · [Back](#back) · [Not in the demo](#not-in-the-demo)

## Shared

### Opening the editor

- ST's World Info button opens WI Hero instead of ST's drawer.
- It opens in normal mode, or in Hero mode when "Open books in Hero mode" is on.

### Top row

Left to right: the ⌄ menu, the permanent tabs, then the other tabs, which
scroll sideways. There is no tab list.

| Control       | What it does |
|---------------|--------------|
| ⌄             | Opens the menu sheet (contents per mode, below) |
| Permanent tabs | Icon only, first in the row, can't be closed. Normal mode: Home. Hero mode: Canvas and Preview |
| Other tabs    | Tap to switch. The active tab has a thin accent underline; × shows only on it |

Anything opened from a permanent tab opens in a new tab. Long press opens it in
a background tab.

### ⌄ menu

One style in both modes: a sheet of labelled sections with one row per item,
each row showing its current value at the right.

| Section | Normal mode | Hero mode |
|---------|-------------|-----------|
| (top) | Mode switch | Mode switch |
| View / Book | Home: World Info settings. Book page: Group by (Folders, Strategy, Nothing) · Show disabled entries (Shown, Hidden) | Active globally (switch) · Linked to: "Seraphina +1 ›" opens the links sheet · Switch book › |
| Canvas | | Tidy layout · Legend (Shown, Hidden) |
| Display | Content font (Serif, Sans) | Content font |
| Tabs | New tab · Close other tabs | Close other tabs |

The View section is left out on the entry page.

### Mode switch

The first row in ⌄: "Switch to Hero mode" (or Normal mode) with the target
mode's icon.

- First tap: the row turns accent and reads "Tap again to switch to Hero mode".
- Second tap switches. Leaving the menu cancels it.
- Normal to Hero opens the current book's canvas. From an entry's "Open in
  Hero mode ›" it also centers that entry. Hero to normal opens the book page
  in a tab (an existing one if there is one).

### Sheets and toasts

- Choices and small forms open as sheets from the bottom. Tapping the dimmed
  area closes them.
- Deleting never asks. An Undo toast shows instead, and the delete only happens
  once the toast is gone.

### Entry page

The same page in both modes. Top to bottom:

| Part | What it shows or does |
|------|-----------------------|
| ← (round bubble) | Up to the book (normal mode) or closes the entry tab (Hero mode) |
| Entries drawer and ⋮ (a pill of two round bubbles, right) | Drawer: every entry in the book, tap one to switch to it. ⋮: Open in new tab · Duplicate · Move to another book · Copy as text · Delete |
| Title | Big, edited in place. Not sticky; the tab already shows the name |
| Book line | Book icon, the book's name and folder; tap goes up to the book |
| Strategy line | A strategy-colored dot, "Strategy: Keywords ▾" (or Permanent, Vectorized), tap for the strategy sheet. The entry's on/off switch sits at its right end. An off entry dims |
| Keywords | A bordered box with chips; tap to edit as a comma-separated line. Empty shows "Key words, separated by commas". Hidden for Permanent |
| + Add condition | Adds ST's secondary keywords: a thin line ("And any of / And all of / But none of / But not all of ▾") over a second keyword box. One per entry |
| Story logic | Only when the entry has pieces. Read-only in both modes (below) |
| Parameters | Folded. The header sums up what isn't default, or "Defaults" |
| Content | A "Content" heading with a token estimate, then borderless text in the content font, "Type here" when empty |
| Mask content | Hero mode only: one block per mask, "Mask: *name*", with its own text |

- There is no reading mode and no bottom bar on this page. Saving is automatic.
- **Parameters**, in groups:
  - Placement: Position; Depth and Role (only for "At depth"); Order
  - Chance and timing: Probability, Sticky, Cooldown, Delay
  - Matching: Scan depth, Case-sensitive, Whole words, Recursion, Who triggers
  - Limits: Inclusion group, Characters, Generation types
- **Story logic section**: one row per rule, each with a short stripe in the
  piece's color, a small label and a plain sentence ("Gate: Opens when Mill has
  fired", "Glue: Holds: once fired it stays on until its close gate", "Closed
  by: Finale when it fires"). Rules other entries put on this one show too
  (Held back by, Closed by, Ridden by).
  - Normal mode: folded, the header lists the labels in one line. Under the
    rules a muted link, "Open in Hero mode ›".
  - Hero mode: always open. Under the rules, muted links "Show on canvas" and
    "Data" (the raw `wihero` field).
  - Story logic is never edited here. It is edited in the inspector.

---

## Normal mode

### Bottom bar

Shown on Home and the book page, hidden on the entry page.

| Button | What it does |
|--------|--------------|
| Search | Opens the search overlay |
| + New  | Home: new book. Book page: new entry |
| Select | Starts selection mode |

### Search overlay

- One box. It searches book names, folder names, entry names and keywords, in
  every book.
- Results are grouped: the current book's entries first, then other books'
  entries, books and folders.
- Tapping a result opens it in a new tab. No commands.

### Home

| Part | What it shows or does |
|------|-----------------------|
| Header | "World Info", and ⋮ for ST's World Info settings |
| Book folders | Collapsible groups of books (WI Hero's own, not ST's) |
| Book row | Name, status badges (Global, the first link and a count, or Off), entry count, ⋯ |
| Tap a book | Opens it in a new tab |
| Long press | Opens it in a background tab |
| Book ⋯ | Open in new tab · Rename · Move to folder · Export · Delete |
| + New (bottom bar) | Asks for a name, then opens the new book in a new tab |

**World Info settings** (sheet): Budget, Scan depth and Recursive scan, then
"More settings ›" for the rest of ST's World Info settings. These are ST's own
and apply to every book.

**Selection on Home**: top bar ✕, count, All/None, Invert, Delete. Bottom bar:
Move (to a folder, No folder, + New folder) and Export.

### Book page

| Part | What it shows or does |
|------|-----------------------|
| Name ▾ | The book's name. Tap for List (this page) or Story canvas (opens the book in Hero mode), then New folder… · Rename · Duplicate · Move to folder · Export · Delete |
| Global chip | Tap to make the book active globally or not |
| Linked chip | First linked character or chat plus a count ("Seraphina +2"). Tap for the links sheet |
| New entry defaults | Folded. The header sums up what isn't default. What new entries in this book start with |
| Folder header | Name, count, collapse arrow, + for a new entry in that folder |
| Entry row | Strategy stripe, name, keywords, on/off switch, ⋯ |
| Tap a row | Opens the entry page in this tab (from Home's tab, in a new tab) |
| Entry ⋯ | Open in new tab · Duplicate · Move to another book · Copy as text · Delete |

- The strategy stripe and dot use the strategy colors (VISUAL.md). Off rows are
  dimmed and gray.
- **Links sheet**: every linked character and chat with Unlink, and "Link to
  this chat". There is no master switch: unlinking is how a linked book is
  turned off.
- + New creates an entry and opens its page with the name ready to type. An
  entry left completely empty is discarded.

### Selection mode (book page)

| Part | Controls |
|------|----------|
| Top bar | ✕ (leave) · "N selected" · All/None · Invert · Delete (Undo toast) |
| Bottom bar | Move · On · Off · Edit… |
| Folder header | A checkbox that selects every entry in the folder |

- **Move**: lists folders, "No folder" and "+ New folder". This is the main way
  folders get made.
- **Edit…**: bulk parameters with the entry page's rows. Rows where the
  selected entries differ say "Mixed". Only changed rows are applied.

---

## Hero mode

### Top row

⌄, then the **Canvas** tab and the **Preview** tab, both permanent and icon
only, then entry tabs. There is no "New tab" in Hero mode: its tabs are always
entries.

### Canvas tab

One canvas per book. Switching books switches the canvas. The ground is a
little darker and cooler than the app, with a faint dot grid.

**Gestures**

| Gesture | Result |
|---------|--------|
| Drag empty canvas | Pan |
| Pinch, or mouse wheel | Zoom around the fingers or pointer |
| Tap a card | Opens the inspector for that entry |
| Tap a port | Opens the inspector scrolled to that piece. A knob whose links all go to a hidden mask layer flips that card to the layer instead |
| Tap a pack frame | The pack sheet |
| Tap ‹ or › under a card | Steps through its mask layers |
| Drag a card's grip | Moves the card. Links reroute as it moves |
| Drag a port | Moves it to another free side of its card |
| Tap empty canvas | With the panel open, closes the panel |

Cards move only by the grip (the six dots), so a drag anywhere else pans.

**Buttons on the canvas**

| Button | What it does |
|--------|--------------|
| Panel button (top left) | Opens and closes the entry panel |
| Fit (right) | Fits the whole canvas in view. The canvas fits itself on first open |
| + / − (right) | Zoom |
| Zoom label (bottom left) | The current zoom |
| Legend (bottom) | The link colors: opens, closes, glue, mask, pack. Toggled from ⌄ |

**Tidy layout** (⌄) lays everything out again from the links, top to bottom,
and puts every port back on its default side.

### Inspector

Tapping a card opens the inspector: a tall sheet with every piece of the entry
expanded and editable.

| Part | What it shows or does |
|------|-----------------------|
| Header | Strategy dot, the entry's name, its on/off switch, × |
| Meta line | Strategy and keywords |
| Piece cards | One card per piece the entry has, in matrix order: Gate, Gates for, Close gate, Closes for, Glue, Switch, Masks, Packs, Once, Who triggers. Each has a colored edge, its name, a one-line help and a remove button |
| From other entries | Rules other entries aim at this one: "Gates for this", "Closes this", "Rides along with this". Tap one to inspect that entry |
| + Add piece | A sheet of the pieces the entry doesn't have yet, each with its help line |
| Footer | Open entry (in a tab) · Take off canvas (only for placed, unlinked entries) · Data |

Piece cards:

| Piece | Editor |
|-------|--------|
| Gate, Close gate | One box per row, items as chips with ×, "+ add" per row (entry, pack reading or lock phrase), "+ Another row (OR)". The gate card adds a "Story moves on" button that writes Closes for to its entries, or says that it already does |
| Gates for, Closes for | One list of entries and packs |
| Switch | Its paths, entries only |
| Glue | Ride along / Hold. Ride shows its host as a chip. Hold says what ends it ("Ends through its close gate: …") or "Nothing ends it yet" with "+ Close gate" |
| Masks | One block per mask: number and name, show on canvas, rename, move up (lower priority), remove; then "On when" rows and "Off when (close gate)" rows. "+ Mask". Mask text is edited on the entry page |
| Packs | The entry's packs as chips, "+ add" |
| Once | "On. *Name* closes right after it fires" |
| Who triggers | Your messages / Character's replies |

**Choosing a target** (any "+ add"): a search box, then entries, then packs.
Picking a pack asks for the reading: Any of them, All of them, or a number.
Where a lock is allowed there is a "Lock phrase…" row.

**Pack sheet** (tap a frame): "In this pack" and "Used by" (the entries whose
rules read or target it). Tap a row to inspect it.

### Entry panel

Slides in from the left over most of the canvas. It starts closed. Obsidian
style: a list first, the book at the bottom.

| Part | What it shows or does |
|------|-----------------------|
| Filter box | "Filter entries", matching names |
| + | New entry: asks for a name and places it in the middle of the view |
| Folder header | Name, count, collapse arrow |
| Entry row | Strategy stripe, name, dot. Off entries are dimmed |
| Tap a row | Opens the entry in a tab |
| Dot, filled | The entry is on the canvas; tap to jump to it |
| Dot, hollow | Tap to place it in the middle of the view |
| Book picker (bottom) | The book's name ▾ with its status badges. Tap for the book list |

### Entry tabs

The shared entry page (above), with Story logic always open and mask content
blocks under Content.

### Preview tab

A pretend exchange checked against the book. Nothing is saved.

| Part | What it shows or does |
|------|-----------------------|
| Header | "Preview", and a chip with where it starts from: the open chat ("Road trip chat · after 12 messages") or "Fresh start". Tap to choose |
| Note | "A pretend exchange checked against *book*. Nothing is saved. Tap a highlight to see why." |
| You slot | The user message. Edit and clear buttons; tap the text to edit |
| Character slot | The reply, same controls |
| Highlights | Phrases that trigger something |
| Also active | Chips for permanent entries, vector matches and glued entries |
| Key | What solid, dotted, lock and struck highlights mean |
| Report button | "Report: N fire, N blocked, N changes", opens the report page |

- **Highlights** are underlines and tints in the strategy color: solid for
  entries with pieces, dotted for plain entries, a lock icon and the gate's
  teal (or close red) for lock phrases, struck through when blocked.
- **Tap a highlight or chip** for a sheet with one line on what it did and why,
  what else it changes, and Open entry and Show on canvas.
- **Report page** (← back): where it starts from (already fired, closed), then
  three lists: Fires (with the reason), Blocked (with the reason), Would change
  (with when). Tap a row for its explanation.
- With no chat open both slots start empty, with "Type what you would write" and
  "Type or paste the character's reply".

---

## Back

Android's Back (and Escape on desktop) steps back one layer at a time:

| Mode | Order |
|------|-------|
| Normal | Sheet → search → selection → the tab's history. On a tab's first screen it closes the tab. On Home it closes the editor |
| Hero | Sheet → panel → entry tab → Preview's report page → Preview to Canvas. On the Canvas tab it closes the editor |

Back never switches between the two modes.

---

## Not in the demo

Specified here but left out of the demo, or only stubbed, to keep it small:
Invert and Export in selection, Edit… for bulk parameters, New entry defaults,
book ⋯ menus, Duplicate and Move to another book, waits (CONCEPTS 3.11), Reopen
and the problem list (CONCEPTS 9), and selection in the entry panel.
