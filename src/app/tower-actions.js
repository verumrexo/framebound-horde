import { unproject } from './camera.js';
import { catalogDefinition, defenseAreaCenterById, relayCandidateAreas, weaponView } from './queries.js';
import { openResearchStation } from './research-actions.js';
import { setStatus } from './ui-state.js';
import { normalizeControlGeometry } from '../core/control-system.js';
import { compactMetric } from '../core/format.js';
import { controlSource, isRelayForm, purchaseCost, socketPoint } from '../core/network-descendants.js';
import { COMMAND } from '../core/protocol.js';
import { hasResearch } from '../core/research.js';
import { supportsStrikePoint } from '../core/strike-pattern.js';
import { towerBuildQuote } from '../core/tower-catalog.js';
import { findDefenseAreaAt } from '../core/world-config.js';
import { BUILD_CATALOG_PAGES, TOWER_DEFINITION_ID } from '../ui/catalog-data.js';

export function armFramePlacement(app) {
  const definition = catalogDefinition(app.game.sessionSnapshot, TOWER_DEFINITION_ID);
  const economy = app.game.sessionSnapshot.teamEconomy;
  if ((app.game.sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) < (definition?.cost ?? Infinity)) {
    app.ui.placementArmed = false;
    app.ui.bulkPlacementDefinitionId = null;
    setStatus(app, `need ${compactMetric(definition?.cost || 100)} credits`);
    return;
  }
  app.ui.placementArmed = true;
  app.ui.bulkPlacementDefinitionId = null;
  app.ui.buildCatalogOpen = false;
  app.ui.selectedTowerId = null;
  app.ui.towerMenuMode = null;
  setStatus(app, 'place one frame // click nebula');
}

export function openBuildCatalog(app, pageId = app.ui.buildCatalogPageId) {
  if (app.game.sessionMode === 'game' && app.game.sessionSnapshot.phase !== 'running') {
    setStatus(app, 'start a run before building');
    return;
  }
  if (BUILD_CATALOG_PAGES[pageId]) app.ui.buildCatalogPageId = pageId;
  app.ui.placementArmed = false;
  app.ui.bulkPlacementDefinitionId = null;
  app.ui.buildCatalogOpen = true;
  if (app.game.sessionMode === 'game') {
    app.ui.selectedTowerId = null;
    app.ui.towerMenuMode = null;
    setStatus(app, 'choose a tower // full path price');
  } else {
    setStatus(app, 'choose a test form // tab changes page');
  }
}

export function closeBuildCatalog(app) {
  app.ui.buildCatalogOpen = false;
  setStatus(app, 'tower catalog closed');
}

export function selectBulkPlacementDefinition(app, definitionId) {
  const definition = catalogDefinition(app.game.sessionSnapshot, definitionId);
  if (app.game.sessionMode === 'test') {
    if (!definition) {
      setStatus(app, 'test form is unavailable');
      return;
    }
    app.ui.buildCatalogOpen = false;
    switchTestTowerForm(app, definitionId);
    return;
  }
  const quote = towerBuildQuote(app.game.sessionSnapshot.towerCatalog, definitionId);
  const economy = app.game.sessionSnapshot.teamEconomy;
  if (!definition || !quote) {
    setStatus(app, 'tower build path is unavailable');
    return;
  }
  if ((app.game.sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) < Math.min(...app.game.currentMap.defenseAreas.map((area) => purchaseCost(app.game.sessionSnapshot, area.id, quote.cost, { placement: true, escalatableCost: quote.rootCost })))) {
    setStatus(app, `need ${compactMetric(purchaseCost(app.game.sessionSnapshot, null, quote.cost, { placement: true, escalatableCost: quote.rootCost }))} credits for ${definition.label}`);
    return;
  }
  app.ui.bulkPlacementDefinitionId = definitionId;
  app.ui.placementArmed = true;
  app.ui.buildCatalogOpen = false;
  app.ui.selectedTowerId = null;
  app.ui.towerMenuMode = null;
  setStatus(app, `${definition.label} ${compactMetric(purchaseCost(app.game.sessionSnapshot, null, quote.cost, { placement: true, escalatableCost: quote.rootCost }))} // place many // right click ends`);
}

