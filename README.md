# WI Hero

A SillyTavern extension that replaces the World Info editor, with a second side
for story logic: entries that only become eligible once the story reaches a
point, and retire once it moves past.

Status: building. **N1, the engine, is in** (`src/engine/`, with its SillyTavern
wiring in `src/st-hooks.js`): story logic works in chats, with the old settings
panel in the Extensions drawer for testing. **N2, the editor shell and normal
mode, is in** (`src/ui/`): ST's World Info button opens WI Hero, where books are
made, filled, organized and snapshotted. **N3, Hero mode's canvas, is in**: a
book's story logic as cards and links, arranged once and then kept where you
leave them, with the open chat's state on the cards when you want it. **N4, the
inspector, is in**: tap a card to add, edit and remove every piece, aim rules at
the open chat's greetings, and Reopen a closed entry. **N5, Preview, is in**:
the eye tab next to the Canvas checks a pretend exchange against the book on the
real engine, starting from the open chat, a fresh start or one of its
character's greetings, and explains every phrase that fires or is blocked and
what would change after the turn. Nothing it does is saved. Its keyword matching
is its own (regex keys, secondary keys and scan depth are approximated, and
recursion, sticky, cooldown, probability and vectors aren't run), and the
reply's key words count from the next message, as in a chat. **N6 is in**: a
chat that ran with WI Hero off is caught up on request (replayed oldest first),
WI Hero names an ST version it isn't tested on and stands down to plain World
Info if a hook it needs is gone, and a book bubble in the chat shows how many
entries reached the model with the last reply (tap it for their names; switch
it off in the extension settings).
Run the tests with `node --test`; the in-ST checks are in [e2e/](e2e/README.md).

**Building it?** Start at [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md): its "Start
here" section, the decisions (D1–D26), and the build order N1–N6.

## Demo

[demo/wihero-demo.html](demo/wihero-demo.html) is one self-contained page: open
it in a browser. It runs both modes on a sample book, phone sized, and nothing
is saved. It is the reference for how the spec should look and behave.

## Docs

The spec, in reading order:

- [Concepts](docs/CONCEPTS.md): story logic, the pieces and the rules they follow
- [Layout](docs/LAYOUT.md): every screen and control, in normal mode and Hero mode
- [Visual language](docs/VISUAL.md): type, color, icons, and how pieces are drawn on the canvas
- [Build spec](docs/BUILD_SPEC.md): every decision and how to build it, step by step
- [Technical notes](docs/TECHNICAL_NOTES.md): how the design maps onto ST's World Info hooks
- [Roadmap](docs/ROADMAP.md)

Background:

- [Sketches](docs/sketches/README.md): the drawings made while settling the visual language
- [Design v2](docs/DESIGN.md): the original story-gating design, kept for history

## License

GPLv3. See [LICENSE](LICENSE).
