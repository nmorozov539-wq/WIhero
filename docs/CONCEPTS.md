# WI Hero — Concepts and functions

Part 1 of the spec: what WI Hero's story logic does and the rules it follows.
[LAYOUT.md](LAYOUT.md) maps every screen and control, and [VISUAL.md](VISUAL.md)
says how it all looks. None of them says how anything is built; that is
[TECHNICAL_NOTES.md](TECHNICAL_NOTES.md) and, for the build,
[BUILD_SPEC.md](BUILD_SPEC.md), which records every decision (D1–D31). Where they disagree with
DESIGN.md (in the git history) (the original design), these win. The
demo (in the git history) follows this model.

## 1. What WI Hero is

- A SillyTavern extension that replaces the World Info editor outright. Turning
  the extension off brings ST's own editor back. There is no Classic fallback.
- One World Info, two modes over the same books:
  - **Normal mode** edits books and entries: names, keywords, content and ST's
    parameters. Most people never need anything else.
  - **Hero mode** does everything normal mode does except book folders, and
    adds story logic, drawn as pieces on a canvas.
- Story logic only decides **whether an entry may fire** and, with masks,
  **which text it injects**. It never changes an entry's order, depth,
  position or other injection parameters.
- Nothing WI Hero adds is sent to the model. Only the entry text that gets
  injected reaches the LLM, as with plain World Info. The one exception is
  opt-in per book: a book whose trackers WI Hero teaches sends one short
  instruction ([TRACKERS.md](TRACKERS.md) 3.2).

## 2. Core rules

### 2.1 Firing

- **Fired** means World Info activated the entry this turn: a keyword match,
  recursion, permanent, vector match, or forced on by glue.
- **Changes take effect from the next message.** Story state is read once,
  before the scan. Anything that fires this turn opens or closes things for the
  following generation, never inside the same scan or recursion pass, so a
  chain can't run ahead of the chat. Two exceptions: 2.2's "closing beats
  opening", which settles conflicts inside the turn, and **locks in the user's
  message** (3.10), which open in the reply to that same message. A lock phrase
  in the character's reply counts from the next message, since the lore is
  chosen before the reply is written. **Moments** (3.13) follow the same timing
  as locks: one said in the user's message happens in time for the reply to
  it, one said in a reply happens from the next message.
- **Only chat generations count.** A generation moves the story only if its
  result lands in the chat: normal replies, swipes, regenerations, continues.
  Quiet prompts, summaries, impersonation, dry runs and other extensions' calls
  never move it.
- **ST's own rules still apply on top.** Sticky, cooldown, delay, probability,
  inclusion groups and the token budget work as usual. A running sticky finishes
  even after its entry closes. Cooldown and delay can hold back a glued entry.
  An entry held in by sticky still counts as fired.

### 2.2 Open and closed

- An entry with no pieces behaves exactly like plain World Info.
- An entry with a gate is **waiting** until its gate opens, then **open**.
- An entry is **closed** when its close gate is met, or when another entry
  closes it (Closes for, a Switch, Once).
- Three rules, with no exceptions:
  1. **Closed stays closed.** A closed entry never reopens on its own. Only a
     rewind or a manual reopen brings it back.
  2. **Closing beats opening.** If, on the same turn, one thing would let an
     entry fire and another would close it, it closes and does not fire.
  3. **Glue is not exempt.** Any close ends glue, in either mode.
- **An entry closed this turn didn't happen.** It doesn't fire, opens nothing
  and closes nothing. If Tunnel closes Mill and Mill closes Bridge, and all
  three are mentioned in one message, Mill closes and Bridge stays open.
  Entries that close each other in a loop all close.
- **The on/off switch is a pause**, not a story event. An off entry injects
  nothing and doesn't fire, glue included, and switching it changes no story
  state: a hold carries on when it's turned back on. The story keeps moving
  while it's off, though: its close gates and locks still read what other
  entries fire and what is said, so it can close while off and comes back
  closed. The switch belongs to the book, so rewinding the chat never touches
  it.

