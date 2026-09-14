import { allowedZoomLevels, canvasPoint, clampCameraToMap, unproject } from './camera.js';
import { beginHostingCoop, beginJoiningCoop, cancelMultiplayer, openJoinCoop, updateMultiplayerStatus } from './multiplayer.js';
import { adjustRunPace, closeEscapeOptions, closeMainOptions, openMainOptions, setVolume, closeMapSelection, deploySelectedMap, enterTestField, openCoopMapSelection, openEscapeMenu, resumeSession, selectRunMap, startOrContinueGame, toggleAutoSelectPlacedFrame, toggleHostilePalette, toggleRandomRifts } from './navigation.js';
import { savePlayerName } from './preferences.js';
import { catalogDefinition, weaponView } from './queries.js';
import { openResearchStation, purchaseStationItem, stationItems } from './research-actions.js';
import { activateSession } from './sessions.js';
import { playUiClick } from './sound-presentation.js';
import { setTestConfig } from './test-field.js';
import { armFramePlacement, clearSelectedStrikePoint, closeBuildCatalog, cycleSelectedTargeting, evolveSelectedTower, handleWorldClick, openBuildCatalog, openControlGeometryMenu, openRelayTargetMenu, openStrikeTargetMenu, openUpgradeMenu, resetSelectedControlGeometry, selectBulkPlacementDefinition, sellSelectedTower, sendSelectedControlGeometry, switchTestTowerForm } from './tower-actions.js';
import { cancelPointerGesture, hitboxAt, setStatus } from './ui-state.js';
import { isRelayForm } from '../core/network-descendants.js';
import { COMMAND } from '../core/protocol.js';
import { playableMaps } from '../core/world-config.js';
import { BUILD_CATALOG_PAGES, BUILD_CATALOG_PAGE_IDS } from '../ui/catalog-data.js';

export function sliderRateAt(screenX, hitbox) {
  const fraction = Math.max(0, Math.min(1, (screenX - hitbox.x) / hitbox.width));
  return Math.min(100000, Math.round(Math.pow(10, fraction * 5) - 1));
}

export function handleUiDrag(app, point, final = false) {
  if (!app.ui.uiDrag) return;
  app.ui.uiDrag.distance += Math.hypot(point.x - app.ui.uiDrag.last.x, point.y - app.ui.uiDrag.last.y);
  app.ui.uiDrag.last = { ...point };
  if (app.ui.uiDrag.kind === 'spawn-rate') {
    setTestConfig(app, { spawnRatePerSecond: sliderRateAt(point.x, app.ui.uiDrag.hitbox) });
  } else if (app.ui.uiDrag.kind === 'spawn-point') {
    const world = unproject(app, point.x, point.y);
    app.ui.uiDrag.overrides[app.ui.uiDrag.sourceId] = { x: world.x, y: world.y };
    setTestConfig(app, { spawnSourceOverrides: app.ui.uiDrag.overrides });
    if (final && app.ui.uiDrag.distance <= 2) {
      const active = new Set(app.game.sessionSnapshot.test.activeSpawnSourceIds || []);
      if (active.has(app.ui.uiDrag.sourceId)) active.delete(app.ui.uiDrag.sourceId);
      else active.add(app.ui.uiDrag.sourceId);
      setTestConfig(app, { activeSpawnSourceIds: [...active] });
    }
  } else if (app.ui.uiDrag.kind === 'volume') {
    const { sliderX, sliderWidth, channel } = app.ui.uiDrag;
    setVolume(app, channel, (point.x - sliderX) / Math.max(1, sliderWidth - 1));
  } else if (app.ui.uiDrag.kind === 'tower') {
    if (final && app.ui.uiDrag.distance <= 2) {
      app.ui.selectedTowerId = app.ui.uiDrag.towerId;
      setStatus(app, 'test tower selected // drag to move');
    } else {
      const world = unproject(app, point.x, point.y);
      app.game.session.send(COMMAND.TEST_TOWER_MOVE, { towerId: app.ui.uiDrag.towerId, x: world.x, y: world.y });
    }
  }
}

