export const MIN_TOWER_SPACING = 24;
export function towerPlacementClear(towers, x, y, ignoredId = null) {
  return Number.isFinite(x) && Number.isFinite(y) && towers.every((tower) =>
    tower.id === ignoredId || Math.hypot(tower.x - x, tower.y - y) >= MIN_TOWER_SPACING);
}
