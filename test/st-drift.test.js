// The ST drift check's pieces (tools/st-drift.mjs, review finding 12), on made-up files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, extract } from '../tools/st-drift.mjs';

test('extract: a function through its balanced braces, or one line', () => {
    const text = 'x\nexport function getStringHash(str, seed = 0) {\n    if (x) { y(); }\n    return 1;\n}\nafter';
    assert.equal(extract(text, 'export function getStringHash('), 'export function getStringHash(str, seed = 0) {\n    if (x) { y(); }\n    return 1;\n}');
    assert.equal(extract('a\nconst K = [1];\nb', 'const K =', true), 'const K = [1];');
    assert.equal(extract(text, 'function missing('), null);
});

test('check: a missing file reports every piece in it gone; pins catch a changed body, not reindenting', () => {
    const files = { 'public/scripts/utils.js': 'export function getStringHash(s) {\n  return 1;\n}' };
    const first = check(f => files[f] ?? null, null);
    assert.ok(first.problems.some(p => p.startsWith('gone: public/scripts/world-info.js')));
    assert.ok(first.problems.includes('events.js has no CHAT_CHANGED event'));
    const key = 'public/scripts/utils.js export function getStringHash(';
    const pins = { [key]: first.pins[key] };
    files['public/scripts/utils.js'] = 'export function getStringHash(s) {\n        return 1;\n\n}';
    assert.ok(!check(f => files[f] ?? null, pins).problems.some(p => p.startsWith('changed:')), 'only indentation changed');
    files['public/scripts/utils.js'] = 'export function getStringHash(s) {\n  return 2;\n}';
    assert.ok(check(f => files[f] ?? null, pins).problems.includes(`changed: ${key} (src/engine/util.js copies it; greeting fingerprints depend on it)`));
});
