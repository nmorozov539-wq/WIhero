# WI Hero: cool features

What is planned next, in the order it is planned. This file replaces `AFTER_V1.md`, which is kept for its reasoning in [archive/AFTER_V1.md](archive/AFTER_V1.md). Last updated 2026-11-24.

The feature freeze for V1 is over. It was broken many times, and it still worked as a pressure cooker. What replaces it is the short set of rules in section 0, and a separate lane for fixes (section 3).

This file holds only features that have been thought through. Optimization has its own plan in [PR #48](https://github.com/nmorozov539-wq/WIhero/pull/48).

**Status marks:** 🔨 in progress · ☐ planned · 💭 concept written, details to settle · ⏸ parked.

## 0. Rules of the road

- **Order.** Features are built in the order of section 1 unless this file is edited to change it. The PR that changes the order edits the file.
- **A feature starts when its concept is written here:** the idea, the catch, and one story it must support (an acceptance story, as the tavern is for switches).
- **Fixes go in their own lane** (section 3) and can land any time.
- **Optimization runs in parallel.** The plan's structural work rewrites `canvas.js`, `normal.js` and `desk.js`. A feature PR touching those files either lands before the structural PR that rewrites them, or is rebased onto it.
- **Animations stay optional and come last.** They wait for the plan's animation-readiness checklist (A5).
- **Engine hazard.** Once the engine hot-paths PR is merged, the model signature in `st-hooks.js` (`modelInput`) is a hand-kept list of the ST entry fields `buildModel` reads. A feature that makes `buildModel` read another ST field must add it there, or the model goes stale. New settings inside `extensions.wihero` are covered automatically.

## 1. Order of work

| # | Item | Status | Depends on |
|---|---|---|---|
| 1 | [Optimization](#21-optimization-work) | 🔨 | none |
| 2 | [Patch notes](#22-patch-notes) | ☐ | none |
| 3 | [Guide and explain mode](#23-guide-and-explain-mode) | ☐ | none |
| 4 | [Say why an entry is inactive](#24-say-why-an-entry-is-inactive) (proposed) | 💭 | none; unlocks 12 |
| 5 | [Animations](#25-animations) | ⏸ | plan checklist A5 |
| 6 | [Greetings](#26-greetings) | 💭 | none |
| 7 | [Trackers: values drive logic](#27-trackers-values-drive-logic) | 💭 | none |
| 8 | [Book management](#28-book-management) | ☐ | plan's loader work (M1–M2) helps |
| 9 | [Entry firing budget](#29-entry-firing-budget) | 💭 | 7, the visit idea in 12 |
| 10 | [Canvas control](#210-canvas-control) | ☐ | plan's Hero structural work |
| 11 | [Editing](#211-editing) | ☐ | none |
| 12 | [Switches and the rotating pool](#212-switches-and-the-rotating-pool) | 💭 | 7, 4 |
| 13 | [Gate menu](#213-gate-menu) | ☐ | none |

The build order is the author's list, with item 4 proposed. Items 1 to 13 are described in sections 2.1 to 2.13.

## 2. The features

### 2.1 Optimization work

Deep dive into the speed and smoothness of the whole project. The engine pass is written and tested on its own branch (about 3x less generation overhead on large books in the benchmarks) and goes out through the plan's train of small PRs. The rest is laid out in the [optimization plan on PR #48](https://github.com/nmorozov539-wq/WIhero/pull/48) as a train of small PRs, spread over the next versions.

### 2.2 Patch notes

A small technical menu for the time of development, so what changed is not forgotten.

**To settle:** where the text lives (its own file, or generated from the roadmap rows).

### 2.3 Guide and explain mode

- Explain mode in Hero still needs work: cut unnecessary tooltips, make the behavior consistent, proofread the Guide.
- Bring explain mode to Normal mode, explaining ST's own entry settings (Sticky, Cooldown, Scan depth, the character filter and the rest) with a Guide page each. That is where newcomers need it most.

**Catch:** ST's settings need their own pages, written against ST's behavior. The Guide's piece pages come first.

### 2.4 Say why an entry is inactive

*Proposed; not yet on the author's list.* An entry with story logic that has not met its condition is effectively off: it sends nothing to the model, even when its keywords match. Today that is barely communicated (checked against the code, 2026-11-24):

- The entry page lists its rules ("Waits for", "Opens when") but never states the consequence.
- A Normal-mode row shows a small dot titled "Has story logic". That says logic exists, not that the entry is inert, and a hover title does not work on touch.
- Hero's waiting badge shows only when "Show chat state" is on (off by default) and a chat is open.
- In the chat itself, nothing shows that an entry matched but is waiting.
- Preview explains it only for a pretend message.

**Idea:** one plain vocabulary for inactive entries, each word saying what ends it. *Waiting* (hasn't started; opens when X) and *Closed* (finished; closed by Y), plus the reason when the rotating pool has not drawn it (see 2.12). And one sentence on the entry page: "Until then this entry sends nothing to the model, even when its keywords match."

**Also from the old list, now promoted:** the "Why didn't it fire?" explainer and the held-back chip in the chat bubble. **Catch:** the scan has to record "matched but blocked" as it goes.

### 2.5 Animations

The animations to make it all feel smooth and nice. They are optional (a setting, and `prefers-reduced-motion` respected), and they are built on top of an optimized core, after the plan's checklist A5.

### 2.6 Greetings

Greetings need to come back as a system that ties to World Info. Today they are retired for V1 (CONCEPTS 3.12).

**The strict version.** Greeting rules that belong to one book and one character. A book links to a character. Its greeting logic runs only in that character's chats, stands down when the link is removed, can be repointed to another character, and keeps a snapshot of each greeting per character. Greeting nicknames (#13) wait with it.

**Why they were retired, so it is not repeated.** Opening a chat loaded that character's greetings into whatever book was open, so logic written for one character's greeting could fire or break in another character's chat. The engine now reads greeting links as if they were not written (`GREETINGS` in `src/engine/model.js`), and the editor hides greeting cards, panel rows, picker options and Preview starts. [BUILD_SPEC.md](BUILD_SPEC.md) section 15 describes how they work when the flag is switched back on. Group chats come after.

### 2.7 Trackers: values drive logic

Time to make their values affect logic. This is the one new layer the switch redesign and the rotating pool stand on, so it is written as a concept here and used in 2.9 and 2.12.

**Today.** A tracker is a text slot the model writes, read from the reply with a syntax the user designs, and kept in the chat state so it rewinds ([TRACKERS.md](TRACKERS.md)). Nothing can gate on what it says. Gating on a value ("open *Rich* when Gold is at least 100") would need comparisons, which CONCEPTS 9 keeps out.

**Direction: a named value.** A value with a name, written by the model (a tracker) or by the engine (dice, a draw), read by gates by **equality** only ("this value names this route"), and rewound with the chat. Equality is a much smaller thing than comparisons: a finite set of names, no arithmetic. Comparisons stay out until a book needs them.

**Also here:** "When *X* is written" as an item in other entries' gate rows (a stronger signal than a key word), from the roadmap's Later list.

### 2.8 Book management

Mainly for Normal mode, but could be global: improve search, merge books, split books.

- **Merge.** Pour book B into A, then list the clashes (same names, overlapping keywords, near-duplicate text, shared pack names), each with keep both / keep A / keep B. **Open question:** gates that point across books. ST attaches global, character and chat books on its own, but then story state and rewinds span books.
- **Split by pack.** The reverse of merging. It also gives quest modules (export a pack with its gates, switches and masks, drop it into another book as a side quest).
- **Search and find and replace** (from the roadmap's Later list).
- **Tiles.** Home's tile view on phones shipped in 0.47.0. Tiles for folders in Normal mode (#38) and for the book picker (#35) were parked in the old list; their state after 0.47.0 is unconfirmed.

### 2.9 Entry firing budget

An entry can fire N times and then retires. `Once` is a budget of 1, and the chat state already counts firings per entry.

**Decisions so far**
- Running out of budget is **always a hard close**, until a real book proves it needs something else. It is a reason shown next to the other close reasons, not a separate tier of closed.
- The old advice still holds: before building a third system, check whether a "ran out" mask and a tracker's per-chat counter can do it.

**What counts as one firing is open.** Per message the entry was touched at, or per visit. In an engine run (stand-in activation: a keyword in the last 4 messages), a hub entry fired on two consecutive messages for every single mention (messages 1–2, 7–8, then 13). A per-message budget of N therefore burns in about N/2 mentions. See "visit" in 2.12.

**Why it is needed now:** the tavern. Events leave the pool when played out (2.12).

### 2.10 Canvas control

- **Knife.** Drag across lines to cut every link it crosses.
- **Collapse.** Fold a pack (or a chain) into one card to tidy a big canvas.
- **Drag an entry into a pack** to make it part of it. **Catch:** leaving is the hard part. A frame wraps its members, so dragging a card away just stretches it. Leaving needs a clear gesture (a "pop" past the edge, or a held key), and pulling a card out of `town/inn` must not drop it from `town`.

### 2.11 Editing

- Auto-complete for `()`, `[]` and `{}`.
- The Android-back keyword loss is tracked as a fix (section 3).

### 2.12 Switches and the rotating pool

The author's first hand test of switches and dice was the tavern book (`sample1.json`, not in the repo); until then they had only been checked by the automated tests. It found two real limits and led to a redesign. The acceptance story for everything below is the tavern.

**The tavern (acceptance story).** A hub the story returns to again and again. Each visit one event, usually, from a pool plays out: two base events, and a third that opens only once the witch has been impressed on a dungeon raid. Events leave the pool when played out. It also points at a character-card idea: a tavern-events card.

#### What the engine does today (checked against the code and a simulation, 2026-11-24)

- A dice fork rolls **once**, on its first firing. Every other path closes for good, so there is no way back.
- The roll picks among paths that are not *blocked* (`turn.js`, `diceRoll`), not among paths whose gate is open now. CONCEPTS says "one open path". In 60 simulated openings (5 turns each, the witch never impressed), the roll kept the witch in 23, and in exactly those 23 no event ever fired.
- The rolled path only appears if its keywords match, or if the paths are Permanent and gated on the fork.
- With a Permanent root the roll happens on the first reply of the chat. The screen flash the author saw is a UI matter and has not been reproduced.
- The hub itself works: the Tavern re-fires on every return.

#### The switch, redesigned (concept)

A switch is a fork where the player picks one route. It is a pattern of ordinary parts, not a machine.

- **Root.** A regular entry with the setup and hints about the routes. It must be *open*, not *fired*, so nobody has to say anything matching for the fork to exist (a parameter to configure). It can be Permanent, so the hints stay in the prompt while the fork is undecided.
- **Options**, one per route. Short entries triggered by keywords. Each carries just enough for the model to avoid inventing facts about the route and to judge whether the player has committed. Matching an option only injects its text and closes nothing. No match means the player is improvising, which is valid. Options retire once a route is chosen (usually).
- **Commitment.** A named value (2.7) that names the chosen route, for example `Route: mine`. The model writes it when it judges the player has committed; it rewinds with swipes. One value names one route, so routes exclude each other by construction. No value means no decision yet. **A commitment is locked by default** (a point of no return).
- **Route content**, one entry or pack per route. It opens when the value names its route.
- **Dice** write the commitment value instead of the model.

**Known limits.** The commitment arrives one reply late: the reply in which the player commits runs on the hints. If the model never writes the line, the fork stays open, and a hand-pick (like the mask hand-pick) is the fallback. The design needs gating on a named value.

#### The rotating pool (concept)

A switch picks one route once, for good. A pool picks again and again. It uses the same idea (a value says which content is open), but the engine's draw writes the value, and the draw repeats.

- **Hub.** A regular entry (keywords, Permanent or Vectorized). It marks a visit.
- **Events.** Regular entries with their own gates. An event is **eligible** when its gate is met and it is not closed. This is the test the engine already applies to riders (`mayFire`). An event leaves the pool for good through the usual closes: Once, a close gate, or a firing budget.
- **The draw.** When a new visit starts, the engine draws N eligible events (N is a setting, usually 1), seeded like the dice so a swipe or regenerate keeps the same draw. The draw is saved in the chat state. An event opens only while the draw names it; the next visit draws again.
- **A visit starts when the hub fires after a gap**, since a keyword stays in the scan window for a couple of messages. That needs the gate reading **since it last fired**. Today an entry in a gate means "has fired at least once", and waits count from the first firing (`itemTime` in `rows.js`). The chat state already stores the latest firing (`lastAt`), so this is a new way of reading, not new data.
- **Possible shape (not prototyped):** events as riders of the hub with a draw filter. Riders fire in the same scan as their host, so an event would arrive on the visit's first message.

#### Two kinds of "not now"

**Closed** keeps its one meaning: it is over. It is stored, and permanent for this branch of the story. Causes: Closes for, a close gate, Once, a switch commitment, an exhausted budget.

**Waiting** is the temporary kind. The entry is not closed, its gate is just not met, so it cannot be drawn or fire. Nothing is stored for it: each turn the engine asks again whether the gate is met. So it comes back by itself, and a swipe or rewind fixes it, because it is worked out from the saved history and not from a flag.

A gate can wait on engine-counted conditions (messages since an entry last fired, how many times it fired, visits so far; deterministic and rewound with the chat) or on model-written ones (a tracker; for meaning, not counting).

#### Decisions recorded

- **Closed is absolute.** The temporary "not now" is Waiting.
- **Considered and dropped (2026-11-23/24):** a *soft close* (a flag on a close that something can later undo) and a *force open* (an override of the closed status). Each needs a stored flag plus something to clear it; a waiting gate clears itself. Three tiers of closed were dropped for the same reason; a budget is a reason, not a tier.
- The one new layer is the named value (2.7); gate readings (equality, since it last fired, visits) extend the gate vocabulary that exists.

#### To settle later

- What ends a visit: the event finishing, a number of messages, or a player action. Probably a setting offering all three.
- Whether a cooldown is set per event or once on the hub.
- Whether a gate that goes false again puts an event back to waiting mid-event (probably yes, but deliberately).
- A later commitment line: "undone by a later line" and "locked by default" disagree; the first commitment should probably be write-once, with an optional "changeable".
- Migration of existing dice forks (the sample book uses one).
- What exactly counts as a firing for the budget (2.9).

### 2.13 Gate menu

When placing it, it looks bad, on the phone at least. Tracked as a fix (section 3).

## 3. Fixes

A separate lane: no ordering, and none waits for a feature.

| Fix | What | State |
|---|---|---|
| Android back loses keywords | Canvas, entry, editing key words, press Android back without leaving the keyword editor: the key words are not saved. A data loss. | Not verified; treat as a bug |
| Hero cannot export a book | Every `exportBook` caller is in the desktop and Normal-mode menus; nothing in `hero-shell.js` reaches it (read from the code). | Open |
| Dice can roll a path that is not open | See 2.12, "what the engine does today". Decide: patch now, or wait for the switch redesign. | Open |
| Permanent switch root looks wrong | The roll happens on the first reply; the screen flash needs a repro. | Needs repro |
| Gate menu looks bad when placing it | Seen on the phone. | Open |

## 4. Shipped from the old list

Do not rebuild these.

| Idea | Where it went |
|---|---|
| Dice for switches | Built (CONCEPTS 3.5). A swipe keeps the roll; going back past the message before it rolls again. |
| Lasso to make a pack | Built: drag a box and press P, or long press and drag on a phone. |
| Sticky notes on the canvas | Built: one per card, stored as `note` in `extensions.wihero`, never sent to the model. |
| Keyword clash finder | Built (CONCEPTS 5), in both modes. |
| Dead branch report | The book-alone pass is built (CONCEPTS 5); the saved-chats pass waits (section 5). |
| Granular undo | Built in 0.42.0 as a freeze exception. |
| Masks the model writes | Became Trackers, built in 0.37.0 ([TRACKERS.md](TRACKERS.md)). |
| Canvas controls | Right button moves the view, box select, P to pack, the card menu, zoom and fit (0.44.0). |
| Tile view on phones | Home's tile view, 0.47.0. |

## 5. Parked

Ideas without a date. Each line is the idea plus any catch.

**Story logic**
- **Endings.** An ending is a gated entry; the one new rule: when it fires, it closes the rest of the book. Then a counter ("ending 2 of 4"), the player view and the dead branch report all know what an ending is.
- **Pack kinds.** Chapters (ordered: opening the next closes the last) and arcs (span chapters, show progress). Catch: a pack is only a tag today (CONCEPTS 3.9), so kinds need somewhere to live.
- **Chapters in the chat.** When a chapter's first entry opens, a quiet "Chapter: The Mill" divider appears.
- **Cycles, event-driven only.** Masks that rotate (dawn, day, dusk, night) when the story says so: a lock phrase, or a named value the model writes. Counting turns does not work, because 100 messages can be one scene. The named value and waiting gates (2.7, 2.12) may cover this with no new mechanism.
- **Glue hold that starts on a condition (#25).** Hold begins once gate X happens. Waits because a start condition is a new system on top of glue.
- **Locks that match by meaning.** Match by ST's vector service instead of exact words. Waits because the lock check would wait on the embedding service, needs a threshold someone must tune, must save its result so swipes agree, and Preview could not predict it.

**Canvas and editor**
- **Minimap.** **Select linked.** **Align and distribute.** **Copy between books** (links come along only between the copied cards). **Bookmarks** (saved views of a big canvas).
- **Folders in Hero mode, with motifs,** and **folder symbols with a far zoom** (a card becomes a circle with its folder's symbol). Catch: portrait cards change where pieces sit and how links route.
- **Pattern recipes.** A shelf of ready-made shapes to drag onto the canvas: chain, fork, key and door, hub with three keys. The tavern would be a good one.
- **Greeting nicknames (#13)** and **tile views for the book picker (#35) and folders (#38).**

**Analysis and play**
- **Dead branch report, saved-chats pass** ("never fired in 14 chats").
- **Weight of the story right now.** A small bar with the tokens the open and held entries would inject.
- **Player view.** A spoiler-free canvas for someone playing a book they did not write.
- **Quest modules** (see split by pack in 2.8).
- **Preview over several turns,** a **timeline scrubber** across branches, **group chats,** a **helper for converting an existing book.**

**Product**
- **Ship the editor and Hero mode separately.** Only marked, not worked out.
- **Configurable behavior.** A Behavior section in ☰ (whether the mode switch asks for a second tap, whether opening from the list uses this tab or a new one, how long an armed explain control stays armed). Waits because each setting doubles the cases to test.

**Beyond WI Hero** (a separate chat-display extension, "ChatHero", sharing the tracker engine): a time dial, floating trackers, an in-story phone, and an Obsidian bridge.

## 6. Set aside or dropped

| Idea | Status | Why |
|---|---|---|
| Soft close / force open | Dropped (2026-11-24) | Needs a stored flag plus something to clear it; a waiting gate clears itself |
| Three tiers of closed | Dropped | Closed has one meaning; a budget is a reason, not a tier |
| Clocks (countdown of N turns) | Dropped | ST's delay and cooldown count turns; gates with waits cover "after X happens" |
| Turn-based cycles | Dropped | Turns do not measure story time; kept only as event-driven cycles |
| Entry type field | Dropped | Duplicates packs; folder motifs do the job |
| Your run as a story path | Dropped | Too much to expect players to export and compare runs |
| Closed markers (stamped cards, chat dividers) | Set aside | |
| Time travel view (canvas as of any message) | Set aside | |
| Swipe diff | Set aside | |
| Rehearsal (pretend message, no generation) | Set aside | |

The held-back chip and the "Why didn't it fire?" explainer were set aside here before; they are back in 2.4.

## 7. Keeping this file honest

- When an item ships, move it to section 4 with its version. When it is dropped, move it to section 6 with the reason.
- This file is the only list of planned features. The roadmap links here.
