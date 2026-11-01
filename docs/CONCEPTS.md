# WI Hero — Concepts and functions

Part 1 of the spec: what WI Hero's story logic does and the rules it follows.
[LAYOUT.md](LAYOUT.md) maps every screen and control, and [VISUAL.md](VISUAL.md)
says how it all looks. None of them says how anything is built; that is
[TECHNICAL_NOTES.md](TECHNICAL_NOTES.md). Where they disagree with
[DESIGN.md](DESIGN.md) (the original design), these win. The
[demo](../demo/wihero-demo.html) follows this model.

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
  injected reaches the LLM, as with plain World Info.

## 2. Core rules

### 2.1 Firing

- **Fired** means World Info activated the entry this turn: a keyword match,
  recursion, permanent, vector match, or forced on by glue.
- **Changes take effect from the next message.** Story state is read once,
  before the scan. Anything that fires this turn opens or closes things for the
  following generation, never inside the same scan or recursion pass. The one
  exception is 2.2's "closing beats opening", which settles conflicts inside the
  turn.
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
- A new chat starts fresh: every gate shut, nothing fired.

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

## 4. Linking and the canvas

- **Anything with a link is on the canvas.** Linking to an entry that isn't
  there puts it there.
- An entry with links can't be taken off the canvas; remove its links first.
  One that loses its last link stays where it was.
- An entry without links can be placed by hand and taken off again.
- Pieces pick their targets from a searchable list of entries and packs.
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

Warnings, which don't block:

- A switch path not gated on its fork.
- Glue with a cooldown or a probability below 100%.
- A hold with nothing that can close it.
- A gate row that the entry's own close gate always meets first, so the entry
  could never fire.

## 6. Manual overrides

For story changes WI Hero can't see, such as a hand-edited old message.

- **Reopen** a closed entry. It applies from the current message on and rewinds
  like everything else.
- **Pick a mask** by hand (3.7).

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

- **Story logic**: a `wihero` field on each entry, inside the lorebook file. No
  separate file; the book stays a normal ST lorebook. Without the extension,
  entries simply behave as plain World Info.
- **Entry ids**: entries are referred to by a stable id kept in `wihero`, not
  ST's uid, so copying entries or merging books doesn't break links.
- **Story state**: on each chat message, per swipe (2.3).
- **WI Hero's own settings**: canvas positions, port sides, the mask layer
  shown on each card, entry folders, book folders and each book's New entry
  defaults live in the extension settings, not in the books.

A **ref** is an entry id (`"mill"`), a pack reading (`"#town"`, `"#town:all"`,
`"#town:2"`), a lock (`{"lock": [...]}`) or a wait (`{"wait": 3}`). Rows are
lists of refs.

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
the close gate; masks gain `closeGate` and lose `gateMode`.

## 9. Open questions and later

- Where Reopen and the problem list live in the new layout.
- A canvas state filter (fired, armed, closed), possibly as part of Preview.
- Preview stepping through several pretend turns.
- Tap a link on the canvas to jump to its other end (parked).
- Out of scope for now: several books on one canvas, cross-book links,
  variables, loops or math in story logic, endings as a separate system (gates
  and close gates already cover them).
