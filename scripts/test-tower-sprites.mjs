import assert from 'node:assert/strict';
import { drawTowerSprite } from '../src/render/tower-sprites.js';
import { TOWER_DEFINITIONS, validateTowerCatalog } from '../src/core/tower-catalog.js';

const colors = Object.fromEntries(['black', 'amber', 'mint', 'cyan', 'green', 'red', 'ink', 'dimMint'].map(key => [key, key]));
assert.deepEqual(validateTowerCatalog(), []);
const signatures = new Map();
for (const id of Object.keys(TOWER_DEFINITIONS)) {
  for (const runTick of [0, 6, 24, 90, 180, 10000]) {
    for (const override of [null, { accent: 'preview', core: 'preview-core' }]) {
      const rects = [];
      // Deliberately provide no line/triangle/rotation API. Every catalog entry must render.
      drawTowerSprite({ rect: (...args) => rects.push(args) }, colors, { x: 0, y: 0 },
        { definitionId: id }, override, { runTick, controlActive: runTick === 0 });
      assert.ok(rects.length >= 5, `${id}: missing body`);
      for (const [x, y, width, height, color] of rects) {
        assert.ok([x, y, width, height].every(Number.isInteger), `${id}: noninteger geometry`);
        assert.ok(width > 0 && height > 0, `${id}: invalid rectangle`);
        assert.ok(x >= -16 && y >= -16 && x + width <= 17 && y + height <= 17, `${id}: oversized sprite`);
        assert.ok(color, `${id}: missing color`);
        if (override) assert.ok(['black', 'preview', 'preview-core'].includes(color), `${id}: preview tint ignored`);
      }
      if (runTick === 0 && !override) {
        const signature = JSON.stringify(rects);
        assert.ok(!signatures.has(signature), `${id}: duplicates ${signatures.get(signature)}`);
        signatures.set(signature, id);
      }
    }
  }
}
console.log(`${signatures.size} distinct tower sprites: rectangle-only geometry, bounds, animation phases and placement tints passed`);
