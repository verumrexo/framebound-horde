// Seven-pixel abstract silhouettes, packed once into two uints. The vertex shader
// selects the mask; no sprite textures, extra draw calls or per-enemy CPU work.
const FORMS = [
  ['...#...', '..##...', '..###..', '..###..', '.####..', '.##....', '..#....'], // shard
  ['..####.', '.####..', '.###...', '..###..', '...###.', '...##..', '..##...'], // hook
  ['.#...#.', '.##.##.', '.#####.', '..###..', '..###..', '...##..', '...#...'], // fork
  ['...#...', '..###..', '.#####.', '#######', '..####.', '..###..', '..#....'], // broken kite
  ['.##....', '..##.##', '.######', '..###..', '######.', '##.##..', '....##.']  // thorn
];
const HEAVY_CORE = ['.......', '..###..', '.#####.', '.#####.', '.#####.', '..###..', '.......'];
const LIMBS = [
  [[2, 0], [4, 0]], [[3, 0], [1, 1]], [[6, 2], [6, 4]], [[6, 3], [5, 1]],
  [[2, 6], [4, 6]], [[3, 6], [5, 5]], [[0, 2], [0, 4]], [[0, 3], [1, 5]]
];
function pack(rows) {
  let bits = 0n;
  rows.forEach((row, y) => [...row].forEach((cell, x) => { if (cell === '#') bits |= 1n << BigInt(y * 7 + x); }));
  return [Number(bits & 0xffffffffn), Number(bits >> 32n)];
}
const masks = FORMS.map(pack);
const core = pack(HEAVY_CORE);
const limbs = LIMBS.map((pair) => pair.map(([x, y]) => pack(Array.from({ length: 7 }, (_, row) =>
  Array.from({ length: 7 }, (_, column) => row === y && column === x ? '#' : '.').join('')))));

export function enemySpriteMask(hp) {
  const health = Math.max(1, Math.ceil(hp));
  if (health <= masks.length) return [...masks[health - 1]];
  const signature = ((health - 6) * 197 + 37) & 255;
  const mask = [...core];
  limbs.forEach((pair, index) => {
    const limb = pair[(signature >>> index) & 1];
    mask[0] = (mask[0] | limb[0]) >>> 0;
    mask[1] = (mask[1] | limb[1]) >>> 0;
  });
  return mask;
}

const vector = (mask) => `uvec2(${mask[0]}u, ${mask[1]}u)`;
export const ENEMY_SPRITE_GLSL = `
uvec2 enemySpriteMask(float hp) {
  ${masks.map((mask, index) => `if (hp < ${(index + 1.5).toFixed(1)}) return ${vector(mask)};`).join('\n  ')}
  uint signature = (uint(mod(max(0.0, hp - 6.0), 256.0)) * 197u + 37u) & 255u;
  uvec2 mask = ${vector(core)};
  ${limbs.map((pair, index) => `mask |= (signature & ${1 << index}u) == 0u ? ${vector(pair[0])} : ${vector(pair[1])};`).join('\n  ')}
  return mask;
}
`;
