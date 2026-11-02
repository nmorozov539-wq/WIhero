# End-to-end tests

`n1.mjs` plays a chat in a real SillyTavern 1.19.0 with a mock model and checks what reaches the prompt and the saved snapshots (BUILD_SPEC 13, N1): a chain advancing, a swipe and a delete rewinding it, a rider riding with its host, a lock in the user message opening in the same reply, a hold, a mask with a macro, the off switch, an old-build book, and a card round trip.

`n2.mjs` checks the editor at 390px wide (BUILD_SPEC 13, N2): the World Info button opening WI Hero, a book made, filled and organized without ST's editor (entries, condition, strategy, parameters, folders through selection, grouping, the on/off switch, Duplicate, Delete with Undo), search, a snapshot taken and restored with Undo and the "As imported" copy, problem badges, the color modes and content font, Global and Rename, Back and Escape, hiding and showing, deleting a book with Undo, four themes (screenshots in `e2e/log/`), "More settings" and a reload starting on Home. It makes and deletes the books "N2 Test" and "N2 Shelf".

`n3.mjs` checks Hero mode at 390px wide (BUILD_SPEC 13, N3): the sample book drawn once arranged (pack frame, OR junction, mask stack, links), a card and a port dragged, a mask layer flipped, the camera zoomed and panned, an entry placed from the panel, entry tabs with Show on canvas and Back, a pack sheet, Tidy with Undo, Show chat state against the open chat after two messages, a reload keeping positions, the moved port, the mask layer and the camera, and the mode switch both ways. It starts a new Seraphina chat and resets the sample book's canvas memory.

`n4.mjs` checks the inspector at 390px wide (BUILD_SPEC 13, N4): on a new book "N4 Test" every piece is added, edited and removed and checked in the saved book (packs, a gate with an entry, a pack reading, a lock and a wait, Story moves on, close gate, closes for, a mask whose text is written on its chip, gates for, who triggers, glue, switch, once); a port and the Problems sheet open the inspector; a greeting card takes Gates for and Closes for; and Reopen opens a closed entry and a swipe rewinds it. It deletes "N4 Test" at the end.

`n5.mjs` checks Preview at 390px wide (BUILD_SPEC 13, N5): seeded from the open chat after real turns, it fires exactly what the chat fired; and every block reason of CONCEPTS 7 shows up on the sample book (waiting on an entry, lock not armed, lock waiting for its phrase, wait not run out, closed earlier, Once, close gate met, closed this turn by another entry, the switch already picked, wrong side, turned off), with highlights that explain themselves, the report page, Also active, Fresh start and greeting starts, nothing saved, and Back. It starts a new Seraphina chat.

Run them against a throwaway SillyTavern, never your own: it changes the connection settings and the global lorebooks, and creates (then deletes) a character.

1. A SillyTavern 1.19.0 with fresh data (default Seraphina character), with this repo linked as `data/default-user/extensions/st-wihero`.
2. Copy `examples/WIHero-N1.json` and `examples/WIHero-Sample.json` to that SillyTavern's `data/default-user/worlds/`.
3. Start it (`node server.js --port 8000`, or set `ST_URL`).
4. `node e2e/mock.mjs &` (OpenAI-compatible mock on port 5001, logs prompts to `e2e/log/`).
5. `npm i --no-save playwright@1.55.0`, then `node e2e/n1.mjs`, `node e2e/n2.mjs`, `node e2e/n3.mjs`, `node e2e/n4.mjs` and `node e2e/n5.mjs`. Set `CHROMIUM=/path/to/chrome` if Playwright's own browser isn't installed.

The older scripts (gating, editor, labels, folders, visuals, workspace, phone, branches) test the old UI and are in the git history; their checks now live in n1–n5.
