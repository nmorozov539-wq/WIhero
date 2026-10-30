# WI Hero

A SillyTavern extension for story-gated World Info: entries that only become eligible once the story reaches a point, and retire once it moves past.

Status: M1–M4 (gates, chains and glue work; the entry editor is next). Targets SillyTavern 1.19.0.

- [Design](docs/DESIGN.md)
- [Roadmap](docs/ROADMAP.md)
- [Technical notes](docs/TECHNICAL_NOTES.md): how the design maps onto ST's World Info hooks

## Gating an entry

Until the entry editor exists (M5), gates are written by hand as a `wihero` field on the entry in the lorebook JSON (`data/default-user/worlds/<book>.json`):

```json
"wihero": { "id": "mill", "gates": ["road"], "gateMode": "all", "closeGates": true }
```

- `id`: stable name other entries refer to. Letters, digits, `_ . : -`.
- `gates`: ids that must have fired before this entry may fire. Leave out for an entry that's open from the start.
- `gateMode`: `"all"` (default) or `"any"`.
- `closeGates`: when this entry fires, the gates it opened from close for good (a chain advancing). Default `true`.
- `glue`: `true`, or `{ closeKeywords, closeWhenFired, closeWhenAllFired }`. Keeps the entry injected every turn from its first firing until a condition is met, then closes it. Close keywords are checked against the turn's new messages (the user message(s) and the reply). A glued chain link isn't closed when the chain advances.

A gate opens on the turn after its parent fires. Entries with a config problem never fire; the panel lists the problem.

ST's own timers still win. A running sticky finishes even after its entry closes (the panel shows `sticky (closed)`), and cooldown and delay can hold back a glued entry (the panel warns about glue with a cooldown). Sticky and cooldown count messages, two per turn, so N lasts floor((N-1)/2) more turns.

## Trying it

1. Copy `examples/WIHero-Sample.json` to `SillyTavern/data/default-user/worlds/` and select it as a global lorebook.
2. Open Extensions → WI Hero. It lists `road` (open), `mill` and `tunnel` (waiting).
3. Chat: mention the **road**, then the **mill**, then the **mill** again. Watch `[WIH-…]` lines in the prompt (Prompt Inspector) and the panel:
   - turn 1: WIH-1 fires; `mill` opens.
   - turn 2: WIH-2 fires; `road` closes, `tunnel` opens.
   - turn 3: WIH-2 and WIH-3 fire; `mill` closes.
4. Swipe or delete the last reply: the panel goes back one step.

## Tests

`npm test` runs the engine tests (no SillyTavern needed).
