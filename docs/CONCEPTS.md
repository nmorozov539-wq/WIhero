# WI Hero — Concepts and functions

Part 1 of the spec: what WI Hero's story logic does and the rules it follows.
Part 2, [LAYOUT.md](LAYOUT.md), maps every screen and control. Neither part says
how anything is built. Where the two disagree with [DESIGN.md](DESIGN.md) (the
original design), these win.

## 1. What WI Hero is

- A SillyTavern extension that replaces the World Info editor outright. Turning
  the extension off brings ST's own editor back. There is no Classic fallback.
- One World Info, two modes:
  - **Normal mode** edits books and entries: names, keywords, content and ST's
    parameters. Most people never need anything else.
  - **Hero mode** is the advanced editor of the same books. It does everything
    normal mode does except book folders, and it adds story logic, drawn as
    puzzle pieces on a canvas.
- Story logic only decides **whether an entry may fire**. It never changes an
  entry's order, depth, position or other injection parameters.
- Nothing WI Hero adds is sent to the model. Only the entry text that gets
  injected reaches the LLM, as with plain World Info.

## 2. Core rules

### 2.1 Firing

- **Fired** means World Info activated the entry this turn: a keyword match,
  recursion, permanent, vector match, or forced on by glue.
- **Changes take effect from the next message.** Story state is read once,
  before the scan. Anything that fires this turn opens or closes things for the
  following generation, never inside the same scan or recursion pass.
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
- An entry can be **closed** by a piece. **Closed is final**: it never reopens
  on its own. Only a rewind or a manual reopen brings it back.
- A glued entry is **held**: injected every turn until its glue ends.

### 2.3 Story state lives in the chat

- After every chat generation, the full story state (what fired and how often,
  what is closed, held, armed, which switch path was taken, which mask is
  active) is saved on that message, per swipe.
- The next generation starts from the last message that still carries state.
  Swiping, deleting, editing or branching drops the state of the removed
  messages, so the story **rewinds by itself**. No replay, no global flags.
- State is per chat, not per character: two playthroughs of the same book
  never share progress.
- A new chat starts fresh: every gate shut, nothing fired.

## 3. Pieces

**Pieces** is the umbrella word for every story-logic item. Each piece sticks
to one side of an entry's card. The sides turn with the flow direction (left to
right, or top to bottom).

| Side   | Pieces                          |
|--------|---------------------------------|
| In     | Gate                            |
| Out    | Gates for, Closes, Switch       |
| Top    | Mask                            |
| Bottom | Glue                            |
| Tag    | Pack (drawn as a frame)         |

Gate rows can hold three kinds of item besides entries and packs: **locks**,
**waits**, and pack readings. **Once** and **Who triggers** are entry settings,
not pieces.

### 3.1 Gate

What the entry waits for before it may fire.

- A gate holds **rows**. Each row means "all of these". The gate opens as soon as
  **any** row is complete. One row of several items is AND; several
  rows of one item each is OR.
- Items in a row: an entry (it has fired), a pack reading (see 3.7), a lock
  (3.8) or a wait (3.9).
- **The story moves on** (on by default): when the entry fires, the entries in
  the row that opened its gate close. That is how a chain advances: road, then
  mill, then tunnel, each closing the one before. It can be turned off per
  entry. Glued entries are never closed this way.
- A **merge** (several rows into one entry) is different from a **fork** (a
  Switch, where only one way goes on).

### 3.2 Gates for

The same rule as a gate, written on the source instead of on each target:
"these entries or packs also wait for me".

- Every target also needs this entry to have fired. It is added on top of the
  target's own gate (AND), whatever the target's rows say.
- A target with only this rule is still gated.

### 3.3 Closes

When this entry fires, the listed entries or packs close for good.

- Glued targets stay open until their glue ends.
- A running sticky on a target still finishes.

### 3.4 Switch

Makes the entry a fork with two or more paths.

- When one path fires, every other path closes for good, for this branch of
  the story.
- If two paths would fire in the same turn, only the first in switch order is
  injected; the others are dropped and closed.
- Paths are entries, not packs. A switch needs at least two paths.
- Paths are normally gated on the fork entry. WI Hero warns when one isn't.

### 3.5 Glue

Keeps the entry injected every turn from its first firing until an end
condition, whether or not its keywords match.

- End conditions, any of which ends it:
  - **Until one of these fires**: listed entries or packs.
  - **Until all of these have fired**: a set, counted since the glue began.
  - **Until these words show up**: phrases checked against the newest user
    message and the newest reply only.
- Glue with no end condition holds the entry for the rest of the chat.
- When the glue ends, the entry closes.
- A glued entry isn't closed when the chain advances or by Closes.
- WI Hero warns when a glued entry has a cooldown or a probability below 100%.

### 3.6 Mask

Alternate content for the entry. The entry keeps its name, keywords, gates and
links; only the injected text changes.

- Each mask has a name, its own content, and its own gate rows ("active once").
- **Which text is injected:** a mask picked by hand wins; otherwise the last
  listed mask whose gate is open; otherwise the entry's own content.
- A mask with no gate is **only used when picked by hand**.
- Picking by hand: the `/wihero-mask entry=<id> <name>` command selects a mask,
  and `/wihero-mask entry=<id>` clears the selection. The selection is part of
  the chat state, so it rewinds with the chat.
- A malformed mask is skipped with a warning; the entry keeps its own content.
- The masked text doesn't drive recursion.

### 3.7 Pack

A tag that groups entries so rules can treat them as one. Packs replace the old
labels.

- An entry can be in several packs. Nesting is in the name: `town/inn` is
  inside `town`, and a rule on `town` covers `town/inn` too.
