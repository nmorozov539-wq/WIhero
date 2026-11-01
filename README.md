# WI Hero

A SillyTavern extension that replaces the World Info editor, with a second side
for story logic: entries that only become eligible once the story reaches a
point, and retire once it moves past.

Status: specification and prototypes. The earlier working build (gates, glue,
switches, masks, labels and the workspace, for SillyTavern 1.19.0) lives in the
git history; this phase redesigns the editor before it is built again.

## Docs

- [UX spec](docs/UX_SPEC.md): what every screen does, in normal mode and Hero mode
- [Design](docs/DESIGN.md): the original story-gating design
- [Technical notes](docs/TECHNICAL_NOTES.md): how the design maps onto ST's World Info hooks
- [Roadmap](docs/ROADMAP.md)

## Demo

Clickable phone-sized prototypes. Open them in a browser; nothing is saved.

- [Normal editor](demo/normal-editor.html): books, entries, folders, selection and the entry page
- [Hero mode](demo/hero-mode.html): the canvas, the entry panel, pieces and the Preview tab

## License

GPLv3. See [LICENSE](LICENSE).
