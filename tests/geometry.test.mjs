// Real tests (plain Node) for lib/character/geometry.js: where the character stands. Run: node tests/geometry.test.mjs
import assert from 'node:assert/strict';
import {layoutBounds, SIDE_MARGIN, FLOOR_INSET} from '../lib/character/geometry.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };
const charWidth = h => Math.round(h * 173 / 480);

test('the floor inset is zero and the side margin is not applied to the bottom (the 0.3.0 bug)', () => {
    assert.equal(FLOOR_INSET, 0); assert.equal(SIDE_MARGIN, 24);
    const b = layoutBounds({areaWidth: 1920, areaHeight: 1080, charWidth: 87, charHeight: 240});
    assert.equal(b.baseY, 1080 - 240);               // 0.3.0 gave 1080 - 240 - 24
});

test('the sprite box ends exactly at the bottom of the work area for every supported height and area', () => {
    for (const areaHeight of [600, 768, 800, 1080, 1440, 2160]) for (let h = 120; h <= 480; h += 20) {
        const b = layoutBounds({areaWidth: 1920, areaHeight, charWidth: charWidth(h), charHeight: h});
        assert.equal(b.baseY + h, areaHeight, `area ${areaHeight}, height ${h}`);
    }
});

test('horizontal limits keep the side margin on both edges and stay ordered, even in a very narrow area', () => {
    const b = layoutBounds({areaWidth: 1920, areaHeight: 1080, charWidth: 87, charHeight: 240});
    assert.equal(b.minX, 24); assert.equal(b.maxX, 1920 - 87 - 24);
    const narrow = layoutBounds({areaWidth: 100, areaHeight: 1080, charWidth: 87, charHeight: 240}); assert.ok(narrow.maxX >= narrow.minX);
});

test('a character taller than the work area is clamped to the top instead of a negative position', () => {
    assert.equal(layoutBounds({areaWidth: 800, areaHeight: 300, charWidth: 100, charHeight: 480}).baseY, 0);
});

test('a work-area change moves the floor with it (panel or dock reserved space)', () => {
    const before = layoutBounds({areaWidth: 1920, areaHeight: 1080, charWidth: 87, charHeight: 240});
    const after = layoutBounds({areaWidth: 1920, areaHeight: 1048, charWidth: 87, charHeight: 240});     // 32 px reserved by a bar
    assert.equal(before.baseY - after.baseY, 32);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
