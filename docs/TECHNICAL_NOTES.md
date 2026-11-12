# WI Hero — Technical Notes

Checked against SillyTavern **1.19.0** (`release` @ `06bde939f`, 2026-09-14). Line numbers refer to `public/scripts/world-info.js` unless noted.

## Summary

All four hooks the design needs exist. Two of them don't work the way the design assumed, both for the same reason: **ST tracks sticky/cooldown by a hash of the whole entry, computed after `WORLDINFO_ENTRIES_LOADED`**. Any field we change on an entry there gives it a new hash, and its vanilla timers are lost. So the only safe edit in that event is removing entries. Glue and masks have to go through other hooks.

| Design need | Hook | Verdict |
|---|---|---|
| Hide closed / not-yet-open entries | `WORLDINFO_ENTRIES_LOADED` — remove from arrays | Works |
| Glue (inject every turn) | `WORLDINFO_FORCE_ACTIVATE` with processed entries from `getSortedEntries()` | Works, with care |
| Masks (swap content) | `WORLDINFO_SCAN_DONE` — edit content of activated entries | Works |
| Record what fired | `WORLD_INFO_ACTIVATED` | Works, post-budget |
| Skip background generations | `GENERATION_STARTED` type + `dryRun` | Works |
| Per-message state | `message.extra` (copied per swipe) | Works |
| Config on entries | `entry.extensions.wihero` (section 8; the old build used a top-level field) | Works |

## 1. Gating: `WORLDINFO_ENTRIES_LOADED`

- Emitted in `getSortedEntries()` (4604) with `{ globalLore, characterLore, chatLore, personaLore }`, before sorting, decorator parsing and hashing.
- Entries come from `worldInfoCache`, which clones on get (882), so the arrays are fresh copies. Mutating them never touches the saved book.
- **Remove** gated-out entries with `splice`. Don't set `disable` or any other field: decorators and the hash are computed right after (4627–4634), so a changed field means a new hash.
- Fires on dry runs too (token counter, prompt itemization). That's what we want: gating should apply to every view of the prompt.

## 2. Timed effects are keyed by hash

- `WorldInfoTimedEffects#getEntryHash` returns `entry.hash` (584). Effects are stored with that hash and matched back to entries by it (606, 624).
- `hash = getStringHash(JSON.stringify(entry))` over the entry after `ENTRIES_LOADED` (4633).
- Consequence: setting `constant: true` for glue, or swapping `content` for a mask, inside `ENTRIES_LOADED` would silently break that entry's vanilla sticky/cooldown whenever glue or mask state changes. This violates the "vanilla timers are never violated" rule, so neither may happen there.
- Our own config field is static, so it's just part of the hash like any other field. Editing an entry's WI-hero config in the editor resets its timers, same as editing any vanilla field.

### 2a. Letting a running sticky finish

Removing a closed entry at `ENTRIES_LOADED` would cut its sticky short: ST keeps the effect in `chat_metadata.timedWorldInfo.sticky`, but can only apply it to an entry that is in the list. So gating leaves in every entry ST is about to hold by sticky (`src/timers.js`):

- **Hash.** In `getSortedEntries()` ST maps each entry to `{ ...entry, decorators, content }` with `parseDecorators` (4627–4630, 4652), then hashes `getStringHash(JSON.stringify(entry))` (4632). Nothing changes the entries between the event (4604) and that. `entryHash()` does the same on the `ENTRIES_LOADED` objects, with ST's exported `getStringHash` (utils.js 522) and a copy of `parseDecorators` and `KNOWN_DECORATORS` (100), which aren't exported. In `GENERATION_AFTER_COMMANDS` the extension compares its hashes with the ones `getSortedEntries()` returns and logs a warning once if they differ (a sign ST changed this).
- **Sticky active.** `timedWorldInfo.sticky` is `{ "world.uid": { hash, start, end, protected } }`, with `start` the scan's chat length when the entry fired and `end = start + sticky` (604–610). `#checkTimedEffectOfType` (619–656) drops an effect when `length <= start && !protected` (a swipe or regenerate of the turn that set it), when no entry has its hash, when the entry has no `sticky`, or when `length >= end`; otherwise the entry is active. `stickyHeld()` applies the same tests.
- **Length.** The scan sees the non-system messages, minus the reply a swipe replaces (script.js 4496–4499): `scanLength()`. The panel predicts the next send with one more message.
- Dry runs skip timed effects (682–686), so they don't hold anything either.
- **Turns.** Sticky and cooldown count messages, and a turn adds two (user message and reply), so sticky or cooldown N lasts floor((N-1)/2) more turns after the one that set it: 2 does nothing visible, 5 holds two more turns.

