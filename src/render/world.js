import { project } from '../app/camera.js';
import { catalogDefinition, surgeStatus } from '../app/queries.js';
import { playerColor } from '../app/social.js';
import { registerHitbox } from '../app/ui-state.js';
import { socketPoint } from '../core/network-descendants.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { hasResearch } from '../core/research.js';
import { drawAssemblyFrame } from './assembly.js';
import { combatMetrics } from './combat-marks.js';
import { sweepPose } from './laser-effects.js';
import { drawCompactTowerSprite } from './tower-sprites.js';
import { enemyPointSize, riftAppearance } from './world-appearance.js';
import { drawDashedLink } from './world-geometry.js';
import { RIFT_BOUNDS, drawBaseSprite, drawRiftSprite } from './world-sprites.js';
import { COLOR } from '../ui/palette.js';

export function drawTower(app, tower, override = null) {
  const p = project(app, tower.x, tower.y);
  const tick = app.game.sessionSnapshot?.runTick || 0;
  const control = tower.definitionId === 'bond'
    ? tower.effectiveControl || catalogDefinition(app.game.sessionSnapshot, 'bond')?.control
    : null;
  const period = Math.max(1, Math.round((control?.periodSeconds || 6) * AUTHORITY_TICK_RATE));
  const pulseTick = tick % period;
  const bounds = drawCompactTowerSprite(app.renderer.shapes, COLOR, p, tower, app.viewport.camera.scale, override, {
    runTick: app.effects.reducedNetworkMotion.matches ? 0 : tick,
    sweepPhase: (() => {
      if (tower.definitionId !== 'sweeper' || app.effects.reducedNetworkMotion.matches) return null;
      const field = app.game.sessionSnapshot?.attackFields.find((f) => f.kind === 'sweep_line' && f.attack.sourceTowerId === tower.id);
      const pose = field ? sweepPose(field, tick) : null;
      return pose ? (field.sweepDirection < 0 ? 1-pose.phase : pose.phase) : null;
    })(),
    controlActive: pulseTick < Math.round((control?.durationSeconds || 2) * AUTHORITY_TICK_RATE)
      && tick - pulseTick >= (tower.controlReadyTick || 0)
  });
  if (app.game.session.networkRole && tower.ownerId) app.renderer.shapes.rect(p.x - 1, p.y + bounds.bottom + 4, 3, 2, playerColor(app, tower.ownerId));
  if (tower.definitionId === 'hardpoint') {
    const point = socketPoint(app.game.sessionSnapshot, app.game.currentMap, tower);
    if (point) {
      const socket = project(app, point.x, point.y);
      drawDashedLink(app, p, socket, COLOR.dimMint);
      const half = Math.max(3, Math.round(combatMetrics(app.viewport.camera.scale).tower / 2));
      app.renderer.shapes.rect(socket.x - half, socket.y - half, half * 2 + 1, 1, COLOR.amber);
      app.renderer.shapes.rect(socket.x - half, socket.y + half, half * 2 + 1, 1, COLOR.amber);
      app.renderer.shapes.rect(socket.x - half, socket.y - half + 1, 1, half * 2 - 1, COLOR.amber);
      app.renderer.shapes.rect(socket.x + half, socket.y - half + 1, 1, half * 2 - 1, COLOR.amber);
    }
  }
}

export function drawPerimeterIntel(app, snapshot, frame) {
  if (!hasResearch(snapshot,36)) return;
  if (snapshot.runTick < app.effects.perimeterIntelTick || snapshot.runTick - app.effects.perimeterIntelTick >= 30 || app.effects.perimeterIntelTick < 0) {
    app.effects.perimeterIntelTick = snapshot.runTick;
    const sources = snapshot.towers.filter((tower) => catalogDefinition(snapshot, tower.definitionId)?.networkNode);
    const seen = [];
    for (let i=0;i<frame.count;i++) {
      const hp=frame.hpById[frame.idByIndex[i]], x=frame.state[i*4], y=frame.state[i*4+1];
      if(hp<2 || !sources.some((tower)=>Math.hypot(tower.x-x,tower.y-y)<=(tower.effectiveRange||170)*2)) continue;
      seen.push({x,y,hp});
    }
    seen.sort((a,b)=>b.hp-a.hp||a.x-b.x||a.y-b.y);
    app.effects.perimeterIntel=[];
    for(const enemy of seen) {
      if(app.effects.perimeterIntel.every((group)=>Math.hypot(group.x-enemy.x,group.y-enemy.y)>96)) app.effects.perimeterIntel.push(enemy);
      if(app.effects.perimeterIntel.length===6) break;
    }
  }
  const half=Math.max(3,Math.round(enemyPointSize(app.viewport.camera.scale,2)));
  for(const group of app.effects.perimeterIntel) {
    const p=project(app, group.x,group.y);
    app.renderer.shapes.rect(p.x-half,p.y-half,half*2+1,1,COLOR.amber);
    app.renderer.shapes.rect(p.x-half,p.y+half,half*2+1,1,COLOR.amber);
    app.renderer.bitmapText.draw(`${Math.ceil(group.hp)} hp`,p.x+half+3,p.y-3,COLOR.amber,1);
  }
}