- A pack is not an object of its own: membership lives on the entries. A pack
  with no members doesn't exist.
- **Readings** live on whoever reads the pack, in a gate row or a glue end:
  - `#town` — any member has fired
  - `#town:all` — every member has fired
  - `#town:2` — at least two members have fired
- As a target, a pack takes Gates for and Closes: the rule applies to every
  member.
- On the canvas a pack is a frame around its members. Its in port takes Gates
  for and Closes; its out side shows reading chips such as "all ▶".

### 3.8 Lock

A gate row item that waits for a phrase: `{"lock": ["red beard", "red-bearded"]}`.

- It is checked against the newest user message and the newest reply.
- It is **armed** only once the rest of its row has fired. A phrase that shows
  up before then does nothing.
- It injects nothing. A lock can list several phrases; any one opens it.
- It can take Who triggers: `{"lock": ["red beard"], "by": "user"}`.

### 3.9 Wait

A gate row item that counts messages: `{"wait": 3}`.

- It runs out three messages after the rest of its row has fired. A row that
  holds only a wait counts from the start of the chat.
- `"by": "user"` counts only the user's messages, `"char"` only replies.
- A row can hold a wait and a lock: the lock is armed once the wait has run out.
- Drawn as a chip in its gate row: "⏱ 3".

### 3.10 Once

`"once": true` closes the entry after its first firing, so it never fires again
in that chat. Not offered on glued entries, since glue has its own end
conditions.

### 3.11 Who triggers

`"by": "any" | "user" | "char"` sets whose messages the entry's keywords are
matched against: Anyone (the default), Me (the user's messages) or Character
(the replies).

- A book can set its own default in New entry defaults.
- Locks and waits take the same field.
- ST has no per-entry source filter, so for these entries WI Hero blocks ST's
  own keyword match and checks the keywords itself, within the entry's scan
  depth, against the chosen side only.

## 4. Linking and the canvas

- **Anything with a link is on the canvas.** Linking to an entry that isn't
  there puts it there.
- An entry with links can't be taken off the canvas; remove its links first.
  One that loses its last link stays where it was.
- An entry without links can be placed by hand and taken off again.
- Pieces pick their targets from a searchable list of entries and packs, or by
  tapping the canvas.
- Positions on the canvas are only for the author. Moving a card never edits
  the entry.

## 5. Problems WI Hero catches

These are reported while editing. An entry with a problem never fires.

- A link to an entry or pack that doesn't exist.
- Two entries with the same id.
- An entry targeting itself (Gates for or Closes naming itself, or Gates for a
  pack it is in).
- Rules that loop, so they can never be met (a gate chain back to itself, or a
  loop through packs or Gates for).
- A switch with fewer than two paths, or a pack used as a switch path.
- A malformed mask (reported, skipped, not blocking the entry).

Warnings, which don't block: a switch path not gated on its fork, glue with a
cooldown or a probability below 100%.

## 6. Manual overrides

For story changes WI Hero can't see, such as a hand-edited old message.

- **Reopen** a closed entry. It applies from the current message on and rewinds
  like everything else.
- **Pick a mask** by hand (see 3.6).

Where these sit in the new layout is not decided yet (see 9).

## 7. Preview

A sandbox that checks one pretend exchange against the book, without the LLM.
Nothing in it is saved to the chat or the book.

- It starts from the open chat's latest user message and reply, and from that
  chat's story state. With no chat open it starts empty, from the beginning.
- Every phrase that triggers something is explained: what fired and why, what
  was blocked and by what (waiting on an entry, lock not armed, wait not run
  out, closed, wrong side, turned off, the switch already picked), and what
  would change after this turn.
- Permanent entries and vector matches are listed separately, since they have
  no phrase to point at.
- The screen itself is mapped in [LAYOUT.md](LAYOUT.md#preview-tab).

## 8. Where things are stored

- **Story logic**: a `wihero` field on each entry, inside the lorebook file. No
  separate file; the book stays a normal ST lorebook. Without the extension,
  entries simply behave as plain World Info.
- **Entry ids**: entries are referred to by a stable id kept in `wihero`, not
  ST's uid, so copying entries or merging books doesn't break links.
- **Story state**: on each chat message, per swipe (see 2.3).
- **WI Hero's own settings**: canvas positions, entry folders, book folders and
  each book's New entry defaults live in the extension settings, not in the
  books.

`wihero` fields:

| Field        | Meaning                                                      |
|--------------|--------------------------------------------------------------|
| `id`         | Stable name other entries use                                |
| `gates`      | Rows: `[["mill", {"lock": ["red beard"]}], ["#town:all"]]`   |
| `closeGates` | The story moves on (default true)                            |
| `gatesFor`   | Entries or `#packs` that also wait for this one              |
| `closes`     | Entries or `#packs` this one closes when it fires            |
| `switch`     | Two or more path ids                                         |
| `glue`       | `true`, or its end conditions                                |
| `masks`      | `[{ name, content, gates }]`                                 |
| `packs`      | `["town/inn"]`                                               |
| `once`       | Close after the first firing                                 |
| `by`         | `"any"`, `"user"` or `"char"`                                |

Example:

```json
{ "id": "gatehouse",
  "gates": [["tunnel", {"lock": ["red beard"]}]],
  "switch": ["marsh", "ridge"],
  "gatesFor": ["#town"] }
```

## 9. Open questions and later

- Where Reopen and the problem list live in the new layout.
- A canvas state filter (fired, armed, closed), possibly as part of Preview.
- Preview stepping through several pretend turns.
- More ways into and out of Hero mode.
- Out of scope for now: several books on one canvas, cross-book links,
  variables, loops or math in story logic, endings as a separate system (gates
  and Closes already cover them).
