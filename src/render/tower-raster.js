// Optional per-form pixel overrides authored in the part lab. The procedural
// sprites in tower-sprites.js stay the source of truth; a raster only replaces
// one form's body while it is registered, and clearing it restores the art.
export const TOWER_RASTER_SCHEMA_VERSION = 1;
export const TOWER_RASTER_SIZE = 34;
export const TOWER_RASTER_ORIGIN = 17;

// One character per cell so a raster survives localStorage and JSON cheaply.
export const RASTER_PALETTE = Object.freeze([
  Object.freeze({ char: 'k', key: 'black', css: '#010607' }),
  Object.freeze({ char: 'c', key: 'cyan', css: '#35f2ff' }),
  Object.freeze({ char: 'm', key: 'mint', css: '#55ffc2' }),
  Object.freeze({ char: 'g', key: 'green', css: '#74ff6a' }),
  Object.freeze({ char: 'a', key: 'amber', css: '#ffc857' }),
  Object.freeze({ char: 'r', key: 'red', css: '#ff4d5a' }),
  Object.freeze({ char: 'd', key: 'dimMint', css: '#0e423b' }),
  Object.freeze({ char: 'i', key: 'ink', css: '#bde9df' }),
  Object.freeze({ char: 'u', key: 'uiMuted', css: '#65958b' })
]);
export const RASTER_EMPTY = '.';
const CHAR_BY_KEY = new Map(RASTER_PALETTE.map((entry) => [entry.key, entry.char]));
const KEY_BY_CHAR = new Map(RASTER_PALETTE.map((entry) => [entry.char, entry.key]));
const VALID_CELL = new RegExp(`^[${RASTER_EMPTY.replace('.', '\\.')}${RASTER_PALETTE.map((entry) => entry.char).join('')}]+$`);

export function rasterCharForKey(key) {
  return CHAR_BY_KEY.get(key) || RASTER_EMPTY;
}

export function rasterKeyForChar(char) {
  return KEY_BY_CHAR.get(char) || null;
}

export function emptyRaster(formId) {
  return { schemaVersion: TOWER_RASTER_SCHEMA_VERSION, formId, size: TOWER_RASTER_SIZE, cells: RASTER_EMPTY.repeat(TOWER_RASTER_SIZE * TOWER_RASTER_SIZE) };
}

export function validateTowerRaster(value) {
  if (!value || typeof value !== 'object') throw new Error('raster must be an object');
  if (value.schemaVersion !== TOWER_RASTER_SCHEMA_VERSION) throw new Error('unsupported raster schema');
  if (typeof value.formId !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(value.formId)) throw new Error('invalid raster form id');
  if (value.size !== TOWER_RASTER_SIZE) throw new Error('unsupported raster size');
  if (typeof value.cells !== 'string' || value.cells.length !== TOWER_RASTER_SIZE * TOWER_RASTER_SIZE || !VALID_CELL.test(value.cells)) {
    throw new Error('invalid raster cells');
  }
  return { schemaVersion: TOWER_RASTER_SCHEMA_VERSION, formId: value.formId, size: TOWER_RASTER_SIZE, cells: value.cells };
}

export function rasterIsEmpty(raster) {
  return !raster || !/[^.]/.test(raster.cells);
}

// Merge horizontal runs into sprite-relative rectangles the shape batch can draw.
export function rasterToRects(raster) {
  const rects = [];
  const size = raster.size;
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      const char = raster.cells[row * size + column];
      if (char === RASTER_EMPTY) { column += 1; continue; }
      let end = column + 1;
      while (end < size && raster.cells[row * size + end] === char) end += 1;
      rects.push({ x: column - TOWER_RASTER_ORIGIN, y: row - TOWER_RASTER_ORIGIN, width: end - column, height: 1, key: rasterKeyForChar(char) });
      column = end;
    }
  }
  return rects;
}

const overrides = new Map();
const listeners = new Set();

export function getTowerRasterOverride(formId) {
  return overrides.get(formId) || null;
}

export function setTowerRasterOverride(formId, raster) {
  if (raster) overrides.set(formId, validateTowerRaster(raster));
  else overrides.delete(formId);
  for (const listener of listeners) listener(formId);
  return getTowerRasterOverride(formId);
}

export function clearTowerRasterOverrides() {
  const ids = [...overrides.keys()];
  overrides.clear();
  for (const id of ids) for (const listener of listeners) listener(id);
}

export function onTowerRasterChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function drawRasterOverride(shapes, COLOR, p, raster, override = null) {
  for (const rect of rasterToRects(raster)) {
    const color = rect.key === 'black' ? COLOR.black : (override?.accent || COLOR[rect.key] || COLOR.mint);
    shapes.rect(p.x + rect.x, p.y + rect.y, rect.width, rect.height, color);
  }
}
