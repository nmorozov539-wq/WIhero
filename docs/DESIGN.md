# SillyTavern WI Extension — System Design (v2)

> **Historical.** This is the original design, kept for the record. The current
> spec is [CONCEPTS.md](CONCEPTS.md), [LAYOUT.md](LAYOUT.md) and
> [VISUAL.md](VISUAL.md); where they disagree with this page, they win.

A personal-use SillyTavern extension for advanced World Info (WI) control, focused on narrative-driven conditional triggering ("gating"), bulk organization ("grouping"), and cleaner visuals.

**Changes from v1:** config moved from `extensions` to a top-level `wihero` field; Integration Notes verified against ST 1.19.0; added Turn Semantics (2.0), clarified glue and closing behavior, replaced UID references with stable ids, replaced flat chat-metadata state with per-message snapshots (which also replaces the railway-only message-ID rule), added Integration Notes (6) and v1 Scope (7), moved cross-book gates to Future Ideas, noted Showrunner as a future consumer.

## Motivation

For large, chronologically-structured projects (e.g. a travel narrative where characters move from point A to point B), standard WI triggers everything whose keywords match, regardless of story position. This risks the model receiving information the author knows but the characters don't yet (spoilers). The core need: **entries that only become eligible to trigger once the story has reached a certain point**, and that can **automatically retire** once the story has moved past them.

---

## 1. Grouping

Primarily a UI/QoL layer — not core to the triggering logic.

- Sub-folders inside WI for organizing entries.
- Bulk actions on a folder: toggle on/off, bulk-set probability/depth/order offset, bulk-apply keyword prefixes, color tags for visual scanning.
- Open question (deferred): should a folder ever act as a shared injection/budget unit, or stay purely a UI container? Default to UI-only for v1 — touching the core WI evaluation loop is higher risk and not needed for the main use case.
- Config: `wihero.folder: 'Town X/Inn'` (slashes nest) and `wihero.color` (one of red, orange, yellow, green, teal, blue, purple, pink, gray). They're UI only: an entry whose config holds nothing else is not gated, and they never cause a problem.
- In ST's World Info editor: a folder filter next to ST's search (a folder includes its subfolders; "No folder" shows the rest), and bulk actions on the chosen folder: enable, disable, set trigger %, set depth, add to order, add a keyword prefix (regex keys and keys that already have it are skipped), set color. They ask first and save through ST; like any edit they change the entries, so vanilla timers reset.

---

## 2. Gating

The core system. Every WI entry optionally gets two conditions layered on top of normal keyword matching:

- **On-condition (gate):** the entry cannot become eligible to trigger until its gate(s) are satisfied.
- **Off-condition (expiry / un-trigger):** once active, the entry can be automatically retired.

Both conditions share one underlying engine; sticky, permanent, glue, and conditional un-triggering are just different presets/configurations of the off-condition, not separate systems.

**Scope:** purely trigger eligibility. Gates don't affect order, depth, or other injection parameters when an entry fires — only whether it's allowed to fire at all.

### 2.0 Turn semantics

