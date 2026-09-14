import { allowedZoomLevels } from './camera.js';
import { killTelemetry } from './telemetry.js';
import { AUTHORITY_TICK_RATE, PROTOCOL_VERSION } from '../core/protocol.js';

export function showFatal(app, message, kind = 'gpu') {
  app.renderer.errorPanel.hidden = false;
  app.renderer.errorPanel.textContent = `${kind} failure // reload after reporting\n\n${String(message).toLowerCase()}`;
  window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), [`${kind}Error`]: String(message) };
}

export function captureLosslessFramebuffer(app) {
  const source = new Uint8Array(app.viewport.logicalWidth * app.viewport.logicalHeight * 4);
  const upright = new Uint8ClampedArray(source.length);
  app.renderer.gl.readPixels(0, 0, app.viewport.logicalWidth, app.viewport.logicalHeight, app.renderer.gl.RGBA, app.renderer.gl.UNSIGNED_BYTE, source);
  const rowBytes = app.viewport.logicalWidth * 4;
  for (let row = 0; row < app.viewport.logicalHeight; row += 1) {
    const sourceOffset = (app.viewport.logicalHeight - row - 1) * rowBytes;
    upright.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
  }
  const encoder = document.createElement('canvas');
  encoder.width = app.viewport.logicalWidth;
  encoder.height = app.viewport.logicalHeight;
  const context = encoder.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = false;
  context.putImageData(new ImageData(upright, app.viewport.logicalWidth, app.viewport.logicalHeight), 0, 0);
  let capture = document.querySelector('#lossless-capture');
  if (!capture) {
    capture = document.createElement('a');
    capture.id = 'lossless-capture';
    capture.hidden = true;
    capture.setAttribute('aria-hidden', 'true');
    document.body.append(capture);
  }
  capture.href = encoder.toDataURL('image/png');
  capture.dataset.ready = 'true';
}

export function audioDiagnostics(app) {
  const manager = app.audio?.manager;
  if (!manager?.available) return { available: false };
  return {
    available: true,
    ready: Boolean(app.audio.ready),
    contextState: manager.context.state,
    masterVolume: manager.masterVolume,
    sfxVolume: manager.sfxVolume,
    musicVolume: manager.musicVolume,
    loadedSounds: manager.sounds.size,
    defaultSounds: manager.defaultSounds.size,
    bindings: manager.eventBindings.size,
    musicTrack: manager.music?.trackId || null,
    musicPending: Boolean(manager.musicPending),
    forgeReady: Boolean(app.audio.forge?.ready),
    forgeError: app.audio.forge?.error ? String(app.audio.forge.error.message || app.audio.forge.error) : null,
    savedSounds: app.audio.forge?.sounds?.size ?? 0,
    combatLoad: Number(app.audio.presentation?.combatLoad?.toFixed(1) ?? 0),
    combatGain: Number(app.audio.presentation?.combatGain?.toFixed(2) ?? 1)
  };
}