export function switchTestTowerForm(app, definitionId) {
  const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId) || app.game.sessionSnapshot.towers[0];
  if (!tower) return;
  if (!app.ui.testKeepSwarm) app.game.session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  app.game.session.send(COMMAND.TEST_TOWER_FORM_SET, { towerId: tower.id, definitionId });
  app.ui.selectedTowerId = tower.id;
  setStatus(app, `${definitionId} loaded${app.ui.testKeepSwarm ? ' // swarm kept' : ' // reset'}`);
}

export function evolveSelectedTower(app, definitionId) {
  const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
  if (!tower) return;
  const definition = catalogDefinition(app.game.sessionSnapshot, tower.definitionId);
  if (!definition?.evolutionChoices?.includes(definitionId)) {
    setStatus(app, 'next branch not designed yet');
    return;
  }
  app.game.session.send(COMMAND.TOWER_EVOLVE, { towerId: tower.id, definitionId });
  setStatus(app, `${definitionId} command sent`);
}

export function cycleSelectedTargeting(app, direction) {
  const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
  const definition = catalogDefinition(app.game.sessionSnapshot, tower?.definitionId);
  if (!tower || !definition?.targetingModes?.length) return;
  const modes=[...definition.targetingModes,...(hasResearch(app.game.sessionSnapshot,16)?['execution']:[]),...(hasResearch(app.game.sessionSnapshot,36)?['highest_hp']:[])];
  const current=Math.max(0,modes.indexOf(tower.targetingMode));
  const next=(current+direction+modes.length)%modes.length;
  app.game.session.send(COMMAND.TOWER_TARGETING_SET,{towerId:tower.id,mode:modes[next]});
}

export function selectedControlContext(app) {
  const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
  const definition = weaponView(app.game.sessionSnapshot, tower);
  return { tower, definition, control: definition?.control || null };
}

export function sendSelectedControlGeometry(app, geometry) {
  const { tower, definition, control } = selectedControlContext(app);
  if (!tower || !control || control.input === 'none') {
    setStatus(app, 'tower has no editable control');
    return;
  }
  const range = tower.effectiveRange || definition.range || 0;
  if (control.input === 'line') {
    if (geometry?.kind !== 'line') return;
    const length = Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1);
    const outside = Math.hypot(geometry.x1 - tower.x, geometry.y1 - tower.y) > range
      || Math.hypot(geometry.x2 - tower.x, geometry.y2 - tower.y) > range;
    if (length < 12 || length > control.maxLength || outside) {
      setStatus(app, outside ? 'line endpoints outside range' : `line must be 12-${control.maxLength}u`);
      return;
    }
  }
  const normalized = normalizeControlGeometry(definition, tower, geometry, app.game.currentMap);
  if (!normalized) {
    setStatus(app, control.type === 'crosswind' ? 'choose a side // no upstream push' : 'control geometry outside map');
    return;
  }
  app.game.session.send(COMMAND.TOWER_CONTROL_GEOMETRY_SET, { towerId: tower.id, geometry: normalized });
  setStatus(app, 'control geometry sent // reboot 1s');
}

