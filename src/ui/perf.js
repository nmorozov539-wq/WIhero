// Process-wide perf counters for the optimization pass (docs/optimization-pass/PLAN.md, B0). Counters are always
// on and are plain integer increments; timing regions are opt-in (`perf.timing = true`) and allocate nothing while
// they are off. No DOM, no SillyTavern, no imports: Node tests and the browser harness share this module.
//
// A timing region is used with begin/end so no callback is allocated on the hot path:
//     const at = perf.begin('sort');
//     const out = sortEntries(...);
//     perf.end(at);
// `perf.time(name, fn)` exists for occasional callers that can spend the closure.

const COUNTERS = [
    'appRenders', 'canvasRenders', 'modelBuilds', 'routeComputes', 'rowMounts', 'saveAttempts',
    'settingsSaves', 'historyCaptures', 'tokenCalls', 'serializedChars', 'searchRuns', 'searchIndexBuilds',
    // Windowing (src/ui/window.js): every draw, the draws that re-key the list, rows added/removed, layout reads and
    // ResizeObserver callbacks. Plain integer increments, so a scroll frame can be attributed without a profiler.
    'windowDraws', 'windowRangeDraws', 'windowSameDraws', 'windowForceDraws', 'windowRowsAdded',
    'windowRowsRemoved', 'windowRectReads', 'windowRoCalls', 'windowRoChanged', 'windowGapPasses', 'windowScanItems',
];
const REGIONS = ['model', 'clashScan', 'sort', 'rowMount', 'search', 'entryPage', 'canvasDraw', 'arrange', 'status', 'history', 'save', 'windowDraw'];

const counters = {};
for (const name of COUNTERS) counters[name] = 0;
const regions = {};
for (const name of REGIONS) regions[name] = { ms: 0, calls: 0 };

let timing = false;

const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export const perf = {
    /** Off by default: the regions below cost one clock read each only while this is true. */
    get timing() { return timing; },
    set timing(on) { timing = !!on; },

    /** Adds `n` to a counter. Unknown names are a programming error, not a silent NaN. */
    count(name, n = 1) {
        if (counters[name] === undefined) throw new Error(`unknown perf counter: ${name}`);
        counters[name] += n;
    },

    /** A timing token, or null when timing is off (no allocation then). */
    begin(name) {
        return timing ? { name, at: clock() } : null;
    },
    end(token) {
        if (!token) return;
        const region = regions[token.name];
        region.ms += clock() - token.at;
        region.calls++;
    },
    /** For callers that can afford a closure; begin/end is the hot-path form. */
    time(name, fn) {
        const token = this.begin(name);
        try { return fn(); } finally { this.end(token); }
    },

    /** One plain object: the counters, then each region's accumulated ms and call count. */
    snapshot() {
        const out = {};
        for (const name of COUNTERS) out[name] = counters[name];
        for (const name of REGIONS) {
            out[`${name}Ms`] = Math.round(regions[name].ms * 1000) / 1000;
            out[`${name}Calls`] = regions[name].calls;
        }
        out.timingEnabled = timing;
        return out;
    },

    /** Zeroes the counters and the timings; leaves the timing switch as it is. */
    reset() {
        for (const name of COUNTERS) counters[name] = 0;
        for (const name of REGIONS) { regions[name].ms = 0; regions[name].calls = 0; }
    },
};
