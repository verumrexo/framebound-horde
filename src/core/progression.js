// Threat is an HP/sec budget. A gentler opening joins a linear late ramp with the
// same value and slope at twenty minutes: pressure keeps rising without compounding.
// Horde pace: a run-wide time stretch on the threat clock (spawn curve, hp mixture,
// rift unlocks and surges together). Chosen at deployment, carried in state and saves.
export const PACE_MIN = 0.6;
export const PACE_MAX = 1.6;
export const PACE_STEP = 0.1;
export const DEFAULT_PACE = 1;
export function normalizePace(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PACE;
  const stepped = Math.round(numeric / PACE_STEP) * PACE_STEP;
  return Math.round(Math.max(PACE_MIN, Math.min(PACE_MAX, stepped)) * 100) / 100;
}
// Ticks on the threat clock for a run tick at the given pace.
export function threatTickAt(runTick, pace = DEFAULT_PACE) {
  return Math.max(0, runTick) * normalizePace(pace);
}

export const LINEAR_RAMP_START_MINUTE = 20;
export const HP_MIX_START_MINUTE = 3;
export const LIGHT_MIX_MAX_MEAN_HP = 1.2;

export function healthBudgetAt(map, runTick, tickRate = 60) {
  const minutes = Math.max(0, runTick) / tickRate / 60;
  const curve = map.spawnCurve;
  const openingMinutes = curve.taper ? Math.min(minutes, LINEAR_RAMP_START_MINUTE) : minutes;
  const growth = Math.pow(curve.growthPerMinute, openingMinutes);
  const openingBudget = (curve.basePerSecond + curve.linearPerMinute * openingMinutes) * growth;
  if (!curve.taper || minutes <= LINEAR_RAMP_START_MINUTE) return openingBudget;
  const slope = curve.linearPerMinute * growth + openingBudget * Math.log(curve.growthPerMinute);
  return openingBudget + slope * (minutes - LINEAR_RAMP_START_MINUTE);
}

export function spawnProfileAt(map, runTick, tickRate = 60) {
  const minutes = Math.max(0, runTick) / tickRate / 60;
  const hpPerSecond = healthBudgetAt(map, runTick, tickRate);
  // Give the opening time to breathe: only 1 HP bodies for three threat minutes,
  // then ease the mixture to its existing 2 HP average at the twenty-minute cap.
  // Body rate pays for the mixture, preserving the same HP/sec and credit budget.
  const openingHp = 1 + Math.max(0, Math.min(1,
    (minutes - HP_MIX_START_MINUTE) / (LINEAR_RAMP_START_MINUTE - HP_MIX_START_MINUTE)));
  const bodyCap = healthBudgetAt(map, LINEAR_RAMP_START_MINUTE * 60 * tickRate, tickRate) / 2;
  const meanHp = Math.max(openingHp, bodyCap > 0 ? hpPerSecond / bodyCap : 1);
  return { rate: hpPerSecond / meanHp, meanHp, hpPerSecond, bodyCap };
}

// Rift surges: once every rift is open, a short arc of neighbouring rifts periodically
// runs hot. Hot rifts carry a larger share of the ordinary stream and add a heavier
// stream with a fixed HP budget; individual HP rises with the surge index. The schedule is a pure function of
// the map, seed and tick so every peer, save and correction reproduces it.
export const SURGE_PERIOD_SECONDS = 360;
export const SURGE_WARNING_SECONDS = 45;
export const SURGE_ACTIVE_SECONDS = 120;
export const SURGE_LEAD_SECONDS = 60;
export const SURGE_HOT_WEIGHT = 3;
export const SURGE_EXTRA_HP_FRACTION = 0.30;
export const SURGE_HP_BASE = 3;
export const SURGE_HP_PER_INDEX = 0.5;

function mix32(value) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function surgeArcSize(riftCount) {
  return Math.max(1, Math.min(3, Math.ceil(riftCount / 8)));
}

// Rifts sorted by angle around the base so "adjacent" means neighbouring on the frame.
export function surgeRiftRing(map) {
  return [...map.spawnSources]
    .map((source) => ({ id: source.id, angle: Math.atan2(source.y - map.base.y, source.x - map.base.x) }))
    .sort((a, b) => a.angle - b.angle || (a.id < b.id ? -1 : 1))
    .map((entry) => entry.id);
}

export function surgeStartSeconds(map) {
  const lastUnlock = map.spawnSources.reduce((latest, source) => Math.max(latest, source.unlockSeconds || 0), 0);
  return lastUnlock + SURGE_LEAD_SECONDS;
}

