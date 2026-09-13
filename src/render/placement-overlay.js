import { project, unproject } from '../app/camera.js';
import { catalogDefinition, relayCandidateAreas, weaponView } from '../app/queries.js';
import { registerHitbox } from '../app/ui-state.js';
import { normalizeControlGeometry } from '../core/control-system.js';
import { compactMetric } from '../core/format.js';
import { isRelayForm, purchaseCost, socketPoint } from '../core/network-descendants.js';
import { MIN_TOWER_SPACING, towerPlacementClear } from '../core/placement.js';
import { strikeImpactPoints, supportsStrikePoint } from '../core/strike-pattern.js';
import { towerBuildQuote } from '../core/tower-catalog.js';
import { findDefenseAreaAt } from '../core/world-config.js';
import { relayColors } from './network.js';
import { towerScreenBounds } from './tower-sprites.js';
import { drawAreaTargetBrackets, drawControlDirectionArrow, drawDashedLink, drawWorldRing } from './world-geometry.js';
import { drawBodyBrackets } from './world-sprites.js';
import { drawTower } from './world.js';
import { TOWER_DEFINITION_ID } from '../ui/catalog-data.js';
import { COLOR } from '../ui/palette.js';
import { drawTowerMenu } from '../ui/tower-panels.js';

export function drawRelayTargetOverlay(app, snapshot, tower) {
  const definition = catalogDefinition(snapshot, tower.definitionId);
  const linkRange = definition?.linkRange || 0;
  const candidates = relayCandidateAreas(app, snapshot, tower);
  const pointerWorld = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
  const hoveredAreaId = findDefenseAreaAt(app.game.currentMap, pointerWorld.x, pointerWorld.y);
  const from = project(app, tower.x, tower.y);
  if (linkRange > 0) drawWorldRing(app, tower.x, tower.y, linkRange, COLOR.cyan);
  for (const area of candidates) {
    const selected = area.id === tower.relayTargetAreaId;
    const hovered = area.id === hoveredAreaId;
    const palette = relayColors(app, area.id);
    const color = hovered ? palette.glint : selected ? COLOR.amber : palette.focus;
    const center = project(app, area.shape.x, area.shape.y);
    drawAreaTargetBrackets(app, area, color);
    app.renderer.shapes.rect(center.x - 2, center.y - 2, 5, 5, COLOR.black);
    app.renderer.shapes.rect(center.x - 1, center.y - 1, 3, 3, color);
    if (hovered || selected) drawDashedLink(app, from, center, color);
  }
}

export function strikeAttackForDisplay(tower, definition) {
  return {
    ...definition.attack,
    range: tower.effectiveRange || definition.range || 0
  };
}

export function drawStrikePointPattern(app, tower, definition, point, color) {
  const attack = strikeAttackForDisplay(tower, definition);
  if (attack.mechanic === 'shotgun') {
    // Broadside aims a facing, not an impact: show the fan edges and centre line.
    const from = project(app, tower.x, tower.y), range = attack.range;
    const angle = Math.atan2(point.y - tower.y, point.x - tower.x);
    const half = (attack.rework?.fanRadians || 1.3) * 0.5;
    for (const offset of [-half, 0, half]) {
      drawDashedLink(app, from, project(app, tower.x + Math.cos(angle + offset) * range, tower.y + Math.sin(angle + offset) * range), color);
    }
    const tip = project(app, tower.x + Math.cos(angle) * range * 0.6, tower.y + Math.sin(angle) * range * 0.6);
    app.renderer.shapes.rect(tip.x - 1, tip.y - 1, 3, 3, color);
    return;
  }
  if (['hitscan','persistent'].includes(attack.delivery.type)) {
    const from=project(app, tower.x,tower.y),range=attack.range;
    const angle=Math.atan2(point.y-tower.y,point.x-tower.x);
    const count=attack.volley.count||1;
    const angles=attack.delivery.motion==='sweep' ? [-.5,0,.5].map((offset)=>angle+offset*attack.delivery.sweepRadians)
      : Array.from({length:count},(_,i)=>angle+(i-(count-1)/2)*.12);
    for(const theta of angles) drawDashedLink(app, from,project(app, tower.x+Math.cos(theta)*range,tower.y+Math.sin(theta)*range),color);
    return;
  }
  const impacts = strikeImpactPoints(tower, attack, point);
  const radius = Math.max(1, attack.geometry?.radius || 1);
  const towerPoint = project(app, tower.x, tower.y);
  const center = project(app, point.x, point.y);
  drawDashedLink(app, towerPoint, center, color);
  for (const impact of impacts) {
    drawWorldRing(app, impact.x, impact.y, radius, color);
    const marker = project(app, impact.x, impact.y);
    app.renderer.shapes.rect(marker.x - 4, marker.y, 9, 1, color);
    app.renderer.shapes.rect(marker.x, marker.y - 4, 1, 9, color);
    app.renderer.shapes.rect(marker.x - 1, marker.y - 1, 3, 3, COLOR.black);
    app.renderer.shapes.rect(marker.x, marker.y, 1, 1, color);
  }
}

