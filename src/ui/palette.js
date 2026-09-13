export const COLOR = Object.freeze({
  black: [1 / 255, 6 / 255, 7 / 255, 1],
  cyan: [53 / 255, 242 / 255, 1, 1],
  mint: [85 / 255, 1, 194 / 255, 1],
  green: [116 / 255, 1, 106 / 255, 1],
  amber: [1, 200 / 255, 87 / 255, 1],
  red: [1, 77 / 255, 90 / 255, 1],
  dimMint: [14 / 255, 66 / 255, 59 / 255, 1],
  ink: [189 / 255, 233 / 255, 223 / 255, 1],
  uiMuted: [101 / 255, 149 / 255, 139 / 255, 1]
});

export const PLAYER_COLORS = [COLOR.cyan, COLOR.mint, COLOR.amber, COLOR.green];

export function towerAccent(definitionId) {
  if (['assault', 'barrage', 'broadside', 'flechette', 'cyclone'].includes(definitionId)) return COLOR.amber;
  if (['rocket', 'warhead', 'cluster', 'salvo'].includes(definitionId)) return COLOR.amber;
  if (['laser', 'cutter', 'prism', 'sweeper'].includes(definitionId)) return COLOR.cyan;
  if (definitionId === 'tether') return COLOR.cyan;
  if (['anchor', 'stasis', 'recall', 'dragnet'].includes(definitionId)) return COLOR.cyan;
  if (['knot', 'singularity', 'bond', 'braid'].includes(definitionId)) return COLOR.green;
  if (['backwash', 'breaker', 'crosswind', 'breakwater'].includes(definitionId)) return COLOR.amber;
  if (definitionId === 'network') return COLOR.green;
  if (definitionId === 'overclock') return COLOR.amber;
  if (definitionId === 'forge') return COLOR.amber;
  if (definitionId === 'relay') return COLOR.cyan;
  return COLOR.mint;
}
