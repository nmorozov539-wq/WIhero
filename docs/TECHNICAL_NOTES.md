# st-wihero — Technical Notes

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
| Config on entries | custom top-level field on the entry | Works (not `extensions`) |

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
- Unknown top-level fields survive saving and the editor (entries are saved whole). So we store config as a top-level `wihero` field on the entry.
- Duplicating an entry (`duplicateWorldInfoEntry`, 4019) copies every field, including our stable id. The duplicate check in the design is needed.
- Embedding a book in a character card (`convertCharacterBook`, 5617) probably drops unknown fields. Not a v1 concern for a personal tool, but worth knowing.

## 9. Entry editor

- ST renders an entry's edit area (`WI_ENTRY_EDIT_TEMPLATE`, world-info.js 63) only when its drawer opens (`addEditorDrawerContent`, 3553), into the entry's `.inline-drawer-outlet`, and destroys it a moment after it closes (3532–3550). Pagination and every re-render rebuild the list. No event fires for any of this.
- So `src/editor.js` watches `#world_popup_entries_list` with a `MutationObserver` and adds the WI Hero block to each `.world_entry_edit` that lacks one. That's idempotent and needs no patching.
- The editor holds its own copy of the book in a closure (`displayWorldEntries(name, data)`, 2310) and saves that whole object on each field edit (`saveWorldInfo(name, data)` → debounced `_save`, 4163–4190). It isn't reachable from outside. Writing `wihero` anywhere else and leaving the editor alone would be undone by the next vanilla edit.
- Saving therefore goes: `loadWorldInfo(name)` (a clone of ST's cache, which `saveWorldInfo` updates before its debounce, so it already has every editor edit) → set or delete `entries[uid].wihero` → `saveWorldInfo(name, data, true)` (cancels any pending debounced save, then writes) → `reloadWorldInfoEditor(name)` so the editor reloads its copy from the cache → reopen the entry, as ST does after its own re-renders (3570–3573). All of these are on `getContext()`.
- A new entry (`createWorldInfoEntry`, 4137) lives only in the editor's copy until its first edit, so the block waits for one.
- After a save, `getSortedEntries()` re-emits `WORLDINFO_ENTRIES_LOADED`, which rebuilds the model and the panel.
- ST's drawer toggle handler (script.js 12193) triggers `inline-drawer-toggle` with jQuery, which bubbles to the entry's own drawer handler, so the block stops it.

## 10. Folders: ST's World Info list filter

What ST 1.19 already has, in the World Info editor:
- A fuzzy **search** box (`#world_info_search`, index.html 4851; handler world-info.js 6342) and a **sort** dropdown (`#world_info_sort_order`, 4852; `sortWorldInfoEntries`, 2146), plus pagination (25 per page by default, 2384–2405).
- Two book-wide buttons: fill empty titles with keywords (`#world_backfill_memos`, 2479) and apply the current sorting as Order (`#world_apply_current_sorting`, 2496).
- **No** folders, multi-select or bulk edit of entries.

How the folder filter hooks in:
- The list is built from `getDataArray()`, which runs `worldInfoFilter.applyFilters(entries)` then the sort (2371–2373). `worldInfoFilter` is an exported `FilterHelper` (world-info.js 92) whose `applyFilters` runs every function in its `filterFunctions` object in turn (filters.js 383–397), and `setFilterData` re-renders the list through its callback (filters.js 356–364, `updateEditor`).
- So `src/folders.js` adds one entry, `filterFunctions.wihero_folder`, and sets `filterData.wihero_folder` through `setFilterData`. That works together with ST's search, sort and pagination, and patches no function. It does add a key to ST's object, so a future ST that rebuilt `filterFunctions` would drop the filter silently (the list would just show everything).
- Bulk actions go through ST's save path like the entry editor (section 9): `loadWorldInfo` copy → edit → `saveWorldInfo(name, data, true)` → `reloadWorldInfoEditor`. For books imported from a character card, the matching `originalData` fields are kept in sync the way ST's editor does it (`enabled`, `extensions.probability`, `extensions.depth`, `insertion_order`, `keys`; see the `setWIOriginalDataValue` calls, e.g. 3185, 3333, 3397, 2696).

## Design changes this implies

- 2.3 Glue: implemented through force-activation of processed entries, not by editing entries.
- 2.6 Masks: content is swapped after activation (`WORLDINFO_SCAN_DONE`), not at load time. Masks don't feed recursion by default.
- 3 Data model: config lives in a top-level `wihero` field, not `extensions`.
