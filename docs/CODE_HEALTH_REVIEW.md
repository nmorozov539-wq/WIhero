# Code health review — 2026-11-12

Original reviewed revision: `720ac7a` (the first mobile/persistence/tracker fixes). The original findings and line
references are retained below as an audit record.

## Resolution

All eight confirmed bugs have corrective changes and reproducing regression checks:

- `8f541c0`: explicit dirty/confirmed revisions, outside-update history invalidation, held rename/delete
  transactions, failure-aware deletion and backup retention. The native save adapter synchronizes queued native
  payloads only after HTTP success, preserves native edits received during the request, and confirms late native
  events. Startup compatibility and drift checks cover the cache semantics this requires.
- `2759739`: random snapshot identities, legacy snapshot compatibility, shared seeds, and upload-aware cleanup.
  Follow-up checks also cover pending uploads and cleanup through a book rename.
- `d05a36a`: fresh close-lock latches after Reopen, host-length sticky checks, and Moments in the actual Preview UI.
- `970f204`: a catch-up popup race found by the live suites. Dialogs are owned by a chat/epoch, cancelled on
  chat switch, and cannot apply a delayed answer or model load to another chat.
- Final lifecycle checks preserve Undo through sanitized renames and replace stale working copies when a
  deleted destination name is reused. A destination with unconfirmed edits cannot be overwritten.
- Final transaction checks also consume keyboard events while the view waits, so keys cannot reach ST's chat
  when the waiting view leaves focus on the body.

The new `e2e/host-saves.mjs` verified the real ST 1.19.0 native debounce and failure contracts with independent
server reads: queued native plus local edits persisted together; injected HTTP 500 kept edits and recovered on
retry; a failed rename destination kept the source; and ST's false delete result retained the book. These tests
used disposable config/data and a local mock model, leaving installed user books and chats untouched.

The structural changes were kept to the lifecycle and cache boundaries implicated by the bugs. Large UI modules
were not rewritten as part of this stabilization pass.

## Final validation after fixes

- Unit suite: **300 passed, 7 skipped, 0 failed** (`node --test --test-isolation=none`, 307 total).
- All eight browser harness suites passed: desktop, controls, review, shape, cheap, polish, mobile-edit and lifecycle.
- Disposable SillyTavern 1.19.0: N1–N9 passed; Text Completion passed with instruct off and ChatML instruct on;
  all 15 tracker edge checks passed. The final mobile-editor rerun (N2) passed all 18 checks.
- `host-saves.mjs` passed its four independent-server-read checks for native debounce, HTTP error/retry,
  rename destination failure and failed deletion.
- JavaScript syntax checks and the local ST drift check passed.
- Test fixtures now isolate global books and select Home explicitly. N7's old self-drop expectation was updated
  to the documented canvas behavior. Temporary test-service expirations were retried; no real models were used.

## Original validation

- `node --test --test-isolation=none`: 271 passed, 7 skipped, 0 failed (278 total).
- Syntax checks passed for the extension entry point and all JavaScript modules under `src/`.
- Browser harness suites passed: `desktop.mjs` (51 checks), `controls.mjs` (23), `review.mjs` (10), `shape.mjs` (11), `cheap.mjs` (10), `polish.mjs` (10), and `mobile-edit.mjs`.
- Eight controlled reproductions confirmed the findings below. These use in-memory host dependencies and deferred requests. The Moments reproduction exercises the engine with the exact filtering used by the Preview UI.
- Reviewed the local SillyTavern implementations of saving, deletion, editor reload, and file upload. The full in-ST suites were not run. No real user lorebooks or chats were changed.

Passing the existing checks does not cover the interleavings below. Findings 1 and 2 show that the preceding persistence fix is still incomplete.

## Original confirmed bugs

### 1. High — edits during rename are lost

Location: `src/ui/st-books.js:321`, especially the copy at line 326 and destination write at line 329.

Rename flushes, clones the source, and awaits the destination write. The source remains editable while the request is pending. A later edit changes only the source working copy. Rename then deletes the source and drops that working copy. Its scheduled save subsequently finds no copy and does nothing.