// Centres are drawn sequentially so consecutive arcs never overlap: a candidate closer
// than the arc size to the previous centre is stepped around the ring by the arc size.
function surgeCentre(ring, seed, index) {
  const count = ring.length;
  const size = surgeArcSize(count);
  let previous = -1;
  let centre = 0;
  for (let step = 0; step <= index; step += 1) {
    centre = mix32((seed ^ 0x9e3779b9) + Math.imul(step + 1, 0x85ebca6b)) % count;
    if (previous >= 0 && count > size * 2) {
      for (let guard = 0; guard < count; guard += 1) {
        const distance = Math.min((centre - previous + count) % count, (previous - centre + count) % count);
        if (distance >= size) break;
        centre = (centre + size) % count;
      }
    } else if (previous >= 0 && count > 1 && centre === previous) {
      centre = (centre + 1) % count;
    }
    previous = centre;
  }
  return centre;
}

export function surgeRiftIds(map, seed, index) {
  const ring = surgeRiftRing(map);
  if (ring.length === 0) return [];
  const size = surgeArcSize(ring.length);
  const centre = surgeCentre(ring, seed, index);
  const half = Math.floor(size / 2);
  const ids = [];
  for (let offset = -half; offset < size - half; offset += 1) {
    ids.push(ring[((centre + offset) % ring.length + ring.length) % ring.length]);
  }
  return ids;
}

export function surgeHpMultiplier(index) {
  return SURGE_HP_BASE + SURGE_HP_PER_INDEX * index;
}

// Phase of the surge cycle at a tick: idle, warning (countdown visible), or active.
export function surgeScheduleAt(map, runTick, seed, tickRate = 60) {
  const seconds = Math.max(0, runTick) / tickRate;
  const start = surgeStartSeconds(map);
  if (!map.playable || map.spawnSources.length === 0) return { phase: 'idle', index: -1, riftIds: [], activeAtSeconds: null, endsAtSeconds: null };
  // Surge k becomes active at start + k * period; its warning begins SURGE_WARNING_SECONDS earlier.
  const nextIndex = Math.max(0, Math.ceil((seconds - start) / SURGE_PERIOD_SECONDS));
  const candidates = [nextIndex - 1, nextIndex].filter((index) => index >= 0);
  for (const index of candidates) {
    const activeAt = start + index * SURGE_PERIOD_SECONDS;
    const endsAt = activeAt + SURGE_ACTIVE_SECONDS;
    if (seconds >= activeAt && seconds < endsAt) {
      return { phase: 'active', index, riftIds: surgeRiftIds(map, seed, index), activeAtSeconds: activeAt, endsAtSeconds: endsAt, hpMultiplier: surgeHpMultiplier(index) };
    }
  }
  const activeAt = start + nextIndex * SURGE_PERIOD_SECONDS;
  if (seconds >= activeAt - SURGE_WARNING_SECONDS && seconds < activeAt) {
    return { phase: 'warning', index: nextIndex, riftIds: surgeRiftIds(map, seed, nextIndex), activeAtSeconds: activeAt, endsAtSeconds: activeAt + SURGE_ACTIVE_SECONDS, hpMultiplier: surgeHpMultiplier(nextIndex) };
  }
  return { phase: 'idle', index: nextIndex, riftIds: [], activeAtSeconds: activeAt, endsAtSeconds: activeAt + SURGE_ACTIVE_SECONDS, hpMultiplier: surgeHpMultiplier(nextIndex) };
}

// Decorates the live spawn sources with surge weights and the additional heavy stream.
export function surgeSpawnSources(sources, surge, profile) {
  if (!surge || surge.phase !== 'active' || !surge.riftIds.length) return sources;
  const hot = new Set(surge.riftIds);
  const hotCount = sources.filter((source) => hot.has(source.id)).length;
  if (hotCount === 0) return sources;
  const heavyHp = Math.max(1, Math.round(profile.meanHp * surge.hpMultiplier));
  // Short maps can surge during the opening; respect the same light-body window.
  const extraHp = profile.meanHp <= LIGHT_MIX_MAX_MEAN_HP ? Math.min(2, heavyHp) : heavyHp;
  // Pay for heavier surge bodies from a fixed fraction of *current* pressure.
  // Using the late-game body cap here made early surges dwarf the ordinary stream.
  const extraRate = profile.hpPerSecond * SURGE_EXTRA_HP_FRACTION / extraHp / hotCount;
  return sources.map((source) => hot.has(source.id)
    ? { ...source, weight: (source.weight || 1) * SURGE_HOT_WEIGHT, extraRatePerSecond: extraRate, extraHp }
    : source);
}
