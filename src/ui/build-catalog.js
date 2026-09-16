import { viewport } from '../app/camera.js';
import { catalogDefinition } from '../app/queries.js';
import { closeBuildCatalog, selectBulkPlacementDefinition } from '../app/tower-actions.js';
import { registerHitbox } from '../app/ui-state.js';
import { compactMetric } from '../core/format.js';
import { purchaseCost } from '../core/network-descendants.js';
import { towerBuildQuote } from '../core/tower-catalog.js';
import { TOWER_PORTRAIT_SIZE, drawTowerPortrait } from '../render/tower-sprites.js';
import { BUILD_CATALOG_PAGES } from './catalog-data.js';
import { COLOR, towerAccent } from './palette.js';
import { catalogLayout } from './panel-layout.js';
import { clippedUiText, drawButton, drawTechPanel, pointInside } from './widgets.js';

// Catalog rows carry the real body in a left socket plus a two-line label, so price
// survives narrow columns instead of being dropped when a single line overflows.

export const CATALOG_ENTRY_HEIGHT = TOWER_PORTRAIT_SIZE + 2;

export function drawCatalogEntry(app, id, definitionId, title, price, x, y, width, accent, action) {
  const height = CATALOG_ENTRY_HEIGHT;
  const hovered = pointInside(app, x, y, width, height);
  const live = hovered ? accent : COLOR.dimMint;
  app.renderer.shapes.rect(x, y, width, height, COLOR.black);
  app.renderer.shapes.rect(x, y, width, 1, live);
  app.renderer.shapes.rect(x, y + height - 1, width, 1, live);
  app.renderer.shapes.rect(x, y, hovered ? 3 : 1, height, live);
  app.renderer.shapes.rect(x + width - 1, y + 3, 1, height - 6, live);
  const socketX = x + 4;
  drawTowerPortrait(app.renderer.shapes, COLOR, socketX, y + 1, definitionId);
  app.renderer.shapes.rect(socketX + TOWER_PORTRAIT_SIZE + 1, y + 4, 1, height - 8, COLOR.dimMint);
  const textX = socketX + TOWER_PORTRAIT_SIZE + 5;
  const textWidth = x + width - 4 - textX;
  app.renderer.bitmapText.draw(clippedUiText(title, textWidth), textX, y + (price ? 5 : 10), hovered ? accent : COLOR.ink, 1);
  if (price) app.renderer.bitmapText.draw(clippedUiText(price, textWidth), textX, y + 15, accent === COLOR.red ? COLOR.red : COLOR.amber, 1);
  registerHitbox(app, id, x, y, width, height, { action });
}

export function drawBuildCatalog(app, snapshot) {
  if (!app.ui.buildCatalogOpen) return;
  const page = BUILD_CATALOG_PAGES[app.ui.buildCatalogPageId];
  if (!page) return;
  const economy = snapshot.teamEconomy || { credits: 0 };
  const layout = catalogLayout(viewport(app), app.viewport.HUD_TOP_HEIGHT, app.viewport.hudBottomY, page.rows.length, CATALOG_ENTRY_HEIGHT);
  const { x, y, width, height } = layout;
  drawTechPanel(app, x, y, width, height, COLOR.amber);
  app.renderer.shapes.rect(x + 8, y + 6, 2, 11, COLOR.amber);
  app.renderer.bitmapText.draw(app.game.sessionMode === 'test' ? 'form catalog' : 'tower catalog', x + 16, y + 7, COLOR.amber, 1);
  drawButton(app, 'catalog_page_core', 'core', x + 102, y + 4, 34, app.ui.buildCatalogPageId === 'core', COLOR.mint, () => { app.ui.buildCatalogPageId = 'core'; });
  drawButton(app, 'catalog_page_assault', 'assault iii', x + 140, y + 4, 70, app.ui.buildCatalogPageId === 'assault', COLOR.amber, () => { app.ui.buildCatalogPageId = 'assault'; });
  drawButton(app, 'catalog_page_tether', 'tether iii', x + 214, y + 4, 66, app.ui.buildCatalogPageId === 'tether', COLOR.cyan, () => { app.ui.buildCatalogPageId = 'tether'; });
  drawButton(app, 'catalog_page_network', 'network iii', x + 284, y + 4, 70, app.ui.buildCatalogPageId === 'network', COLOR.green, () => { app.ui.buildCatalogPageId = 'network'; });
  drawButton(app, 'build_catalog_close', app.game.sessionMode === 'test' ? 'u close' : 'b close', x + width - 50, y + 4, 43, false, COLOR.cyan, closeBuildCatalog.bind(null, app));

  const innerX = x + layout.innerX;
  const innerWidth = layout.innerWidth;
  page.rows.forEach((row, rowIndex) => {
    const rowY = y + layout.rowsTop + rowIndex * layout.rowPitch;
    const gap = 3;
    const buttonWidth = row.length === 1 ? 118 : Math.floor((innerWidth - gap * (row.length - 1)) / row.length);
    row.forEach((entry, columnIndex) => {
      const definition = catalogDefinition(snapshot, entry.definitionId);
      const quote = towerBuildQuote(snapshot.towerCatalog, entry.definitionId);
      if (!definition || !quote) return;
      const price = purchaseCost(snapshot, null, quote.cost, { placement: true, escalatableCost: quote.rootCost });
      const affordable = app.game.sessionMode === 'test' || snapshot.dev?.infiniteMoney || economy.credits >= price;
      drawCatalogEntry(app,
        `build_catalog_${entry.definitionId}`,
        entry.definitionId,
        `${entry.key} ${definition.label}`,
        app.game.sessionMode === 'test' ? '' : `${compactMetric(price)} cr`,
        innerX + columnIndex * (buttonWidth + gap),
        rowY,
        buttonWidth,
        affordable ? towerAccent(entry.definitionId) : COLOR.red,
        () => selectBulkPlacementDefinition(app, entry.definitionId)
      );
      if (!affordable) app.renderer.shapes.rect(innerX + columnIndex * (buttonWidth + gap) + buttonWidth - 4, rowY + 3, 2, 2, COLOR.red);
    });
    if (row.length === 1) app.renderer.bitmapText.draw('pick once // place repeatedly', innerX + 128, rowY + 10, COLOR.ink, 1);
  });
  app.renderer.bitmapText.draw(
    app.game.sessionMode === 'test'
      ? 'loads selected test tower // tab changes page // n opens network iii'
      : width < 390
        ? 'pick once // click many // right click ends'
        : 'valid nebula clicks keep building // right click cancels',
    x + 8,
    y + layout.footerY,
    COLOR.dimMint,
    1
  );
}