Reproduction: hold the destination write unresolved, change the source entry from `A` to `late edit`, finish rename, then flush. The destination contains `A`, the source no longer exists, and the late edit is gone.

Proposed fix: treat rename as a per-book transaction spanning saves and edits. Either hold editing with a visible waiting state for the transaction, or route intervening changes to the destination and persist them before retiring the source. Extend the same lifecycle to deletion; waiting for an initial flush is insufficient by itself.

### 2. High — an outside save merged during an active write is not saved again

Location: `src/ui/st-books.js:187` and `src/ui/st-books.js:138`.

`onWorldInfoUpdated()` merges an external update into the working copy, but does not schedule a write. If the previous timer was already consumed by an active request, that request still contains the older serialized copy. Its completion overwrites the persisted external change, then marks its old payload as the base. Flush finds no pending work.

Reproduction: hold a write with a local edit to entry 0; deliver an outside update to entry 1; complete the held write and flush. The working copy contains the external edit, the persisted copy does not, and `unsaved()` is false.

Proposed fix: track dirty revisions independently of timers. A merge after the serialized revision must stay dirty and trigger a subsequent serialized write. Save completion may acknowledge only the revision actually sent.

### 3. High — Undo can overwrite a completed outside edit

Location: `src/ui/st-books.js:191` and `src/ui/history.js:76`.

A clean outside update drops the working copy without incrementing the library version. History assumes unchanged version means unchanged entries, even after the copy is reloaded. It therefore retains stale undo history rather than resetting it as documented.

Reproduction: make and save a local edit; save an outside edit to another entry; reload the library copy; invoke Undo. Undo remains available and restores the old whole-book state, erasing the external edit.

Proposed fix: make external replacement observable to every derived cache and history. Use a per-book revision or copy identity, and explicitly reset history after a confirmed external replacement.

### 4. High — failed book deletion is treated as success and can remove backups

Locations: `src/ui/st-books.js:287`, `src/ui/st-books.js:337`, and `src/ui/app.js:614`.

SillyTavern's `deleteWorldInfo()` returns `false` on an HTTP failure; it does not throw. `removeNow()` clears its working copy regardless. The UI ignores the false result and deletes book settings. Worse, it deletes snapshot files before attempting book deletion. Rename also ignores false when deleting its source, then continues moving settings and links.

Reproduction: make the host delete return false. `library.remove()` returns false but drops its loaded working copy, while the server-side book remains. The destructive ordering of snapshot deletion is visible in the UI caller.

Proposed fix: require a successful delete result before clearing copies/settings or reporting completion. Keep snapshots until book deletion succeeds, and surface failures from delayed toast callbacks. Define recovery for a rename whose destination was saved but whose source could not be deleted.

### 5. Medium — concurrent snapshots can overwrite each other

Location: `src/ui/snapshots.js:39`; filename construction at line 9.

The timestamp collision check sees only completed uploads. Two concurrent uploads can select the same timestamp and path before either adds its index record. Different book names can also collapse to the same slug, so per-book timestamp checks do not establish global filename uniqueness. ST's upload endpoint overwrites an existing file at the supplied path.

Reproduction: start two snapshot requests with the same clock millisecond before either finishes. Both index records exist, but both point to the same path; only the second file content remains.

Proposed fix: use a genuinely unique file identifier, reserve it before awaiting, and keep display timestamps separate from snapshot identity.

### 6. Medium — Reopen prevents a previously latched close lock from firing again

Location: `src/engine/turn.js:55`, with the baseline in `src/engine/manual.js:8`.

Reopen sets a new baseline, so the old lock latch is correctly ignored by row evaluation. But `latchLocks()` writes only when the latch is undefined. The old, pre-baseline latch remains defined and prevents a fresh matching phrase from replacing it.

Reproduction: close an entry using a lock phrase, reopen it, then say that phrase in a new user message. The latch retains its old index and the entry stays open instead of closing again.

Proposed fix: clear the affected close-rule latches on Reopen or allow a fresh latch to replace one older than the active baseline. Test lock-only and entry-plus-lock close rules, including swipe rewind.

