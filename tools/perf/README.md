# tools/perf — the in-repo benchmark harness

The engine-scale benches from `docs/optimization-pass/PLAN.md` (Phase 0, B0). They run in plain Node against the
source, with synthetic fixtures only: no SillyTavern, no real library, no network, no browser.

```sh
npm run perf:smoke   # node tools/perf/run.mjs --smoke  — tiny sizes, under three seconds
npm run perf         # node tools/perf/run.mjs          — the plan's scales, well under a minute
node tools/perf/run.mjs --out run.json
```

Each measurement is one JSON line on stdout. `--out <path>` also writes the whole run as a JSON array. The last line
on stderr has the measurement count and wall time.

## Label policy

Every record carries `"label": "measured-native"` and a `machine` block (CPU, cores, platform, Node version). These
are **measured-native desktop Node** numbers. CPU throttling does not exist in Node, so there is no 6× figure here.
A browser at 6× CPU is a comparison tool; neither is a phone prediction. Budgets in the plan are weakest-device
targets and are not promised by these numbers.

## What each bench measures

| File | Metric | Fixture |
|---|---|---|
| `bench-generation.mjs` | `model`: `buildModel` for a whole book. `generation`: one generation through the hooks (start, entries loaded and spliced, one scan settled with a dozen activations, activated list, reply received). `counts`: `JSON.stringify` calls and entry hashes in one generation. | 150/1,000/3,000/5,000 entries, mixed story logic, unique multi-word keys |
| `bench-trackers.mjs` | `slotValues` and the panel's real `view()` (`src/st-hooks.js`). Half the slots are written masks, and every slot has a value: a view without written masks is incomplete. | 20/60/120 tracker slots (10/30/60 entries) |
| `bench-rebuild.mjs` | Model identity changes across four generations plus one `loadModel`, and the entry hashes those paths asked for. The number to keep is zero. | 150/1,000/3,000/5,000 entries |
| `bench-clash.mjs` | `keywordClashes` cold (a fresh book), warm (same book, no revision cache), and cached (same revision twice). Two key shapes: unique tokens, and a small shared vocabulary where every token recurs. Also `distinctKeys`. | unique: 150×3, 500×4, 1,000×4, 2,000×4; shared vocabulary: 500×4, 1,000×4 |
| `bench-collator.mjs` | A–Z sort with `sortEntries(..., 'az')` (shared `Intl.Collator`, decorate-sort) beside the old `localeCompare(..., options)` comparator. Compares the two implementations on the same titles. | 150/500/1,000/3,000 synthetic titles |
| `bench-history.mjs` | The `withHistory` wrapper around a mock library, one character appended per quiet change; median and p95, plus the serialized book size. | 150/1,000/5,000 entries, about 1,150 characters of content each |
| `behavior.mjs` | Four synthetic scenarios through the engine (plain gating, Moments, written values/masks, closures/sticky), hashed over fired entries, injected text, masks, closures, holds, sticky state and the final state. Prints one `behaviorHash`. | fixed; deterministic |
| `fixture.mjs` | The generators: seeded mulberry32 books, libraries of 40/100 books, short/long chats, placed-canvas shapes, and the `e()` entry shorthand. | — |
| `timing.mjs` | Warm-up and median/p95 sampler, machine label, JSON-lines sink. | — |
| `rig.mjs` | The shared stand-in SillyTavern (`createHooks` over an in-memory book). | — |

## Reading the numbers

- `median` and `p95` are per-sample milliseconds; `samples` is how many timed calls the summary used. Read `samples`
  with every number. A p95 is only meaningful when `samples` is large enough to have a tail: with `samples: 3`, p95 is
  simply the maximum, and one JIT or GC outlier owns it. Do not compare p95 values from runs with different sample
  counts.
- Counts (`rebuilds`, `jsonStringifyCalls`, `entryHashes`, `distinctKeys`, `behaviorHash`) have no timing summary.
- The plan's `6,002 → 2` claim is the `counts` record on `bench-generation`: `jsonStringifyCalls` per generation.
  A regression to hashing every entry shows up as a jump in `entryHashes` and the stringify count.
- `bench-clash` does not carry the pre-H1 implementation, so its cold/warm/cached numbers are a fresh fingerprint,
  not a replay of the plan's 43.5 ms → 2.0 ms table. The 1,000×4 warm number on the unique shape should stay near the
  plan's 12.9 ms because the fixture is the same shape. Cold includes the first call's JIT on the hot loop; on the
  shared shape that first sample is about an order of magnitude above its steady-state warm cost.
- **Open finding for the coordinator:** the shared-vocabulary clash shape is not cheap. Warm 500×4 is about
  40–43 ms and 1,000×4 about 147–159 ms native, against about 8 ms and 17 ms on the unique-key shape. The token index
  cannot narrow when every token recurs in hundreds of keys, so this is the H1 done-condition case (a 1,000-entry
  book's entry-page or menu draw is not a no-long-task path) rather than a fixture quirk. It is recorded, not fixed:
  `src/ui/clashes.js` is untouched in this packet.
- `behavior.mjs` records a new fingerprint. It is **not** the old harness's `897800cddace9896`; those files are gone
  and these four scenarios are their replacement. Changing an engine decision changes the hash.

## Adding a bench

Give the module an `export async function run({ smoke, sink })`, call `sink.add({ bench, metric, fixture, ...timing })`,
and register it in `run.mjs`. Keep `--smoke` tiny: it is the only place the run asserts (the behavior hash must be
deterministic, rebuilds must be zero, the generation counter must count something).
