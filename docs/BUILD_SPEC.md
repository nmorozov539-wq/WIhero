# WI Hero — Build spec

The document the coding thread builds from. It sits on top of
[CONCEPTS](CONCEPTS.md), [LAYOUT](LAYOUT.md) and [VISUAL](VISUAL.md) (what the
product does, where things are, how it looks) and says **how** to build it, so
that building needs as few decisions as possible.

- Checked against SillyTavern **1.19.0** (`06bde939f`). Line numbers are in
  `public/scripts/world-info.js` unless noted.
- Where this page and the other docs disagree, this page wins. The changes it
  made (marked **[spec change]** and **[layout change]**) are already applied to
  CONCEPTS, LAYOUT, VISUAL and TECHNICAL_NOTES (section 14).
- The new visuals (greeting cards, chat state, the half-height inspector, mask
  chips, color vision modes) are drawn in
  [sketch 7](sketches/7-new-pieces.html).
- Status: complete for review (2026-11-02). Decisions D1–D23 agreed with the owner.
- Building follows the roadmap's N1–N5 (section 13).

### Start here (for the coding thread)

1. Read section 1 (the decisions), then sections 2–7 (the engine).
2. Restore the old build as in 9.1 and start **N1** (section 13): the engine,
   pure and tested, then its ST wiring. No new UI is needed for N1.
3. Run the tests with `node --test`. The in-ST checks follow the old `e2e/`
   scripts (9.3), against SillyTavern 1.19.0.
4. Keep the decisions as they are. If something here turns out impossible in
   ST, stop and ask the owner rather than choosing a different behavior.

