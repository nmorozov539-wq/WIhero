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

**N2a — phone row delegation (`src/ui/dom.js`, `src/ui/normal.js`).** One `delegatePress(root, resolve)` on `main` replaces `pressable` on Home rows/tiles and Normal entry rows: 480 ms long press, 8 px cancel, `pressing`, button/check skip, click swallow and contextmenu, resolving the row's live book/uid at event time. Switch/more/order buttons keep their own listeners. Desktop `.drow`, search results and sheet rows stay on `pressable` for now.

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

**Budget read (§4.2).** Gates are unchanged. Measured against them: A–Z passes its microbench gate (1.74 ms native ≈ 10 ms at 6×; the e2e step includes menu navigation and a full redraw, so it is not the gate signal). Entry open and book open fail both gate and target by an order of magnitude. Typing's worst task (0.27–0.29 s) fails the 100 ms gate; its 50 long tasks are the real signal. Hero card tap is 1.5 s end-to-end (inspector included), so it does not yet isolate the <16 ms JS/frame budget. **H3 is the next P0.** No target is relaxed on the strength of this baseline.

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

B0 recorded the baseline in §2.4 and left every gate and target in place: the gaps are large enough that adjusting budgets would hide the work, not describe it. The A–Z gate is a microbench gate — the e2e A–Z step includes menu navigation and a full redraw. Hero tap and typing gates need the attribution steps noted in §2.4 before they can be judged.

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
| 0 Baseline | ◐ harness, instrumentation and baseline JSON landed; budgets read (§2.4); device paint/heap traces outstanding |
| 1 Hangs + cheap wins | ◐ H1 + H3 landed (clash scan fixed); entry-open gate now on entry-page render, not the scan; H2, A1, A2, C1–C9 landed; C10 is a measured intermediate with no scroll-counter change and its paint trace/device evidence outstanding |
| 2 Typing path | ◐ T0–T5 landed; ST-host save/history evidence and the T3 patch-level follow-up outstanding |
| 3 Hero per-draw | ✅ V1–V6 landed (ST chat-state e2e still unrun) |
| 4 Normal retention | ◐ N1a/N1b keyed rows, N2a phone delegation, N3a desktop pane landed; N2b, N3b–N5 pending |
| 5 Memory/loading/search | ☐ |
| 6 Launch/animation readiness | ☐ |

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
| 15 | N1 keyed rows, N2a phone delegation, N3a desktop pane (landed); N2b/N3b pending |
| 16 | N4 + N5 windowing and `content-visibility` |
| 17 | M1 + M2 + M3 loader, eviction, counts |
| 18 | M4 search |
| 19 | L1 lazy editor |
| 20 | A3 + A4 + A5 animation readiness |

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

**Status.** ◐ Intermediate. The rule is in, and explain mode (26 checks), desktop (51) and tiles (6) pass with no clipped outlines. But a CDP counter run at 6× on the 1,000-row book showed no scroll difference: 0 layouts and 9–11 style recalcs with containment on or off. The paint/trace half of the done condition is therefore not met; keep it as a low-risk intermediate for N5, not as a claimed win. Scroll anchoring and in-page find still need a manual check.

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

**Status.** Landed. `test/token-count.test.js` pins open caching, deferred input, rapid-input replacement, flush/in-flight sharing, hidden and inactive skips, failure not caching, and the cap. `e2e/perf-harness.mjs` still records one call on entry open and one for the 50-character burst (the step waits out the 1200 ms idle). The cache is per page render, so a mask switch starts a new one; repeat opens of the same text within a page are free.

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

**Status.** Landed for the run boundary and the budget. `test/history.test.js` adds: 40 quiet changes capture ≤3 times and undo/redo restore the ends; a pause splits; non-quiet and redraw boundaries; `held`; external reset; and budget eviction/accounting (including undo, redo, forget, rename). `e2e/mobile-edit.mjs` passes; ST-only history e2e is still unrun. Patch-level storage remains deferred; the pre/final whole states are bounded by the 12 MiB budget.

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

**Status.** Landed. `e2e/sizing.mjs` forces `CSS.supports('field-sizing', …)` false before page scripts, opens the 100 KB entry, and checks a measured first-frame height and growth on input; `e2e/mobile-edit.mjs` passes on the native path. A throttled-phone typing trace is still outstanding.

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

