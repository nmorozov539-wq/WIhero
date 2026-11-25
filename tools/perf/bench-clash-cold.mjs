// The cold clash scan in a fresh Node process: one `keywordClashes` on the 1,000 × 4 shared-vocabulary book, the
// shape B0 measured at ~2.1 s native before H3. A fresh process is the point: the old per-word RegExp cache and
// V8's unoptimized tier are part of what a reader pays on the first entry open.
//
//   node tools/perf/bench-clash-cold.mjs      prints { coldMs, groups }
//   node tools/perf/run.mjs                   records it as bench-clash/cold-fresh-process, measured-native
//
// Run directly it is the child; imported by run.mjs it spawns itself once and records the single sample.
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { keywordClashes } from '../../src/ui/clashes.js';
import { e, sharedKeyWords } from './fixture.mjs';
import { clock, summarize } from './timing.mjs';

const ENTRIES = 1000;
const KEYS = 4;

/** 1,000 entries with four unique five-word keys each, drawn from a 16-word pool: every token recurs. */
function sharedBook() {
    const list = Array.from({ length: ENTRIES }, (_, i) => e(i, sharedKeyWords(i, KEYS), { id: `clash-cold-${i}` }, { world: 'Clash cold' }));
    return { entries: Object.fromEntries(list.map(x => [x.uid, x])) };
}

/** The same vocabulary with 1–3 word keys and `mill`/`miller`/`old mill`/`old-mill`, so groups actually form. */
function mixedBook() {
    const list = Array.from({ length: ENTRIES }, (_, i) => {
        const full = sharedKeyWords(i, KEYS);
        const keys = full.map((k, j) => (j === 0 ? k.split(' ').slice(0, 1 + (i % 3)).join(' ')
            : j === 1 ? k.split(' ').slice(0, 2).join(' ')
            : j === 2 ? 'mill' : 'old mill'));
        if (i % 17 === 0) keys[2] = 'miller';
        if (i % 19 === 0) keys[3] = 'old-mill';
        return e(i, keys, { id: `clash-mixed-${i}` }, { world: 'Clash mixed' });
    });
    return { entries: Object.fromEntries(list.map(x => [x.uid, x])) };
}

function timed(data) {
    const t0 = clock();
    const result = keywordClashes(data);
    return { coldMs: Math.round((clock() - t0) * 1000) / 1000, groups: result.groups.length };
}

function coldOnce() {
    return { uniform: timed(sharedBook()), mixed: timed(mixedBook()) };
}

export async function run({ sink }) {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
    const { uniform, mixed } = JSON.parse(out);
    sink.add({
        bench: 'bench-clash',
        metric: 'cold-fresh-process',
        fixture: { entries: ENTRIES, keys: KEYS, distinctKeys: ENTRIES * KEYS, keyShape: 'shared vocabulary, five-word keys' },
        groups: uniform.groups,
        ...summarize([uniform.coldMs]),
    });
    sink.add({
        bench: 'bench-clash',
        metric: 'cold-fresh-process',
        fixture: { entries: ENTRIES, keys: KEYS, distinctKeys: ENTRIES * KEYS, keyShape: 'shared vocabulary, mixed 1-3 word keys' },
        groups: mixed.groups,
        ...summarize([mixed.coldMs]),
    });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    process.stdout.write(JSON.stringify(coldOnce()) + '\n');
}