export function handleWorldClick(app, screenPoint) {
  if (app.ui.devToolsOpen) return;
  const world = unproject(app, screenPoint.x, screenPoint.y);
  if (['echo', 'socket'].includes(app.ui.towerMenuMode) && app.ui.selectedTowerId) {
    const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
    if (!tower) return;
    if (app.ui.towerMenuMode === 'echo') {
      const source = app.game.sessionSnapshot.towers.find((candidate) => Math.hypot(candidate.x - world.x, candidate.y - world.y) <= 18 && controlSource(app.game.sessionSnapshot, tower, candidate.id));
      if (!source) { setStatus(app, 'click a connected control turret'); return; }
      app.game.session.send(COMMAND.TOWER_ECHO_SOURCE_SET, { towerId: tower.id, sourceTowerId: source.id });
    } else {
      const target = defenseAreaCenterById(app, tower.relayTargetAreaId);
      if (!target) { setStatus(app, 'link a nebula first'); return; }
      const dx = target.x - tower.x, dy = target.y - tower.y;
      const fraction = Math.max(0, Math.min(1, ((world.x - tower.x) * dx + (world.y - tower.y) * dy) / (dx * dx + dy * dy || 1)));
      app.game.session.send(COMMAND.TOWER_SOCKET_SET, { towerId: tower.id, fraction });
    }
    app.ui.towerMenuMode = 'actions';
    return;
  }
  if (app.ui.towerMenuMode === 'control' && app.ui.selectedTowerId) {
    const { tower, definition, control } = selectedControlContext(app);
    const range = tower?.effectiveRange || definition?.range || 0;
    if (!tower || !control || control.input === 'none') {
      app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
      setStatus(app, 'tower has no editable control');
      return;
    }
    if (control.input === 'line') {
      setStatus(app, 'click-drag to draw the line');
      return;
    }
    const distance = Math.hypot(world.x - tower.x, world.y - tower.y);
    if (distance > range || (control.input === 'direction' && distance <= 0.001)) {
      setStatus(app, distance > range ? 'control point outside range' : 'direction needs an arrow');
      return;
    }
    sendSelectedControlGeometry(app, { kind: control.input, x: world.x, y: world.y });
    return;
  }
  if (app.ui.towerMenuMode === 'strike' && app.ui.selectedTowerId) {
    const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
    const definition = weaponView(app.game.sessionSnapshot, tower);
    const range = tower?.effectiveRange || definition?.range || 0;
    if (!tower || !supportsStrikePoint(definition?.attack)) {
      app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
      setStatus(app, 'tower cannot set a strike point');
      return;
    }
    if (Math.hypot(world.x - tower.x, world.y - tower.y) > range) {
      setStatus(app, 'strike point outside range');
      return;
    }
    app.game.session.send(COMMAND.TOWER_STRIKE_POINT_SET, { towerId: tower.id, x: world.x, y: world.y });
    setStatus(app, 'strike point command sent');
    return;
  }
  if (app.ui.towerMenuMode === 'relay' && app.ui.selectedTowerId) {
    const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
    const areaId = findDefenseAreaAt(app.game.currentMap, world.x, world.y);
    const eligible = relayCandidateAreas(app, app.game.sessionSnapshot, tower).some((area) => area.id === areaId);
    if (!areaId || !eligible) {
      setStatus(app, areaId === tower?.areaId ? 'choose another nebula' : 'nebula outside relay range');
      return;
    }
    app.game.session.send(COMMAND.TOWER_RELAY_TARGET_SET, { towerId: tower.id, targetAreaId: areaId });
    setStatus(app, 'relay link command sent');
    return;
  }
  if (app.ui.placementArmed) {
    if (app.game.sessionMode === 'test' && app.game.sessionSnapshot.towers.length >= 9) {
      setStatus(app, 'all 8 support slots are used');
      return;
    }
    if (!findDefenseAreaAt(app.game.currentMap, world.x, world.y) && !app.game.sessionSnapshot.towers.some((tower) => {
      const point = socketPoint(app.game.sessionSnapshot, app.game.currentMap, tower);
      return point && Math.hypot(point.x - world.x, point.y - world.y) <= 10;
    })) {
      setStatus(app, 'build inside nebula');
      return;
    }
    const definitionId = app.ui.bulkPlacementDefinitionId || TOWER_DEFINITION_ID;
    const definition = catalogDefinition(app.game.sessionSnapshot, definitionId);
    const quote = towerBuildQuote(app.game.sessionSnapshot.towerCatalog, definitionId);
    app.game.session.send(COMMAND.TOWER_PLACE, { definitionId, x: world.x, y: world.y });
    if (app.ui.bulkPlacementDefinitionId) {
      app.ui.selectedTowerId = null;
      app.ui.towerMenuMode = null;
      setStatus(app, `${definition?.label || definitionId} ${compactMetric(quote?.cost || 0)} // click next // right click ends`);
    } else {
      app.ui.placementArmed = false;
      app.ui.selectedTowerId = null;
      app.ui.towerMenuMode = null;
      setStatus(app, 'frame placement command sent');
    }
    return;
  }
  let nearest = null;
  let nearestDistance = 11 * app.viewport.camera.scale;
  for (const tower of app.game.sessionSnapshot.towers) {
    const distance = Math.hypot(tower.x - world.x, tower.y - world.y);
    if (distance < nearestDistance) {
      nearest = tower;
      nearestDistance = distance;
    }
  }
  app.ui.selectedTowerId = nearest?.id || null;
  app.ui.towerMenuMode = nearest && (app.game.sessionMode === 'game' || isRelayForm(nearest.definitionId)) ? 'actions' : null;
  if (nearest && ['arsenal','reactor'].includes(nearest.definitionId)) openResearchStation(app, nearest);
  setStatus(app, nearest ? `${nearest.definitionId} selected` : 'selection cleared');
}