export function drawBase(app, snapshot) {
  const p = project(app, snapshot.base.x, snapshot.base.y);
  drawBaseSprite(app.renderer.shapes, COLOR, p, app.effects.baseDamage.appearance(snapshot, app.effects.reducedNetworkMotion.matches));
}

export function drawAssembly(app, snapshot) {
  for (const frame of app.effects.assembly.frames(snapshot.runTick, app.effects.reducedNetworkMotion.matches)) {
    const tower = snapshot.towers.find((candidate) => candidate.id === frame.towerId);
    if (!tower) continue;
    drawAssemblyFrame(app.renderer.shapes, COLOR, project(app, tower.x, tower.y), frame);
  }
}

// Arena maps are enclosed on every side: the same hazard-striped wall frames all four
// edges because pressure arrives from every direction instead of over a southern wall.

export function drawArenaFrame(app, map) {
  const topLeft = project(app, map.bounds.left, map.bounds.top);
  const bottomRight = project(app, map.bounds.right, map.bounds.bottom);
  const left = Math.round(topLeft.x), top = Math.round(topLeft.y);
  const right = Math.round(bottomRight.x), bottom = Math.round(bottomRight.y);
  const x0 = Math.max(0, left), x1 = Math.min(app.viewport.logicalWidth, right);
  const y0 = Math.max(0, top), y1 = Math.min(app.viewport.logicalHeight, bottom);
  if (x1 <= x0 || y1 <= y0) return;
  if (bottom <= app.viewport.logicalHeight) {
    app.renderer.shapes.rect(x0, bottom - 3, x1 - x0, 3, COLOR.dimMint);
    for (let x = x0 - ((x0 - left) % 24); x < x1; x += 24) app.renderer.shapes.rect(Math.max(x0, x), bottom - 3, 12, 1, COLOR.amber);
  }
  if (top >= 0) {
    app.renderer.shapes.rect(x0, top, x1 - x0, 3, COLOR.dimMint);
    for (let x = x0 - ((x0 - left) % 24); x < x1; x += 24) app.renderer.shapes.rect(Math.max(x0, x), top + 2, 12, 1, COLOR.amber);
  }
  if (left >= 0) {
    app.renderer.shapes.rect(left, y0, 3, y1 - y0, COLOR.dimMint);
    for (let y = y0 - ((y0 - top) % 24); y < y1; y += 24) app.renderer.shapes.rect(left + 2, Math.max(y0, y), 1, 12, COLOR.amber);
  }
  if (right <= app.viewport.logicalWidth) {
    app.renderer.shapes.rect(right - 3, y0, 3, y1 - y0, COLOR.dimMint);
    for (let y = y0 - ((y0 - top) % 24); y < y1; y += 24) app.renderer.shapes.rect(right - 3, Math.max(y0, y), 1, 12, COLOR.amber);
  }
}

export function drawTestFieldWorld(app, snapshot) {
  const overrides = snapshot.test?.spawnSourceOverrides || {};
  for (const source of app.game.currentMap.spawnSources) {
    const appearance = riftAppearance(snapshot, source, app.effects.reducedNetworkMotion.matches);
    if (!appearance.visible) continue;
    const position = overrides[source.id] || source;
    const p = project(app, position.x, position.y);
    if (p.x + RIFT_BOUNDS.right < 0 || p.x + RIFT_BOUNDS.left > app.viewport.logicalWidth
        || p.y + RIFT_BOUNDS.bottom < app.viewport.HUD_TOP_HEIGHT || p.y + RIFT_BOUNDS.top > app.viewport.hudBottomY) continue;
    drawRiftSprite(app.renderer.shapes, COLOR, p, appearance);
    if (app.game.sessionMode === 'test') {
      const enabled = appearance.state === 'live';
      app.renderer.bitmapText.draw(source.id.replace('test_', ''), p.x + 25, p.y - 3, enabled ? COLOR.red : COLOR.dimMint, 1);
      registerHitbox(app, `spawn_${source.id}`, p.x + RIFT_BOUNDS.left, p.y + RIFT_BOUNDS.top,
        RIFT_BOUNDS.right - RIFT_BOUNDS.left, RIFT_BOUNDS.bottom - RIFT_BOUNDS.top, {
          drag: { kind: 'spawn-point', sourceId: source.id }
        });
      continue;
    }
    const color = appearance.hot || appearance.remaining > 0 ? COLOR.amber : COLOR.red;
    const status = appearance.hot ? surgeStatus(app, snapshot) : null;
    const label = status ? (status.phase === 'warning' ? `surge ${status.seconds}s` : 'surge // hot')
      : appearance.remaining > 0 ? `rift ${Math.ceil(appearance.remaining)}s` : 'rift // live';
    app.renderer.bitmapText.draw(label, p.x - label.length * 3, p.y + 25, color, 1);
  }
}