## 3. Glue: `WORLDINFO_FORCE_ACTIVATE`

- Handler at 1020 stores entries in `WorldInfoBuffer.externalActivations` keyed `world.uid`. They're cleared at the end of every `checkWorldInfo` (5275), so we must emit before **every** scan.
- In the loop, external activation is checked **after** disable, generation-type triggers, character filters, delay, cooldown and the recursion flags (4800–4890). So vanilla delay/cooldown still suppress a glued entry. Probability, inclusion groups and budget still apply after it too.
- The scan uses **our object** in place of its own (`activatedNow.add(buffer.getExternallyActivated(entry))`, 4888). That object therefore needs `hash`, `decorators` and the parsed `content`. Raw entries from the book don't have them.
- Plan: before the prompt is built (`GENERATION_AFTER_COMMANDS`, script.js 4321), call the exported `getSortedEntries()`, pick the glued entries out of the result (they're fully processed, with the right hashes), and emit `WORLDINFO_FORCE_ACTIVATE` with them. Our own `ENTRIES_LOADED` handler runs during that call too, which is fine since it only removes entries.
- Glued entries should have probability off (or 100). Otherwise they can drop out on a roll. The extension can warn about this.

## 4. Switches and masks: `WORLDINFO_SCAN_DONE`

- Emitted at the end of every scan loop (5175), **after** the budget step has added the loop's entries to `allActivatedEntries`, a `Map` keyed `world.uid` (4732, 5075). `args.activated.entries` is that Map itself (5161), and listeners may change it (comment at 5177–5178).
- **Dropping an entry** (switch ties): deleting its key from the Map keeps it out of the prompt (built from the Map, 5203), out of `setTimedEffects` (5274) and out of the returned set that `WORLD_INFO_ACTIVATED` reports (5281, 900–903), so it doesn't count as fired either. Two leftovers: its content was already added to the recursion buffer in that loop (5139–5144), so it can still trigger other entries by recursion; and a later loop could match it again, since `allActivatedEntries.has()` (4797) no longer sees it. The handler runs after every loop, so it is dropped again.
- The prompt is built from `allActivatedEntries.values()` afterwards (5203), and `hash` is already a stored property. So setting `entry.content = mask` on activated entries in this event changes what's injected without touching timers.
- **Masks:** the activated entries are the scan's own copies: `getSortedEntries()` returns `structuredClone(entries)` (4639), and glued entries are copies from our own `getSortedEntries()` call. So setting `content` on them never reaches the book or the cache, and `hash` was computed before (4632), so timers are unaffected (checked in e2e: a masked sticky entry holds as long as without the mask, and the book file is byte-for-byte the sample afterwards).
- Side effects: the budget was measured on base content (irrelevant with a high budget). The loop already added base content to the recursion buffer before the event (5139–5144), and `args.activated.text` still holds it, so masked text doesn't drive recursion. We leave that as it is.

## 5. "Fired": `WORLD_INFO_ACTIVATED`

- Emitted by `getWorldInfoPrompt` (902) with all activated entries, **only when not a dry run**.
- Entries are added to `allActivatedEntries` only after passing the budget check (5061–5075). So **budget-cut entries are not reported**. With the budget kept high this doesn't matter. If it ever does, `WORLDINFO_SCAN_DONE`'s `args.new.all` holds the pre-budget list per loop.
- Fires for quiet generations too, so it needs the generation-type filter below.

## 6. Which generations count

- `GENERATION_STARTED` (script.js 4299) passes `(type, options, dryRun)`. Types include `normal`, `swipe`, `regenerate`, `continue`, `impersonate`, `quiet`.
- Rule: record activations for `normal`, `swipe`, `regenerate`, `continue`. Ignore `quiet` (summaries, other extensions' background calls) and `impersonate` (its output goes to the input box, not the chat), and ignore `dryRun`.
- Gating, glue and masks still **apply** to every generation including quiet ones, so a summary never sees spoilers either. Only recording is filtered.

## 7. Per-message state: `message.extra`

- `WORLD_INFO_ACTIVATED` fires while the prompt is built, before the reply exists. Hold the list in memory, then on `MESSAGE_RECEIVED` (messageId, type) write the new snapshot to `chat[messageId].extra.wihero`. Drop the pending list on `GENERATION_ENDED` without a message, or on a stop/error.
- ST copies `message.extra` into `swipe_info[swipe_id].extra` when a swipe is saved (script.js 6797) and restores it when you switch swipes (script.js 7015). So snapshots follow swipes automatically. If we write after ST has taken its copy, we also write `swipe_info[swipe_id].extra.wihero`.
- `continue` lands on the same message: update its snapshot in place.
- Reading: walk back from the end of `chat` to the first message with `extra.wihero`. If none exists, use the initial state (roots open). User messages carry no snapshot.

## 8. Storing config on entries

- Native lorebook entries are **flat objects**. There's no `extensions` sub-object. The `extensions.*` paths in ST (2688–2711) belong to `originalData`, the character-card book format.
- Unknown top-level fields survive saving and the editor (entries are saved whole). The old build stored config as a top-level `wihero` field on the entry.
- **Superseded** ([BUILD_SPEC](BUILD_SPEC.md) 2.1): embedding a book in a card (`convertWorldInfoToCharacterBook`, `src/endpoints/characters.js` 663) keeps only ST's own fields plus `...entry.extensions`, and importing it back (`convertCharacterBook`, 5617) keeps `extensions` too. So config now lives at `entry.extensions.wihero`, which survives both ways; the top-level field is read on load and moved on the next save.
- Duplicating an entry (`duplicateWorldInfoEntry`, 4019) copies every field, including our stable id. The duplicate check in the design is needed.
- Embedding a book in a character card drops unknown top-level fields but keeps `extensions` both ways (the Superseded bullet above), which is why config lives there. Checked by `test/book.test.js` with copies of ST's two conversion functions (`test/fixtures/card-book.js`).

## 9. Saving a book

*The old build added a block to ST's own entry editor, a folder filter on ST's
list and a separate workspace (`src/editor.js`, `folders.js`, `workspace.js`
and others, all gone; their notes are in the git history). Its save path is
still the one WI Hero uses:*

- ST's editor holds its own copy of the book in a closure
  (`displayWorldEntries(name, data)`, 2310) and saves that whole object on each
  field edit (`saveWorldInfo(name, data)` → debounced `_save`, 4163–4190).
  Writing anywhere else and leaving the editor alone would be undone by its
  next edit.
- So saving goes: `loadWorldInfo(name)` (a clone of ST's cache, which
  `saveWorldInfo` updates before its debounce, so it already has every editor
  edit) → change the copy → `saveWorldInfo(name, data, true)` (cancels any
  pending debounced save, then writes) → `reloadWorldInfoEditor(name)` so ST's
  editor reloads its copy from the cache. All of these are on `getContext()`.
  WI Hero's working copies and their timing are in BUILD_SPEC 11.2a.
- For books imported from a character card, the matching `originalData` fields
  are kept in sync the way ST's editor does it (`setWIOriginalDataValue`,
  ST's exported `originalWIDataKeyMap`, 2687); `disable` maps to the inverted
  `enabled`, and `position` also sets the card's `before_char`/`after_char`
  like ST (3434).
- After a save, `getSortedEntries()` re-emits `WORLDINFO_ENTRIES_LOADED`, which
  rebuilds the model.

## 10. The canvas on phones and big books

- Canvas input is split by pointer: `canvas-mouse.js` (mouse and pen on the desktop layout: right, middle and Space-drag move the view, the wheel, hover, double-click), `canvas-touch.js` (fingers anywhere, and every pointer on the phone layout: pinch, two-finger tap, long press) and the shared core `canvas-input.js` (pointer bookkeeping, grabbing and dragging cards, dots, links and ports, drops, the magnet). Each pointerdown picks its rules from `e.pointerType`; drawing stays in `canvas.js`.
- The pinch keeps the canvas point under the fingers' midpoint under it while the spread sets the zoom (`pinchCamera`: `tx = mx − wx·scale`), so two fingers pan and zoom at once. A drag owns its finger: a second one is ignored until it ends.
- Pan and pinch only move the camera: one transform per frame, with the world on its own GPU layer while a finger is down (`.vp.gesture`), let go at the end so the text is drawn sharp at the new zoom.
- A card drag doesn't draw the canvas: every node is tagged with the cards it belongs to (`data-of`), the card's own nodes (card, mask layers, ports, its junctions and pills) are moved with `translate`, and its links to other cards are hidden behind straight guide lines. The drop draws once and routes again.
- Hero mode builds the engine model of a book once per change (`library.version`), and fills the entry panel the first time it opens.
- A Hero draw on the same book keeps the canvas: the panel, the piece bar and the inspector are drawn again around it, and the cards and links only when what they're drawn from changed (`canvasSig`: the book's version, its settings without the camera, hidden entries, the open chat). Show chat state always draws.
- The canvas draws every card; it doesn't cull off-screen ones yet.
- The editor's touchstart listener is passive: a listener that could cancel makes the phone wait for the page's script before each scroll starts.

## 11. Design changes this implied (old build)

- 2.3 Glue: implemented through force-activation of processed entries, not by editing entries.
- 2.6 Masks: content is swapped after activation (`WORLDINFO_SCAN_DONE`), not at load time. Masks don't feed recursion by default.
- 3 Data model: config lived in a top-level `wihero` field. Superseded: it now lives at `entry.extensions.wihero` (section 8).

## 12. The new model (CONCEPTS.md)

What the redesigned story logic needs from the engine, on top of sections 1–8.
The full turn order (with the closing rules, the extra scan pass that brings in
ride-along entries, macros in mask text, greetings and per-book state keys) is
in [BUILD_SPEC.md](BUILD_SPEC.md) sections 4–6; it wins where this section is
shorter or older.

- **Fields**: `gates` becomes `gate`; `closes` becomes `closesFor`; new
  `closeGate` (rows) on entries and on masks; `glue` becomes
  `{mode: 'ride', host}` or `{mode: 'hold'}`. The `closeGates` boolean is gone.
- **Reading old books**: on load, `gates` is read as `gate` and `closes` as
  `closesFor`. `closeGates: true` (the old default) is turned into `closesFor`
  links to the entries in the gate, the same links the Story moves on shortcut
  writes. Old glue end conditions become a hold plus a close gate: "until one
  of these fires" as one row per item, "until all of these" as one row, "until
  these words" as a lock row. Masks' `gateMode` is dropped (rows already carry
  AND and OR). The book is only rewritten when it is next saved from WI Hero.