export function syncDiagnostics(app, snapshot = app.game.sessionSnapshot) {
  const towerForms = {};
  for (const tower of snapshot.towers) towerForms[tower.definitionId] = (towerForms[tower.definitionId] || 0) + 1;
  const telemetry = killTelemetry(app, app.game.sessionMode, snapshot);
  const network = app.game.session.networkInfo?.() || { role: 'solo', connected: true };
  const diagnostics = {
    backend: 'webgl2 authoritative packed points',
    gpuError: null,
    contextAntialias: app.renderer.gl.getContextAttributes()?.antialias,
    enemyCapacity: snapshot.swarm.allocatedCapacity,
    activeEnemies: snapshot.swarm.activeEnemies,
    simulationRecords: snapshot.swarm.simulationRecords,
    compressedEnemies: snapshot.swarm.compressedEnemies,
    recordBudget: snapshot.swarm.recordBudget,
    slowedEnemies: snapshot.swarm.slowedEnemies || 0,
    spawnRatePerSecond: snapshot.swarm.spawnRatePerSecond,
    fps: app.timing.fps,
    frameMs: { ...app.timing.frameTiming },
    rings: { drawnPerFrame: app.renderer.shapes.ringsDrawn, culledPerFrame: app.renderer.shapes.ringsCulled, shapeFloatsPerFrame: app.renderer.shapes.lastFlushFloats },
    logicalResolution: `${app.viewport.logicalWidth}x${app.viewport.logicalHeight}`,
    nativeRenderScale: app.viewport.renderScale,
    textureMinFilter: 'nearest',
    textureMagFilter: 'nearest',
    multisampling: false,
    shaderEdgeSmoothing: false,
    camera: { ...app.viewport.camera },
    availableZoomLevels: allowedZoomLevels(app),
    maximumZoom: allowedZoomLevels(app).at(-1),
    mapId: snapshot.mapId,
    mapLabel: snapshot.mapLabel,
    defenseAreaCount: app.game.currentMap.defenseAreas.length,
    runNumber: snapshot.runNumber,
    runTick: snapshot.runTick,
    elapsedSeconds: snapshot.runTick / AUTHORITY_TICK_RATE,
    goldPerSecond: telemetry.goldPerSecond,
    swarmChecksum: snapshot.swarm.checksum,
    shotsFired: snapshot.stats.shotsFired,
    shotsResolved: snapshot.stats.shotsResolved,
    supportTriggers: snapshot.stats.supportTriggers || 0,
    bonusCredits: snapshot.stats.bonusCredits || 0,
    relayLinks: snapshot.towers
      .filter((tower) => tower.relayTargetAreaId)
      .map((tower) => ({ towerId: tower.id, from: tower.areaId, to: tower.relayTargetAreaId })),
    shotInvariant: snapshot.stats.shotsFired === snapshot.stats.shotsResolved
      + snapshot.projectiles.length
      + snapshot.attackFields.filter((field) => field.countsAsShot !== false).length,
    collisionMode: 'swept physical geometry',
    autoSelectPlacedFrame: app.preferences.autoSelectPlacedFrame,
    bulkPlacementDefinitionId: app.ui.bulkPlacementDefinitionId,
    buildCatalogOpen: app.ui.buildCatalogOpen,
    buildCatalogPageId: app.ui.buildCatalogPageId,
    network,
    towerForms,
    audio: audioDiagnostics(app)
  };
  window.__hordeDiagnostics = diagnostics;
  app.renderer.canvas.dataset.gpuBackend = diagnostics.backend;
  app.renderer.canvas.dataset.gpuError = 'none';
  app.renderer.canvas.dataset.contextAntialias = String(diagnostics.contextAntialias);
  app.renderer.canvas.dataset.enemyCapacity = String(diagnostics.enemyCapacity);
  app.renderer.canvas.dataset.fps = String(diagnostics.fps);
  app.renderer.canvas.dataset.logicalResolution = diagnostics.logicalResolution;
  app.renderer.canvas.dataset.cssIntegerScale = String(diagnostics.cssIntegerScale);
  app.renderer.canvas.dataset.textureFilter = 'nearest';
  app.renderer.canvas.dataset.multisampling = 'false';
  app.renderer.canvas.dataset.shaderEdgeSmoothing = 'false';
  app.renderer.canvas.dataset.camera = `${app.viewport.camera.x},${app.viewport.camera.y},${app.viewport.camera.scale}`;
  app.renderer.canvas.dataset.maximumZoom = String(diagnostics.maximumZoom);
  app.renderer.canvas.dataset.mapId = snapshot.mapId;
  app.renderer.canvas.dataset.defenseAreaCount = String(app.game.currentMap.defenseAreas.length);
  app.renderer.canvas.dataset.authority = network.role === 'guest' ? 'p2p-replica' : network.role === 'host' ? 'p2p-host' : 'embedded-host';
  app.renderer.canvas.dataset.networkRole = network.role;
  app.renderer.canvas.dataset.networkConnected = String(network.connected);
  app.renderer.canvas.dataset.networkRoom = network.roomCode || 'none';
  app.renderer.canvas.dataset.protocolVersion = String(PROTOCOL_VERSION);
  app.renderer.canvas.dataset.authorityTick = String(snapshot.tick);
  app.renderer.canvas.dataset.runNumber = String(snapshot.runNumber);
  app.renderer.canvas.dataset.runTick = String(snapshot.runTick);
  app.renderer.canvas.dataset.elapsedSeconds = String(diagnostics.elapsedSeconds);
  app.renderer.canvas.dataset.goldPerSecond = diagnostics.goldPerSecond.toFixed(3);
  app.renderer.canvas.dataset.playerCount = String(snapshot.players.length);
  app.renderer.canvas.dataset.towerCount = String(snapshot.towers.length);
  app.renderer.canvas.dataset.sessionId = snapshot.sessionId;
  app.renderer.canvas.dataset.phase = snapshot.phase;
  app.renderer.canvas.dataset.lives = String(snapshot.base.lives);
  app.renderer.canvas.dataset.kills = String(snapshot.stats.kills);
  app.renderer.canvas.dataset.activeEnemies = String(snapshot.swarm.activeEnemies);
  app.renderer.canvas.dataset.simulationRecords = String(snapshot.swarm.simulationRecords);
  app.renderer.canvas.dataset.compressedEnemies = String(snapshot.swarm.compressedEnemies);
  app.renderer.canvas.dataset.swarmRecordBudget = String(snapshot.swarm.recordBudget);
  app.renderer.canvas.dataset.slowedEnemies = String(snapshot.swarm.slowedEnemies || 0);
  app.renderer.canvas.dataset.spawnRatePerSecond = String(snapshot.swarm.spawnRatePerSecond);
  app.renderer.canvas.dataset.swarmChecksum = snapshot.swarm.checksum;
  app.renderer.canvas.dataset.projectileCount = String(snapshot.projectiles.length);
  app.renderer.canvas.dataset.shotsFired = String(snapshot.stats.shotsFired);
  app.renderer.canvas.dataset.shotsResolved = String(snapshot.stats.shotsResolved);
  app.renderer.canvas.dataset.supportTriggers = String(snapshot.stats.supportTriggers || 0);
  app.renderer.canvas.dataset.bonusCredits = String(snapshot.stats.bonusCredits || 0);
  app.renderer.canvas.dataset.shotInvariant = String(diagnostics.shotInvariant);
  app.renderer.canvas.dataset.collisionMode = diagnostics.collisionMode;
  app.renderer.canvas.dataset.towerForms = JSON.stringify(towerForms);
  app.renderer.canvas.dataset.credits = String(snapshot.teamEconomy?.credits ?? snapshot.prototypeBalance.startingCredits);
  app.renderer.canvas.dataset.autoSelectPlacedFrame = String(app.preferences.autoSelectPlacedFrame);
  app.renderer.canvas.dataset.bulkPlacementDefinitionId = app.ui.bulkPlacementDefinitionId || 'none';
  app.renderer.canvas.dataset.buildCatalogOpen = String(app.ui.buildCatalogOpen);
}
