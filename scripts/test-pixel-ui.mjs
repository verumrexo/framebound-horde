import assert from 'node:assert/strict';
import { fitPixelTelemetry, pixelActionLayout, pixelHudLayout } from '../src/ui/pixel-layout.js';
import { attachedPanelPosition, catalogLayout, centeredPanel, coopMenuLayout, defeatLayout, escapeMenuLayout,
  mainMenuLayout, mapSelectionLayout } from '../src/ui/panel-layout.js';

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
// Panel geometry: every menu stays inside the viewport at every supported size, tiers
// and thumbnails appear only when there is room, and attached panels flip cleanly.
const viewports = [[320, 180], [480, 270], [640, 360], [960, 540]];
const within = (panel, viewport) => {
  assert.ok(panel.x >= 0 && panel.y >= 0, 'panel origin inside viewport');
  assert.ok(panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height, 'panel fits viewport');
  for (const value of [panel.x, panel.y, panel.width, panel.height]) assert.ok(Number.isInteger(value), 'integer geometry');
};
for (const [width, height] of viewports) {
  const viewport = { width, height };
  within(centeredPanel(viewport, 999, 999), viewport);
  const menu = mainMenuLayout(viewport);
  within(menu, viewport);
  assert.ok(menu.rows.divider > menu.rows.secondary + 17 && menu.rows.coop > menu.rows.divider, 'tier divider sits between the run and session tiers');
  for (const networkActive of [false, true]) for (const page of ['main', 'options', 'help']) {
    const escape = escapeMenuLayout(viewport, { page, networkActive });
    within(escape, viewport);
    if (page === 'main') {
      const rows = networkActive ? 6 : 5;
      assert.ok(escape.rowY(rows - 1) + 17 <= escape.y + escape.height - 14, `escape rows clear the footer at ${width}x${height}`);
      if (escape.compact) assert.equal(escape.dividerY, null, 'compact menus drop the divider');
      else assert.ok(escape.dividerY > escape.rowY(1) + 17 && escape.dividerY < escape.rowY(2), 'divider separates the tiers');
      if (escape.thumbnail) assert.ok(escape.thumbnail.x + escape.thumbnail.width <= escape.x + escape.width - 16 && escape.runTierWidth < escape.buttonWidth);
    }
  }
  within(coopMenuLayout(viewport), viewport);
  const defeat = defeatLayout(viewport);
  within(defeat, viewport);
  assert.ok(defeat.rows.retry < defeat.rows.map && defeat.rows.map < defeat.rows.menu && defeat.rows.menu + 17 <= defeat.height);
  assert.ok(defeat.reactor.x + 43 <= defeat.x + defeat.width, 'reactor sprite stays inside the defeat panel');
  if (defeat.thumbnail) assert.ok(defeat.thumbnail.x + defeat.thumbnail.width < defeat.reactor.x);
  for (const mapCount of [3, 7, 9]) {
    const selection = mapSelectionLayout(viewport, mapCount);
    within(selection, viewport);
    assert.equal(Boolean(selection.thumbnail), selection.showThumbnail);
    if (selection.thumbnail) {
      assert.ok(selection.thumbnail.x >= selection.listX + selection.listWidth, 'thumbnail sits beside the list');
      assert.ok(selection.thumbnail.x + selection.thumbnail.width <= selection.x + selection.width - 16);
      assert.ok(selection.thumbnail.y + selection.thumbnail.height <= selection.paceY - 4, 'thumbnail clears the pace row');
    } else assert.equal(selection.listWidth, selection.width - 32, 'narrow panels keep the full-width list');
  }
  const catalog = catalogLayout(viewport, 26, height - 43, 4, 27);
  assert.ok(catalog.x >= 0 && catalog.x + catalog.width <= width && catalog.y >= 26 + 5);
  assert.equal(catalog.rowsTop + 4 * catalog.rowPitch <= catalog.footerY, true, 'catalog rows never overlap the footer');
  const hudTop = 26, hudBottom = height - 43;
  const high = attachedPanelPosition({ x: width / 2, y: hudTop + 20 }, 200, 90, viewport, hudTop, hudBottom);
  assert.equal(high.above, false, 'panels flip below when the top hud blocks them');
  const low = attachedPanelPosition({ x: width / 2, y: hudBottom - 10 }, 200, 90, viewport, hudTop, hudBottom);
  assert.ok(low.y >= hudTop + 4 && low.y + 90 <= Math.max(hudTop + 4 + 90, hudBottom - 4), 'panels clamp inside the playable band');
  const edge = attachedPanelPosition({ x: 0, y: height / 2 }, 200, 90, viewport, hudTop, hudBottom);
  assert.ok(edge.x >= 5 && edge.connectorX >= edge.x + 7 && edge.connectorX <= edge.x + 192, 'connector meets the panel span');
}
assert.ok(mapSelectionLayout({ width: 360, height: 400 }, 7).thumbnail === null, 'thumbnail needs a wide panel');
assert.ok(escapeMenuLayout({ width: 640, height: 150 }, {}).compact, 'short viewports compact the escape menu');
console.log('pixel ui: hierarchy, narrow reflow, telemetry clipping, action pagination and panel geometry passed');