- **Closing** is worked out in `WORLDINFO_SCAN_DONE`, after the scan: entries
  closed by a Closes for or by a close gate met this turn are dropped from the
  activated list (closing beats opening), and recorded as closed in the
  pending state. `WORLDINFO_ENTRIES_LOADED` keeps removing entries that were
  already closed.
- **Glue**: ride-along entries are force-activated in `WORLDINFO_SCAN_DONE`
  when their host is in the activated list (the host is only known after the
  scan). Holds keep the force-activation path of section 3. Glued entries are
  no longer exempt from closing.
- **Close gates on masks**: a mask whose close gate is met is closed for good
  in the state, like an entry, and skipped when picking the text.
- **Locks in close gates** are checked the same way as gate locks, against the
  newest user message and reply, and armed only once the rest of the row has
  fired.
- **Once and Switch** stay their own fields and are expanded into close rules
  when the book is loaded, so the closing code has one path.
- **Canvas settings**: port sides and the shown mask layer join canvas
  positions in the extension settings, keyed by book and entry id.

## 13. Following ST's World Info drawer

- ST opens its World Info drawer (`#WorldInfo`) in several ways: the top bar
  button, and from code with a jQuery trigger on the button (a card's lorebook
  just imported, the character's, chat's and persona's lorebook buttons). The
  jQuery trigger skips capture listeners on the button, so intercepting clicks
  missed those.
- So WI Hero doesn't touch the button. A `MutationObserver` on the drawer's
  `class` shows WI Hero while it has `openDrawer` and hides it otherwise; the
  drawer gets `.wihero-under` so it stays hidden under WI Hero. ST keeps
  lighting the button and closing the other top bar drawers as usual.
- The book: ST picks it in `#world_editor_select` before or just after opening
  the drawer (it can wait for another drawer to close). A `change` handler
  keeps the name for 1.5 s, and WI Hero opens on it when the drawer opens.
- WI Hero closing itself clicks `#WI-SP-button .drawer-toggle`, so ST closes
  the drawer through its own code.
- ST closes open drawers on `touchstart` and `mousedown` on `<html>` outside
  them. WI Hero's host stops both from propagating, or the first touch inside
  it would close it.
- ST lights a closed top bar button on `:hover`, and a touch screen keeps
  `:hover` on the last element tapped. `style.css` sets
  `.drawer-icon.closedIcon:hover` back to ST's closed opacity under
  `@media (hover: none)`.
- The health check (BUILD_SPEC 17.2) also compares ST's `getStringHash` with
  the engine's copy on a probe text, since greeting fingerprints are written
  with the copy and checked with ST's.

## 14. Book actions through ST (D28)

- **Import** calls ST's exported `importWorldInfo(file)` (world-info.js), so
  WI Hero accepts exactly what ST does and converts it the same way, including
  ST's own "replace the existing book?" question. ST gives back no name, so
  `importFile` in `src/ui/st-books.js` compares the book list before and
  after; when nothing new appeared it checks whether the file's (sanitized)
  name was overwritten, and drops its working copy so the book is read again.
- **ST's book dropdown.** ST refreshes `#world_editor_select` (and fires its
  `change`) when a book is created, renamed, deleted or imported. WI Hero
  listens to that `change` to follow the user picking a book in ST (13). While
  the library itself is making, copying, renaming, deleting or importing a book,
  `library.busy()` is true and the listener ignores the change; before, a rename
  jumped to another book's tab.

