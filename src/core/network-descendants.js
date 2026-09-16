import { reactorRank } from './research.js';
// Network infrastructure rules shared by authority and presentation.
export const NETWORK_DESCENDANT_IDS = Object.freeze([
  'redline', 'metronome', 'aperture', 'mint', 'reactor', 'arsenal',
  'amplifier', 'echo', 'hardpoint'
]);

export const RELAY_FORMS = Object.freeze(['relay', 'amplifier', 'echo', 'hardpoint']);
export const isRelayForm = (id) => RELAY_FORMS.includes(id);

// Every relay-family edge on the map, including links a completed network retains
// after its connector relays retired.
export function relayLinkPairs(snapshot) {
  const pairs = [];
  for (const [areaA, areaB] of snapshot?.relayNetwork?.links || []) pairs.push([areaA, areaB]);
  for (const tower of snapshot?.towers || []) {
    if (isRelayForm(tower.definitionId) && tower.relayTargetAreaId) pairs.push([tower.areaId, tower.relayTargetAreaId]);
  }
  return pairs;
}

export function networkSources(snapshot, areaId, id) {
  const areas = new Set([areaId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [areaA, areaB] of snapshot.relayNetwork?.links || []) {
      if (areas.has(areaA) !== areas.has(areaB)) { areas.add(areaA); areas.add(areaB); changed = true; }
    }
    for (const tower of snapshot.towers) {
      if (!isRelayForm(tower.definitionId) || !tower.relayTargetAreaId) continue;
      if (areas.has(tower.areaId) || areas.has(tower.relayTargetAreaId)) {
        for (const area of [tower.areaId, tower.relayTargetAreaId]) {
          if (!areas.has(area)) { areas.add(area); changed = true; }
        }
      }
    }
  }
  return snapshot.towers.filter((tower) => areas.has(tower.areaId) && (!id || tower.definitionId === id));
}

// New placements beyond a free allowance cost geometrically more, so tower count is a
// priced decision instead of a free multiplier on damage. Upgrades of existing towers
// are never escalated; the test field is exempt.
export const FREE_PLACEMENTS = 30;
export const PLACEMENT_ESCALATOR = 1.035;

export function placementEscalation(snapshot) {
  if (snapshot?.test) return 1;
  // the next placement is number placed + 1; the first FREE_PLACEMENTS cost their catalog price
  const placed = snapshot?.towers?.length || 0;
  return PLACEMENT_ESCALATOR ** Math.max(0, placed + 1 - FREE_PLACEMENTS);
}

// Only the base placement price escalates with tower count; evolution costs already
// folded into a full-path quote (see towerBuildQuote) stay at their catalog price.
export function purchaseCost(snapshot, areaId, baseCost, { placement = false, escalatableCost = baseCost } = {}) {
  const fraction = Math.max(0.5, 0.98 ** reactorRank(snapshot, 'construction'));
  const escalation = placement ? placementEscalation(snapshot) : 1;
  const fixedCost = baseCost - escalatableCost;
  return Math.max(1, Math.ceil((escalatableCost * escalation + fixedCost) * fraction - 1e-8));
}

export function saleRefund(snapshot, tower) {
  return Math.floor(tower.totalInvestment * 0.5);
}

export function controlSource(snapshot, echo, sourceId = echo.echoSourceId) {
  return networkSources(snapshot, echo.areaId).find((tower) => tower.id === sourceId
    && ['tether', 'anchor', 'stasis', 'recall', 'dragnet', 'knot', 'singularity', 'bond', 'braid', 'backwash', 'breaker', 'crosswind', 'breakwater'].includes(tower.definitionId));
}

export function socketPoint(snapshot, map, hardpoint) {
  if (hardpoint?.definitionId !== 'hardpoint' || !hardpoint.relayTargetAreaId) return null;
  const target = map.defenseAreas.find((area) => area.id === hardpoint.relayTargetAreaId);
  if (!target) return null;
  const fraction = Number.isFinite(hardpoint.socketFraction) ? hardpoint.socketFraction : 0.5;
  return { x: hardpoint.x + (target.shape.x - hardpoint.x) * fraction,
    y: hardpoint.y + (target.shape.y - hardpoint.y) * fraction };
}

const modifier = (id, stat, value) => Object.freeze({ id, stat, value,
  operation: 'add_percent', scope: 'network_area', additionalValue: 0.01,
  stacking: 'diminishing_additive', stackGroup: id });
const form = (id, parent, description, extra = {}) => Object.freeze({
  id, label: id, role: 'infrastructure', description: Object.freeze(description),
  evolvesFrom: parent, evolutionCost: 800, range: 170, killReward: 1,
  evolutionChoices: Object.freeze([]), networkNode: true, infrastructure: true,
  ...(parent === 'relay' ? { linkRange: 360, supportEffects: Object.freeze([
    Object.freeze({ id: 'relay_link', type: 'area_link', target: 'selected_area', stacking: 'unique_area', stackGroup: 'relay_link' })
  ]) } : {}), ...extra
});

export const NETWORK_DESCENDANTS = Object.freeze({
  redline: form('redline', 'overclock', ['bonus volley / 10s', 'extra copies: +1% tempo', 'no permanent fire buff']),
  metronome: form('metronome', 'overclock', ['timed control +25% speed', 'extra copies +1%', 'durations unchanged'], {
    modifiers: [modifier('metronome', 'controlRecharge', 0.25)]
  }),
  aperture: form('aperture', 'overclock', ['blast / field size +10%', 'beam width +10%', 'extra copies +1%'], {
    modifiers: ['geometryRadius', 'geometryWidth', 'controlRadius', 'controlWidth'].map((stat) => modifier(`aperture_${stat}`, stat, 0.1))
  }),
  mint: form('mint', 'forge', ['ordinary hp income +20%', 'extra copies +1%', 'fractional income saved']),
  reactor: form('reactor', 'forge', ['global passive upgrades', 'rising prices per rank', '12 upgrade categories']),
  arsenal: form('arsenal', 'forge', ['one global upgrade tree', '39 unique global upgrades', 'all branches in one station']),
  amplifier: form('amplifier', 'relay', ['local combat buffs x1.5', 'no economy amplification', 'does not stack']),
  echo: form('echo', 'relay', ['select linked control', 'projects its effect here', 'zero damage'], { targetingModes: ['closest', 'nearest_base', 'farthest_base', 'densest_group'] }),
  hardpoint: form('hardpoint', 'relay', ['one socket on relay line', 'buy its tower separately', 'occupied socket locks link'])
});