**Status.** Landed. `e2e/badges.mjs` changes the harness state (fired, closed, holding, Moment status) and checks the same card node and no new `canvasRenders`; toggling Show chat state draws exactly once off and once on. A real-ST chat is still the missing evidence: the harness state stub is not an engine.

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

**Status.** ◐ N2a landed for the phone Home/book lists: `e2e/delegate.mjs` covers tap-open, long-press background tab with click swallowed, 8 px cancel, `.more`, switch-not-opening, select mode and the 1,000-entry book. Desktop `.drow` and search results still allocate per-row listeners (N2b).

**Risk.** Medium. Migrate one surface at a time (book list first); keep `pressable` for sheets/menus until proven.

**Source.** Qwen F7; DeepSeek #7.

#### N3 — Separate the entry pane from the list (P1)

**Why.** Desktop entry selection leads back into the app renderer; the whole page is replaced to show a different entry.

**Change.** Keep the list mounted and update only the selection and the right pane. Preserve scroll position and focus.

**Done when.** Selecting an entry does not recreate the list; the pane updates; focus stays sensible.

**Status.** ◐ N3a landed for desktop/narrow drawers: `e2e/desk-pane.mjs` keeps the list, rows, filter and scroll while selecting another entry, opening Book settings, switching single/multi and swapping panes in a 600px drawer; a filter change rebuilds the list intentionally. Phone Normal still replaces its page for an entry (N3b).

**Risk.** Medium.

**Source.** Astra #3.

#### N4 — Window long lists (P1/P2)

**Why.** `normal.js:125` and the desktop book list materialize every shown entry, so DOM memory and layout scale with book size.

**Change.** Window with overscan, keeping selection/order in the data model. Preserve keyboard navigation, folder headings, variable row heights, scroll-to-entry, drag/drop, and screen-reader behavior. Keep a selected or focused row mounted outside the window if needed. Do not virtualize until N1–N3 are in place.

**Done when.** A 1,000-entry book scrolls smoothly; focus/scroll/selection/drag/a11y survive; DOM node count is bounded.

**Risk.** Medium–large. Test scroll anchoring, in-page find, and explain-mode outlines.

**Source.** Astra #3; DeepSeek #7.

#### N5 — `content-visibility` as a measured enhancement (P2)

**Why.** After keyed rows, long lists can skip rendering offscreen rows.

**Change.** Test `content-visibility: auto; contain-intrinsic-size: auto 54px` on `.item.ent` (60px for book rows) for 500-entry books. Do not put `contain: paint` on `.card`; sticky notes sit above the card box. Keep C10’s `contain: layout style paint` on rows.

**Done when.** Scroll-to-top, scroll anchoring, explain-mode outlines, and in-page find still work; a trace shows less rendering work.

**Risk.** Medium — test the edge cases before keeping it.

**Source.** Qwen F15; DeepSeek #7.

---

### Phase 5 — Memory, loading, search

#### M1 — Shared loader with cancellation (P2)

**Why.** `app.js:266` queues Home counts through `library.get()`. `st-books.js:106` retains each loaded book in `copies` and a full cloned baseline in `bases`; there is no general clean-book eviction policy. `cacheSeen` may retain further clones after saves/events. The count queue is concurrency-limited but continues processing queued work without a current-view cancellation check. `countSpans` retains its last span per book. Three-at-a-time loading prevents a request flood; it does not bound eventual memory.

**Change.** Add a shared loader with foreground priority and cancellation of queued obsolete work. The current book loads ahead of remaining counts. Store small summaries separately from editable working copies. If ST cannot provide count metadata, compute summaries during a bounded read and release clean, unpinned extension copies afterward. Host caching may still retain data, so measure total memory too.

**Done when.** Opening a large library then leaving Home stops unnecessary queued work; the current book loads ahead; memory reaches a bounded plateau across repeated navigation.

**Risk.** Medium. Pin open books, dirty/failed saves, in-flight operations, and any state needed for undo.

**Source.** Astra #5; DeepSeek #8/#9.

#### M2 — Summaries, LRU eviction, and pinning (P2)

**Why.** Home and Search can eventually retain every listed book just to show counts. An LRU must never discard the user’s only unsaved copy.

