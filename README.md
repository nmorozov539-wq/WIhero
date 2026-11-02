# WI Hero

A SillyTavern extension that replaces the World Info editor and adds story
logic to your lorebooks: entries that only become eligible once the story
reaches a point, and retire once it moves past. Books are edited in a normal
list view or in Hero mode, a canvas of cards and links; Preview checks a
pretend exchange against the book before you play it, and a bubble in the chat
shows which entries reached the model with the last reply. Tested on
SillyTavern 1.19.0.

## Install

In SillyTavern, open **Extensions** → **Install extension**, paste
`https://github.com/nmorozov539-wq/WIhero` and install. See SillyTavern's
[extension docs](https://docs.sillytavern.app/extensions/) for details.

## Development

Run the tests with `node --test`; the in-ST checks are in [e2e/](e2e/README.md).
The spec is in [docs/](docs/), starting at [BUILD_SPEC.md](docs/BUILD_SPEC.md).

## License

GPLv3. See [LICENSE](LICENSE).