export function drawStrikeTargetOverlay(app, snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  if (!supportsStrikePoint(definition?.attack)) return;
  const range = tower.effectiveRange || definition.range || 0;
  drawWorldRing(app, tower.x, tower.y, range, COLOR.cyan);
  if (tower.strikePoint) drawStrikePointPattern(app, tower, definition, tower.strikePoint, COLOR.amber);
  if (app.ui.pointer.y <= app.viewport.HUD_TOP_HEIGHT || app.ui.pointer.y >= app.viewport.hudBottomY) return;
  const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
  const valid = Math.hypot(world.x - tower.x, world.y - tower.y) <= range;
  drawStrikePointPattern(app, tower, definition, world, valid ? COLOR.mint : COLOR.red);
}

export function drawControlGeometryShape(app, tower, definition, geometry, color) {
  const control = tower.effectiveControl || definition?.control;
  if (!control || !geometry) return;
  const from = project(app, tower.x, tower.y);
  if (geometry.kind === 'direction') {
    drawControlDirectionArrow(app, tower, geometry, (tower.effectiveRange || definition.range) * 0.72, color);
    return;
  }
  if (geometry.kind === 'point') {
    const point = project(app, geometry.x, geometry.y);
    drawDashedLink(app, from, point, color);
    drawWorldRing(app, geometry.x, geometry.y, control.radius || 8, color);
    app.renderer.shapes.rect(point.x - 4, point.y, 9, 1, color);
    app.renderer.shapes.rect(point.x, point.y - 4, 1, 9, color);
    return;
  }
  const first = project(app, geometry.x1, geometry.y1);
  const second = project(app, geometry.x2, geometry.y2);
  const midpoint = { x: Math.round((first.x + second.x) * 0.5), y: Math.round((first.y + second.y) * 0.5) };
  drawDashedLink(app, from, midpoint, color);
  app.renderer.shapes.line(first.x, first.y, second.x, second.y, 2, color);
  app.renderer.shapes.rect(first.x - 2, first.y - 2, 5, 5, COLOR.black);
  app.renderer.shapes.rect(first.x - 1, first.y - 1, 3, 3, color);
  app.renderer.shapes.rect(second.x - 2, second.y - 2, 5, 5, COLOR.black);
  app.renderer.shapes.rect(second.x - 1, second.y - 1, 3, 3, color);
  const width = control.width || control.thickness * 2 || 0;
  if (width > 0) {
    const dx = geometry.x2 - geometry.x1;
    const dy = geometry.y2 - geometry.y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width * 0.5;
    const ny = dx / length * width * 0.5;
    const edgeA1 = project(app, geometry.x1 + nx, geometry.y1 + ny);
    const edgeA2 = project(app, geometry.x2 + nx, geometry.y2 + ny);
    const edgeB1 = project(app, geometry.x1 - nx, geometry.y1 - ny);
    const edgeB2 = project(app, geometry.x2 - nx, geometry.y2 - ny);
    app.renderer.shapes.line(edgeA1.x, edgeA1.y, edgeA2.x, edgeA2.y, 1, COLOR.dimMint);
    app.renderer.shapes.line(edgeB1.x, edgeB1.y, edgeB2.x, edgeB2.y, 1, COLOR.dimMint);
  }
}

export function drawControlGeometryOverlay(app, snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const control = definition?.control;
  if (!control || control.input === 'none') return;
  const range = tower.effectiveRange || definition.range || 0;
  drawWorldRing(app, tower.x, tower.y, range, COLOR.cyan);
  if (tower.controlGeometry) drawControlGeometryShape(app, tower, definition, tower.controlGeometry, COLOR.amber);
  if (control.input === 'line') {
    if (app.ui.controlDrag?.towerId === tower.id) {
      const geometry = {
        kind: 'line',
        x1: app.ui.controlDrag.start.x,
        y1: app.ui.controlDrag.start.y,
        x2: app.ui.controlDrag.current.x,
        y2: app.ui.controlDrag.current.y
      };
      const length = Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1);
      const valid = length >= 12
        && length <= control.maxLength
        && Math.hypot(geometry.x1 - tower.x, geometry.y1 - tower.y) <= range
        && Math.hypot(geometry.x2 - tower.x, geometry.y2 - tower.y) <= range;
      drawControlGeometryShape(app, tower, definition, geometry, valid ? COLOR.mint : COLOR.red);
    }
    return;
  }
  if (app.ui.pointer.y <= app.viewport.HUD_TOP_HEIGHT || app.ui.pointer.y >= app.viewport.hudBottomY) return;
  const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
  const dx = world.x - tower.x;
  const dy = world.y - tower.y;
  const distance = Math.hypot(dx, dy);
  const geometry = control.input === 'point'
    ? { kind: 'point', x: world.x, y: world.y }
    : { kind: 'direction', dx, dy };
  const normalized = normalizeControlGeometry(definition, tower, geometry, app.game.currentMap);
  const valid = distance <= range && Boolean(normalized);
  drawControlGeometryShape(app, tower, definition, normalized || geometry, valid ? COLOR.mint : COLOR.red);
}

