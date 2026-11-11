// The canvas input's pure parts: the wheel (zoom or scroll), the pinch camera (two fingers pan and zoom at once),
// and the link magnet (a drop near a card lands on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelMove } from '../src/ui/canvas-mouse.js';
import { pinchCamera } from '../src/ui/canvas-touch.js';
import { MAGNET, nearCard } from '../src/ui/canvas-input.js';

const wheel = (o = {}) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('the wheel zooms by the size of the scroll: a mouse notch is about the old 10% step, a trackpad nudge a little', () => {
    const notch = wheelMove(wheel({ deltaY: 100 })).zoom;
    assert.ok(notch < 1 && notch > 0.88, `a notch down zooms out about 10% (${notch})`);
    close(wheelMove(wheel({ deltaY: -100 })).zoom, 1 / notch);
    const nudge = wheelMove(wheel({ deltaY: 4 })).zoom;
    assert.ok(nudge > 0.99 && nudge < 1, `a trackpad's small event zooms a little (${nudge})`);
    // A runaway delta (a fast flick) is capped at one notch.
    close(wheelMove(wheel({ deltaY: 2000 })).zoom, notch);
    // Lines (Firefox) count as 16px each.
    close(wheelMove(wheel({ deltaY: 3, deltaMode: 1 })).zoom, wheelMove(wheel({ deltaY: 48 })).zoom);
});

test('Ctrl+wheel (and a trackpad pinch) zooms in either wheel mode; Shift+wheel pans sideways', () => {
    for (const mode of ['zoom', 'scroll']) {
        const z = wheelMove(wheel({ deltaY: -5, ctrlKey: true }), mode).zoom;
        assert.ok(z > 1.04 && z < 1.06, `${mode}: a pinch out zooms in (${z})`);
        // A mouse's Ctrl+notch is capped at 10%.
        close(wheelMove(wheel({ deltaY: 100, ctrlKey: true }), mode).zoom, Math.exp(-0.1));
        assert.deepEqual(wheelMove(wheel({ deltaY: 30, shiftKey: true }), mode), { pan: [-30, 0] });
        assert.deepEqual(wheelMove(wheel({ deltaX: 30, shiftKey: true }), mode), { pan: [-30, 0] });
    }
});

test('in Scroll mode two fingers pan; in Zoom mode a sideways swipe still pans sideways', () => {
    assert.deepEqual(wheelMove(wheel({ deltaX: 12, deltaY: -40 }), 'scroll'), { pan: [-12, 40] });
    assert.deepEqual(wheelMove(wheel({ deltaX: 40, deltaY: 5 }), 'zoom'), { pan: [-40, 0] });
    assert.ok(wheelMove(wheel({ deltaX: 5, deltaY: 40 }), 'zoom').zoom < 1);
});

test('a pinch keeps the point under the fingers under them: moving both fingers pans, spreading them zooms', () => {
    // Fingers 100px apart around (200, 300), camera at 1x with the world shifted by (50, 20).
    const v = { tx: 50, ty: 20, scale: 1 };
    const p0 = { d: 100, s: v.scale, wx: (200 - v.tx) / v.scale, wy: (300 - v.ty) / v.scale };
    // Both fingers move 40px right, no spread: a pure pan.
    assert.deepEqual(pinchCamera(p0, 240, 300, 100), { scale: 1, tx: 90, ty: 20 });
    // Spread to 200px in place: 2x, the world point under the midpoint stays put.
    const z = pinchCamera(p0, 200, 300, 200);
    assert.equal(z.scale, 2);
    close((200 - z.tx) / z.scale, p0.wx);
    close((300 - z.ty) / z.scale, p0.wy);
    // Zoom is held to 25–200%.
    assert.equal(pinchCamera(p0, 200, 300, 1000).scale, 2);
    assert.equal(pinchCamera(p0, 200, 300, 5).scale, 0.25);
});

test('the magnet: a drop within reach of a card lands on the nearest one; a card beats the pack frame around it', () => {
    const R = new Map([
        ['pack:q', { key: 'pack:q', x: 600, y: 0, w: 10, h: 10, pack: 'q' }],
        ['id:a', { key: 'id:a', x: 0, y: 0, w: 100, h: 50 }],
        ['id:b', { key: 'id:b', x: 300, y: 0, w: 100, h: 50 }],
        ['pack:p', { key: 'pack:p', x: 280, y: -20, w: 140, h: 90, pack: 'p' }],
    ]);
    assert.equal(nearCard(R, 110, 25, 24), 'id:a', '10px right of a');
    assert.equal(nearCard(R, 150, 25, 24), null, 'too far from both');
    assert.equal(nearCard(R, 290, 25, 24), 'id:b', 'inside the frame, 10px left of b: b, not the frame');
    assert.equal(nearCard(R, 110, 25, 24, 'id:a'), null, 'not counting the source');
    assert.equal(nearCard(R, 615, 5, 24), 'pack:q', 'a pack frame alone is a target too');
    assert.ok(MAGNET.touch > MAGNET.mouse, 'a finger gets a wider magnet');
});