### 7. Medium — swipe sticky checks subtract the replaced reply twice

Locations: `src/st-hooks.js:174`, `src/st-hooks.js:89`, and `src/timers.js:48`.

`onEntriesLoaded()` passes an already sliced `scanChat()` to `sticky()`. That helper calls `scanLength(chat, 'swipe')`, which subtracts the replaced reply again. The resulting length can incorrectly suppress an active sticky or retain one at the wrong boundary.

Reproduction: original chat length 5, sticky start 3 and end 8. ST's scan length is 4, so the effect is active. WI Hero computes 3 and removes the closed entry despite its running sticky.

Proposed fix: calculate timed-effect length from the original host chat exactly once. Keep the engine's snapshot slice and ST's timed-effect scan length as explicit, distinct inputs. Cover start/end boundaries for swipe, regenerate, and continue.

### 8. Medium — Preview excludes Moments before building its engine model

Locations: `src/ui/preview-view.js:62` and `src/ui/app.js:138`.

The Preview UI builds its model from `entriesShown()`, which intentionally removes Moments from the ordinary entry list. That display filter also removes the logical events needed by Preview. A valid entry gated by a Moment becomes blocked because its referenced Moment is absent.

Reproduction: a Moment `arrival` and an entry gated by `arrival` build without blocking errors together. Passing the same book through Preview's current filter drops `arrival`, and the gated entry becomes blocked.

Proposed fix: build Preview's model from all relevant entries, including Moments, then filter only its displayed ordinary-entry rows. Verify a Moment in the pretend user message opens its target and does not itself send content.

## Original additional host-contract risk

The new `src/ui/book-write.js` deliberately checks HTTP status, which fixes the previous false-success bug. However, it also bypasses ST 1.19.0's `_save()` cancellation of `saveWorldDebounced` (`public/scripts/world-info.js:4151`). An already scheduled native save can therefore execute after a confirmed WI Hero write and overwrite it. This cancellation requirement is verified in the local host source; this particular sequence was not reproduced in a live ST server.

Before releasing the new save adapter, add a host contract check covering a pending native write, and establish how native and extension writes are ordered without a temporary global fetch override. Also add the exported cache dependency to the compatibility/drift contract: the adapter now requires `worldInfoCache.set`, but the startup health check does not check it.

## Original structural concerns

- **Dirty state is inferred from timers.** Timers, failed-save flags, active requests, working copies, and server-confirmed bases are separate collections. They can disagree, as findings 1 and 2 demonstrate. A per-book lifecycle with a dirty revision and an acknowledged revision would simplify both correctness and testing.
- **UI dependencies are broad and partly implicit.** `app.js`, `desk.js`, `canvas.js`, and `piecebar.js` are large modules, with substantial closure state and context objects passed between views. Ordinary editing, canvas editing, and Preview share concepts but do not consistently share input contracts; the Moments filter is one concrete consequence. Extract focused contracts while fixing bugs rather than rewriting all views.
- **Cache invalidation has competing mechanisms.** Runtime models compare serialized whole entry arrays, UI models depend on a global library version, and history has its own version shortcut. This makes correctness hard to reason about and may create avoidable work on large books. Establish per-book revisions and an explicit model-input projection, then measure before optimizing.
- **Async UI callbacks have no shared error boundary.** `askText`, menu buttons, and toast expiry callbacks start promises without awaiting/reporting them centrally. Some callers handle errors locally, but delayed book deletion does not. Errors can leave hidden books or partial operations with no actionable explanation.

## Original proposed order for fixes

1. Book write/rename/delete lifecycle, external updates, and Undo invalidation (findings 1–4), plus the native debounce contract.
2. Snapshot identity and upload concurrency (finding 5).
3. Reopen latches and sticky scan boundaries (findings 6–7).
4. Preview's engine inputs (finding 8).

For each milestone, add the reproducing regression first, make the smallest corrective change, and rerun the affected unit/host checks plus the browser harness suites. The resulting unit, browser and live-ST validation is recorded in the resolution above.
