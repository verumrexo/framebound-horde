import { project } from '../app/camera.js';
import { defenseAreaCenterById } from '../app/queries.js';
import { isRelayForm } from '../core/network-descendants.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { towerScreenBounds } from './tower-sprites.js';
import { DEFAULT_RELAY_PALETTE, hashString32 } from './world-appearance.js';
import { drawDashedLink, drawWorldRing } from './world-geometry.js';

export function relayColors(app, areaId) {
  return app.effects.networkPresentation.get(areaId)?.palette || DEFAULT_RELAY_PALETTE;
}

export function drawNetworkLinks(app, snapshot) {
  const definitions = new Map(snapshot.towerCatalog.map((definition) => [definition.id, definition]));
  const relayPairs = new Set();
  const pulseClock = snapshot.runTick / AUTHORITY_TICK_RATE;
  const relays = snapshot.towers.filter((tower) => isRelayForm(tower.definitionId) && tower.relayTargetAreaId);
  const pulseSource = relays[Math.floor(pulseClock / 8) % Math.max(1, relays.length)];
  for (const source of snapshot.towers) {
    if (!isRelayForm(source.definitionId) || !source.relayTargetAreaId) continue;
    const pair = [source.areaId, source.relayTargetAreaId].sort().join(':');
    if (relayPairs.has(pair)) continue;
    relayPairs.add(pair);
    const targetCenter = defenseAreaCenterById(app, source.relayTargetAreaId);
    if (!targetCenter) continue;
    const from = project(app, source.x, source.y);
    const to = project(app, targetCenter.x, targetCenter.y);
    const palette = relayColors(app, source.areaId);
    const focused = source.id === app.ui.selectedTowerId;
    drawDashedLink(app, from, to, focused ? palette.pulse : palette.link);
    app.renderer.shapes.rect(to.x - 1, to.y - 1, 2, 2, focused ? palette.focus : palette.pulse);
    // One two-pixel packet across the entire network, followed by six quiet seconds.
    const phase = pulseClock % 8;
    if (!app.effects.reducedNetworkMotion.matches && source === pulseSource && phase < 2) {
      const progress = phase / 2;
      app.renderer.shapes.rect(from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress, 2, 1, palette.pulse);
    }
  }

  // Established links of a completed network: drawn from the retired relay's last
  // position when known, so the geometry the player built stays legible.
  const retiredByPair = new Map();
  for (const record of snapshot.relayNetwork?.retired || []) {
    if (record.targetAreaId) retiredByPair.set([record.areaId, record.targetAreaId].sort().join(':'), record);
  }
  const persistedLinks = snapshot.relayNetwork?.links || [];
  for (let index = 0; index < persistedLinks.length; index += 1) {
    const [areaA, areaB] = persistedLinks[index];
    const pair = [areaA, areaB].sort().join(':');
    if (relayPairs.has(pair)) continue;
    relayPairs.add(pair);
    const record = retiredByPair.get(pair);
    const sourceCenter = record ? { x: record.x, y: record.y } : defenseAreaCenterById(app, areaA);
    const targetCenter = defenseAreaCenterById(app, record ? record.targetAreaId : areaB);
    if (!sourceCenter || !targetCenter) continue;
    const from = project(app, sourceCenter.x, sourceCenter.y);
    const to = project(app, targetCenter.x, targetCenter.y);
    const palette = relayColors(app, areaA);
    if (Math.max(from.x, to.x) < 0 || Math.min(from.x, to.x) > app.viewport.logicalWidth || Math.max(from.y, to.y) < 0 || Math.min(from.y, to.y) > app.viewport.logicalHeight) continue;
    drawDashedLink(app, from, to, palette.link);
    app.renderer.shapes.rect(from.x - 1, from.y - 1, 2, 2, palette.pulse);
    app.renderer.shapes.rect(to.x - 1, to.y - 1, 2, 2, palette.pulse);
    const phase = (pulseClock + index * 0.37) % 8;
    if (!app.effects.reducedNetworkMotion.matches && relays.length === 0 && phase < 2 && index === Math.floor(pulseClock / 8) % persistedLinks.length) {
      const progress = phase / 2;
      app.renderer.shapes.rect(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, 2, 1, palette.pulse);
    }
  }

  const selected = snapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId);
  if (!selected || !definitions.get(selected.definitionId)?.networkNode) return;
  const linkedAreas = new Set(selected.networkAreaIds || [selected.areaId]);
  const targets = snapshot.towers
    .filter((tower) => tower.id !== selected.id && linkedAreas.has(tower.areaId))
    .sort((left, right) => {
      const leftDistance = (left.x - selected.x) ** 2 + (left.y - selected.y) ** 2;
      const rightDistance = (right.x - selected.x) ** 2 + (right.y - selected.y) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })
    .slice(0, 32);
  const from = project(app, selected.x, selected.y);
  const palette = relayColors(app, selected.areaId);
  for (const target of targets) {
    const to = project(app, target.x, target.y);
    app.renderer.shapes.line(from.x, from.y, to.x, to.y, 1, palette.link);
    app.renderer.shapes.rect(to.x, to.y, 1, 1, palette.pulse);
  }
}

