import { project } from '../app/camera.js';
import { defenseAreaBounds } from '../core/world-config.js';
import { COLOR } from '../ui/palette.js';

export function drawDashedLink(app, from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  for (let offset = 0; offset < distance; offset += 8) {
    const end = Math.min(distance, offset + 4);
    app.renderer.shapes.line(
      from.x + dx * offset / distance,
      from.y + dy * offset / distance,
      from.x + dx * end / distance,
      from.y + dy * end / distance,
      1,
      color
    );
  }
}

// Pixelated world-space ring. The visible result is the classic midpoint circle (one
// pixel thick, eight-way symmetric); the pixels themselves are selected on the GPU.

export function drawWorldRing(app, x, y, radius, color) {
  const pixelRadius = Math.max(1, Math.round(radius / app.viewport.camera.scale));
  app.renderer.shapes.ring((x - app.viewport.camera.x) / app.viewport.camera.scale + app.viewport.logicalWidth * 0.5, (y - app.viewport.camera.y) / app.viewport.camera.scale + app.viewport.logicalHeight * 0.5, pixelRadius, color);
}

export function drawAreaTargetBrackets(app, area, color) {
  const bounds = defenseAreaBounds(area, 4);
  const upperLeft = project(app, bounds.left, bounds.top);
  const lowerRight = project(app, bounds.right, bounds.bottom);
  const left = Math.min(upperLeft.x, lowerRight.x);
  const right = Math.max(upperLeft.x, lowerRight.x);
  const top = Math.min(upperLeft.y, lowerRight.y);
  const bottom = Math.max(upperLeft.y, lowerRight.y);
  const corner = 5;
  app.renderer.shapes.line(left, top, left + corner, top, 1, color);
  app.renderer.shapes.line(left, top, left, top + corner, 1, color);
  app.renderer.shapes.line(right - corner, top, right, top, 1, color);
  app.renderer.shapes.line(right, top, right, top + corner, 1, color);
  app.renderer.shapes.line(left, bottom, left + corner, bottom, 1, color);
  app.renderer.shapes.line(left, bottom - corner, left, bottom, 1, color);
  app.renderer.shapes.line(right - corner, bottom, right, bottom, 1, color);
  app.renderer.shapes.line(right, bottom - corner, right, bottom, 1, color);
}

export function drawControlDirectionArrow(app, tower, direction, length, color) {
  const rawX = direction?.dx ?? direction?.x ?? 0;
  const rawY = direction?.dy ?? direction?.y ?? 0;
  const directionLength = Math.hypot(rawX, rawY);
  if (directionLength <= 0.0001) return;
  const dx = rawX / directionLength;
  const dy = rawY / directionLength;
  const from = project(app, tower.x, tower.y);
  const to = project(app, tower.x + dx * length, tower.y + dy * length);
  drawDashedLink(app, from, to, color);
  const wing = Math.max(3, Math.round(7 / Math.max(1, app.viewport.camera.scale * 0.5)));
  const backwardsX = -dx * wing;
  const backwardsY = -dy * wing;
  const perpendicularX = -dy * wing * 0.65;
  const perpendicularY = dx * wing * 0.65;
  app.renderer.shapes.line(to.x, to.y, to.x + backwardsX + perpendicularX, to.y + backwardsY + perpendicularY, 2, color);
  app.renderer.shapes.line(to.x, to.y, to.x + backwardsX - perpendicularX, to.y + backwardsY - perpendicularY, 2, color);
  app.renderer.shapes.rect(from.x - 1, from.y - 1, 3, 3, COLOR.cyan);
}
