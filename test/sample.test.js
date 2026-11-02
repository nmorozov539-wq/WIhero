// The old build's sample book (examples/WIHero-Sample.json, old field names) behaves as before on the new engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sim } from './sim.js';

const book = JSON.parse(fs.readFileSync(new URL('../examples/WIHero-Sample.json', import.meta.url), 'utf8'));
const entries = () => Object.values(structuredClone(book.entries)).map(e => ({ ...e, world: 'Book' }));
const K = id => `Book/${id}`;

test('the sample book loads without problems', () => {
    const s = new Sim(entries());
    assert.deepEqual(s.model.issues.filter(i => !i.warning), []);
});

test('the chain advances: road, mill, tunnel, each closing the one before', () => {
    const s = new Sim(entries());
    assert.deepEqual(s.send('mill').filter(u => u !== 23), [], 'the mill waits for the road (Sky is permanent)');
    assert.ok(s.send('road').includes(0));
    assert.ok(s.send('mill').includes(1));
    assert.ok(s.state.closed[K('road')]);
    assert.ok(!s.send('road').includes(0));
    assert.ok(s.send('wheel').includes(2));
    assert.ok(s.state.closed[K('mill')]);
    assert.ok(s.send('village').includes(3), 'entries without story logic are plain World Info');
});

test('glue holds the storm until it passes', () => {
    const s = new Sim(entries());
    s.send('storm');
    assert.ok(s.send('quiet').includes(4));
    assert.ok(!s.send('the storm passes').includes(4));
    assert.ok(!s.send('storm').includes(4));
});

test('the switch picks one path, labels gate and close', () => {
    const s = new Sim(entries());
    s.send('fork');
    assert.deepEqual(s.send('left right').filter(u => u === 10 || u === 11), [10]);
    assert.ok(!s.send('right').includes(11));
    s.send('gatehouse');
    s.send('tavern');
    assert.ok(s.send('rumor market').includes(15));
    s.send('blaze');
    assert.ok(!s.send('tavern').includes(13));
});

test('the tower is ruined after the storm, and lit when picked', () => {
    const s = new Sim(entries());
    s.send('storm');
    s.send('tower');
    assert.equal(s.maskOf(12), 'ruined');
});