### 2.3 Story state lives in the chat

- After every chat generation, the full story state (what fired and how often,
  what is closed, which glue is holding, which locks and waits are armed,
  which switch path was taken, which mask is active, any hand-picked mask) is
  saved on that message, per swipe.
- The next generation starts from the last message that still carries state.
  Swiping, deleting, editing or branching drops the state of the removed
  messages, so the story **rewinds by itself**. No replay, no global flags.
- State is per chat, not per character: two playthroughs of the same book never
  share progress.
- A new chat starts fresh: every gate shut, nothing fired, except the greeting
  it opened with (3.12).
- State is kept per book, so two active books that both have a "mill" never
  mix.

## 3. Pieces

**Pieces** is the umbrella word for every story-logic item. Each has one name,
used everywhere: on the canvas, in the inspector, on the entry page and in
Preview.

The four core pieces form a matrix. Each rule can be written on the entry it
affects, or on the entry that causes it:

|            | On the entry itself | On the source, aimed at others |
|------------|---------------------|--------------------------------|
| **Opens**  | Gate                | Gates for                      |
| **Closes** | Close gate          | Closes for                     |

On the canvas the matrix is two pieces, **Opens** and **Closes**, and the
side a rule is written on is the link's direction: the piece bar stores it in
the waiting or closing entry's row, and as Gates for or Closes for only when
the other end is a pack ([LAYOUT](LAYOUT.md#piece-bar)). Both sides mean the
same to the engine.

Around them: **Glue** (keeps an entry on), **Switch** (a fork), **Masks**
(alternate text), **Packs** (tags), and two entry settings, **Once** and **Who
triggers**. **The story moves on**, **Once** and **Switch** are shortcuts: each
is a quick way to write close rules (3.5).

### 3.1 Gate

What the entry waits for before it may fire.

- A gate holds **rows**. Each row means "all of these". The gate opens as soon
  as **any** row is complete. One row of several items is AND; several rows of
  one item each is OR.
- Items in a row: an entry (it has fired), a pack reading (3.9), a lock (3.10)
  or a wait (3.11).
- A **merge** (several rows into one entry) is different from a **fork** (a
  Switch, where only one way goes on).

### 3.2 Gates for

The same rule as a gate, written on the source: "these entries or packs also
wait for me".

- Every target also needs this entry to have fired. It is added on top of the
  target's own gate (AND), whatever the target's rows say.
- A target with only this rule is still gated.

### 3.3 Close gate

The gate's mirror: when this entry closes for good.

- Built exactly like a gate: rows, AND inside a row, OR between rows, with
  entries, pack readings, locks and waits. It can be as small as one lock
  ("close when someone says *the rain stops*").
- Once any row is complete, the entry is closed (2.2).
- A close gate's items count from the start of the chat, like a gate's.
- An entry can't name itself in its own close gate; Once covers "close after
  I have fired".

### 3.4 Closes for

The close gate's rule, written on the source: when this entry fires, the
listed entries or packs close for good. It replaces the old Closes.

- It is the same as adding "this entry fired" as a row to each target's close
  gate.
- A running sticky on a target still finishes. Glued targets close too.

### 3.5 Shortcuts

Three common close patterns get their own control. Each one writes close rules,
so it never adds a separate mechanism.

- **The story moves on** (on the gate): one tap adds a Closes for from this
  entry to the entries in its gate. That is how a chain advances: road, then
  mill, then tunnel, each closing the one before. It writes real Closes for
  links, which can then be edited or removed like any other. With several gate
  rows it closes the entries of every row; that is accepted as normal. Once
  every gate entry is covered, the gate says so instead of offering the button.
- **Once**: the entry fires one time, then closes, from the next message on.
  Stored as its own setting. Not offered on glued entries, since glue has its
  own way of ending.
- **Switch**: makes the entry a fork with two or more paths. When one path
  fires, every other path closes for good, for this branch of the story. If two
  paths would fire in the same turn, only the first in switch order is
  injected; the others are dropped and closed. Paths are entries, not packs.
  Stored as its own list and read as Closes for between the paths.
- **Dice** (an option on a switch): the fork picks its path at random. When
  the fork fires for the first time, one open path is rolled and every other
  path closes, from the next message on. The rolled path still fires the
  usual way (its own key words, or Permanent), so a book that wants the path
  to just happen makes the paths Permanent **and gated on the fork** ("Paths
  wait for the fork"): a Permanent path with no gate fires on the first turn,
  before the roll. The roll is saved in the chat
  state (2.3) and is seeded by the message before the reply, so a swipe or a
  regenerate keeps it, and going back to before that message and writing it
  again rolls again. No roll happens when a path has already fired or closed.

### 3.6 Glue

Keeps an entry injected whether or not its keywords match. Two modes:

- **Ride along** (`{"mode": "ride", "host": "tunnel"}`): the entry fires
  whenever its host fires, and only then. When the host closes, the rider has
  nothing left to ride, so it stops too. The host is one entry.
- **Hold** (`{"mode": "hold"}`): from its first firing the entry stays on every
  turn until it closes. A hold ends **through its close gate** (or anything
  else that closes it: Closes for, a Switch). A hold with nothing that can close
  it stays on for the rest of the chat, and WI Hero warns about it.
- Glue is not exempt from closing (2.2): any close ends it.
- WI Hero warns when a glued entry has a cooldown or a probability below 100%.

### 3.7 Mask

Alternate content for the entry. The entry keeps its name, keywords, gates and
links; only the injected text changes.

- Each mask has a name, its own content, a gate ("on when") and a close gate
  ("off when"). They work like the entry's own: rows, locks, waits, packs;
  closed stays closed.
- **Order is priority.** Masks are listed in order and the **last one that is
  on wins**. Below every mask sits the entry's own content, "main".
- **Which text is injected:** a mask picked by hand wins; otherwise the last
  mask whose gate is open and whose close gate is not met; otherwise main.
- A mask with no gate is **only used when picked by hand**.
- Picking by hand: `/wihero-mask entry=<id> <name>` selects a mask, and
  `/wihero-mask entry=<id>` clears the selection. The selection is part of the
  chat state, so it rewinds with the chat.
- A malformed mask is skipped with a warning; the entry keeps its own content.
- The masked text doesn't drive recursion.

### 3.8 Who triggers

`"by": "user" | "char"` sets whose messages the entry's keywords are matched
against: your messages or the character's replies. Without it, both count.

- A book can set its own default in New entry defaults.
- Locks and waits take the same field.
- ST has no per-entry source filter, so for these entries WI Hero blocks ST's
  own keyword match and checks the keywords itself, within the entry's scan
  depth, against the chosen side only.

### 3.9 Pack

A tag that groups entries so rules can treat them as one. Packs replace the old
labels.

- An entry can be in several packs. Nesting is in the name: `town/inn` is
  inside `town`, and a rule on `town` covers `town/inn` too.
- A pack is not an object of its own: membership lives on the entries. A pack
  with no members doesn't exist.
- **Readings** live on whoever reads the pack, in a gate or close-gate row:
  - `#town` — any member has fired
  - `#town:all` — every member has fired
  - `#town:2` — at least two members have fired
- As a target, a pack takes Gates for and Closes for: the rule applies to every
  member.

### 3.10 Lock

A row item that waits for a phrase: `{"lock": ["red beard", "red-bearded"]}`.

- It is checked against the newest user message and the newest reply.
- It is **armed** only once the rest of its row has fired. A phrase that shows
  up before then does nothing. A lock alone in a row is always armed.
- It injects nothing. A lock can list several phrases; any one opens it.
- It works the same in a gate (opens) and in a close gate (closes).
- It can take Who triggers: `{"lock": ["red beard"], "by": "user"}`.

### 3.11 Wait

A row item that counts messages: `{"wait": 3}`.

- It runs out three messages after the rest of its row has fired. A row that
  holds only a wait counts from the start of the chat.
- `"by": "user"` counts only the user's messages, `"char"` only replies.
- A row can hold a wait and a lock: the lock is armed once the wait has run out.
- In a close gate it gives timed endings: "close three messages after the
  storm starts".

### 3.12 Greeting

A node point for one of a character's greetings. It is not an entry: nothing
is added to the book or the card, nothing is copied, nothing reaches the
model.

- It **counts as fired from the chat's first message** when that is the
  greeting the chat opened with (ST's first message, with the alternate
  greetings as its swipes). It never fires again.
- Other entries use it like an entry: in gate and close-gate rows and in mask
  rows. It can carry **Gates for** and **Closes for**, so each greeting can
  start its own scenario: open a pack, close what doesn't apply, start a
  Permanent entry, pick a mask.
- It takes no gate, close gate, glue, mask, Once or Who triggers.
- Named like ST: Greeting, Alt 1, Alt 2… Swiping the greeting before the first
  reply switches the scenario, with the usual rewind.
- Only the open chat's character's greetings show (in the entry panel and on
  the canvas). With no chat open, or in a group chat, none show; rules aimed
  at them stay on the entries and are listed in words.
- Stored in the book only, on the entries its rules touch, with the
  character, the greeting's number and a fingerprint of its opening words.
- Single-character chats only, for now.

### 3.13 Moment

A lock that stands on its own card: something that can happen in the story,
said in the chat, with no text of its own. "Missing tooth", "The storm
breaks", "She learns his name".

- It **happens** when one of its phrases is in the newest user message or the
  newest reply, said by the side it allows (anyone, only the user, only the
  character). Timing follows locks (2.1).
- **Once it has happened, it stays happened** for that branch of the chat. It
  rewinds with swipes and deletes like all other state.
- Other things use it like an entry: in gate and close-gate rows and in mask
  rows. It can carry **Gates for** and **Closes for**. "*Dentist* waits for
  *Missing tooth*"; "*Tower* closes when *Missing tooth* happens".
- **Its own gate arms it**: "Missing tooth only counts after *The kiss*". A
  phrase said before the gate is met does nothing.
- It **never sends anything** to the model. It takes no glue, masks, Once,
  switch, close gate or strategy, and it can't be closed.
- A lock in a row can become one: **Make it a Moment** moves its phrases to a
  new Moment, and the lock becomes a link from it in the same row. Locks stay
  as the quick inline form.
- It is not an entry to read or write: Normal mode doesn't show Moments at all
  (lists, search, entry counts), and Hero mode lists them only in the entry
  panel's Moments group.

### 3.14 Tracker

Text the model writes. The main text or any mask of an entry can be **written
by the model**: WI Hero reads each new reply for the slot's line (in the book's
syntax, such as `[Gold: 7]`) and sends the newest value from the next message
on. The entry's own text is the start value; a written mask is on while it
holds a value. Values are story state, so they rewind. The full rules are in
[TRACKERS.md](TRACKERS.md).

## 4. Linking and the canvas

- **Anything with a link is on the canvas.** Linking to an entry that isn't
  there puts it there.
- An entry with links can't be taken off the canvas; remove its links first.
  One that loses its last link stays where it was.
- An entry without links can be placed by hand and taken off again.
- A pack shows as a frame round its members on the canvas as soon as one of
  them is there. Only a rule that reads or targets the pack pulls all its
  members onto the canvas.
- Links have one direction rule: the first card picked is the source, the one
  doing the verb (*Road* opens *Mill*, *Storm* closes *Mill*).
- Pieces pick their targets from a searchable list of entries and packs, or,
  from the piece bar, by dragging a link's loose end onto a card.
- Positions on the canvas, and which side a port sits on, are only for the
  author. Moving a card or a port never edits the entry.
- How links, ports and masks are drawn is in [VISUAL.md](VISUAL.md#7-the-canvas).

## 5. Problems WI Hero catches

These are reported while editing. An entry with a problem never fires.

- A link to an entry or pack that doesn't exist.
- Two entries with the same id.
- An entry targeting itself (Gates for or Closes for naming itself, Gates for a
  pack it is in, naming itself in its own close gate, or riding along with
  itself).
- Rules that loop, so they can never be met (a gate chain back to itself, or a
  loop through packs or Gates for).
- A switch with fewer than two paths, or a pack used as a switch path.
- A ride-along host that is missing, or a pack.
- A malformed mask (reported, skipped, not blocking the entry).
- A greeting that changed (edited or reordered since it was linked): it doesn't
  fire until it is re-picked.
- A Moment with no phrases (it can never happen), and Closes for aimed at a
  Moment (a Moment can't be closed).
- Trackers (these never block the entry; only the tracker isn't read): two
  written slots in a book with the same label, a syntax that can't be compiled,
  and a written slot on a Moment.

Warnings, which don't block:

- A switch path not gated on its fork.
- Glue with a cooldown or a probability below 100%.
- A hold with nothing that can close it.
- A gate row that the entry's own close gate always meets first, so the entry
  could never fire.
- A greeting whose character is missing (it never fires).
- A Moment nothing uses yet.
- A Moment carrying a piece it takes none of (glue, masks, Once, a switch, a
  close gate): it is ignored.
- A written main on an entry that can never fire (switched off, or no key
  words and not Permanent or held), and, with WI Hero teaching, a tracker with
  no description.

Problems put a red "!" on the card and on the entry's row; ⌄ lists them all
under "Problems".

Two more lists in ⌄, read from the book alone, never from a chat:

- **Dead branches**: entries that can never fire, and gate rows and masks that
  can never open. Nothing sets the entry off (no key words, not Permanent or
  Vectorized, no glue); a row needs two paths of one switch; a row needs an
  entry that can never fire; a pack reading needs more members than can fire
  (counting one path per switch); a rider's host can never fire. It spreads:
  what waits on a dead entry is dead too. Entries with a problem are left to
  Problems.
- **Keyword clashes**: key words that fire two or more entries, the same word
  in both ("mill" in Mill and Miller's Yard) or a word inside another entry's
  longer key ("mill" inside "old mill"). The entry page marks such a key word
  and says what else it fires. Plain World Info too, so Normal mode shows it.

## 6. Manual overrides and safety

For story changes WI Hero can't see, such as a hand-edited old message.

- **Reopen** a closed entry, from its inspector ("Closed in this chat by
  *X* · Reopen"). It restores the entry as it was just before it closed:
  holding again if it was holding, waiting if it was waiting. Its close gate
  counts afresh from the Reopen. It rewinds like everything else.
- **Pick a mask** by hand (3.7).
- **Editing story logic mid-play is safe.** The chat's state is mostly history
  (what fired, and when); after an edit, the next message is worked out with
  the new rules on the same history. Deleted entries' history is ignored.
  Closed stays closed even when the rule that closed it is removed; Reopen is
  the way back.
- **Snapshots**: a manual "Snapshot" saves a named copy of the whole book, and
  Restore puts it back (with Undo), leaving the chat's state alone. One
  "As imported" copy is kept automatically the first time WI Hero opens or changes a book.

## 7. Preview

A sandbox that checks one pretend exchange against the book, without the LLM.
Nothing in it is saved to the chat or the book.

- It starts from the open chat's latest user message and reply, and from that
  chat's story state. With no chat open it starts empty, from the beginning.
- Every phrase that triggers something is explained: what fired and why, what
  was blocked and by what (waiting on an entry, lock not armed, wait not run
  out, closed earlier, close gate met, closed this turn by another entry,
  wrong side, turned off, the switch already picked), and what would change
  after this turn (closes, holds, gates and locks that open, masks that switch).
- Permanent entries, vector matches and glued entries are listed separately as
  "Also active", since they have no phrase to point at.
- The screen itself is mapped in [LAYOUT.md](LAYOUT.md#preview-tab).

## 8. Where things are stored

- **Story logic**: `extensions.wihero` on each entry, inside the lorebook file
  (the `extensions` box survives ST's card embedding and import both ways; a
  top-level field would not). Mask text is stored there too. No
  separate file; the book stays a normal ST lorebook. Without the extension,
  entries simply behave as plain World Info.
- **Entry ids**: entries are referred to by a stable id kept in `wihero`, not
  ST's uid, so copying entries or merging books doesn't break links.
- **Moments**: an entry of their own in the book, flagged `"moment": true` in
  `wihero`, its phrases as the key words, no content, ST's switch off
  (`disable: true`) and titled "Moment: *name*". ST never activates it, with or
  without WI Hero; WI Hero matches its phrases itself. Its Who triggers is who
  says it. It travels with export, cards and import like any entry.
- **Story state**: on each chat message, per swipe (2.3).
- **WI Hero's own settings**: canvas positions, port sides, the mask layer
  shown on each card, each canvas's camera, entry folders, book folders, each
  book's New entry defaults, the snapshot list and the color vision mode live
  in the extension settings, not in the books. Layout is local: a book
  exported elsewhere gets the automatic arrangement there.
- **Snapshots**: full copies of a book as files in ST's user files folder.

A **ref** is an entry id (`"mill"`), a pack reading (`"#town"`, `"#town:all"`,
`"#town:2"`), a lock (`{"lock": [...]}`), a wait (`{"wait": 3}`) or a greeting
(`{"greeting": 2, "char": "Seraphina.png", "name": "Seraphina", "fp": "9f3a1c"}`).
Rows are lists of refs.

`wihero` fields:

| Field       | Meaning                                                        |
|-------------|----------------------------------------------------------------|
| `id`        | Stable name other entries use                                  |
| `gate`      | Rows: `[["mill", {"lock": ["red beard"]}], ["#town:all"]]`     |
| `gatesFor`  | Entries or `#packs` that also wait for this one                |
| `closeGate` | Rows, like `gate`: when this entry closes for good             |
| `closesFor` | Entries or `#packs` this one closes when it fires              |
| `glue`      | `{"mode": "ride", "host": "<id>"}` or `{"mode": "hold"}`       |
| `switch`    | Two or more path ids                                           |
| `masks`     | `[{ name, content, gate, closeGate }]`, in priority order      |
| `packs`     | `["town/inn"]`                                                 |
| `once`      | Close after the first firing                                   |
| `by`        | `"user"` or `"char"`; left out means both                      |
| `gatedBy`   | Greetings whose Gates for target this entry (3.12)             |
| `moment`    | `true` on a Moment (3.13); left out on every other entry       |
| `dice`      | `true` on a switch's fork: it picks its path at random (3.5)   |
| `note`      | The card's sticky note: for the author only, never sent        |
| `written`   | The main text is a tracker (TRACKERS 7); also on a mask        |

Example:

```json
{ "id": "storm",
  "gate": [["mill"]],
  "glue": { "mode": "hold" },
  "closeGate": [["tower"], [{ "lock": ["calm", "the rain stops"] }]] }
```

Changes from the earlier model, for anyone reading the old build in the git
history: `gates` is now `gate`; the boolean `closeGates` ("the story moves on")
is gone, replaced by real `closesFor` links that the shortcut writes; `closes`
is now `closesFor`; `glue` end conditions are replaced by the two modes plus
the close gate; masks gain `closeGate` and lose `gateMode`; the data moves from
a top-level `wihero` field to `extensions.wihero` (read from either on load).

## 9. Later

- Preview stepping through several pretend turns.
- Tap a link on the canvas to jump to its other end (parked).
- Greetings in group chats.
- Bigger ideas kept out of V1 (locks that match by meaning, among others) are
  in [AFTER_V1.md](AFTER_V1.md).
- Out of scope for now: several books on one canvas, cross-book links,
  variables, loops or math in story logic, endings as a separate system (gates
  and close gates already cover them).

Decided since the first version (see BUILD_SPEC): where Reopen and the problem
list live (6, 5), and the canvas state view ("Show chat state" in ⌄).
