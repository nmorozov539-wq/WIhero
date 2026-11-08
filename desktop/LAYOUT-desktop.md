## Desktop: normal mode (draft)

> First pass, from the sketches in [sketches/](sketches). Demo:
> [normal-mode-demo.html](normal-mode-demo.html). Hero mode is further down, demo:
> [hero-mode-demo.html](hero-mode-demo.html).

Desktop is any screen where ST uses its desktop layout (wider than 1000px).
The phone screens stay as they are below that.

### Size and place

- WI Hero takes the place of ST's own World Info drawer, at the same size: it
  drops down from under ST's top bar, is as wide as ST's chat (`--sheldWidth`,
  the "Chat width" setting, 50% of the window by default, never under 450px),
  and stops above the send form. ST's side panels, top bar and send form stay
  visible around it.
- It opens with ST's drop-down animation and closes the same way (the World
  Info button, another top bar drawer, the × in the tab row, or Esc).
- Everything inside is laid out for the drawer's width, not the window's. At
  1920px wide and 50% that is 960px; at 1366px it is 683px.

### What changes from phones

- **Mouse first.** Hover shows what a long press shows on phones: the row's ⋯,
  its on/off switch, a tab's ×. Right-click opens the same menu as ⋯.
  Middle-click (or Ctrl-click) opens in a background tab, which replaces long
  press.
- **Menus instead of sheets.** Every choice that is a bottom sheet on phones
  (strategy, folder, links, ⋮, ⌄) is a menu that opens at the control.
- **No bottom bar.** Its three buttons move: Search to the tab row, + New to
  the toolbar (Home) or next to the entry filter (book), Select becomes
  ordinary Ctrl/Shift-click selection.
- **No selection mode.** Selecting is always possible: Ctrl-click adds one,
  Shift-click adds a range, Esc clears. Hovering a book shows a checkbox.
- **No pull-to-open-tab.** The tab row has a + button.

### Tab row

40px high (phones: 50). Left to right: ⌄, Home, book tabs, +, empty space,
Search (with "Ctrl K"), ×.

| Control | What it does |
|---------|--------------|
| Book tab | One per open book. Click to switch. × shows on the active tab and on hover. Middle-click closes. Drag to reorder |
| Tab right-click | Close tab · Close other tabs · Close tabs to the right · Duplicate tab |
| + | Shows Home, to pick a book for the new tab |
| Double-click empty space | The same as + |
| Search | The search overlay (below). Ctrl K anywhere |
| × | Closes WI Hero (like Esc with nothing else open) |

A tab is a book, not an entry: the entry list is always beside the entry, so
switching entries happens inside the tab.

### Search overlay (Ctrl K)

A box near the top of the drawer, over a dimmed view. The same search as on
phones (names, folders, entry names, keywords, every book; the current book
first). ↑ ↓ move, Enter opens (in this tab for the current book, in a new tab
for another), Ctrl Enter opens in a background tab, Esc closes.

### Home

