import { project } from './camera.js';
import { drawBackground } from '../render/background.js';
import { drawAttackFlashes, drawImpactBursts } from '../render/combat-effects.js';
import { drawControlFields, drawSelectedBondLinks } from '../render/control-fields.js';
import { drawSweep } from '../render/laser-effects.js';
import { mapWalls } from '../render/map-thumbnail.js';
import { drawNetworkLinks, drawRelayCollapse } from '../render/network.js';
import { drawBuildState } from '../render/placement-overlay.js';
import { drawClusterPayloads, drawProjectiles, drawReworkedCombat, presentProjectiles } from '../render/projectiles.js';
import { relayNetworkPresentation } from '../render/world-appearance.js';
import { drawArenaFrame, drawAssembly, drawBase, drawPerimeterIntel, drawTestFieldWorld, drawTower } from '../render/world.js';
import { drawHud } from '../ui/hud.js';
import { drawCoopMenu, drawDevTools, drawEscapeMenu, drawMainMenu, drawMapSelection, drawOptionsScreen } from '../ui/menus.js';
import { COLOR } from '../ui/palette.js';
import { drawResearchStation, drawStatsPanel } from '../ui/research.js';
import { drawChat, drawCursor, drawGameplayRoster, drawRemotePresence } from '../ui/social.js';

export function renderFrame(app, now, dt, fps) {
  const enemyFrame = app.game.session.presentation();
  app.ui.uiHitboxes.length = 0;
  app.effects.networkPresentation = relayNetworkPresentation(app.game.sessionSnapshot);
  drawBackground(app);
  if (!['main', 'map_select', 'coop', 'options'].includes(app.ui.frontEndScreen)) {
    // Background technology stays underneath enemies, including at intersections.
    drawNetworkLinks(app, app.game.sessionSnapshot);
    app.renderer.shapes.flush();
    app.renderer.enemyRenderer.draw(app.viewport.camera, enemyFrame, app.preferences);
    for (const wall of mapWalls(app.game.currentMap)) {
      if (wall === 'left' || wall === 'right') {
        const wallX = wall === 'left' ? app.game.currentMap.bounds.left : app.game.currentMap.bounds.right;
        const a=project(app, wallX,app.game.currentMap.bounds.top),b=project(app, wallX,app.game.currentMap.bounds.bottom);
        app.renderer.shapes.line(a.x,a.y,b.x,b.y,4,COLOR.dimMint);
        app.renderer.shapes.line(a.x,a.y,b.x,b.y,1,COLOR.amber);
      }
    }
    drawTestFieldWorld(app, app.game.sessionSnapshot);
    drawPerimeterIntel(app, app.game.sessionSnapshot,enemyFrame);
    drawProjectiles(app, presentProjectiles(app, app.game.sessionSnapshot.projectiles, dt));
    drawClusterPayloads(app, app.game.sessionSnapshot.attackFields, app.game.sessionSnapshot.runTick);
    drawControlFields(app, app.game.sessionSnapshot);
    drawReworkedCombat(app, app.game.sessionSnapshot);
    drawSelectedBondLinks(app, app.game.sessionSnapshot, enemyFrame);
    app.renderer.shapes.flush();
    app.renderer.gl.enable(app.renderer.gl.BLEND);
    app.renderer.gl.blendFunc(app.renderer.gl.SRC_ALPHA, app.renderer.gl.ONE_MINUS_SRC_ALPHA);
    for (const field of app.game.sessionSnapshot.attackFields) {
      if (field.kind === 'sweep_line') drawSweep(app.renderer.shapes, COLOR, project.bind(null, app), app.viewport.camera.scale, field, app.game.sessionSnapshot.runTick, enemyFrame.alpha);
    }
    drawAttackFlashes(app, dt);
    app.renderer.shapes.flush();
    app.renderer.gl.disable(app.renderer.gl.BLEND);
    drawImpactBursts(app, dt);
    for (const tower of app.game.sessionSnapshot.towers) drawTower(app, tower);
    drawAssembly(app, app.game.sessionSnapshot);
    drawRelayCollapse(app, app.game.sessionSnapshot);
    drawBase(app, app.game.sessionSnapshot);
    if (app.game.currentMap.arena) drawArenaFrame(app, app.game.currentMap);
    else for (const wall of mapWalls(app.game.currentMap)) {
      if (wall === 'bottom') {
        const edge = project(app, 0, app.game.currentMap.bounds.bottom);
        app.renderer.shapes.rect(0, edge.y - 3, app.viewport.logicalWidth, 3, COLOR.dimMint);
        for (let x = 0; x < app.viewport.logicalWidth; x += 24) app.renderer.shapes.rect(x, edge.y - 3, 12, 1, COLOR.amber);
      } else if (wall === 'top') {
        const edge = project(app, 0, app.game.currentMap.bounds.top);
        app.renderer.shapes.rect(0, edge.y, app.viewport.logicalWidth, 3, COLOR.dimMint);
        for (let x = 0; x < app.viewport.logicalWidth; x += 24) app.renderer.shapes.rect(x, edge.y + 2, 12, 1, COLOR.amber);
      }
    }
    drawBuildState(app, app.game.sessionSnapshot);
    drawRemotePresence(app, now);
    drawHud(app, fps, app.game.sessionSnapshot);
  } else {
    app.effects.projectilePresentation.clear();
    app.effects.impactBursts.length = 0;
    app.effects.attackFlashes.length = 0;
    if (app.ui.frontEndScreen === 'main') drawMainMenu(app, app.game.sessionSnapshot);
    else if (app.ui.frontEndScreen === 'map_select') drawMapSelection(app, app.game.sessionSnapshot);
    else if (app.ui.frontEndScreen === 'options') drawOptionsScreen(app);
    else drawCoopMenu(app, app.game.sessionSnapshot);
  }
  if (app.ui.frontEndScreen === 'game' && app.ui.towerMenuMode === 'research') {
    const tower=app.game.sessionSnapshot.towers.find((item)=>item.id===app.ui.selectedTowerId);
    if(tower) drawResearchStation(app, app.game.sessionSnapshot,tower);
  }
  if (app.ui.frontEndScreen === 'escape') {
    app.ui.uiHitboxes.length = 0;
    drawEscapeMenu(app, app.game.sessionSnapshot);
  }
  if (app.ui.frontEndScreen === 'game') {
    const enabled = Object.entries(app.game.sessionSnapshot.dev || {}).filter(([, value]) => value).map(([key]) =>
      ({ infiniteMoney: 'money', infiniteHealth: 'health', paused: 'paused', stopSpawns: 'no spawns' })[key]).filter(Boolean);
    app.renderer.bitmapText.draw(enabled.length ? `dev // ${enabled.join(' / ')} // f2` : 'f2 dev tools', 8, app.viewport.HUD_TOP_HEIGHT + 5, enabled.length ? COLOR.amber : COLOR.dimMint, 1);
    if (app.ui.devToolsOpen) drawDevTools(app, app.game.sessionSnapshot);
    if (app.ui.showStatsPanel) drawStatsPanel(app, app.game.sessionSnapshot);
    drawGameplayRoster(app, app.game.sessionSnapshot);
    drawChat(app, app.game.sessionSnapshot, now);
  }
  drawCursor(app);
  app.renderer.shapes.flush();
  app.renderer.bitmapText.flush();
}
