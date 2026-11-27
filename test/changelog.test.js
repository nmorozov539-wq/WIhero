// The in-app changelog (src/changelog.js): newest first, readable, and in step with the released version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGELOG } from '../src/changelog.js';
import { notesVersion } from '../src/ui/patch-notes.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const semver = (a, b) => a.localeCompare(b, undefined, { numeric: true });

test('changelog: the top entry is the released version', () => {
    assert.equal(CHANGELOG[0].version, manifest.version);
    assert.equal(notesVersion, manifest.version);
});

test('changelog: versions are unique and newest first', () => {
    const versions = CHANGELOG.map(x => x.version);
    assert.equal(new Set(versions).size, versions.length);
    assert.deepEqual(versions, [...versions].sort(semver).reverse());
});

test('changelog: every entry has a date and readable groups', () => {
    for (const entry of CHANGELOG) {
        assert.match(entry.version, /^\d+\.\d+\.\d+$/, entry.version);
        assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.version);
        assert.ok(entry.groups.length > 0, `${entry.version} has no groups`);
        for (const group of entry.groups) {
            assert.ok(group.title.trim(), `${entry.version} has an untitled group`);
            assert.ok(group.items.length > 0, `${entry.version} / ${group.title} has no lines`);
            for (const item of group.items) {
                assert.ok(item.trim(), `${entry.version} / ${group.title} has an empty line`);
                assert.ok(item.trim().endsWith('.'), `${entry.version} / ${group.title}: "${item}" does not end with a full stop`);
            }
        }
    }
});
