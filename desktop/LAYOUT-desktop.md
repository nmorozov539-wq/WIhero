## Desktop: normal mode (draft)

> First pass, from the sketches in [sketches/](sketches). Demo:
> [normal-mode-demo.html](normal-mode-demo.html). Hero mode on desktop is not designed yet.

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
