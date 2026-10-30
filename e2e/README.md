# End-to-end tests

`gating.mjs` plays a chat in a real SillyTavern 1.19.0 with a mock model and checks what reaches the prompt, the panel and the saved snapshots: a chain advancing, a closed entry staying out, swipe, delete, a quiet generation, a reload, the off switch, glue, and ST's own sticky and cooldown alongside gating and glue. The timed-effect steps also print a per-turn table of what was injected.

Run it against a throwaway SillyTavern, never your own: it changes the connection settings and the global lorebook.

1. A SillyTavern 1.19.0 with fresh data (default Seraphina character), with this repo linked as `data/default-user/extensions/st-wihero`.
2. Copy `examples/WIHero-Sample.json` to that SillyTavern's `data/default-user/worlds/`.
3. Start it (`node server.js --port 8000`, or set `ST_URL`).
4. `node e2e/mock.mjs &` (OpenAI-compatible mock on port 5001, logs prompts to `e2e/log/`).
5. `npm i --no-save playwright@1.55.0`, then `node e2e/gating.mjs`. Set `CHROMIUM=/path/to/chrome` if Playwright's own browser isn't installed.
6. `node e2e/editor.mjs` checks the entry editor: it gates a new entry through the UI, reads the book from disk (set `ST_WORLDS` to that SillyTavern's `data/default-user/worlds`), plays it in a chat and removes the config again. Copy a fresh sample book first (step 2): it adds an entry. It also writes the README screenshots to `docs/img/`.
7. `node e2e/labels.mjs` checks labels: a label as a gate source, `gatesFor`, `closes`, the panel filter and rewind.
8. `node e2e/folders.mjs` checks folders: set in the entry editor, the folder filter, bulk actions on disk, gating unchanged.
9. `node e2e/visuals.mjs` checks the badges and stripes on ST's entry list and the panel's folder groups, and writes the panel and badge screenshots to `docs/img/`.
10. `node e2e/workspace.mjs` checks the workspace: opening, link types, statuses, hover, local graph, folding, the chat-state scrubber. It writes `docs/img/workspace.png`.
11. `node e2e/branches.mjs` checks railway switches (and masks). It starts its own chat; copy a fresh sample book first. Scripts after `gating.mjs` share their setup in `e2e/lib.mjs`.
