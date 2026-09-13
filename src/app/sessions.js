import { clampCameraToMap, fitCanvas } from './camera.js';
import { loadTestPreferences } from './preferences.js';
import { resetWorldPresentation } from './presentation.js';
import { setStatus } from './ui-state.js';
import { EmbeddedAuthority, EmbeddedClient } from '../core/embedded-session.js';
import { loadSoloRun, saveSoloRun } from '../core/persistence.js';
import { COMMAND } from '../core/protocol.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from '../core/session-config.js';
import { getMapDefinition } from '../core/world-config.js';

// Maps are resolved from authoritative state only: seed and the per-run rift option.

export function resolveMap(mapId, state) {
  return getMapDefinition(mapId, state?.seed ?? 0, { randomRifts: Boolean(state?.randomRifts) });
}

export function switchGameBundle(app, bundle) {
  const previous = app.game.sessions.get('game');
  if (previous && !previous.networkRole && !app.game.soloGameBundle) app.game.soloGameBundle = previous;
  app.game.sessions.set('game', bundle);
  app.viewport.cameraByMode.delete('game');
  activateSession(app, 'game');
}

export function createSessionBundle(app, mode) {
  const config = mode === 'test' ? TEST_FIELD_SESSION_CONFIG : PROTOTYPE_SESSION_CONFIG;
  const bundleAuthority = new EmbeddedAuthority(mode === 'game' ? { ...config, seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0] } : config);
  const bundleSession = new EmbeddedClient(bundleAuthority, {
    clientId: mode === 'test' ? 'client_test_1' : 'client_local_1',
    label: 'host'
  });
  bundleSession.connect();
  bundleSession.advance(20);
  const bundle = { mode, authority: bundleAuthority, session: bundleSession, map: getMapDefinition(config.mapId) };
  app.game.sessions.set(mode, bundle);
  if (mode === 'game' && !app.game.soloGameBundle) app.game.soloGameBundle = bundle;
  if (mode === 'game') {
    app.game.gameRestorePending = true;
    void restoreGameBundle(app, bundle).finally(() => {
      app.game.gameRestorePending = false;
    });
  }
  if (mode === 'test') {
    const saved = loadTestPreferences();
    app.ui.testKeepSwarm = Boolean(saved.keepSwarm);
    bundleSession.send(COMMAND.TEST_CONFIG_SET, {
      spawnRatePerSecond: saved.spawnRatePerSecond,
      enemyHp: saved.enemyHp,
      invincibleBase: saved.invincibleBase,
      timeScale: saved.timeScale,
      activeSpawnSourceIds: saved.activeSpawnSourceIds,
      spawnSourceOverrides: saved.spawnSourceOverrides
    });
    bundleSession.send(COMMAND.TOWER_PLACE, { definitionId: 'frame', x: 0, y: 238 });
    bundleSession.advance(20);
  }
  return bundle;
}

export async function restoreGameBundle(app, bundle) {
  try {
    const saved = await loadSoloRun(bundle.authority.state.sessionId);
    if (!saved?.correction || bundle.authority.state.runTick > 30 || bundle.authority.state.towers.length > 0) return;
    bundle.authority.applyCorrectionSnapshot(saved.correction);
    bundle.session.sequence = bundle.authority.lastSequenceByClient.get(bundle.session.clientId) || bundle.session.sequence;
    bundle.session.latestSnapshot = bundle.authority.snapshot();
    bundle.map = resolveMap(bundle.authority.state.mapId, bundle.authority.state);
    if (app.game.sessionMode === 'game' && app.game.session === bundle.session) {
      app.game.sessionSnapshot = bundle.session.latestSnapshot;
      resetWorldPresentation(app);
      app.game.currentMap = bundle.map;
      app.ui.selectedRunMapId = app.game.currentMap.id;
      app.viewport.cameraByMode.delete('game');
      Object.assign(app.viewport.camera, app.game.currentMap.camera);
      clampCameraToMap(app);
      setStatus(app, 'solo autosave restored');
    }
  } catch (error) {
    window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), saveError: String(error) };
    if (app.game.sessionMode === 'game') setStatus(app, 'autosave restore unavailable');
  }
}

export async function saveGameBundle(app) {
  const activeBundle = app.game.sessions.get('game');
  const bundle = activeBundle?.networkRole ? app.game.soloGameBundle : activeBundle;
  if (!bundle || app.game.gameRestorePending) return;
  if (app.game.saveInFlight) {
    app.game.saveQueued = true;
    return;
  }
  app.game.saveInFlight = true;
  try {
    await saveSoloRun(
      bundle.authority.state.sessionId,
      bundle.authority.correctionSnapshot(),
      bundle.authority.replayLog()
    );
  } catch (error) {
    window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), saveError: String(error) };
    if (app.game.sessionMode === 'game') setStatus(app, 'autosave unavailable');
  } finally {
    app.game.saveInFlight = false;
    if (app.game.saveQueued) {
      app.game.saveQueued = false;
      void saveGameBundle(app);
    }
  }
}

export function activateSession(app, mode) {
  app.viewport.cameraByMode.set(app.game.sessionMode, { ...app.viewport.camera, mapId: app.game.currentMap.id });
  const bundle = app.game.sessions.get(mode) || createSessionBundle(app, mode);
  app.game.sessionMode = mode;
  app.game.authority = bundle.authority;
  app.game.session = bundle.session;
  app.game.sessionSnapshot = app.game.session.snapshot();
  app.game.currentMap = resolveMap(app.game.sessionSnapshot.mapId, app.game.sessionSnapshot);
  resetWorldPresentation(app);
  app.ui.devToolsOpen = false;
  bundle.map = app.game.currentMap;
  const savedCamera = app.viewport.cameraByMode.get(mode);
  Object.assign(app.viewport.camera, savedCamera?.mapId === app.game.currentMap.id ? savedCamera : app.game.currentMap.camera);
  app.ui.selectedTowerId = mode === 'test' ? app.game.sessionSnapshot.towers[0]?.id || null : null;
  app.ui.towerMenuMode = null;
  app.ui.placementArmed = false;
  app.ui.bulkPlacementDefinitionId = null;
  app.ui.buildCatalogOpen = false;
  app.effects.projectilePresentation.clear();
  app.effects.impactBursts.length = 0;
  app.effects.attackFlashes.length = 0;
  app.renderer.enemyRenderer.lastTick = -1;
  app.renderer.enemyRenderer.lastState = null;
  fitCanvas(app);
  clampCameraToMap(app);
  setStatus(app, mode === 'test' ? 'test field // local tools' : 'game field // still live');
}

export function adoptActiveMap(app, mapId) {
  resetWorldPresentation(app);
  const map = resolveMap(mapId, app.game.sessionSnapshot);
  app.game.currentMap = map;
  const bundle = app.game.sessions.get(app.game.sessionMode);
  if (bundle) bundle.map = map;
  app.viewport.cameraByMode.delete(app.game.sessionMode);
  Object.assign(app.viewport.camera, map.camera);
  clampCameraToMap(app);
  if (app.game.sessionMode === 'game') app.ui.selectedRunMapId = map.id;
}
