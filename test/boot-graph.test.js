// Pin the L1 boot boundary with the committed graph tool (tools/boot-graph.mjs): index.js must not reach the editor
// statically, while the engine side stays eager. measured-native, Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootGraph } from '../tools/boot-graph.mjs';

const graph = bootGraph();

test('the editor subtree is behind a dynamic import, not in the boot graph', () => {
    assert.ok(graph.eager.includes('index.js'));
    assert.equal(graph.eager.includes('src/ui/app.js'), false, 'app.js is not parsed while ST launches');
    assert.equal(graph.deferred.includes('src/ui/app.js'), true);
    assert.deepEqual(graph.roots, ['src/ui/app.js'], 'the editor chunk starts at app.js');
    for (const module of ['src/ui/canvas.js', 'src/ui/desk.js', 'src/ui/normal.js', 'src/ui/menus.js', 'src/link-engine/index.js']) {
        assert.equal(graph.deferred.includes(module), true, `${module} moved with the editor`);
    }
});

test('the engine side stays eager', () => {
    for (const module of ['src/st-hooks.js', 'src/ui/st-books.js', 'src/panel.js', 'src/bubble.js', 'src/ui/data.js', 'src/compat.js']) {
        assert.equal(graph.eager.includes(module), true, `${module} still starts with the extension`);
    }
});

test('the eager and deferred halves partition the reachable modules, and the editor is the larger half', () => {
    const both = new Set([...graph.eager, ...graph.deferred]);
    assert.equal(graph.total.length, both.size);
    assert.equal(graph.eager.length + graph.deferred.length, graph.total.length);
    assert.ok(graph.eagerBytes < graph.deferredBytes, `${graph.eagerBytes} vs ${graph.deferredBytes}`);
});