- **Fired** = the entry was triggered by WI (keyword match, recursion, constant, or forced by glue). The token budget does not matter; the budget is kept high so it is not a ceiling in practice.
- **Gates open on the next turn.** State is evaluated once, before the scan. An entry firing this turn opens downstream gates for the following generation, never within the same scan or recursion pass.
- **Only chat generations count.** A generation moves gate state only if its result lands in the chat (normal replies, swipes, continues). Background generations (summaries, quiet prompts, other extensions' calls) never move gates.
- **Vanilla timers are never violated.** The extension only decides eligibility. ST's own sticky, cooldown, delay, probability and inclusion groups still apply on top, unchanged.
  - A running sticky finishes even if the entry closes (or is otherwise not eligible); normal gating applies again once it ends.
  - Cooldown and delay can hold back a glued entry: glue doesn't override them. The panel warns when a glued entry has a cooldown.
  - An entry that fires only because sticky held it in still counts as fired and moves gates, like any other trigger. That includes the rewind case: ST doesn't roll back its timers when messages are deleted, so a sticky can outlive the state it started in.

### 2.1 Basic gates

- An entry can have one or more gates (parent entries that must have fired first).
- Multiple gates support **AND** (all parents must have fired) or **OR** (any parent fired) logic — configurable per entry.
- "Only recurring" is the simplest case: a single gate requiring one specific entry to have fired previously.
- Cycle detection needed to prevent circular gate chains.

### 2.2 Floating gate chains (progression)

- A chain is built from **multiple separate entries linked together** (not one entry with multiple internal states): entry 2's gate = entry 1 fired, entry 3's gate = entry 2 fired, etc.
- Each link is configured individually — no single global "replace vs. accumulate" setting; per-link behavior.
- Reuses the same gate engine as basic gating — a chain is just a sequence of ordinary gate relationships.
- By default, when a chain advances (the next link's gate fires), the previous entry in the chain closes automatically — glue is the explicit override used to keep it open past that point.
- **Closed is final.** A closed link never reopens on its own. It reopens only on rewind (the snapshot it closed in is gone, see 3) or by a manual override.

### 2.3 Glue and expiration (off-condition)

- Once a gated entry fires, it can stay active ("glued") past the point where its own gate condition is still true, until a separate closing condition is met.
- **A glued entry is injected every turn** until it closes, whether or not its keywords match that turn.
- Closing conditions (configurable, combinable):
  - Keyword match. **Close keywords are scanned against the newest message only**, not the entry's scan depth.
  - A specific sibling entry (X) firing.
  - Held open until multiple entries (X and Y) are both active, releasing once they are.
- Replaces prior ad hoc use of "permanent" or "sticky" for this purpose.

### 2.4 Conditional un-triggering

- Same mechanism as 2.3, framed as an explicit auto-off: used for "event packages" (e.g. content paired with a greeting for scene context) that should switch off once the scene has moved on.
- Configured as an off-condition preset rather than a separate feature.

### 2.5 Railway switch

- A gate can open to two (for now) downstream paths.
- Once one path is triggered, the other is **permanently disabled** for this branch of the story.
- Rewind and swipe handling comes from per-message state (see 3), not a railway-specific mechanism.
- A manual reset control remains as the escape hatch for edits that state tracking can't see (e.g. hand-editing an earlier message's text).
- Config on the fork entry: `wihero.switch: ['left', 'right']` (two or more ids). When any listed path fires, every other listed path closes for good (`closed` in the snapshot). The paths are normally gated on the fork; the editor warns when one isn't.
- **Tie:** if two paths activate in the same scan, only the first in switch order is injected and fires; the others are dropped from that scan and closed.
- **Reopen:** the panel's Reopen button on a closed entry writes a snapshot without it in `closed` onto the message the current state comes from (and its current swipe), and saves the chat. Rewinding past that message undoes it. A reopened switch path that fires takes the switch again, closing the other paths.

### 2.6 Masks

Masks let an entry's injected content change over time without the entry being rewritten in place.

- Stored as an alternate `content` field in the entry's `wihero` config; if present at injection time, it replaces the entry's base content. Same id, same gates, same links — just a different payload.
- Can be written by hand, or produced by a scripted in-chat mechanism (e.g. a preset character whose dialogue output gets parsed and written into a target entry's mask field).
- Malformed mask output is rejected outright and the entry falls back to its base content, rather than injecting invalid data.
- A mask can carry its own independent trigger (its own gate/glue), separate from the base entry's eligibility gate — so the entry stays eligible to fire while *which version* fires depends on separate scene-state logic.
- Which mask is active is part of the per-message state (see 3), so it rewinds with the chat.
- In the visual editor, a mask appears as a neighboring node that inherits the base entry's links and parameters rather than existing as a fully separate object.
- Config: `wihero.masks: [{ name, content, gates?, gateMode? }]`. `name` follows the id rules and is unique within the entry; `content` is a non-empty string. A malformed mask is reported on its own and skipped; the entry keeps working and injects its base content.
- **Which mask:** a mask selected in the state wins; otherwise the last listed mask whose gates have fired (all of them, or any for `gateMode: "any"`); otherwise the base content. A mask without gates is only active when selected. A selected name that isn't a well-formed mask means base content.
- **Selection:** `/wihero-mask entry=<id> <name>` selects a mask; `/wihero-mask entry=<id>` clears the selection, so the gates decide again. The selection is written into the snapshot the current state comes from (the last reply, or the last message at story start) and saved with the chat, like Reopen. It applies to the next generation (swipes and regenerations of the next reply included) and every later snapshot carries it. Deleting that message takes it away.
- The mask replaces the content of the scan's own copy of the entry after activation, so the book, the entry's hash and its sticky/cooldown are untouched, and the masked text doesn't drive recursion.

### 2.7 Labels (Unified Flag Targets)

Every mechanism above (gate, glue, mask trigger) is really one underlying primitive: a flag with a source and a target. Labels generalize what a target can be.

- A **label** is a tag carried by individual entries (e.g. "Town X all cool lore") — not a standalone stored object. Membership lives on the entry, not on the label.
- A flag can target a label instead of a single entry, applying that condition to every entry carrying the tag at once — a bulk rule, not new state.
- A label can also act as a **source**: "any entry under this label has fired" can itself satisfy a downstream gate, collapsing a whole label into one OR-gate signal.
- When an entry has both its own gate(s) and a label-level gate that applies to it, the label condition is **ANDed** on top — it adds a requirement, never overrides or replaces the entry's own gating.
- In the node editor, the label wrapper exists only as a UI/UX grouping for drawing links cleanly — mechanically it is nothing more than a shared tag on the entries it touches.
- Config: `wihero.labels: ['town-x']` (names follow the id rules). `'#town-x'` can stand anywhere an id list is read: `gates`, glue's `closeWhenFired` and `closeWhenAllFired`, mask `gates`, `gatesFor` and `closes`. It is always one OR requirement: met once any entry with the label has fired. In `gateMode: "all"` it's one requirement among the others; in `closeWhenAllFired` it's one item. Switch paths can't be labels.
- Label (or id) as target, written on the source entry since a label has no object of its own:
  - `gatesFor: ['#town-x']`: every target also needs this entry to have fired, ANDed on its own gates whatever its `gateMode`. A target with only this rule is still gated.
  - `closes: ['#town-x']`: when this entry fires, every target closes. Glued targets stay open, as with `closeGates`, and a running vanilla sticky still finishes.
- `closeGates` closes the id gates that fired, not a `#label` gate: retiring a whole label is what `closes` is for.
- Problems: a label no entry carries; an entry targeting itself (`gatesFor` or `closes` naming its own id, or `gatesFor` a label it carries); requirements that can never be met because they loop back through labels or `gatesFor` (a label loop only counts when no other entry with the label could break it).

---

## 3. Data Model & Storage

- **Lorebook format:** gate/glue/chain configuration is stored in a top-level `wihero` field on each WI entry. (Native lorebook entries are flat and have no `extensions` sub-object; unknown fields survive saving and the editor.) No new file format or parallel book structure.
  - Keeps the lorebook a valid, normally-importable ST lorebook — without the extension, entries just behave as always-on/off depending on defined defaults.
  - No sync problem between "the book" and "the extension's data" — single source of truth.
- **Stable ids:** gates, chains, glue and labels reference entries by an explicit id stored in `wihero`, not by ST's UID. UIDs change when entries are copied or books are merged. The extension assigns the id on first edit and flags duplicates.
- **Local only:** all gate/glue state and configuration stay local to the ST client/extension — nothing in this system is sent to the model. Only the WI entry text that ends up injected (same as vanilla ST) ever reaches the LLM.
- **State storage: per-message snapshots.** After each chat generation, the full gate state (which entries have fired, which are open, glued, closed, which switch path was taken, which mask is active) is stored on that message's own `extra` data, per swipe.
  - The next generation reads its starting state from the last message still in the chat.
  - Swiping, deleting or branching drops the state that belonged to the removed messages automatically. No replay, no global flags to desync.
  - State is per-chat (not per-character), so two playthroughs of the same card/lorebook don't share progression.
  - The same snapshots power the timeline scrubber (Future Ideas) for free.
- **Initial state:** derived fresh each time a chat starts — all gates closed except root entries. (A book-level "starting state" override, for lorebooks meant to start mid-story, is a possible future addition but not built for v1 unless actually needed.)

---

## 4. Visuals

Lowest risk, built last. General cleanup of the WI entry list/editor UI; no functional dependencies on gating or grouping.

- Each entry row in ST's World Info editor gets a stripe in its WI Hero color and a badge with its status for the open chat (open, waiting, closed, glued, sticky, problem, plus the active mask), with the full reason on hover. Entries WI Hero doesn't gate get no badge.
- The panel groups entries by folder, keeps the Fired column and the bold last-round rows, and uses ST's theme variables so it follows any theme. It fits ST's narrow layout.

## 5. Visual Node Editor

A canvas-based editor for configuring gates and chains visually, alongside the form-based editor — not just a cosmetic pass over the entry list.

- Entries appear as nodes; pulling a "gate" handle out of an entry and dragging it to another entry creates the gate relationship visually.
- Larger in scope than general UI cleanup — likely built as its own component, once the gating engine itself is stable.
- Mirrors the underlying entry data rather than becoming a second source of truth — the canvas and the form editor stay in sync.

---

## 6. Integration Notes (verified on ST 1.19.0)

See `TECHNICAL_NOTES.md` for line references. The extension does not fork ST's scan loop.

- **Gating:** `WORLDINFO_ENTRIES_LOADED`, removing closed entries from the arrays. Entries must only be removed, never edited, there: ST keys sticky/cooldown by a hash of the whole entry, computed right after this event.
- **Glue:** before each prompt build, take fully processed entries from `getSortedEntries()` and emit `WORLDINFO_FORCE_ACTIVATE` with the glued ones. Vanilla delay/cooldown still apply.
- **Masks:** swap `content` on activated entries in `WORLDINFO_SCAN_DONE`, after activation and hashing. Masked text doesn't drive recursion by default.
- **Recording:** `WORLD_INFO_ACTIVATED` (post-budget, non-dry-run), filtered by `GENERATION_STARTED` type: count normal, swipe, regenerate, continue; ignore quiet, impersonate and dry runs. Gating itself applies to every generation.
- **Snapshots:** written to `message.extra.wihero` on `MESSAGE_RECEIVED`; ST copies `extra` per swipe and restores it on swipe switch.

## 7. v1 Scope

Build order:

1. Gate engine: basic gates (AND/OR), cycle detection, stable ids, per-message state.
2. Chains with auto-close.
3. Glue and its closing conditions.
4. "Fired this round" panel with per-entry fire counts (doubles as the debugger).

Later: masks, railway switch, labels, grouping, visuals, node editor.

**Showrunner:** Showrunner's DEP `requires`/`parent` is the same idea as gating. Once this engine is stable, Showrunner can use it instead of its own. This project comes first.

---

## Open Questions / Not Yet Decided

- Grouping: folder-as-injection-unit — deferred, UI-only for now.
- Whether a book-level "initial state override" is ever actually needed in practice.

## Future Ideas (Not Yet Established Systems)

Unexplored brainstorming, not committed design — flagged here so they don't get built before there's a concrete need.

- **Cross-book gates:** an entry in one lorebook gating on an entry in another. Unclear how ids and book loading order would work. Out of scope for now.
- **Exclusivity tags:** entries A and B marked as mutually exclusive — can never both be active at once, independent of how either was triggered. Needs a tiebreak rule (last-fired wins, or explicit priority) for when both would fire together.
- **Anti-keywords / suppressors:** an entry lists keywords that block it from firing even when its gate is open and its normal keywords match — a lighter-weight alternative to building a full gate chain for narrow exceptions.
- **Timeline scrubber / preview mode:** pick any message index in the chat history and see which entries would be eligible/active at that point, computed locally with no generation — useful for catching gate-logic bugs in large projects before they surface mid-story. Mostly free given per-message snapshots.
- **Dependency graph sanity check:** a linter pass over the whole gate/chain/label graph that flags unreachable entries, cycles, and orphaned chain links.
- **Entry activity stats:** show which entries fired on a given round (replacing a prior extension doing this that's unreliable on mobile), plus a running fire-count per entry over the life of the chat. (The per-round view is now part of v1.)
