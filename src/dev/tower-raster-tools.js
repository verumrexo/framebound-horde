import { drawTowerSprite } from '../render/tower-sprites.js';
import {
  RASTER_EMPTY, TOWER_RASTER_ORIGIN, TOWER_RASTER_SIZE, emptyRaster, getTowerRasterOverride, rasterCharForKey, setTowerRasterOverride
} from '../render/tower-raster.js';

const KEY_PALETTE = Object.fromEntries(['black', 'amber', 'mint', 'cyan', 'green', 'red', 'dimMint', 'ink', 'uiMuted'].map((key) => [key, key]));

// Sample the untouched procedural sprite into a raster so the editor can start
// from the real art. The override is lifted only for the duration of the sample.
export function rasterizeTowerSprite(formId, context = { runTick: 0, sweepPhase: null, controlActive: false }) {
  const raster = emptyRaster(formId);
  const cells = raster.cells.split('');
  const shapes = {
    rect(x, y, width, height, color) {
      for (let row = y; row < y + height; row += 1) {
        for (let column = x; column < x + width; column += 1) {
          const cx = column + TOWER_RASTER_ORIGIN, cy = row + TOWER_RASTER_ORIGIN;
          if (cx < 0 || cy < 0 || cx >= TOWER_RASTER_SIZE || cy >= TOWER_RASTER_SIZE) continue;
          cells[cy * TOWER_RASTER_SIZE + cx] = rasterCharForKey(color);
        }
      }
    }
  };
  const active = getTowerRasterOverride(formId);
  if (active) setTowerRasterOverride(formId, null);
  try {
    drawTowerSprite(shapes, KEY_PALETTE, { x: 0, y: 0 }, { definitionId: formId }, null, context);
  } finally {
    if (active) setTowerRasterOverride(formId, active);
  }
  return { ...raster, cells: cells.join('') };
}

export function rasterCell(raster, x, y) {
  if (x < 0 || y < 0 || x >= raster.size || y >= raster.size) return RASTER_EMPTY;
  return raster.cells[y * raster.size + x];
}

export function withRasterCell(raster, x, y, char) {
  if (x < 0 || y < 0 || x >= raster.size || y >= raster.size) return raster;
  const index = y * raster.size + x;
  if (raster.cells[index] === char) return raster;
  return { ...raster, cells: `${raster.cells.slice(0, index)}${char}${raster.cells.slice(index + 1)}` };
}

export function floodFillRaster(raster, x, y, char) {
  const target = rasterCell(raster, x, y);
  if (target === char) return raster;
  const cells = raster.cells.split('');
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= raster.size || cy >= raster.size) continue;
    const index = cy * raster.size + cx;
    if (cells[index] !== target) continue;
    cells[index] = char;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return { ...raster, cells: cells.join('') };
}

export function flipRasterHorizontal(raster) {
  // Mirror around the origin column so a centred body stays centred.
  const cells = new Array(raster.size * raster.size).fill(RASTER_EMPTY);
  for (let row = 0; row < raster.size; row += 1) {
    for (let column = 0; column < raster.size; column += 1) {
      const mirrored = 2 * TOWER_RASTER_ORIGIN - column;
      if (mirrored < 0 || mirrored >= raster.size) continue;
      cells[row * raster.size + mirrored] = raster.cells[row * raster.size + column];
    }
  }
  return { ...raster, cells: cells.join('') };
}

export function shiftRaster(raster, dx, dy) {
  const cells = new Array(raster.size * raster.size).fill(RASTER_EMPTY);
  for (let row = 0; row < raster.size; row += 1) {
    for (let column = 0; column < raster.size; column += 1) {
      const char = raster.cells[row * raster.size + column];
      if (char === RASTER_EMPTY) continue;
      const nx = column + dx, ny = row + dy;
      if (nx < 0 || ny < 0 || nx >= raster.size || ny >= raster.size) continue;
      cells[ny * raster.size + nx] = char;
    }
  }
  return { ...raster, cells: cells.join('') };
}

// Sprite bounds must stay inside the engine's -16..17 contract.
export function rasterBounds(raster) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
  for (let row = 0; row < raster.size; row += 1) {
    for (let column = 0; column < raster.size; column += 1) {
      if (raster.cells[row * raster.size + column] === RASTER_EMPTY) continue;
      count += 1;
      left = Math.min(left, column - TOWER_RASTER_ORIGIN);
      right = Math.max(right, column - TOWER_RASTER_ORIGIN + 1);
      top = Math.min(top, row - TOWER_RASTER_ORIGIN);
      bottom = Math.max(bottom, row - TOWER_RASTER_ORIGIN + 1);
    }
  }
  return count ? { left, top, right, bottom, count } : null;
}