export function openUpgradeMenu(app, snapshot, tower) {
  const definition = catalogDefinition(snapshot, tower.definitionId);
  if (!definition?.evolutionChoices?.length) {
    setStatus(app, 'next branches are not designed yet');
    return;
  }
  app.ui.towerMenuMode = 'upgrades';
  setStatus(app, 'choose one replacement');
}

export function openRelayTargetMenu(app, snapshot, tower) {
  if (!isRelayForm(tower?.definitionId)) return;
  app.ui.towerMenuMode = 'relay';
  const count = relayCandidateAreas(app, snapshot, tower).length;
  setStatus(app, count ? 'click a highlighted nebula' : 'no nebulas inside link range');
}

export function openStrikeTargetMenu(app, snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus(app, 'tower cannot aim manually');
    return;
  }
  app.ui.towerMenuMode = 'strike';
  setStatus(app, 'click a strike point inside range');
}

export function clearSelectedStrikePoint(app) {
    const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
  const definition = weaponView(app.game.sessionSnapshot, tower);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus(app, 'tower has no strike point');
    return;
  }
  app.game.session.send(COMMAND.TOWER_STRIKE_POINT_SET, { towerId: tower.id, x: null, y: null });
  setStatus(app, 'automatic impact command sent');
}

export function openControlGeometryMenu(app, snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const input = definition?.control?.input;
  if (!tower || !input || input === 'none') {
    setStatus(app, 'tower has no editable control');
    return;
  }
  app.ui.towerMenuMode = 'control';
  setStatus(app, input === 'line' ? 'click-drag inside range' : input === 'point' ? 'click to place the field' : definition.control.type === 'aim' ? 'click to set shotgun facing' : 'choose left or right // no upstream');
}

export function resetSelectedControlGeometry(app) {
  const { tower, control } = selectedControlContext(app);
  if (!tower || !control || control.input === 'none') {
    setStatus(app, 'tower has no editable control');
    return;
  }
  app.game.session.send(COMMAND.TOWER_CONTROL_GEOMETRY_SET, { towerId: tower.id, geometry: null });
  setStatus(app, 'default geometry sent // reboot 1s');
}

export function sellSelectedTower(app) {
  if (!app.ui.selectedTowerId) return;
  app.game.session.send(COMMAND.TOWER_SELL, { towerId: app.ui.selectedTowerId });
  app.ui.towerMenuMode = null;
  setStatus(app, 'sell command sent');
}
