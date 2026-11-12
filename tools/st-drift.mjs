// ST drift check (review 2026-11-08, finding 12). WI Hero copies a few SillyTavern functions and leans on others it
// can't import; when ST changes one of them, WI Hero can go quietly wrong. This compares that code in a SillyTavern
// version (its latest release and its staging branch, by default) with the fingerprints taken on the version WI Hero
// is tested on (tools/st-drift.json), and checks that every export and event WI Hero uses is still there.
//
//   node tools/st-drift.mjs                 latest release and staging, from GitHub
//   node tools/st-drift.mjs 1.19.0 staging  those refs (tags or branches)
//   node tools/st-drift.mjs --dir ~/st      a local SillyTavern checkout
//   node tools/st-drift.mjs --update --dir ~/st   take the fingerprints again (after checking the changes by hand)
//
// Exits 1 with what changed. No dependencies; Node 18+.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PINS = new URL('./st-drift.json', import.meta.url);
const REPO = 'SillyTavern/SillyTavern';

/**
 * The code WI Hero mirrors or depends on, by file. `start` is where the piece begins in ST's file; the piece runs
 * to the end of the balanced braces after it (or to the end of the line for `line`).
 */
const PIECES = [
    { file: 'public/scripts/utils.js', start: 'export function getStringHash(', why: 'src/engine/util.js copies it; greeting fingerprints depend on it' },
    { file: 'public/scripts/world-info.js', start: 'export const worldInfoCache =', line: true, why: 'confirmed saves synchronize the cache and the raw object captured by native debounce' },
    { file: 'public/scripts/util/StructuredCloneMap.js', start: 'export class StructuredCloneMap', why: 'book-write.js relies on Map identity and the cache clone policy' },
    { file: 'public/scripts/world-info.js', start: 'export async function saveWorldInfo(', why: 'native debounced saves share their data object with worldInfoCache' },
    { file: 'public/scripts/world-info.js', start: 'async function _save(', why: 'native queued payloads must not overwrite confirmed extension writes' },
    { file: 'public/scripts/world-info.js', start: 'const KNOWN_DECORATORS =', line: true, why: 'src/timers.js copies it' },
    { file: 'public/scripts/world-info.js', start: 'function parseDecorators(', why: 'src/timers.js copies it' },
    { file: 'public/scripts/world-info.js', start: 'matchKeys(haystack, needle, entry) {', why: 'keywordOnSide (src/engine/turn.js) follows it' },
    { file: 'public/scripts/world-info.js', start: 'export function parseRegexFromString(', why: 'parseRegex (src/engine/util.js) follows it' },
    { file: 'public/scripts/world-info.js', start: '#checkTimedEffectOfType(', why: 'stickyHeld (src/timers.js) mirrors it' },
    { file: 'public/scripts/world-info.js', start: 'export const scan_state =', why: 'the scan hooks set scan_state.MIN_ACTIVATIONS' },
    { file: 'public/scripts/extensions.js', start: 'export async function runGenerationInterceptors(', why: 'the trackers\' prompt stripping is a generate interceptor' },
    { file: 'public/script.js', start: 'let coreChat = chat.filter(', line: true, why: 'scanLength (src/timers.js) and the interceptor\'s list' },
];

/** Names WI Hero reads from ST: exports of world-info.js and utils.js, and events. */
const WI_EXPORTS = [
    'getSortedEntries', 'parseRegexFromString', 'newWorldInfoEntryTemplate', 'deleteWorldInfo', 'METADATA_KEY', 'scan_state',
    'world_info_depth', 'world_info_case_sensitive', 'world_info_match_whole_words', 'charSetAuxWorlds', 'importWorldInfo',
    'onWorldInfoChange', 'selected_world_info', 'setWorldInfoButtonClass', 'world_info', 'world_names', 'world_info_budget',
    'world_info_budget_cap', 'world_info_character_strategy', 'world_info_include_names', 'world_info_max_recursion_steps',
    'world_info_min_activations', 'world_info_min_activations_depth_max', 'world_info_overflow_alert', 'world_info_recursive',
    'world_info_use_group_scoring', 'worldInfoCache',
];
const UTILS_EXPORTS = ['getStringHash'];
const EVENTS = [
    'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_STOPPED', 'WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE',
    'WORLD_INFO_ACTIVATED', 'WORLDINFO_FORCE_ACTIVATE', 'WORLDINFO_UPDATED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED',
    'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHAT_CHANGED',
];

