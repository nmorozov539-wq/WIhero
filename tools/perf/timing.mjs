// Timing and records for the in-repo benchmarks. Every record is one JSON line on stdout and carries the same
// machine label, so a pasted run can be read without the surrounding prose.
//
// The label policy from the plan: these are measured-native desktop Node numbers. CPU throttling does not exist in
// Node, so there is no 6x figure here; a browser at 6x is a comparison tool, not a phone prediction.
import { arch, cpus, platform, release, totalmem } from 'node:os';

export const LABEL = 'measured-native';
export const NATIVE_NOTE = 'native desktop Node; no CPU throttle; not a phone prediction';

/** Milliseconds, high resolution when Node has it. */
export function clock() {
    if (globalThis.performance?.now) return globalThis.performance.now();
    return Number(process.hrtime.bigint()) / 1e6;
}

let machineLabel = null;
/** Machine label data, worked out once per process. */
export function machine() {
    if (machineLabel) return machineLabel;
    const cpu = cpus()?.[0];
    machineLabel = {
        label: LABEL,
        note: NATIVE_NOTE,
        platform: platform(),
        arch: arch(),
        release,
        node: process.version,
        cpu: cpu?.model?.trim() ?? 'unknown',
        cores: cpus()?.length ?? 0,
        memoryGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    };
    return machineLabel;
}

/** Median and p95 (nearest rank) over per-sample milliseconds. */
export function summarize(times) {
    const list = [...times].sort((a, b) => a - b);
    const n = list.length;
    const at = q => list[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
    const round = x => Math.round(x * 1000) / 1000;
    return {
        samples: n,
        median: round(at(0.5)),
        p95: round(at(0.95)),
        min: round(list[0]),
        max: round(list[n - 1]),
        mean: round(list.reduce((a, b) => a + b, 0) / n),
    };
}

/**
 * Runs `fn` enough times to be worth reading: a few warm-up calls first (never timed), then at least `minSamples`,
 * stopping at `maxSamples` or once `budgetMs` of measured time has passed. A call is one sample.
 */
export function sample(fn, { warmup = 3, minSamples = 7, maxSamples = 80, budgetMs = 150 } = {}) {
    for (let i = 0; i < warmup; i++) fn();
    const times = [];
    let spent = 0;
    while (times.length < maxSamples && (times.length < minSamples || spent < budgetMs)) {
        const t0 = clock();
        fn();
        const dt = clock() - t0;
        times.push(dt);
        spent += dt;
    }
    return summarize(times);
}

/** One timed call, for work too expensive to repeat. */
export function once(fn) {
    const t0 = clock();
    fn();
    return Math.round((clock() - t0) * 1000) / 1000;
}

/** Async variant of `sample`, for benches that await the hooks. */
export async function sampleAsync(fn, { warmup = 2, minSamples = 5, maxSamples = 20, budgetMs = 150 } = {}) {
    for (let i = 0; i < warmup; i++) await fn();
    const times = [];
    let spent = 0;
    while (times.length < maxSamples && (times.length < minSamples || spent < budgetMs)) {
        const t0 = clock();
        await fn();
        const dt = clock() - t0;
        times.push(dt);
        spent += dt;
    }
    return summarize(times);
}

/**
 * Collects records. `add` prints one JSON line immediately and keeps the record for `--out`.
 * A record always has: bench, metric, label, machine, fixture, and (unless it is a count) the timing summary.
 */
export function createSink({ write = line => process.stdout.write(line + '\n') } = {}) {
    const all = [];
    return {
        all,
        add(record) {
            // Put the shared label fields first, then whatever the bench measured.
            const out = {
                bench: record.bench,
                metric: record.metric,
                label: LABEL,
                machine: machine(),
                fixture: record.fixture ?? {},
                ...Object.fromEntries(Object.entries(record).filter(([k]) => !['bench', 'metric', 'label', 'machine', 'fixture'].includes(k))),
            };
            all.push(out);
            write(JSON.stringify(out));
            return out;
        },
    };
}
