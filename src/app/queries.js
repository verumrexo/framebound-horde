import { isRelayForm, networkSources } from '../core/network-descendants.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { defenseAreaField } from '../core/world-config.js';

// One catalog index per snapshot instead of a linear scan per tower per frame.

export function catalogDefinition(snapshot, definitionId) {
  const catalog = snapshot?.towerCatalog;
  if (!catalog) return undefined;
  const cache = catalogDefinition.cache || (catalogDefinition.cache = new WeakMap());
  let index = cache.get(catalog);
  if (!index) {
    index = new Map(catalog.map((definition) => [definition.id, definition]));
    cache.set(catalog, index);
  }
  return index.get(definitionId);
}

export function defenseAreaCenterById(app, areaId) {
  const area = app.game.currentMap.defenseAreas.find((candidate) => candidate.id === areaId);
  if (!area) return null;
  return { x: area.shape.x, y: area.shape.y };
}

// The threat clock runs at the run's pace; countdowns are shown in real seconds.

export function threatSecondsOf(snapshot) {
  return snapshot.swarm?.threatSeconds ?? snapshot.runTick / AUTHORITY_TICK_RATE;
}

export function realSecondsUntil(snapshot, threatSeconds) {
  return Math.max(0, threatSeconds - threatSecondsOf(snapshot)) / (snapshot.pace || 1);
}

// Compass label for the hot arc so the HUD can say where a surge is coming from.

export function surgeDirectionLabel(app, riftIds) {
  const sources = app.game.currentMap.spawnSources.filter((source) => riftIds.includes(source.id));
  if (!sources.length) return '';
  let dx = 0;
  let dy = 0;
  for (const source of sources) {
    const length = Math.hypot(source.x - app.game.currentMap.base.x, source.y - app.game.currentMap.base.y) || 1;
    dx += (source.x - app.game.currentMap.base.x) / length;
    dy += (source.y - app.game.currentMap.base.y) / length;
  }
  const angle = Math.atan2(dy, dx);
  const labels = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return labels[Math.round(((angle / (Math.PI * 2)) * 8 + 8) % 8) % 8];
}

// Surge readout for the hud and status line: null while idle.

export function surgeStatus(app, snapshot) {
  const surge = snapshot.swarm?.surge;
  if (!surge || surge.phase === 'idle') return null;
  const direction = surgeDirectionLabel(app, surge.riftIds);
  if (surge.phase === 'warning') {
    return { phase: 'warning', direction, seconds: Math.ceil(realSecondsUntil(snapshot, surge.activeAtSeconds)), hpMultiplier: surge.hpMultiplier };
  }
  return { phase: 'active', direction, seconds: Math.ceil(realSecondsUntil(snapshot, surge.endsAtSeconds)), hpMultiplier: surge.hpMultiplier };
}

export function relayCandidateAreas(app, snapshot, tower) {
  if (!tower) return [];
  const definition = catalogDefinition(snapshot, tower.definitionId);
  const linkRange = Math.max(0, definition?.linkRange || 0);
  if (!isRelayForm(definition?.id) || linkRange <= 0) return [];
  return app.game.currentMap.defenseAreas.filter((area) => (
    area.id !== tower.areaId && defenseAreaField(area, tower.x, tower.y, linkRange) <= 0
  ));
}

export function weaponView(snapshot, tower) {
  return catalogDefinition(snapshot, tower?.echoWeaponId || tower?.definitionId);
}

export function economyNetworkSummary(snapshot, tower) {
  // The authority only ever credits one representative tower per network for a shared
  // bonus (see recordAttackResult / applyKillIncomeSupport); presenting the summed total
  // across the whole network - not this one tower's own field - is what actually matches
  // the shared mechanic, without touching the underlying accounting.
  const networkTowers = networkSources(snapshot, tower.areaId);
  const mints = networkTowers.filter((candidate) => candidate.definitionId === 'mint');
  const forges = networkTowers.filter((candidate) => candidate.definitionId === 'forge');
  return {
    mintCount: mints.length,
    mintBonusPercent: mints.length ? 20 + mints.length - 1 : 0,
    mintCredits: mints.reduce((total, candidate) => total + (candidate.bonusCredits || 0), 0),
    forgeCount: forges.length,
    forgeCredits: forges.reduce((total, candidate) => total + (candidate.bonusCredits || 0), 0)
  };
}
