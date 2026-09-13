import { defenseAreaBounds, defenseAreaField } from '../core/world-config.js';
import { nebulaPalette } from './world-appearance.js';

// Menu thumbnails rasterise the real organic field boundary once per map and size,
// then draw it as horizontal runs. Rifts outside the camera-safe window clamp to the
// frame edge so entry directions stay visible.
const cache = new Map();
const TERRAIN = nebulaPalette({ tier: 0 });

// Wall sides: authored `walls`, else the southern wall (plus side walls) for flow maps.
export function mapWalls(map) {
  if (map.arena) return [];
  if (map.walls) return map.walls;
  return ['bottom', ...(map.sideWalls ? ['left', 'right'] : [])];
}

export function mapThumbnailLayout(map, width, height) {
  const bounds = map.cameraBounds;
  const worldWidth = bounds.right - bounds.left;
  const worldHeight = bounds.bottom - bounds.top;
  const scale = Math.min(width / worldWidth, height / worldHeight);
  const frameWidth = Math.max(4, Math.floor(worldWidth * scale));
  const frameHeight = Math.max(4, Math.floor(worldHeight * scale));
  return {
    bounds, worldWidth, worldHeight, frameWidth, frameHeight,
    offsetX: Math.floor((width - frameWidth) / 2), offsetY: Math.floor((height - frameHeight) / 2)
  };
}

export function mapThumbnail(map, width, height) {
  const key = `${map.id}:${width}x${height}`;
  if (cache.has(key)) return cache.get(key);
  const layout = mapThumbnailLayout(map, width, height);
  const { bounds, worldWidth, worldHeight, frameWidth, frameHeight } = layout;
  const toWorld = (px, py) => ({
    x: bounds.left + (px + 0.5) / frameWidth * worldWidth,
    y: bounds.top + (py + 0.5) / frameHeight * worldHeight
  });
  const areas = map.defenseAreas.map((area) => ({ area, box: defenseAreaBounds(area) }));
  const inside = new Uint8Array(frameWidth * frameHeight);
  for (let py = 0; py < frameHeight; py += 1) for (let px = 0; px < frameWidth; px += 1) {
    const world = toWorld(px, py);
    for (const { area, box } of areas) {
      if (world.x < box.left || world.x > box.right || world.y < box.top || world.y > box.bottom) continue;
      if (defenseAreaField(area, world.x, world.y) <= 0) { inside[py * frameWidth + px] = 1; break; }
    }
  }
  const at = (px, py) => px >= 0 && py >= 0 && px < frameWidth && py < frameHeight && inside[py * frameWidth + px] === 1;
  const interior = [], edge = [];
  for (let py = 0; py < frameHeight; py += 1) {
    let run = null;
    for (let px = 0; px <= frameWidth; px += 1) {
      const filled = at(px, py);
      const rim = filled && !(at(px - 1, py) && at(px + 1, py) && at(px, py - 1) && at(px, py + 1));
      const kind = !filled ? null : rim ? edge : interior;
      if (run && run.kind !== kind) { run.kind.push([run.x, py, px - run.x]); run = null; }
      if (kind && !run) run = { kind, x: px };
    }
  }
  const toPixel = (x, y) => ({
    x: Math.max(1, Math.min(frameWidth - 2, Math.round((x - bounds.left) / worldWidth * frameWidth))),
    y: Math.max(1, Math.min(frameHeight - 2, Math.round((y - bounds.top) / worldHeight * frameHeight)))
  });
  const rifts = [];
  for (const source of map.spawnSources) {
    const point = toPixel(source.x, source.y);
    if (rifts.some((rift) => Math.abs(rift.x - point.x) <= 3 && Math.abs(rift.y - point.y) <= 3)) continue;
    rifts.push(point);
  }
  const thumbnail = Object.freeze({
    ...layout, interior, edge, rifts, base: toPixel(map.base.x, map.base.y),
    arena: Boolean(map.arena), walls: mapWalls(map)
  });
  cache.set(key, thumbnail);
  return thumbnail;
}

export function drawMapThumbnail(shapes, colors, map, x, y, width, height, accent, { riftColor = colors.red } = {}) {
  const thumb = mapThumbnail(map, width, height);
  const left = x + thumb.offsetX, top = y + thumb.offsetY;
  shapes.rect(left, top, thumb.frameWidth, thumb.frameHeight, colors.black);
  for (const [px, py, w] of thumb.interior) shapes.rect(left + px, top + py, w, 1, TERRAIN.band);
  for (const [px, py, w] of thumb.edge) shapes.rect(left + px, top + py, w, 1, TERRAIN.rim);
  if (thumb.arena) {
    shapes.rect(left, top, thumb.frameWidth, 1, colors.dimMint);
    shapes.rect(left, top + thumb.frameHeight - 1, thumb.frameWidth, 1, colors.dimMint);
    shapes.rect(left, top, 1, thumb.frameHeight, colors.dimMint);
    shapes.rect(left + thumb.frameWidth - 1, top, 1, thumb.frameHeight, colors.dimMint);
  }
  for (const wall of thumb.walls) {
    const horizontal = wall === 'top' || wall === 'bottom';
    const wx = wall === 'right' ? left + thumb.frameWidth - 1 : left;
    const wy = wall === 'bottom' ? top + thumb.frameHeight - 1 : top;
    shapes.rect(wx, wy, horizontal ? thumb.frameWidth : 1, horizontal ? 1 : thumb.frameHeight, colors.dimMint);
    for (let step = 0; step < (horizontal ? thumb.frameWidth : thumb.frameHeight); step += 6) {
      shapes.rect(horizontal ? wx + step : wx, horizontal ? wy : wy + step, horizontal ? 3 : 1, horizontal ? 1 : 3, colors.amber);
    }
  }
  // Rift jaws: two red blocks around a one-pixel black fault.
  for (const rift of thumb.rifts) {
    shapes.rect(left + rift.x - 1, top + rift.y - 1, 3, 3, colors.black);
    shapes.rect(left + rift.x - 1, top + rift.y - 1, 1, 3, riftColor);
    shapes.rect(left + rift.x + 1, top + rift.y - 1, 1, 3, riftColor);
  }
  shapes.rect(left + thumb.base.x - 2, top + thumb.base.y - 2, 5, 5, colors.black);
  shapes.rect(left + thumb.base.x - 2, top + thumb.base.y - 1, 5, 3, colors.cyan);
  shapes.rect(left + thumb.base.x, top + thumb.base.y, 1, 1, colors.black);
  // Broken corner brackets carry the selection state without a full border.
  const right = left + thumb.frameWidth - 1, bottom = top + thumb.frameHeight - 1;
  for (const [cx, cy, dx, dy] of [[left - 2, top - 2, 1, 1], [right + 2, top - 2, -1, 1], [left - 2, bottom + 2, 1, -1], [right + 2, bottom + 2, -1, -1]]) {
    shapes.rect(dx > 0 ? cx : cx - 3, cy, 4, 1, accent);
    shapes.rect(cx, dy > 0 ? cy : cy - 3, 1, 4, accent);
  }
  return thumb;
}