| Part | What it shows or does |
|------|-----------------------|
| Header | "World Info", Filter books box, List/Tiles switch, New folder, **+ New book**, gear (ST's World Info settings) |
| List (default) | A table: checkbox (on hover), Name, Active (Global, first link +n, or Off), Entries, Edited, ⋯ (on hover). Click a header to sort. Folders are collapsible rows inside the table; "Not in a folder" last |
| Tiles | The sketch's tiles: name, status chips, entry count and edited date. Fills as many columns as fit |
| Click a book | Opens it in a new tab |
| Middle-click, Ctrl-click | Opens it in a background tab |
| Right-click, ⋯ | Open · Open in background tab · Make global · Rename · Move to folder · Export · Snapshots · Delete |
| Drag a book | Onto a folder header to move it there |
| Selection bar | Replaces the header while books are selected: ✕, "N selected", Move to folder, Export, Select all, Delete (Undo toast) |

List is the default because it fits more books and lines up the numbers; Tiles
stays for people who like the sketch's look (also in ⌄ › View).

### Book (two panes)

Opening a book shows its entries on the left and one entry on the right. There
is no separate book page: the left pane is the book.

**Left pane** (270px, drag its edge to resize from 200 to 460px, double-click
the edge to reset):

| Part | What it shows or does |
|------|-----------------------|
| Book name ▾ | Open in Hero mode · Book settings · Rename · Duplicate · Move to folder · Export · Snapshots · Delete book |
| Status line | Global chip (click to toggle), Linked chip (click for the links menu: each link with Unlink, Link to this chat, Link to the character), entry count |
| Filter box | Filters the list by name and keyword. "/" focuses it |
| + | New entry (Alt N); it opens on the right with the name ready to type |
| Folder header | Name, count, collapse arrow, + on hover for a new entry in it. Drop entries on it to move them there |
| Entry row (32px) | Strategy stripe, name, keywords in gray ("always on" for Permanent, "by meaning" for Vectorized), a teal dot when it has story logic, a red ! for a problem. On hover: on/off switch and ⋯. Off rows show their switch always and are dimmed |
| Click a row | Shows the entry on the right |
| Ctrl/Shift-click | Selects several; the right pane becomes the bulk pane |
| Middle-click | Opens the entry in a background tab |
| Right-click, ⋯ | Open in new tab · Turn off · Duplicate · Move to folder · Move to another book · Copy as text · Delete. With several selected, the same for all of them |
| Drag rows | Onto a folder header (or the empty list for No folder) |
| Keyboard | ↑ ↓ move, Shift ↑ ↓ extend, Space turns on/off, Enter goes to the title, Delete deletes (Undo toast) |
| Footer | Book settings · "N problems" when there are any (click goes to the first) |

**Right pane: entry.** The shared entry page, with these desktop changes:

- A thin top line: the book and folder as a breadcrumb, then ∧ ∨ (previous
  and next entry, also Alt ↑ ↓) and ⋮. The ← and the entries drawer are gone;
  the left pane does both jobs.
- The "Story logic · 3 rules" chip under the title opens the Story logic
  section and scrolls to it. The section itself is as on phones (folded, read
  only, "Edit in Hero mode ›").
- Labels sit in a left column (Strategy, Keywords), values on the right.
- Strategy is a menu with a one-line hint per choice.
- Keywords are chips with a typing box at the end: Enter or comma adds, Tab
  adds, Backspace on an empty box takes the last chip back to edit, × on a
  hovered chip removes it, double-click a chip edits it, pasting a
  comma-separated list splits it.
- Parameters, unfolded, are real controls in two columns (selects, number
  boxes, checkboxes), grouped as on phones. Changed labels turn accent. The
  folded header still sums up what isn't default.
- Content grows with its text; the pane scrolls, not the box.

**Right pane: several selected.** "N entries selected", their names, then
Turn on · Turn off · Move to folder · Move to another book · Duplicate ·
Delete, then "Edit together" with the bulk rows (Mixed where they differ) and
"Apply to N entries".

**Right pane: Book settings** (from the book menu or the footer): Where it is
active (Global switch, the links with Unlink, Link to this chat), New entry
defaults (the parameter grid), and Export, Snapshots, Duplicate, Delete book.

**Narrow drawer** (under 640px, from a small window or a low Chat width): the
left pane becomes an overlay. A panel button at the left of the top line opens
it; picking an entry closes it.

### Keys

| Key | Where | What it does |
|-----|-------|--------------|
| Ctrl K | Anywhere | Search overlay |
| / | Not typing | Focus the filter box |
| Alt N | Home / book | New book / new entry |
| Alt ↑ ↓ | Book | Previous / next entry |
| Ctrl D | Book list | Duplicate the selected entries |
| Ctrl A | Home | Select every book |
| Delete | Selection | Delete (Undo toast) |
| Esc | Anywhere | Closes a menu or the search, then clears a selection, then leaves a text box, then closes WI Hero |

Browser keys (Ctrl W, Ctrl T, Ctrl Tab) are left alone: WI Hero lives inside
ST's page, and taking them would close or switch the browser tab.

### Open questions

- Should a tab still be able to show one entry only (phones' entry tabs), or is
  "a tab is a book" enough?
- Tiles or list as the default on Home.
- Whether the left pane should also show a short content preview per row
  (two lines, like a mail client) when it is wide.

---

## Desktop: Hero mode (draft)

### Size

- Hero mode opens **widened**: the whole window under ST's top bar, side to
  side and down to the bottom (over ST's send form). A canvas needs the room.
- A button in the tab row (next to ×) shrinks it to the drawer size Normal
  mode uses, and back. It is remembered.
- At drawer size the entry list starts hidden; the canvas toggle (top left)
  shows it.

### Tab row

⌄, **Canvas** and **Preview** (permanent, icon only), entry tabs, empty space,
then the book picker (the book's name ▾: the book list, + New book), Search
(Ctrl K), Normal mode, Widen/Drawer size, ×.

The book picker moves here from the bottom of the entry panel: on desktop the
book is chosen once per canvas, and the tab row has the room.

### Canvas tab: three columns

| Column | What it is |
|--------|------------|
| Left: entry list (250px, drag its edge: 200 to 420px) | The phone's entry panel, docked. Filter box, +, Greetings first, then folders, then "No folder". Each row: strategy stripe, name, a red ! for a problem, and the dot: filled = on the canvas (click jumps to it), hollow = not placed (click places it in the middle of the view, or drag the row onto the canvas). Click a row to inspect it, double-click to open the entry tab, right-click: Open entry · Place/Show on canvas · Inspect. Footer: the book's links and "9 of 12 placed". Hidden and shown by the button at the canvas's top left |
| Middle: canvas | The canvas, with the piece bar under it |
| Right: inspector (320px, drag its edge: 260 to 560px) | Docked, always there; the ▯ button bottom right hides it |

Both side columns resize by dragging their inner edge (double-click resets),
and the sizes are remembered.

### Layout direction

The canvas flows **left to right**: Tidy puts the cards in columns by link
depth (a card sits one column right of everything it waits for), orders each
column by where its sources are, and centers the columns. A pack's unlinked
members join the column of a linked member, so the frame stays whole. Tidy is
in ⌄, the canvas's right-click menu, the tools on the right (above the
inspector toggle) and the key T, with an Undo toast.

Ports follow: a link between cards side by side leaves from the right edge
and enters the left edge; between cards above one another it uses the bottom
and top. A card's own lone lock or wait sits on its top edge, clear of the
lanes beside it. (The phone keeps top to bottom, which suits a tall screen.)

### Canvas: mouse

| Action | Result |
|--------|--------|
| Hover a card | Three handles appear under it at once: teal, red, yellow. After the pointer rests on the card for 350ms, its links and the cards they reach stay bright and the rest dims (the phone's focus, without a click). Moving across the canvas doesn't flicker |
| Click a card | Selects it; the inspector shows it |
| Double-click a card | The inspector's Text tab, to edit its content in place |
| Drag a card | Moves it (the whole card, not only the grip; there is no scrolling to fight with). Links follow |
| Drag empty canvas | Pans |
| Shift-drag empty canvas | Box select. Several selected cards move together; the inspector offers Pack into…, Add all to a gate…, Turn off, Take off canvas |
| Shift/Ctrl-click | Adds a card to the selection |
| Wheel | Zooms around the pointer |
| Drag from a knob or a hover handle onto another card | Makes a link: teal = the other card waits for this one, red = this one closes it, yellow = it rides along with this one. The piece bar turns into the strip for it |
| Right-click a card | Inspect · Open entry · Edit text · Add piece (all eight, with their keys) · Data · Take off canvas |
| Right-click empty canvas | "Add to canvas here": a search box, New entry here, every unplaced entry, Fit, Tidy layout |
| Click a lock or wait chip | Inspects its card with that rule open |
| Click empty canvas | Clears the selection |

### Piece bar

Under the canvas, as on phones, but every chip shows its color, name and key:
**Opens O · Closes C · Glue G · Switch S · Mask M · Pack P**, a divider,
**Lock L · Wait W**, and a hint "Or drag from a card's port to another card".

Four ways to add a piece, all ending in the same strip:

1. Click a chip, then a card (cards that can't take it dim). A banner says what
   to click, with Cancel.
2. Drag a chip onto a card.
3. Drag from a card's port or hover handle onto another card (Opens, Closes,
   Glue).
4. Right-click a card › Add piece, or the inspector's + Add logic. With a card
   selected, the key alone does it (O, C, G, …).

The strip is the phone's: Cancel on the left, Done on the right, the sentence
in between ("*The Ninefold Court* waits for *Prior Edda*" with ⇄, "and (both)
/ or (either one)", Lock, Wait). A loose end can be dropped on a card or picked
from a list.

### Inspector (right column)

| State | What it shows |
|-------|---------------|
| Nothing selected | The book: Problems (click jumps to the card), the link legend, and a short mouse cheat sheet |
| One card | Header: strategy dot, name, on/off switch, ×. Tabs **Story logic** and **Text**. Story logic: the content's first two lines (click = Text tab), a problem line, one row per rule, expanding into its editor (chips with ×, + add, + Another row), From other entries, + Add logic. Text: the content, editable, with its keywords above. Footer: Open entry · Data |
| Several cards | Their names and the group actions |

### Preview tab

A tab of its own, full width, two columns: the pretend exchange on the left
(start point chip, You and Character slots, highlights, key), the report on the
right (fire / blocked / change counts, then Fires, Blocked, Would change with
reasons). Clicking a highlight or a row jumps to that card on the canvas.

### Entry tabs

The shared entry page, as in Normal mode, with Story logic always open and
"Show on canvas ›".

### Keys (canvas)

| Key | What it does |
|-----|--------------|
| O C G S M P L W | Arm that piece; with a card selected, put it on that card |
| F | Fit |
| T | Tidy, left to right |
| + − | Zoom |
| / | Filter the entry list |
| Delete | Take the selected card off the canvas (only without links) |
| Esc | Menu, armed piece, strip (Cancel), text box, selection, then closes WI Hero |

### Open questions

- Settled: Tidy runs left to right, both side columns resize, hover dimming
  waits 350ms.
- The demo draws links with simple elbows, so two links can share a stretch;
  the real router (lanes on a 12px lattice, never through a card) already
  avoids that.
