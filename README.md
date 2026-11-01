# WI Hero

A SillyTavern extension that replaces the World Info editor, with a second side
for story logic: entries that only become eligible once the story reaches a
point, and retire once it moves past.

Status: specification and an interactive demo. The earlier working build
(gates, glue, switches, masks, labels and the workspace, for SillyTavern 1.19.0)
lives in the git history; this phase redesigns the editor and the story-logic
model before it is built again.

## Demo

[demo/wihero-demo.html](demo/wihero-demo.html) is one self-contained page: open
it in a browser. It runs both modes on a sample book, phone sized, and nothing
is saved. It is the reference for how the spec should look and behave.

## Docs

The spec, in reading order:

- [Concepts](docs/CONCEPTS.md): story logic, the pieces and the rules they follow
- [Layout](docs/LAYOUT.md): every screen and control, in normal mode and Hero mode
- [Visual language](docs/VISUAL.md): type, color, icons, and how pieces are drawn on the canvas
- [Technical notes](docs/TECHNICAL_NOTES.md): how the design maps onto ST's World Info hooks
- [Roadmap](docs/ROADMAP.md)

Background:

- [Sketches](docs/sketches/README.md): the drawings made while settling the visual language
- [Design v2](docs/DESIGN.md): the original story-gating design, kept for history

## License

GPLv3. See [LICENSE](LICENSE).
