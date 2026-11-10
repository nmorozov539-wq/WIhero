# WI Hero: ideas kept out of V1

Big ideas we agreed are worth doing, but not in V1. Each has a short note on why it waits. Lighter ideas from brainstorms sit at the end, under [Brainstorm, 2026-11-09](#brainstorm-2026-11-09).

## Locks that match by meaning

**The idea:** a lock option, "match by meaning". The lock opens when a message says something close to the phrase, not only the exact words. It would use ST's vector service, the same way vectorized entries work.

**Why it waits:**
- The lock check would have to wait on the embedding service.
- It needs a similarity threshold that someone has to tune.
- The result must be saved in the chat state, so swipes give the same answer.
- Preview couldn't predict it without calling the embedding service.

## Ship the editor and Hero mode separately

**The idea:** split the product for shipping: the normal editor as one, Hero mode as another, each on its own track.

**Why it waits:** only marked for now, not worked out yet.

## Configurable behavior

**The idea:** a Behavior section in ⌄ for how actions work, not how things look. The first setting: explain mode ends after one tap (the default) or stays on until you cancel it. Other candidates that already behave one fixed way: whether the mode switch asks for a second tap, and whether opening from the list uses this tab or a new one.

**Why it waits:** each setting doubles the cases to test, and the defaults should prove themselves first.

## Explain mode in Normal mode, for ST's settings

**The idea:** the same "?" and explain mode in Normal mode, explaining ST's own entry settings (Sticky, Cooldown, Scan depth, the character filter and the rest) with a Guide page each. That's where newcomers need it most.

**Why it waits:** the Guide's piece pages come first; ST's settings need their own pages, written against ST's behavior.

## Masks the model writes → Trackers

Grew into its own spec, [TRACKERS.md](TRACKERS.md), built in 0.37.0. Any text slot (an entry's main or a mask) can be written by the model, read from the chat with a syntax the user designs, and kept in the chat's story state so it rewinds. The preset findings from 2026-11-09 are in its section 10.

## Greetings, the strict version

**The idea:** greeting rules that belong to one book and one character. A book links to a character; its greeting logic only runs in that character's chats, stands down when the link is removed, can be repointed to another character, and keeps a snapshot of each greeting per character.

**Why it waits:** greetings are retired for V1 (impressions list #33). Opening a chat loaded that character's greetings into whatever book was open, so logic for one character's greeting could fire or break in another character's chat. The engine now reads greeting links as if they weren't written (`GREETINGS` in src/engine/model.js), and the editor hides greeting cards, panel rows, picker options and Preview starts. Books keep their greeting data, so turning the switch back on restores it. Greeting nicknames (a short name on the card, #13) wait with it.

## Brainstorm, 2026-11-09

A no-commitment brainstorm. Nothing here is planned; each line is the idea plus any catch we spotted.

### Story logic

- **Dice for switches.** *Built (CONCEPTS 3.5): a swipe keeps the roll; going back past the message before it rolls again.* A switch rolls its path at random instead of waiting for keywords. Replayable books with no extra writing.
- **Endings.** Underneath, an ending is a gated entry. The one real rule it would add: when an ending fires, it closes the rest of the book. Then a counter ("ending 2 of 4"), the player view and the dead branch report all know what an ending is. Telling the model to wrap up stays in the entry's own text. Needs more thought.
- **Pack kinds.** Ready-made kinds such as chapters and arcs, each with exactly one behaviour. A chapter is ordered: opening the next closes the last. An arc spans chapters and shows progress. Catch: a pack is only a tag today (CONCEPTS 3.7), so kinds need somewhere to live.
- **Chapters in the chat.** When the first entry of a chapter pack opens, the chat gets a quiet "Chapter: The Mill" divider. Pack names become the story's table of contents.
- **Cycles, event-driven only.** Masks that rotate (dawn, day, dusk, night) when the story says so: a lock phrase like "next morning", or a value the model writes (see [Trackers](TRACKERS.md)). Counting turns doesn't work, because 100 messages can be one 10-minute scene.

### Canvas and editor

- **Lasso to make a pack (desktop).** *Built: Shift-drag a box, then type the name.* Drag a box, the cards inside light up, type a name. Can add to an existing pack; typing `town/` offers subpacks.
- **Drag in and out of packs.** Dropping a card on a frame joins the pack. Leaving is the hard part: a frame wraps its members, so dragging a card away just stretches it. Leaving needs a clear gesture (a "pop" past the edge, or a held key). Pulling a card out of `town/inn` shouldn't drop it from `town`.
- **Folders in Hero mode, with motifs.** A folder side panel in Hero mode, the same folders as Normal mode. Each folder sets an abstract look for its cards: square corners, or portrait cards (taller instead of wider). Folders suit this better than packs because an entry has only one folder. Catches: portrait cards change where pieces sit and how links route, since card sides turn with the flow direction; and it's a scope change, since Hero mode leaves folders out today.
- **Folder symbols and a far zoom.** Each folder gets a symbol. Zoomed far out, every card becomes a circle with its folder's symbol, and link colours show how the book is wired.
- **Pattern recipes.** A shelf of ready-made shapes to drag onto the canvas: chain, fork, key and door, hub with three keys. Cards arrive pre-wired; rename them and write the text. Doubles as a way to teach Hero mode.
- **Sticky notes on the canvas.** *Built: one per card, stored as `note` in the entry's `extensions.wihero`.* Author notes pinned beside cards ("TODO: second way into the mill"). Never sent to the model.
- **Keyword clash finder.** *Built (CONCEPTS 5), in both modes.* Highlights keywords shared by two or more entries ("mill" fires both Mill and Miller). Helps plain World Info too, so it could live in Normal mode.
- **Tile view on mobile.** Normal mode's book list as tiles: name, entry count, top packs as coloured chips, and with a chat open a hint like "4 open · 7 closed".

### Analysis and play

- **Dead branch report.** The favourite. *The book-alone pass is built (CONCEPTS 5); the saved-chats pass waits.* Two passes: one reads saved chats ("never fired in 14 chats"); the other reads the book alone and finds gates that can't open, such as a row that needs both paths of one switch.
- **Weight of the story right now.** A small bar with the tokens the currently open and held entries would inject, so a heavy branch shows before ST's budget silently drops something.
- **Player view.** A spoiler-free canvas for someone playing a book they didn't write: only open or done entries show, the rest are blank cards that fill in as you play.
- **Quest modules.** Export a pack with its gates, switches and masks and drop it into another book as a side quest. Low priority.
- **Book merger.** WI Hero works with one book today. Merge pours book B into A, then lists the clashes (same names, overlapping keywords, near-duplicate text, shared pack names), each with keep both / keep A / keep B. The bigger open question is linking: gates that point across books, since ST attaches global, character and chat books on its own, but then story state and rewinds span books.
- **Split a book by pack.** The reverse of merging; it also gives quest modules for free.

### Beyond WI Hero

These would be a separate chat-display extension (a "ChatHero"). They share one engine with Trackers ([TRACKERS.md](TRACKERS.md)): a syntax, the instruction that teaches it, and a parser that hides it from the bubble.

- **Time dial.** No real time tracking: the model just writes `Time: 22:37`, and the bubble shows a small circle in four quarters with a hand that rotates, with a little animation. The value could also drive event-driven cycles.
- **Floating trackers.** Preset trackers print inventory, time and location right in the chat. Strip them and show floating buttons instead.
- **In-story phone.** Texts between characters stay in the model's output, but are stripped from the bubble and shown behind a phone icon that lights up when there's something to read.
- **Obsidian bridge.** A separate project: an Obsidian plugin with mock fields for WI entries that converts notes to ST's JSON. Frontmatter maps neatly onto entry fields. One-way convert is cheap; two-way sync is the hard part.

### Set aside or dropped

| Idea | Status | Why |
| --- | --- | --- |
| Clocks (countdown of N turns) | Dropped | ST's delay and cooldown already count turns; gates with waits cover "after X happens" |
| Turn-based cycles | Dropped | Turns don't measure story time; kept only as event-driven cycles |
| Entry type field | Dropped | Duplicates packs; folder motifs do the job |
| Your run as a story path (export a chat's route) | Dropped | Too much to expect players to export and compare runs |
| Held-back entries chip in the chat bubble | Set aside | Needs WI Hero to record "matched but blocked" during the scan |
| Closed markers (stamped cards, chat dividers) | Set aside | |
| Time travel view (canvas as of any message) | Set aside | |
| "Why didn't it fire?" explainer | Set aside | |
| Swipe diff | Set aside | |
| Rehearsal (pretend message, no generation) | Set aside | |
