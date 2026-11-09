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

## Tested by hand

In a real SillyTavern, by the author: only **Gates** and **Closes** have been
tried in actual play. Every other piece (packs, locks, waits, masks, switches,
glue, Once, Gates for, Closes for, Story moves on, greeting starts, Moments)
has only been checked by the automated tests in `test/` and `e2e/`. The same
goes for everything from the UI audit: Import of non-ST formats (NovelAI,
Agnai, Risu), the new entry Parameters, the Guide and explain mode. Try them in
real chats before calling them done, and note here what was tried.

## Later

Preview over several turns, greetings in group chats, a timeline scrubber
across branches. Bigger ideas are in [AFTER_V1.md](AFTER_V1.md).
