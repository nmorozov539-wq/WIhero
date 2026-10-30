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

## M8 — Labels ✓
- `wihero.labels: ['town-x']` on entries; `#town-x` in gates, glue close lists and mask gates counts as fired when any entry with the label has fired.
- Label as target, as rules on the source entry: `gatesFor` (the targets also need this entry to have fired) and `closes` (firing this entry closes the targets).
- Validation (unknown label, self-targeting, loops through labels); panel label column and filter; editor fields.

**Done when:** a label opens a gate, `gatesFor` adds a requirement to an entry with its own gate, `closes` retires a whole label, and rewinding undoes it.

## M9 — Grouping ✓
- `wihero.folder` (`'Town X/Inn'`) and `wihero.color`: UI only, never gating.
- A folder filter in ST's World Info editor, and bulk actions on the filtered folder through ST's save path.
- Folder and color in the editor block.

**Done when:** entries can be filed into folders, the editor list filters by folder, bulk actions change the book on disk, and gating doesn't change.

## M10 — Visuals ✓
- Color stripe and a status badge on each entry row in ST's World Info editor.
- Panel grouped by folder, readable on narrow screens, ST theme colors.

**Done when:** the badges show each entry's status for the open chat before and after a turn, and the panel works on desktop and narrow layouts.

## M11 — Workspace and graph ✓
- A full-screen workspace, opened from the WI Hero panel and ST's World Info editor: top bar (book, jump box, save status), ribbon, sidebar (folders, not linked yet, labels, bookmarks, problems), tabs, right panel, status bar.
- Read-only graph: layered auto layout (pure, tested), cards with status and badges, every link type, label hubs, masks docked beside their entry, collapsible labels and folders.
- Live chat state on the cards, and a scrubber for the state at any message. Hover preview, local graph (depth 1–2), selection with a summary.

**Done when:** the sample book shows every link type with the right statuses, and scrubbing changes them.

## M12 — Entry editor in the right panel ✓
- Tabs: Entry (ST's common fields, the rest under More), Story logic (the WI Hero block's fields), Timers, Links (outgoing, backlinks, history in this chat, unlinked mentions with one-click gating).
- Saves through ST's path, keeping card-imported books in sync.

**Done when:** an entry's text, keys and story logic can be edited in the workspace and land on disk, and an unlinked mention becomes a gate in one click.

## M13 — Canvas mode and drawing links
- Canvas/Graph toggle; canvas positions in extension settings (book + id), never on entries.
- Drag to move, group areas, note cards, Tidy, undo.
- Drag from a card's handle to link; a menu asks what the link means; invalid links are refused with the reason.

**Done when:** cards can be arranged and links drawn on the canvas, positions survive a reload, and the book on disk gets the new links.

## M14 — Phones and the command palette
- Below 1000px: full-screen workspace with a top bar (drawer button, search, entry button), tab chips, bottom sheets for Link and Edit, zoom buttons and pinch, no navigation gestures.
- Ctrl K palette: entry search and commands.
- Viewport culling for big books.

**Done when:** the workspace works at 390px wide, and a 500-entry book stays responsive there.

## Later
Timeline scrubber across branches, a book-level starting state.
