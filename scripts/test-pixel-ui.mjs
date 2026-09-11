import assert from 'node:assert/strict';
import { fitPixelTelemetry, pixelActionLayout, pixelHudLayout } from '../src/ui/pixel-layout.js';

for (const width of [320, 480, 640, 960]) {
  const hud = pixelHudLayout(width);
  assert.ok(hud.topHeight >= 26);
  assert.ok(hud.bottomHeight >= 43);
  for (const button of [...hud.left, ...hud.right]) {
    assert.equal(button.height, 17);
    assert.ok(button.x >= 0 && button.x + button.width <= width);
  }
}

const narrow = pixelHudLayout(320);
assert.equal(narrow.bottomHeight, 64, 'commands take a second row instead of colliding');
const wide = pixelHudLayout(960);
assert.equal(wide.valueScale, 2, 'key pixel metrics gain a larger display scale on wide screens');

const telemetry = fitPixelTelemetry([
  { lines: ['short'] }, { lines: ['this is too wide'] }, { lines: ['later'] }
], 0, 75);
assert.deepEqual(telemetry.map((item) => item.lines[0]), ['short', 'later']);

const actions = [
  { y: 31 }, { y: 47 }, { y: 63 }, { y: 79 }, { y: 79 }
];
const page = pixelActionLayout(actions, 98);
assert.equal(page.pages, 4, 'tall tower menus paginate before crossing the hud');
assert.ok(page.height <= 98);
assert.equal(pixelActionLayout(actions, 98, 99).page, 3, 'out-of-range pages clamp');
console.log('pixel ui: hierarchy, narrow reflow, telemetry clipping, and action pagination passed');
