import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortStatus, statusClass } from '../src/status.js';

test('shortStatus: one word per status, with the mask name', () => {
    const cases = {
        'not gated': null,
        open: 'open',
        'gate open': 'open',
        'waiting for road and #town': 'waiting',
        closed: 'closed',
        'closed (switch: took right)': 'closed',
        'sticky (closed)': 'sticky',
        glued: 'glued',
        'config problem': 'problem',
        'open · mask: ruined': 'open · ruined',
        'sticky (closed) · mask: lit': 'sticky · lit',
    };
    for (const [status, short] of Object.entries(cases)) assert.equal(shortStatus(status), short, status);
});

test('statusClass is the panel\'s class: the first word', () => {
    assert.equal(statusClass('waiting for x'), 'wihero-status-waiting');
    assert.equal(statusClass('closed (switch: took right)'), 'wihero-status-closed');
});
