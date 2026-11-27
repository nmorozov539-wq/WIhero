// The boot import graph, measured-native with Node (L1). Walks every static import from index.js and every dynamic
// one, so the editor subtree deferred behind the drawer can be counted instead of guessed.
//
//   node tools/boot-graph.mjs                 the working tree
//   node tools/boot-graph.mjs --at HEAD~1     index.js as it was at a commit (the "before" side)
//   node tools/boot-graph.mjs --list          every eager and deferred module
//   node tools/boot-graph.mjs --json          machine-readable (test/boot-graph.test.js uses this)
//
// Files are counted as JS modules only. Imports that leave the repository (ST's world-info.js and utils.js in
// src/st.js) are not part of WI Hero's bundle and are skipped. Comments are stripped before parsing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Drops full-line comments and trailing `//` notes; enough that a comment naming an import is never counted. */
export function stripComments(source) {
    const out = [];
    let block = false;
    for (const line of source.split('\n')) {
        if (block) {
            if (line.includes('*/')) block = false;
            continue;
        }
        if (/^\s*\/\*/.test(line)) {
            if (!line.includes('*/')) block = true;
            continue;
        }
        if (/^\s*\/\//.test(line)) continue;
        out.push(line.replace(/\s+\/\/.*$/, ''));
    }
    return out.join('\n');
}

const STATIC_FROM = /\b(?:import|export)\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const STATIC_BARE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The module specifiers a source file names, split by how it asks for them. */
export function importsOf(source) {
    const staticSpecs = [];
    const dynamicSpecs = [];
    for (const match of source.matchAll(STATIC_FROM)) staticSpecs.push(match[1]);
    for (const match of source.matchAll(STATIC_BARE)) staticSpecs.push(match[1]);
    for (const match of source.matchAll(DYNAMIC)) dynamicSpecs.push(match[1]);
    return { static: staticSpecs, dynamic: dynamicSpecs };
}

function resolveSpecifier(root, from, specifier) {
    if (!specifier.startsWith('.')) return null; // a bare specifier is not a repo file
    const absolute = path.resolve(path.dirname(path.join(root, from)), specifier);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return null; // outside the bundle (ST's files)
    return path.relative(root, absolute).split(path.sep).join('/');
}

/**
 * @param {object} [options]
 *   root: repository root
 *   ref: a git revision to read every module from (default: the working tree)
 *   entry: the extension's entry module (default index.js)
 * @returns {{ entry, ref, eager, deferred, total, roots, missing, sizes }}
 *   eager/deferred/total: module paths, sorted; sizes: path → bytes
 */
export function bootGraph({ root = ROOT, ref = null, entry = 'index.js' } = {}) {
    const edges = new Map();
    const sizes = new Map();
    const missing = new Set();

    const read = rel => ref
        ? execFileSync('git', ['show', `${ref}:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        : fs.readFileSync(path.join(root, rel), 'utf8');

    function load(rel) {
        if (edges.has(rel)) return edges.get(rel);
        let source;
        try {
            source = read(rel);
        } catch {
            missing.add(rel);
            const empty = { static: [], dynamic: [] };
            edges.set(rel, empty);
            return empty;
        }
        const found = importsOf(stripComments(source));
        const out = { static: [], dynamic: [] };
        for (const spec of found.static) {
            const dep = resolveSpecifier(root, rel, spec);
            if (dep) out.static.push(dep);
        }
        for (const spec of found.dynamic) {
            const dep = resolveSpecifier(root, rel, spec);
            if (dep) out.dynamic.push(dep);
        }
        sizes.set(rel, Buffer.byteLength(source));
        edges.set(rel, out);
        return out;
    }

    /** BFS over the edge kinds asked for; `both` follows a dynamic import like a static one. */
    function closure(starts, kinds) {
        const seen = new Set();
        const queue = [...starts];
        while (queue.length) {
            const rel = queue.shift();
            if (seen.has(rel)) continue;
            seen.add(rel);
            const next = load(rel);
            if (kinds.static) for (const dep of next.static) if (!seen.has(dep)) queue.push(dep);
            if (kinds.dynamic) for (const dep of next.dynamic) if (!seen.has(dep)) queue.push(dep);
        }
        return seen;
    }

    const eager = closure([entry], { static: true, dynamic: false });
    const roots = new Set();
    for (const rel of eager) for (const dep of load(rel).dynamic) if (!eager.has(dep)) roots.add(dep);
    const reachable = closure([...roots], { static: true, dynamic: true });
    const deferred = new Set([...reachable].filter(rel => !eager.has(rel)));
    const total = new Set([...eager, ...deferred]);
    const sorted = set => [...set].sort();
    const bytes = set => [...set].reduce((n, rel) => n + (sizes.get(rel) ?? 0), 0);

    return {
        entry,
        ref,
        eager: sorted(eager),
        deferred: sorted(deferred),
        total: sorted(total),
        roots: sorted(roots),
        missing: sorted(missing),
        sizes: Object.fromEntries([...total].map(rel => [rel, sizes.get(rel) ?? 0])),
        eagerBytes: bytes(eager),
        deferredBytes: bytes(deferred),
        totalBytes: bytes(total),
    };
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;

function main() {
    const args = process.argv.slice(2);
    const at = args.includes('--at') ? args[args.indexOf('--at') + 1] : null;
    const list = args.includes('--list');
    const json = args.includes('--json');
    const graph = bootGraph({ ref: at });
    if (json) {
        console.log(JSON.stringify(graph, null, 2));
        return;
    }
    console.log(`WI Hero boot graph — ${at ? `at ${at}` : 'working tree'}; measured-native (Node ${process.version})`);
    console.log(`entry: ${graph.entry}`);
    console.log(`eager static:     ${String(graph.eager.length).padStart(3)} modules, ${kb(graph.eagerBytes).padStart(10)}`);
    console.log(`deferred editor:  ${String(graph.deferred.length).padStart(3)} modules, ${kb(graph.deferredBytes).padStart(10)}`);
    console.log(`total reachable:  ${String(graph.total.length).padStart(3)} modules, ${kb(graph.totalBytes).padStart(10)}`);
    console.log(`deferred roots:  ${graph.roots.join(', ') || '(none)'}`);
    if (graph.missing.length) console.log(`missing files (skipped): ${graph.missing.join(', ')}`);
    if (list) {
        for (const [label, set] of [['deferred editor', graph.deferred], ['eager', graph.eager]]) {
            console.log(`\n${label}:`);
            for (const rel of set) console.log(`  ${rel}  ${kb(graph.sizes[rel])}`);
        }
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
