// H3: the phrase-enumeration clash scan must return exactly what the old whole-word pair scan returned, on the
// shared-vocabulary shape B0 measured (1,000 entries × 4 keys each), with punctuation, case, regex keys, Moments
// and permanent entries mixed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordClashes } from '../src/ui/clashes.js';
import { compareText, entriesOf, titleOf } from '../src/ui/data.js';
import { rawConfig } from '../src/engine/model.js';
import { e, sharedKeyWords } from '../tools/perf/fixture.mjs';

// ---------------------------------------------------------------- the old implementation, verbatim apart from perf

const norm = k => String(k).trim().toLowerCase().replace(/\s+/g, ' ');
const isRegex = k => /^\/.+\/[a-z]*$/.test(String(k).trim());
const BOUNDARY = /[\p{L}\p{N}]/u;

// The H1 `within`, with its per-word RegExp replaced by the same boundary rule written as indexOf checks. Compiling
// 4,000 distinct Unicode patterns makes the old scan itself a ~2 s cold path, which would make this oracle the very
// cost H3 removes; the pair scan and candidate narrowing above it are the old algorithm and stay unchanged.
function oldWithin(word, key) {
    if (key.length <= word.length) return false;
    for (let at = key.indexOf(word); at !== -1; at = key.indexOf(word, at + 1)) {
        const before = at === 0 ? '' : key[at - 1];
        const after = at + word.length === key.length ? '' : key[at + word.length];
        if (!BOUNDARY.test(before) && !BOUNDARY.test(after)) return true;
    }
    return false;
}

const oldTokens = word => word.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function oldKeyed(e) {
    if (e.disable || e.constant) return false;
    if (rawConfig(e)?.moment === true) return false;
    return Array.isArray(e.key) && e.key.some(k => typeof k === 'string' && k.trim());
}

function oldClashes(data, skip = new Set()) {
    const entries = entriesOf(data).filter(e => oldKeyed(e) && !skip.has(e.uid));
    const words = new Map(); // normalized key → Set(uid)
    for (const e of entries) {
        const ks = [...new Set(e.key.filter(k => typeof k === 'string' && k.trim() && !isRegex(k)).map(norm))];
        for (const k of ks) { if (!words.has(k)) words.set(k, new Set()); words.get(k).add(e.uid); }
    }
    const all = [...words.keys()];
    const keyTokens = new Map();
    const tokenCount = new Map();
    for (const k of all) {
        const ts = [...new Set(oldTokens(k))];
        keyTokens.set(k, ts);
        for (const t of ts) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
    }
    const byToken = new Map();
    for (const k of all) {
        for (const t of keyTokens.get(k)) {
            if (tokenCount.get(t) < 2) continue;
            let set = byToken.get(t);
            if (!set) byToken.set(t, set = new Set());
            set.add(k);
        }
    }
    const groups = [];
    for (const w of all) {
        const uids = new Set(words.get(w));
        const first = keyTokens.get(w)[0];
        const candidates = first ? (tokenCount.get(first) > 1 ? byToken.get(first) : null) : all;
        if (candidates) for (const other of candidates) {
            if (other !== w && oldWithin(w, other)) for (const u of words.get(other)) uids.add(u);
        }
        if (uids.size > 1) groups.push({ word: w, uids: [...uids] });
    }
    groups.sort((a, b) => compareText(a.word, b.word));
    const byUid = new Map();
    for (const g of groups) for (const u of g.uids) {
        let list = byUid.get(u);
        if (!list) byUid.set(u, list = []);
        list.push(g);
    }
    const title = uid => titleOf(data.entries[uid]);
    return {
        groups,
        of(uid, key) {
            const k = norm(key);
            const hit = new Set();
            for (const g of byUid.get(uid) ?? []) {
                if (!(g.word === k || oldWithin(g.word, k))) continue;
                for (const u of g.uids) if (u !== uid) hit.add(u);
            }
            return [...hit].map(title);
        },
    };
}

// ---------------------------------------------------------------- the fixture

const ENTRIES = 1000;
const KEYS = 4;

/** 1,000 entries with four shared-vocabulary keys each, plus the punctuation and gating shapes real books have. */
function sharedBook() {
    const entries = [];
    for (let i = 0; i < ENTRIES; i++) {
        const keys = sharedKeyWords(i, KEYS);
        if (i % 50 === 25) {
            entries.push(e(i, keys, { id: `moment-${i}`, moment: true }, { comment: `Moment ${i}` }));
            continue;
        }
        if (i % 3 === 0) keys[0] = keys[0].toUpperCase();
        if (i % 7 === 0) keys[1] = `  ${keys[1].replaceAll(' ', '   ')}  `;
        if (i % 11 === 0) keys[2] = `${keys[2]} old-mill`;
        if (i % 11 === 1) keys[2] = `${keys[2]} old mill`;
        if (i % 11 === 3) keys[3] = 'old-mill';
        if (i % 11 === 4) keys[3] = 'old mill';
        if (i % 13 === 0) keys[3] = 'AT&T';
        if (i % 13 === 1) keys[3] = 'the AT&T line';
        if (i % 17 === 0) keys[0] = 'mill';
        if (i % 19 === 0) keys[1] = 'miller';
        if (i % 23 === 0) keys[2] = '/mill/i';
        if (i % 29 === 0) keys[3] = '***';
        if (i % 29 === 3) keys[3] = 'x *** y';
        if (i % 37 === 0) keys[0] = "'quoted'";
        if (i % 37 === 1) keys[0] = "say 'quoted' now";
        const permanent = i % 41 === 2;
        entries.push(e(i, keys, permanent ? { id: `permanent-${i}` } : undefined, {
            comment: `Entry ${i}`,
            ...(permanent ? { constant: true } : {}),
        }));
    }
    return { entries: Object.fromEntries(entries.map(x => [x.uid, x])) };
}

// ---------------------------------------------------------------- equivalence

test('clashes: phrase enumeration equals the old pair scan on 1,000 × 4 shared keys', () => {
    const data = sharedBook();
    const fresh = keywordClashes(data);
    const old = oldClashes(data);
    assert.deepEqual(fresh.groups, old.groups, 'the groups, their uids and their order match');
    for (const entry of Object.values(data.entries)) {
        for (const key of entry.key) {
            assert.deepEqual(fresh.of(entry.uid, key), old.of(entry.uid, key), `of(${entry.uid}, ${key})`);
        }
    }
});

test('clashes: a key with no alphanumeric token still clashes by whole-word boundaries', () => {
    const data = { entries: {
        1: { uid: 1, comment: 'A', key: ['***'] },
        2: { uid: 2, comment: 'B', key: ['x *** y'] },
        3: { uid: 3, comment: 'C', key: ['x*y'] },
    } };
    const c = keywordClashes(data);
    assert.deepEqual(c.groups, [{ word: '***', uids: [1, 2] }]);
    assert.deepEqual(c.of(1, '***'), ['B']);
    assert.deepEqual(c.of(3, 'x*y'), []);
});
