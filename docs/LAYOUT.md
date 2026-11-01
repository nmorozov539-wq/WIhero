# WI Hero — Layout map

Part 2 of the spec: every screen, every control on it, and what it does. The
rules behind the story logic are in Part 1, [CONCEPTS.md](CONCEPTS.md). Both
demos in [demo/](../demo) follow this map.

Phone first. Desktop comes later and mostly lays the same screens side by side.

Contents: [Shared](#shared) · [Normal mode](#normal-mode) · [Hero mode](#hero-mode) · [Back](#back)

## Shared

### Opening the editor

- ST's World Info button opens WI Hero instead of ST's drawer.
- It opens in normal mode, or in Hero mode when "Open books in Hero mode" is on.

### Top row

Left to right: the ⌄ menu, the permanent tabs, then the other tabs, which scroll
sideways. There is no tab list.

| Control       | What it does |
|---------------|--------------|
| ⌄             | Opens a drop-down under it (contents per mode, below) |
| Permanent tab | Icon only, can't be closed. Normal mode: Home. Hero mode: Canvas and Preview |
| Other tabs    | Tap to switch. × shows only on the active tab |
| Pull past end | Pulling the tab row past its end grows a ghost tab; let go on "Release" to open a new tab, or slide back to cancel. Normal mode only |

Anything opened from a permanent tab opens in a new tab. Long press opens it in
a background tab.

### Mode switch

The first block in ⌄, in both modes: the current mode's name across the full
width, with a ⇄ icon.

- First tap: the block turns orange and reads "Tap again to switch to Hero mode"
  (or Normal mode).
- Second tap within three seconds switches. Otherwise it goes back to normal.

### Sheets and toasts

- Choices and small forms open as sheets from the bottom. Tapping the dimmed
  area closes them.
- Deleting never asks. An Undo toast shows instead, and the delete only happens
  once the toast is gone.

---

## Normal mode

### ⌄ menu

| Section | Items |
|---------|-------|
| Mode    | The mode switch |
| View (Home) | Show as: List or Tiles · Sort by: Name, Recently edited, Entries |
| View (book) | Sort by · Group by: Nothing, Strategy, Folders · Disabled entries: Shown or Hidden |
| Tabs    | New tab · Close tab · Close others · Close tabs to the right |

The View section is left out on the entry page.

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
| Book row or tile | Name, status badges (Global, the first link and a count, or Off), entry count, ⋯ |
| Tap a book | Opens it in a new tab |
| Long press | Opens it in a background tab |
| Book ⋯ | Open in new tab · Rename · Move to folder · Export · Delete |
| + New (bottom bar) | Asks for a name, then opens the new book in a new tab |

**World Info settings** (sheet from ⋮): Budget, Scan depth and Recursive scan,
then "More settings…": Budget cap, Min activations, Max depth, Max recursion
steps, Include names, Case-sensitive keys, Match whole words, Use group scoring,
Alert on overflow, Insertion strategy. These are ST's own settings and apply to
every book.

**Selection on Home**: top bar ✕, count, All/None, Invert, Delete. Bottom bar:
Move (to a folder, No folder, + New folder) and Export.

### Book page

| Part | What it shows or does |
|------|-----------------------|
| Name ▾ | Switches the book to List or Hero |
| ⋮ | New folder… · Rename · Duplicate · Move to folder · Export · Delete |
| Global chip | Tap to make the book active globally (green) or not (gray) |
| Linked chip | First linked character or chat plus a count ("Seraphina +2"), cut off when long. Tap for the links sheet |
| Entry count | Plain text |
| New entry defaults | Folded. The header sums up what isn't default. Inside: Strategy, Position, Order, Probability, Case-sensitive, Whole words, Triggered by. What new entries in this book start with |
| Folder header | Name, count, collapse arrow, + for a new entry in that folder |
| Entry row | Strategy stripe, name, keywords, on/off switch, ⋯ |
| Tap a row | Opens the entry page in this tab (from Home's tab, in a new tab) |
| Entry ⋯ | Open in new tab · Duplicate · Move to another book · Copy as text · Delete |

- Strategy stripe: green for keywords, blue for permanent, purple for
  vectorized, gray when off. Off rows are dimmed.
- **Links sheet**: every linked character and chat with ×, "+ Link to this
  chat", "+ Link to a character…". There is no master switch: unlinking is how a
  linked book is turned off.
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

### Entry page

Top to bottom:

| Part | What it shows or does |
|------|-----------------------|
| ← | Up to the book |
| Entries drawer (right bubble) | Every entry in the book; tap one to switch to it |
| ⋮ (right bubble) | Open in new tab · Duplicate · Move to another book · Copy as text · Delete |
| Title | Edited in place |
| Book line | The book's name and status, as plain text |
| Strategy line | "Strategy: Keywords ▾" (or Permanent, Vectorized), tap to change. The entry's on/off switch sits at its right end. An off entry dims |
| Keywords | Bubbles until tapped, then a one-line comma-separated box that scrolls sideways. Empty shows a dim "key words, comma separated list". Hidden for Permanent |
| + Add condition | Adds ST's secondary keywords: a thin line ("And any of / And all of / But none of / But not all of these ▾") over a second keyword box. Its menu also removes it. One per entry |
| Parameters | Folded. The header sums up what isn't default |
| Hero | Folded, read only, only when the entry has pieces (see below) |
| Content | A "Content" heading with a token estimate, then borderless text with a dim "Type here" |

- There is no reading mode, and no bottom bar on this page. Saving is automatic.
- **Parameters**, in groups:
  - Placement: Position; Depth and Role (only for "At depth"); Order
  - Chance and timing: Probability, Sticky, Cooldown, Delay
  - Matching: Scan depth, Case-sensitive, Whole words, Recursion, Triggered by
    (Anyone, Me, Character)
  - Limits: Inclusion group, Characters, Generation types
- **Hero section** in normal mode: one plain-language line per piece in its
  color ("Waits for: Mill", "Glued: stays on until Tower fires or 'calm'"), and
  "Move to Hero mode to edit". The header sums it up. Story logic is never
  edited in normal mode.

---

## Hero mode

### Top row

⌄, then the **Canvas** tab and the **Preview** tab (▷), both permanent, then
entry tabs. There is no "New tab" in Hero mode: its tabs are always entries.

### ⌄ menu (drop-down)

| Section | Items |
|---------|-------|
| Mode | The mode switch · "Open books in Hero mode" switch |
| Activation | Active globally switch · Linked to: links with ×, "+ link" |
| Settings | World Info settings (the same sheet as Home's, inside the drop-down, with ←) · New entry defaults |
| Book · *name* | Rename · Export · Delete book |
| Tabs | Close tab · Close others · Close tabs to the right · Close all entry tabs (grayed out when they don't apply) |

### Canvas tab

One canvas per book. Switching books switches the canvas.

**Gestures**

| Gesture | Result |
|---------|--------|
| Drag empty canvas | Pan |
| Pinch, or mouse wheel | Zoom |
| Tap a card | Focus it: full text and all its links, everything else dims. Tap again for its menu |
| Tap a piece chip | Focus the card and open that piece's sheet |
| Tap a pack frame | The pack sheet |
| Tap empty canvas | Clear the focus. With the panel open, close the panel |
| Drag a card's ⠿ | Move the card anywhere |
| Long press empty canvas | The "Add to canvas" picker, placing at that spot |

**On the canvas**

| Item | What it shows |
|------|---------------|
| Card | Title, keywords and packs, strategy stripe, ⠿ handle, piece chips on their sides |
| Pack frame | `#name` around its members, an in port, and reading chips ("all ▶") |
| Links | Colored by piece. Closes are dashed. Mask and glue links show only on the focused card |
| Empty canvas | "Nothing on this canvas yet. Drag entries here from the panel." |

**Zoom levels**: far (under 55%) shows pieces as notches; normal shows them as
chips; focus shows full text. The current zoom shows bottom left.

**Buttons on the canvas**

| Button | What it does |
|--------|--------------|
| Panel button (top left) | Opens and closes the entry panel. On a first visit, a dim "Open your entries to start" sits next to it |
| ⇄ / ⇅ | Flow direction. Changing it lays everything out again |
| Fit | Fits the whole canvas in view |
| + / − | Zoom |

**Pieces tray** (bottom): Gate (in side), Gates for, Closes, Switch (out side),
Glue (bottom), Mask (top), Pack (tag). Tap one, then tap a card to stick it on.
A banner says what to tap, with Cancel.

**Add to canvas picker** (long press): a search box, "+ New entry here", and
every entry sorted with the ones not yet on the canvas first. Picking one puts
it at the pressed spot; one already there moves there.

### Piece sheets

Each piece opens a sheet with its help line, its targets as chips with ×, and
"+ add". Adding opens a searchable list of entries (and packs where allowed),
with "Tap it on the canvas instead". Every sheet has Delete.

| Piece | Sheet |
|-------|-------|
| Gate | One box per row, "All of these", items as chips, "+ add" and "+ 🔒 lock" per row, "+ Another route (OR)" |
| Gates for, Closes | One list of entries and packs |
| Switch | Its paths. "A switch needs at least two paths" when short |
| Glue | "Until one of these fires" list, and "Or until these words show up in the newest messages" |
| Mask | Each mask: name, content, "Active once:" rows, or "Only when picked by hand". "+ New mask" |
| Pack | The entry's packs, with the reading picker when a pack is read |
| Lock | Its phrases, edited as a list ("Edit lock") |

**Pack sheet** (tap a frame): its members, "Used by:" (the rules that read or
target it), and "+ add" for members.

### Card menu

Tap a focused card. The sheet title is the entry's name.

| Group | Items |
|-------|-------|
| Pieces | One line per piece on the entry; tap to open its sheet |
| Entry | Open entry (new tab) · Show entry data { } · Pack into… |
| Entry | Duplicate · Move to another book · Copy as text · Delete |
| Canvas | Remove from canvas (disabled when it has links: "remove them first") |

Moving an entry to another book drops its pieces and the links to it; the sheet
says so before you pick a book.

### Entry panel

Slides in from the left over most of the canvas. It starts closed.

| Part | What it shows or does |
|------|-----------------------|
| Sort line | "Sorted by folders" (or packs, A–Z, ID) |
| Group header | Name, count, collapse arrow, checkbox in selection |
| Entry row | Strategy stripe, name, dot. Off entries are dimmed |
| Tap a row | Opens the entry in a tab |
| Long press a row | Starts selection |
| Dot, filled | The entry is on the canvas; tap to jump to it |
| Dot, hollow | Tap to place it in the middle of the view, or drag it onto the canvas |
| Bottom bar | + New entry · Search · Sort · Collapse all |
| Book picker | The book's name and status. Tap for the book list |

- **Dragging** an entry out: the panel slides away, the canvas pans near its
  edges, and a ✕ circle appears. Dropping on the ✕ cancels and brings the panel
  back.
- **Search**: a box at the top of the panel matching names and keywords.
- **Book list** (book picker): every book with its entry count, a ✓ on the
  current one, "+ New book" and "Duplicate *book*".
- **Selection**: top bar ✕, count, All, Invert, Delete (Undo). Actions: Move
  (folders, No folder, + New folder), On, Off, Edit…, Place, Pack, Add to a gate
  (one row of all selected).

### Entry tabs

The same entry page as normal mode. Its Hero section lists the story logic in
plain words with "Show on canvas" and "{ } Data" (the raw `wihero` data).
Pieces are edited on the canvas.

### Preview tab

A pretend exchange checked against the book. Nothing is saved.

| Part | What it shows or does |
|------|-----------------------|
| Header | "Preview", and a chip with where it starts from: the open chat ("Road trip chat · after 12 messages") or "Fresh start". Tap to choose |
| Note | "A pretend exchange checked against this book. Nothing is saved." |
| You slot | The user message. ✎ edits, ✕ clears. Tap the text to edit |
| Character slot | The reply, same controls |
| Highlights | Phrases that trigger something |
| Summary | "N fire · N blocked · N changes" |
| Also active | Chips for permanent entries and vector matches |
| Key | Solid, dotted, lock, struck |
| Report | Opens the report page |

- **Highlights** use the strategy colors: solid for entries with pieces, dotted
  for plain entries, 🔒 for lock phrases, struck through when blocked.
- **Tap a highlight or chip** for a sheet with one line on what it did, and Open
  entry and Show on canvas.
- **Report page** (← back): where it starts from, then three lists: Fires
  (with the reason), Blocked (with the reason), Would change (with when). Tap a
  row for its explanation.
- With no chat open both slots start empty, with "Type what you would write" and
  "Type or paste the character's reply".

---

## Back

Android's Back (and Escape on desktop) steps back one layer at a time:

| Mode | Order |
|------|-------|
| Normal | Sheet or drop-down → selection → the tab's history. On a tab's first screen, or when the next step would be Home, it closes the tab. On Home it closes the editor |
| Hero | Sheet or drop-down (a drop-down's sub-page goes back to the menu first) → Preview's report page → Preview to Canvas → entry tab → piece-picking or tool → selection → search → panel → focus. On the Canvas tab it closes the editor |

Back never switches between the two modes.
