# WI Hero optimization plan

**Status:** living document — the single source of truth for optimization work.
**Baseline:** `main` @ `ddac6b4` (0.47.1) plus PR #48.
**Work branch:** `perf/engine-hot-paths` (PR #48). All optimization updates land there, one commit per update.
**Supersedes:** `Astra6.md`, `Qwen4.md`, `DeepSeek-Flash.md` (removed; this document replaces them).
**Goal:** overall smoothness on the weakest denominator, before animation.
**Device policy:** the weakest Android WebView we can test. Feature-detect every modern API and keep a working fallback. Do not assume a desktop GPU, a recent Chromium, or a fast phone.
**Measurement policy:** label every number as measured-native, measured-at-6×, estimated, or unverified. A 6× CPU throttle is a comparison tool, not a phone prediction.

Line numbers below are from the 0.47.0 audits and may drift. Treat them as starting points, not guarantees.

---

## 0. Working agreement

- **One PR.** All optimization work lands on PR #48. No separate optimization PRs.
- **One commit per update.** Each commit contains the code, its tests, and the status/measurement update to this document.
- **One plan.** This document is authoritative. Do not add parallel optimization notes beside it; update this file instead.
- **Evidence before “done”.** Every workstream has a done condition. Mark it done only with a measurement, a trace, or a test that pins the behavior.
- **Behavior first.** Existing tests stay green. Any optimization that changes semantics needs a regression test that pins the intended behavior.
- **Weakest denominator.** If a fix needs `Intl.Collator`, `field-sizing`, `content-visibility`, `checkVisibility`, `IntersectionObserver`, or `requestIdleCallback`, add a fallback and test the fallback path.
- **Overall smoothness, not one symptom.** Reduce long tasks and per-draw work across all interaction paths. Do not optimize only the currently loudest screen.
- **Reviewable slices.** Do not bundle the hang fixes with the Normal-mode retention work. Land the cheap, low-risk work first.

---

## 1. Executive summary

PR #48 has already landed the engine-side hot-path work:

- lazy entry hashing (no whole-book hash on every load; sticky entries only, sampled drift check);
- a narrower model signature (only the fields `buildModel` reads);
- `readWrote` / `slotValue` caching and one `slotValues` pass per panel view;
- the `view()` O(entries × trackers) fix;
- `keywordOnSide` scanning from the end with one compiled test per key;
- hidden Extensions-panel deferral;
- `stickyHeld` hashing only entries that have a sticky.

The next moves, in order:

1. **Establish the baseline and the harness.** Disposable fixture, instrumentation, scale benchmarks, agreed budgets. **Landed**; see §2.4.
2. **Remove the measured hangs.** A–Z collation and the clash cold path (H3) are done: opening an entry in a 1,000-entry shared-key book fell from ~17 s to 0.65–1.05 s at 6×. The remaining entry-open gate is entry-page render/layout, not the clash scan.
3. **Remove the phone blur and cache the real token count.** Cheap, high-impact, and the blur is the prerequisite for compositor-only animation.
4. **Fix the typing path.** Save-path clones and stringifies, `saveSettings` cadence, history transactions and a byte budget, chat-hider and textarea work.
5. **Fix Hero per-draw work.** Per-book revisions, `canvasSig` projection, retained chrome, overlay and link-node indexes.

Then: Normal-mode retention and windowing, memory/loading/search, lazy editor, animation readiness.

**North star:** no long task over 50 ms on the interaction path; stable DOM identity; bounded memory; then animation.

**What not to do:** do not debounce `history.take()` alone; do not memoize `normalize` without cloning at mutating callers; do not remove save baselines or pending-native-save synchronization; do not virtualize before keyed rows and delegation; do not move routing to a Worker before measuring transfer; do not animate layout properties; do not change clash semantics to substring matching.

---

## 2. Baseline and what PR #48 changed

### 2.1 What #48 already fixed

| Change | Before | After |
|---|---:|---:|
| Generation cost, 200 entries | 4.2 ms | 1.9 ms |
| Generation cost, 1,000 entries | 35.9 ms | 7.7 ms |
| Generation cost, 3,000 entries | 91.3 ms | 28.8 ms |
| `JSON.stringify` calls per generation, 3,000 entries | 6,002 | 2 |
| `slotValues`, 20/60/120 tracker slots | 3.25 / 9.71 / 25.47 ms | 0.39 / 0.25 / 0.37 ms |
| `view()`, 20/60/120 tracker slots | 18.06 / 134.22 / 726.81 ms | 0.93 / 0.69 / 0.86 ms |
| Model rebuilds across 4 generate + `loadModel` | 3 | 0 |
| `loadModel` median | 36.8 ms | 17.7 ms |

Behavior comparison against the base produced the same hash (`897800cddace9896`) across four synthetic scenarios. Full suite: 325 passed, 0 failed, 7 skipped.

The `view()` number is the important correction to the earlier notes: the 1.7 ms figure in the 0.47.0 audit did not include written masks. With 120 tracker slots the real path was **727 ms per view**. Treat any future `view()` measurement as incomplete unless it includes written masks.

The #48 harness was not committed, so these numbers cannot be replayed from this repo. They are kept as history; §2.4 is the authoritative baseline from here on. The old behavior hash likewise cannot be re-verified — the new harness records a fresh fingerprint (`33c034aef964c242`) and does not claim parity.

### 2.2 What remains

The three earlier notes still contain valid work that #48 does not cover:

- the clash scan's cold path on shared-vocabulary keys (H3, opened by the B0 baseline);
- A–Z collation on every comparison;
- the tokenizer call on every entry-page draw and every 500 ms of typing;
- save-path cloning/stringifying and `saveSettings` cadence;
- history snapshots with a step limit but no byte budget;
- Hero chrome rebuilds, `canvasSig` over-invalidation, `overlay(null)` walks, and `relink` scans;
- Normal-mode full-view replacement and per-row listeners;
- bounded loading, clean-book eviction, search indexing, and Home count cancellation;
- lazy editor loading, phone blur removal, and animation readiness.

### 2.3 Landed since the plan

**H1 — clash scan (`src/ui/clashes.js`).** The W² pair scan is replaced by a token index, one cached whole-word pattern per distinct key, a per-uid group index for `of()`, and a per-book revision cache. `keyed()` now reads `rawConfig(e)?.moment` instead of normalizing the config. Call sites in `normal.js` and `menus.js` pass `library.version`; the cache also keys on the skip set so Undo invalidates it.

Synthetic desktop Node, same shapes as the 0.47.0 audit:

| Entries × keys | Before | Warm scan | Cached (same revision) |
|---:|---:|---:|---:|
| 150 × 3 | 43.5 ms | 2.0 ms | ~0.0 ms |
| 500 × 4 | 576 ms | 6.9 ms | ~0.0 ms |
| 1,000 × 4 | 1,151 ms | 12.9 ms | ~0.0 ms |
| 2,000 × 4 | 14,177 ms | 22.4 ms | ~0.0 ms |

The first call at 1,000 entries was 13.8 ms including JIT warm-up. Repeat entry-page and menu draws are free while the book revision is unchanged.

**Correction from B0.** Those numbers hold only when the keys' tokens are mostly unique, which is what the original harness seeded. With a small shared vocabulary — what real lorebooks have — the warm scan is 147–159 ms at 1,000 × 4, and the **cold** first call is ~2.1 s native in a browser: 96% of the entry-open step, and one 16–17 s long task at 6×. The plan's H1 done condition is therefore not met in that shape. H3 (§6) is the follow-up; do not mark H1 fully done.

**H2 — A–Z collation (`src/ui/data.js`).** One shared `Intl.Collator` for A–Z and one plain collator for folder/group names; `sortEntries` decorates with `titleOf` so it runs once per entry. `clashes.js`, `normal.js`, and `desk.js` use the shared text comparator.

| Entries | Before | After |
|---:|---:|---:|
| 150 | 6.4 ms | 1.1 ms |
| 500 | 26.2 ms | 2.0 ms |
| 1,000 | 61.8 ms | 3.0 ms |
| 3,000 | 221.1 ms | 12.7 ms |

Desktop Node, warm, synthetic titles. A relative timing test pins the win without relying on an absolute machine speed.

**A1 — phone blur (`src/ui/app.css`).** Removed the live `backdrop-filter` from `.wih` and `.sheet, .dlg`; the tint is layered over its own opaque color, with the previous background kept as a fallback for engines without relative color syntax. The now-redundant desktop override and the unused `--blur` variable are gone. Paint verification on the weakest device is still to do.

**A2 — switch transform (`src/ui/app.css`).** `.switch::after` now transitions `transform`, and `.switch.on::after` uses `translateX(16px)`. `.panelBtn` keeps its `left` transition because its open position is not a fixed delta; it is a low-priority single element.

**N3a — retained desktop list pane (`src/ui/desk.js`).** The book page keeps its `wrap`, left list, filter input, rows and listeners when the list signature is unchanged; selection, pane and narrow `listOpen` changes update row `on`/aria and the wrap classes, then rebuild only the right pane through the extracted `renderPane`. The signature covers book, data + book revision, model, sort/show-off/filter/collapsed folders, narrow/width, folders, global/link/chat state; switching single/multi reconciles rows. A filter/sort/data change rebuilds the list as before.

**N5 — `content-visibility` measured and rejected (`src/ui/app.css`, `e2e/paint.mjs`).** A committed CDP paint recorder now counts `Layout`, `UpdateLayoutTree`, `Paint`, `PrePaint` and `Layerize` from `devtools.timeline` + `disabled-by-default-devtools.timeline`, sums their durations, and adds `Performance.getMetrics` deltas (`LayoutCount`, `RecalcStyleCount`, `LayoutDuration`, `RecalcStyleDuration`, `TaskDuration`), DOM node counts and mounted rows for a phone book scroll, a desktop `.bllist` scroll, a Home refresh, Explain mode on/off and the Hero entry panel. It is a recording, not a gate (§7.2). After N4a/N4b, a 1,000-entry book mounts only ~30–51 rows inside the window's own 1.5-screen overscan, so `.item.ent { content-visibility: auto; contain-intrinsic-size: auto 54px }` and `.brow { … auto 32px }` had little offscreen work left to skip. On the phone scroll the Paint count barely moved (682 → 640) while layouts doubled (13 → 22) and the 6× `TaskDuration` rose from **1,408 to 1,594 ms**; on the desktop list Paint fell (974 → 497) but layouts rose (31 → 41) and the 6× `TaskDuration` rose from **989 to 1,128 ms**. Counts were repeatable across two 1× runs; Home, Explain on and Explain off were unchanged. The CSS was reverted. A narrower trial on the non-windowed Hero panel (`.prow`, 1,000 rows) improved opening once (1× `TaskDuration` 447 → 360 ms) but made scrolling worse (Paint 22 → 286, layouts 0 → 10, `TaskDuration` 312 → 391 ms), so it was reverted too. Behaviour with the windowed trial: `window.mjs`, `window-desktop.mjs`, `explain.mjs`, `desktop.mjs`, `normal-rows.mjs`, `home-rows.mjs`, `entry-pane.mjs` and `desk-pane.mjs` all passed; scroll-to-top/bottom returned the exact first/last titles and `scrollHeight` stayed stable over three cycles (phone 53,252 px baseline, 53,262 px with the trial; desktop 31,376 px both); mounted rows stayed 56 px (phone) and 32 px (desktop) with no zero-height rows; `window.find()` found visible and offscreen-but-mounted titles either way, and failed on windowed-away titles both before and after — the unmounted limit belongs to N4, not N5. Explain mode does not outline `.item.ent`/`.brow`, so its 26 checks exercise the Hero surface only. The same check recorded a pre-existing N4a estimate drift: a phone `.item.ent` measures **56 px**, while `window.js` still estimates 54 px, so `scrollHeight` grows ~76 px as the first rows are measured (53,186 → 53,262 px). That is N4a's estimate, not N5, and was left unchanged by N5; G3 later set the estimate to the measured 56 px, so the phone list is 55,080 px from the first frame and stable (§2.3).

| Case (1,000-entry "Perf Big") | CPU | Layout | UpdateLayoutTree | Paint | PrePaint | Layerize | TaskDuration |
|---|---:|---:|---:|---:|---:|---:|---:|
| Phone scroll 6,000 px | 1× | 13 → 22 | 32 → 41 | 682 → 640 | 89 → 96 | 34 → 33 | 328 → 333 ms |
| Phone scroll 6,000 px | 6× | 13 → 22 | 32 → 41 | 682 → 638 | 85 → 91 | 30 → 28 | **1,408 → 1,594 ms** |
| Desktop scroll 6,000 px | 1× | 31 → 41 | 31 → 41 | 974 → 497 | 82 → 92 | 31 → 31 | 285 → 302 ms |
| Desktop scroll 6,000 px | 6× | 31 → 41 | 31 → 41 | 974 → 497 | 72 → 82 | 22 → 22 | **989 → 1,128 ms** |
| Home refresh | 1× | 1 → 1 | 2 → 2 | 43 → 43 | 4 → 4 | 3 → 3 | 24 → 15 ms (noise) |
| Home refresh | 6× | 1 → 1 | 2 → 2 | 43 → 43 | 4 → 4 | 3 → 3 | 110 → 98 ms (noise) |
| Explain on | 1× | 2 → 2 | 6 → 6 | 105 → 105 | 24 → 24 | 6 → 5 | 295 → 320 ms (noise) |
| Explain on | 6× | 2 → 2 | 6 → 6 | 105 → 105 | 24 → 24 | 5 → 5 | 1,653 → 1,665 ms |
| Explain off | 1× | 1 → 1 | 4 → 4 | 102 → 102 | 22 → 21 | 6 → 5 | 96 → 85 ms (noise) |
| Explain off | 6× | 1 → 1 | 4 → 4 | 102 → 102 | 21 → 21 | 5 → 5 | 491 → 510 ms |
| Hero panel open (`.prow`) | 1× | 12–19 → 14–16 | 19–25 → 19–20 | 19 → 67–68 | 35–38 → 39–40 | 13–14 → 14–15 | 431–447 → 360–361 ms |
| Hero panel scroll 6,000 px (`.prow`) | 1× | 0 → 10 | 11 → 21 | 22 → 286 | 69–76 → 98–99 | 38–45 → 47–48 | 312–320 → 386–391 ms |

Measured-native-browser at 1×; measured-at-6x at 6×. Phone runs at 390 × 844, desktop at 1366 × 768. Counts are CDP complete events in the measured window; `TaskDuration` is the `Performance.getMetrics` delta. The windowed-list table is before → after the reverted CSS; the `.prow` rows are before → after that separate reverted rule.

**N4a — windowed phone book list (`src/ui/normal.js`, `src/ui/app.js`).** The phone book page keeps its header, chips, selection head and bottom bar, but materializes only a window of the flat group-head/row/note list between top and bottom spacers. The window is the viewport plus overscan on either side (~19 rows at the top, ~26 at the middle after G3's 0.5-screen overscan at 390 × 844); books of 200 shown entries or fewer keep the old all-rows path. Mounted heights are measured after render (ResizeObserver and one measurement per new node) into a cache keyed by item key; unknown entries use 56 px (the measured row), folder heads 44 px and notes 96 px as estimates until measured, and the spacer for each skipped run is corrected from the cache. The first row in the window is the anchor, so a height correction adjusts `scrollTop` by the anchor's movement instead of letting content jump; the book `.view` sets `overflow-anchor: none` so the browser does not also compensate when the window removes rows above it. Scroll work is one rAF; a frame that stays inside the same range does no keyed work. A focused row is kept mounted at its true position (with a spacer either side) when the window moves away, including across a refresh and while the entry pane hides the list (N3b); once focus leaves it, the next draw drops it. `keyed()` itself is unchanged for Home/search/desktop apart from G3's placement order. Measured-native-browser in `e2e/window.mjs` at 390 × 844 on the 1,000-entry "Perf Big" book (980 shown): open mounts **19** rows instead of 980, with **222** DOM nodes in the view and `scrollHeight` 55,080 px for the whole book; the middle mounts **26** rows and the bottom **19**; a settled refresh mounts **0** rows (`appRenders` 1) and keeps the visible row's node and `scrollTop`; a 12-step scroll sweep mounts 306 row nodes as they arrive and ends with 19; opening the last entry and Back is 0 + **0** row mounts with the same row, scroll and recomputed window; the focused first row stays mounted and focused 6,000 px away (27 rows), survives a refresh, and is windowed out after blur; select mode and a long press work on windowed rows; the prompt-order and size sorts keep the window and scroll; a folder head folds 18 → 0 rows and unfolds to 18 with the same head node. The harness has no paint trace, so the paint/memory half of N4's done condition is still outstanding (G3's `e2e/scroll.mjs` adds the scroll gate and `e2e/paint.mjs` the CDP counts), and the desktop `.bllist` is N4b.

**N4b — windowed desktop book list (`src/ui/desk.js`, `src/ui/window.js`).** The desktop book page's `.bllist` now mounts only a window of its folder heads and `.brow` rows, with top and bottom spacers sized from a measured-height cache; books of 200 items or fewer keep the all-rows path. The window mechanics extracted from N4a live in `src/ui/window.js` (`createListWindow`): range maths, gap nodes, the anchor-held height correction, the focused-item pin and the scroll rAF. The phone `.view` passes its header/chips/selection head as a prefix; the desktop list scrolls itself and has no prefix, and adds `aria-setsize`/`aria-posinset` to every row from the whole visible order (folder heads do not count). `reveal(uid)` first uses a mounted row, otherwise computes its place in that order, scrolls/materializes the window around it and then calls `scrollIntoView({ block: 'nearest' })`; Arrow Up/Down still walk the full `order`. The window state is per list; N3a's replacement of the whole `.bk` mount disposes the old ResizeObserver. A filter/sort/data change still clears and rebuilds the list (`list.innerHTML = ''`); a scroll only redraws the window. Measured-native-browser in `e2e/window-desktop.mjs` at 1366 × 768 on the 1,000-entry "Perf Big" book (980 shown): open mounts **23** rows and **176** DOM nodes in the list with **23** `rowMounts` instead of 980, while `scrollHeight` is **31,376 px** for the whole book; the bottom mounts 21 and the middle is around entry 490 with 32 rows and every mounted title matching its row. A mounted row says 1 of 980; with the selected row scrolled out at 20,000 px, ArrowDown selects the next uid in the whole order and scrolls back to it, and ArrowUp returns. A focused Prompt-order input stays mounted 6,000 px away (32 rows) until blur. A settled refresh mounts 0 rows and keeps the visible row, its scroll and a 32-row window at 600 px. Ctrl/Shift selection, N3a's same list/row node across a selection and Book settings (bounded window), drag reorder between two visible rows (displayIndex only, Order untouched), a filter (1 row, rebuilt on the next draw, 22 after clearing), folder fold/unfold (21 → 0 → 19 rows) and a drop on a visible folder head all pass. **Limitation:** only mounted rows and visible folder heads exist as drag targets; in-window reorder and visible-folder drops work, a target outside the window needs scrolling first (no auto-scroll while dragging). `e2e/window.mjs` reports N4a's 19/26/19 rows, 222 nodes and 55,080 px after G3, so the shared helper did not change the phone list.

**N3b — retained phone list pane (`src/ui/app.js`).** Phone Normal keeps the last list page's `.view` (Home or a book) and draws an entry page in a second `.view` beside it. The pane off screen is `hidden` (no layout, no focus) rather than removed, so Back returns to the same rows, listeners, scroll and focused row; moving between entries rebuilds only the entry `.view`. The retained list's `scrollTop` and focus are saved before hiding and restored after the keyed draw, because `display:none` may reset scroll on some engines. A page change (another tab, another book, Home, deep link) discards the list as before. Measured-native-browser in `e2e/entry-pane.mjs` at 390 × 844 on the 1,000-entry "Perf Big" book: opening an entry is one app render with 0 `rowMounts`; Back is one app render with **0** `rowMounts` (before N3b the same Back rebuilt the list: one app render, **980** `rowMounts`). A title edit made while the entry is open updates the same row on Back, also with 0 new row mounts. N4a narrows the retained rows to the mounted window; the identity and scroll checks still hold.

**N2a — phone row delegation (`src/ui/dom.js`, `src/ui/normal.js`).** One `delegatePress(root, resolve)` on `main` replaces `pressable` on Home rows/tiles and Normal entry rows: 480 ms long press, 8 px cancel, `pressing`, button/check skip, click swallow and contextmenu, resolving the row's live book/uid at event time. Switch/more/order buttons keep their own listeners. Desktop `.drow`, search results and sheet rows stay on `pressable` for now.

**N2b — desktop list and search delegation (`src/ui/desk.js`, `src/ui/normal.js`).** Desktop Home rows/tiles, book-list `.brow` rows, folder drop heads and both search lists no longer allocate row listeners. `desk.js` puts one set on the draw's `.dhome` (click, Ctrl/Shift, middle-click, Enter/Space, contextmenu, drag to a folder), on the retained `.bllist` (select, Ctrl/Shift, double-click, middle-click, contextmenu, reorder and folder drops) and on each search result box (hover, click, middle-click); events resolve the live row from `data-book`/`data-uid`/`data-folder` or the result's index. Phone search rows join N2a's `delegatePress` on `main` and keep the 480 ms long press, 8 px cancel and prevented contextmenu. Switch, ⋯, Order, folder fold/add and tab buttons keep their own listeners. `e2e/delegate-desktop.mjs` covers every surface; CDP `DOMDebugger.getEventListeners` reports 0 listeners on the Home row, one `.brow`, one desktop result and one phone result, with the delegated set on `.dhome` (10), `.bllist` (11), `.dsres` (3) and `main` (7).

**N1b — keyed Home rows (`src/ui/normal.js`).** Home now keeps its `.view` too: book rows/tiles key by name, folders by folder, the header and notes by stable keys. Selection, badges, open/closed folders and labels update in place; the count span is never overwritten while a book is still loading, so an arriving count survives; scroll and focus persist. List/tiles switch keeps the view but replaces the rows.

**N1a — keyed Normal book rows (`src/ui/app.js`, `src/ui/normal.js`).** A book page keeps its `.view` across a draw for the same `pageId`; the header, chips, off hint, group heads and entry rows are reconciled instead of rebuilt. Rows key by uid, group heads by book+folder, and selection/order/size/switch/problem/logic state update in place. Handlers late-bind the current entry by uid; scroll and focus survive. Home rows, the bars, the entry page and desktop panes still rebuild (N1b/N2/N3).

**V6 — badge patching (`src/ui/canvas.js`, `src/ui/hero-shell.js`).** The signature no longer includes chat length/text/swipe; chat state on still draws once when toggled, because cards are built with or without status nodes. On an unchanged retained canvas, a chat change calls `patchStatus`: card classes (`closed`/`waiting`/`holding`/`happened`), grip ring, the `.k` line (closed/value/mask/keywords via the same `cardLine` helper the draw uses), the fired/once/closes badge (add/remove/text), the Moment tag and the layer-nav dot. No link routing, no card recreation. The harness `?perf=1` profile now has a real model and a mutable state object, so `e2e/badges.mjs` can prove fired, closed, holding and Moment changes patch without a `canvasRenders` increase.

**V3c — retained panel and inspector (`src/ui/hero-panel.js`, `hero-inspector.js`, `hero-desk.js`).** The entry panel keeps one shell per book/layout: button, aside, header/search/new/select, list container and scroll listener, selection bar, footer/tool row, with handlers reading the current draw. The inspector keeps `.insp` and its header per book+selection+column; the body is redrawn inside it, and the shell survives a same-selection draw. A different book/selection/layout rebuilds; a detached shell is reattached; `data-retained` nodes are skipped by the canvas cleanup. Panel rows and the inspector body are still rebuilt inside their shells — that is N1's keyed-row work.

**V3b — retained piece bar (`src/ui/piecebar.js`).** The non-edit `.pbar` is kept on the Hero bar state per book/root/layout: fold button, all chips, hint, more button, scroll listener and `ResizeObserver` survive a draw; armed classes, `aria-pressed`, the arm banner and fold state update in place. A detached bar (tab switch cleared `main`) is reattached; another book/layout rebuilds. Edit mode keeps its temporary strip. `e2e/pbar.mjs` holds the bar/chip/fold node across refresh, arm, fold/unfold and Preview→Canvas.

**V3a — retained tab row (`src/ui/dom.js`, `app.js`, `desk.js`, `hero-shell.js`).** A small `keyed(box, items, make)` reconciler keeps tab nodes and listeners: Home, book tabs by book, entry tabs by book+uid (desk/phone) or tab object (Hero), with a suffix for duplicates. Labels, active/fixed classes, strategy dots, book icons, unsaved badges, close buttons and explain metadata update in place; handlers resolve the current tab by key at click time. `.tright` is retained and reconciled too. Panel, piece bar and inspector shells are V3b.

**V4 — overlay no-op (`src/ui/canvas.js`).** `overlay(null)` on an already-clear canvas returns before touching any card. When an overlay was applied, only the nodes it classed are cleaned; a full draw resets that node set. Actual overlays still walk the cards once, as before.

**V5 — link node indexes (`src/ui/canvas.js`).** A draw records `linkId → line nodes` and `linkId → hit path`, plus a queue-by-id map. `relink` now removes and redraws only the changed link's own nodes instead of scanning every `.ln`/`.lhit`. The double `JSON.stringify(mem)` around `arrange` stays deferred (§10.D).

**V2 — canvas signature (`src/ui/canvas-sig.js`).** The Hero signature is split: the entry side (title, keys, strategy, off, folder, problem, graph rows, mask names/gates, Moment phrases, note) is built once when `modelOf` builds a model and cached on it; the per-draw side is only saved cards, `placed`, hidden entries and chat identity. `edited`, `seen`, `snapshots`, folders, defaults, body content, camera and library revisions are out. The changed path computes the signature once, no longer returns `null` for chat state, and the fresh mount signs after its draw. Measured-native: entry side 6.1 ms at model build (1,000 entries), per Hero draw 0.58–0.90 ms with 500–862 cards. Until V6 patches badges in place, chat state on adds a cheap chat revision (`length`, last text length, swipe) so a new message still updates badges; a content edit does not move it.

**V1 — per-book revisions (`src/ui/st-books.js` and cache keys).** The library now keeps a monotonic per-book revision (`bookVersion(name)`, 0 when unknown) beside the global one. `dirty`, external updates, `newCopy`, remove and rename maintain it; saves that only confirm do not bump. The model cache, clash count/marking, Moments cache, Hero `canvasSig` and checks signature key the book revision, so editing B no longer invalidates A. History still uses the global version deliberately: it only looks at the open book, and a global bump forces a compare, not a lost edit.

**T4 — chat hider (`src/show-in-chat.js`, `index.js`).** A per-box memo stores the message text, WI Hero on/off, model identity, author fields and rendered output; an unchanged box is not reformatted. The five render events share one pending-id queue and one timeout. `all()` reads the model and flag once. The memo clears on chat/book changes, drops pending hides, and clears on ST's `SETTINGS_UPDATED` so a formatting change cannot stale it.

**T5 — textarea sizing (`src/ui/entry-page.js`, `src/ui/app.css`).** `.en textarea` uses `field-sizing: content`; when `CSS.supports` says no, the measured fit is coalesced to one rAF per frame. `e2e/sizing.mjs` forces the fallback before page scripts load, opens the 100 KB entry, and checks the first-frame height and growth on input.

**T3 — history runs and a byte budget (`src/ui/history.js`).** A quiet run captures the pre-edit state once and the final state once at its boundary; the keystrokes between them cost a timestamp update, not a whole-book stringify. A pause of 1 s, a non-quiet edit, a redraw, `settle`, or undo/redo ends the run. Captured states carry an estimated size; a global 12 MiB budget evicts the oldest state across every book's undo and redo stacks (per-book 100-step cap kept), and `stats()` exposes bytes/steps for tests. `held`, external resets, camera exclusion and redo clearing are unchanged.

| Entries | Per-keystroke edit before | After (run continuation) | p95 after |
|---:|---:|---:|---:|
| 150 | 0.32 ms | 0.011 ms | 0.035 ms |
| 1,000 | 2.83 ms | 0.010 ms | 0.021 ms |
| 5,000 | 10.44 ms | 0.006 ms | 0.052 ms |

Measured-native, `bench-history.mjs`. The two boundary captures still serialize the whole book once each; that is the remaining bounded cost, not a per-keystroke one. Patch-level state (the plan's item 3) was not taken up: the run keeps whole states at its two ends, and the byte budget caps how many of those survive.

**T1 — save path (`src/ui/st-books.js`).** Comparison bases (`bases`, `cacheSeen`) are JSON text, not objects; the second whole-book clone (`sent`) is gone, and the native-cache comparison stringifies once. Typing stretches the debounce 350 → 525 → 788 → 1000 ms; a discrete edit after idle stays at 350 ms; retries keep their own delay. The crash-loss window is documented and still bounded by `flush` on hide/close. Save baselines, concurrency checks, the pending-native merge and retries are unchanged.

| Entries | Save median before | After | Serialized chars before | After |
|---:|---:|---:|---:|---:|
| 150 | 8.18 ms | 4.4–5.3 ms | 3.32 M | 2.49 M |
| 1,000 | 65.38 ms | 28.8–43.5 ms | 22.8 M | 17.1 M |
| 5,000 | 157.34 ms | 90.6–91.3 ms | 119.6 M | 89.7 M |

Measured-native, `tools/perf/bench-save.mjs`, 40 one-character changes in 5 rounds of 8. The ranges are two runs; the machine is noisy.

**T2 — one settings save (`src/ui/st-books.js`).** `saveNow` sets `edited` once, adopts UI fields, then calls `saveSettings()` once; the payload shape and ST's save are untouched. The bench records one settings save per save (5/5).

**T0 — token count (`src/ui/token-count.js`, `src/ui/entry-page.js`).** One counter per entry page: a cached count per exact text, an in-flight request shared for the same text, a 1200 ms idle for typing, an immediate flush on blur, and no request while the document is hidden or the page has been rebuilt. The page keeps `tokenGuess` visible; the real number lands only when it resolves and the text has not changed. Opening an entry still makes exactly one call; the perf-harness typing step still records one.

**C10 — row containment (`src/ui/app.css`).** `.item, .ptile, .drow` get `contain: layout style paint`; `.card` deliberately does not (sticky notes sit above it). Tested on the 1,000-row book: explain mode, desktop and tiles pass with no clipped outlines. A CDP counter run at 6× during a 6,000 px scroll showed **no change** (0 layouts and 9–11 style recalcs either way), so this is an unverified paint intermediate, not a measured win. Scroll anchoring and in-page find are still untested, and the paint trace/device evidence is outstanding.

**C7 — Home sort keys (`src/ui/desk.js`).** `homeSort(list, key, dir, val)` decorates each book with its sort key once, then sorts and maps back; an Entries sort no longer re-counts a book's entries inside the comparator. Order and tie behavior are unchanged.

**C8 — links index (`src/ui/st-books.js`).** The book → links answer is built once per Home pass and cached; character order, aux order, duplicate suppression and the open chat's row are preserved. It clears on `CHARACTER_EDITED`, `CHAT_CHANGED`, and inside `unlink`, `linkChat` and `rename`; array identity is a short-circuit, not the only guard.

**C4 — parsed icon templates (`src/ui/icons.js`, `src/ui/dom.js`).** `ic()` carries an icon marker; `icNode` clones a cached `<template>`; `btn()` uses it for icons, and rows, tiles, search results and the greeting/Moment card grips clone instead of parsing. `setIcon` wraps `replaceChildren` for direct nodes. Sheets, inspectors and one-offs still use `ic()`.

**C5 — cached tone (`src/ui/app.js`).** `toneOf` runs once per theme change: the value lives in the app closure, is cleared on `show()` and by a small `MutationObserver` on `documentElement`/`body` theme attributes.

**C3 — cached `normalize` with clones (`src/engine/model.js`, `src/ui/pieces.js`, `src/ui/hero-desk.js`).** `normalize` caches `{ config, ui, legacy }` per raw object. `buildModel` asks for a reread because ST can edit a config in place; the reread also refreshes the cache. `bookEditor.config` and the Hero duplicate path hand out deep copies before mutating; the rest of the callers were audited read-only or already write through `writeConfig`, which clones. The cache's comment names the clone rule.

**C6 — cached character/tag choices (`src/ui/data.js`).** `filterChoices` gains `setProvider`/`invalidate`; `get` caches the provider's arrays until a character or chat change clears them. `index.js` clears before refresh draws, not after.

**C2 — grouped model issues (`src/ui/model-issues.js`).** `modelOf` attaches `issuesByStKey` once per built model; `problemsOf`, `warningsOf` and Hero's `blockingUids` read it instead of filtering the whole issue list per row, with a fallback scan for models built outside `modelOf` (tests, trial copies).

**C9 — Moments fast path (`src/ui/canvas-graph.js`).** The book's Moment list is cached per data object and library revision; placed Moments are filtered per call, and the canvas model is built only when an unplaced Moment remains. `need()` passes `library.version`; `revision === null` computes uncached.

**H3 — clash cold path (`src/ui/clashes.js`).** Phrase enumeration replaces the per-word RegExp candidate scan. Every contiguous token span of each normalized key is indexed as a phrase, sliced from the key so separators survive (`old-mill` is not `old mill`); a clash is a phrase held by two or more entries, and `of()` looks up the entry's own spans. Keys with no alphanumeric token, or punctuation on an edge, keep the old boundary scan. The whole-word contract is unchanged.

| Measure | Before | After |
|---|---:|---:|
| cold, fresh process, 1,000 × 4 shared | 149–157 ms median, 1.95 s p95 | 34.8–37.5 ms |
| cold, mixed 1–3 word shared (135 groups) | — | 10.2–11.0 ms |
| warm, 1,000 × 4 shared | 147–159 ms | 10.9 ms |
| warm, 1,000 × 4 unique | 16.9 ms | 11.9 ms |
| warm, 500 × 4 shared | 40.4–43.3 ms | 5.1 ms |
| entry open at 6× | 15.8–17.5 s; clash 15.3–16.9 s | 0.65–1.05 s; clash 95–98 ms |
| entry open native | 2.27 s; clash 2.10 s | 170 ms; clash 14.6 ms |

The 6× entry-open worst task is still 0.28–0.49 s, so §4.2's gate is open — but the scan is no longer the cause. `entryPage` is 117–123 ms at 6×; the rest is page layout/paint. That belongs to the entry-page work (C4/T0/N3), not to H3.

The harness step changed with this work: B0's entry-open step clicked `nth(3)` after scrolling 6,000 px, so Playwright scrolled 1,000 rows back up inside the measured step. H3 scrolls to the top outside it. The `clashScan` delta is like-for-like; the step totals are not directly comparable to §2.4.

**Tests.** `test/clash-cold.test.js` runs the old pair scan as an oracle beside the new one at 1,000 × 4 shared keys, with punctuation, case changes, regex keys, Moments, permanent entries and a tokenless key; groups and every `of()` answer must match. Full suite: 337 tests, 330 pass, 0 fail, 7 skipped. `tools/perf/bench-clash-cold.mjs` records both cold shapes in a fresh process on every `npm run perf`.

**M1 + M3 — shared loader and leaving Home (`src/ui/loader.js`, `src/ui/app.js`).** Every book read now goes through one loader over `library.get`, which stays the only read path and still dedupes an in-flight read. Home counts are background work with the old concurrency of three; `need(book)` is foreground work, starts at once even with three count reads running, and promotes a queued count for the same book instead of queueing it again. `cancel()` drops queued background items and bumps a generation; a count callback captures `loader.generation()` and writes its span only while `loader.isCurrent(gen)` and the span is still connected. The app clears `countSpans` and cancels when the page leaves Home (book, entry, Hero, hide) and when a fresh Home draw replaces the list; a retained Home draw does not cancel, so a count that lands while Home is up still writes its row (N1b). In-flight reads cannot be aborted, so they finish, free their slot and start nothing: the queue is empty and their callbacks are stale.

Harness evidence (`e2e/load-priority.mjs`, 13 books, every read delayed 400 ms, no ST): Home starts **3** reads (max **3** at once) and leaves **10** queued; tapping a queued book makes its read the next start and the book opens while **9** books are still uncounted; **0** count reads start after leaving Home and only the three in-flight reads finish; returning Home reads the **9** uncounted books again and every visible count lands — **13** reads for **13** books, no duplicate read, max **4** at once (three background plus the opened book). Unit tests (`test/loader.test.js`, 7) pin foreground ahead of queued background, the three background slots, a cancelled name never reaching `load()`, a stale generation writing nothing, same-name dedupe, promotion of a queued load, and a failed read freeing its slot.

**M2 — summaries, LRU eviction and pinning (`src/ui/st-books.js`, `src/ui/history.js`, `src/ui/app.js`, `src/ui/normal.js`, `src/ui/desk.js`).** Home no longer needs a book's working copy to draw its count. Each book keeps a summary `{ entries, total, tokens, revision }` beside its existing per-book revision: a read takes it once (`createLibrary`'s `summarize` option; the app supplies `entriesShown`, total entries and `bookTokens`), and `library.summary(name)` answers a Home row, tile or desktop count column synchronously. A `change` does not walk the book: it bumps the book revision, which makes the summary stale, and the next Home ask recomputes it once from the working copy. Only a missing/stale summary with no working copy falls back to M1's background read. A save needs no separate invalidation because it writes the same entries (an outside merge bumps the revision too); `invalidateSummary` covers the app's undo-toast hidden set, and an outside save with no copy takes the new summary straight from the event, with no read.

Working copies now have a bound: `MAX_COPIES = 8` clean copies, tracked in LRU order touched by `get`, `peek` and `change`. Eviction runs after a read or save finishes (never inside a change) and drops `copies`, `bases`, `cacheSeen` and the LRU entry of the oldest clean book until the cache fits; the summary is taken first, so Home stays read-free. It keeps the book revision, the As imported record (`seeded`) and `settings.books[name]`. Pinned and never evicted: the app's open books (every tab's current page, Hero's book), every book with undo/redo states (new `history.booksWithStates()`), dirty books, pending saves and retries, saves in flight, failed-for-good saves, running book operations, reserved names, and loads in flight. `library.stats()` reports `{ copies, summaries, pinned, evictions, maxCopies, estimatedBytes }`; `e2e/memory.mjs` reads it with a forced-GC heap.

Bounded-memory evidence (`e2e/memory.mjs`, `?saves` runs the real library, 40 generated books + 1,000-entry "Perf Big", 390 × 844, unthrottled Chromium 158, AMD Ryzen 5 3500U / 8 cores / Linux x64, Node 26.13.0; **measured-native-browser**):

| Point | Heap after GC | Copies | Summaries | Evictions |
|---|---:|---:|---:|---:|
| Home counts settled | 11,548,592 B (11.0 MiB) | 8 | 41 | 33 |
| cycle 1 | 11,953,944 B | 8 | 41 | 34 |
| cycle 2 | 12,145,580 B | 8 | 41 | 35 |
| cycle 3 | 12,356,788 B | 8 | 41 | 36 |
| cycle 4 | 12,537,792 B | 8 | 41 | 37 |
| cycle 5 | 12,804,196 B | 8 | 41 | 38 |
| cycle 6 | 12,964,752 B | 8 | 41 | 39 |
| cycle 7 | 13,128,584 B | 8 | 41 | 40 |
| cycle 8 | 12,558,356 B | 8 | 41 | 41 |
| cycle 9 | 12,707,952 B | 8 | 41 | 42 |
| cycle 10 | 12,776,152 B | 8 | 41 | 43 |

Growth from the middle of the run over the last five cycles is **324,388 B (~317 KiB)**, against a 4 MiB / 12.5% environment-relative limit; the series rises to ~13.1 MB then settles lower after a GC. Copies stay at the bound (nothing pinned at Home), all 41 summaries stay, and a list/tiles round trip redraws all 41 counts with **0** library reads. A second pass edits an entry with a delayed save, forces 46 evictions while it is dirty, lets it save, opens ten other books (evictions 56), and then Undo on the reopened book restores the text: the dirty copy and the undo state are both pinned. This is a browser heap, not a phone heap snapshot; the weakest-device evidence stays in §7.5.

Tests: `test/library-memory.test.js` (16) covers summary freshness and lazy recompute, a summary outliving its evicted copy with no read, LRU order, the bound, open/dirty/in-flight/unsaved/reserved/history pins, stats, rename/remove/duplicate/create cleanup, an outside save after eviction, and a Home pass with no reads. `test/library-memory.test.js` also pins `booksWithStates` against a real history. Suite: 412 tests, 405 pass, 0 fail, 7 skipped.

**M4 — search index, debounce and background loads (`src/ui/search.js`, `src/ui/normal.js`, `src/ui/desk.js`, `src/ui/loader.js`, `src/ui/app.js`).** Opening either search no longer calls `need`/`get` for the library. The overlay builds a lowercase corpus per book — name and book folder, and each visible entry's title, key words and folder — and caches it on the book revision (V1), the working-copy object and a settings revision bumped by each save, so a folder move rebuilds once and a `library.change` rebuilds that book. The app invalidates one book when the Undo-toast hidden set changes without a revision. The empty first query runs at once and warms the corpora; typing waits 130 ms, and Enter or an arrow flushes a waiting query before acting. The scan (`searchCorpus`) is the old `data.search` ranking unchanged: current book's entries, other books' entries, book names, folders, with folder rows deduped and the old 80/60 caps after the scan. Unloaded books are counted as "N books not searched yet"; **Search all books** enqueues only those through the loader in a `search` group (background, bounded at three) and each arrival rescans the current query in place — the overlay and its field are not rebuilt. Closing or rebuilding search cancels that group only, so Home's counts are untouched; a completion carries the group generation and the overlay owner and writes nothing when either changed. The new control is described in Explain mode (`search.all`: loads the unsearched books in the background, changes nothing) and is blocked there like the other search controls.

Harness evidence (no ST). **Read counts and typing** (`e2e/search.mjs`, 390 × 844 phone; standard harness with every read delayed 400 ms): opening search read **0** books and named **3** of **7** as not searched yet (four had loaded on Home/for the open book); Search all books read those **3** with max **3** at once and left the overlay open with the same field node; closing it dropped the queue with **3** reads in flight and **0** new starts. On the 40-book profile (`?perf=1&books=40&entries=150&big=1000`, current "Perf Big" loaded, measured-at-6x): one character ran **1** scan taking **9.1–12 ms** over two runs, no task over 50 ms, **0** corpus builds; at 1× (measured-native-browser) the same scan took **1.9–3.8 ms**. No absolute time is asserted. `e2e/perf-harness.mjs` search typing at 1× is **746 ms** (M2 844 ms) and at 6× **1,236 ms** against B0's 3.57–3.79 s; its worst task fell from **1.68–1.93 s** to **109 ms**, now the one-time 41-corpus warm on open, with 5 runs (the open plus four 150 ms-spaced keys) and 41 builds. A 10-key burst in `e2e/search.mjs` runs search **once** after the debounce with **0** rebuilds. Ranking is held by `test/search.test.js`, which compares `searchCorpus` with `data.search` on every query/current-book fixture (case, keys, book/folder names, folder dedupe, off entries); the harness checks off entries still search, Moments never do, one folder row for two entries, and the open book's rows first after Search all. Suite: 420 tests, 413 pass, 0 fail, 7 skipped.

**L1 — lazy editor (`index.js`, `src/ui/lazy-app.js`, `style.css`).** `index.js` no longer statically imports `src/ui/app.js`: the editor chunk is a dynamic import behind the World Info drawer, a queued book request, or an idle prefetch ~3 s after boot. The engine side and `globalThis.wihero` stay eager (`app` is a getter that is null until loaded, plus a `ready` promise). A minimal `#wihero-loading` placeholder fills the drawer's place while the chunk resolves; a failed import removes `wihero-under` so ST's own drawer is shown, reports a toast and lets the next open retry. Drawer changes carry a ticket, so a fast open/close cannot show the editor or leave the drawer hidden. The host's `touchstart`/`mousedown` stopPropagation listeners and the side-panel class syncs attach once, after the chunk loads. `app.css` moved with the chunk; `style.css` stays eager.

Measured-native graph (`node tools/boot-graph.mjs`, Node 26.13.0; `--at HEAD` is the pre-L1 boot graph):

| Boot graph | Modules | Bytes |
|---|---:|---:|
| Before — eager static | 70 | 1,196.2 KB |
| After — eager static | 29 | 293.8 KB |
| After — deferred editor | 42 | 909.7 KB |
| After — total reachable | 71 | 1,203.5 KB |

The deferred half starts at `src/ui/app.js` and carries `canvas`, `desk`, `normal`, `hero-*`, `menus`, `explain`, `guide`, `preview`, `piecebar`, `inspector`, `link-engine`, `history`, `loader`, `search` and the rest of the editor graph; the eager half keeps hooks, the engine, the panel, bubble, library, data and compat. The extra module over the pre-L1 total is `src/ui/lazy-app.js`.

Browser boot evidence (`e2e/boot.mjs` on `e2e/desktop/boot.html`, which imports the real `index.js` with a stub ST; measured-native-browser, 390 × 844, unthrottled Chromium 158, no ST): at boot the server request log and `performance.getEntriesByType('resource')` contain no `src/ui/app.js`, no editor module and no `app.css`; opening the drawer requests each exactly once, removes the placeholder, resolves `wihero.ready` and draws a Home row in **159–244 ms** across five runs; the idle prefetch loads the chunk with the drawer closed and shows nothing; a fast open/close during a 500 ms delayed `app.js` load leaves no `wihero-under`, no placeholder and a hidden host; a book chosen through ST's editor dropdown opens on that book; an aborted `app.js` request restores ST's drawer, reports a toast and leaves `wihero.app` null. This is a launch-harness measurement, not an ST boot trace.

Tests: `test/lazy-app.test.js` (6) pins one create for concurrent loads, the ready promise, delay→idle prefetch, cancellation and retry after failure; `test/boot-graph.test.js` (3) pins the boundary. Suite: 429 tests, 422 pass, 0 fail, 7 skipped. The editor harness (`e2e/desktop/harness.html`) stays eager by design; a live-ST drawer/lifecycle run and `e2e/perf.mjs`'s `firstRowMs` are not verified here.

**A3 — reduced motion and hidden-page pause (`src/ui/page-motion.js`, `src/ui/app.js`, `src/ui/app.css`, `src/ui/canvas.js`, `src/ui/canvas-input.js`, `src/ui/canvas-mouse.js`, `style.css`).** The existing reduced-motion rule now also covers pseudo-elements (`*, *::before, *::after`), so `.switch::after`, `.opt…::after` and `.colresize::after` stop transitioning as well as the elements themselves; it stays in the editor's shadow stylesheet, so `*` never reaches ST's page. The eager `#wihero-loading` placeholder gets its own reduced-motion rule (it has no motion today). Non-motion feedback is untouched: a dimmed card still reads at 0.5, and a paused/removed ring or pulse leaves its element and text in place.

While the document is hidden, `createPageMotion()` (attached inside `createApp`, so a never-opened editor pays nothing) toggles `.wih[data-paused]`; the rule parks CSS animations with `animation-play-state: paused` and turns transitions off, covering pseudo-elements too. The same attribute is kept while `hide()` has the host hidden and cleared by `show()`. A missing `visibilityState`/`visibilitychange` is the visible path. `scheduleRender` no longer queues a frame while hidden and cancels a frame already queued, `refresh`/`render` defer the same way, and the pending draw runs once on `visibilitychange` back; no work is dropped. A mounted canvas gets `pause()`/`resume()`: the view/live/flash/gesture/camera timers and the input's drag/edge/hold and hover timers are cancelled, guides/boxes/targets are dropped, a pan's camera and a card/shape drag's last change are kept and saved once, and the app draws the catch-up frame on the way back. The canvas input/rAF loops do not keep running behind a hidden page.

`e2e/motion.mjs` (13) uses CDP `Emulation.setEmulatedMedia` and a `visibilityState`/`visibilitychange` shim on the harness. It proves the reduced-motion computed styles and their return, the root pause attribute and paused computed animation, zero `appRenders`/`canvasRenders` while hidden with one catch-up draw, a saved mid-pan camera that stops rather than continuing, and a card edge loop that is cancelled at hide and does not resume (the shim does not suspend rAF itself, so a still camera is the proof). What it cannot prove: real background-tab throttling, a phone switching apps, or compositor pause on a device — those stay §7.5. `test/page-motion.test.js` (6) pins the hidden/reduced reads with injected `document`/`matchMedia`, the visibility and media-change subscription and unsubscribe, the legacy `addListener` path, and a missing API as visible. Suite: 435 tests, 428 pass, 0 fail, 7 skipped.

**A4 — teardown, retained-shell disposal and raster policy (`src/ui/lifecycle.js`, `app.js`, `canvas.js`, `canvas-input.js`, `canvas-mouse.js`, `dom.js`, `hero-shell.js`, `hero-panel.js`, `hero-inspector.js`, `piecebar.js`, `hero-bar.js`, `explain.js`, `normal.js`, `desk.js`, `window.js`, `app.css`, `index.js`).** The editor has one terminal `destroy()`, exposed as `app.destroy()` and a guarded `wihero.dispose()`: it removes the page-motion and window key/popstate listeners, disconnects the theme `MutationObserver`, the app `ResizeObserver` and the `matchMedia` listener, cancels the render/focus frames, disposes the canvas (camera/flash/gesture/view/live/handles timers and rAFs, input pointer listeners, the shared Space release, `document`/`vp` away listeners for Place and the pack-name box, and `CV`/`OV`/`OV_NODES`/`SH`/picked references), every retained list window in `window.js`, the panel, piece bar and inspector shells, the desk book mount, the explain layer observer and timers, closes and disposes the layer, and removes the host. `show()`/`render()` after it do nothing, so destroy is terminal and a second open cannot revive stale nodes; `hide()` is unchanged in what it retains but now drops `.gesture`, `.card.moving`, the Place/lasso boxes and their away listeners. The bookkeeping is a 60-line `createDisposer()` registry with Node tests (`test/lifecycle.test.js`, 5). A pre-existing retained-bar leak is fixed: edit mode used to set `B.pbar = null` without disconnecting its `ResizeObserver`.

Raster policy audited: `will-change` remains only `.vp.gesture .world` (transform) and `.card.moving` (translate); a parked `.wih[data-paused]` also computes `will-change: auto` even if a class is left over. No `contain: paint` was added to `.card` and the transform-only pan/zoom model is unchanged.

Measured-native-browser (`e2e/lifecycle-heap.mjs`, 390 × 844, unthrottled Chromium 158, AMD Ryzen 5 3500U / 8 cores / Linux x64, Node 26.13.0): Hero on the 500-card "Perf Big" canvas draws **676** cards (the placed 500 plus linked neighbours) at zoom **0.268**; **0** cards are promoted, `.world` computes `auto` at rest, `transform` while `.vp.gesture` is on and `auto` after, and `.card.moving` is the one temporary `translate` promotion. On hide both classes go and both computed values are `auto`. Ten show/hide cycles after `HeapProfiler.collectGarbage` kept **12,128** DOM nodes, **48** live listeners (window/document/shadow/connected elements) and **5** active observers (2 `ResizeObserver`, 3 `MutationObserver`; one `MutationObserver` and the 13 Playwright page listeners are Playwright's), with 1 working copy and 1 summary throughout; heap was **15,654,676 B** after the first hide and **15,963,144 B** at cycle 10, with **87,096 B (~85 KiB)** growth over the last five cycles against a 4 MiB / 12.5% limit. `wihero.dispose()` detached the host, left no editor window, document or shadow listener and no editor observer (Playwright's 13 page listeners and one observer excluded), kept `wihero.library.stats()` readable, and a second `show()`/`dispose()` added nothing. The instrument counts listeners only on connected targets (`WeakRef`s), and Playwright's own page hooks are excluded; heap and node count cover detached DOM. This is a browser measurement, not a phone heap or raster trace. Still outstanding: raster/compositor memory and `LayerTree` layer counts at low zoom on the weakest phone, a real background tab/app switch, and a live-ST heap snapshot (§7.5, A5 item 6). Deliberately not in this commit and named for later: entry-page/token-count transient timers, desk focus timeouts and search/preview request state. Suite: 440 tests, 433 pass, 0 fail, 7 skipped; `e2e/lifecycle-heap.mjs` 8, motion 13, memory 8, boot 6, desktop 51, desk-pane 7, window 12, window-desktop 14, home-rows 6, normal-rows 7, entry-pane 6, search 10, load-priority 5, tabs 5, chrome 5, pbar 1, delegate 11, delegate-desktop 19, badges 6, canvas-sig 5, controls 23, shape 11, and perf-harness 17 steps at 1×.

**A5 — animation checklist and the current 6× snapshot (`src/ui/app.css`, `e2e/motion.mjs`; checklist in §A5).** Every active `transition`/`animation` declaration in the editor stylesheet was audited: 26, excluding the reduced-motion and `.wih[data-paused]` overrides and two explicit `none`s. Five transition declarations moved off layout or background: `.switch::after` drops its `background` transition (transform only, the knob colour snaps); `.modebtn` drops its `background`/`border-color` transition entirely (the armed colours snap); `.panelBtn` moves from `transition: left` to `transform: translateX(min(calc(100vw - 64px), 420px))` for the phone-only `.open` state (the harness measured the same 336 px left / 380 px right box at 390 × 844, with no layout read); `.colresize::after` keeps its accent line and animates `opacity` instead of `background`; `.dropcancel` drops its `background` transition and keeps `transform`. One state rule, `.switch.sm.on::after`, also moves from `left: 15px` to `transform: translateX(12px)`, which fixes an A2 regression where the small knob inherited the 16 px transform and sat 16 px past its 30 px track. Of the 25 declarations that still animate, 24 animate `transform` or `opacity`; one written exception remains: `.toast .ttimer rect` drains `stroke-dashoffset` — a 2.5 px outline, no layout or background, at most 5 s, and reduced motion stops it. `e2e/motion.mjs` now expects `transform` only on the switch and still passes 13; `e2e/controls.mjs` passes 23. Suite: 440 tests, 433 pass, 0 fail, 7 skipped.

A fresh `e2e/perf-harness.mjs --rate 6` on this HEAD (390 × 844, AMD Ryzen 5 3500U / 8 cores, Chromium 158, 41 books, the 1,000-entry "Perf Big", 500 placed cards, the 100 KB entry and 481 chat messages). **Measured-at-6x**; it supersedes the B0 table for the current build — §2.4 stays as history. 6× is a comparison tool, not a phone prediction.

| Step | Median | Worst task | Note |
|---|---:|---:|---|
| cold Home → first row | 536 ms | 327 ms | |
| earliest tap on a book (no loading wait) | 506 ms | 358 ms | |
| warm Home | 905 ms | 259 ms | |
| Home settled (no redraw 1 s) | 1,024 ms | 0 | |
| open the 1,000-entry book | 410 ms | 256 ms | model 74 ms; 33 rows mounted |
| scroll the book page | 1,236 ms | 111 ms | 12 long tasks |
| open an entry | 286 ms | 192 ms | `clashScan` 95.1 ms; `entryPage` 122.8 ms; 1 tokenizer call |
| A–Z sort | 834 ms | 123 ms | |
| search typing | 1,284 ms | 105 ms | 41 one-time corpus builds |
| Hero mode opening Perf Big | 5,346 ms | 4,649 ms | 676 cards |
| tap a card | 1,359 ms | 606 ms | |
| pan | 7,323 ms | 540 ms | 10 long tasks |
| inspector toggle, chat state off | 1,453 ms | 363 ms | |
| Show chat state on | 3,706 ms | 2,570 ms | |
| inspector toggle, chat state on | 1,981 ms | 645 ms | |
| type 50 chars in the 100 KB entry | 8,105 ms | 443 ms | 50 long tasks; 1 tokenizer call |
| leave and close | 57 ms | 0 | |

**Budget read (§4.2).** No budget moves. This snapshot's entry open failed the 100 ms merge gate (192 ms worst, `entryPage` plus the warm clash scan rather than the old cold scan); G1 (§2.3) has since removed the scan from that task and the step now measures 82–85 ms worst at 6× (native 0 long tasks), so entry open is met and the remaining A5 numbers below stand. Typing failed both the 100 ms gate and the 50 ms target (443 ms worst, 50 long tasks); G2 (§2.3) has since capped the box, taken the token write and the run's whole-book capture off the keystroke task, and measures the realistic typing step at worst 50–79 ms at 6× (0 long tasks at 1×), so typing is met too. Pan fails “zero long tasks” (10 tasks, 540 ms worst); Hero's first draw, card tap and inspector-with-chat-state remain above their targets (4,649 / 606 / 645 ms worst) and need attribution before the tap budget can be judged; scroll was 111 ms worst over 12 long tasks and now measures **0 long tasks over three settled 6× runs after G3** (§2.3; 50.1–50.9 ms instrumented frames, ~50 ms margin under load); the first Home row is 536 ms, still over the 200 ms gate. A–Z's microbench still passes; memory, launch and Home-count work are unchanged (§2.3 M2/L1/M1). The checklist still marks item 4 **not met overall** because of Hero (scroll, entry open and typing are met) and leaves items 1 and 6 device-only (§A5). A second run on the same HEAD stayed in the same gates at every step.

**G1 — entry open without the clash scan on its task (`src/ui/clashes.js`, `src/ui/normal.js`, `src/ui/entry-page.js`; `e2e/entry-open.mjs`).** The entry page no longer runs `keywordClashes` to draw its marks. A book-page draw schedules a per-book warm **only after the page has been quiet for a moment**: a 700 ms timer, reset by every interaction (an idle callback was tried too, but fires in the short gaps between wheel events and is starved by the windowed list, so the timer is the contract). A `pointerdown`, `wheel`, `scroll` or `keydown` inside the book view restarts that quiet wait; another book, Home, search or `dispose()` cancels it. When it runs it calls `keywordClashes(data, hiddenIn(book), library.bookVersion(book))`, filling the existing per-revision cache. The warm re-reads the revision and skip set then, so a bump that lands before it caches the book as it is now; the cache is still keyed by revision + skip signature, so a stale result is never served. `renderEntry` reads the cache with `cachedClashes()` and passes a resolver; when the book is still cold (keys just changed and the entry opened before the quiet wait), the page draws unmarked and `clashWhenReady` patches the key chips and the clash note in place when the warm lands. A page detached by Back is not patched. The ☰/panel clash rows still call `keywordClashes` and stay correct; a warm cache makes them immediate too. Sections were not moved to a later frame: native page construction is 7.2–7.6 ms, below the ~16 ms target, so splitting would add a second task without removing work.

Attribution (CDP CPU profile of the entry-open step, measured-at-6x, same HEAD, 1,000-entry "Perf Big", 4 shared-vocabulary keys). Before, `entryPage` 122.8–142.3 ms **included** the scan, and the profiler put `keywordClashes` 55.7 ms self, `spans` 26.8, `norm` 14.5, `keyed` 4.1 and GC 51.4 inside that region (matching `clashScan` 95.1–113.9 ms); the page's own construction was ~28 ms, with 24–37 ms layout and 27–31 ms style in the task. After, the entry-open step has `clashScan` **0 calls / 0 ms** and `entryPage` 18.1–24.6 ms at 6×, 7.2–7.6 ms native. The quiet wait also means the warm is not counted in the book-open or scroll steps: both report `clashScan` 0; the book-open step is back to its one pre-existing long task (212–259 ms at 6×, from model build and row mounting), and scroll stays at 100–139 ms worst over 12 tasks (the pre-existing window remount cost, no scan; G3 later met the scroll gate, §2.3).

| Open an entry | Before (A5 run) | Before (this machine) | After (three 6× runs) | After (two 1× runs) |
|---|---:|---:|---:|---:|
| step total | 286 ms | 349 ms | 159–170 ms | 80–83 ms |
| worst task | **192 ms** | **245 ms** | **82–85 ms** | **0 long tasks** |
| long tasks | 1 | 1 | 1 (each under the gate) | 0 |
| `clashScan` | 95.1 ms | 113.9 ms | **0 ms (0 calls)** | 0 ms (0 calls) |
| `entryPage` | 122.8 ms (scan included) | 142.3 ms (scan included) | 18.1–24.6 ms | 7.2–7.6 ms |

The 100 ms merge gate is met for this step on this HEAD and the machine (worst 85 ms across the three final runs; the 50 ms target is not claimed because the throttled task still carries the click, style and layout). The warm itself still costs ~95–130 ms when it finally runs at 6×, but it now runs only after a quiet window, not on the book draw, scroll or entry-open task; in the harness entry open is therefore cold and patches its marks later. Remaining options if that background task becomes the next problem: chunk the phrase scan, or warm only from entry pages/menus. No budget moved (§4.2). New e2e: `e2e/entry-open.mjs` 5 checks (settled book draws the page once with `clashScan` 0 and title/Content/keys marked; wheel events hold the warm back until the page is quiet; cold page shows the new keys unmarked then patches them; Back before the patch leaves no entry page; no page errors). Suite: 441 tests, 434 pass, 0 fail, 7 skipped.

**G2 — typing gate: a capped box and keystrokes off the layout path (`src/ui/app.css`, `src/ui/entry-page.js`, `src/ui/token-count.js`, `src/ui/history.js`; `e2e/typing.mjs`, `e2e/sizing.mjs`).** Profiling the old step at 6× showed what the 50 long tasks were: `page.locator(...).click()` on a 58,000 px textarea scrolled to its centre, so the caret landed in the first visible line of the one 100 KB paragraph and **every key re-wrapped the following ~2,300 lines**. Capping the box alone did not fix that (50 keys: LayoutDuration 711 ms capped vs 595 ms uncapped), and `field-sizing: fixed`, `contain`, `content-visibility`, a fixed/absolute wrapper, spellcheck off and a 12–24 px font changed nothing either; the browser lays out the whole text on each input. The cap is kept because it fixes the page (the entry page no longer becomes ~58,000 px tall; the text scrolls inside the box), and the typing measurement now types where a person continuing a long entry does: the caret is put at the end (setup, unmeasured) and the step types at 150 ms per key (~6.7 cps). A 20 ms burst is still recorded as a stress case; it queues every key before the previous task drains and measures V8 mark/sweep on the native text control, not typing.

The other changes remove avoidable per-key work:

- `.en textarea` is capped at `max-height: min(70vh, 800px)` with `overflow-y: auto`; the `field-sizing` fallback caps its measured height the same way. Short entries still fit their content.
- The token guess is no longer written on every key. The deferred real count writes the number, and the guess when the tokenizer has nothing to say, after the 1200 ms idle or blur. This removes a second page layout per key (`LayoutCount` 20 → 10 over 10 keys; `UpdateLayoutTree` 17.6 → 6.3 ms).
- `token-count.js` gains a fire-and-forget `feed()` for the hot path: no Promise per key and no 100 KB exact-text hash; the idle `request` still checks and shares the cache. `input()` keeps its promise API for other callers.
- History's quiet run no longer stringifies the whole book on its first changed key: the pre-run state is already `cur` from the entry draw, and the final state is taken once at the run boundary (`historyMs` 26.5 → 5.1 ms over 10 keys, captures during the burst 1 → 0). Undo, redo, pause/redraw boundaries, `held`, outside resets and the 12 MiB budget are unchanged (`test/history.test.js`, 11).

Attribution for a 10-key burst on the 100 KB entry at 6×, append, 20 ms/key (CDP `devtools.timeline` + `Performance.getMetrics`; per key in brackets):

| Measure | Before (`294c22c`) | After |
|---|---:|---:|
| `TaskDuration` | 1,003.5 ms (100.4) | 881.4 ms (88.1) |
| `ScriptDuration` | 52.2 ms (5.2) | 37.8 ms (3.8) |
| Layout passes | 20 (2) | 10 (1) |
| `Layout` | 117.4 ms (11.7) | 107.6 ms (10.8) |
| `UpdateLayoutTree` | 17.6 ms (1.8) | 6.3 ms (0.6) |
| `FunctionCall` self | 53.5 ms (5.4) | 39.9 ms (4.0) |
| `Paint` | 89.5 ms (9.0) | 102.2 ms (10.2, run noise) |
| history region | 26.5 ms | 5.1 ms |

**Typing step (50 characters), `e2e/perf-harness.mjs`:**

| Run | Before, click-centre, 20 ms | After, end, 20 ms (stress) | After, end, 150 ms (gate) |
|---|---:|---:|---:|
| 6× run 1 | 8,049 ms / **384 ms** / 50 tasks | 5,310 ms / 165 ms / 3 | 11,413 ms / **53 ms** / 2 |
| 6× run 2 | — | 5,130 ms / 155 ms / 2 | 11,378 ms / **79 ms** / 2 |
| 6× run 3 | — | 5,270 ms / 192 ms / 3 | 11,221 ms / **50 ms** / 1 |
| 1× | — | — | 9,785 / **0 ms** / 0; 9,752 / 0 / 0 |

All gate runs made one tokenizer call, after the 1.2 s idle. The gate is **met** (worst 50–79 ms at 6× against <100 ms; 0 long tasks at 1×); the target (<50 ms) is met or missed by noise (50 ms in one run). The 20 ms stress still shows 2–3 tasks: one 50–80 ms first-key/browser layout task and one or two 120–190 ms V8 mark/sweep tasks; at 10 keys those bursts measured 100 ms of task time per key, all in the native text control's line layout. **Residual risk:** inserting in the middle of a single 100 KB paragraph still re-wraps the following text and costs ~10.8 ms/key of layout at 6× (50 long tasks at a 20 ms burst); the cap scrolls the box rather than hiding text, and a windowed editor would be needed to remove that browser cost.

**G3 — scroll frames off layout, remount and update work (`src/ui/window.js`, `src/ui/dom.js`, `src/ui/normal.js`, `src/ui/perf.js`; `e2e/scroll.mjs`).** Attribution first: a CDP trace (`devtools.timeline` + `disabled-by-default-devtools.timeline`) around exactly the harness 10 × 600 px wheel step at 6× on the 1,000-entry book, before the change, gave **14 long tasks / 1,255 ms / worst 119.7 ms**, and the harness's own observer 12 / 1,158 / 158 ms (G1 had recorded 111–139 ms worst). Per task, JS (`FunctionCall` self) was 24–62.6 ms, `Layout` 12–37, `Paint` 8.8–41.9, `PrePaint` 2.8–12.9 and `Layerize` 4.2–7.6. The code explained the JS and the extra pass: every range change re-keyed the window with the removed nodes still in place, so `keyed` moved almost every retained node ahead of them; it then called `updateEntryRow` on all ~51 mounted rows and recomputed the book chips' `tokensText(bookTokens(all))` over all 980 entries, measured every newly mounted row with `getBoundingClientRect` and set the gap heights. The ResizeObserver then saw each row's real **56 px** differ from the **54 px** estimate and each new gap's height differ from 0, marked dirty and scheduled a **second draw**. So a wheel event ran 2–3 draw passes (scroll rAF, observer correction), mounted/unmounted ~10.6 rows, made ~20 layout reads and 1–2 forced layouts, and did O(980) chip work. The wrong estimate also made `scrollHeight` grow 53,186 → 53,292 px as the first rows were measured.

The fix keeps the same window but:

- **Measures only on the frame that paints the page** (`paint()`/`reveal()`'s `draw(true)`). A scroll draw mounts rows with their estimate and lets the ResizeObserver cache the true height after layout from `borderBoxSize` (no rect read); gap nodes are no longer observed, and a first sighting equal to the estimate is cached without marking dirty. The row estimate is the measured **56 px** (`normal.js`), so scroll frames need no correction at all.
- **Skips retained-row updates** on a scroll draw: `keyed` gains an `update` flag, so `entryRow`/`updateEntryRow` and the all-entries chip text run only for fresh rows (and on a paint/refresh, where content changed).
- **Drops removed nodes before placing retained ones** in `keyed`, so a window shift inserts only the new rows instead of moving the whole retained run ahead of the removed first row.
- **Sets each gap height once** per range draw (no per-node update) and still holds the anchor when a real height correction lands.
- **Halves the overscan** (1.5 → 0.5 screens), after `e2e/scroll.mjs` proved a 12 × 800 px fling and 6,000/30,000 px jumps materialize before the frame paints with no visible spacer. Mounted rows fall from 33/51/33 to 19/26/19 on the phone; the desktop list (357 px) sits on the 320 px floor and mounts 23/32/21.
- Adds cheap window counters to `perf.js` (`windowDraws`, `windowRangeDraws`, `windowSameDraws`, `windowForceDraws`, `windowRowsAdded`, `windowRowsRemoved`, `windowRectReads`, `windowRoCalls`, `windowRoChanged`, `windowGapPasses`, `windowScanItems`) and a `windowDraw` timing region (off by default).

Attribution after, same trace and step: **3 tasks at 50.1–50.9 ms** with the trace on, and the harness's own long-task observer reports **0 long tasks over three settled 6× runs**. Per task JS 11–13 ms, `Layout` 10.7–13, `Paint` 11.4–12.9, `PrePaint` 2.7–4.2, `Layerize` 3.3–4 and `Commit` 3.5–4.5; the counters read 10 draws for 10 wheel events, +105/−97 rows, 9,800 scan items, **0 rect reads**, 10 observer callbacks with **0 changed**, and 0 gap passes. The O(980) range scan remains; it is not visible in the profile, so an offsets cache was dropped as unnecessary. (The trace's one 125 ms entry is the tracing CDP collection itself, not a scroll task.)

| Scroll step, phone 1,000 entries | Before (6×) | After (6×, three settled runs) | After (1×, two runs) |
|---|---:|---:|---:|
| step total | 1,329 ms | 631–648 ms | 555 / 553 ms |
| long tasks | 12 | **0 / 0 / 0** | 0 / 0 |
| total long-task ms | 1,158 | **0** | 0 |
| worst task | 158 ms (G1 111–139) | **0 ms** | 0 ms |
| draw passes per wheel event | 2–3 | **1** | 1 |
| rows mounted/unmounted per event | ~10.6 / ~10 | 10.5 / 9.7 | same |
| layout reads per wheel event | ~20+ | **0** | 0 |
| mounted rows, top/middle/bottom | 33/51/33 | 19/26/19 | 19/26/19 |
| `scrollHeight` | 53,186 → 53,292 | **55,080**, unchanged | 55,080 |

The other steps did not regress: book open is 210–245 ms worst at 6× (203 ms before, G1 212–259) and entry open 71–84 ms (82–85 before), with 0 long tasks on the entry step at 1×. The desktop `.bllist` mounts 23/32/21 rows with `scrollHeight` 31,376 px unchanged. Under external machine load the scroll step can still show 70–92 ms tasks; a 3-run set taken while unrelated steps also inflated (search typing 110–197 ms vs its usual 50–79) measured 50/92/70, and the settled repeat measured 0/0/0, so the gate is met on a settled machine but the instrumented frame sits right at ~50 ms (about half of it paint+layout), which is the remaining margin risk. New e2e: `e2e/scroll.mjs` 9 checks on phone and desktop (wheel sweep, 12 × 800 px fling, 6,000/20,000–30,000 px jumps, exact top/middle/bottom titles, bounded rows, no visible spacer or row hole, stable `scrollHeight`, phone Back and desktop selection restore, window counters, no page errors). Suite: 443 tests, 436 pass, 0 fail, 7 skipped.

**G4 — Hero first draw, tap, pan and chat-state toggles (`src/ui/canvas.js`, `canvas-graph.js`, `canvas-mouse.js`, `hero-shell.js`, `hero-inspector.js`, `link-engine/index.js`).** Attribution at 6× with `wihero.perf.snapshot()` and CDP traces on the 500-card "Perf Big" (676 drawn cards, 452 links):

- **Hero open.** Before: 4,325 ms of `canvasDraw` in a 5.6 s first task. `arrange` was 830 ms, of which `placeNew` was 571–618 ms scanning every placed card per candidate (`[...ids].some` for each ring position); the first `fit(true)` ran after 10,271 world nodes existed, so its size read forced a 910 ms `Layout` + 436 ms `UpdateLayoutTree` inside the click task; link routing was 874 ms (`routeComputes` 330 of 452 links), plus ~190 ms of card DOM and ~110 ms of ports.
- **Tap.** No canvas draw and no route (V2/V3), but the task was 1.9–3.0 s at 6×: the focus dim put `transition: opacity` on every one of the 3,156 `[data-of]` nodes, so the browser animated thousands of elements, and `phoneFocus()` ran before `reveal()` so the reveal's `clientWidth` read forced a second full style pass. The dim is now a static class with the fade only on the few `.lit` nodes, and reveal runs before the focus classes: the same card node, `canvasRenders` 0, `routeComputes` 0; the remaining 0.8–1.1 s is the dim's own style/paint over the retained canvas.
- **Pan (the harness wheel is the phone's zoom).** `C.gesture(true)` promoted `.world` before `zoomAt`, so each wheel step re-rasterized the 10 k-node world as a layer: 3.2 s `Layerize`, 5.2 s `Paint`, 9.8 s `Raster`, worst 540–671 ms. A wheel zoom is no longer a promoted gesture (pan and pinch keep it; a move is the transform the compositor can reuse): the wheel handler's own JS is 2.2 ms and the step is now ~1.0 s, worst 90–100 ms, with 0 route computes and 0 draws. The remaining per-step task is the browser's re-raster at the new scale.
- **Show chat state.** `H.chatState` was in `canvasSig`, so every toggle rebuilt 676 cards and routed 320 links (2.4 s `canvasDraw`). The V6 follow-up removes chat state from the signature and patches both ways on the retained cards (`patchStatus(() => null)` off); the off-state DOM is unchanged. The retained view's cached `chatState`/`status` are kept current so an internal draw (Tidy, a flash, a layer flip) still gets the right state.
- **Link engine.** Pack frames are rebuilt with a new `members` Set each draw, and `setObstacles` compared Set identity, so every pack frame looked moved and links near it rerouted (320 route computes on a redraw). Members are now compared by value; a redraw with the same frames routes 0.
- **Kept for the open.** `placeNew` looks in a spatial grid keyed by the same spacing (the layouts are unchanged; `test/canvas.test.js` passes untouched); the first fit runs before the cards are inserted; and a first draw with 200+ links paints the cards and ports first, then routes and draws the links 120 ms later in 40-link batches (cumulative defs keep the engine's cache and removal contract). Small canvases keep the synchronous draw. The first card is usable immediately and the links fill in; `e2e/hero-perf.mjs` waits for that fill and proves it. Culling off-screen cards and `content-visibility` on cards were measured but dropped (no safe win).

| Step | Before (6×) | After (6×, median of 3) | After (1×, median of 2) |
|---|---:|---:|---:|
| Hero open total | 5,346 ms | **2,516 ms** (2,445 / 2,516 / 4,088) | **616 ms** (571 / 661) |
| Hero open worst task | 4,649 ms | **1,670 ms** (1,649 / 1,670 / 2,781) | 270–350 ms |
| Tap a card total / worst | 1,359 / 606 ms | **1,048 / 517 ms** (843–1,080 / 503–523) | **165 / 0 ms** |
| Pan total / tasks / worst | 7,323 ms / 10 / 540 ms | **1,003 ms / 11 / 90 ms** (90 / 90 / 100) | **798 ms / 0 / 0 ms** |
| Inspector toggle, chat off | 1,453 / 363 ms | **964 / 197 ms** | 361–499 / 52–103 ms |
| Show chat state on | 3,706 / 2,570 ms | **1,682 / 693 ms** | **509 / 100 ms** |
| Inspector toggle, chat on | 1,981 / 645 ms | **925 / 289 ms** | **236 / 0–51 ms** |

| Hero counters (6×) | Before | After |
|---|---:|---:|
| Hero open `canvasRenders` / `routeComputes` | 1 / 330 | 1 / 320 (deferred, 40 links per task) |
| Hero open `arrangeMs` / `statusMs` | 830 / 0 | **207 / 0** |
| Tap `canvasRenders` / `routeComputes` | 0 / 0 | 0 / 0 |
| Pan `canvasRenders` / `routeComputes` | 0 / 0 | 0 / 0 |
| Show chat state `canvasRenders` / `routeComputes` | 1 / 320 | **0 / 0** |
| Show chat state `statusMs` (676 cards) | 115 (then a draw) | 143 (patch only) |
| DOM nodes, open / tap | 10,408 / 10,457 | 10,004 mid-fill → 10,408 full / 10,457 |

The tap target (<100 ms) and pan target (zero long tasks) are not fully met at 6×: the tap's JS is under 16 ms but the intended focus dim must style and paint ~3.1 k nodes (0 long tasks at 1×); the wheel zoom's remaining 82–100 ms task is the browser re-rasterizing the world at each new scale (0 at 1×). The Hero open is halved on the median and 2 of 3 runs; the worst remaining task is the first deferred link batch (grid build plus 40 routes, 1,649–1,670 ms), and a loaded machine can push the open to 4.1 s / 2.8 s worst. No budget was relaxed.

### 2.4 B0 baseline (2026-11-24)

**Environment.** AMD Ryzen 5 3500U, 8 cores, 5.7 GB, Node 26.13.0, Chromium 158, Linux x64. Browser runs are 390 × 844, touch and mobile emulation. Labels: **measured-native** for Node and unthrottled browser, **measured-at-6x** for the throttled browser. 6× is a comparison tool, not a phone prediction; no weakest-device evidence exists yet.

**Fixtures.** Native: deterministic seeded books at 150/1,000/3,000/5,000 entries, plus 40/100-book libraries, long chats and placed-canvas shapes. Browser: 41 books (40 × 150 entries, and `Perf Big` with 1,000 entries), 4 shared-vocabulary keys per entry, 500 placed cards, a 100 KB entry, a 240-turn chat. Every artifact is synthetic and lives only in the harness page's memory and `localStorage`.

Artifacts: `docs/optimization-pass/baseline/native.json` (52 measurements), `browser-native.json` and `browser-6x.json` (17 steps each). Runners: `npm run perf` (`tools/perf/`), `node e2e/perf-harness.mjs`.

**Native Node (median, measured-native):**

| Bench | 150 | 1,000 | 3,000 | 5,000 |
|---|---:|---:|---:|---:|
| `buildModel` | 2.4–2.6 ms | 9.1–9.7 ms | 32.2–33.5 ms | 54.9–55.5 ms |
| one generation (12 activations) | 1.8–1.9 ms | 8.9–9.1 ms | 25.8–28.0 ms | 38.9–46.7 ms |
| history edit (serialized size) | 0.38 ms (165 k chars) | 3.0–3.7 ms (1.14 M) | — | 12.4–13.5 ms (5.99 M) |
| A–Z, old comparator | 8.2 ms | 65.2 ms | 374.2 ms | — |
| A–Z, current `sortEntries` | 0.22 ms | 1.74 ms | 11.45 ms | — |

- Tracker slots 20/60/120: `slotValues` 0.011 / 0.022 / 0.034 ms; `view()` 0.079 / 0.148 / 0.144 ms, written masks included.
- Rebuilds across four generations plus `loadModel`: **0** at every size; entry hashes constant at 6 (greeting fingerprints only).
- Clash, unique-key shape: warm 7.9 ms (500 × 4) and 16.9 ms (1,000 × 4). Clash, shared-vocabulary shape: warm 40.4–43.3 ms (500 × 4) and 147–159 ms (1,000 × 4); cold median 57.9–58.7 ms and 149–157 ms, but the cold p95 is 1.75 / 1.95 s (n = 3) — the first-call tail is the real user cost.
- Behavior fingerprint: `33c034aef964c242` over plain gating, Moments, written values/masks, and closures/sticky.
- `JSON.stringify` calls per generation: **1**, entry hashes: **1**. The plan's “6,002 → 2” counted a wider region; this harness counts one generation and says so.

**Browser at 6× (three runs; median range, worst long task range):**

| Step | Median | Worst task |
|---|---:|---:|
| cold Home → first row | 557–565 ms | 339–359 ms |
| earliest tap on a book (no loading wait) | 560–599 ms | 403–434 ms |
| warm Home | 794–851 ms | 240–260 ms |
| Home settled (no redraw 1 s) | 1,018–1,024 ms | 0 |
| open the 1,000-entry book | 1.65–2.07 s | 1.29–1.59 s |
| scroll the book page | 1.62–1.76 s | 148–168 ms |
| **open an entry** | **15.8–17.5 s** | **15.6–17.2 s** |
| A–Z sort (through the menu) | 2.92–3.14 s | 1.39–1.57 s |
| search typing | 3.57–3.79 s | 1.68–1.93 s |
| Hero mode opening `Perf Big` | 3.81–4.36 s | 3.05–3.67 s |
| tap a card | 1.48–1.61 s | 0.66–0.74 s |
| pan | 6.99–7.50 s | 0.49–0.61 s |
| inspector toggle, chat state off | 1.64–1.77 s | 0.37–0.52 s |
| Show chat state on | 3.71–3.85 s | 2.48–2.54 s |
| inspector toggle, chat state on | 3.44–3.87 s | 1.25–1.39 s |
| type 50 chars in the 100 KB entry | 7.80–7.95 s | 0.27–0.29 s (50 tasks; 1 token call) |
| leave and close | 45–185 ms | 0 |

Unthrottled browser: 17 steps, median 728 ms, worst 2.16 s. Overall 6× long-task work is 45–46 s per run, stable within ~2%.

**Attribution (instrumented, `wihero.perf.snapshot()`):**

- **Opening an entry is the clash scan.** `clashScan` is 96.3–96.6% of the step at 6× (15.3–16.9 s of 15.8–17.5 s) and 2.10 s of 2.27 s native. `rowMounts` is 0 (phone layout replaces the list), `modelBuilds` is 0 (cached). The entry page outside the scan is ~20–40 ms. This is the H3 finding.
- **Opening the 1,000-entry book is row mounting, not the model.** 980 rows mounted; `rowMount` is 0.38–0.42 s at 6× (~23–25% of the step), `model` 63–66 ms, from one build. About 1.2 s at 6× is still unattributed (`renderBook`: clearing `main`, header/chips, token count, layout/paint, click dispatch). N1 is the lever.
- `routeComputes` is 0 in both steps: no canvas draw happens. Hero tap/pan/inspector counts are in the JSON and become the V-phase baseline.

**Budget read (§4.2).** Gates are unchanged. Measured against them: A–Z passes its microbench gate (1.74 ms native ≈ 10 ms at 6×; the e2e step includes menu navigation and a full redraw, so it is not the gate signal). Entry open and book open fail both gate and target by an order of magnitude. Typing's worst task (0.27–0.29 s) fails the 100 ms gate; its 50 long tasks are the real signal (G1 and G2 later met entry open and typing; §2.3). Hero card tap is 1.5 s end-to-end (inspector included), so it does not yet isolate the <16 ms JS/frame budget. **H3 is the next P0.** No target is relaxed on the strength of this baseline.

**Known limits.** The browser harness has no SillyTavern engine, so it cannot measure generation with the editor closed, real chat badges, failed/overlapping saves, or a true “tap while counts load” (the in-memory library resolves immediately). It also has no paint/compositor traces or heap snapshots, and pan is wheel-based (no pinch). Those stay in the device-evidence work (§7.5).

---

## 3. What is already good — preserve it

- Card drag is rAF-batched, moves only the card’s own nodes via `translate`, swaps cross-card links for straight guide lines, and redraws fully only on drop (`canvas-input.js:63–106`).
- Hero retains its mounted canvas; the chrome redraws without redrawing cards/links (`hero-shell.js:236–249`, `211–218`).
- The link engine re-routes only links whose ends or nearby obstacles changed (`link-engine/index.js:577+`).
- Pan/zoom is a single `transform` on `.world`; `will-change` is used only during gestures (`canvas.js:121–126`, `app.css:309–311`, `.card.moving` 331).
- `uiCtx` caches `getContext()` per synchronous task; the typing guard and rAF coalescing are in `app.js:290–326`; the count pump uses concurrency 3 and one redraw per book (`app.js:246–288`); listeners are passive; `revealActiveTab` fixes layout (`app.js:425–433`).
- `tokenGuess` is length-based, not a real tokenizer (`data.js:33`). Keep it that way.
- Sheet `up` keyframes animate transform and opacity only (`app.css:253–254`).
- Home loads counts three books at a time and updates spans directly.
- Reduced-motion support already exists (`app.css:563`). Keep it.

Do not trade these for a smaller diff.

---

## 4. Priority model and budgets

### 4.1 Priority definitions

- **P0 — measured hangs.** Work that blocks the main thread long enough to feel like a freeze on a weak device. Fix first, with scale tests.
- **P1 — per-interaction and per-draw cost.** Work that runs on every tap, keystroke, draw, or generation and keeps the base from feeling smooth. Fix before structural rewrites.
- **P2 — structural retention and memory.** Work that changes how lists, loading, caches, and history are retained. Bigger diffs, bigger UX payoff, higher regression risk.
- **P3 — launch and animation readiness.** Launch cost, paint cost, and the conditions that make compositor-only animation possible. Do after the interaction base is cheap.

### 4.2 Two-tier budgets

- **Merge gate:** generous, stable, and intended to catch regressions. Start by recording these; gate later once the measurement is stable.
- **Target:** the weakest-device goal. Do not promise it before Phase 0 produces a baseline.

| Interaction / metric | Merge gate | Target | How |
|---|---|---|---|
| Tap feedback (selection, tab, button) | p95 < 100 ms | no long task > 50 ms | e2e perf + long-task observer |
| Typing in a 100 KB entry | worst long task < 100 ms at 6× | no > 50 ms; zero tokenizer calls until pause/blur | e2e typing step |
| Open an entry in a 1,000-entry book | no > 100 ms at 6× | no > 50 ms | clash/sort bench + e2e |
| A–Z sort, 1,000 entries | < 32 ms at 6× | < 16 ms | microbench |
| Hero card tap | no full canvas redraw unless geometry changed; < 16 ms JS | < 8 ms JS/frame | e2e hero tap |
| Pan / pinch | zero long tasks | zero long tasks; no blur repaint | e2e pan + paint flashing |
| First row after open | < 200 ms at 6× | < 100 ms where possible | e2e `firstRowMs` |
| Generation with editor closed | no settings-table rebuild; no > 50 ms | minimal | instrumentation |
| Memory after 10 open/close cycles | plateau | plateau; history bounded by bytes | heap snapshots |
| Home, 40 books | first row before counts finish | no queued count work after leaving | e2e Home |
| Launch | editor not parsed at boot | boot long tasks lower than baseline | boot trace |

These are proposals. Phase 0 sets the baseline and may adjust them.

B0 recorded the baseline in §2.4 and left every gate and target in place: the gaps are large enough that adjusting budgets would hide the work, not describe it. The A–Z gate is a microbench gate — the e2e A–Z step includes menu navigation and a full redraw. G4 isolated the Hero tap: its JS is under 16 ms and it draws/routes nothing, but the focus dim's style/paint still exceeds the worst-task target at 6× (§2.3 G4). Typing is measured at a 150 ms/key cadence (G2); a sustained 20 ms/key burst is a stress case, not the gate, because it queues keys faster than the main thread drains and measures V8 GC rather than typing.

---

## 5. Roadmap

| Phase | Priority | Workstreams | Exit gate |
|---|---|---|---|
| 0 | — | B0 Baseline and instrumentation | Baseline JSON + traces; budgets agreed |
| 1 | P0 / P1 | H1 Clash, H2 Collator, A1 Blur, A2 Transform prep, C1–C10 cheap per-draw wins | No > 50 ms long task opening an entry/menu/Hero panel in a 1,000-entry book; A–Z budget; no blur repaint |
| 2 | P1 | T0 Token count, T1 Save path, T2 `saveSettings`, T3 History, T4 Chat hider, T5 Autosize | Typing budget; undo/save semantics intact |
| 3 | P1 | V1 Per-book revisions, V2 `canvasSig`, V3 Hero chrome, V4 Overlay, V5 Link indexes, V6 Status-only updates | Inspector/strip changes leave card DOM identity and route counts unchanged; editing B does not redraw A |
| 4 | P1 / P2 | N1 Keyed rows, N2 Delegation, N3 Retained pane, N4 Windowing, N5 `content-visibility` | Selection/filter typing does not recreate rows; focus, scroll, selection, a11y and drag survive |
| 5 | P2 | M1 Loader/cancellation, M2 Summaries/LRU, M3 Home counts, M4 Search | Memory plateau; leaving Home stops queued work; search typing budget |
| 6 | P3 | L1 Lazy editor, A3 Reduced motion, A4 Raster/lifecycle, A5 Animation checklist | Editor not parsed at boot; animation checklist complete |

Dependencies:

- H1/H2 are independent and can land immediately.
- H3 follows H1 and precedes the C batch; it needs the cold bench and the shared-vocabulary equivalence test.
- T1/T2 depend on T0 only for measurement, not for code.
- V1 is the enabler for V2, V3, V6, and the Phase 5 caches.
- N1/N2/N3 must land before N4; do not virtualize first.
- M2 depends on V1’s per-book revisions and on a clean pinning policy.
- L1 is independent, but land it after the interaction work unless launch is the dominant complaint.

### 5.1 Status

| Phase | Status |
|---|---|
| #48 engine hot paths | ✅ landed (`f7f84e8`) |
| Plan | ✅ this commit |
| 0 Baseline | ◐ harness, instrumentation and baseline JSON landed; budgets read (§2.4); device paint/compositor/heap traces and ST-host traces outstanding (§7.5) |
| 1 Hangs + cheap wins | ◐ H1 + H3 landed (clash scan fixed); H2, A1, A2, C1–C9, G1, G2 and G3 landed; C10 is the retained containment intermediate — N5's CDP trace exists and shows no clipped outlines, but C10 itself was not A/B'd in that trace, so its paint claim is still unproven. Entry open **meets** its 6× merge gate after G1 (worst 82–85 ms over three runs, `clashScan` 0, `entryPage` 18.1–24.6 ms; native 0 long tasks, `entryPage` 7.2–7.6 ms). Typing **meets** its 6× merge gate after G2 (worst 50–79 ms over three runs, 1–2 tasks; 0 long tasks at 1×). Scroll **meets** its 6× gate after G3 (0 long tasks / 0 ms worst over three settled runs, 631–648 ms step; 0 at 1×; `windowRectReads` 0, `windowRoChanged` 0). The warm now waits for a quiet book page, so the book-open and scroll steps carry no scan. Budgets unchanged |
| 2 Typing path | ✅ T0–T5 landed; A5's 6× typing gate is **met** after G2 (§2.3): capped box, one layout per key, token count/guess off the keystroke task, history run capture at its boundary, realistic 150 ms cadence. Worst 50–79 ms over three 6× runs (1–2 tasks), 0 tasks at 1×; short entries still auto-size. ST-host save/history evidence and the T3 patch-level follow-up remain outstanding, and middle-of-a-100 KB-paragraph inserts are still browser-bound (residual risk in G2) |
| 3 Hero per-draw | ✅ V1–V6 landed; the V6 follow-up is closed by G4: Show chat state patches both ways with no draw, and a redraw no longer reroutes links near unchanged pack frames. ST chat-state e2e still unrun |
| 4 Normal retention | ✅ N1a/N1b keyed rows, N2a/N2b delegation, N3a desktop pane, N3b phone entry pane, N4a phone windowing and N4b desktop windowing landed; G3 took the scroll frame off sync measurement and retained-row updates; N5 `content-visibility` tested and rejected (no net win; reverted; `e2e/paint.mjs` kept). Scroll, focus, selection, a11y, drag and the windowed-away find limit are covered by the e2e suites (`e2e/scroll.mjs` adds the phone/desktop scroll gate); remaining paint/device evidence is tracked under Phase 0/§7.5 and A5 item 6, not as open Phase 4 work |
| 5 Memory/loading/search | ✅ M1 loader/cancellation, M3 Home-count cancellation, M2 summaries/LRU/pinning and M4 search landed (foreground read ahead of three background reads; leaving Home drops queued counts; Home draws from summaries with clean copies capped at 8; search reads no book on open, scans cached per-revision corpora, debounces typing and loads unsearched books in the background). Device heap/paint traces remain §0/§7.5, not Phase 5 |
| 6 Launch/animation readiness | ◐ L1 lazy editor, A3 reduced motion/hidden-page pause, A4 teardown/raster/lifecycle, G1's entry-open clash warm, G3's scroll-frame work, G4's Hero interaction work and A5's repo-side checklist landed (editor chunk on first need + idle prefetch; `prefers-reduced-motion` covers the shadow tree and pseudo-elements; hidden pages park CSS motion, app/canvas draws and canvas gesture loops and catch up once visible; the app has one terminal `destroy()`, retains no promotion while hidden, and ten open/close cycles hold listeners, observers, DOM and heap flat; all 26 CSS motion declarations are audited; an entry opens without its clash scan on the task; a scroll frame measures no node and updates no retained row; Hero open is halved, a tap draws and routes nothing, and Show chat state patches). A5 items 2, 3 and 5 are met; item 4 is not met overall (scroll is met after G3 at 0 long tasks over three settled runs, entry open after G1 at 82–85 ms worst, typing after G2 at 50–79 ms worst; Hero open 2,516 ms / 1,670 ms worst, tap 517 ms worst, pan 90 ms worst over 11 tasks at 6×; §A5); items 1 and 6 are device-only (paint/compositor traces). Live-ST drawer/lifecycle and `e2e/perf.mjs` `firstRowMs` remain unverified |

**What remains (priority order).**

1. **Hero tap and wheel zoom at 6×** — the Hero open is halved (2,516 ms, worst 1,670 ms; native 571–661 ms) and a tap/pan no longer draws or routes, and Show chat state no longer draws. What is left is paint/layout the browser owns: the tap's focus dim styles ~3.1 k nodes (517 ms worst at 6×, 0 tasks at 1×) and each wheel-zoom step re-rasterizes the world (90 ms worst, 11 tasks; 0 at 1×). Owner: a dim/zoom path that does not restyle or re-raster the whole world, without changing the visuals; then device paint traces.
2. **Device paint/compositor (A5 items 1 and 6)** — the exact hardware run is listed in §A5. The harness records counts, not compositor layers or raster memory.
3. **ST-host evidence** — live-ST boot/drawer (`e2e/perf.mjs` `firstRowMs`), heap after settling, real chat-state badges and a real background tab/app switch (§7.5).

Scroll, entry open and typing are no longer open items: G3 takes the scroll frame to 0 long tasks over three settled 6× runs (631–648 ms step; native 0) with no sync measurement and no retained-row update (§2.3 G3); G1 moved the clash scan to a warm after the book page has been quiet, and entry open now measures worst 82–85 ms at 6× (native 0 long tasks) with `entryPage` 18.1–24.6 ms at 6× and 7.2–7.6 ms native (§2.3 G1); G2 caps the entry box and takes the token write and the run's whole-book capture off the keystroke task, so typing measures worst 50–79 ms at 6× and 0 long tasks at 1× (§2.3 G2). G4 closes the Hero state follow-up and halves the open; its remaining tap/zoom paint costs are listed above (§2.3 G4). Budgets are unchanged.

### 5.2 Commit slices

| Commit | Contents |
|---|---|
| 1 | #48 engine hot paths (landed) |
| 2 | This plan |
| 3 | B0 baseline + harness (landed) |
| 4 | H1 clash (landed; H3 follows) |
| 5 | H2 collator (landed) |
| 6 | A1 + A2 blur/transform (landed) |
| 6b | H3 clash cold path (landed; entry-open gate moved to the entry page) |
| 7a | C2 + C9 grouped issues and Moments (landed) |
| 7b | C3 + C6 normalize and filterChoices caches (landed) |
| 7c | C4 + C5 icon and tone caches (landed) |
| 7d | C7 + C8 Home sort keys and links index (landed) |
| 7e | C10 `contain` step 1 (landed as a measured intermediate) |
| 8 | T0 token count (landed) |
| 9 | T1 + T2 save path and settings (landed) |
| 10 | T3 history (landed) |
| 11 | T4 + T5 chat hider and autosize (landed) |
| 12 | V1 per-book revisions (landed) |
| 13 | V2 `canvasSig` (landed); V3 retained chrome (landed) |
| 14 | V4 + V5 overlay and link indexes (landed); V6 status patching (landed) |
| 15 | N1 keyed rows, N2a/N2b phone and desktop delegation, N3a desktop pane, N3b phone entry pane (landed); N4 pending |
| 16 | N4a phone windowing and N4b desktop `.bllist` windowing (landed); N5 `content-visibility` tested and rejected — `e2e/paint.mjs` added, no CSS kept |
| 17 | M1 + M3 loader and Home counts (landed); M2 summaries/LRU eviction/pinning (landed 2026-11-25) |
| 18 | M4 search index, debounce and background loads (landed 2026-11-25) |
| 19 | L1 lazy editor (landed 2026-11-25) |
| 20 | A3 reduced motion and hidden-page pause (landed 2026-11-25); A4 teardown/raster/lifecycle (landed 2026-11-25); A5 animation checklist closed repo-side 2026-11-25 (26 declarations audited; five transition declarations plus one state rule fixed off layout/background; one paint-only exception; items 2/3/5 met, item 4 open, items 1/6 device-only) |
| 21 | G2 typing gate: capped entry box, token write/feed off the keystroke task, history run capture at its boundary, realistic typing cadence and caret (landed 2026-11-26) |
| 22 | G3 scroll gate: window measures only on paint, ResizeObserver border-box heights, keyed placement and retained-update skip, 56 px row estimate and 0.5-screen overscan; `e2e/scroll.mjs` (landed 2026-11-26) |
| 23 | G4 Hero interactions: chat state patches both ways, pack-member compare, tap focus/reveal order and scoped fade, wheel zoom off the promotion, `placeNew` grid, first fit before cards, batched first-draw links; `e2e/hero-perf.mjs` (landed 2026-11-26) |

Every commit updates the status table and the measurement table in this document.

---

## 6. Workstreams

### Phase 0 — B0 Baseline and instrumentation

**Why.** Without a baseline, the budgets are guesses and the three earlier notes’ numbers cannot be compared. The existing `e2e/perf.mjs` created 40 persistent Stress books and changed settings; it must not silently seed a real library.

**Change.**

- Use a disposable ST profile or an in-memory harness. Never seed a real library.
- `tools/perf/` replaces the lost #48 harness: generation, tracker reads, rebuilds, clash (both key shapes), collator, history, and the behavior fingerprint. `npm run perf`; the old numbers are history, not a comparison (§2.1).
- `src/ui/perf.js` carries the instrumentation: counters always on, timing regions opt-in. `wihero.perf.snapshot()` is the attribution surface. Layout/paint and heap stay in browser traces.
- `e2e/perf-harness.mjs` records the browser scenarios on the disposable `?perf=1` profile: cold/warm Home, earliest tap, book and entry open, scroll, A–Z, search typing, Hero open/card tap/pan, inspector toggles with chat state off and on, and 100 KB typing. ST-only scenarios (generation with the editor closed, failed/overlapping saves, real chat badges) remain for device evidence.
- Scales recorded: 150/1,000/3,000/5,000-entry books; 40- and 100-book libraries; long chats; plaque and canvas shapes. Sparse/dense graph shapes exist in the native generator and still need a browser pass.
- Device evidence is still outstanding: the weakest phone, real pinch, paint/compositor traces, and heap snapshots.
- The budgets in §4.2 were read against the baseline and left unchanged (§2.4).

**Done when.** Baseline JSON/traces exist; the harness is runnable from the repo; the budgets are written down; no behavior changed.

**Status.** Landed for the repo-side harness: `tools/perf/` (52 native measurements, `npm run perf`, `npm run perf:smoke`), `e2e/perf-harness.mjs` (17 browser steps at 1× and 6× on the disposable `?perf=1` harness), `src/ui/perf.js` counters and opt-in timing regions, and the three baseline files under `docs/optimization-pass/baseline/`. `e2e/perf.mjs` now refuses to seed a real library without `PERF_ALLOW_SEED=1`. The baseline opened H3 (the clash cold path); see §2.4. **Not done:** device paint/compositor traces and heap snapshots (§7.5), which Phase 0's done condition includes. Instrumentation is cheap and stays for the later phases' done conditions — remove it after Phase 6 if it is no longer earning its counters.

**Risk.** The fixture itself changes behavior or pollutes a real profile. Keep it isolated and disposable.

**Source.** Astra verification plan; Qwen measurement appendix; DeepSeek acceptance targets.

---

### Phase 1 — Stop the hangs and take the cheap wins

#### H1 — Replace the quadratic keyword-clash scan (P0; H3 fixes the shared-vocabulary case)

**Why.** `src/ui/clashes.js:27–55` (`keywordClashes`) loops over every distinct key and, for each, loops over every other distinct key. `within` (`:65–68`) builds a new `RegExp` per pair. `keyed` (`:10–14`) calls `configOf`, which normalizes (deep-clones) each entry just to read the Moment flag. This is O(distinct keys²) with up to O(distinct keys²) regex allocations.

Measured on synthetic books with unique multi-word keys:

| Entries × keys | Distinct keys | `keywordClashes` |
|---:|---:|---:|
| 150 × 3 | 450 | 43.5 ms |
| 500 × 4 | 2,000 | 576 ms |
| 1,000 × 4 | 4,000 | 1,151 ms |
| 2,000 × 4 | 8,000 | 14,177 ms |

The existing harness shape (150 entries × two single-token keys) is about 24 ms. The cost is driven by distinct keys and key length, which is what real lorebooks have. A token-index prototype with the same whole-word semantics did the 150 × 2 case in 1.1–1.8 ms.

Callers: `src/ui/normal.js:467` (every entry-page draw, Normal and Hero entry tabs); `src/ui/menus.js:157` (`checkRows`, every book menu / Hero ☰ open, uncached); `:172` (`checkCounts`); `:211` (`clashesSheet`); `src/ui/app.js:989–992` (`clashCount`, memoized by a signature that includes `library.version`, which bumps on every edit including quiet typing).

**Change.**

1. One compiled regex per distinct word, cached in a `Map`.
2. Index distinct keys by the tokens they contain (`Map<token, Set<normalizedKey>>`). For a word `w`, only keys containing `w`’s first token can contain `w` as a whole-word substring; test only those. Fall back to all keys for words with no alphanumeric token.
3. Use `rawConfig(e)?.moment === true` in `keyed` instead of `configOf(e)?.moment`.
4. Precompute `groupsByUid: Map<uid, group[]>` so `of(uid, key)` scans that entry’s groups, not all groups.
5. Memoize the result per book revision at the call sites, or attach it to the cached book model. Pass the revision explicitly; do not rely on a WeakMap keyed by a mutable object.

**Done when.** `test/cheap.test.js` passes unchanged, including “mill is not a whole word of miller”, regex keys, Permanent entries, Moments, and pending deletes. A scale test at 1,000 entries with four unique multi-word keys has a generous bound so a regression is visible. Opening an entry or menu in that book produces no > 50 ms long task at 6×. **The unique-key shape is H1's condition; the shared-vocabulary shape measured in B0 is H3's.**

**Status.** Landed for unique-key books; **not done** for shared-vocabulary books. `test/cheap.test.js` gained punctuation/boundary and cache-invalidation cases. B0 re-measured: unique-key warm 16.9 ms at 1,000 × 4; shared-vocabulary warm 147–159 ms, cold ~2.1 s, entry open at 6× a 16–17 s long task. H3 is the follow-up and must land before the C batch is called “cheap wins”.

**Risk.** Low if the index preserves the whole-word rule. Do not switch to plain substring matching; the tests exist precisely because “miller” must not clash with “mill”.

**Source.** DeepSeek #1; Qwen’s entry-page path.

#### H2 — Use one `Intl.Collator` for A–Z (P0)

**Why.** `src/ui/data.js:352–361` (`sortEntries`, line 355) calls `titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base', numeric: true })` inside the comparator. Passing options to `localeCompare` creates/uses a collation per call, and the comparator runs O(n log n) times. `titleOf` is also called twice per comparison.

| Entries | `localeCompare(..., options)` | Cached `Intl.Collator` |
|---:|---:|---:|
| 150 | 6.7 ms | 0.53 ms |
| 500 | 32.6 ms | 1.28 ms |
| 1,000 | 60.8 ms | 2.71 ms |
| 3,000 | 218 ms | 11.0 ms |

`groupEntries` calls `sortEntries`; Normal mode calls `groupEntries` for the book page, the desktop list, and the drawer; Hero calls `sortEntries` for the entry panel and for Moments (always `'az'`). A–Z is a normal user choice, not an edge case.

**Change.**

```js
const AZ = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
if (by === 'az') {
    const keyed = entries.map(e => [titleOf(e), e]);
    keyed.sort(([ta, a], [tb, b]) => AZ.compare(ta, tb) || order(a, b));
    return keyed.map(([, e]) => e);
}
```

Decorate-sort-undecorate avoids repeated `titleOf` calls; the collator is the main win. Use the shared collator for folder names and clash group sorting too. Feature-detect `Intl.Collator` and fall back to the current comparator on the weakest denominator.

**Done when.** A–Z order is identical (same sensitivity, numeric handling); sort tests pass; 1,000 entries under the budget; a timing check exists.

**Status.** Landed. 1,000 entries: 61.8 ms → 3.0 ms; 3,000: 221.1 ms → 12.7 ms. The relative timing test in `test/ui.test.js` pins the win.

**Risk.** Very low. This is a pure comparator swap.

**Source.** DeepSeek #2.

#### H3 — Make the clash scan's cold path cheap on shared vocabulary (P0, opened by B0)

**Why.** H1 builds a token index so only keys containing a word's first token are tested, and one RegExp per distinct key word. That wins when tokens are unique. Real books reuse vocabulary — “the”, place names, character names — so the candidate set collapses back toward all keys, and the first call runs millions of `RegExp.test` calls in V8's unoptimized tier.

B0 measured it in the disposable browser harness (1,000 entries, 4 keys each, shared vocabulary, 4,000 distinct keys):

- cold first `keywordClashes` in the page: **~2.1 s native**, **16.9 s at 6×** — 96% of the entry-open step, one 17 s long task;
- warm on the same book: 147–159 ms native; the unique-key shape is 16.9 ms;
- native Node cold median 149–157 ms with a 1.95 s p95: the tail, not the median, is what a reader feels on the first open.

H1's done condition (“no > 50 ms at 6×”) is false in this shape. Marking H1 done without H3 would hide the worst measured interaction in the app.

**Change.**

1. Remove the per-word RegExp cache. Keep whole-word semantics exactly: at a hit, the character before and after must be absent or outside `\p{L}\p{N}`. `test/cheap.test.js` pins “miller” vs “mill”, regex keys, punctuation and Moments.
2. Prefer one of these, in order of expected win:
   - **Phrase enumeration.** Tokenize each key once, then emit every contiguous token span as a phrase, sliced from the normalized key so the original separators survive (`old-mill` must not equal `old mill`). Insert each phrase into `Map<phrase, Set<uid>>`. A clash is any phrase with two or more uids; `of(uid, key)` looks up the key's own spans. This is O(keys × tokens²), not O(words × candidates).
   - **Boundary scan.** If enumeration is too clever for the call sites, keep candidate narrowing (choose the *rarest* token, not the first, and skip keys shorter than the word) and replace regex tests with `indexOf` plus a single cached `[\p{L}\p{N}]` check.
3. Keep a fallback for words with no alphanumeric token (the old “fall back to all keys” path), and keep the per-revision result cache and the `skip` signature.
4. Add a fresh-process cold bench and an equivalence test at 1,000 × 4 shared keys: the new result must equal the current implementation's groups and `of()` output exactly, including punctuation and case.

**Done when.** `test/cheap.test.js` passes unchanged; the shared-vocabulary equivalence test passes; a fresh-process cold scan at 1,000 × 4 shared keys is under 50 ms native (from 149–157 ms median, 1.95 s p95); opening the first entry in that book produces no > 100 ms long task at 6× (merge gate) with the 50 ms target still the goal; repeat draws stay free per revision.

**Status.** ◐ Scan fixed, gate still open. Phrase enumeration landed; see §2.3 for the numbers and the harness-step correction. Cold 34.8–37.5 ms, warm shared 10.9 ms, warm mixed with 135 groups 11.0 ms — the scan half of the done condition is met. Entry open fell from 15.8–17.5 s to 0.65–1.05 s at 6× (worst 0.28–0.49 s), but that is still above the 100 ms gate, and the remaining time is entry-page render/layout (`entryPage` 117–123 ms), not the scan. Do not reopen H3 for that; it belongs to the entry-page work (C4, T0, N3). H1 and H3 may be marked done for clashes once the gate's owner is decided.

**Risk.** Medium. Whole-word equivalence is the whole contract; a phrase map that joins tokens with spaces silently changes punctuation behavior. Test the exact groups, not just the count.

**Source.** B0 baseline (§2.4); H1 follow-up.

#### A1 — Remove the full-screen phone blur (P1, animation prerequisite)

**Why.** `app.css:42` (`.wih`) and `:252` (`.sheet, .dlg`) apply `backdrop-filter: blur(...)`. Desktop disables it at `:1073–1077` with a comment that Hero’s canvas “fell to a few frames a second”. Phones still blur the whole viewport, and a sheet’s 180 ms `up` animation re-blurs every frame. The blur is the prerequisite for compositor-only animation.

**Change.** Apply the desktop treatment on phones as well, or add a “Glass background” setting that defaults off on phones:

```css
.wih, .sheet, .dlg {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: linear-gradient(var(--tint), var(--tint)), rgb(from var(--tint) r g b);
}
```

The desktop override is gone; the global rules now use the same opaque treatment, with the previous background kept as a fallback. The visual delta is small because ST’s `--SmartThemeBlurTintColor` is mostly opaque.

**Done when.** Pan/pinch and sheet-open traces show no blur repaint; the low-end phone is subjectively smoother; the visual delta is accepted.

**Status.** Landed. No native paint trace yet; verify on the weakest phone before calling the animation prerequisite complete.

**Risk.** Low. The weakest denominator may not support `rgb(from ...)`; the previous opaque background remains as a fallback.

**Source.** Qwen F2; DeepSeek #10; Astra animation prep.

#### A2 — Transform/opacity prep for the switch (P1)

**Why.** `app.css:135–137` transitions `.switch::after` on `left` (3px → 19px); `:366` transitions `.panelBtn` on `left`. Layout-property animation is the one existing violation of the animation rule.

**Change.**

```css
.switch::after { left: 3px; transition: transform .15s, background .15s; }
.switch.on::after { transform: translateX(16px); }
```

Animate `.panelBtn` with `transform` if the move is a fixed delta; otherwise leave it as a low-priority item. Rule for the animation pass: transform and opacity only.

**Done when.** Controls e2e passes; no visual regression; the switch no longer animates `left`.

**Status.** Landed. `.switch::after` transitions `transform`; `.panelBtn` keeps `left` because its open position is not a fixed delta.

**Risk.** Low.

**Source.** Qwen F14; DeepSeek #10.

#### C1 — Hidden Extensions panel (done in #48; verify)

**Why.** `index.js:33` used to schedule `render(hooks.view())` on every refresh; `hooks.view()` computed status for every modeled entry and `panel.js` rebuilt the table even when the drawer was collapsed.

**Change.** #48 adds `renderWhenVisible()`: the view is computed only when the section can be seen, and redrawn on reveal via `IntersectionObserver` / `checkVisibility`, with a fallback that always draws.

**Done when.** Chat events with the panel collapsed produce no settings-table rebuild; reopening shows current state immediately; the fallback path is tested.

**Risk.** Low. If `checkVisibility` is unavailable, the fallback draws on every refresh (safe, just no saving).

**Source.** Astra #4; Qwen F9; implemented in #48.

#### C2 — Group model issues once (P1)

**Why.** `app.js:202` (`problemsOf`) and `:212` (`warningsOf`) filter the whole `model.issues` array per row. They are called from `normal.js:195`, the entry page, the inspector, and `hero-shell.js:39–41` (`blockingUids`). That is O(rows × issues) per book draw.

**Change.** Group once when the model is built, or memoize in `modelOf` (`app.js:193–201`):

```js
model.issuesByStKey = new Map();
for (const i of model.issues) {
    const k = i.stKey ?? '';
    (model.issuesByStKey.get(k) ?? model.issuesByStKey.set(k, []).get(k)).push(i);
}
```

Keep the `warning`/`blocking` split at read time. `blockingUids` can use the same map.

**Done when.** Issue-related tests pass; a book draw no longer scans all issues per row.

**Status.** Landed. `test/model-issues.test.js` compares the grouped helpers against the old scan for every uid, including warnings, non-blocking notes, a null `stKey` and a rebuilt model; `model.issues` is unchanged. Models built outside `modelOf` still fall back to a scan.

**Risk.** Low.

**Source.** Qwen F4; DeepSeek #12.

#### C3 — Memoize `normalize`, clone at mutating callers (P1)

**Why.** `engine/model.js:45–47` (`normalize` → `clone(raw)`) is called per row per draw via `configOf` (`data.js:27`), `hasLogic` (`app.js:207–210`), and `normal.js:194`. A 150-entry book draw does ~150 deep clones just to answer “has story logic?”. The raw config object’s identity is stable until the entry is edited.

**Trap.** `bookEditor` (`pieces.js:259–265`) does `configOf(entry) ?? {}` and mutates the returned config in place before `writeConfig`. `hero-bar.js:43–70` runs trial edits on a cloned book. A shared memoized object would be corrupted.

**Change.** Memoize `normalize` keyed by the raw object in a `WeakMap`, and make mutating callers clone first:

```js
const normCache = new WeakMap();
export function normalize(raw) {
    if (!isObject(raw)) return { config: raw, ui: {}, legacy: false };
    let hit = normCache.get(raw);
    if (!hit) { hit = /* existing body */; normCache.set(raw, hit); }
    return hit;
}
// pieces.js bookEditor:
const config = uid => structuredClone(configOf(data.entries[uid]) ?? {});
```

Audit every `configOf`/`normalize` caller for mutation before enabling the cache. If the audit is uncomfortable, a read-only `hasLogic` path derived from the model is the fallback — but verify its semantics against the current definition, because `byStKey` membership is not exactly “has keys beyond id”.

**Done when.** `test/pieces.test.js`, `test/engine.test.js`, `test/trackers.test.js`, and bar-edit e2e pass; no mutating caller shares a cached object.

**Status.** Landed with one addition: `normalize(raw, reread)` exists because ST can edit a config in place, so `buildModel` asks for a reread and refreshes the cache; UI reads keep the hit. `bookEditor.config` and Hero's duplicate path deep-copy before mutating. `test/normalize-cache.test.js` pins identity, non-objects, the editor path (old cached raw untouched, stored raw new and edited) and two entries not sharing. Suite: 343 pass.

**Risk.** Medium — the mutation trap is real.

**Source.** Qwen F5; DeepSeek #12.

#### C4 — Cache parsed icon templates (P1)

**Why.** `icons.js` returns markup strings; `innerHTML` parses them in `dom.js` `btn()`, `normal.js:101,116,190,262`, canvas cards, etc. Hundreds of parses per book draw.

**Change.** Cache a parsed `<template>` per markup string and clone:

```js
const tplCache = new Map();
export function icNode(name, size) {
    const markup = ic(name, size).markup;
    let t = tplCache.get(markup);
    if (!t) { t = document.createElement('template'); t.innerHTML = markup; tplCache.set(markup, t); }
    return t.content.cloneNode(true);
}
```

Use `icNode` in hot paths (rows, cards); `btn()` can append the clone when content is an icon. Keep `ic()` for sheets and one-offs. Templates live in the main document but clone fine into the shadow root.

**Done when.** `test/html.test.js` and visual e2e pass; no per-row icon parse in the hot path.

**Status.** Landed. `ic()` keeps its markup and gains a marker; `icNode` clones a cached template; `btn()` appends a clone for icon content. Normal rows/tiles, desktop rows/tiles/search, Home search results, and the greeting/Moment card grips use it. Sheets, inspectors and one-offs stay on `ic()`. `test/html.test.js` pins the markup and marker.

**Risk.** Low.

**Source.** Qwen F13; DeepSeek #12.

#### C5 — Cache `toneOf` (P1)

**Why.** `app.js:32–37` reads computed style; `:341` calls it in every `render()`.

**Change.** Cache the tone and recompute on `show()` and on ST theme/settings changes (or a `MutationObserver` on the theme attributes ST sets). Once per theme change, not per draw.

**Done when.** Theme changes still update the tone; a draw no longer calls `getComputedStyle` unconditionally.

**Status.** Landed. The cache is per app instance, cleared at `show()`, when `app.css` finishes loading (the first draw can land before it), and by a `MutationObserver` on `documentElement`/`body` class, style and `data-theme`. `e2e/desktop.mjs` and `e2e/review.mjs`'s light-theme passes show the deeper piece colors and ≥3:1 contrast.

**Risk.** Low.

**Source.** Qwen F16; DeepSeek #12.

#### C6 — Cache `filterChoices.get()` (P1)

**Why.** `data.js:65–70` rebuilds the character/tag arrays on every `charsText` call.

**Change.** Cache by the `characters`/tags array identity, invalidated on character edits. Keep the returned shape.

**Done when.** Character/tag tests pass; repeated `charsText` calls do not rebuild the arrays.

**Status.** Landed. `filterChoices` has `setProvider`/`invalidate`; the app installs a provider, and `CHARACTER_EDITED`/`CHAT_CHANGED` clear the cache before the redraw (not after). `test/choices-cache.test.js` pins the cache, invalidation, item shape/order and a character edit between calls.

**Risk.** Low.

**Source.** DeepSeek #12.

#### C7 — Precompute Home sort keys (P1)

**Why.** `desk.js:252–258` calls `val(a)`/`val(b)` inside the comparator; for “Entries” each call does `entriesShown(n, data).length`, so a 40-book Home sort re-filters entries hundreds of times.

**Change.** Precompute sort keys once (`list.map(n => [key(n), n]).sort(...)`) instead of calling `val()` inside the comparator. Keep the current ordering and tie-breakers.

**Done when.** Home sort order is unchanged; `entriesShown` per Home draw is O(books), not O(books × entries).

**Status.** Landed. `test/home-sort.test.js` compares the decorated sort against the old comparator for name, active, entries and edited in both directions, ties, unloaded books, and pins one `val` call per book.

**Risk.** Low.

**Source.** DeepSeek #6.

#### C8 — Build one links index per Home pass (P1)

**Why.** `st-books.js:499–513` (`links(name)`) iterates `ctx().characters` and does `chars.find` per character; it is called via `linkText` (`app.js:213`) from `bookMeta` (`normal.js:77`) for every Home row. That is 40 books × N characters per draw.

**Change.** Build one reverse index per render pass (book → links) and pass it into `bookMeta`, or cache it in the library invalidated on `CHAT_CHANGED` / `CHARACTER_EDITED` / character-list changes.

**Done when.** Home draw cost with many characters drops; link text is unchanged.

**Status.** Landed. `test/st-books.test.js` pins link order and shape (character, aux with duplicate suppression, chat), an in-place character edit plus `invalidateLinks()`, and `linkChat`/`unlink` clearing. Duplicate `extraBooks` entries inside one lore are deduped; that is the only observable difference.

**Risk.** Low.

**Source.** Qwen F12; Astra #9.

#### C9 — `offCanvasMoments` fast path (P1)

**Why.** `app.js:229–231` inside `need()` filters every entry on every `need()`, then builds a canvas model only if Moments exist.

**Change.** Memoize the filter per book revision; skip the canvas model entirely when there are no Moments.

**Done when.** Books without Moments do not pay an O(entries) filter per `need()`; Moments still appear.

**Status.** Landed. `test/moments-cache.test.js` pins the no-Moment path (a getter that throws if `canvasBook` runs), placed and unplaced Moments, cache reuse per revision, invalidation when a Moment is added or removed, two books not sharing, and the uncached `null` path.

**Risk.** Low.

**Source.** DeepSeek #6/#12.

#### C10 — Containment step 1 (P1, measured intermediate)

**Why.** `app.css` has no `contain`/`content-visibility` in 113 KB. Rows `.item` (96), `.ptile` (166), `.drow` (830) are repainted broadly.

**Change.** Start with the safe step:

```css
.item, .ptile, .drow { contain: layout style paint; }
```

Do **not** put `contain: paint` on `.card`: sticky notes sit above the card box (`.card .sticky { bottom: calc(100% - 4px) }`) and would be clipped. `contain: layout style` on cards is acceptable if profiling wants it. Treat this as a measured intermediate, not a substitute for retention.

**Done when.** Scroll/selection/explain-mode e2e pass; no clipped content; paint/layout scope improves in a trace.

**Status.** ◐ Intermediate. The rule is in, and explain mode (26 checks), desktop (51) and tiles (6) pass with no clipped outlines. A CDP counter run at 6× on the 1,000-row book showed no scroll difference: 0 layouts and 9–11 style recalcs with containment on or off. N5's `e2e/paint.mjs` now supplies the trace half of the harness, and the windowed trial showed no clipped outlines and exact scroll positions, but the trace still has no containment-on/off A/B and no device run. Keep it as a low-risk intermediate, not a claimed win. Scroll anchoring checks pass in the N5 run; in-page find can reach visible and mounted-overscan rows and cannot reach windowed-away rows (N4's limit).

**Risk.** Medium — test explain-mode outlines, scroll anchoring, and in-page find.

**Source.** Qwen F15; DeepSeek #7; Astra #3.

---

### Phase 2 — Typing path

#### T0 — Cache the real token count (P1)

**Why.** `src/ui/normal.js:508` wires `tokens: text => ctx().getTokenCountAsync(text)`; `entry-page.js:430–441` calls it on every entry-page render and 500 ms after each keystroke. Depending on ST’s tokenizer setting this is a full tokenization pass or a server request. A 100 KB entry is re-tokenized on every fold toggle, mask switch, strategy change, page open, and every 500 ms of typing. The page already shows `tokenGuess` immediately (`entry-page.js:420`).

**Change.**

- Cache the last result by exact text (`Map<text, count>` or `{ text, count }` on the page closure).
- While typing, keep `tokenGuess` and request the real count on idle/blur, not every 500 ms.
- Skip the call while the host is hidden or the page is being rebuilt; cancel stale results with a token/generation check.

**Done when.** Typing 10 s into a 100 KB entry makes zero tokenizer calls until a pause/blur; opening an entry calls it once; the visible number still updates.

**Status.** Landed. `test/token-count.test.js` pins open caching, deferred input, rapid-input replacement, the fire-and-forget `feed` path (replaced feeds silent, failure null), flush/in-flight sharing, hidden and inactive skips, failure not caching, and the cap. `e2e/perf-harness.mjs` still records one call on entry open and one for the 50-character burst (the step waits out the 1200 ms idle). G2 now uses `feed` on the keystroke path and writes the visible number only when the deferred count lands (the guess when it fails), so the page does not write a counter on every key. The cache is per page render, so a mask switch starts a new one; repeat opens of the same text within a page are free.

**Risk.** Low. Remote tokenizers make this a network cost, so caching matters more.

**Source.** DeepSeek #4.

#### T1 — Stop cloning and stringifying the whole book on every save (P1)

**Why.** `st-books.js:8` sets `SAVE_DELAY = 350`; `:28` compares with `JSON.stringify(a) === JSON.stringify(b)`; `:127–134` schedules; `:136–163` handles change; `:165–214` (`saveNow`) clones at 171 and 177 and compares at 175 and 185. Continuous typing fires a save every 350 ms; each save clones the whole book twice and stringifies it 2–4 times. On a ~1 MB book that is a periodic main-thread stall mid-sentence.

**Change.**

1. Keep comparison bases as JSON strings, computed once: `sentJson = JSON.stringify(copy)` (drop the `sent` object clone); same for the `cacheSeen` base. Compare `JSON.stringify(after) === sentJson`.
2. Adaptive debounce: while `change()` calls keep arriving (typing), stretch the delay toward ~1000 ms; discrete edits keep 350 ms. The `pagehide`/`visibilitychange` flush in `index.js` (`flushNow`) already bounds the loss window — keep it.
3. `upgradeBook` runs on every save and re-normalizes every entry. With C3 it gets cheap; without C3, skip entries whose raw config identity is unchanged since the last save.

**Done when.** A 10 s typing burst in one book produces one save per debounce window, not per 350 ms; host-save tests pass; the crash-loss window is documented.

**Status.** Landed. `tools/perf/bench-save.mjs` records the before/after table above. `test/st-books.test.js` pins coalescing and the final payload, the idle-edit delay, the pending-native merge, a failed retry, and the string base for `mergeOutside`. `e2e/mobile-edit.mjs` passes against the harness save lifecycle; `e2e/host-saves.mjs` still needs a throwaway ST.

**Risk.** Low–medium. Longer debounce means a larger crash-loss window; the flush covers tab hide/close but not a hard process kill. Do not remove baselines, concurrency comparisons, or pending-native-save synchronization.

**Source.** Qwen F6; Astra #8.

#### T2 — Batch `saveSettings` and the `edited` write (P1)

**Why.** `st-books.js:181–185` calls `saveSettings()` when `upgradeBook` adopted UI fields, then again after writing `edited`. `saveNow` runs on the 350 ms save debounce while typing and on retries. `settings` includes every book’s `canvas.cards`, folders, defaults, snapshots, and `renamed`. ST’s `saveSettingsDebounced` eventually serializes the whole `extension_settings` object and sends it to the server. A library with many placed cards can queue a multi-hundred-KB serialization/POST on every keystroke pause.

**Change.**

- Set `edited` once per save transaction, not per intermediate save; call `saveSettings()` once after the save loop, not twice.
- Consider keeping `edited` out of the per-save path: derive “Edited” from the book’s saved revision, or write it at most once a minute / on blur.
- Measure `saveSettingsDebounced` call size and frequency in the target ST before changing behavior. Do not bypass ST’s settings save.

**Done when.** A 10 s typing burst produces at most one settings save per debounce window; the payload does not grow with unrelated books’ canvas state; “Edited …” semantics are preserved.

**Status.** Landed. One `saveSettings()` per save transaction, with `edited` and any adopted UI fields in the same call; the bench records 5 settings saves for 5 saves. Payload shape is unchanged, so unrelated books' canvas state is still in ST's settings object — that is ST's save, not this path.

**Risk.** Low–medium. `edited` is user-visible.

**Source.** DeepSeek #5.

#### T3 — History transactions and a byte budget (P1)

**Why.** `history.js:59` (`take`), `:73` (`touch`), and the `withHistory` proxy. `entry-page.js:212` records title input; content editing also takes the quiet-change path. Every library mutation advances the version; `history.changed()` then serializes all entries and `originalData`. The one-second typing merge reduces stored undo steps but does not avoid serializing on each keystroke. Redraws still serialize tracked settings even when entries are unchanged.

History keeps up to 100 whole-state records **per book**, with no global byte budget. A book with roughly 5.9 million serialized characters could retain roughly 590 million entry characters across 100 distinct entry-edit snapshots, before other retained state.

Measured edit cost (history wrapper + mutation, excluding rendering/persistence/token counting):

| Entries | Serialized book size | Median edit | Sample p95 |
|---:|---:|---:|---:|
| 150 | 175,108 chars | 0.34 ms | 0.68 ms |
| 1,000 | 1,169,608 chars | 4.13 ms | 7.42 ms |
| 5,000 | 5,865,608 chars | 14.58 ms | 18.30 ms |

**Change.**

1. Introduce explicit edit transactions and distinguish entry edits, canvas/settings edits, and non-edit presentation changes.
2. Capture a typing transaction’s pre-edit state once. Commit a changed-entry patch or immutable revision at the transaction boundary instead of generating a whole-book string per input.
3. Use patches for ordinary entry/settings edits; retain full checkpoints for import/replace and periodic recovery points.
4. Bound history by estimated bytes across books as well as step count (for example 8–16 MB total). Drop oldest states first. Release history through an explicit lifecycle policy.

**Done when.** Typing in a 5,000-entry book does not serialize the whole book per keystroke; undo grouping, Done/Cancel, rename, external edits, and piece-bar cancellation behave as before; history stays under the byte budget across repeated navigation; `test/history.test.js` and the related e2e pass.

**Status.** Landed for the run boundary and the budget. `test/history.test.js` adds: 40 quiet changes capture ≤3 times and undo/redo restore the ends; a pause splits; non-quiet and redraw boundaries; `held`; external reset; and budget eviction/accounting (including undo, redo, forget, rename). G2 removes the last mid-run whole-book copy: a quiet run's first changed key now keeps the pre-run `cur` captured by the draw and takes the final state once at the boundary, so a burst has no whole-book stringify at all. `e2e/mobile-edit.mjs` passes (this run); ST-only history e2e is still unrun. Patch-level storage remains deferred; the pre/final whole states are bounded by the 12 MiB budget.

**Risk.** Medium–large. Do not simply debounce `take()`: that can lose the pre-edit state, change Done/Cancel semantics, or merge actions that must remain separately undoable. Keep camera movement excluded and external-save history resets intact.

**Source.** Astra #1; DeepSeek #8.

#### T4 — Memoize the chat hider (P1)

**Why.** `show-in-chat.js:25–38` (`hide()`) always re-runs `messageFormatting` + `innerHTML` when a message has hidden lines. `index.js` wires five events, each `setTimeout(() => hider.hide(id), 0)` — several calls per message per turn; `all()` loops every message on chat/book changes.

**Change.** Memoize the last rendered output per message box (`WeakMap<box, { mes, active, out }>`) and bail when unchanged. Coalesce the per-event timeouts into one pending-id set flushed in a single `setTimeout`/rAF. Clear the memo on `CHAT_CHANGED` and on formatting/settings events; ST rendering settings can change mid-chat.

**Done when.** Trackers show-in-chat tests and `e2e/trackers-real.mjs` pass; unchanged messages are not reformatted.

**Status.** Landed. `test/show-in-chat.test.js` covers the memo key (text, active, model, author, output), clear, queue bursts/duplicates and `clear()`. `shownText` is unchanged. The in-ST hider and `e2e/trackers-real.mjs` still need a throwaway ST.

**Risk.** Low–medium. The memo can stale if ST formatting changes without an event; clear on chat change and settings events.

**Source.** Qwen F10; DeepSeek #12.

#### T5 — Stop the per-keystroke textarea reflow (P1)

**Why.** `entry-page.js:448–457` (`autoText`) writes `height:auto`, reads `scrollHeight`, and writes `height` again on every input — a forced layout per key.

**Change.** Prefer native sizing with a fallback:

```css
textarea.auto { field-sizing: content; min-height: 200px; }
```

If `CSS.supports('field-sizing', 'content')` is false, keep `fit()` but coalesce it into rAF (one fit per frame, not per key). Preserve caret/composition behavior.

**Done when.** Long-entry typing on a throttled phone is smooth; `e2e/mobile-edit.mjs` passes; the fallback path is tested.

**Status.** Landed, then capped by G2 (§2.3). `e2e/sizing.mjs` forces `CSS.supports('field-sizing', …)` false before page scripts, opens the 100 KB entry, and checks the first-frame measured height, the same `min(70vh, 800px)` cap and internal scroll as the native path, that typing stays capped, and that a short entry still fits its content; `e2e/typing.mjs` checks the native path's cap, caret/text and deferred counts. `e2e/mobile-edit.mjs` passes (this run). A throttled-phone typing trace is still outstanding.

**Risk.** Low.

**Source.** Qwen F11; DeepSeek #12.

---

### Phase 3 — Hero per-draw

#### V1 — Per-book revisions (P1)

**Why.** `app.js:190` (`modelOf`) keys its retained model on the global `library.version`; `st-books.js` increments that version for any dirty book. `hero-shell.js:210` (`canvasSig`) also includes the global version and serializes book settings plus top-level scalar settings. An edit in book B can invalidate book A’s derived model/canvas. Bookkeeping changes in the signature can provoke a redraw even when geometry did not change.

**Change.** Introduce per-book revisions, with separate geometry, content/presentation, settings, and chat-state revisions where useful. Keep a global library-list revision for Home. Geometry depends on topology, placements, ports, packs, visible cards, and link shapes; chat badges depend on a chat revision. Patch status text/classes without rerouting. If a status change truly affects bounds, invalidate that geometry explicitly.

**Done when.** Editing book B does not rebuild A; a changed gate, pack, or greeting still refreshes every affected view; chat-state changes patch badges without rerouting.

**Status.** Landed for the revision and cache keys. `test/book-revisions.test.js` pins: A's edit bumps A only; two edits bump twice; a confirm-save does not bump; an external B update bumps B; remove + recreate gets a fresh number; rename carries the revision to the new name. Chat-state patching is V6, not here.

**Risk.** Medium — invalidation correctness. Do not drop greeting fingerprints or ordinary ST fields from model inputs merely to improve cache hits.

**Source.** Astra #2; DeepSeek #3; Qwen F3.

#### V2 — Project `canvasSig` and compute it once (P1)

**Why.** `hero-shell.js:211–218` spreads `{ ...bs, canvas }`, so the signature includes `edited`, `seen`, `snapshots`, `folders`, and `defaults`. `saveNow()` writes `settings.books[name].edited = Date.now()` and calls `saveSettings()` on every save (`st-books.js:181–185`), so a content edit can force a full canvas redraw even though geometry did not change. The signature also includes the global `library.version`, which bumps on every keystroke. On a changed draw it is computed twice (`hero-shell.js:244` and `:246`). It returns `null` whenever “Show chat state” is on, and the retained-canvas branch explicitly redraws on `null`.

**Change.** Build a canvas input projection for `canvasSig`: only `canvas.cards` (position, ports, layer, `links` shapes), `canvas.placed`, and the hidden set. Exclude `edited`, `seen`, `snapshots`, `folders`, `defaults`, and the global `library.version`. Use V1’s per-book geometry revision. Compute the signature once per draw and reuse it. Do not return `null` for chat state; patch badges separately.

**Done when.** Opening an inspector or changing a strip leaves card DOM identity and route-compute counts unchanged, with “Show chat state” both off and on; a content edit does not redraw the canvas; a geometry change still does.

**Status.** Landed. `test/canvas-sig.test.js` covers every projected field and exclusion, order independence, and the cached entry-side build; `e2e/canvas-sig.mjs` proves content keeps `canvasRenders` and the card node, while keys, off/on and title redraw. `e2e/desktop.mjs` Hero/inspector passes. Chat-state badge patching (V6) is still the next step; the temporary chat revision keeps badges correct until then.

**Risk.** Medium — invalidation correctness. Keep the existing `settle()` and external-save boundaries.

**Source.** DeepSeek #3b; Astra #2.

#### V3 — Retain Hero chrome (P1)

**Why.** `renderHero()` calls `renderTabs()` (`app.js:390–423`), which clears `strip.innerHTML`; `heroPanel()` creates a new panel button, header, search field, and clash chip; `mountPieceBar()` builds ~10 chips plus the fold arrow and listeners; `heroInspector()` rebuilds the inspector body; `heroAround()` re-appends the checks chip and history buttons. Only the canvas element survives. This is the per-tap allocation/GC cost and the reason animations on chrome restart every draw.

**Change.** Retain the tab row and the panel/piece-bar/inspector shells; update labels and classes in place. This is the same “keyed rows” work as Normal mode, scoped to Hero chrome. Keep the canvas’s existing retained mount.

**Done when.** A Hero draw with no state change does not recreate the chrome; opening the inspector or switching a strip keeps DOM identity; labels and classes still update.

**Status.** Landed for the chrome shells: tab row (V3a), piece bar (V3b), entry panel and inspector (V3c). `e2e/tabs.mjs` keeps Hero/Normal tab nodes and `.tright`; `e2e/pbar.mjs` keeps the bar/chip/fold nodes; `e2e/chrome.mjs` keeps the panel button/aside/search/list container and the `.insp` shell for the same selection. Desktop, drawer, review, explain, controls and cheap pass. Rows and inspector bodies are still rebuilt inside their shells; keyed rows are N1.

**Risk.** Medium. Keep event listeners stable; avoid stale closures over book/state.

**Source.** DeepSeek #3c; Qwen’s retained-canvas note.

#### V4 — Make `overlay(null)` a no-op (P1)

**Why.** `hero-shell.js:245` calls `heroCanvas.overlay(null)`; `canvas.js:580–604` does two `querySelectorAll` passes over every card/pack frame and toggles three classes on each. For 500 cards that is 500+ class operations per tap even when there is no overlay.

**Change.** Track whether anything is dimmed/selected; if nothing was drawn, return immediately. Otherwise remove only the nodes/classes that were applied.

**Done when.** A tap with no overlay does not walk every card; overlay-on and overlay-off visuals are unchanged.

**Status.** Landed. The early return is covered by the same code path the piece bar and explain mode use; `e2e/controls.mjs` (23 checks), `e2e/shape.mjs` and `e2e/desktop.mjs` pass.

**Risk.** Low.

**Source.** DeepSeek #3d.

#### V5 — Index link nodes, use the arrange result, and stop rescanning (P1)

**Why.** `canvas.js:134` serializes canvas memory twice around `arrange`, clears `.world`, recreates cards/ports/SVG, and calls `LINKS.layout`. The link engine correctly skips cached routes with unchanged signatures and unaffected obstacles (`link-engine/index.js:577+`), so a full canvas redraw is not necessarily a full route recomputation — but it still recreates DOM. `canvas.js:399–406` (`CV.relink`) scans every `.ln` and `.lhit` for each changed link, so a dot drag is O(changed links × rendered links).

**Change.**

- Keep `Map<linkId, nodes>` and `Map<cardId, nodes>` indexes.
- Use an explicit placement-changed result from `arrange` instead of stringifying the whole memory twice.
- Retain stable card/link elements and consume the routing engine’s changed/removed lists.
- Index link nodes by `def.id` so `relink` touches only that link’s nodes.

**Done when.** A dot drag touches only the changed link’s nodes; a full redraw still recreates DOM only when geometry changed; link visuals are unchanged.

**Status.** Landed for the node indexes and `relink`. `e2e/shape.mjs` drags a ghost dot and a line through both viewports; `e2e/controls.mjs` exercises link hover/selection. The arrange double-stringify remains as the plan already deferred.

**Risk.** Medium. Keep hit testing and link ordering correct.

**Source.** Astra #6; DeepSeek #3e.

#### V6 — Patch status, do not reroute (P1)

**Why.** Chat badges and status text are folded into the canvas/geometry path, so a chat-state change can trigger routing or a full redraw.

**Change.** Give status/chat badges their own revision and patch text/classes on existing nodes. Invalidate geometry only when a status change actually affects bounds.

**Done when.** A new message updates badges without route recomputation; a status change that changes bounds explicitly invalidates geometry.

**Status.** Landed, and the follow-up is in G4 (§2.3): the cards stay built with their status nodes, so Show chat state now patches both ways (`patchStatus(() => null)` when turning it off) instead of drawing once per toggle. `e2e/badges.mjs` changes the harness state (fired, closed, holding, Moment status) and checks the same card node and no new `canvasRenders`; it then toggles Show chat state off and on and checks the same node, a patched class and no new `canvasRenders`. A real-ST chat is still the missing evidence: the harness state stub is not an engine.

**Risk.** Medium — easy to miss a bounds-changing status.

**Source.** Astra #2; DeepSeek #3b.

---

### Phase 4 — Normal mode

#### N1 — Retain the shell and key rows (P1)

**Why.** `app.js:355` (`main.innerHTML = ''`) and `desk.js:175` clear and rebuild the page on every draw. `desk.js:510–537` (`fill`) rebuilds the entry list on every filter keystroke. `normal.js:125–218` materializes every shown entry row. Repeated node creation, listener setup, derived summaries, style/layout, and GC scale with book size; focus and scroll are hard to restore when the view disappears.

**Change.** Retain the page shell and update keyed rows by UID. Separate the entry pane from the list so opening/selecting an entry updates only the selection and the pane. Keep selection/order in the data model. Preserve keyboard navigation, folder headings, variable row heights, scroll-to-entry, drag/drop, and screen-reader behavior. A selected or focused row may need to remain mounted outside the window.

**Done when.** Selecting an entry updates only the selection and the right pane; the left list keeps DOM identity and scroll; a full redraw happens only when the page actually changes.

**Status.** ◐ N1a/N1b landed. `e2e/normal-rows.mjs` keeps the book `.view`, header, chips and row node across a title change, off/on, scroll/focus refresh, A–Z re-sort, selection and leaving selection. `e2e/home-rows.mjs` keeps Home's view, rows, count span/text, selection state, folder survival and scroll; the list↔tiles switch keeps the view but replaces rows. Selection/bottom bars, the entry page, desktop panes and per-row listeners still rebuild; selecting an entry redraws the page (N2/N3).

**Risk.** Medium–large. This is the biggest structural change; stage it.

**Source.** Astra #3; Qwen F3/F7; DeepSeek #7.

#### N2 — Delegate row events (P1)

**Why.** `dom.js` `pressable()` adds seven listeners (pointerdown/move/up/cancel/leave, click, contextmenu), `swEl()` adds one, and the `more` button adds one — about nine per row. 150 rows ≈ 1,350+ listeners and closures allocated and GC’d per full redraw.

**Change.** Delegate on the list container (`.view` / `main`): one pointerdown/move/up/cancel/leave + click + contextmenu set, resolving the row via `e.target.closest('.item, .ptile, .drow')` and its `data-book`/`data-uid`. Keep the 480 ms long-press and 8 px move-cancel logic; store per-gesture state in one closure instead of per row. Rows become dumb DOM (also the groundwork for FLIP reorder animations).

**Done when.** Long press, select mode, `swEl` stopPropagation, and taps on `button, .check` behave as before; row creation allocates no listeners.

**Status.** ✅ N2a/N2b landed. `e2e/delegate.mjs` covers the phone Home/book lists: tap-open, long-press background tab with the click swallowed, 8 px cancel, `.more`, switch-not-opening, select mode and the 1,000-entry book. `e2e/delegate-desktop.mjs` covers desktop Home rows/tiles (tap, Ctrl-click, right-click, Enter/Space, drag to a folder, folder heads), `.brow` rows (select, Ctrl/Shift, double-click, middle-click, right-click, reorder, folder drops) and both search lists (hover, tap, middle-click, phone long press and prevented contextmenu); CDP shows no per-row listeners. Sheet and Hero panel rows keep `pressable` as agreed.

**Risk.** Medium. Migrate one surface at a time (book list first); keep `pressable` for sheets/menus until proven.

**Source.** Qwen F7; DeepSeek #7.

#### N3 — Separate the entry pane from the list (P1)

**Why.** Desktop entry selection leads back into the app renderer; the whole page is replaced to show a different entry.

**Change.** Keep the list mounted and update only the selection and the right pane. Preserve scroll position and focus.

**Done when.** Selecting an entry does not recreate the list; the pane updates; focus stays sensible.

**Status.** ◐ N3a landed for desktop/narrow drawers: `e2e/desk-pane.mjs` keeps the list, rows, filter and scroll while selecting another entry, opening Book settings, switching single/multi and swapping panes in a 600px drawer; a filter change rebuilds the list intentionally. N3b landed for phone Normal: `e2e/entry-pane.mjs` keeps the book `.view`, its rows, `scrollTop` and focused switch while an entry is open and Back, shows the hidden list neither visible nor focusable, keeps it while moving to a second entry through the entry drawer, and updates the same row after a title edit made during the entry, with 0 new `rowMounts` on Back (980 before N3b). Another page (tab, book, Home, deep link) still discards the list.

**Risk.** Medium.

**Source.** Astra #3.

#### N4 — Window long lists (P1/P2)

**Why.** `normal.js:125` and the desktop book list materialize every shown entry, so DOM memory and layout scale with book size.

**Change.** Window with overscan, keeping selection/order in the data model. Preserve keyboard navigation, folder headings, variable row heights, scroll-to-entry, drag/drop, and screen-reader behavior. Keep a selected or focused row mounted outside the window if needed. Do not virtualize until N1–N3 are in place.

**Done when.** A 1,000-entry book scrolls smoothly; focus/scroll/selection/drag/a11y survive; DOM node count is bounded.

**Status.** ◐ N4a and N4b landed; both lists share `src/ui/window.js`. G3 then took the scroll frame off synchronous measurement and retained-row updates (§2.3). `e2e/window.mjs` shows 19 mounted phone rows at the top (26 at the middle, 19 at the bottom) instead of 980 on the 1,000-entry "Perf Big" book, with the whole book still in `scrollHeight`; middle/bottom titles match their rows, a settled refresh is 0 row mounts with a visible row's node kept, opening the last entry and Back restores the same row, scroll and recomputed window with 0 new row mounts, a 12-step scroll sweep stays bounded, a focused row stays mounted and focused outside the window until blur, select mode and a long press work, and a folder head folds and unfolds the windowed list. `e2e/window-desktop.mjs` shows the desktop `.bllist` mounting 23 rows (176 nodes, `scrollHeight` 31,376 px) instead of 980, with the bottom/middle windows correct, `aria-setsize`/`aria-posinset` from the whole order, Arrow Up/Down across an unmounted selection, a focused Order input pinned 6,000 px away, N3a's list/row identity, Ctrl/Shift selection, filter rebuild/windowing, folder fold/unfold, drag reorder and a drop on a visible folder head. Heights are cached per item key and corrected from mounted rows; N3a's mount replacement disposes the old observer. `e2e/scroll.mjs` covers the scroll gate: wheel sweep, 12 × 800 px fling, 6,000/20,000–30,000 px jumps, exact top/middle/bottom rows, bounded window, no visible spacer, stable `scrollHeight`, phone Back and desktop selection restore. **Not done:** compositor/raster traces, in-page find/scroll-anchoring evidence over windowed-away rows, and a drag target outside the mounted window (no auto-scroll while dragging). A window of rows means Tab reaches the mounted rows, not all 980; no virtual-list roles were added beyond the rows' setsize/posinset, and the listbox is still focused as a whole.

**Risk.** Medium–large. Test scroll anchoring, in-page find, and explain-mode outlines.

**Source.** Astra #3; DeepSeek #7.

#### N5 — `content-visibility` as a measured enhancement (P2; tested and rejected)

**Why.** After keyed rows, long lists can skip rendering offscreen rows.

**Change.** Test `content-visibility: auto; contain-intrinsic-size: auto 54px` on `.item.ent` (32px for `.brow`; the plan's earlier 60px was wrong — `.brow` is 32px and a phone entry row measures 56px) for 500/1,000-entry books. Do not put `contain: paint` on `.card`; sticky notes sit above the card box. Keep C10's `contain: layout style paint` on rows.

**Done when.** Scroll-to-top, scroll anchoring, explain-mode outlines, and in-page find still work; a trace shows less rendering work.

**Status.** ❌ **Tested and rejected.** `e2e/paint.mjs` records the CDP trace and performance-metric deltas (§2.3 has the table). After N4a/N4b, only ~30–51 rows are mounted inside the window's overscan, so `content-visibility` mostly skips rows the window would have dropped anyway. The trial cut desktop Paint events (974 → 497) but raised layouts (31 → 41) and the 6× `TaskDuration` on both scrolls (phone 1,408 → 1,594 ms; desktop 989 → 1,128 ms); the phone Paint count barely moved. The Hero panel's non-windowed `.prow` rows won on opening but lost badly on scroll (Paint 22 → 286; `TaskDuration` 312 → 391 ms). Both CSS rules were reverted. No behavioural loss was found in the trial (eight e2e suites passed; exact top/bottom rows, stable heights, no clipped explain outlines, find unchanged for mounted rows), so the rejection is on work, not behaviour. C10's containment stays the retained intermediate. The remaining N5 evidence is the reusable paint recorder, not a CSS change.

**Risk.** Medium — test the edge cases before keeping it.

**Source.** Qwen F15; DeepSeek #7.

---

### Phase 5 — Memory, loading, search

#### M1 — Shared loader with cancellation (P2)

**Why.** `app.js:266` queues Home counts through `library.get()`. `st-books.js:106` retains each loaded book in `copies` and a full cloned baseline in `bases`; there is no general clean-book eviction policy. `cacheSeen` may retain further clones after saves/events. The count queue is concurrency-limited but continues processing queued work without a current-view cancellation check. `countSpans` retains its last span per book. Three-at-a-time loading prevents a request flood; it does not bound eventual memory.

**Change.** Add a shared loader with foreground priority and cancellation of queued obsolete work. The current book loads ahead of remaining counts. Store small summaries separately from editable working copies. If ST cannot provide count metadata, compute summaries during a bounded read and release clean, unpinned extension copies afterward. Host caching may still retain data, so measure total memory too.

**Done when.** Opening a large library then leaving Home stops unnecessary queued work; the current book loads ahead; memory reaches a bounded plateau across repeated navigation.

**Status.** ◐ Loader half landed with M3, in `src/ui/loader.js`; the app enqueues Home counts as background work through it and `need(book)` as foreground work. `e2e/load-priority.mjs` shows three background reads, a tapped book starting ahead of ten queued counts and opening while nine books remain uncounted, and no count read starting after Home is left. The summary/eviction/pinning half is M2, now landed: Home draws from summaries and the clean-copy cache is bounded at 8 with open, dirty, saving, history and reserved books pinned (see §2.3); `e2e/memory.mjs` shows the browser heap plateau. The weakest-device heap snapshot is still the missing evidence (§7.5).

**Risk.** Medium. Pin open books, dirty/failed saves, in-flight operations, and any state needed for undo.

**Source.** Astra #5; DeepSeek #8/#9.

#### M2 — Summaries, LRU eviction, and pinning (P2)

**Why.** Home and Search can eventually retain every listed book just to show counts. An LRU must never discard the user’s only unsaved copy.

**Change.** Keep small summaries (counts, names, folder, edited) separate from working copies. Evict clean, unpinned books with an LRU. Pin open books, dirty/failed saves, in-flight operations, and anything needed for Undo. Clear detached span references when leaving/replacing Home. Never evict the only unsaved copy.

**Done when.** Memory plateaus across repeated Home ↔ book navigation; unsaved edits and external merges survive eviction tests; heap snapshots, not just object counts, show the plateau.

**Status.** ✅ Landed (browser evidence; device heap still outstanding). `src/ui/st-books.js` keeps a summary per book (visible count, total, tokens, and the revision it was taken at), `summary(name)` serves Home synchronously, and changes only make it stale so the next Home ask recomputes once. Clean working copies are an LRU capped at `MAX_COPIES = 8`, evicted after loads and saves, with the open books, books with undo/redo states, dirty/saving/failed books, operations, reserved names and in-flight loads pinned. `stats()` exposes copies, summaries, pins and evictions. `e2e/memory.mjs` shows 10 Home ↔ book cycles at 8 copies and 41 summaries with 317 KiB of heap growth over the last five cycles, a summary-only Home redraw with 0 reads, and a dirty copy plus an undo state surviving eviction. `test/library-memory.test.js` covers the pin classes, LRU order, cleanup and outside merges. **Not done:** a real phone heap snapshot and a ST-host heap trace; both stay in §7.5. The in-flight-load pin is in the predicate by construction but has no direct unit test (open, dirty, saving, failed, operation, reserved and history pins do).

**Risk.** Medium — pinning correctness.

**Source.** Astra #5; DeepSeek #8.

#### M3 — Cancel Home counts when leaving (P2)

**Why.** The count pump continues processing queued books after the user leaves Home; the count spans are no longer visible.

**Change.** Check the current view before each queued count; cancel obsolete work. Clear the retained span references.

**Done when.** Leaving Home stops queued count work; the current book’s count still loads.

**Status.** ✅ Landed with M1. Leaving Home (a book, an entry, Hero, hide) clears `countSpans` and drops queued count reads; a fresh Home draw that replaces the list does the same. A count already in flight still lands in a connected row while Home is showing, and opening the current book promotes its queued count read to foreground. `e2e/load-priority.mjs` checks the queue, the tap, the stop after leaving and the return Home with every visible count shown; `test/loader.test.js` pins the cancel/generation behaviour.

**Risk.** Low.

**Source.** Astra #5.

#### M4 — Search indexing, debounce, and current-book-first (P2)

**Why.** `data.js:404` lowercases titles/keywords and resolves folders for entries on each query. `normal.js:395` builds book arrays and takes the first 80 results only after search; `desk.js:989` limits to 60 after the complete scan. Search does not scan content. `normal.js:395–396` calls `need(n, { open: false })` for **every** book when the search overlay opens, before the user types, which starts loading the whole library. The search rebuilds the corpus and scans every entry on each keystroke, with no debounce (`normal.js:397–425`).

**Change.**

- Normalize searchable fields once per changed entry/book and retain a small index.
- Process the current book first; preserve the current ranking rules for books and folders.
- Debounce input 120–150 ms; keep the immediate first run on open.
- Load only loaded books with a visible “still loading” state; do not load all 40 on open.
- Use a query revision to discard stale asynchronous results.
- Update visible results as loading completes; do not depend on a whole-app redraw that may be deferred while typing.
- Cache per-book lowercase haystacks keyed by book revision.

**Done when.** Opening search does not load 40 books; typing stays under one frame at 6× with the current book loaded; folder deduplication, hidden-entry exclusions, Moments exclusions, and current-book priority are unchanged.

**Status.** ✅ Landed with `src/ui/search.js`: one lowercase corpus per book revision (plus working-copy identity and a settings revision for folders), the old `data.search` ranking, a 130 ms debounce with an immediate first run, and a `search` loader group for **Search all books**. `e2e/search.mjs` shows 0 reads on open, 3 of 7 books named as unsearched, three bounded background reads with in-place results, cancellation on close, one run for a 10-key burst, and 10.5 ms of scanning for one character at 6× with no task over 50 ms; `test/search.test.js` compares the indexed scan with `data.search` on every fixture.

**Risk.** Medium. Preserve ranking and partial-load behavior.

**Source.** Astra #7; Qwen F8; DeepSeek #9.

---

### Phase 6 — Launch and animation readiness

#### L1 — Lazy-load the editor (P3)

**Why.** `index.js` statically imports the editor graph. The static import graph reaches 63 modules, ~1,053–1,078 KB of JS, with zero dynamic imports. `createApp` also attaches the ~116 KB `app.css` at boot. Split: the engine side (hooks, engine, panel, bubble, library, data, compat) is 27 modules / ~261–267 KB and must stay eager (it runs during generation). The editor-only subtree (`app.js` → canvas, desk, piecebar, inspector, menus, explain, guide, preview, link-engine, …) is 36 modules / ~793–811 KB, parsed/compiled on every ST launch even if World Info is never opened.

**Change.**

```js
let app = null, appLoading = null;
const loadApp = () => (appLoading ??= import('./src/ui/app.js').then(({ createApp }) => {
    app = createApp({ /* same deps as today */ });
    return app;
}));
// in syncWithDrawer, when the drawer opens and !native:
wiDrawer.classList.add('wihero-under'); // immediately, so ST's editor never flashes
await loadApp();
askedBook ? app.openBook(askedBook) : app.show();
// a few seconds after boot, so first open is still instant on capable devices:
setTimeout(() => requestIdleCallback?.(() => loadApp()), 3000);
```

Wiring to handle:

- `syncWithDrawer`, `openStEditor`, `keepBesideSidePanel` touch `app` unconditionally — add null/loading guards.
- The `touchstart`/`mousedown` stopPropagation listeners on `app.host` move into the loaded path (or attach once after load).
- `askedBook`/`askedTimer` already queue a book requested before the editor exists — reuse that.
- Keep `globalThis.wihero` eager with `app: null` until loaded (e2e reads `wihero.settings` before opening; `perf.mjs` only evaluates `wihero.app`). Add a `wihero.ready` promise for tests.
- Show a minimal placeholder in the host while the import resolves.
- `style.css` (global, ~4.5 KB) stays eager; only `app.css` moves with the chunk.
- Feature-detect `requestIdleCallback` and fall back to `setTimeout`.

**Done when.** ST boot long tasks drop by the editor parse/eval cost; first drawer open still shows a row quickly; `e2e/perf.mjs` `firstRowMs`, drawer e2e, lifecycle e2e, and `node --test` pass.

**Status.** ◐ Landed with `src/ui/lazy-app.js`. The static graph from `index.js` no longer reaches `src/ui/app.js`: measured-native it fell from 70 modules / 1,196.2 KB to 29 / 293.8 KB eager, with 42 / 909.7 KB deferred behind `app.js` (71 total, including the new `lazy-app.js`). The chunk loads on the drawer's first open or a queued book request, with a `#wihero-loading` placeholder; an idle prefetch ~3 s after boot loads it on capable devices and is dropped on a non-bfcache pagehide. A drawer ticket means a quick open/close cannot show the editor or leave `wihero-under`; a failed import removes `wihero-under`, reports and leaves ST's drawer visible. `e2e/boot.mjs` proves 0 editor requests at boot, exactly one `app.js` and `app.css` on open, a Home row in 159–244 ms (five runs, measured-native-browser), the prefetch, the fast open/close and the failure path. Harness `e2e/drawer.mjs` (10) and `e2e/lifecycle.mjs` (3 PASS) pass; a live-ST drawer/lifecycle run and `e2e/perf.mjs`'s `firstRowMs` (real ST boot long tasks) remain unverified, as does the “ST boot long tasks drop” half of the done condition. A3 has since landed (§A3); A4 and A5 remain open.

**Risk.** Medium — wiring guards and the eager `wihero` surface.

**Source.** Qwen F1; DeepSeek #11; Astra #9.

#### A3 — Reduced motion and hidden-page pause (P3)

**Why.** Reduced-motion support exists (`app.css:563`), but optional animation should also stop when the editor/page is hidden.

**Change.** Keep the media query; consider a “Reduce motion” setting for devices that do not set it. Stop optional animation when the editor/page is hidden.

**Done when.** `prefers-reduced-motion` disables/shortens motion; hidden pages do not run optional animation.

**Status.** Landed. The shadow-tree rule now covers `*::before`/`*::after` as well, so `.switch::after` and the other pseudo-element transitions stop under reduced motion; the eager `#wihero-loading` placeholder has its own scoped rule. `createPageMotion()` (in `src/ui/page-motion.js`, attached inside `createApp` so the lazy editor pays nothing) toggles `.wih[data-paused]` on `visibilitychange`/`hide()`: CSS animations pause and transitions stop. `scheduleRender`/`refresh`/`render` park draws while hidden (a queued frame is cancelled, the request stays pending and runs once on return), and the canvas's `pause()`/`resume()` cancels gesture frames, hover/hold/camera/flash timers, keeps and saves a pan or card/shape change, and drops only the transient parts of the gesture. A missing visibility API is the visible path. `e2e/motion.mjs` (13) proves the reduced-motion styles and their return (including the eager placeholder and that an ST-page element keeps its own transition), the pause attribute/computed pause, zero app/canvas draws while hidden with one catch-up, a saved mid-pan camera, and an edge loop that stops and does not resume; the fake visibility shim cannot prove real background throttling or compositor pause on a device. `test/page-motion.test.js` (6) pins the helper. **A4 remains:** large scenes at low zoom and open/close heap snapshots, plus a single dispose path as more of the editor is retained. **A5 remains:** its items 1–5 are now met in code (A1, retained DOM, transform/opacity, the interaction work, this pause), but item 6 — paint/compositor traces for the promoted `.world` and large scenes on the weakest device — is still outstanding, as are the §7.5 device traces generally.

**Risk.** Low.

**Source.** Qwen animation checklist; DeepSeek #10.

#### A4 — Raster memory and lifecycle cleanup (P3)

**Why.** A promoted `.world` at low zoom can be a large layer. Canvas/input modules schedule timers and animation frames without a single comprehensive public dispose path. This inspection does not establish an unbounded listener leak; detached element listeners alone are not proof of one.

**Change.** Check large scenes and low zoom on the weakest phone; do not promote every card. Keep `will-change` temporary. Add explicit lifecycle cleanup as components become retained/virtualized. Verify retaining paths with heap snapshots.

**Done when.** Large scenes at low zoom do not exhaust raster memory; open/close cycles show no retained-listener or retained-DOM growth in heap snapshots.

**Risk.** Medium — verify with traces, not object counts.

**Source.** Astra animation prep; DeepSeek #10.

**Status.** ✅ Repo-side lifecycle and raster policy landed (measured-native-browser); device raster/compositor memory stays §7.5 and A5 item 6. The app now has one terminal `destroy()` (also `wihero.dispose()`): it removes the page-motion and window listeners, disconnects the theme `MutationObserver` and the app `ResizeObserver`, disposes the Hero canvas (every rAF/timeout, its `ResizeObserver`-free input listeners, document-level Place/pack-name away listeners, the shared Space release and its node indexes), every retained list window (`src/ui/window.js`), the panel/piece-bar/inspector shells and the desk book mount, closes and disposes the layer, and removes the host. `show()`/`render()` after it do nothing, so a second open cannot resurrect a node; `hide()` stays cheap and non-destructive but drops gesture classes, promotions and the away listeners. The bookkeeping is a small `src/ui/lifecycle.js` registry tested in Node (`test/lifecycle.test.js`, 5). The retained piece bar's `ResizeObserver` is now dropped when edit mode replaces it (it previously stayed on a detached node).

`e2e/lifecycle-heap.mjs` opens the 500-card "Perf Big" canvas in Hero mode (676 cards drawn: the placed 500 and their linked neighbours), zooms to **0.268**, and finds **0** promoted cards, `.world` with computed `will-change: auto` at rest, `transform` only while `.vp.gesture` is on, and `translate` only on `.card.moving`; hide drops both classes and leaves no computed promotion. Ten show/hide cycles after forced GC stay at **12,128** DOM nodes, **48** live listeners (window/document/shadow/connected elements), **5** active observers (2 `ResizeObserver`, 3 `MutationObserver`, one of those Playwright's) and **1** working copy / **1** summary. Heap rose from **15,654,676 B** after the first hide to **15,963,144 B** at cycle 10, with **87,096 B (~85 KiB)** growth over the last five cycles against a 4 MiB limit. `wihero.dispose()` then detached the host, left no editor window/document/shadow listener, no editor observer, kept `wihero.library.stats()` readable, and a second `show()`/`dispose()` added nothing. The listener counter uses `WeakRef`s and counts only connected targets, so the heap/DOM series is the proof for detached nodes; Playwright's own 13 window listeners and one observer are excluded from the editor assertion. **Not done:** raster/compositor (layer) memory on a phone, `LayerTree` layer counts, a real background tab/app switch and an ST-host heap snapshot — those stay §7.5 and A5 item 6. Scoped out of this commit and listed for later: entry-page/token-count transient timers, desk focus `setTimeout`s, and search/preview request state.

#### A5 — Animation readiness checklist (P3, gate to the animation pass)

Do not start the animation work until:

1. A1 is done: no live full-screen blur.
2. Stable DOM identity exists for Normal rows and Hero chrome; the canvas is already retained.
3. Transform/opacity only; no `left/top/width/height/background` animation. A2 fixes the switch.
4. No long tasks on the interaction path: H1, H2, T0–T5, V1–V6 are done.
5. Reduced motion and hidden-page pause are in place.
6. Paint is measured, not just JS: paint flashing/compositor traces for blurred surfaces, the promoted `.world`, and large scenes at low zoom.

**Checklist (2026-11-25).** Repo-side audit; the measured numbers are the A5 table in §2.3.

| # | Condition | Result | Evidence | What remains |
|---|---|---|---|---|
| 1 | A1: no live full-screen blur | **Device-only** (code done) | `grep -rn backdrop-filter src/ *.css` finds no blur on `.wih`, `.sheet` or `.dlg`; the harness computes `backdrop-filter: none` on both. The only live rules are the 44 px launcher `.wihero-bubble` and its ≤300 px `.wihero-bubble-menu` in `style.css` — pre-existing, static and not full-screen. A1 landed in `853a10e`. | Device paint trace for pan/pinch and sheet open/close on the weakest phone; confirm no blur repaint (items 1 and 6 share the run below). |
| 2 | Stable DOM identity for Normal rows and Hero chrome (canvas retained) | **Met** | Normal: `e2e/normal-rows.mjs` 7 (view, rows, focus, A–Z re-sort reusing 2 nodes, selection in place), `entry-pane.mjs` 6 (Back 0 row mounts), `window.mjs` 12 (33/51/33 mounted; 0 mounts on refresh/Back), `desk-pane.mjs` 7, `tabs.mjs` 5. Hero: `chrome.mjs` 5, `pbar.mjs` 1, `badges.mjs` 6, `canvas-sig.mjs` 5, `tabs.mjs` 5; desktop `window-desktop.mjs` 14 and `desktop.mjs` 51. The 10 named suites hold 68 checks (119 with `desktop.mjs`). | None for identity. In-page find over windowed-away rows remains an N4 limit, not a retention break. |
| 3 | Transform/opacity only; no `left/top/width/height/background` animation | **Met** (one written paint-only exception) | 26 active declarations audited (excluding reduced-motion and `.wih[data-paused]` overrides and two explicit `none`s). Five transition declarations moved off layout/background: `.switch::after` transform-only, `.modebtn` transition removed, `.panelBtn` `translateX(min(calc(100vw - 64px), 420px))` (same 336/380 px box at 390 × 844), `.colresize::after` opacity, `.dropcancel` transform-only. One state rule, `.switch.sm.on::after`, moved from `left` to `translateX(12px)` (also fixes its A2 overflow). Of the 25 that still animate, 24 are transform/opacity; no transition/animation value names a layout property or `background`. `e2e/motion.mjs` 13 (expects `transform` only) and `controls.mjs` 23 pass. | `.toast .ttimer rect` drains `stroke-dashoffset`: paint-only on a 2.5 px outline, no layout or background, ≤5 s, stopped by reduced motion. Revisit only if a device trace shows it. |
| 4 | No long tasks on the interaction path (H1, H2, T0–T5, V1–V6, G1–G4 done) | **Not met overall** (scroll, entry open and typing met) | Code landed: H1/H3, H2, T0–T5, V1–V6, G1–G4 (§2.3). Measured-at-6x: entry open **82–85 ms worst over three runs**, `clashScan` 0, `entryPage` 18.1–24.6 (native 0 long tasks, 80–83 ms, `entryPage` 7.2–7.6); typing **50–79 ms worst over three runs**, 1–2 tasks (native 0 tasks; 20 ms stress 155–192 ms / 2–3 tasks, browser line layout + V8 GC); scroll **0 long tasks / 0 ms worst over three settled runs** after G3, 631–648 ms step (native 0 tasks), with 50.1–50.9 ms instrumented frames; Hero open **2,516 ms total / 1,670 ms worst over three G4 runs** (native 571–661 / 270–350, links fill after the first card), tap **1,048 / 517 ms** (native 165 / 0, 0 draws, 0 routes; the rest is the focus dim's style/paint), pan (wheel zoom) **1,003 ms / 90 ms over 11 tasks** (native 798 / 0; 0 draws, 0 routes), Show chat state **1,682 / 693 ms** with **0 draws and 0 routes**, inspector chat on 925 / 289 ms; first Home row 536/327 ms. | Owning follow-up: remove the focus dim's full-canvas style pass from a phone tap, and the per-step re-raster from a wheel zoom, without changing the dim/zoom visuals. Scroll (G3), entry open (G1) and typing (G2) are met and no longer follow-ups. Hero open, tap and pan are materially down but still above their 50 ms target at 6×. Budgets unchanged (§4.2). |
| 5 | Reduced motion and hidden-page pause | **Met** | `e2e/motion.mjs` 13: CDP reduced media takes every shadow-tree transition/animation (pseudo-elements included) and restores it; fake visibility sets `data-paused`, pauses animation, parks app/canvas draws with one catch-up, saves a mid-pan camera and stops a card edge loop without resuming; the eager placeholder and an ST-page element keep the right behavior. A3 (§2.3); `src/ui/page-motion.js`; `test/page-motion.test.js` 6. | Real background-tab/app-switch throttling and compositor pause are device-only (§7.5). |
| 6 | Paint measured, not just JS | **Device-only, outstanding** | `e2e/paint.mjs` is committed and records CDP `Layout`, `UpdateLayoutTree`, `Paint`, `PrePaint` and `Layerize` plus `Performance.getMetrics` deltas, DOM nodes and mounted rows for the windowed lists, Home, Explain and the Hero panel. A4's `e2e/lifecycle-heap.mjs` 8 shows 0 promoted cards and `.world`/`.card.moving` promotion only during gestures. Neither is a compositor or device trace. | The hardware run below. |

**Device run still needed (items 1 and 6).**

- **Hardware:** the weakest Android phone/WebView available, not desktop Chromium; 6× CPU throttling is a comparison tool, not a substitute for mobile GPU/raster memory.
- **Tooling:** DevTools remote debugging (`chrome://inspect` / USB), paint flashing, the same `devtools.timeline` + `disabled-by-default-devtools.timeline` categories `e2e/paint.mjs` uses, `LayerTree` layer counts, and Memory (raster/GPU).
- **Scenarios:** (a) pan and pinch on the 500-card "Perf Big" at ~0.27 zoom — no per-card promotion and bounded raster memory; (b) sheet/menu open and close — no full-screen blur repaint (the 44 px launcher and its menu are the only live blur rules); (c) cold and warm Home → 1,000-entry book → entry open, scroll and 50-char typing; (d) Hero first draw, card tap, and inspector with chat state off/on; (e) a real background tab/app switch; (f) live ST boot/drawer open, heap after settling and real chat-state badges.
- **Record:** median and p95 frame gaps, dropped frames, worst frame, long-task total, `LayerTree` layer count, raster/GPU memory, DOM nodes and retained heap after settling. The `firstRowMs`/ST-host half stays under §7.5.

Practical rule: if a change needs a layout read (`getBoundingClientRect`, `scrollHeight`, `getComputedStyle`) inside a pointer move, it is not ready for animation.

**Source.** Astra animation preparation; Qwen animation checklist; DeepSeek #10.

---

## 7. Verification plan

### 7.1 Fixture and isolation

- Use a disposable ST profile or an in-memory harness. Never seed a real library.
- `e2e/perf-harness.mjs` is the disposable fixture: `?perf=1` in `e2e/desktop/harness.html` seeds 41 synthetic books, a 1,000-entry book with a placed canvas, a 100 KB entry and a long chat in page memory and `localStorage` only. It needs no ST.
- `e2e/perf.mjs` still targets a real ST and creates 40 persistent Stress books; it now refuses to run without `PERF_ALLOW_SEED=1`, which is the promise that the profile is throwaway.
- The native harness is `tools/perf/`: generation, trackers, rebuild, clash (unique and shared vocabulary), collator, history and the behavior fingerprint. `npm run perf` / `npm run perf:smoke`.

### 7.2 Instrumentation

`src/ui/perf.js` is in place. Counters are always on and are plain integer increments; timing regions are opt-in via `perf.timing = true` and allocate nothing while off. Read them with `wihero.perf.snapshot()` / `reset()`.

- Counters: app renders, canvas renders, model builds, route computes (the engine's changed-link count), row mounts, serialized characters, save attempts, `settingsSaves`, history captures, real tokenizer calls.
- Timing regions: model, clash scan, sort, row mount, entry page, canvas draw, arrange, status, history, save.
- Layout/paint and heap stay in browser traces and heap snapshots; the harness cannot see them. `e2e/paint.mjs` is the committed CDP recorder for the layout/paint side: trace counts and `Performance.getMetrics` deltas for the windowed lists, Home, Explain mode and the Hero panel. `e2e/lifecycle-heap.mjs` (A4) records `Memory.getDOMCounters`, `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`, live `EventTarget` listeners by target kind and active `ResizeObserver`/`MutationObserver` counts across show/hide cycles and after `wihero.dispose()`. `wihero.library.stats()` (M2) reports working copies, summaries, pinned names, evictions and an estimated byte count; `e2e/memory.mjs` reads it beside a forced-GC heap.
- Remove the instrumentation after Phase 6 if it is no longer earning its counters.

### 7.3 Scenario matrix

- cold/warm Home; tap during loading; book selection;
- long-content typing; search during loading;
- pan/pinch; single/group drop; dot shaping;
- inspector toggles with chat state off/on;
- generation with the editor closed;
- repeated open/close and book switching;
- failed and overlapping saves.

### 7.4 Scales

- 150, 1,000, 3,000 and 5,000-entry books;
- sparse and dense graphs;
- large pack overlap;
- 40- and 100-book libraries;
- short and long chats.

### 7.5 Device evidence

- The weakest phone available, desktop, and throttled browser runs.
- Separate cold network from warm interaction.
- Report median and p95, long-task totals, worst task, frame gaps, DOM counts, and retained heap after settling.
- **A4 open evidence:** listener/observer/DOM/heap cycles and the low-zoom promotion counts are measured-native-browser in `e2e/lifecycle-heap.mjs`; raster/compositor memory, CDP `LayerTree` layers at low zoom, a real background tab or app switch, and an ST-host heap snapshot still need the weakest device. The harness counts promoted nodes with `getComputedStyle`, not compositor layers.
- **A5 open evidence:** device paint/compositor traces for A1's no-blur check and the promoted `.world` / large scenes at low zoom. The exact hardware run and scenarios are in §A5; `e2e/paint.mjs` records CDP counts, not compositor layers or raster memory.
- 6× CPU throttling is a comparison tool, not a substitute for mobile GPU/memory behavior.

### 7.6 Regression suites

- `node --test` for logic and engine semantics.
- `npm run perf:smoke` for the native harness's determinism/count assertions; `npm run perf` for the scale numbers.
- `e2e/perf-harness.mjs` for browser scenarios and long tasks (no ST); `e2e/perf.mjs` for the same against a throwaway ST, with `PERF_ALLOW_SEED=1`.
- `e2e/paint.mjs` for the CDP layout/paint recording (no ST) of the windowed lists, Home refresh, Explain mode and the Hero panel.
- `e2e/motion.mjs` for A3's reduced-motion computed styles and the hidden-page pause (no ST): CDP emulated media, a `visibilityState` shim, parked app/canvas draws with one catch-up, and a canvas pan/card edge gesture that stops and does not resume. `test/page-motion.test.js` for the hidden/reduced helper with injected DOM.
- `e2e/boot.mjs` for L1's boot boundary (no ST): no editor module or `app.css` at boot, one chunk load on the drawer open, the idle prefetch, a fast open/close and a failed import; `tools/boot-graph.mjs` for the measured-native module/byte split.
- `e2e/memory.mjs` for the M2 heap plateau, summary-only Home and the dirty/undo eviction proof (no ST).
- `e2e/lifecycle-heap.mjs` for A4 (no ST): ten show/hide cycles on the 500-card Hero canvas with forced-GC heap, DOM nodes, live listeners by target kind and active observers; the low-zoom promotion policy; and `wihero.dispose()` removing the host, listeners and observers with destroy terminal. `test/lifecycle.test.js` pins the disposal registry.
- `tools/link-bench.js` for routing.
- `test/history.test.js`, `test/book-write.test.js`, `test/st-books.test.js`, `test/library-lifecycle.test.js` for save/history behavior.
- `test/cheap.test.js` for clash semantics.
- `test/ui.test.js`, `test/html.test.js`, `test/pieces.test.js`, `test/engine.test.js`, `test/trackers.test.js` for UI/engine changes.
- `e2e/n2.mjs`, `e2e/tiles.mjs`, `e2e/polish.mjs`, `e2e/mobile-edit.mjs`, `e2e/sizing.mjs`, `e2e/host-saves.mjs`, `e2e/drawer.mjs`, `e2e/lifecycle.mjs`, `e2e/trackers-real.mjs`, `e2e/explain` for the relevant surfaces.
- `tools/st-drift.mjs` is unaffected.

### 7.7 PR reporting

- Record the JSON lines and the before/after table in the commit message or PR description for each optimization commit.
- Update §2 and §5 in this document in the same commit.
- Start with reporting; add a CI gate only once a metric is stable.

---

## 8. Risks and things not to do

- **Do not debounce `history.take()` alone.** You lose the pre-edit state or merge actions that must remain separately undoable. Use transactions/patches.
- **Do not memoize `normalize` without cloning at mutating callers.** `pieces.js` `bookEditor` mutates the returned config in place.
- **Do not remove save baselines, concurrency comparisons, or pending-native-save synchronization** for speed. They protect overlapping native and extension edits.
- **Do not virtualize Normal lists before keyed rows and delegation.** Focus, scroll, selection, and accessibility break in ways that are hard to debug.
- **Do not move link routing to a Worker before measuring transfer.** Initial routing is 47–214 ms for 120–500 cards, but DOM rebuild may dominate; a Worker adds serialization and stale-result handling.
- **Do not animate layout properties or promote every card.** Keep `will-change` temporary.
- **Do not drop greeting fingerprints or ordinary ST fields from model inputs** to improve cache hits.
- **Do not change clash semantics to plain substring matching.** “miller” must not clash with “mill”; the tests pin this.
- **Do not rewrite the canvas into WebGL as the first move.** Existing DOM/SVG offers text, focus, and interaction behavior that would be expensive to replace.
- **Do not put `contain: paint` on `.card`.** Sticky notes sit above the card box and would be clipped.
- **Do not trust 6× as a phone prediction.** Measure the weakest device when possible.
- **Do not seed a real library with performance fixtures.**
- **Do not assume lazy-loading the editor fixes jank once it is open.** It is a launch win, not a pan/typing win.
- **Do not bypass ST’s settings save.** Measure `saveSettingsDebounced` first.
- **Do not remove offscreen obstacles from the routing model when culling.** They still affect routes; only rendering is culled.
- **Do not cache solely by mutable object identity.** Use a revision or a stable identity.
- **Do not assume capping a textarea reduces its per-key text layout.** `max-height` bounds the box and the page, but the browser still lays out the whole 100 KB value on each input; only a windowed editor removes that, and it is out of scope here (G2).
- **Do not judge typing on a sustained 20 ms/key burst alone.** At that rate the main thread cannot drain between keys and the measurement includes V8 mark/sweep on the native text control; keep a realistic 150 ms/key gate and the 20 ms burst as a stress label (G2).
- **Do not evict a working copy that anything still needs.** Open books, dirty or failed saves, a save in flight, a running book action, a reserved name, an unfinished load and any book with undo/redo states must stay; only clean, unpinned copies may go (M2).
- **Do not measure or re-update retained rows inside a window's scroll frame.** Mount at the measured row height and let the ResizeObserver correct after layout; per-new-row `getBoundingClientRect` and a row update of the whole mounted window turn a fling into long tasks (G3).

---

## 9. Open questions and assumptions

Because there is no target device, the plan assumes the weakest denominator and keeps fallbacks for every modern API. Resolve these as the work lands:

1. **Typical book shape.** Entries per book, distinct keys, multi-word keys, Moments, placed cards. The clash fix matters most for multi-word keys; the sort fix matters for A–Z users. Benchmark 150/1,000/3,000/5,000 entries.
2. **Tokenizer setting.** Local or remote. If remote, T0 is a network cost as well as CPU; cache regardless.
3. **Is A–Z used in practice?** The fix is cheap enough to do regardless.
4. **Animation plan.** CSS transitions vs JS/FLIP, and which surfaces (lists, cards, sheets, inspector). The retention work should be scoped to those surfaces.
5. **`saveSettingsDebounced` behavior in the target ST.** Confirm the debounce interval and payload before changing T2.
6. **Hero vs Normal order.** The plan puts Hero (Phase 3) before Normal (Phase 4) because Hero is smaller and V1 unlocks both. Swap them if large-book navigation is the dominant complaint after Phase 0.
7. **Harness location.** Vendor the #48 benchmark harness under `tools/perf/` unless there is a reason to keep it external.

---

## 10. Appendices

### A. Provenance

This plan consolidates the three earlier passes:

| Plan area | Astra6 | Qwen4 | DeepSeek-Flash |
|---|---|---|---|
| Baseline/instrumentation | Verification plan | Measurement appendix | Acceptance targets |
| Clash scan | — | — | #1 |
| A–Z collator | — | — | #2 |
| Hidden panel | #4 | F9 | — |
| Token count | — | — | #4 |
| Save path | #8 | F6 | #5 |
| History | #1 | — | #8 |
| Hero per-draw | #2, #6 | canvas notes | #3 |
| Normal retention | #3 | F3, F7 | #7 |
| Memory/loading | #5 | — | #8, #9 |
| Search | #7 | F8 | #9 |
| Lazy editor | #9 | F1 | #11 |
| Blur/paint | Animation prep | F2, F14, F15 | #10 |
| Small wins | #9 | F4, F5, F10–F13, F16 | #6, #12 |

The three source notes are superseded by this document and have been removed.

### B. Measurement recipes

- **Clash:** `tools/perf/bench-clash.mjs` plus `bench-clash-cold.mjs`. Shapes: unique multi-word keys, shared five-word keys, and shared mixed 1–3 word keys (the one that forms groups). Report cold (a fresh process, and a fresh salt), warm and cached. The cold tail is the user-visible number; a warm-only figure hides it.
- **A–Z:** `tools/perf/bench-collator.mjs`, which runs the old comparator and `sortEntries` side by side on the same titles at 150/500/1,000/3,000.
- **History:** `tools/perf/bench-history.mjs`; one character per change, median and p95 with the sample count, plus serialized size.
- **Link routing:** `node tools/link-bench.js` and a fresh `createLinkEngine()` per sample; time `layout(defs)` after setting obstacles.
- **Generation/trackers/rebuild/behavior:** `tools/perf/` (`bench-generation.mjs`, `bench-trackers.mjs`, `bench-rebuild.mjs`, `behavior.mjs`); `npm run perf`.
- **Browser:** `e2e/perf-harness.mjs` at 6× CPU, 390×844, disposable profile; `--rate 1` for native. `e2e/perf.mjs` is the same shape against a throwaway ST when one is available. The entry-open step carries `wihero.perf` deltas, so an attribution is recorded with the timing. The typing step focuses the entry, puts the caret at the end (setup outside the measured window) and types 50 characters at 150 ms/key; `e2e/typing.mjs` keeps the 20 ms burst as a labelled stress case. A CDP `devtools.timeline` trace of ten keys gives the JS/Layout/Paint/`TaskDuration` split in §2.3 G2.
- **Device:** the weakest phone available; paint flashing/compositor traces; heap snapshots after settling.

### C. PR #48 summary

- Commit `f7f84e8`: lazy hashing, narrower model signature, `readWrote`/`slotValues`, `view()` sharing, `keywordOnSide`, panel deferral, sticky hashing.
- Full suite: 325 passed, 0 failed, 7 skipped.
- Behavior comparison: identical hash (`897800cddace9896`) across four synthetic scenarios.
- This plan is the second commit on the same PR.

### D. Deferred / out of scope

Measure before committing to these:

- Worker-based link routing or culling; needs serializable scene inputs, revision-tagged requests, stale-result rejection, and route-order preservation.
- WebGL canvas rewrite; the DOM/SVG interaction model is valuable.
- Full Normal virtualization before N1–N3.
- Moving save-path JSON work to a Worker; may add another full structured clone unless ownership changes.
- Canvas render’s double `JSON.stringify(mem)`; small, revisit with V5.
- `barAct` trial clone + two `buildModel` calls; discrete user actions, fine.
- `waitTime` chat index; only if long-chat profiles show it.
- Preview scan windows; only if profiles show it.
- Forced-rider `sortedEntries.find` map; narrow.
- `packMembers` index; only if profiles show it.
- `tokenGuess`; keep it length-based.
- Root-level `:has()` selectors; fine on modern engines, but know they invalidate broadly.
- A dedicated “Reduce motion” setting; consider after A3.

### E. Key files

- Engine: `src/engine/model.js`, `src/engine/turn.js`, `src/engine/state.js`, `src/engine/written.js`, `src/engine/rows.js`, `src/timers.js`, `src/st-hooks.js`.
- Perf: `src/ui/perf.js` (counters and timings), `tools/perf/` (native harness), `e2e/perf-harness.mjs` (disposable browser profile), `docs/optimization-pass/baseline/` (recorded JSON).
- UI shell: `src/ui/app.js`, `src/ui/normal.js`, `src/ui/desk.js`, `src/ui/window.js`, `src/ui/hero-shell.js`, `src/ui/canvas.js`, `src/ui/canvas-input.js`, `src/ui/link-engine/index.js`, `src/ui/entry-page.js`, `src/ui/history.js`, `src/ui/st-books.js`, `src/ui/book-write.js`, `src/ui/data.js`, `src/ui/clashes.js`, `src/ui/menus.js`, `src/ui/pieces.js`, `src/ui/show-in-chat.js`, `src/ui/icons.js`, `src/ui/dom.js`, `src/ui/preview.js`, `src/ui/canvas-graph.js`.
- Entry/panel: `index.js`, `src/panel.js`, `src/bubble.js`.
- Styles: `src/ui/app.css` (or the built `app.css`), `style.css`.
- Tests/harnesses: `test/`, `e2e/`, `tools/link-bench.js`, `tools/st-drift.mjs`.

### F. Status log

| Date | Commit | Work | Notes |
|---|---|---|---|
| 2026-11-22 | `f7f84e8` | #48 engine hot paths | 325 pass, 0 fail, 7 skipped; behavior hash identical |
| 2026-11-22 | this commit | Plan | Replaces the three source notes; single source of truth |
| 2026-11-22 | this commit | H1 clash scan | Token index + revision cache; 1,000 × 4: 1,151 ms → 12.9 ms warm, cached ~0; 327 pass, 0 fail, 7 skipped |
| 2026-11-22 | this commit | H2 A–Z collator | Shared collator + decorate-sort; 1,000 entries: 61.8 ms → 3.0 ms; 328 pass, 0 fail, 7 skipped |
| 2026-11-22 | this commit | A1 + A2 blur/transform | Removed live backdrop blur and the unused `--blur`; switch animates transform; paint trace pending |
| 2026-11-24 | this commit | B0 native harness | `tools/perf/` rebuilt from the recipes; 52 measurements; behaviorHash `33c034aef964c242`; shared-vocabulary clash measured |
| 2026-11-24 | this commit | B0 browser fixture + instrumentation | `?perf=1` disposable profile; `e2e/perf-harness.mjs`; `src/ui/perf.js` counters/timings; `e2e/perf.mjs` seed guard |
| 2026-11-24 | this commit | B0 baseline | 17 steps at 1× and 6×; entry open 15.8–17.5 s at 6×, 96% clash scan; H3 opened; budgets unchanged |
| 2026-11-25 | this commit | H3 clash cold path | Phrase enumeration; cold 149–157 ms → 34.8–37.5 ms, warm shared 147–159 → 10.9 ms; entry open 6× 15.8–17.5 s → 0.65–1.05 s, worst 0.28–0.49 s; entry-page gate remains |
| 2026-11-25 | this commit | C2 + C9 | Issues grouped once per model; Moments cached per book revision; 336 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | C3 + C6 | normalize cached per raw (buildModel rereads); choices cached and invalidated before redraw; 343 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | C4 + C5 | Icon templates cloned in rows/cards; tone cached per theme change; 343 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | C7 + C8 | Home sort keys decorated once; book → links index cached and invalidated; 350 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | C10 | Row containment landed as an intermediate; scroll counters unchanged (0 layouts, 9–11 recalcs); paint trace pending |
| 2026-11-25 | this commit | T0 | Token count cached per text, deferred 1200 ms or flushed on blur, skipped when hidden/dead; 358 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | T1 + T2 | Save bases as JSON, one payload clone, adaptive 350→1000 ms; one settings save per save; 5,000-entry save 157 → 91 ms; 363 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | T3 | Quiet runs capture at the ends only; 1,000-entry keystroke 2.83 → 0.01 ms; 12 MiB global budget; 368 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | T4 + T5 | Hider memo + one queue per task; field-sizing with a tested rAF fallback; 371 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | V1 | Per-book revisions for model, clash, Moments, canvasSig and checks; history stays global; 376 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | V2 | Entry-side signature built with the model, 0.58–0.90 ms per Hero draw; content edits keep the canvas; 382 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | V4 + V5 | Overlay(null) no-op; relink uses per-link node maps; 382 pass, 0 fail, 7 skipped |
| 2026-11-25 | this commit | V3a | Keyed tab reconciliation, late-bound handlers, retained `.tright`; e2e tabs 5 ok |
| 2026-11-25 | this commit | V3b | Piece bar retained per canvas; arm/fold update in place; tone cache invalidated on CSS load; e2e pbar 1, drawer 10, review 10 |
| 2026-11-25 | this commit | V3c | Panel and inspector shells retained per book/selection; detached reattach; e2e chrome 5, desktop 51, drawer 10, review 10, explain 26, pbar 1, tabs 5 |
| 2026-11-25 | this commit | V6 | Status patched on retained cards: classes, line, badge, Moment tag, nav dot; e2e badges 6, canvas-sig 5 |
| 2026-11-25 | this commit | N1a | Book page view and rows keyed by uid; scroll/focus/selection survive; e2e normal-rows 6 |
| 2026-11-25 | this commit | N1b | Home view and rows/tiles keyed; counts survive; e2e home-rows 6 |
| 2026-11-25 | this commit | N2a | Phone row gestures delegated to main; e2e delegate 11 |
| 2026-11-25 | this commit | N3a | Desktop list kept across selection/pane changes; e2e desk-pane 7 |
| 2026-11-25 | this commit | N2b | Desktop Home rows/tiles, .brow rows, folder heads and both search lists delegated; CDP 0 per row, 10 `.dhome`, 11 `.bllist`, 3 `.dsres`, 7 `main`; 382 pass, 0 fail, 7 skipped; e2e delegate-desktop 19 |
| 2026-11-25 | this commit | N3b | Phone book `.view`, rows, scrollTop and focus kept while an entry is open; entry drawn in a second `.view`; Back 0 `rowMounts` (980 before), 1 `appRender`; 382 pass, 0 fail, 7 skipped; e2e entry-pane 6, normal-rows 6, home-rows 6, delegate 11, delegate-desktop 19, desk-pane 7, desktop 51, tabs 5, chrome 5 |
| 2026-11-25 | this commit | N4a | Phone book list windowed: 33 rows at the top, 51 mid, 33 at the bottom (980 before), 369 DOM nodes in the view, full 53,186 px scroll; refresh and Back 0 new row mounts; focused off-screen row pinned until blur; folder fold 31 → 0 → 31; 389 pass, 0 fail, 7 skipped; e2e window 12, normal-rows 7, entry-pane 6, delegate 11, delegate-desktop 19, home-rows 6, desk-pane 7, desktop 51, tabs 5, polish 10, cheap 12 |
| 2026-11-25 | this commit | N4b | Window code shared (`src/ui/window.js`); desktop `.bllist` mounts 31 rows / 237 list nodes / 31 rowMounts (980 before) with 31,376 px scroll; bottom 28, middle around 490; `aria-setsize` 980 / `aria-posinset`; Arrow across an unmounted selection; focused Order input pinned (47 rows); settled refresh 0 rowMounts (45 rows at 600 px); filter 1 → rebuilt 1 → cleared 28; folder 29 → 0 → 26; drag reorder and drop on a visible folder head; N3a identity kept (34 rows); 389 pass, 0 fail, 7 skipped; e2e window-desktop 14, window 12, desk-pane 7, delegate-desktop 19, desktop 51, normal-rows 7, entry-pane 6, home-rows 6, tabs 5, cheap 12, polish 10, drawer 10 |
| 2026-11-25 | this commit | N5 | `e2e/paint.mjs` CDP recorder; `content-visibility` on `.item.ent`/`.brow` and `.prow` trialled and rejected (desktop Paint 974 → 497 but layouts 31 → 41; 6× scroll task 1,408 → 1,594 ms phone and 989 → 1,128 ms desktop; `.prow` scroll Paint 22 → 286, task 312 → 391 ms); CSS reverted; 382 pass, 0 fail, 7 skipped; e2e window 12, window-desktop 14, explain 26, desktop 51, normal-rows 7, home-rows 6, entry-pane 6, desk-pane 7 |
| 2026-11-25 | this commit | M1 + M3 | Shared loader (`src/ui/loader.js`) over `library.get`: foreground ahead of three background reads, queued promotion, cancel drops queued counts and bumps a generation; Home spans cleared on leave/replace; 13-book slow-read harness: 3 started / 10 queued, tap starts next and opens with 9 uncounted, 0 counts start after leaving, return reloads all 13 with no duplicate read; 396 pass, 0 fail, 7 skipped; e2e load-priority 5, home-rows 6, desktop 51, tiles 6, normal-rows 7, window 12, window-desktop 14, desk-pane 7, delegate 11, perf-harness 17 at 1× |
| 2026-11-25 | this commit | M2 | Per-book summaries (visible count, total, tokens, revision) answer Home with no read; stale after a change and computed lazily; clean copies LRU-capped at 8 with open/dirty/saving/failed/operation/reserved/loading/history pins; eviction after read/save keeps revisions, `seeded` and settings; `stats()`; browser heap plateau over 10 Home↔book cycles: 8 copies, 41 summaries, evictions 33→43, 317 KiB growth over the last five cycles, summary-only Home redraw 0 reads; dirty copy and undo survive eviction; 412 pass, 0 fail, 7 skipped; e2e memory 8, load-priority 5, home-rows 6, window 12, window-desktop 14, desk-pane 7, desktop 51, normal-rows 7, entry-pane 6, tiles 6, delegate 11, mobile-edit pass, lifecycle pass, perf-harness 17 at 1× |
| 2026-11-25 | this commit | M4 | Search scans per-revision lowercase corpora and no longer loads the library on open: 0 reads on open, 3 of 7 named "not searched yet", Search all books 3 bounded background reads updating the open overlay, close drops the queue (3 in flight, 0 new); 10-key burst = 1 run, 0 rebuilds; one character at 6× scans 9.1–12 ms with no task over 50 ms (1× 1.9–3.8 ms); perf-harness search typing 746 ms at 1× and 1,236 ms at 6× (B0 3.57–3.79 s), worst task 109 ms (B0 1.68–1.93 s), 5 runs / 41 builds; ranking equals `data.search`; 420 pass, 0 fail, 7 skipped; e2e search 10, load-priority 5, home-rows 6, window 12, window-desktop 14, desk-pane 7, desktop 51, tiles 6, delegate-desktop 19, cheap 12, entry-pane 6, memory 8, perf-harness 17 at 1× and 6× |
| 2026-11-25 | this commit | L1 | `index.js` no longer statically imports `src/ui/app.js`; the editor chunk loads on the drawer's first open or a queued book, with an idle prefetch ~3 s after boot, a `#wihero-loading` placeholder, `wihero.ready`/`app` surface, drawer tickets and a failure fallback that restores ST's drawer; measured-native boot graph 70 modules / 1,196.2 KB → 29 / 293.8 KB eager + 42 / 909.7 KB deferred (71 total); boot page: 0 editor requests and 0 `app.css` at boot, exactly one `app.js` + one `app.css` on open, Home row 159–244 ms over five runs, prefetch loads with the drawer closed, fast open/close leaves no `wihero-under`, failed import restores ST's drawer; 429 pass, 0 fail, 7 skipped; e2e boot 6, desktop 51, desk-pane 7, window 12, window-desktop 14, home-rows 6, normal-rows 7, entry-pane 6, search 10, memory 8, load-priority 5, tabs 5, chrome 5, pbar 1, delegate 11, delegate-desktop 19, badges 6, canvas-sig 5, drawer 10, lifecycle 3, perf-harness 17 at 1× |
| 2026-11-25 | this commit | A3 | Reduced motion now covers shadow-tree pseudo-elements and the eager `#wihero-loading`; a `visibilitychange` listener owned by the lazy editor toggles `data-paused` (CSS animations paused, transitions off), parks app draws (one catch-up on visible, nothing dropped), and pauses the canvas's view/live/flash/gesture/camera and drag/edge/hold/hover timers while keeping+saving the camera or card/shape a gesture reached; missing visibility API = visible; 435 pass, 0 fail, 7 skipped; e2e motion 13 (CDP reduced media, fake visibility, app/canvas draws 0 hidden → 1 on return, pan camera saved and still, edge loop cancelled and not resumed), pbar 1, controls 23, tabs 5, badges 6, canvas-sig 5, desktop 51, delegate 11, delegate-desktop 19, window 12, home-rows 6, search 10; A4/A5 remain |
| 2026-11-25 | this commit | A4 | One terminal `destroy()`/`wihero.dispose()`: page-motion and window listeners, theme `MutationObserver`, app `ResizeObserver`, canvas timers/rAFs/listeners/away listeners/node indexes, retained list windows, panel/piece-bar/inspector shells, desk mount, explain observer and layer; `hide()` drops gesture classes, promotions and away listeners; retained-bar `ResizeObserver` leak fixed; 676 cards at zoom 0.268 with 0 promoted and `.world` promoted only during a gesture; 10 show/hide cycles at 12,128 DOM nodes, 48 listeners, 5 observers, 86 KiB heap growth over the last five, destroy 48 → 14 (13 Playwright + harness button) and terminal; 440 pass, 0 fail, 7 skipped; e2e lifecycle-heap 8, motion 13, memory 8, boot 6, desktop 51, desk-pane 7, window 12, window-desktop 14, home-rows 6, normal-rows 7, entry-pane 6, search 10, load-priority 5, tabs 5, chrome 5, pbar 1, delegate 11, delegate-desktop 19, badges 6, canvas-sig 5, controls 23, shape 11, perf-harness 17 at 1×; A5 item 6 remains |
| 2026-11-25 | this commit | A5 | All 26 active CSS motion declarations audited; five transition declarations fixed off layout/background (`.switch::after` background, `.modebtn` background/border, `.panelBtn` `left`→transform, `.colresize::after` background→opacity, `.dropcancel` background) plus `.switch.sm.on::after` `left`→transform; one paint-only exception (`.toast .ttimer rect` `stroke-dashoffset`); no transition/animation names left/top/width/height/margin/padding/background. Checklist: items 2/3/5 met, item 4 not met, items 1/6 device-only. 6× A5 table: entry open 286/192 (clash 95.1, entryPage 122.8), typing 8,105/443 with 50 tasks, scroll 1,236/111 with 12 tasks, Hero open 5,346/4,649, tap 1,359/606, pan 7,323/540 with 10 tasks; 440 pass, 0 fail, 7 skipped; e2e motion 13, controls 23, tabs 5, pbar 1, chrome 5, desktop 51, window 12, window-desktop 14, normal-rows 7, entry-pane 6, desk-pane 7, search 10, memory 8, lifecycle-heap 8, boot 6, badges 6, canvas-sig 5; perf-harness 17 at 6×; device paint/compositor and ST-host evidence remain |
| 2026-11-25 | this commit | G1 | Entry open no longer scans for keyword clashes: a book-page draw warms the per-revision cache only after a 700 ms quiet timer, and a pointer/wheel/scroll/key in the book view restarts it; another page/book or `dispose` cancels it; `renderEntry` reads it with `cachedClashes`, and a cold page draws unmarked then patches the new keys/marks in place (Back detaches and cancels the patch); attribution showed the scan (clash self 55.7 + spans 26.8 + norm 14.5 + keyed 4.1 + GC 51.4) nested inside the old `entryPage` 122.8–142.3 ms; after, entry open is 82–85 ms worst over three 6× runs (`clashScan` 0, `entryPage` 18.1–24.6; native 0 long tasks, 80–83 ms, `entryPage` 7.2–7.6), book open has no scan (one pre-existing long task, 212–259 ms) and scroll stays 100–139 ms / 12 tasks with no scan; the warm itself still costs ~95–130 ms when it runs after quiet (chunking or warming only from entry pages/menus remain options); 441 pass, 0 fail, 7 skipped; e2e entry-open 5, normal-rows 7, entry-pane 6, desk-pane 7, cheap 12, desktop 51, window 12, window-desktop 14, search 10, delegate 11, delegate-desktop 19, tabs 5, badges 6, sizing pass, perf-harness 3 runs at 6× and 2 at 1×; typing/scroll/Hero gates remain |
| 2026-11-26 | this commit | G2 | Entry box capped at `min(70vh, 800px)` with internal scroll (fallback capped too); token guess no longer written per key (2 → 1 layout/key), `feed()` removes the per-key Promise/100 KB hash, and a quiet history run captures its final state at the boundary instead of the first key (history 26.5 → 5.1 ms / 10 keys); typing step now starts at the end (setup unmeasured) at 150 ms/key, with the old 20 ms burst kept as a stress label; 6× gate worst **50/79/50 ms** over three runs (1–2 tasks, 1 token call; before 384 ms / 50 tasks), 1× 0 tasks; 20 ms stress 155–192 ms / 2–3 tasks (browser line layout + V8 GC); middle-of-paragraph inserts remain browser-bound; 443 tests, 436 pass, 0 fail, 7 skipped; e2e typing pass, sizing pass, normal-rows 7, entry-pane 6, entry-open 5, cheap 12, desktop 51, window 12, window-desktop 14, search 10, delegate 11, tabs 5, badges 6, motion 13, mobile-edit pass, perf-harness 3 runs at 6× and 2 at 1× |
| 2026-11-26 | this commit | G3 | Scroll frames stop measuring and re-updating: the window measures only on a paint/reveal (`draw(true)`), a scroll draw mounts rows at the measured 56 px estimate and takes the ResizeObserver's `borderBoxSize` after layout (gaps unobserved, first sighting equal to the estimate not dirty), `keyed` drops removed nodes before placement and skips retained-row updates on a scroll draw, gap heights are set once per range, and overscan is 0.5 screens (phone 19/26/19 rows, desktop 23/32/21). Before 12 long tasks / 1,158 ms / worst 158 ms (trace: 14 / 1,255 / 119.7; JS 24–62.6, Layout 12–37, Paint 8.8–41.9); after **0 long tasks / 0 ms worst over three settled 6× runs** (631–648 ms step; trace 50.1–50.9 ms: JS 11–13, Layout 10.7–13, Paint 11.4–12.9), 1× 0/0 with a 555 ms step; counters 10 draws / +105 −97 rows / 9,800 scan items / 0 rect reads / 0 observer changes / 0 gap passes; phone `scrollHeight` 55,080 px from the first frame (was 53,186 → 53,292), desktop 31,376 unchanged; book open 210–245 ms and entry open 71–84 ms at 6× (no regression); 443 tests, 436 pass, 0 fail, 7 skipped; e2e scroll 9, window 12, window-desktop 14, entry-pane 6, normal-rows 7, desk-pane 7, entry-open 5, typing pass, search 10, desktop 51, home-rows 6, delegate 11, delegate-desktop 19, tabs 5, badges 6, motion 13, perf-harness 3 runs at 6× and 2 at 1× |
| 2026-11-26 | this commit | G4 | Show chat state patches both ways (chat state leaves `canvasSig`; the retained view patches a null status off and keeps its cached state current); pack-member Sets compare by value, so unchanged frames no longer reroute links; `placeNew` uses a spacing grid; the first fit runs before cards are inserted; a first draw with 200+ links paints cards/ports then routes and draws the links 120 ms later in 40-link batches (cumulative defs); a wheel zoom no longer promotes `.world` (pan/pinch keep it); a phone tap runs reveal before the focus classes and the dim keeps its fade only on `.lit`. At 6× (three runs): Hero open **2,516 ms / worst 1,670** (before 5,346/4,649; native 571–661 / 270–350), tap **1,048 / 517** with 0 draws and 0 routes (before 1,359/606; native 165/0), pan (wheel zoom) **1,003 / worst 90 over 11 tasks** (before 7,323/540/10; native 798/0, 0 draws/routes), Show chat state **1,682 / 693** with 0 draws/routes (before 3,706/2,570), inspector off 964/197, inspector on 925/289; counters open 1 draw / 320 routes (deferred) / arrange 830 → 207 ms; chat toggle 1 draw + 320 routes → 0/0, status 143 ms patch; first card usable before the link fill, `e2e/hero-perf.mjs` waits for it. Tap and wheel-zoom targets are still not met (focus dim style/paint; per-step re-raster); budgets unchanged. 444 tests, 437 pass, 0 fail, 7 skipped; e2e hero-perf 5, canvas-sig 5, badges 6, chrome 5, pbar 1, controls 23, shape 11, desktop 51, drawer 10, review 10; perf-harness 3 runs at 6× and 2 at 1× |
