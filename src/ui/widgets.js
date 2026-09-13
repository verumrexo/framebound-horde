import { project, viewport } from '../app/camera.js';
import { registerHitbox } from '../app/ui-state.js';
import { COLOR } from './palette.js';
import { MENU_HEADER, attachedPanelPosition } from './panel-layout.js';

export function drawButton(app, id, label, x, y, width, active, color, action, height = 13) {
  const hovered = pointInside(app, x, y, width, height);
  app.renderer.shapes.rect(x, y, width, height, hovered ? [0.025, 0.10, 0.10, 1] : COLOR.black);
  app.renderer.shapes.rect(x, y, width, 1, active ? color : COLOR.dimMint);
  app.renderer.shapes.rect(x, y + height - 1, width, 1, active ? color : COLOR.dimMint);
  if (active) app.renderer.shapes.rect(x, y + 1, 2, height - 2, color);
  app.renderer.bitmapText.draw(clippedUiText(label, width - 8), x + 4, y + Math.floor((height - 7) / 2), active || hovered ? color : COLOR.ink, 1);
  registerHitbox(app, id, x, y, width, height, { action });
}

export function pointInside(app, x, y, width, height) {
  return app.ui.pointer.x >= x && app.ui.pointer.x <= x + width && app.ui.pointer.y >= y && app.ui.pointer.y <= y + height;
}

export function drawTechPanel(app, x, y, width, height, accent) {
  app.renderer.shapes.rect(x, y, width, height, COLOR.black);
  app.renderer.shapes.rect(x + 3, y, width - 6, 1, COLOR.dimMint);
  app.renderer.shapes.rect(x + 3, y + height - 1, width - 6, 1, COLOR.dimMint);
  app.renderer.shapes.rect(x, y + 3, 1, height - 6, COLOR.dimMint);
  app.renderer.shapes.rect(x + width - 1, y + 3, 1, height - 6, COLOR.dimMint);
  app.renderer.shapes.rect(x + 3, y, Math.min(34, width - 6), 2, accent);
  for (let i = 0; i < 3; i++) app.renderer.shapes.rect(x + width - 20 + i * 5, y, 3, 2, accent);
  app.renderer.shapes.rect(x, y + 3, 3, 1, accent);
  app.renderer.shapes.rect(x + width - 3, y + height - 1, 3, 1, accent);
  app.renderer.shapes.rect(x + width - 1, y + height - 4, 1, 3, accent);
}

export function drawMenuButton(app, id, label, x, y, width, accent, action, selected = false) {
  const hovered = pointInside(app, x, y, width, 17);
  app.renderer.shapes.rect(x, y, width, 17, COLOR.black);
  app.renderer.shapes.rect(x, y, width, 1, hovered || selected ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x, y + 16, width, 1, hovered || selected ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x, y, hovered || selected ? 3 : 1, 17, hovered || selected ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x + width - 1, y + 3, 1, 11, hovered ? accent : COLOR.dimMint);
  if (hovered) {
    app.renderer.shapes.rect(x + 6, y + 4, 3, 1, accent);
    app.renderer.shapes.rect(x + 6, y + 12, 3, 1, accent);
  }
  const textWidth = label.length * 6;
  app.renderer.bitmapText.draw(label, Math.round(x + (width - textWidth) * 0.5), y + 5, hovered || selected ? accent : COLOR.ink, 1);
  registerHitbox(app, id, x, y, width, 17, { action });
}

// Shared menu hierarchy: hard bookends, 2x title, machine sub-line, then an interrupted
// rule carrying one accent scar. Tiers of buttons are split by an interrupted divider.

export function drawMenuHeader(app, panel, title, titleColor, subtitle, subtitleColor, scarColor = COLOR.amber) {
  const { x, y, width } = panel;
  app.renderer.shapes.rect(x + 8, y + 8, 3, 25, titleColor);
  app.renderer.shapes.rect(x + width - 11, y + 8, 3, 25, COLOR.red);
  let cursor = x + 20;
  for (const [text, color] of Array.isArray(title) ? title : [[title, titleColor]]) {
    app.renderer.bitmapText.draw(text, cursor, y + 10, color, 2);
    cursor += text.length * 12;
  }
  app.renderer.bitmapText.draw(clippedUiText(subtitle, width - 40), x + 20, y + MENU_HEADER.subtitleY, subtitleColor, 1);
  app.renderer.shapes.rect(x + 16, y + MENU_HEADER.ruleY, MENU_HEADER.scarWidth, 1, scarColor);
  app.renderer.shapes.rect(x + 16 + MENU_HEADER.scarWidth + 4, y + MENU_HEADER.ruleY, width - 58, 1, COLOR.dimMint);
  app.renderer.shapes.rect(x + width - 20, y + MENU_HEADER.ruleY, 4, 1, scarColor);
}

export function drawTierDivider(app, x, y, width, endColor = COLOR.dimMint) {
  app.renderer.shapes.rect(x, y, 10, 1, COLOR.dimMint);
  app.renderer.shapes.rect(x + 14, y, width - 28, 1, COLOR.dimMint);
  app.renderer.shapes.rect(x + width - 10, y, 10, 1, endColor);
}

export function clippedUiText(value, width) {
  return String(value || '').slice(0, Math.max(0, Math.floor(width / 6)));
}

export function towerPanelPosition(app, tower, width, height) {
  const towerPoint = project(app, tower.x, tower.y);
  const { x, y, above, connectorX } = attachedPanelPosition(towerPoint, width, height, viewport(app), app.viewport.HUD_TOP_HEIGHT, app.viewport.hudBottomY);
  if (above) app.renderer.shapes.line(towerPoint.x, towerPoint.y - 8, connectorX, y + height, 1, COLOR.dimMint);
  else app.renderer.shapes.line(towerPoint.x, towerPoint.y + 8, connectorX, y, 1, COLOR.dimMint);
  return { x, y };
}
