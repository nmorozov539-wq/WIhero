# WI Hero — Roadmap

The build steps N1–N6 in [BUILD_SPEC.md](BUILD_SPEC.md) are done. The finished
milestones are in the git history.

Since then (also in the history): the phone rounds (#7, #8, #9, #10), the piece
bar (#11, LAYOUT "Piece bar", `e2e/n7.mjs`), locks on their line (#12), and
following ST's World Info drawer with greetings first and a canvas that grows
down (#13 and after), the desktop layout (#15, #16), the desktop testing
round (#17), and the fixes from the external review (#18).

The UI audit came in four phases, each with its own decisions in BUILD_SPEC:

| Version | PR | What |
|---|---|---|
| 0.19.0 | #19 | One direction rule for links (D27), a readable phone canvas, quieter Normal mode, warnings counted apart (D19) |
| 0.20.0 | #20 | Import through ST (D28), the Off hint, every ST entry setting on the entry page (D29) |
| 0.21.0 | #21 | Moments (D30, CONCEPTS 3.13) |
| 0.22.0 | #22 | The Guide and explain mode (D31) |

After it:

| Version | PR | What |
|---|---|---|
| | #24 | Docs in step with 0.22.0, the AGPL-3.0 license, a short README for testers |
| 0.25.0–0.26.0 | #25–#27 | Fixes from the 2026-11-09 review: book data safety, runtime fixes, tests on every PR (CI) |
| 0.28.0–0.33.0 | #28–#33 | `src/ui/app.js` split into modules (review finding 11) |
| 0.34.0 | #34 | The link engine: smooth links around cards, shaped by hand ([LINK_ENGINE.md](LINK_ENGINE.md)) |
| 0.36.0 | #36 | Small additions: dice for switches, the keyword clash finder, the dead branch report, lasso to make a pack, sticky notes, New book and Duplicate in Hero mode |
| 0.37.0 | #37 | Trackers: text the model writes ([TRACKERS.md](TRACKERS.md)) |
| 0.38.0 | #38 | Health check fixes and the weekly ST drift check (`tools/st-drift.mjs`) |
| 0.39.0 | #39 | Delayed closing (D32, CONCEPTS 3.3) |
| 0.40.0 | #40 | Playtest polish |
| 0.41.0 | #41 | UI polish from the impressions list; greetings retired for V1 (CONCEPTS 3.12) |
| 0.42.0 | #42 | Feature freeze polish: undo history (Ctrl Z, canvas arrows; freeze exception), ST timing in the Hero inspector with a badge on cards and warnings under it, the checks chip on the canvas, Mark keyword clashes, List order and Prompt order sorts with drag to reorder and Order on each row, New entry below; docs checked against the code |

The feature freeze for V1 is on: no new systems, only fixes and polish.

## Tested by hand

In a real SillyTavern, by the author: **Gates** and **Closes** have been tried
in actual play, and the playtest of 2026-11-10 led to delayed closing and the
playtest polish (0.39.0, 0.40.0). Trackers have also run against a real model
(DeepSeek, `e2e/trackers-real.mjs`). Every other piece (packs, locks, waits,
masks, switches, dice, glue, Once, Gates for, Closes for, Story moves on,
Moments) has only been checked by the automated tests in `test/` and `e2e/`.
The same goes for Import of non-ST formats (NovelAI, Agnai, Risu), the entry
Parameters, the Guide and explain mode. Try them in real chats before calling
them done, and note here what was tried.

## Later

Preview over several turns, greetings (retired for V1) and then group chats, a
timeline scrubber across branches. Bigger ideas are in
[AFTER_V1.md](AFTER_V1.md).