const FILES = [...new Set([...PIECES.map(p => p.file), 'public/scripts/events.js'])];

/** The piece of `text` that starts at `start`: to the line's end, or through its balanced braces. */
export function extract(text, start, line = false) {
    const at = text.indexOf(start);
    if (at < 0) return null;
    if (line) { const end = text.indexOf('\n', at); return text.slice(at, end < 0 ? undefined : end); }
    const open = text.indexOf('{', at + start.length - 1);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
    }
    return null;
}

/** A fingerprint that ignores indentation and blank lines, so reformatting alone doesn't count. */
const fingerprint = code => crypto.createHash('sha256').update(code.split('\n').map(l => l.trim()).filter(Boolean).join('\n')).digest('hex').slice(0, 16);

const exportsName = (text, name) => new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${name}\\b`).test(text)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);

/** Checks one SillyTavern source. @returns {{ problems: string[], pins: Record<string, string> }} */
export function check(read, pins) {
    const problems = [];
    const now = {};
    const files = Object.fromEntries(FILES.map(f => [f, read(f)]));
    for (const p of PIECES) {
        const text = files[p.file];
        const key = `${p.file} ${p.start}`;
        const code = text == null ? null : extract(text, p.start, p.line);
        if (code == null) { problems.push(`gone: ${key} (${p.why})`); continue; }
        now[key] = fingerprint(code);
        if (pins && pins[key] && pins[key] !== now[key]) problems.push(`changed: ${key} (${p.why})`);
    }
    const wi = files['public/scripts/world-info.js'] ?? '';
    for (const n of WI_EXPORTS) if (!exportsName(wi, n)) problems.push(`world-info.js no longer exports ${n}`);
    const utils = files['public/scripts/utils.js'] ?? '';
    for (const n of UTILS_EXPORTS) if (!exportsName(utils, n)) problems.push(`utils.js no longer exports ${n}`);
    const events = files['public/scripts/events.js'] ?? '';
    for (const n of EVENTS) if (!new RegExp(`\\b${n}\\s*:`).test(events)) problems.push(`events.js has no ${n} event`);
    return { problems, pins: now };
}

async function fromGitHub(ref) {
    const out = {};
    for (const f of FILES) {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${f}`);
        out[f] = r.ok ? await r.text() : null;
    }
    return f => out[f];
}

async function latestRelease() {
    const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
    if (!r.ok) throw new Error(`could not read ST's latest release: ${r.status}`);
    return (await r.json()).tag_name;
}

async function main(argv) {
    const update = argv.includes('--update');
    const d = argv.indexOf('--dir');
    const dir = d >= 0 ? argv[d + 1] : null;
    const refs = argv.filter((a, i) => !a.startsWith('--') && !(d >= 0 && i === d + 1));
    const stored = JSON.parse(fs.readFileSync(PINS, 'utf8'));
    const sources = dir
        ? [[dir, f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } }]]
        : await Promise.all((refs.length ? refs : [await latestRelease(), 'staging']).map(async ref => [ref, await fromGitHub(ref)]));
    let failed = false;
    for (const [name, read] of sources) {
        const { problems, pins } = check(read, update ? null : stored.pins);
        if (update) {
            if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
            fs.writeFileSync(PINS, `${JSON.stringify({ taken: stored.taken, note: stored.note, pins }, null, 4)}\n`);
            console.log(`fingerprints taken from ${name}`);
            return;
        }
        if (problems.length) {
            failed = true;
            console.log(`SillyTavern ${name}: ${problems.length} change${problems.length > 1 ? 's' : ''} WI Hero depends on`);
            for (const p of problems) console.log(`  - ${p}`);
        } else {
            console.log(`SillyTavern ${name}: no drift from ${stored.taken}`);
        }
    }
    if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
