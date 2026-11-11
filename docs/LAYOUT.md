# WI Hero — Layout map

Part 2 of the spec: every screen, every control on it, and what it does. The
rules behind the story logic are in [CONCEPTS.md](CONCEPTS.md); colors, type and
how pieces are drawn are in [VISUAL.md](VISUAL.md). It
describes the build as of 0.42.0, and every decision is listed in
[BUILD_SPEC.md](BUILD_SPEC.md).

Phone first. Desktop (where ST uses its desktop layout, wider than 1000px) has
its own sections near the end: [Desktop: normal mode](#desktop-normal-mode) and
[Desktop: Hero mode](#desktop-hero-mode).

The two modes are **manuscript and map**: normal mode reads like pages, Hero
mode like a board. They share the chrome, the components, the type and the
entry page; only the main area differs (lists and pages, or the canvas with its
panel).

Contents: [Shared](#shared) · [Normal mode](#normal-mode) · [Hero mode](#hero-mode) · [Desktop: normal mode](#desktop-normal-mode) · [Desktop: Hero mode](#desktop-hero-mode) · [Guide and explain mode](#guide-and-explain-mode) · [Back](#back)

## Shared

### Opening the editor

- ST's World Info button opens WI Hero in place of ST's editor. So does
  everything else in ST that opens its drawer (a card's lorebook just
  imported, the character's, chat's and persona's lorebook buttons), on the
  book it asked for.
- The button stays ST's: WI Hero shows while ST's drawer is open, with the
  drawer hidden under it. So ST lights the button while WI Hero is open, and
  its other top bar drawers close each other and WI Hero as they always do.
  Closing WI Hero closes the drawer too.
- Touching or clicking inside WI Hero never closes it (ST closes a drawer on a
  press outside it).
- On a phone, a closed top bar button doesn't stay lit after it is tapped.
- Closing WI Hero only hides it: while ST stays open, it comes back exactly as
  it was left. After a page reload it starts on Home, and tabs are not
  restored (like ST, which starts on its main screen).
- It opens in normal mode, or in Hero mode when "Open books in Hero mode" is on.

### Top row

Left to right: the ☰ menu, the permanent tabs, then the other tabs, which
scroll sideways. There is no tab list.

| Control       | What it does |
|---------------|--------------|
| ☰             | Opens the menu sheet (contents per mode, below) |
| Permanent tabs | Icon only, first in the row, can't be closed. Normal mode: Home. Hero mode: Canvas and Preview |
| Other tabs    | Tap to switch. The active tab has a thin accent underline; × shows only on it. Closing a tab shows the one to its right (the one to its left when it was the last) |

Anything opened from a permanent tab opens in a new tab. Long press opens it in
a background tab. There is no "new tab" control: Home is always one tap away
and opens everything in a tab of its own.

### ☰ menu

One style in both modes: a sheet of labelled sections with one row per item,
each row showing its current value at the right. A row with choices unfolds
them under it; a switch flips in place. Either way the menu stays open, so a
pick shows its effect behind it.

| Section | Normal mode | Hero mode |
|---------|-------------|-----------|
| (top) | Mode switch | Mode switch |
| View / Book | Home: Open books in (Normal mode, Hero mode); on desktop also Show books as (Tiles, List). Book page: Sort by (List order, Prompt order, A–Z, Key words first, Permanent first, Vectorized first; inside each folder. List order is ST's list position, which drag changes; Prompt order is the Order parameter, shown on each row and editable there: a box on desktop, a button that asks on phones) · Show disabled entries (switch) · Problems (n) › when there are any · Keyword clashes (n) › and Dead branches (n) › when there are any · Snapshots › | Book: Active globally (switch) · Linked to: "Seraphina +1 ›" opens the links sheet · Switch book › · Problems (n) › · Keyword clashes (n) › · Dead branches (n) › (each when there are any) · Snapshots ›. Then Guide › |
| Canvas | | Tidy layout · Legend (switch) · Show chat state (switch, off by default) |
| Display | Content font (Serif, Sans) · Colors (Standard, Red-green safe, Blue-yellow safe) · Mark keyword clashes (switch, on by default) | The same |
| Tabs | Close other tabs | Close other tabs |

The View section is left out on the entry page.

Problems and warnings are counted apart wherever they are counted: "Problems (2) · 1 warning", or "Warnings (1)" when there are only warnings.

Keyword clashes (n) opens a sheet with one group per clashing word (“mill”) and the entries it fires; Dead branches (n) one row per entry, red when it can never fire, yellow when only a gate row or mask can't (CONCEPTS 5). A tap opens the entry (Normal mode) or shows and inspects its card (Hero mode).

**Mark keyword clashes** off takes away the yellow outline and the "also fires" line on the entry page, and the clash count on the canvas's checks chip. The Keyword clashes row stays in ☰.

### Problems sheet

From "Problems (n) ›" (its title counts the same way): every problem in the book (red), then warnings
(yellow), one line each with the entry's name. Tap one to open that entry
(its inspector in Hero mode, its page in normal mode).

### Snapshots sheet

From "Snapshots ›": **Take snapshot** (asks for a name, prefilled with the
date and time), then the snapshots, newest first, with "As imported" pinned
at the bottom. Each row shows name, date and entry count; tap it for Restore
(with an Undo toast) · Rename · Delete.

### Mode switch

The first row in ☰: "Switch to Hero mode" (or Normal mode) with the target
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
- Every other edit goes into the book's undo history (`src/ui/history.js`):
  Ctrl Z and Ctrl Shift Z (or Ctrl Y) on desktop, and the undo and redo arrows
  at the top left of the Hero canvas. It covers the entries (text, parameters,
  story logic) and the book's WI Hero settings (card places, link shapes,
  folders), not the camera. One action is one step; typing without a pause is
  one step; a piece set up in the strip is one step on Done and none on Cancel.
  In a text box the keys undo the typing instead. A change from outside WI Hero
  (ST's editor, a slash command) starts the book's history over, so Undo never
  writes over it.

### Entry page

The same page in both modes. Top to bottom:

| Part | What it shows or does |
|------|-----------------------|
| ← (round bubble) | Up to the book (normal mode) or closes the entry tab (Hero mode) |
| Entries drawer and ⋮ (a pill of two round bubbles, right) | Drawer: every entry in the book, grouped and ordered like the book page; tap one to switch to it, long press to open it in a background tab. ⋮: Open in new tab · New entry below · Duplicate · Move to another book · Copy as text · Delete |
| Title | Big, edited in place. Not sticky; the tab already shows the name |
| Book line | Book icon, the book's name and folder; tap goes up to the book |
| Story chip | Only when the entry has story logic (or other entries' rules point at it): its first rule said plainly, then how many more, "Unlocks after *Road* · 2 more rules". Tap opens the Story logic section (normal mode) or shows the card on the canvas (Hero mode) |
| Problems and warnings | The entry's own problems (red) and warnings (yellow), one line each, under the story chip |
| Strategy line | A strategy-colored dot, "Strategy: Keywords ▾" (or Permanent, Vectorized), tap for the strategy sheet. The entry's on/off switch sits at its right end. An off entry dims |
| Keywords | A bordered box with chips; tap to edit as a comma-separated line. Empty shows "Key words, separated by commas". Hidden for Permanent. A key word that also fires other entries (a keyword clash) has a yellow outline, and a line under the box says so: "**mill** also fires Old Mill". Both go away with Mark keyword clashes off (☰) |
| + Add condition | Adds ST's secondary keywords: a thin line ("And any of / And all of / But none of / But not all of ▾") over a second keyword box. One per entry |
| Story logic | Hero mode: here, before Parameters. Only when the entry has pieces. Read-only in both modes (below) |
| Parameters | Folded. The header sums up what isn't default, or "Defaults" |
| Tracker value | Only on a tracker (CONCEPTS 3.14): its value in the open chat, with Edit and Clear, above Content, which then holds the start value |
| Content | A "Content" heading with a token estimate, then borderless text in the content font (no box, on purpose: Obsidian style), "Type here" when empty |
| Story logic (normal mode) | After Content, so the text comes first for someone who only came to write. Folded |
| Mask chips | Hero mode only, for entries with masks: chips above Content, "Main · *mask* · …". A chip switches the Content box to that version, with its own token count. A dot marks the version active in the open chat |

- There is no reading mode and no bottom bar on this page. Saving is automatic.
- **Parameters**, in groups:
  - Placement: Position; Depth and Role (only for "At depth"); Order
  - Chance and timing: Probability, Sticky, Cooldown, Delay
  - Matching: Scan depth, Case-sensitive, Whole words, Recursion (can't be
    triggered by other entries, doesn't trigger other entries, only triggered by
    other entries with its level), the extra sources ST can match (persona
    description, character description, personality, character's note,
    scenario, creator's notes), Who triggers
  - Limits: Inclusion group, and with a group: Prioritize, Group weight, Group
    scoring; Ignore budget; Characters (Any, Only the ones picked, All but the
    ones picked; characters and tags); Generation types (several, none is all);
    Automation ID
  - Every one of ST's entry settings has a control. One WI Hero doesn't show
    (ST's "use probability" switch turned off) is named at the end of the
    folded summary, "Also set: probability off", so nothing is ever hidden.
  - On an entry with story pieces, Probability, Sticky, Cooldown and Delay
    each get a yellow line under them when set, saying how they can work
    against the pieces ("With story pieces: a failed roll skips it even when
    its gate is open"). Nothing changes in how they work.
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
  - An entry closed in the open chat adds "Closed in this chat by *X*" with
    Reopen, as in the inspector.

---

## Normal mode

Normal mode never shows Moments (CONCEPTS 3.13): not in the book's list, the
search, the entries drawer or any entry count. They live in Hero mode.

### Bottom bar

Shown on Home and the book page, hidden on the entry page.

Left to right: a search field, + in the middle, then New folder and Select.

| Button | What it does |
|--------|--------------|
| Search field | Opens the search overlay with the cursor in it |
| + | Home: a small sheet, New book or Import a file…. Book page: new entry |
| New folder | Home: a new, empty book folder (it shows until books are moved in). Book page: a new entry folder |
| Select | Starts selection mode |

### Search overlay

- One box. It searches book names, folder names, entry names and keywords, in
  every book.
- Results are grouped: the current book's entries first, then other books'
  entries, books and folders. With no book open, books and folders come first.
- Tapping a result opens it in a new tab; a long press opens it in a background
  tab. No commands.

### Home

| Part | What it shows or does |
|------|-----------------------|
| Header | "World Info", and a gear for ST's World Info settings |
| Book folders | Collapsible groups of books (WI Hero's own, not ST's) |
| Book row | Name, status badges (Global, the first link and a count, or Off), entry count, ⋯. Off leads to the book's page, which says how to use it |
| Tap a book | Opens it in a new tab |
| Long press | Opens it in a background tab |
| Book ⋯ | Open in new tab · Rename · Move to folder · Export · Snapshots · Delete |
| + (bottom bar) | New book (asks for a name, then opens it in a new tab) or Import a file… |

**Import** takes a lorebook file and opens it in a new tab. It goes through ST's
own import, so it takes what ST takes: ST's JSON, NovelAI (JSON or PNG), Agnai
and Risu books. ST asks before replacing a book with the same name.

**World Info settings** (sheet): every one of ST's World Info settings, so ST's
own panel is never needed. They are ST's own and apply to every book.
- Scanning: Scan depth · Recursive scan · Recursion steps (0 is no limit) · Min
  activations (0 is off; ST turns Recursion steps off with it) · Min
  activations: max depth (0 is the whole chat)
- Matching: Case-sensitive · Match whole words · Include names · Group scoring
- Budget: Budget, in percent of the context, with what that is in tokens ·
  Token cap (0 is no cap; when it is lower, the cap wins) · Alert on overflow
- Order: Book order (Sorted evenly, Character books first, Global books first)

Switches flip in place; numbers ask in a small form.

**Selection on Home**: top bar ✕, count, All/None, Invert, Delete. Bottom bar:
Move (to a folder, No folder, + New folder) and Export. Import lives under +.

### Book page

| Part | What it shows or does |
|------|-----------------------|
| Name ▾ | The book's name. Tap for List (this page), then New folder… · New entry defaults › (what new entries in this book start with; the row sums up what isn't default) · Rename · Duplicate · Move to folder · Export · Snapshots › · Delete |
| Global chip | Tap to make the book active globally or not |
| Linked chip | First linked character or chat plus a count ("Seraphina +2"). Tap for the links sheet |
| Off hint | Only while the book is neither global nor linked: "Off · No chat uses this book yet", then **Use it in this chat** (links it to the open chat; with no chat open, **Link it to a character…** opens the links sheet) and **Make it global** |
| Folder header | Name, count, collapse arrow, + for a new entry in that folder. Folders always show: they are containers, and Sort by (☰) orders the entries inside each one. Entries with no folder come first |
| Entry row | Strategy stripe (no icon), name with a teal dot when the entry has story logic, keywords, on/off switch, ⋯. The switch is quiet while the entry is on (a gray track) and stands out only when it is off (an accent outline) |
| Tap a row | Opens the entry page in this tab (from Home's tab, in a new tab) |
| Entry ⋯ | Open in new tab · New entry below · Duplicate · Move to another book · Copy as text · Delete |

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
| Rows | Tap a row to select it or let it go. There are no row checkboxes: a selected row lights up and its icon becomes a check mark, so selection isn't shown by color alone |
| Folder header | A checkbox that selects every entry in the folder |

- **Move**: lists folders, "No folder" and "+ New folder". This is the main way
  folders get made.
- **Edit…**: bulk parameters with the entry page's rows. Rows where the
  selected entries differ say "Mixed". Only changed rows are applied.

---

## Hero mode

### Top row

☰, then the **Canvas** tab and the **Preview** tab, both permanent and icon
only, then entry tabs. There is no "New tab" in Hero mode: its tabs are always
entries.

### Canvas tab

One canvas per book. Switching books switches the canvas. The ground is the
theme's own background, solid, with a faint dot grid.

**Gestures**

| Gesture | Result |
|---------|--------|
| Drag empty canvas | Pan |
| Pinch, or mouse wheel | Zoom around the fingers or pointer |
| Tap a card | Opens the inspector for that entry (with a piece armed, the piece lands on it instead) |
| Tap a line, or a lock or wait pill | Opens that piece's strip in the piece bar, with Remove. A line's strip also shapes it: the other links fade, and it shows its dots and a ghost dot halfway along each part |
| Drag a ghost dot or a dot (of the picked line) | Makes a dot there, or moves it; the line bends through it. A dot level with a neighbour snaps level. Only these dots catch a drag: a line itself still pans |
| Tap a dot, twice quickly | Picks it (Remove dot); a second tap removes it. A tap on a part of the line picks that part |
| Tap a junction | Opens the inspector on that card's gate or close gate |
| Tap a port | Opens the inspector scrolled to that piece. A knob whose links all go to a hidden mask layer flips that card to the layer instead |
| Tap a pack frame | The pack sheet. A tap on the pack's name on the frame renames it |
| Drag a pack frame by its name | Moves the whole pack (with a mouse, the frame's empty area drags too) |
| Tap ‹ or › under a card | Steps through its mask layers |
| Drag a card's grip | Moves the card. Its links show as straight guide lines while it moves and are laid out again on the drop. Held within 32px of the view's edge, the view scrolls (faster nearer the edge); so does a dot |
| Drag a port | Moves it to another free side of its card |
| Tap empty canvas | With the panel open, closes the panel. With a line's strip open, it is Done. With cards picked, lets go of them |
| Long press empty canvas, then drag | Box select (lasso): every card in the box is picked. A small box asks for a pack name (existing packs are offered as you type), with Unpack when some are in packs; the picked cards drag together by a grip |
| Long press empty canvas, let go | "Place here": a search box, New entry here, and the entries not on the canvas yet; the one picked is placed at that spot |

Cards move only by the grip (the six dots), so a drag anywhere else pans.

**Buttons on the canvas**

| Button | What it does |
|--------|--------------|
| Panel button (top left) | Opens and closes the entry panel |
| Undo and redo arrows (top left, beside it) | Step back and forward through the book's undo history (Sheets and toasts). Greyed out when there is nothing to step to, and while a piece is set up in the strip |
| Checks chip (top right) | "2 dead · 1 clash": the book's dead branches and keyword clashes (CONCEPTS 5), read from the book alone. Its mark is red when anything is dead, yellow when there are only clashes. Tap: the Dead branches or Keyword clashes sheet, or a choice of the two when there are both. Gone when the book is clean; clashes aren't counted with Mark keyword clashes off |
| "?" (top right) | Explain mode (below) |
| Fit (right) | Zooms out until every card shows. On first open the canvas fits the width of the screen instead, never below 80% zoom, from the top: a tall book scrolls down rather than shrinking until it can't be read |
| + / − (right) | Zoom |
| Zoom label (bottom left) | The current zoom |
| Legend (bottom) | The link colors: opens, closes, glue, mask, pack. Toggled from ☰ |

**Tidy layout** (☰) lays everything out again from the links, top to bottom,
and puts every port back on its default side.

### Piece bar

Under the canvas, always there, with a fold arrow (remembered). One row of chips
that scrolls sideways: **Opens · Closes · Glue · Switch · Mask · Pack ·
Tracker**, a divider, then **Lock · Wait · Moment**. Each chip has the piece's
icon and color. The bar writes the same story logic as the inspector
(CONCEPTS 3); it is the quick way to make links.

**Placing.** Tap a chip and then a card (tap the chip again to disarm), or drag
the chip onto a card; a red × cancels a drag. An armed chip shows a banner over
the bar saying what to tap, with Cancel.

**One direction rule.** For Opens and Closes the first card is always the
source, the one doing the verb: *Road* opens *Mill*, *Storm* closes *Mill*. The
banner reads "Tap the card that opens something" (or "closes something"); then
the strip says "Now tap the card it opens". Taps, chip drags, the loose end and
desktop's hover handles all go from the source to the other card. While a chip is armed or dragged,
cards that can't take it are dimmed (Glue, Switch and Mask dim Moments, which
can't start them). Lock and Wait also go on a line or a
junction. The bar then turns into the piece's **strip**: Cancel on the left,
Done on the right, its settings in between. The canvas still pans and zooms.
What the strip sets is written straight away, so the canvas shows it; Cancel
puts the book back as it was when the strip opened. Done stays grayed out until
the piece is complete. Anything that would be a problem (a loop, a card closing
itself, a broken switch) is refused with one line saying why.

A drawn Opens, Closes or Glue (ride along) line's strip also has its **shape**:
Curve · Arc · Straight · Step, Flip and Bend (curve and arc) for the part picked
on the canvas, or the whole line when none is; then Remove dot and Reset shape,
on one row with the link's Remove. The shape is kept with the link, in the
canvas settings on its source card (docs/LINK_ENGINE.md). On a phone, the picked
line's ghost dots are panned into view above the strip.

| Piece | Strip |
|-------|-------|
| Opens | A sentence, "*Road* opens *Mill* · *Mill* waits for *Road*" (the second half muted), with ⇄ to turn it around. Dropped on a card, that card is the source; a loose end goes to the card it opens: drag it onto a card, or pick one from the list. A second link into the same card asks once: "and *Road* (both)" or "or *Road* (either one)"; later ones follow. A pack source asks any, all or a number. One switch: "*Road* closes when *Mill* fires" (a real Closes link). Then + Lock and + Wait (they open those strips on this link's row), and the four line types as icons. A line tapped later shows its full shaping, Remove, and "Edit logic ›", which opens the inspector of the entry that keeps the rule |
| Closes | "*Storm* closes *Mill*", the same way: the card it is dropped on does the closing. A card closing itself is refused, pointing to Once |
| Glue | Ride along or Hold, in the sentence's row. Ride along links a host (one per card; a new host replaces the old one). Hold says what ends it, or in orange "Nothing ends it yet" |
| Switch | Dropped on the fork: its paths with ×, the order (↑ ↓) folded under "If two fire at once", a loose end for the next path, "*Paths* can't fire before *the fork* does" (on by default) and "Roll the dice" (off by default; on, a line says what it does, CONCEPTS 3.5). Done needs two paths |
| Lock | On a line or junction it joins that row (armed after the rest of it). On a card it joins its gate; a card with several gates (gate, close gate, mask rows) asks which; a card with none gets it as a gate of its own. Who says it (anyone, you, the character), then phrases as chips (any one is enough) |
| Wait | The same places. A − n + count, and whose messages count. A gate of its own counts from the start of the chat |
| Mask | Its name, **Write its text** (opens the entry on that mask), priority with ↑ ↓, "On when" (a loose end, a list, a phrase, a number of messages), and "Off when ▸" folded |
| Pack | The book's packs as chips, and "+ New pack". `town/inn` sits inside `town` |
| Tracker | No strip of its own. Dropped on a card, it makes that entry a tracker (its main text written by the model) and opens the inspector on its Tracker settings, as the inspector's Tracker switch does |
| Moment | No strip of its own. Tapped or dropped on empty canvas: asks its name and places a new Moment at that spot, with its inspector open for the phrases. On an entry: the same, placed beside that entry, then "When *it* happens, *Mill*… opens / closes", which links them |

**Make it a Moment** sits in an existing lock's strip, beside Remove: the
lock's phrases (and who says them) move to a new Moment on the canvas, and the
lock becomes a link from it, in the same row.

**Turning a link around (⇄).** A link alone in its row moves with its locks
and waits. One that shared a row leaves it, and the strip says so ("*Road* was
needed together with *Bridge*. Turned around, it's a rule of its own").

**Where it is stored** (CONCEPTS 3): Opens and Closes go in a row of the
waiting or closing card's gate or close gate; into a pack, as Gates for or
Closes for on the source. Once and Who triggers stay in the inspector.

### Inspector

Tapping a card opens the inspector, a sheet at **half height**, so the card
stays in view above it. Drag it up for full height.

| Part | What it shows or does |
|------|-----------------------|
| Header | Strategy dot, the entry's name, its on/off switch, ×. Tap the name to rename it in place: Enter or leaving it saves, Escape puts the old name back |
| Text preview | The first two lines of the entry's content, in the content font. Tap to open the entry. On a tracker it starts "Start value, until the model writes one:" |
| Reopen line | Only for an entry closed in the open chat: "Closed in this chat by *Tunnel* · Reopen" (or "by a rule that no longer exists") |
| Problems and warnings | The entry's own, one line each |
| Entry settings | Settings of the entry itself, not links: **Who triggers** (Anyone · You · Character), **Once** (a switch, "Fires one time, then closes"; on a glued entry it says "Not with glue" instead) and **Tracker** (a switch, "The AI can write to this entry"; turning it on opens its settings) |
| ST timing | SillyTavern's own Probability, Sticky, Cooldown and Delay as four small number fields, under the entry settings (not on Moments). They apply on top of the story pieces; on an entry with pieces, each one set gets a warning line saying how. A card with any of them set shows a quiet badge at its bottom right: "50% · S5 · C3 · D2" |
| Path of *fork* | Only on a switch's path: "Path of *Fork*", tap to open the switch. A gate that is only the switch's "can't fire before the fork" rule shows here instead of as a Gate row |
| Piece rows | One row per piece the entry has, in matrix order (Gate, Gates for, Close gate, Closes for, Glue, Switch, Masks, Packs, Tracker): a stripe in the piece's color, its icon and name, and the same plain sentence as the entry page. Tap a row to expand it into its editor; one is open at a time. A "?" by the name opens the Guide at that piece; an open row has a remove button (Ctrl Z takes it back) |
| From other entries | Rules other entries aim at this one: "Gates for this", "Closes this", "Another path of its fork", "Rides along with this". Tap one to inspect that entry |
| To other entries | Rules other entries keep that wait for this one: "Opens *Mill*", "Closes *Tower*", "Turns on a mask of *Inn*". The rule lives on that entry; a tap inspects it with the rule's editor open |
| + Add logic | A sheet of the pieces the entry doesn't have yet, each with its help line, then "How each piece works" (the Guide); a note says links are quicker from the piece bar |
| Footer | Open entry (in a tab) · Add note (Edit note when it has one) · Take off canvas (phones, only for placed, unlinked entries) · Data |

Tapping a port opens the inspector with that piece's row already expanded.

Piece cards:

| Piece | Editor |
|-------|--------|
| Gate, Close gate | One box per row, items as chips with × (Ctrl Z takes one back), "+ add" per row (entry, pack reading, lock phrase or wait), "+ Another row (OR)". Between items an "and" chip, between rows an "OR" chip: tapping "and" splits the row there (either one), tapping "OR" merges the two rows (both). The gate card adds a "Story moves on" button that writes Closes for to its entries, or says that it already does. A close gate can also pick "This entry" (delayed closing, CONCEPTS 3.3) |
| Gates for, Closes for | One list of entries and packs |
| Switch | Its paths, entries only |
| Glue | Ride along / Hold. Ride shows its host as a chip. Hold says what ends it ("Ends through its close gate: …") or "Nothing ends it yet" with "+ Close gate" |
| Masks | One card per mask: its name with an eye (show it on the canvas) and ⋯ (Rename, Edit text, Move up, Delete); the first line of its text (tap to edit it on the entry page, on that mask's chip); then "On when" rows. "Off when" rows show once set; until then a quiet "+ Off when…". "+ Mask" adds one, starting with a copy of the main text |
| Packs | The entry's packs as chips, "+ add" (a pack or New pack…) |
| Tracker | Each text slot (main and masks) on or off, with its label, shape, description, Show in chat and Send with its label, the value in the open chat with Edit and Clear, and "Syntax and teaching…" for the book's syntax builder (TRACKERS.md) |

**Choosing a target** (any "+ add"): a search box, then entries, then packs.
Picking a pack asks for the reading: Any of them, All of them, or a number.
Where a lock is allowed there is a "Lock phrase…" row, and a "Wait…" row.

**Moment inspector** (tap a Moment card): a spark and its name (no on/off
switch; tap the name to rename it), "Happens when someone says (any one)" with
a "?" to the Guide, its phrases as chips with × and a box to add one, Who says
it (Anyone, You, The character), "Happened in the open chat" or "Not yet in the
open chat" with chat state on, then its Gate, Gates for, Closes for and Packs
rows and + Add logic for those. Footer: Take off canvas · Delete (it refuses
while other cards use the Moment) · Data.

**Pack sheet** (tap a frame): Rename (the new name reaches every member,
nested pack and rule that uses it), "In this pack" and "Used by" (the entries
whose rules read or target it). Tap a row to inspect it.

### Entry panel

Slides in from the left over most of the canvas. It starts closed. Obsidian
style: a list first, the book at the bottom.

| Part | What it shows or does |
|------|-----------------------|
| Search box | "Search entries", matching names |
| + | New entry: asks for a name and makes it, without placing it: it waits in the panel with a hollow dot |
| Folder header | Name, count, collapse arrow |
| Entry row | Strategy stripe, name, dot. Off entries are dimmed. A red "!" for a problem |
| Moments group | First in the list: every Moment in the book (its name and phrases), placed with the dot like entries. The only list Moments are in |
| Tap a row | Opens the entry in a tab |
| Long press a row | Its menu: Open entry · Place on canvas (or Show on canvas) · Inspect |
| Dot, filled | The entry is on the canvas; tap to jump to it |
| Dot, hollow | Tap to place it in the middle of the view |
| Drag a dot | The panel slides away and the card follows the finger; it is placed (or moved) where it is dropped. A red × in the lower middle of the screen cancels: drop on it and nothing changes |
| Book picker (bottom) | The book's name ▾ with its status badges. Tap for the book list, with two icon buttons at its top: New book (asks for a name, opens it here) and Duplicate *book* (opens the copy). A long press or hover names each |

### Entry tabs

The shared entry page (above), with Story logic always open and, for an entry
with masks, the mask chips above Content.

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

## Desktop: normal mode

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
- **Widen** (a button in the tab row, remembered) makes it as wide as the
  window, still above the send form. An open side panel keeps its place: WI
  Hero then fills the space beside it, and opening one doesn't close WI Hero.
  Drawer size puts it back.

### What changes from phones

- **Mouse first.** Hover shows what a long press shows on phones: the row's ⋯,
  its on/off switch, a tab's ×. Right-click opens the same menu as ⋯.
  Middle-click (or Ctrl-click) opens in a background tab, which replaces long
  press.
- **Menus instead of sheets.** Every choice that is a bottom sheet on phones
  (strategy, folder, links, ⋮, ☰) is a menu that opens at the control.
- **No bottom bar.** Its three buttons move: Search to the tab row, + New to
  the toolbar (Home) or next to the entry filter (book), Select becomes
  ordinary Ctrl/Shift-click selection.
- **No selection mode.** Selecting is always possible: Ctrl-click adds one,
  Shift-click adds a range, Esc clears. Hovering a book shows a checkbox.

### Tab row

40px high (phones: 50). Left to right: ☰, Home, book and entry tabs, empty space,
Search (with "Ctrl K"), Widen (or Drawer size), ×.

| Control | What it does |
|---------|--------------|
| Book tab | A book icon and the book's name; it shows the two panes. Click to switch. × shows on the active tab and on hover. Middle-click closes. Drag to reorder |
| Entry tab | The strategy dot and the entry's name; it shows that entry's page alone, full width. Same controls as a book tab |
| Tab right-click | Close tab · Close other tabs · Close tabs to the right · Duplicate tab |
| Search | The search overlay (below). Ctrl K anywhere |
| Widen / Drawer size | The window's width beside any open side panel, or back to the drawer box (Size and place). Remembered |
| × | Closes WI Hero (like Esc with nothing else open) |

A book tab switches entries inside itself (the list is beside the entry). An
entry opens in **its own tab** from: middle-click or double-click on a row, Open
in new tab (⋯ or right-click), and Ctrl Enter in search. An entry tab has no
list and no ∧ ∨; its breadcrumb's book name goes to that book's tab (opening
one if needed) with the entry selected.

### Search overlay (Ctrl K)

A box near the top of the drawer, over a dimmed view. The same search as on
phones (names, folders, entry names, keywords, every book; the current book
first). ↑ ↓ move, Enter opens (in this tab for the current book, in a new tab
for another), Ctrl Enter opens in a background tab, Esc closes.

### Home

| Part | What it shows or does |
|------|-----------------------|
| Header | "World Info", List/Tiles switch (icons only: rows, a grid; the name on hover), Import, New folder, **+ New book**, gear (ST's World Info settings). No filter box: Search (Ctrl K) finds books |
| Tiles (default) | Tiles: name, status chips, entry count and edited date. Fills as many columns as fit. A checkbox shows on hover |
| List | A table: checkbox (on hover), Name, Active (Global, first link +n, or Off), Entries, Edited, ⋯ (on hover). Click a header to sort. Folders are collapsible rows inside the table; "Not in a folder" last |
| Not in a folder | Last, in both views. Hidden when every book is in a folder, except while a book is dragged (dropping it there takes it out of its folder) |
| Click a book | Opens it in a new tab |
| Middle-click, Ctrl-click | Opens it in a new tab and stays on Home |
| Right-click, ⋯ | Open · New tab (stays on Home) · Make global · Rename · Move to folder · Export · Snapshots · Delete |
| Drag a book | Onto a folder header to move it there |
| Selection bar | Replaces the header while books are selected: ✕, "N selected", Move to folder, Export, Import, Select all, Delete (Undo toast) |

Tiles are the default; the List/Tiles switch in the header (and ☰ › View)
changes it, and the choice is remembered.

### Book (two panes)

Opening a book shows its entries on the left and one entry on the right. There
is no separate book page: the left pane is the book.

**Left pane** (270px, drag its edge to resize from 200 to 460px, double-click
the edge to reset):

| Part | What it shows or does |
|------|-----------------------|
| Book name ▾ | Open in Hero mode · Book settings · Rename · Duplicate · Move to folder · Export · Snapshots · Delete book |
| Status line | Global chip (click to toggle), Linked chip (click for the links menu: each link with Unlink, Link to this chat, Link to the character), entry count |
| Off hint | Under the status line while the book is Off, as on phones |
| Filter box | Filters the list by name and keyword. "/" focuses it |
| + | New entry (Alt N); it opens on the right with the name ready to type |
| Folder header | Name, count, collapse arrow, + on hover for a new entry in it. Drop entries on it to move them there |
| Entry row (32px) | Strategy stripe, name, keywords in gray ("always on" for Permanent, "by meaning" for Vectorized), a teal dot when it has story logic, a red ! for a problem. On hover: on/off switch and ⋯. Off rows show their switch always and are dimmed |
| Click a row | Shows the entry on the right |
| Ctrl/Shift-click | Selects several; the right pane becomes the bulk pane |
| Middle-click | Opens the entry in its own background tab |
| Double-click | Opens the entry in its own tab |
| Right-click, ⋯ | Open in new tab · Turn off · New entry below (right under it, in its folder) · Duplicate · Move to folder · Move to another book · Copy as text · Delete. With several selected, the same for all of them |
| Drag rows | Onto a folder header (or the empty list for No folder) to move them there. In the List order sort (☰), dropping on a row puts them just above or below it, into that row's folder: only ST's list position (`displayIndex`) is written, never the Order parameter. Ctrl Z puts both back. Other sorts don't reorder |
| Keyboard | ↑ ↓ move, Shift ↑ ↓ extend, Space turns on/off, Enter goes to the title, Delete deletes (Undo toast) |
| Footer | Book settings · "N problems" when there are any (click goes to the first) |

**Right pane: entry.** The shared entry page, with these desktop changes:

- A thin top line: the book and folder as a breadcrumb, then ∧ ∨ (previous
  and next entry, also Alt ↑ ↓) and ⋮. The ← and the entries drawer are gone;
  the left pane does both jobs.
- The story chip under the title ("Unlocks after *Road* · 2 more rules") opens
  the Story logic section and scrolls to it. The section itself is as on phones (folded, read
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

**Narrow drawer** (under 640px, from a small window, a scaled screen or a low
Chat width): the book works as on phones. It opens on the entry list, full
width. Picking an entry shows it full width, with ← at the left of the top line
back to the list (∧ ∨ still step through entries). Ctrl/Shift-click selects on
the list, and "N selected ›" in its footer shows the bulk pane. Widen brings
the two panes back.

### Keys

| Key | Where | What it does |
|-----|-------|--------------|
| Ctrl K | Anywhere | Search overlay |
| / | Book, not typing | Focus the filter box |
| Alt N | Home / book | New book / new entry |
| Alt ↑ ↓ | Book | Previous / next entry |
| Ctrl D | Book list | Duplicate the selected entries |
| Ctrl A | Home | Select every book |
| Delete | Selection | Delete (Undo toast) |
| Ctrl Z, Ctrl Shift Z / Ctrl Y | Not typing | Undo, redo (the book on screen) |
| Esc | Anywhere | Closes a menu or the search, then clears a selection, then leaves a text box, then closes WI Hero |

Browser keys (Ctrl W, Ctrl T, Ctrl Tab) are left alone: WI Hero lives inside
ST's page, and taking them would close or switch the browser tab.

Later, not in the first build: a two-line content preview per row in the left
pane when it is wide.

---

## Desktop: Hero mode

### Size

- Hero mode opens **widened**: the whole window under ST's top bar, side to
  side and down to the bottom (over ST's send form). A canvas needs the room.
- A button in the tab row (next to ×) shrinks it to the drawer size Normal
  mode uses, and back. It is remembered.
- At drawer size the entry list starts hidden; the canvas toggle (top left)
  shows it.

### Tab row

☰, **Canvas** and **Preview** (permanent, icon only), entry tabs, empty space,
then the book picker (the book's name ▾: the book list, + New book, Duplicate *book*), Search
(Ctrl K), Normal mode, Widen/Drawer size, ×.

The book picker moves here from the bottom of the entry panel: on desktop the
book is chosen once per canvas, and the tab row has the room.

### Canvas tab: three columns

| Column | What it is |
|--------|------------|
| Left: entry list (250px, drag its edge: 200 to 420px) | The phone's entry panel, docked. Filter box, +, Moments first, then folders, then "No folder". Each row: strategy stripe, name, a red ! for a problem, and the dot: filled = on the canvas (click jumps to it), hollow = not placed (click places it in the middle of the view, or drag the row onto the canvas). Click a row to inspect it, double-click to open the entry tab, right-click: Open entry · Place/Show on canvas · Inspect. Footer: the book's links and "9 of 12 placed". Hidden and shown by the button at the canvas's top left |
| Middle: canvas | The canvas, with the piece bar under it |
| Right: inspector (320px, drag its edge: 260 to 560px) | Docked, always there; the ▯ button bottom right hides it |

Both side columns resize by dragging their inner edge (double-click resets),
and the sizes are remembered.

### Layout direction

The canvas flows **left to right**: Tidy puts the cards in columns by link
depth (a card sits one column right of everything it waits for), orders each
column by where its sources are, and centers the columns. A pack's unlinked
members join the column of a linked member, so the frame stays whole. Tidy is
in ☰, the canvas's right-click menu, the tools on the right (above the
inspector toggle) and the key T, with an Undo toast.

Ports follow: a link between cards side by side leaves from the right edge
and enters the left edge; between cards above one another it uses the bottom
and top. A card's own lone lock or wait sits on its top edge, clear of the
lanes beside it. (The phone keeps top to bottom, which suits a tall screen.)

### Canvas: mouse

| Action | Result |
|--------|--------|
| Hover a card | Three handles appear under it at once: teal, red, yellow. After the pointer rests on the card for 350ms, its links and the cards they reach stay bright and the rest dims (the phone's focus, without a click). Moving across the canvas doesn't flicker |
| Click a card | Selects it; the inspector shows it (and comes back if it was hidden; dragging a card leaves it hidden) |
| Double-click a card | The inspector's Text tab, to edit its content in place |
| Drag a card | Moves it (the whole card, not only the grip; there is no scrolling to fight with). Links follow |
| Drag empty canvas | Pans |
| Shift-drag empty canvas | Box select. A small box under it asks for a pack name (lasso to make a pack): existing packs are offered as you type, so `town/` lists the ones inside town; Enter packs the entries, Unpack (when some are packed) takes them out of their packs, Esc or a click elsewhere leaves just the selection. Several selected cards move together; the inspector offers Pack into…, Make these wait for… (each waits for the card picked), Make one wait for all of these… (the card picked waits for every one), Turn off, Take off canvas |
| Shift/Ctrl-click | Adds a card to the selection |
| Wheel | Zooms around the pointer |
| Drag from a knob or a hover handle onto another card | Makes a link from this card (the source): teal = this one opens it, red = this one closes it, yellow = it rides along with this one. The piece bar turns into the strip for it |
| Click a line | Its strip, shaping it as on a phone; dots go on the 12px grid (Alt: anywhere). Double-click the line adds a dot, double-click a dot removes it. Keys 1–4: Curve, Arc, Straight, Step; X flips; Delete removes the picked dot |
| Right-click a line | Shape link · Reset shape · Remove |
| Right-click a card | Inspect · Open entry · Edit text · Add piece (all ten, with their keys) · Add note (Edit note) · Data · Take off canvas |
| Right-click empty canvas | "Add to canvas here": a search box, New entry here, every unplaced entry, Fit, Tidy layout |
| Click a lock or wait chip | Inspects its card with that rule open |
| Click empty canvas | Clears the selection |

### Piece bar

Under the canvas, as on phones, but every chip shows its color, name and key:
**Opens O · Closes C · Glue G · Switch S · Mask M · Pack P · Tracker R**, a divider,
**Lock L · Wait W · Moment E**, and a hint "Or drag from a card's port to another card".
The fold arrow sits inside the bar at its right end. On a narrow canvas the
hint goes first, then the key letters, so no chip is ever cut off.

Four ways to add a piece, all ending in the same strip:

1. Click a chip, then a card (cards that can't take it dim). A banner says what
   to click, with Cancel: for Opens and Closes, the source first ("Click the
   card that opens something").
2. Drag a chip onto a card.
3. Drag from a card's port or hover handle onto another card (Opens, Closes,
   Glue).
4. Right-click a card › Add piece, or the inspector's + Add logic. With a card
   selected, the key alone does it (O, C, G, …).

The strip is the phone's: Cancel on the left, Done on the right, the sentence
in between ("*Prior Edda* opens *The Ninefold Court*" with ⇄, "and (both)
/ or (either one)", Lock, Wait). A loose end can be dropped on a card or picked
from a list.

### Inspector (right column)

| State | What it shows |
|-------|---------------|
| Nothing selected | The book: Problems (click jumps to the card), the link legend, and a short mouse cheat sheet |
| One card | Header: strategy dot, name, on/off switch, ×. Tabs **Story logic** and **Text**. Story logic: as on phones (the content's first two lines, click = Text tab; problem lines; Who triggers, Once and Tracker; ST timing; one row per rule, expanding into its editor; From and To other entries; + Add logic). Text: the content, editable, with its keywords above. Footer: Open entry · Add note · Data |
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
| O C G S M P R L W E | Arm that piece (R is Tracker, E is Moment); with a card selected, put it on that card |
| ? | Explain mode (one click) |
| F | Fit |
| T | Tidy, left to right |
| + − | Zoom |
| / | Filter the entry list |
| Delete | Take the selected card off the canvas (only without links) |
| Ctrl Z, Ctrl Shift Z / Ctrl Y | Undo, redo |
| Esc | Menu, armed piece, strip (Cancel), text box, selection, then closes WI Hero |

Links are drawn by the link engine on desktop too (VISUAL 7.3,
[LINK_ENGINE.md](LINK_ENGINE.md)).

---

## Guide and explain mode

### Guide

A tab of its own in Hero mode, opened at an anchor; on phones it sits next to
Canvas and Preview (a "?" tab with ×), on desktop it is a tab like an entry's.
Also reachable from ☰ › Guide. The text is in `src/ui/guide.js`.

- An index of chips, then one page per piece, in this order: Opens, Closes,
  Glue, Switch, Mask, Tracker, Pack, Lock, Wait, Moment, Once, Who triggers.
- Each page: one line, a small picture drawn in the canvas's colors, an
  example, the fine print (the rules that bite), common mistakes, and **Show
  me in the Sample book** (opens the Sample book on a matching card, when the
  Sample book is there).
- Then "On the screen": Cards and lines, Fit, Tidy layout, Undo and redo, Dead branches and
  clashes (the checks chip), Entry panel, the strip, the inspector, Preview
  highlights and Also active.
- Back closes the Guide (phones); its × closes the tab.

### Explain mode

A "?" at the top right of the canvas (phones), or in the tab row (desktop;
also the ? key), turns explain mode on **for one tap**:

- Everything that can be explained gets a thin dashed accent outline and the
  rest dims slightly. A banner at the bottom reads "Tap anything to learn about
  it · Cancel" ("Click…" on desktop).
- A tap opens the Guide at that element's anchor instead of doing the
  element's own action, and ends the mode. Back or Escape cancels.
- What can be explained: piece bar chips, ports, lines, and/or junctions, lock
  and wait pills, pack frames, mask stacks, Moment cards, other cards, the
  strip, inspector rows, Fit, Tidy, the undo arrows, the checks chip, the panel button, Preview
  highlights and Also active.

### Direct "?"

The "?" on an inspector row, a "?" in every strip (between its settings and
Done) and "How each piece works" in "+ Add logic" open the Guide at that
piece, skipping explain mode.

## Back

Android's Back (and Escape on desktop) steps back one layer at a time:

| Mode | Order |
|------|-------|
| Normal | Sheet → search → selection → the tab's history. On a tab's first screen it closes the tab. On Home it closes the editor |
| Hero | Sheet → panel → entry tab → Preview's report page → Preview to Canvas. On the Canvas tab it closes the editor |

Back never switches between the two modes.

