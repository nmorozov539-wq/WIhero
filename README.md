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
leave them, with the open chat's state on the cards when you want it. Until the
inspector (N4), tapping a card opens its entry in a tab. The inspector and
Preview come in N4–N5.
Run the tests with `node --test`; the in-ST checks are in [e2e/](e2e/README.md).

**Building it?** Start at [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md): its "Start
here" section, the decisions (D1–D23), and the build order N1–N5.

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
