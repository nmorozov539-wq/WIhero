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

## 3. Glue: `WORLDINFO_FORCE_ACTIVATE`

- Handler at 1020 stores entries in `WorldInfoBuffer.externalActivations` keyed `world.uid`. They're cleared at the end of every `checkWorldInfo` (5275), so we must emit before **every** scan.
- In the loop, external activation is checked **after** disable, generation-type triggers, character filters, delay, cooldown and the recursion flags (4800–4890). So vanilla delay/cooldown still suppress a glued entry. Probability, inclusion groups and budget still apply after it too.
- The scan uses **our object** in place of its own (`activatedNow.add(buffer.getExternallyActivated(entry))`, 4888). That object therefore needs `hash`, `decorators` and the parsed `content`. Raw entries from the book don't have them.
- Plan: before the prompt is built (`GENERATION_AFTER_COMMANDS`, script.js 4321), call the exported `getSortedEntries()`, pick the glued entries out of the result (they're fully processed, with the right hashes), and emit `WORLDINFO_FORCE_ACTIVATE` with them. Our own `ENTRIES_LOADED` handler runs during that call too, which is fine since it only removes entries.
- Glued entries should have probability off (or 100). Otherwise they can drop out on a roll. The extension can warn about this.

## 4. Masks: `WORLDINFO_SCAN_DONE`

- Emitted at the end of every scan loop (5175), **after** the budget step has added the loop's entries to `allActivatedEntries`.
- The prompt is built from `allActivatedEntries.values()` afterwards (5203), and `hash` is already a stored property. So setting `entry.content = mask` on activated entries in this event changes what's injected without touching timers.
- Side effects: the budget was measured on base content (irrelevant with a high budget). Recursion text (`args.activated.text`) still holds base content, so masked text won't trigger recursion unless we also rewrite that (allowed, see 5180).

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

## Design changes this implies

- 2.3 Glue: implemented through force-activation of processed entries, not by editing entries.
- 2.6 Masks: content is swapped after activation (`WORLDINFO_SCAN_DONE`), not at load time. Masks don't feed recursion by default.
- 3 Data model: config lives in a top-level `wihero` field, not `extensions`.