**Change.** Keep small summaries (counts, names, folder, edited) separate from working copies. Evict clean, unpinned books with an LRU. Pin open books, dirty/failed saves, in-flight operations, and anything needed for Undo. Clear detached span references when leaving/replacing Home. Never evict the only unsaved copy.

**Done when.** Memory plateaus across repeated Home ↔ book navigation; unsaved edits and external merges survive eviction tests; heap snapshots, not just object counts, show the plateau.

**Risk.** Medium — pinning correctness.

**Source.** Astra #5; DeepSeek #8.

#### M3 — Cancel Home counts when leaving (P2)

**Why.** The count pump continues processing queued books after the user leaves Home; the count spans are no longer visible.

**Change.** Check the current view before each queued count; cancel obsolete work. Clear the retained span references.

**Done when.** Leaving Home stops queued count work; the current book’s count still loads.

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

**Risk.** Medium — wiring guards and the eager `wihero` surface.

**Source.** Qwen F1; DeepSeek #11; Astra #9.

#### A3 — Reduced motion and hidden-page pause (P3)

**Why.** Reduced-motion support exists (`app.css:563`), but optional animation should also stop when the editor/page is hidden.

**Change.** Keep the media query; consider a “Reduce motion” setting for devices that do not set it. Stop optional animation when the editor/page is hidden.

**Done when.** `prefers-reduced-motion` disables/shortens motion; hidden pages do not run optional animation.

**Risk.** Low.

**Source.** Qwen animation checklist; DeepSeek #10.

#### A4 — Raster memory and lifecycle cleanup (P3)

**Why.** A promoted `.world` at low zoom can be a large layer. Canvas/input modules schedule timers and animation frames without a single comprehensive public dispose path. This inspection does not establish an unbounded listener leak; detached element listeners alone are not proof of one.

**Change.** Check large scenes and low zoom on the weakest phone; do not promote every card. Keep `will-change` temporary. Add explicit lifecycle cleanup as components become retained/virtualized. Verify retaining paths with heap snapshots.

**Done when.** Large scenes at low zoom do not exhaust raster memory; open/close cycles show no retained-listener or retained-DOM growth in heap snapshots.

**Risk.** Medium — verify with traces, not object counts.

**Source.** Astra animation prep; DeepSeek #10.

#### A5 — Animation readiness checklist (P3, gate to the animation pass)

Do not start the animation work until:

1. A1 is done: no live full-screen blur.
2. Stable DOM identity exists for Normal rows and Hero chrome; the canvas is already retained.
3. Transform/opacity only; no `left/top/width/height/background` animation. A2 fixes the switch.
4. No long tasks on the interaction path: H1, H2, T0–T5, V1–V6 are done.
5. Reduced motion and hidden-page pause are in place.
6. Paint is measured, not just JS: paint flashing/compositor traces for blurred surfaces, the promoted `.world`, and large scenes at low zoom.

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
- Layout/paint and heap stay in browser traces and heap snapshots; the harness cannot see them.
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
- 6× CPU throttling is a comparison tool, not a substitute for mobile GPU/memory behavior.

### 7.6 Regression suites

- `node --test` for logic and engine semantics.
- `npm run perf:smoke` for the native harness's determinism/count assertions; `npm run perf` for the scale numbers.
- `e2e/perf-harness.mjs` for browser scenarios and long tasks (no ST); `e2e/perf.mjs` for the same against a throwaway ST, with `PERF_ALLOW_SEED=1`.
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
- **Browser:** `e2e/perf-harness.mjs` at 6× CPU, 390×844, disposable profile; `--rate 1` for native. `e2e/perf.mjs` is the same shape against a throwaway ST when one is available. The entry-open step carries `wihero.perf` deltas, so an attribution is recorded with the timing.
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
- UI shell: `src/ui/app.js`, `src/ui/normal.js`, `src/ui/desk.js`, `src/ui/hero-shell.js`, `src/ui/canvas.js`, `src/ui/canvas-input.js`, `src/ui/link-engine/index.js`, `src/ui/entry-page.js`, `src/ui/history.js`, `src/ui/st-books.js`, `src/ui/book-write.js`, `src/ui/data.js`, `src/ui/clashes.js`, `src/ui/menus.js`, `src/ui/pieces.js`, `src/ui/show-in-chat.js`, `src/ui/icons.js`, `src/ui/dom.js`, `src/ui/preview.js`, `src/ui/canvas-graph.js`.
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
