import assert from 'node:assert/strict';
import { playableHudBounds, attachedPanelBounds } from '../src/ui/tactical-layout.js';

// Measured chrome stays in CSS pixels across the game's 1x / 2x display modes.
for (const scale of [1, 2]) {
  for (const viewport of [
    { width: 1440, height: 900, topHeight: 72, bottomHeight: 81 },
    { width: 640, height: 480, topHeight: 112, bottomHeight: 125 },
    { width: 320, height: 568, topHeight: 140, bottomHeight: 169 }
  ]) {
    const bounds = playableHudBounds({ ...viewport, scale });
    assert.equal(bounds.top * scale, viewport.topHeight);
    assert.equal(bounds.bottom * scale, viewport.height - viewport.bottomHeight);
    assert.equal(bounds.right * scale, viewport.width);
    for (const anchor of [{ x: -500, y: -500 }, { x: 5000, y: 5000 }, { x: viewport.width / 2, y: viewport.height / 2 }]) {
      const panel = attachedPanelBounds({ anchor, width: 288, height: 420, viewportWidth: viewport.width,
        top: bounds.top * scale, bottom: bounds.bottom * scale });
      assert.ok(panel.x >= 8 && panel.x + panel.width <= viewport.width - 8);
      assert.ok(panel.y >= viewport.topHeight + 8);
      assert.ok(panel.y + panel.height <= viewport.height - viewport.bottomHeight - 8);
    }
  }
}
const fixture = { width: 200, height: 120, viewportWidth: 800, top: 72, bottom: 520 };
assert.equal(attachedPanelBounds({ ...fixture, anchor: { x: 400, y: 300 } }).y, 164, 'prefer above the tower');
assert.equal(attachedPanelBounds({ ...fixture, anchor: { x: 400, y: 80 } }).y, 96, 'flip below near the top hud');
const tiny = attachedPanelBounds({ ...fixture, width: 288, height: 420, viewportWidth: 240, top: 80, bottom: 200, anchor: { x: 120, y: 100 } });
assert.equal(tiny.width, 224, 'shrink panel width instead of shrinking type');
assert.equal(tiny.height, 104, 'cap the panel height so its content can scroll');
const crowded = playableHudBounds({ width: 320, height: 180, scale: 1, topHeight: 140, bottomHeight: 120 });
assert.equal(crowded.top, crowded.bottom, 'overlapping chrome cannot invert playable bounds');
console.log('tactical layout: display scales, reflow, edge clamping, and scroll bounds passed');
