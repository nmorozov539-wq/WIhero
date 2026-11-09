# WI Hero

A SillyTavern extension that replaces the World Info editor and adds story
logic to your lorebooks. With it, entries can wait until the story reaches a
point, and retire once it moves past.

**Install:** in SillyTavern, open **Extensions** → **Install extension**, paste
`https://github.com/nmorozov539-wq/WIhero` and install. See SillyTavern's
[extension docs](https://docs.sillytavern.app/extensions/) for details.

> [!WARNING]
> **It takes over SillyTavern's World Info editor.** The World Info button
> opens WI Hero instead of ST's editor. Your books stay normal ST lorebooks.
> To get ST's editor back, disable or uninstall WI Hero in ST's extension
> manager (WI Hero's own Enabled switch only pauses the story logic).
>
> **It is not tested with other extensions,** and for now it is not expected to
> work alongside ones that touch World Info. It has only been tested on
> SillyTavern 1.19.0.

> [!CAUTION]
> **WI Hero is in testing.** Expect bugs. Take a snapshot or export a book
> before you try it on one you care about.

## Two modes

- **Normal mode** is a cleaner World Info editor: your books and entries as
  lists and pages, with every ST setting, on phones and desktop.
- **Hero mode** is a canvas of cards and links where you build the story
  logic. Link entries so one opens or closes another, glue entries together,
  swap their text as the story moves on, and more. Preview checks a pretend
  exchange against the book before you play it, and the **?** button explains
  anything on screen.

## Feedback and bugs

Please report bugs and send feedback through
[GitHub Issues](https://github.com/nmorozov539-wq/WIhero/issues). All
communication about WI Hero happens on GitHub. For a bug, it helps to include
your SillyTavern version, phone or desktop, and the book's JSON if you can
share it.

## Development

Run the tests with `node --test`. The in-ST checks are in [e2e/](e2e/README.md),
and the spec is in [docs/](docs/), starting at [BUILD_SPEC.md](docs/BUILD_SPEC.md).
Every PR that changes the extension sets `version` in `manifest.json` to
`0.<PR number>.0`.

## License

AGPL-3.0, the same license as SillyTavern. See [LICENSE](LICENSE).