Contents: [1 Decisions](#1-decisions) · [2 Data](#2-data-on-the-book) ·
[3 Model](#3-the-model) · [4 Story state](#4-story-state) ·
[5 Rows](#5-evaluating-a-row) · [6 One turn in ST](#6-one-turn-in-st) ·
[7 Manual actions](#7-manual-actions) · [8 Editor and canvas memory](#8-editor-and-canvas-memory) ·
[9 Code layout and tests](#9-code-layout-and-tests) · [10 Known limits](#10-known-limits) · [11 Snapshots](#11-snapshots-d21) ·
[12 Screens](#12-screens) · [13 Build order](#13-build-order) · [14 Docs to update](#14-docs-to-update) ·
[15 Greetings](#15-greetings-d23)

---

## 1. Decisions

Agreed with the owner in the planning thread. User-visible, so they are not
to be changed while building.

| # | Decision |
|---|----------|
| D1 | **Locks open in the same reply.** A lock phrase in the message the user just sent opens its gate (or meets its close gate) for the reply to that message. A phrase in the character's reply can only count from the next message, since ST picks the lore before the reply exists. **[spec change]** to CONCEPTS 2.1: locks are the second exception to "from the next message". |
| D2 | **Opening is one step per message.** Anything opened by an entry firing opens from the next message. A chain can't run ahead of the chat (no spoilers). |
| D3 | **An entry closed this turn didn't happen.** It doesn't fire, opens nothing and closes nothing. Example: Tunnel closes Mill and Mill closes Bridge, all three mentioned: Mill is closed, Bridge stays open. Entries that close each other in a loop all close. Not configurable. |
| D4 | **The on/off switch is a pause.** An entry that is off injects nothing, glue included. Its story state is untouched, and a hold carries on when it's turned back on. The switch belongs to the book, so rewinding the chat never touches it. |
| D5 | **Reopen restores the entry as it was just before it closed** (holding again if it was holding, waiting if it was waiting), and its close gate counts afresh from the Reopen. It rewinds like everything else. |
| D6 | **After a page reload WI Hero starts on Home** (normal mode), like ST starts on its main screen. Tabs are not restored. Closing WI Hero while ST stays open only hides it, so reopening returns to exactly where it was. |
| D7 | **Each book's canvas remembers how it was left**, across reloads: card positions, port sides, the mask layer shown on each card, and the camera (pan and zoom). |
| D8 | **Canvas placement.** A book with no pieces opens to an empty canvas; the user places entries by hand. A book with pieces gets its linked entries arranged automatically once, then every card stays put. A newly linked card goes in the nearest free spot beside the card it was linked from. Only Tidy rearranges, and Tidy has Undo. |
| D9 | **Layout is local.** Positions live in this ST install's extension settings, never in the book. A book exported or imported elsewhere gets the automatic arrangement there. |
| D10 | **Export is ST's file.** Exporting a book from WI Hero downloads the same JSON file ST would. Story logic travels with it (section 2); layout doesn't. |
| D11 | **Card-embedded books keep their story logic** (section 2). ST's own "import the embedded lorebook?" prompt is left alone: yes gives a normal book with working story logic, no means the book is never used. |
| D12 | **Links are always drawn in full**, however far they run across the canvas. No stubs or cut-off links (explored in the sketches and dropped: it trades one kind of clarity for another). The demo's grid router is used as it is. |
| D13 | **Preview runs the real engine** (the same `src/engine/` code as the chat) for every rule, never a separate rule checker, so it can't disagree with what happens in a chat. Only keyword matching is its own, since it doesn't run ST's scan. It follows D1: a lock phrase in the pretend reply shows as "from the next message". |
| D14 | **The inspector opens half height** with the card visible above it. Top: the first two lines of the entry's text (tap to open the entry). Then one plain sentence per piece, the same sentences as the entry page's Story logic; tapping one expands it for editing, one at a time. Tapping a port opens the inspector with that piece expanded. Help lines sit behind a small "?". Drag up for full height. **[layout change]** to LAYOUT "Inspector" (was: every piece expanded with its help line). |
| D15 | **Mask text is written on the entry page** through a row of chips above Content: "Main · ruined · rebuilt". A chip switches the text box to that version, with its own token count; a dot marks the version active in the open chat. The inspector's mask block has "Edit text", which opens the entry on that chip. **[layout change]** to LAYOUT "Entry page" (was: mask blocks stacked under Content). |
| D16 | **Mask text is stored in the book**, in `extensions.wihero.masks[].content`, so it travels with export and cards. Not as extra hidden ST entries. Accepted: ST's vector search only knows the main text. |
| D17 | **"Show chat state"** is a switch in ⌄ (Canvas section), off by default. When on, cards show the open chat's state at its latest message: fired count, closed (dimmed and struck), holding (glue bar lit), waiting on the gate (hollow). |
| D18 | **Reopen lives in the inspector.** A closed entry's inspector starts with one line: "Closed in this chat by *Tunnel* · Reopen" (or "by a rule that no longer exists"). Shown only with a chat open in which the entry is closed. |
| D19 | **Problems** put a red "!" on the card and on the entry's row in normal mode. ⌄ gets "Problems (n) ›", a sheet listing them; tapping one opens that entry's inspector. Warnings are listed there in yellow, without badges. |
| D20 | **Editing story logic mid-play is safe.** The chat's state is mostly history (what fired and when); after an edit, the next message is worked out with the new rules on the same history. Deleted entries' history is ignored. Closed stays closed even when the rule that closed it is removed; Reopen (D18) is the way back. |
| D21 | **Snapshots are manual.** A "Snapshot" button saves a named copy of the whole book; nothing is copied automatically except one "As imported" copy, kept the first time WI Hero sees a book. Restore puts the book back (with Undo) and leaves the chat's story state alone. Saving stays automatic. Details in section 11. |
| D22 | **No color customizing.** No pickers and no documented overrides. WI Hero's own colors (pieces, strategies) are fixed; everything else follows the user's ST theme. The only choice is a **color vision mode** in ⌄ Display: Standard · Red-green safe · Blue-yellow safe. Each mode is a second set of the same named colors (VISUAL.md 2), chosen so opens, closes, glue, masks and packs stay apart under that kind of color blindness, checked with a simulator. Shapes already back up the colors (closes are dashed with an arrow and bar), and stay as they are. Saved in the extension settings as `colorMode`. |
| D23 | **Greetings are node points on the canvas.** A greeting card is not an entry and copies nothing: it stands for one greeting of a character and counts as fired from the chat's first message when that is the greeting the chat opened with. Other entries use it like any entry (gates, close gates, mask rows), and it can carry Gates for and Closes for, so each greeting can start its own scenario. Named like ST: Greeting, Alt 1, Alt 2…; the second line shows the greeting's opening words. **Only the open chat's character's greetings are shown**; with no chat open, no greetings show. Stored in the book only, the card is never touched. Single-character chats only for now. Details in section 15. |

---

## 2. Data on the book

### 2.1 Where it lives

**[spec change]** Story logic is stored at **`entry.extensions.wihero`**, not
in a top-level `wihero` field (CONCEPTS 8 and TECHNICAL_NOTES 8 said top level).

Why: when ST embeds a book in a character card
(`convertWorldInfoToCharacterBook`, `src/endpoints/characters.js` 663) it
rebuilds every entry from ST's known fields plus `...entry.extensions`, and on
import (`convertCharacterBook`, 5617) it again keeps `extensions:
entry.extensions ?? {}`. A top-level field is dropped both ways; a key inside
`extensions` survives both ways. Plain book export and import copy the whole
file, so either place works there.

- Native entries may have no `extensions` object yet: create it when writing.
- Never replace `extensions`, only set or delete its `wihero` key, since other
  tools keep data there too.
- For books imported from a card, keep `originalData` in sync the way section 9
  of TECHNICAL_NOTES describes: also set `originalData.entries[i].extensions.wihero`.

### 2.2 Fields

As CONCEPTS 8, unchanged: `id`, `gate`, `gatesFor`, `closeGate`, `closesFor`,
`glue`, `switch`, `masks`, `packs`, `once`, `by`. A ref is an entry id, a pack
reading (`#town`, `#town:all`, `#town:2`), `{lock: [...], by?}` or `{wait: n, by?}`.

### 2.3 Reading older books

On load, normalize in this order, in memory only. The book is rewritten only
when it is next saved from WI Hero.

1. A top-level `entry.wihero` (the old build) is read as `extensions.wihero`;
   on the next save it is moved there and the top-level field deleted.
2. Old field names, as TECHNICAL_NOTES 12: `gates` → `gate` (with old
   `gateMode: 'any'` meaning one row per item, otherwise one row), `closes` →
   `closesFor`, `labels` → `packs`, `closeGates: true` → `closesFor` links to
   the gate's entries, old glue end conditions → `{mode: 'hold'}` plus close
   gate rows, masks' `gates`/`gateMode` → `gate` rows.
3. `folder` and `color` (old UI fields) move to the extension settings
   (section 8) on the next save.

### 2.4 Ids

- Entries refer to each other by `wihero.id`, never ST's `uid`, so renumbering
  on import or a move between books doesn't break links.
- An entry gets an id the first time it gets a piece: a slug of its title,
  made unique within the book (`mill`, `mill-2`).
- Duplicating an entry copies its id. That's caught as "two entries with the
  same id" (CONCEPTS 5), and WI Hero's own Duplicate gives the copy a fresh id.

---

## 3. The model

`buildModel(entries)` turns the books' entries into the structure every other
step reads. It is pure, built once per change of the books (on
`WORLDINFO_ENTRIES_LOADED` when the books changed, and in the editor).

### 3.1 Expansion

Everything is reduced to two kinds of rule per entry, so that evaluation has
one path:

- **Open rules** (`opens[id]`): the entry's own `gate` rows, and on top (AND)
  every Gates for that targets it, directly or through a pack it is in.
- **Close rules** (`closes[id]`): a list of rows. They come from
  - its own `closeGate` rows,
  - each Closes for that targets it (directly or through a pack): one row
    `[source]`,
  - each Switch it is a path of: one row `[otherPath]` per other path,
  - `once`: a row `[{self: true}]`, met once the entry has fired (it closes
    from the next message, D2).
- Each close row remembers where it came from (`{kind: 'closeGate' |
  'closesFor' | 'switch' | 'once', source}`) so Preview and the entry page can
  say why something closed.
- Masks get their own `opens` and `closes` from their `gate` and `closeGate`.
- Ride-along glue: `riders[host] = [ids]`.

### 3.2 Problems

Exactly CONCEPTS 5. An entry with a blocking problem never fires (it is
removed at load, section 6.3). A malformed mask is skipped, the entry keeps
its content. Warnings are listed, never block. Loops are found with a
depth-first search over gate edges, Gates for and pack membership (the old
`findCycles` does this).

---

## 4. Story state

### 4.1 Where

On every chat message that a counted generation produced, at
`message.extra.wihero`, and on the current `swipe_info[swipe_id].extra.wihero`
(TECHNICAL_NOTES 7). The state for a scan is the snapshot on the last message
that has one, or the initial state.

### 4.2 Shape (version 2)

```js
{
  v: 2,
  at: 14,                      // chat index this snapshot was written at
  fired:   { mill: 2 },        // times fired
  firstAt: { mill: 3 },        // chat index of the first firing
  lastAt:  { mill: 9 },        // chat index of the latest firing
  closed:  { road: { at: 9, by: 'closesFor:mill', wasHolding: false } },
  holding: { storm: { since: 7 } },
  latches: { 'gatehouse|g|<rowhash>|0': 12 },   // lock matched, at chat index
  baseline:{ storm: 20 },      // Reopen: close rules count from here (D5)
  masks:   { closed: { 'inn/night': 11 }, pick: { inn: 'night' } },
  round:   ['Book.12', 'Book.4']   // world.uid keys that fired this turn, for the panel
}
```

- **Row keys**: `<entry id>|g|<hash>` for gate rows, `|c|` for close rows,
  `|m:<mask name>|g` / `|m:<mask name>|c` for masks, where `<hash>` is ST's
  `getStringHash` of the row's canonical JSON. Editing a row changes its key,
  so its latches are forgotten and it starts over. That is intended.
- **Version 1 snapshots** (old build) are read as v2 with `firstAt` and
  `lastAt` set to the snapshot's own index for every fired entry, `glued`
  becoming `holding`, and no latches. Waits counted from those entries may run
  out a little late; nothing else changes.
- Chat indexes count every message in `chat`, so swipes and deletes line up
  with ST's own `mesId`.
- **Keys are per book.** Several books can be active in one chat, and ids are
  only unique within a book, so every key in the state is `<book>/<id>`
  (`Eldoria/mill`), greetings `@<char>:<n>`. Renaming a book records
  `renamed: { old: new }` in the extension settings, and `readState` maps old
  keys through it, so existing chats keep their state.
- **Size.** A snapshot only lists entries that have fired, closed, held or
  latched, never every entry, and `round` holds only this turn. With a few
  hundred entries fired it stays a few KB per message. If chats grow too big,
  the later fix is storing only the changes from the previous snapshot; not
  needed now.

---

## 5. Evaluating a row

`rowMet(row, ctx)` where `ctx = { state, now, key, texts, baseline }`.

1. Split the row into **plain items** (entries and pack readings), **waits**
   and **locks**.
2. **Plain items** are met when:
   - entry `x`: `fired[x] > 0`, and for close rules after a Reopen, `lastAt[x] >= baseline`;
   - `#p`: any member met; `#p:all`: every member; `#p:n`: at least n members.
   Their **done time** is when the last of them became true: the entry's
   `firstAt` (or `lastAt` when `firstAt` is before the baseline); for packs the
   member time that satisfied the reading (the earliest, the latest, or the
   n-th earliest). A row with no plain items has done time 0, the start of the chat.
3. **Waits** run out when, counting from the plain items' done time, at least
   `n` messages have been added since (only user messages for `by: 'user'`,
   only replies for `by: 'char'`). Counted from `chat` directly, so it rewinds
   by itself. The wait's done time is the index of the message that ran it out.
4. **Locks** are armed once the plain items and waits of the row are met. An
   armed lock is met if its latch exists, or if one of its phrases is found
   now in `texts` (then the caller writes the latch). Phrases are matched as
   whole words, case-insensitive, against the side `by` says (both if unset).
   Several locks in one row latch independently; the row needs all of them.
5. The row is met when all its parts are. A gate opens when any row is met; a
   close rule closes when any row is met.

`texts` is what a lock may see at that moment (section 6): the newest user
message and the newest reply in the chat.

---

## 6. One turn in ST

ST events in the order they happen during one chat generation. Every step is
idempotent, since ST may scan more than once per generation (dry runs, token
counting, the extra pass below).

### 6.1 `GENERATION_STARTED (type, options, dryRun)`

Remember whether this generation **counts**: `normal`, `swipe`,
`regenerate`, `continue`, and not a dry run (TECHNICAL_NOTES 6). Rules still
**apply** to every generation, counted or not, so a summary never sees
spoilers.

### 6.2 Before the scan: `stateForScan(chat)`

A pure function of the chat, recomputed whenever needed (cheap):

1. Take the last snapshot (4.1), or the initial state.
2. Latch every lock that is armed and whose phrase is in the newest user
   message or the newest reply (**D1**: the user's just-sent message counts now).
3. Apply close rules whose rows are now met (locks just latched, waits that
   ran out): those entries are **closed before the scan**, and their holds end.
4. Return the working state. It is saved in the pending turn (6.7) so the
   latches and closes made here end up in the snapshot.

In `GENERATION_AFTER_COMMANDS`, also call `getSortedEntries()` and emit
`WORLDINFO_FORCE_ACTIVATE` with the processed copies of every entry that is
**holding**, not closed, not off and without a blocking problem (TECHNICAL_NOTES 3).

### 6.3 `WORLDINFO_ENTRIES_LOADED`: remove what may not fire

Only ever **remove** entries (`splice`), never edit them, because of ST's hashes
(TECHNICAL_NOTES 1–2). Remove an entry when, in the working state:

- it has a blocking problem, or
- it is closed, or
- its open rules aren't met (gate not open, a Gates for source not fired),
- **unless** ST is about to hold it by sticky (`timers.js` from the old build):
  a running sticky finishes.

Ride-along entries whose own gate is open are **kept** here even though they
may only fire with their host: the filter happens after the scan, and keeping
them gives the processed copy needed to force them in.

### 6.4 `WORLDINFO_SCAN_DONE`: settle the turn

Runs after every scan loop. `args.activated.entries` is the Map of everything
activated so far (TECHNICAL_NOTES 4). Work out the whole turn again each time
from that Map, in this order:

1. **Switch ties.** For each switch, of its paths in the Map only the first in
   switch order stays; the others are victims (dropped and closed).
2. **Who triggers.** For an entry with `by`, keep it only if at least one of
   its primary keywords is found, within its scan depth, in messages from the
   allowed side (case and whole-word settings as the entry's, regex keys with
   ST's exported `parseRegexFromString`). Entries in by sticky, by glue or as
   Permanent are exempt. Entries that only matched through recursion are
   dropped. This is a filter on ST's own match, so ST still does the real
   matching.
3. **Closing (D3).** Let T be the entries left. Decide which of them are
   victims:
   - An entry is **safe** once every close rule that could close it this turn
     is impossible: a row that isn't met even counting every undecided entry
     in T as fired, or whose this-turn items include a victim.
   - An entry is a **victim** once one of its close rows is met using only
     entries that fired before (`state.fired`) and safe entries of T.
   - Repeat until nothing changes. Entries still undecided are in a loop:
     they are all victims.
   - Example: T = {Tunnel, Mill, Bridge}. Tunnel has no close rule: safe.
     Mill's row `[Tunnel]` is met by a safe entry: victim. Bridge's only row
     `[Mill]` now includes a victim: safe. Bridge stays.
   - Victims are deleted from the Map, unless held by sticky (they are closed
     but finish their sticky). Glued victims are dropped too.
   - Entries **not** in T whose close rows are met by safe entries are closed
     as well (recorded, nothing to drop).
4. **Ride-along.** For each safe host, each rider that may fire (not closed,
   own gate open, not off) and isn't in the Map: emit
   `WORLDINFO_FORCE_ACTIVATE` with the rider's copy from `args.sortedEntries`,
   and if `args.state.next` is `scan_state.NONE`, set it to
   `scan_state.MIN_ACTIVATIONS` (3) so ST runs one more pass. That pass doesn't
   read the recursion buffer (line 323) or activate delayed-recursion entries
   (4860), so it only adds the riders, and ST's own cooldown, delay,
   probability and budget still apply to them. A rider in the Map whose host
   isn't a safe member of T is dropped (it may only fire with its host).
5. **Masks.** For each activated entry with masks, set `entry.content` on the
   Map's copy to the chosen text (CONCEPTS 3.7): a hand pick wins, else the
   last mask whose open rules are met and that isn't closed (counting masks
   closed in step 3's way by safe entries this turn), else main. Never write
   to the book; the copies are ST's clones (TECHNICAL_NOTES 4).
   ST substitutes macros (`{{char}}`, `{{user}}`…) in the content before this
   event (line 5058), so run mask text through `substituteParams` from
   `getContext()` when swapping it in. ST's regex scripts run later (5204) and
   apply to mask text by themselves.
6. Store the victims, closes, rides and mask choices in the pending turn.

### 6.5 `WORLD_INFO_ACTIVATED`

The final Map, after budget. If the generation counts, store the fired keys in
the pending turn. Dropped entries are not in it, so they don't count as fired.

### 6.6 `MESSAGE_RECEIVED (mesId, type)`: write the snapshot

`advance(working, pending, model, chat)`:

1. Fired entries: increase `fired`, set `firstAt` if unset, set `lastAt`.
2. Closes recorded in 6.4 go into `closed` (`by` says why, `wasHolding` set).
3. New holds: a fired entry with `{mode: 'hold'}` that isn't closed starts
   holding.
4. Latch locks that are now armed and whose phrase is in the **new reply**
   (they act from the next message, D1).
5. Close rules met now (Once after a first firing, close rows met by this
   turn's fires or the new latches) close their entries from the next message.
   Closing ends a hold (CONCEPTS 2.2 rule 3) and records `wasHolding`.
6. Masks whose close rows are met are closed the same way.
7. Write the snapshot on `chat[mesId].extra.wihero` and on the current
   `swipe_info` entry.

**Continue** lands on the same message: start again from the state before
that message, with the fired set being the union of what fired in the first
generation and in the continue. **Swipe** and **regenerate** start from the
state before the replaced reply, automatically, because that's the last
snapshot. A generation that ends without a message (`GENERATION_ENDED` with
nothing received, a stop, an error) drops the pending turn.

### 6.7 The pending turn

One object per generation, created in 6.1, filled by 6.2–6.5, written in 6.6,
dropped on chat change or an aborted generation. Dry runs and uncounted
generations never create one; they still use `stateForScan`.

---

## 7. Manual actions

Written onto the **latest message** in the chat (creating its snapshot from
the current state if it has none), so they rewind like everything else.

- **Reopen (D5)**: delete `closed[id]`; if `wasHolding`, put it back in
  `holding`; set `baseline[id]` to the current chat length, so close rules
  only count fires and latches from now on.
- **Pick a mask**: `/wihero-mask entry=<id> <name>` sets `masks.pick[id]`;
  without a name it deletes it.
- **On/off switch (D4)**: ST's own `disable` field on the entry. Story state is
  not touched. A disabled entry is skipped by ST before external activation
  (4800–4890), so a hold pauses by itself.

---

## 8. Editor and canvas memory

### 8.1 The editor overlay (D6)

- WI Hero is one element on `document.body`. ST's World Info button opens it.
  Closing **hides** it (`display: none`), keeping all its DOM and in-memory
  state: tabs, scroll positions, open sheets closed.
- Nothing about the open tabs is saved. On a page reload it starts on Home.

### 8.2 What is saved, and where

All in `extension_settings.wihero`, saved with ST's `saveSettingsDebounced`:

```js
{
  openInHero: false,                 // "Open books in Hero mode"
  contentFont: 'serif',
  colorMode: 'standard',            // D22: 'standard' | 'red-green' | 'blue-yellow'
  bookFolders: { 'Fantasy': ['Eldoria', 'Tavern'] },
  books: {
    'Eldoria': {
      defaults: { ... },             // New entry defaults
      folders: { 'id:mill': 'Places/Town' },
      canvas: {
        camera: { x: 0, y: 0, zoom: 1 },
        cards: { 'id:mill': { x: 120, y: 80, ports: { gate: 'left', close: 'top' }, layer: 'night' } },
        placed: true                 // the one-time arrangement (D8) has run
      }
    }
  }
}
```

- Cards are keyed `id:<wihero id>`, or `uid:<n>` for an entry that has no id
  yet (renamed to `id:` when it gets one).
- **Renaming a book** moves its key. **Deleting a book** removes it.
  **Duplicating** copies it.
- The camera is saved when panning or zooming stops (debounced).
- Nothing here is in the book, so arranging never changes an entry's hash or
  ST's timers.

### 8.3 Placement (D8)

- **First open in Hero mode**, when `placed` is false: if the book has pieces,
  run the automatic layout on the linked entries (the old `layout.js`: break
  loops by depth-first search, rank by longest path, four barycentre sweeps,
  stack each column), save every position, set `placed`. If it has no pieces,
  just set `placed`.
- **A newly linked entry** that has no position: put it at the nearest free
  spot to the right of the card it was linked from (scan outward on a grid of
  card-sized cells, right, then below, then above, then left).
- **Tidy**: rerun the layout on everything on the canvas, keep the old
  positions for Undo.
- **Link routing** around cards uses the demo's grid router as it is. No
  further smartness in this round.

---

## 9. Code layout and tests

### 9.1 Starting point

Restore the old build from git history (`git checkout 02adbda~1 -- src test
index.js manifest.json package.json`) and change it, rather than starting over
or using glue-v1, which is older. Keep `timers.js`, `chat-state.js`,
`generation.js`, the save path in `editor.js` and `entry-model.js`, and
`layout.js`. Replace `engine.js`.

### 9.2 Engine files (pure, no ST imports)

| File | Holds |
|------|-------|
| `src/engine/model.js` | `normalize` (2.3), `buildModel` (3), problems |
| `src/engine/rows.js` | `rowMet`, done times, lock matching (5) |
| `src/engine/state.js` | v2 shape, `readState` (with v1), `initialState` |
| `src/engine/turn.js` | `stateForScan`, `mayFire`, `settleScan` (6.4 steps 1, 3, 4, 5 as data in, decisions out), `advance` |
| `src/engine/manual.js` | `reopen`, `pickMask` |

`index.js` and an `src/st-hooks.js` do the ST side: read events, call the
engine, apply its decisions to ST's arrays and Map.

### 9.3 Tests (`node:test`)

Each rule gets a test, using the sample book where possible:

- Gate rows: AND inside, OR between; pack readings any/all/n; Gates for adds
  AND; Gates for through a pack.
- Locks: not armed before the rest of the row; armed lock latches; latch
  survives later messages; user-message lock opens the same turn (D1);
  reply lock opens next turn; `by` on a lock.
- Waits: counted from the row's done time; alone from the chat start; `by`
  counts one side; wait then lock.
- Closing: close gate; Closes for; switch; Once from the next message;
  closing beats opening; D3 chain (Bridge stays open); D3 loop (both close);
  closed stays closed; sticky still finishes; glue ends on any close.
- Glue: hold starts on first firing and stays; hold ends via close gate;
  rider fires only with its host; rider stops when its host closes; rider
  dropped when its host is a victim.
- Masks: last open mask wins; mask close gate; hand pick wins; mask without a
  gate only by hand; malformed mask skipped.
- Who triggers: kept only for the allowed side; recursion-only match dropped.
- State: rewind on swipe and delete; continue unions; v1 snapshot reads; row
  edit forgets its latch.
- Greetings: fires at index 0 for the opening swipe only; swiping the greeting
  before the first reply switches the scenario; a fingerprint mismatch blocks
  it; Gates for through a pack reaches a member added later.
- Manual: Reopen restores holding and resets the close baseline (D5); on/off
  leaves state alone (D4).
- Data: top-level `wihero` and old field names normalize (2.3); a book run
  through `convertWorldInfoToCharacterBook` and `convertCharacterBook` keeps
  `extensions.wihero` (copy the two functions into a test fixture).

The old e2e scripts (`e2e/*.mjs` in history) are the base for the in-ST
checks: a chain advancing, swipe rewind, a rider, a lock, a card round trip.

---

## 10. Known limits

Accepted for now, listed so nobody rediscovers them:

- A dropped entry's text was already added to the recursion buffer in its
  loop, so it can still trigger other entries by recursion (TECHNICAL_NOTES 4).
- Masked text doesn't drive recursion; the base text does.
- If ST's "max recursion steps" is reached, the extra pass for riders doesn't
  run and the rider misses that turn.
- Who triggers checks primary keywords only; secondary keyword logic is
  ST's, applied before.
- The budget is measured on base content, not on mask text.
- Preview (N5) finds keyword matches itself, since it doesn't run ST's scan
  (the rules are the real engine's, D13). Small differences from ST's own
  matching are possible there: regex keys, secondary keys and scan depth are
  approximated.

---

## 11. Snapshots (D21)

### 11.1 Where

- In the book's menus: normal mode's book page name ▾ and book ⋯, and Hero
  mode's ⌄ (Book section): **Snapshots ›**.
- The Snapshots sheet: **Take snapshot** (asks for a name, prefilled with the
  date and time), then the list, newest first, with "As imported" pinned at the
  bottom. Each row: name, date, entry count; tap for **Restore** · Rename ·
  Delete. "As imported" can be restored but not renamed; it can be deleted.

### 11.2 Storage

- Each snapshot is the book's full JSON, written with ST's
  `POST /api/files/upload` (`{ name, data: base64 }`, `src/endpoints/files.js`
  28) into the user's `files` folder, named
  `wihero-snap-<book slug>-<timestamp>.json`. Read back with `fetch` on the
  returned path; removed with `POST /api/files/delete` (`{ path }`).
- ST has no listing endpoint for that folder, so the index lives in
  `extension_settings.wihero.books[book].snapshots`:
  `[{ name, at, entries, path, imported? }]`. Renaming or deleting a book
  carries or deletes its snapshots.
- **As imported**: taken the first time WI Hero loads a book it has no record
  of (a new import, a card's embedded book, or any existing book on the first
  run of WI Hero). One per book.

### 11.3 Restore

- Load the snapshot, then save it over the book through the usual save path
  (TECHNICAL_NOTES 9: `saveWorldInfo(name, data, true)` → `reloadWorldInfoEditor`).
  Keep the replaced book in memory for the Undo toast.
- The chat's story state is not touched (D20): the next message is worked out
  with the restored rules on the same history.
- Canvas positions are left as they are; cards of entries that don't exist
  in the restored book are dropped, new ones are placed as in 8.3.

---

## 12. Screens

LAYOUT.md is the map and stays it; VISUAL.md sets the look. The demo
(`demo/wihero-demo.html`) is the reference for anything drawn: lift its code
for ports, the grid link router (D12), AND/OR pills and lock tags, mask
stacks, pack frames and the Preview highlights, rather than redrawing them.
Its built-in rule checker is **not** reused (D13).

Changes and additions to LAYOUT, on top of what it says:

| Where | Change |
|-------|--------|
| Inspector | D14: half height, entry text preview on top, one sentence per piece, expand one at a time, help behind "?". The first line of a closed entry is the Reopen line (D18). |
| Inspector, Masks block | Each mask gets "Edit text", which opens the entry on that mask's chip (D15). |
| Entry page, Content | D15: chips "Main · *mask* · …" above Content (Hero mode only, as now); one text box; token count per version; a dot on the version active in the open chat. Replaces the stacked mask blocks. |
| Entry page, Story logic | A closed entry adds "Closed in this chat by *X*" with Reopen, as in the inspector. |
| ⌄ Display, both modes | "Colors": Standard · Red-green safe · Blue-yellow safe (D22). |
| ⌄, Hero mode | Canvas section: "Show chat state" switch (D17). Book section: "Problems (n) ›" (D19) and "Snapshots ›" (section 11). |
| ⌄ / book menus, normal mode | Book page name ▾ and book ⋯: "Snapshots ›". The Problems row shows on the book page's ⌄ when the book has problems. |
| Cards | Red "!" badge for a blocking problem (D19). With chat state on: fired count, closed dimmed and struck, glue bar lit while holding, hollow while waiting (D17). |
| Normal mode rows | Red "!" after the name for an entry with a blocking problem. |
| Preview | A lock phrase in the pretend reply reads "opens the lock from the next message" (D1). Fix the demo's missing colon in lock explanations ('"red beard": the lock…'). |
| Canvas, first open | D8: arrange once, or the empty-canvas line when the book has no pieces. |

Everything else (tabs, ⌄ structure, sheets and Undo toasts, Home, book page,
selection, entry panel, Back order, Preview layout) is built as LAYOUT says.

---

## 13. Build order

The roadmap's steps, with what this page adds to each. Each ends with
something testable, as in ROADMAP.md.

| Step | Contents | Done when |
|------|----------|-----------|
| **N1 Engine** | Sections 2–7 and 10: `extensions.wihero`, normalizing old books, the model, state v2, rows, the turn in ST, manual actions. No new UI; the old panel can show state for testing. | The tests in 9.3 pass, an old-build book loads with the same behavior, and in ST a chain advances, a swipe rewinds it, a rider rides, a lock opens in the same reply, and a card round trip keeps the logic. |
| **N2 Shell and normal mode** | LAYOUT's shared parts and normal mode, the color vision modes (D22), D6 (hide, start on Home), section 8.2 settings, Snapshots (11), problem badges on rows. | As ROADMAP N2, plus: a snapshot can be taken and restored with Undo. |
| **N3 Canvas** | Canvas drawing lifted from the demo, 8.3 placement, D7 memory, D17 chat state, problem badges. | As ROADMAP N3, plus: camera and mask layers survive a reload, and chat state matches the open chat. |
| **N4 Inspector** | D14, D15 (entry page chips), D18 Reopen, D19 Problems sheet, target picker, Story moves on, greeting cards and their inspector (15.4). Greeting refs in the engine (15.1–15.3) go in N1. | As ROADMAP N4, plus: Reopen works and rewinds, and mask text is edited through the chips. |
| **N5 Preview** | LAYOUT's Preview on the real engine (D13). | As ROADMAP N5, plus: Preview and a real chat agree on the sample book. |

---

## 14. Docs updated

Applied together with this page, so the repo doesn't contradict it:

- **CONCEPTS.md**: 2.1 (locks in the user's message count in the same reply,
  D1); 2.2 (an entry closed this turn didn't happen, D3; the on/off switch is a
  pause, D4); 6 (Reopen restores holding and restarts the close gate, D5;
  editing mid-play, D20); 8 (`extensions.wihero`, mask text in the book,
  snapshots); a new section for greetings (D23); 9 (Reopen and the problem list are decided: D18, D19; the canvas
  state filter is D17).
- **LAYOUT.md**: Inspector (D14), Entry page (D15, Reopen line), ⌄ menu rows,
  cards, the "Not in the demo" list (now: snapshots, chat state, problems,
  Reopen).
- **TECHNICAL_NOTES.md**: section 8 (where config lives, with the card
  round trip), 12 (point here for the turn order), add the scan-loop extra
  pass for riders and the macro substitution for masks.
- **VISUAL.md**: 6 (the two color vision sets next to the standard piece and
  strategy colors, D22).
- **ROADMAP.md**: N1–N5 point to this page.
- **README.md**: points to this page as the place to start building.

---

## 15. Greetings (D23)

### 15.1 What a greeting is

- In ST a chat's first message is the character's greeting, and the alternate
  greetings are that message's swipes (`chat[0].swipes`, `swipe_id` 0 is the
  main greeting). A greeting card stands for one of them.
- It is a **ref**, not an entry: nothing is added to the book or the card,
  nothing is copied, nothing is sent to the model. It has no keywords, never
  injects, and never fires again after the start.
- It counts as **fired at chat index 0** when the chat's first message is that
  character's greeting with that `swipe_id`. ST only lets the last message be
  swiped, so the greeting can change only until the first reply, and the story
  state follows it with the usual rewind.
- A chat whose first message isn't a greeting (deleted, or a chat started
  otherwise) fires no greeting.

### 15.2 The ref

```js
{ greeting: 2, char: 'Seraphina.png', name: 'Seraphina', fp: '9f3a1c' }
```

- `greeting`: 0 for the main greeting, n for Alt n.
- `char`: the character's avatar file name, ST's unique key for a character
  (display names can repeat). `name` is kept for display when the character
  is missing.
- `fp`: `getStringHash` of the greeting's first 200 characters, trimmed. A
  mismatch means the greeting was edited or the greetings reordered: the ref
  is reported as a problem ("Seraphina's Alt 2 changed") and doesn't fire until
  it is re-picked from the inspector, which rewrites `greeting` and `fp`.
- In the model a greeting ref has the id `@<char>:<n>`, and the state records
  it in `fired`/`firstAt` like an entry.

### 15.3 Where its rules are stored (book only)

A greeting has nowhere of its own to store data, so every rule involving it is
written on the entries:

- **Read by an entry** (gate, close gate, mask on/off rows): the ref is a row
  item, like an entry id.
- **Gates for** from a greeting: a row item added on top (AND) of each target's
  open rules, stored as `extensions.wihero.gatedBy: [ref]` on each target.
- **Closes for** from a greeting: a close gate row `[ref]` on each target.
- **Aimed at a pack**: written on every current member with `via: '#pack'`. In
  the model, a rule found on any member with `via` applies to every member of
  that pack, so entries joining the pack later get it too; WI Hero's editor also
  writes it onto them when they join.
- A greeting takes no gate, close gate, glue, mask, once or who-triggers.

### 15.4 On the canvas and in the panel

- **Only the open chat's character.** With a single-character chat open, the
  entry panel has a **Greetings** group listing that character's greetings
  (Greeting, Alt 1, …, with their opening words). They are placed like entries
  (hollow dot, tap to place) and stay on the canvas once linked.
- **No chat open** (or a group chat): no Greetings group and no greeting cards.
  Rules aimed at other characters' greetings are kept on the entries but not
  drawn; the inspector still lists them in words ("Gate: Bob · Alt 2, another
  character").
- A greeting card has only out ports (Gates for, Closes for), a distinct
  start-card shape (VISUAL 7.5, sketch 7), and its name: "Greeting" or
  "Alt n". Its position is saved like a card's, keyed `greet:<char>:<n>`.
- Inspector: name, the opening words (tap to read the whole greeting, read
  only), Gates for, Closes for, "Used by" (entries that read it), and
  **Re-pick** when its fingerprint no longer matches.

### 15.5 Preview

- With a single-character chat open, the "starts from" chip offers the open
  chat's state, **Fresh start**, and each of the character's greetings
  ("Start at Alt 2"), so each scenario can be tried without starting a chat.
- With no chat open: Fresh start only.

### 15.6 Later

Group chats (several characters' greetings mixed in one chat).