export function startRelayCollapse(app, event) {
  const links = event.payload.retired
    .map((record) => ({ ...record, target: record.targetAreaId ? defenseAreaCenterById(app, record.targetAreaId) : null }));
  app.effects.relayCollapse = { startedTick: event.payload.tick ?? app.game.sessionSnapshot.runTick,
    links, areaIds: event.payload.areaIds || [], mapId: app.game.currentMap.id };
}

export function drawRelayCollapse(app, snapshot) {
  if (!app.effects.relayCollapse) return;
  const age = (snapshot.runTick - app.effects.relayCollapse.startedTick) / AUTHORITY_TICK_RATE;
  if (age < 0 || age >= app.effects.RELAY_COLLAPSE_SECONDS || app.effects.relayCollapse.mapId !== app.game.currentMap.id || app.effects.reducedNetworkMotion.matches) {
    app.effects.relayCollapse = null;
    return;
  }
  const scale = towerScreenBounds('relay', app.viewport.camera.scale).scale;
  for (const record of app.effects.relayCollapse.links) {
    const from = project(app, record.x, record.y);
    if (from.x < -80 || from.x > app.viewport.logicalWidth + 80 || from.y < -80 || from.y > app.viewport.logicalHeight + 80) continue;
    const palette = relayColors(app, record.areaId);
    const box = (x, y, w, h, color) => app.renderer.shapes.rect(from.x + x * scale, from.y + y * scale, w * scale, h * scale, color);
    const seed = hashString32(record.towerId);
    const collapse = Math.min(1, age / 0.5);
    const mastHeight = Math.round(15 * (1 - collapse));
    if (mastHeight > 0) {
      box(0, -8 + (15 - mastHeight), 1, mastHeight, collapse < 0.5 ? palette.focus : palette.link);
      box(-5 + Math.round(collapse * 4), 4, 11 - Math.round(collapse * 8), 2, palette.pulse);
    }
    if (collapse >= 1) {
      const fade = Math.max(0, 1 - (age - 0.5) / 0.6);
      const halo = Math.round(2 + (1 - fade) * 6);
      if (fade > 0) {
        box(-halo, 0, 2, 1, fade > 0.5 ? palette.pulse : palette.link);
        box(halo - 1, 0, 2, 1, fade > 0.5 ? palette.pulse : palette.link);
        box(0, -halo, 1, 2, fade > 0.5 ? palette.pulse : palette.link);
        box(0, halo - 1, 1, 2, fade > 0.5 ? palette.pulse : palette.link);
      }
    }
    if (!record.target) continue;
    const to = project(app, record.target.x, record.target.y);
    for (let packet = 0; packet < 8; packet += 1) {
      const start = 0.3 + packet * 0.11 + ((seed >>> (packet * 3)) & 7) * 0.01;
      const progress = (age - start) / 0.75;
      if (progress < 0 || progress >= 1) continue;
      const eased = progress * progress * (3 - 2 * progress);
      const wobble = (((seed >>> packet) & 3) - 1.5) * (1 - eased);
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
      const x = Math.round(from.x + dx * eased - dy / length * wobble);
      const y = Math.round(from.y + dy * eased + dx / length * wobble);
      const size = progress < 0.85 ? 2 : 1;
      app.renderer.shapes.rect(x, y, size, size, packet % 3 === 0 ? palette.focus : palette.pulse);
    }
  }
  const ringAge = age - 1.2;
  if (ringAge >= 0) {
    for (const areaId of app.effects.relayCollapse.areaIds) {
      const center = defenseAreaCenterById(app, areaId);
      if (!center) continue;
      const area = app.game.currentMap.defenseAreas.find((candidate) => candidate.id === areaId);
      const reach = Math.max(area?.shape.radiusX || 60, area?.shape.radiusY || 40) * 0.9;
      const radius = Math.max(4, reach * Math.min(1, ringAge / 0.8));
      const palette = relayColors(app, areaId);
      drawWorldRing(app, center.x, center.y, radius, ringAge < 0.4 ? palette.pulse : palette.link);
    }
  }
}
