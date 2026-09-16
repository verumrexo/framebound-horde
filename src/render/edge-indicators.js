import { project } from '../app/camera.js';
import { realSecondsUntil } from '../app/queries.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { COLOR } from '../ui/palette.js';

// Intersect the bearing from the playable viewport's centre with its inset frame.
// Clamping x/y independently would turn almost every distant target into a corner.
export function edgeIndicatorForPoint(point, viewport, inset = 14) {
  const { logicalWidth: width, HUD_TOP_HEIGHT: top, hudBottomY: bottom } = viewport;
  if (![point.x, point.y, width, top, bottom].every(Number.isFinite) || width <= 0 || bottom <= top) return null;
  if (point.x >= 0 && point.x <= width && point.y >= top && point.y <= bottom) return null;
  const cx = width / 2, cy = (top + bottom) / 2;
  const halfWidth = Math.max(1, cx - inset), halfHeight = Math.max(1, (bottom - top) / 2 - inset);
  const dx = point.x - cx, dy = point.y - cy;
  const length = Math.hypot(dx, dy);
  const scale = Math.min(dx === 0 ? Infinity : halfWidth / Math.abs(dx), dy === 0 ? Infinity : halfHeight / Math.abs(dy));
  return { x: Math.round(cx + dx * scale), y: Math.round(cy + dy * scale), dx: dx / length, dy: dy / length };
}

export function drawEdgeIndicator(app, marker, color, { kind = 'ping', label = '', pulse = 0 } = {}) {
  const { shapes, bitmapText } = app.renderer;
  const { x, y, dx, dy } = marker;
  const radius = 4 + pulse;
  shapes.rect(x - radius - 2, y - radius - 2, radius * 2 + 5, radius * 2 + 5, COLOR.black);
  // Pixel diamond, plus a small outward chevron on the actual target bearing.
  shapes.line(x, y - radius, x + radius, y, 1, color);
  shapes.line(x + radius, y, x, y + radius, 1, color);
  shapes.line(x, y + radius, x - radius, y, 1, color);
  shapes.line(x - radius, y, x, y - radius, 1, color);
  if (kind === 'surge') {
    shapes.rect(x, y - 2, 1, 3, color);
    shapes.rect(x, y + 2, 1, 1, color);
  } else shapes.rect(x - 1, y - 1, 3, 3, color);
  const tipX = Math.round(x + dx * 11), tipY = Math.round(y + dy * 11);
  const backX = x + dx * 7, backY = y + dy * 7;
  shapes.line(Math.round(backX - dy * 3), Math.round(backY + dx * 3), tipX, tipY, 1, color);
  shapes.line(Math.round(backX + dy * 3), Math.round(backY - dx * 3), tipX, tipY, 1, color);
  if (!label) return;
  const textWidth = label.length * 6;
  const vertical = Math.abs(dy) > Math.abs(dx);
  const textX = Math.round(Math.max(3, Math.min(app.viewport.logicalWidth - textWidth - 3,
    vertical ? x - textWidth / 2 : dx > 0 ? x - textWidth - 11 : x + 11)));
  const textY = Math.round(Math.max(app.viewport.HUD_TOP_HEIGHT + 3, Math.min(app.viewport.hudBottomY - 10,
    vertical ? dy > 0 ? y - 17 : y + 11 : y - 3)));
  shapes.rect(textX - 2, textY - 2, textWidth + 3, 11, COLOR.black);
  bitmapText.draw(label, textX, textY, color, 1);
}

export function drawSurgeEdgeIndicators(app, snapshot) {
  const surge = snapshot.swarm?.surge;
  if (!surge || !['warning', 'active'].includes(surge.phase)) return;
  const groups = [];
  for (const source of app.game.currentMap.spawnSources) {
    if (!surge.riftIds.includes(source.id)) continue;
    const position = snapshot.test?.spawnSourceOverrides?.[source.id] || source;
    const marker = edgeIndicatorForPoint(project(app, position.x, position.y), app.viewport);
    if (!marker) continue;
    const nearby = groups.find((group) => Math.hypot(group.x - marker.x, group.y - marker.y) < 28);
    if (nearby) nearby.count += 1;
    else groups.push({ ...marker, count: 1 });
  }
  const warning = surge.phase === 'warning';
  const seconds = Math.ceil(realSecondsUntil(snapshot, surge.activeAtSeconds));
  const pulse = app.effects.reducedNetworkMotion.matches ? 0 : Math.floor(snapshot.runTick / (AUTHORITY_TICK_RATE / 2)) % 2;
  for (const group of groups) {
    const label = (warning ? `surge ${seconds}s` : 'surge') + (group.count > 1 ? ` x${group.count}` : '');
    drawEdgeIndicator(app, group, warning ? COLOR.amber : COLOR.red, { kind: 'surge', label, pulse });
  }
}
