# WI Hero — Roadmap

Each milestone ends with something testable. See [DESIGN.md](DESIGN.md) and [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md).

## M1 — Skeleton ✓
- `manifest.json`, empty `index.js`, settings panel.
- Installed into ST via symlink so edits show on reload.

**Done when:** the extension loads in ST 1.19.0 and its settings panel appears.

## M2 — Gate engine (no ST) ✓
- Pure function: `(prevState, firedEntries, newestMessage, config) → nextState`.
- Stable ids, duplicate detection, AND/OR gates, cycle detection, chain auto-close, closed-is-final.
- Unit tests with `node:test`.

**Done when:** tests cover every gate and chain rule in DESIGN 2.0–2.2.

## M3 — ST wiring ✓
- `WORLDINFO_ENTRIES_LOADED`: remove ineligible entries (remove only, never edit).
- `GENERATION_STARTED` filter: record on normal / swipe / regenerate / continue; skip quiet, impersonate, dry runs.
- `WORLD_INFO_ACTIVATED` → pending list → snapshot on `MESSAGE_RECEIVED` in `message.extra.wihero` (and the current `swipe_info` entry).
- Read state from the last message carrying a snapshot.
- Sample lorebook with a short chain.

**Done when:** a chain advances in a real chat, and swiping or deleting a message rewinds it.

## M4 — Glue ✓
- Force-activate glued entries from `getSortedEntries()` before each prompt build.
- Close conditions: keyword in newest message, sibling fired, held until X and Y active.
- Warn when a glued entry has probability below 100.

**Done when:** a glued entry injects every turn until its close condition, and vanilla sticky/cooldown still behave.

## M5 — UI ✓
- Per-entry gate/glue editor in the WI entry panel.
- "Fired this round" panel with per-entry fire counts.

**Done when:** a chain can be built and debugged without editing JSON.

## M6 — Railway switch ✓
- `wihero.switch: ['left', 'right']` on the fork entry: when one path fires, the others close for this branch of the story.
- A same-turn tie keeps only the first path in switch order (dropped in `WORLDINFO_SCAN_DONE`).
- Panel: why a path is closed, and a Reopen button on closed entries (the manual escape hatch).
- Editor: a switch paths list.

**Done when:** taking one path keeps the other out even when it's mentioned, a tie injects one path, swiping back restores both, and Reopen brings a closed entry back.

## M7 — Masks ✓
- `wihero.masks: [{ name, content, gates?, gateMode? }]`: alternate content, chosen by its own gates or by `/wihero-mask`.
- Applied to the activated copies in `WORLDINFO_SCAN_DONE`; the book and the entry's hash and timers are untouched.
- The selection is part of the per-message state, so it rewinds with the chat.
- Panel shows the active mask; editor edits the masks.

**Done when:** a gate-driven mask and a selected mask change the injected text, deleting or swiping rewinds them, and the book on disk never changes.

## Later
Labels; then grouping, visuals, node editor.
