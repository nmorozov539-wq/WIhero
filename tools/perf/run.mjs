// Runs the in-repo benchmark harness (docs/optimization-pass/PLAN.md, B0).
//
//   node tools/perf/run.mjs                 all benches at the plan's scales
//   node tools/perf/run.mjs --smoke         tiny sizes, a determinism check, under three seconds
//   node tools/perf/run.mjs --out <path>    also write the whole run as a JSON array
//
// One JSON line per measurement on stdout; each line carries the machine label and the fixture shape.
import { writeFileSync } from 'node:fs';
import { createSink } from './timing.mjs';
import * as generation from './bench-generation.mjs';
import * as trackers from './bench-trackers.mjs';
import * as rebuild from './bench-rebuild.mjs';
import * as clash from './bench-clash.mjs';
import * as collator from './bench-collator.mjs';
import * as history from './bench-history.mjs';
import * as behavior from './behavior.mjs';

const BENCHES = [
    ['generation', generation],
    ['trackers', trackers],
    ['rebuild', rebuild],
    ['clash', clash],
    ['collator', collator],
    ['history', history],
    ['behavior', behavior],
];

function args(argv) {
    const out = { smoke: false, file: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--smoke') out.smoke = true;
        else if (arg === '--out') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--out needs a path');
            out.file = argv[++i];
        } else if (arg.startsWith('--out=')) out.file = arg.slice('--out='.length);
        else throw new Error(`unknown argument: ${arg}`);
    }
    return out;
}

/** Smoke is also the only place a tiny assertion runs: deterministic hash, zero rebuilds, counts are counted. */
function checkSmoke(records) {
    const first = behavior.fingerprint().behaviorHash;
    const second = behavior.fingerprint().behaviorHash;
    if (first !== second) throw new Error(`behavior hash is not deterministic: ${first} then ${second}`);
    for (const record of records.filter(x => x.bench === 'bench-rebuild')) {
        if (record.rebuilds !== 0) throw new Error(`model rebuilt ${record.rebuilds} times at ${record.fixture.entries} entries`);
    }
    for (const record of records.filter(x => x.bench === 'bench-generation' && x.metric === 'counts')) {
        if (!(record.jsonStringifyCalls > 0)) throw new Error('no JSON.stringify calls counted in a generation');
    }
    return first;
}

async function main() {
    const options = args(process.argv.slice(2));
    const sink = createSink();
    const started = performance.now();
    for (const [, bench] of BENCHES) await bench.run({ smoke: options.smoke, sink });
    if (options.smoke) {
        const hash = checkSmoke(sink.all);
        process.stderr.write(`smoke ok; behaviorHash ${hash}\n`);
    }
    if (options.file) writeFileSync(options.file, JSON.stringify(sink.all, null, 2) + '\n');
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    process.stderr.write(`${sink.all.length} measurements in ${seconds}s${options.file ? `; written to ${options.file}` : ''}\n`);
}

main().catch(error => {
    process.stderr.write(`perf run failed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
});
