# End-to-end tests

`gating.mjs` plays a chat in a real SillyTavern 1.19.0 with a mock model and checks what reaches the prompt, the panel and the saved snapshots: a chain advancing, a closed entry staying out, swipe, delete, a quiet generation, a reload and the off switch.

Run it against a throwaway SillyTavern, never your own: it changes the connection settings and the global lorebook.

1. A SillyTavern 1.19.0 with fresh data (default Seraphina character), with this repo linked as `data/default-user/extensions/st-wihero`.
2. Copy `examples/WIHero-Sample.json` to that SillyTavern's `data/default-user/worlds/`.
3. Start it (`node server.js --port 8000`, or set `ST_URL`).
4. `node e2e/mock.mjs &` (OpenAI-compatible mock on port 5001, logs prompts to `e2e/log/`).
5. `npm i --no-save playwright@1.55.0`, then `node e2e/gating.mjs`. Set `CHROMIUM=/path/to/chrome` if Playwright's own browser isn't installed.