export function installInput(app) {
  app.renderer.canvas.addEventListener('pointerdown', (event) => {
    app.audio.manager?.unlock();
    if (event.button !== 0 || !event.isPrimary || app.ui.partLabOpen) return;
    app.ui.pointer = canvasPoint(app, event);
    const hitbox = hitboxAt(app, app.ui.pointer);
    if (hitbox) {
      event.preventDefault();
      if (hitbox.action) {
        playUiClick(app);
        hitbox.action();
      }
      if (hitbox.drag) {
        app.ui.uiDrag = {
          ...hitbox.drag,
          hitbox,
          last: { ...app.ui.pointer },
          distance: 0,
          overrides: { ...(app.game.sessionSnapshot.test?.spawnSourceOverrides || {}) }
        };
        handleUiDrag(app, app.ui.pointer);
        app.renderer.canvas.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (app.ui.buildCatalogOpen || app.ui.devToolsOpen) return;
    if (app.ui.frontEndScreen !== 'game' || app.game.sessionSnapshot.phase === 'defeated' || app.ui.towerMenuMode === 'research') return;
    if (app.ui.towerMenuMode === 'control' && app.ui.selectedTowerId) {
      const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
      const definition = weaponView(app.game.sessionSnapshot, tower);
      if (tower && definition?.control?.input === 'line') {
        const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
        app.ui.controlDrag = { towerId: tower.id, start: world, current: world };
        app.renderer.canvas.setPointerCapture(event.pointerId);
        setStatus(app, 'drag the control line');
        return;
      }
    }
    app.ui.dragging = true;
    app.ui.pointerDown = { ...app.ui.pointer };
    app.ui.dragDistance = 0;
    app.renderer.canvas.setPointerCapture(event.pointerId);
  });

  app.renderer.canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary) return;
    const previous = app.ui.pointer;
    app.ui.pointer = canvasPoint(app, event);
    app.ui.lastPointerMotionAt = performance.now();
    if (app.ui.uiDrag) {
      handleUiDrag(app, app.ui.pointer);
      return;
    }
    if (app.ui.controlDrag) {
      app.ui.controlDrag.current = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
      return;
    }
    if (!app.ui.dragging) return;
    const next = app.ui.pointer;
    app.ui.dragDistance += Math.hypot(next.x - previous.x, next.y - previous.y);
    if (app.ui.dragDistance <= 2) return;
    app.viewport.camera.x -= (next.x - previous.x) * app.viewport.camera.scale;
    app.viewport.camera.y -= (next.y - previous.y) * app.viewport.camera.scale;
    clampCameraToMap(app);
  });

  app.renderer.canvas.addEventListener('pointerup', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (app.ui.uiDrag) {
      app.ui.pointer = canvasPoint(app, event);
      handleUiDrag(app, app.ui.pointer, true);
      app.ui.uiDrag = null;
      if (app.renderer.canvas.hasPointerCapture(event.pointerId)) app.renderer.canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (app.ui.controlDrag) {
      app.ui.pointer = canvasPoint(app, event);
      app.ui.controlDrag.current = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
      const drag = app.ui.controlDrag;
      app.ui.controlDrag = null;
      if (app.renderer.canvas.hasPointerCapture(event.pointerId)) app.renderer.canvas.releasePointerCapture(event.pointerId);
      sendSelectedControlGeometry(app, {
        kind: 'line',
        x1: drag.start.x,
        y1: drag.start.y,
        x2: drag.current.x,
        y2: drag.current.y
      });
      return;
    }
    if (!app.ui.dragging) return;
    app.ui.pointer = canvasPoint(app, event);
    const clicked = app.ui.dragDistance <= 2 && app.ui.pointerDown
      && Math.hypot(app.ui.pointer.x - app.ui.pointerDown.x, app.ui.pointer.y - app.ui.pointerDown.y) <= 2;
    cancelPointerGesture(app);
    if (app.renderer.canvas.hasPointerCapture(event.pointerId)) app.renderer.canvas.releasePointerCapture(event.pointerId);
    if (clicked && app.ui.pointer.y > app.viewport.HUD_TOP_HEIGHT && app.ui.pointer.y < app.viewport.hudBottomY) {
      if (app.social.pingArmed && app.game.session.networkRole) {
        const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
        app.game.session.sendPing?.(world.x, world.y);
        app.social.pingArmed = false;
        setStatus(app, 'ping sent');
      } else handleWorldClick(app, app.ui.pointer);
    }
  });

  app.renderer.canvas.addEventListener('pointercancel', cancelPointerGesture.bind(null, app));

  app.renderer.canvas.addEventListener('lostpointercapture', cancelPointerGesture.bind(null, app));

  addEventListener('blur', cancelPointerGesture.bind(null, app));

  app.renderer.canvas.addEventListener('contextmenu', (event) => {
    cancelPointerGesture(app);
    event.preventDefault();
    if (app.ui.frontEndScreen !== 'game') return;
    app.ui.placementArmed = false;
    app.ui.bulkPlacementDefinitionId = null;
    app.ui.buildCatalogOpen = false;
    app.ui.selectedTowerId = null;
    app.ui.towerMenuMode = null;
    app.ui.controlDrag = null;
    setStatus(app, 'cancelled');
  });

  app.renderer.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (app.ui.frontEndScreen !== 'game' || app.ui.devToolsOpen) return;
    const levels = allowedZoomLevels(app);
    const current = levels.reduce((closestIndex, scale, index) => (
      Math.abs(scale - app.viewport.camera.scale) < Math.abs(levels[closestIndex] - app.viewport.camera.scale) ? index : closestIndex
    ), 0);
    const nextIndex = Math.max(0, Math.min(levels.length - 1, current + Math.sign(event.deltaY)));
    app.viewport.camera.scale = levels[nextIndex];
    clampCameraToMap(app);
  }, { passive: false });

  addEventListener('keydown', (event) => {
    if (app.ui.partLabOpen) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    app.audio.manager?.unlock();
    const key = event.key.toLowerCase();
    if (app.multiplayer.editingName) {
      if (event.key === 'Escape') app.multiplayer.editingName = false;
      else if (event.key === 'Enter') {
        savePlayerName(app, app.multiplayer.playerName);
        app.multiplayer.editingName = false;
      } else if (event.key === 'Backspace') app.multiplayer.playerName = app.multiplayer.playerName.slice(0, -1);
      else if (/^[a-z0-9 _-]$/i.test(event.key) && app.multiplayer.playerName.length < 20) app.multiplayer.playerName += event.key.toLowerCase();
      event.preventDefault();
      return;
    }
    if (app.social.chatOpen) {
      if (event.key === 'Escape') app.social.chatOpen = false;
      else if (event.key === 'Enter') {
        if (app.social.chatInput.trim()) app.game.session.sendChat?.(app.social.chatInput);
        app.social.chatInput = '';
        app.social.chatOpen = false;
      } else if (event.key === 'Backspace') app.social.chatInput = app.social.chatInput.slice(0, -1);
      else if (event.key.length === 1 && app.social.chatInput.length < 160) app.social.chatInput += event.key;
      event.preventDefault();
      return;
    }
    if (event.key === 'F3' && ['game', 'escape'].includes(app.ui.frontEndScreen) && app.openPartLab) {
      event.preventDefault(); cancelPointerGesture(app);
      if (app.partLab) app.partLab.toggle(); else void app.openPartLab().then((lab) => lab.open());
      return;
    }
    if (event.key === 'F2' && app.ui.frontEndScreen === 'game') {
      event.preventDefault(); cancelPointerGesture(app); app.ui.devToolsOpen = !app.ui.devToolsOpen; return;
    }
    if (app.ui.devToolsOpen) {
      if (event.key === 'Escape') { event.preventDefault(); app.ui.devToolsOpen = false; }
      return;
    }
    if (app.ui.frontEndScreen === 'game' && app.game.session.networkRole && event.key === 'Tab' && app.ui.towerMenuMode !== 'research' && !app.ui.buildCatalogOpen) {
      event.preventDefault();
      app.social.rosterExpanded = true;
      return;
    }
    if (event.key === '?' && (app.ui.frontEndScreen === 'game' || app.ui.frontEndScreen === 'escape')) {
      cancelPointerGesture(app);
      app.ui.frontEndScreen = 'escape';
      app.ui.escapeMenuPage = app.ui.escapeMenuPage === 'help' ? 'main' : 'help';
      return;
    }
    if (event.key === 'Escape') {
      cancelPointerGesture(app);
      if (app.ui.frontEndScreen === 'game' && app.ui.towerMenuMode === 'research') { app.ui.towerMenuMode = 'actions'; return; }
      if (app.ui.frontEndScreen === 'game' && app.ui.towerMenuMode === 'control') {
        app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
        app.ui.controlDrag = null;
        setStatus(app, 'control edit cancelled');
      } else if (app.ui.frontEndScreen === 'game' && app.ui.buildCatalogOpen) closeBuildCatalog(app);
      else if (app.ui.frontEndScreen === 'game') openEscapeMenu(app);
      else if (app.ui.frontEndScreen === 'escape' && app.ui.escapeMenuPage !== 'main') closeEscapeOptions(app);
      else if (app.ui.frontEndScreen === 'escape') resumeSession(app);
      else if (app.ui.frontEndScreen === 'map_select') closeMapSelection(app);
      else if (app.ui.frontEndScreen === 'options') closeMainOptions(app);
      else if (app.ui.frontEndScreen === 'coop') cancelMultiplayer(app, true);
      return;
    }
    if (app.ui.frontEndScreen === 'main') {
      if (event.key === 'Enter') startOrContinueGame(app);
      else if (key === 't') enterTestField(app);
      else if (key === 'o') openMainOptions(app);
      else if (key === 'h') {
        if (app.game.sessions.get('game')?.networkRole) app.ui.frontEndScreen = 'coop';
        else beginHostingCoop(app);
      } else if (key === 'j') {
        if (app.game.sessions.get('game')?.networkRole) app.ui.frontEndScreen = 'coop';
        else openJoinCoop(app);
      }
      return;
    }
    if (app.ui.frontEndScreen === 'coop') {
      if (app.multiplayer.phase === 'join_entry') {
        if (/^[a-z0-9]$/i.test(event.key) && app.multiplayer.codeInput.length < 6) {
          app.multiplayer.codeInput += event.key.toUpperCase();
          updateMultiplayerStatus(app, 'join_entry', `${app.multiplayer.codeInput.length}/6 code characters`);
        } else if (event.key === 'Backspace') {
          app.multiplayer.codeInput = app.multiplayer.codeInput.slice(0, -1);
          updateMultiplayerStatus(app, 'join_entry', 'type the six-character room code');
        } else if (event.key === 'Enter') beginJoiningCoop(app);
      } else if (app.multiplayer.phase === 'host_lobby' && event.key === 'Enter') {
        openCoopMapSelection(app);
      } else if (app.multiplayer.phase === 'guest_lobby' && event.key === 'Enter') {
        setStatus(app, 'only the host can deploy');
      }
      return;
    }
    if (app.ui.frontEndScreen === 'map_select') {
      if (/^[1-9]$/.test(event.key)) {
        const map = playableMaps()[Number(event.key) - 1];
        if (map) selectRunMap(app, map.id);
      } else if (event.key === 'Enter') {
        deploySelectedMap(app);
      } else if (event.key === '[' || event.key === '-') {
        adjustRunPace(app, -1);
      } else if (event.key === ']' || event.key === '=' || event.key === '+') {
        adjustRunPace(app, 1);
      } else if (event.key.toLowerCase() === 'x') {
        toggleRandomRifts(app);
      }
      return;
    }
    if (app.ui.frontEndScreen === 'escape') {
      if (app.ui.escapeMenuPage === 'options' && (event.key === '1' || event.key === 'Enter')) {
        event.preventDefault();
        toggleAutoSelectPlacedFrame(app);
      } else if (app.ui.escapeMenuPage === 'options' && event.key === '2') {
        event.preventDefault();
        toggleHostilePalette(app);
      }
      return;
    }
    if (app.ui.towerMenuMode === 'research') {
      const tower=app.game.sessionSnapshot.towers.find((item)=>item.id===app.ui.selectedTowerId);
      if (!tower) { app.ui.towerMenuMode=null; return; }
      const items=stationItems(app.game.sessionSnapshot,tower);
      const perPage=Math.min(288,app.viewport.logicalHeight-16)<240?1:3;
      const visible=items.slice(app.ui.researchPage*perPage,(app.ui.researchPage+1)*perPage);
      if(event.key==='Tab') { event.preventDefault(); app.ui.researchPage=(app.ui.researchPage+1)%Math.max(1,Math.ceil(items.length/perPage)); app.ui.researchDetailPage=0; }
      else if(['1','2','3'].includes(event.key)) { app.ui.researchSelection=visible[Number(event.key)-1]?.id ?? app.ui.researchSelection; app.ui.researchDetailPage=0; }
      else if(event.key==='Enter') { event.preventDefault(); const item=items.find((item)=>item.id===app.ui.researchSelection); if(item) purchaseStationItem(app, tower,item); }
      return;
    }
    if (app.ui.buildCatalogOpen) {
      const page = BUILD_CATALOG_PAGES[app.ui.buildCatalogPageId];
      const entry = page.rows.flat().find((candidate) => candidate.key === key);
      if (event.key === 'Tab') {
        event.preventDefault();
        const currentPage = BUILD_CATALOG_PAGE_IDS.indexOf(app.ui.buildCatalogPageId);
        app.ui.buildCatalogPageId = BUILD_CATALOG_PAGE_IDS[(currentPage + 1) % BUILD_CATALOG_PAGE_IDS.length];
        setStatus(app, `${BUILD_CATALOG_PAGES[app.ui.buildCatalogPageId].label} catalog`);
      } else if ((app.game.sessionMode === 'game' && key === 'b') || (app.game.sessionMode === 'test' && key === 'u')) closeBuildCatalog(app);
      else if (entry) selectBulkPlacementDefinition(app, entry.definitionId);
      return;
    }
    if (app.ui.selectedTowerId && app.ui.towerMenuMode && (app.game.sessionMode === 'game' || ['arsenal','reactor'].includes(app.game.sessionSnapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId)?.definitionId) || isRelayForm(app.game.sessionSnapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId)?.definitionId) || ['relay', 'strike', 'control'].includes(app.ui.towerMenuMode))) {
      const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
      const towerDefinition = catalogDefinition(app.game.sessionSnapshot, tower?.definitionId);
      if (app.ui.towerMenuMode === 'actions' && event.key === '1') {
        event.preventDefault();
        if (['arsenal','reactor'].includes(tower?.definitionId)) openResearchStation(app, tower);
        else if (towerDefinition?.evolutionChoices?.length) openUpgradeMenu(app, app.game.sessionSnapshot, tower);
        else if (isRelayForm(tower?.definitionId)) openRelayTargetMenu(app, app.game.sessionSnapshot, tower);
        return;
      }
      if (app.ui.towerMenuMode === 'actions' && event.key === '2') {
        event.preventDefault();
        sellSelectedTower(app);
        return;
      }
      if (app.ui.towerMenuMode === 'actions' && event.key === '3') {
        event.preventDefault();
        if (isRelayForm(tower?.definitionId)) openRelayTargetMenu(app, app.game.sessionSnapshot, tower);
        else if (towerDefinition?.control?.input && towerDefinition.control.input !== 'none') openControlGeometryMenu(app, app.game.sessionSnapshot, tower);
        else openStrikeTargetMenu(app, app.game.sessionSnapshot, tower);
        return;
      }
      if (app.ui.towerMenuMode === 'actions' && event.key === '0') {
        event.preventDefault();
        if (towerDefinition?.control?.input && towerDefinition.control.input !== 'none') resetSelectedControlGeometry(app);
        else clearSelectedStrikePoint(app);
        return;
      }
      if (app.ui.towerMenuMode === 'upgrades' && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        const definition = catalogDefinition(app.game.sessionSnapshot, tower?.definitionId);
        const definitionId = definition?.evolutionChoices?.[Number(event.key) - 1];
        if (definitionId) evolveSelectedTower(app, definitionId);
        else setStatus(app, 'that branch is not designed yet');
        return;
      }
      if (app.ui.towerMenuMode === 'relay' && event.key === '1') {
        event.preventDefault();
        setStatus(app, 'click a highlighted nebula');
        return;
      }
      if (app.ui.towerMenuMode === 'relay' && event.key === '2') {
        event.preventDefault();
        app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
        setStatus(app, 'relay selection cancelled');
        return;
      }
      if (app.ui.towerMenuMode === 'strike' && event.key === '0') {
        event.preventDefault();
        clearSelectedStrikePoint(app);
        return;
      }
      if (app.ui.towerMenuMode === 'strike' && event.key === '2') {
        event.preventDefault();
        app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
        setStatus(app, 'strike selection cancelled');
        return;
      }
      if (app.ui.towerMenuMode === 'control' && event.key === '0') {
        event.preventDefault();
        resetSelectedControlGeometry(app);
        return;
      }
      if (app.ui.towerMenuMode === 'control' && event.key === '2') {
        event.preventDefault();
        app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
        app.ui.controlDrag = null;
        setStatus(app, 'control edit cancelled');
        return;
      }
    }
    if (app.game.session.networkRole && event.key === 'Enter' && app.ui.frontEndScreen === 'game') {
      event.preventDefault();
      app.social.chatOpen = true;
    } else if (app.game.session.networkRole && key === 'p' && app.ui.frontEndScreen === 'game') {
      const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
      if (app.ui.pointer.y > app.viewport.HUD_TOP_HEIGHT && app.ui.pointer.y < app.viewport.hudBottomY) app.game.session.sendPing?.(world.x, world.y);
    } else if (key === 't') {
      if (app.game.sessionMode === 'test') activateSession(app, 'game');
      else enterTestField(app);
    } else if (key === 'k') {
      app.ui.showKps = !app.ui.showKps;
      setStatus(app, `kps ${app.ui.showKps ? 'shown' : 'hidden'}`);
    } else if (key === 'g') {
      app.ui.showAllRanges = !app.ui.showAllRanges;
      setStatus(app, `all ranges ${app.ui.showAllRanges ? 'shown' : 'hidden'}`);
    } else if (key === 'i' && app.ui.frontEndScreen === 'game') {
      app.ui.showStatsPanel = !app.ui.showStatsPanel;
      app.ui.statsPage = 0;
      setStatus(app, `modifier summary ${app.ui.showStatsPanel ? 'shown' : 'hidden'}`);
    } else if (app.game.sessionMode === 'test' && ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key)) {
      switchTestTowerForm(app, {
        0: 'backwash',
        1: 'frame',
        2: 'assault',
        3: 'tether',
        4: 'network',
        5: 'barrage',
        6: 'rocket',
        7: 'laser',
        8: 'anchor',
        9: 'knot'
      }[event.key]);
    } else if (app.game.sessionMode === 'test' && ['o', 'f', 'r'].includes(key)) {
      switchTestTowerForm(app, { o: 'overclock', f: 'forge', r: 'relay' }[key]);
    } else if (app.game.sessionMode === 'test' && event.code === 'Space') {
      event.preventDefault();
      setTestConfig(app, { paused: !app.game.sessionSnapshot.test.paused });
    } else if (app.game.sessionMode === 'test' && event.key === '.') {
      app.game.session.send(COMMAND.TEST_STEP);
    } else if (app.game.sessionMode === 'test' && key === 'c') {
      app.game.session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
    } else if (app.game.sessionMode === 'test' && key === 'b') {
      app.ui.placementArmed = !app.ui.placementArmed;
      setStatus(app, app.ui.placementArmed ? 'place support frame // 8 max' : 'support placement off');
    } else if (app.game.sessionMode === 'test' && key === 'u') {
      openBuildCatalog(app, 'assault');
    } else if (app.game.sessionMode === 'test' && key === 'n') {
      openBuildCatalog(app, 'network');
    } else if (app.game.sessionMode === 'game' && key === 'b') {
      openBuildCatalog(app, 'core');
    } else if (event.key === '1') {
      armFramePlacement(app);
    } else if (app.game.sessionMode === 'test' && key === 'x' && app.ui.selectedTowerId) {
      app.game.session.send(COMMAND.TOWER_SELL, { towerId: app.ui.selectedTowerId });
    } else if ((key === 'q' || key === 'e') && app.ui.selectedTowerId) {
      cycleSelectedTargeting(app, key === 'q' ? -1 : 1);
    } else if (key === 'a' && app.ui.selectedTowerId) {
      const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === app.ui.selectedTowerId);
      const definition = weaponView(app.game.sessionSnapshot, tower);
      if (definition?.control?.input && definition.control.input !== 'none') openControlGeometryMenu(app, app.game.sessionSnapshot, tower);
      else openStrikeTargetMenu(app, app.game.sessionSnapshot, tower);
    } else if (key === 'r' && app.game.sessionSnapshot.phase === 'defeated' && !app.game.session.networkRole) {
      app.game.session.send(COMMAND.SESSION_RESTART);
    }
  });

  addEventListener('keyup', (event) => {
    if (event.key === 'Tab') app.social.rosterExpanded = false;
  });

  addEventListener('paste', (event) => {
    if (app.ui.frontEndScreen !== 'coop' || app.multiplayer.phase !== 'join_entry') return;
    const pasted = String(event.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    app.multiplayer.codeInput = pasted;
    updateMultiplayerStatus(app, 'join_entry', pasted.length === 6 ? 'code ready // press enter' : `${pasted.length}/6 code characters`);
  });
}