- **Markup.** `btn()` in `src/ui/dom.js` puts a plain string in as text;
  only `Html` (an icon from `ic()`, or an `` html`…` `` template from
  `src/ui/html.js`, which escapes its values) becomes markup. Book content
  (titles, names, keys) can come from a lorebook downloaded anywhere, so it
  must never reach `innerHTML`.
- **Telling saves apart.** ST fires `WORLDINFO_UPDATED (name, data)` for every
  save. WI Hero's own saves are the objects it handed to `saveWorldInfo`
  (a `WeakSet`); any other is an outside save, merged as in BUILD_SPEC 11.2a.

## 15. Entry settings stored as ST stores them (D29)

- The entry page writes ST's own fields, with ST's names and shapes, through
  the same save path as everything else (section 9). The fields and their
  controls are listed in `src/ui/data.js`.
- Characters: `characterFilter: { isExclude, names, tags }`. `names` are
  character file names (`Seraphina.png`), `tags` are ST's tag ids. "Any"
  writes the empty filter `{ isExclude: false, names: [], tags: [] }`.
- Generation types: `triggers`, a list of ST's generation type names; empty
  means all.
- Group settings (`groupOverride`, `groupWeight`, `useGroupScoring`) show only
  when the entry has a `group`. "Only triggered by other entries" is
  `delayUntilRecursion` (`true` or a level number).
