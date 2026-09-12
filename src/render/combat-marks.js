import { TOWER_WORLD_DIAMETER } from './tower-sprites.js';
import { ENEMY_MIN_PIXELS } from './world-appearance.js';

// Screen-space proportions for projectile heads and kill marks. Everything follows the
// 22-unit turret footprint through the camera, with floors that track the enemy minimum.
export const BURST_SECONDS = 0.22;
export const BURST_MERGE_SECONDS = 0.07;
export const MAX_LIVE_BURSTS = 48;
export const MAX_CONTROL_LINKS = 3;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const oddDown = (value) => 2 * Math.floor((value - 1) / 2) + 1;

const metricsByScale = new Map();
export function combatMetrics(viewScale) {
  if (metricsByScale.has(viewScale)) return metricsByScale.get(viewScale);
  const tower = TOWER_WORLD_DIAMETER / viewScale;
  const metrics = Object.freeze({
    tower,
    shot: clamp(Math.round(tower * 0.28), ENEMY_MIN_PIXELS, 5),
    heavy: oddDown(clamp(Math.round(tower * 0.5), 3, 9)),
    burst: clamp(Math.round(tower * 0.6), 3, 8),
    rail: tower >= 8 ? 2 : 1
  });
  metricsByScale.set(viewScale, metrics);
  return metrics;
}

const FAMILY_BY_FORM = new Map([
  ...['rocket', 'warhead', 'cluster', 'salvo'].map((id) => [id, 'explosive']),
  ...['laser', 'cutter', 'prism', 'sweeper'].map((id) => [id, 'beam']),
  ...['tether', 'anchor', 'stasis', 'recall', 'dragnet'].map((id) => [id, 'lock']),
  ...['knot', 'singularity', 'bond', 'braid'].map((id) => [id, 'collapse']),
  ...['backwash', 'breaker', 'crosswind', 'breakwater'].map((id) => [id, 'shove'])
]);

export function impactFamily(formId) {
  return FAMILY_BY_FORM.get(formId) || 'ballistic';
}

export function impactColors(formId, colors) {
  switch (impactFamily(formId)) {
    case 'explosive': return { early: colors.amber, late: colors.red, control: colors.cyan };
    case 'beam': return { early: colors.cyan, late: colors.dimMint, control: colors.cyan };
    case 'lock': {
      const accent = formId === 'recall' ? colors.amber : formId === 'stasis' ? colors.mint : colors.cyan;
      return { early: accent, late: formId === 'recall' ? colors.amber : colors.green, control: accent };
    }
    case 'collapse': return { early: colors.green, late: colors.cyan, control: colors.cyan };
    case 'shove': return { early: colors.amber, late: colors.dimMint, control: colors.cyan };
    default: return { early: colors.mint, late: colors.red, control: colors.cyan };
  }
}

// One compact, rectangle-only mark per weapon family. `progress` runs 0..1 over the
// burst life; `reach` is the maximum radius in screen pixels for the current zoom.
export function drawImpactMark(shapes, family, p, progress, reach, alternate, color) {
  const outward = 1 + Math.floor(progress * (reach - 1));
  const inward = Math.max(1, reach - Math.floor(progress * (reach - 1)));
  if (family === 'explosive') {
    const r = outward;
    shapes.rect(p.x - r, p.y - r, 2 * r + 1, 1, color);
    shapes.rect(p.x - r, p.y + r, 2 * r + 1, 1, color);
    shapes.rect(p.x - r, p.y - r + 1, 1, 2 * r - 1, color);
    shapes.rect(p.x + r, p.y - r + 1, 1, 2 * r - 1, color);
    return;
  }
  if (family === 'beam') {
    const r = outward;
    shapes.rect(p.x - r, p.y - r, 2 * r + 1, 1, color);
    shapes.rect(p.x - r, p.y + r, 2 * r + 1, 1, color);
    return;
  }
  if (family === 'lock') {
    const r = inward;
    const arm = Math.max(1, Math.min(2, r));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = p.x + sx * r, cy = p.y + sy * r;
      shapes.rect(sx < 0 ? cx : cx - arm + 1, cy, arm, 1, color);
      shapes.rect(cx, sy < 0 ? cy : cy - arm + 1, 1, arm, color);
    }
    return;
  }
  if (family === 'shove') {
    const r = outward;
    shapes.rect(p.x - r, p.y, 2 * r + 1, 1, color);
    return;
  }
  const r = family === 'collapse' ? inward : outward;
  shapes.rect(p.x - r, p.y + alternate, 2, 1, color);
  shapes.rect(p.x + r - 1, p.y - alternate, 2, 1, color);
  shapes.rect(p.x + alternate, p.y - r, 1, 2, color);
  shapes.rect(p.x - alternate, p.y + r - 1, 1, 2, color);
}

// Dense combat keeps one mark per place, not one per kill event. Same-family bursts
// landing within one burst radius of a very young burst are absorbed by it; a full
// list recycles its oldest entry. Presentation only: nothing here reads back into play.
export function admitBurst(bursts, burst, mergeWorldDistance) {
  for (const existing of bursts) {
    if (existing.family !== burst.family || existing.age > BURST_MERGE_SECONDS) continue;
    if (Math.hypot(existing.x - burst.x, existing.y - burst.y) > mergeWorldDistance) continue;
    existing.controlTargets = burst.controlTargets.length ? burst.controlTargets : existing.controlTargets;
    return existing;
  }
  if (bursts.length >= MAX_LIVE_BURSTS) {
    let oldest = 0;
    for (let index = 1; index < bursts.length; index += 1) if (bursts[index].age > bursts[oldest].age) oldest = index;
    bursts[oldest] = burst;
    return burst;
  }
  bursts.push(burst);
  return burst;
}