export function towerRingRange(tower, definition) {
  // A tower-centred passive has an effect radius, not a weapon/placement range.
  if (definition?.control?.input === 'none' && definition.control.radius) return definition.control.radius;
  return tower?.effectiveRange || definition?.range;
}

export function drawBuildState(app, snapshot) {
  const selected = snapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId);
  if (app.ui.showAllRanges) {
    for (const tower of snapshot.towers) {
      const definition = catalogDefinition(snapshot, tower.definitionId);
      const range = towerRingRange(tower, definition);
      if (range) drawWorldRing(app, tower.x, tower.y, range, COLOR.dimMint);
    }
  }
  if (selected) {
    const p = project(app, selected.x, selected.y);
    const selectedDefinition = catalogDefinition(snapshot, selected.definitionId);
    const selectedRange = towerRingRange(selected, selectedDefinition);
    if (app.ui.towerMenuMode === 'relay') drawRelayTargetOverlay(app, snapshot, selected);
    else if (app.ui.towerMenuMode === 'strike') drawStrikeTargetOverlay(app, snapshot, selected);
    else if (app.ui.towerMenuMode === 'control') drawControlGeometryOverlay(app, snapshot, selected);
    else {
      if (selectedRange && !app.ui.showAllRanges) drawWorldRing(app, selected.x, selected.y, selectedRange, COLOR.dimMint);
      if (selected.strikePoint && supportsStrikePoint(selectedDefinition?.attack)) {
        drawStrikePointPattern(app, selected, selectedDefinition, selected.strikePoint, COLOR.amber);
      }
      if (selected.controlGeometry && selectedDefinition?.control) {
        drawControlGeometryShape(app, selected, selectedDefinition, selected.controlGeometry, COLOR.amber);
      }
    }
    drawBodyBrackets(app.renderer.shapes, p, towerScreenBounds(selected.definitionId, app.viewport.camera.scale), COLOR.amber);
  }
  if (app.game.sessionMode === 'test') {
    for (const tower of snapshot.towers) {
      const p = project(app, tower.x, tower.y);
      registerHitbox(app, `tower_drag_${tower.id}`, p.x - 7, p.y - 7, 15, 15, {
        drag: { kind: 'tower', towerId: tower.id }
      });
    }
  }
  if (selected && app.ui.towerMenuMode && (app.game.sessionMode === 'game' || ['arsenal','reactor'].includes(selected.definitionId) || isRelayForm(selected.definitionId) || ['relay', 'strike', 'control'].includes(app.ui.towerMenuMode))) drawTowerMenu(app, snapshot, selected);
  if (!app.ui.placementArmed || app.ui.pointer.y <= app.viewport.HUD_TOP_HEIGHT || app.ui.pointer.y >= app.viewport.hudBottomY) return;
  const placementDefinitionId = app.ui.bulkPlacementDefinitionId || TOWER_DEFINITION_ID;
  const placementDefinition = catalogDefinition(snapshot, placementDefinitionId);
  const quote = towerBuildQuote(snapshot.towerCatalog, placementDefinitionId);
  const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
  const economy = snapshot.teamEconomy;
  const socketHost = snapshot.towers.find((tower) => {
    const point = socketPoint(snapshot, app.game.currentMap, tower);
    return point && Math.hypot(point.x - world.x, point.y - world.y) <= 10;
  });
  const areaId = socketHost?.areaId || findDefenseAreaAt(app.game.currentMap, world.x, world.y);
  const price = quote ? purchaseCost(snapshot, areaId, quote.cost, { placement: true }) : Infinity;
  const snappedPoint = socketHost ? socketPoint(snapshot, app.game.currentMap, socketHost) : world;
  const clear = towerPlacementClear(snapshot.towers, snappedPoint.x, snappedPoint.y);
  const canPlace = clear && Boolean(areaId) && (!socketHost || (placementDefinitionId !== 'hardpoint' && !snapshot.towers.some((tower) => tower.socketHostId === socketHost.id))) && (app.game.sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) >= price;
  drawWorldRing(app, snappedPoint.x, snappedPoint.y, MIN_TOWER_SPACING / 2, clear ? COLOR.dimMint : COLOR.red);
  app.renderer.bitmapText.draw(clear ? `${compactMetric(price)} cr` : 'too close', app.ui.pointer.x + 12, app.ui.pointer.y + 12, canPlace ? COLOR.amber : COLOR.red, 1);
  if (placementDefinition) drawWorldRing(app, world.x, world.y, towerRingRange(null, placementDefinition), canPlace ? COLOR.dimMint : COLOR.red);
  drawTower(app,
    { ...snappedPoint, definitionId: placementDefinitionId },
    { accent: canPlace ? COLOR.green : COLOR.red, core: canPlace ? COLOR.cyan : COLOR.red }
  );
  drawBodyBrackets(app.renderer.shapes, project(app, snappedPoint.x, snappedPoint.y),
    towerScreenBounds(placementDefinitionId, app.viewport.camera.scale), canPlace ? COLOR.cyan : COLOR.red);
}