- The six extra match sources are ST's `matchPersonaDescription`,
  `matchCharacterDescription`, `matchCharacterPersonality`,
  `matchCharacterDepthPrompt`, `matchScenario` and `matchCreatorNotes`.
- Anything ST stores that has no control is still named in the folded
  summary ("Also set: …"), so nothing is hidden.

## 16. Moments (D30)

- A Moment is stored as a normal entry: `extensions.wihero.moment: true`, its
  phrases as `key`, empty `content`, `disable: true`, title "Moment: *name*".
  Because it is disabled, ST's scan never activates it, whether or not WI Hero
  is installed, and it never costs budget or reaches the prompt.
- WI Hero matches its phrases itself, the same way as a lock (D1): in
  `stateForScan` against the newest user message and reply, and in `advance`
  against the new reply. When met, the Moment is written into the state as
  fired once at that message. Everything else reads fired entries already, so
  rows, Gates for, Closes for, Preview and rewind need no Moment code.
- `keepAtLoad` never keeps a Moment, so gating doesn't bring a disabled entry
  back into ST's lists.
- In ST's own editor (or with WI Hero uninstalled) it shows as an ordinary
  switched-off entry with no content.

## 17. Explain mode (D31)

- Capture-phase listeners on WI Hero's root (in `src/ui/explain.js`): one for
  `click`, and one for each press event (`pointerdown`, `pointerup`,
  `mousedown`, `touchstart`, `dblclick`, `contextmenu`). While explain mode is
  on in Hero mode they stop the event, so no element's own handler runs. The
  banner is the exception, so its Cancel still works.
- The click's target is mapped to a Guide anchor by selector: piece chips by
  `data-piece`, lines and pills by `data-kind`, ports through the canvas's
  `PORT` table, and fixed controls (Fit, Tidy, the strip, the inspector) by
  class or aria-label (`explainAnchor`). A tap on something that maps to
  nothing shows a toast, and the mode stays on.
- Back and Escape cancel; one successful tap ends it (AFTER_V1 has making it
  stay on as a setting).

## Persistence and mobile editing fixes (2026-11-12)

- WI Hero checks the sanitized filename, including empty names and case-insensitive collisions, before create,
  duplicate and rename. Concurrent destinations are reserved until the operation finishes; a failed sanitization
  request stops the operation.
- `src/ui/book-write.js` posts to `/api/worldinfo/edit` and requires an OK HTTP response before updating ST's
  exported `worldInfoCache` and emitting `WORLDINFO_UPDATED`. It does not use 1.19.0's unchecked `saveWorldInfo`.
  WI Hero's per-book writes run in order; flush waits for active requests and changes made during them, as well
  as debounced edits and failed saves. Duplicate, rename, delete and export wait for flush. A rename's destination
  must be confirmed before links change or the source is deleted. Native editor refresh still happens after a
  save, with its synthetic dropdown event suppressed by `library.busy()` so it cannot navigate WI Hero.
- Normal mode on phones creates entries in the list without opening an entry page. Editing an existing entry
  stays on that page through saves, with no extra tabs. `e2e/mobile-edit.mjs` exercises title space/blur, keyword
  blur, pasted content, newline, delete, toggling and parameters using the actual library save lifecycle in the
  browser harness; its native-editor reload stub reproduces ST's dropdown callback.
- Tracker value resolution applies current book rename mappings to the historical message containing the value,
  including written masks and the restored swipe. It does not rewrite historical messages. Runtime model caching
  compares the full entry inputs, so ST fields such as disable, constant, keywords and content invalidate it.

### Follow-up: book lifecycle and native saves

Book edits now have a dirty revision and a confirmed revision independent of timers. A write acknowledges only
its serialized revision; changes and outside merges received while it waits cause another serialized write.
External revisions reset Undo even when a clean copy was dropped and reloaded. Rename and delete hold editing
with a visible waiting status until they finish, reject overlapping operations, and require ST's delete result
to succeed. A failed delete keeps settings and snapshot files; a rename whose source cannot be deleted reports
that both copies remain.

ST's exported cache is a Map that stores the same object captured by its native save debounce. After confirmed
HTTP success, the adapter synchronizes that raw object so a queued native write cannot restore older content.
It leaves a native edit made during the request intact; the library merges and confirms it as a later revision.
Native events for an already-confirmed payload trigger a confirmation write too, because an older HTTP body may
have been serialized before that shared object changed. Only currently active extension event objects are
classified as our own. The cache Map semantics and the host save implementations are in the drift contract.
