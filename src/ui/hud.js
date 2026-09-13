import { viewport } from '../app/camera.js';
import { enterTestField, openEscapeMenu, openMapSelection, returnToMainMenu } from '../app/navigation.js';
import { saveTestPreferences } from '../app/preferences.js';
import { catalogDefinition, realSecondsUntil, surgeStatus, threatSecondsOf, weaponView } from '../app/queries.js';
import { activateSession } from '../app/sessions.js';
import { formatRunTimer, killTelemetry } from '../app/telemetry.js';
import { setTestConfig } from '../app/test-field.js';
import { armFramePlacement, closeBuildCatalog, cycleSelectedTargeting, openBuildCatalog, openControlGeometryMenu, switchTestTowerForm } from '../app/tower-actions.js';
import { clearTransientUi, registerHitbox, setStatus } from '../app/ui-state.js';
import { compactMetric } from '../core/format.js';
import { DEFAULT_PACE } from '../core/progression.js';
import { AUTHORITY_TICK_RATE, COMMAND } from '../core/protocol.js';
import { drawMapThumbnail } from '../render/map-thumbnail.js';
import { drawBaseSprite } from '../render/world-sprites.js';
import { drawBuildCatalog } from './build-catalog.js';
import { COLOR } from './palette.js';
import { defeatLayout } from './panel-layout.js';
import { fitPixelTelemetry, pixelHudLayout } from './pixel-layout.js';
import { clippedUiText, drawButton, drawMenuButton, drawTechPanel } from './widgets.js';

export function drawTopHud(app, fps, snapshot, telemetry) {
  if (app.game.sessionMode === 'game') return drawGameTopHud(app, fps, snapshot, telemetry);
  const economy = snapshot.teamEconomy || { credits: snapshot.prototypeBalance.startingCredits };
  app.renderer.shapes.rect(0, 0, app.viewport.logicalWidth, app.viewport.HUD_TOP_HEIGHT, COLOR.black);
  app.renderer.shapes.rect(0, app.viewport.HUD_TOP_HEIGHT - 1, app.viewport.logicalWidth, 1, COLOR.dimMint);
  app.renderer.shapes.rect(0, app.viewport.HUD_TOP_HEIGHT - 1, Math.min(132, app.viewport.logicalWidth), 1, app.game.sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  app.renderer.shapes.rect(4, 4, 2, 14, app.game.sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  app.renderer.shapes.rect(app.viewport.logicalWidth - 6, 4, 2, 14, COLOR.red);
  app.renderer.bitmapText.draw('framebound', 11, 5, COLOR.mint, 1);
  app.renderer.bitmapText.draw(app.game.sessionMode === 'test' ? '//test' : '//horde', 75, 5, app.game.sessionMode === 'test' ? COLOR.amber : COLOR.red, 1);
  app.renderer.bitmapText.draw(`lives ${String(snapshot.base.lives).padStart(3, '0')}`, 130, 5, COLOR.ink, 1);
  app.renderer.bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(economy.credits)}`, 208, 5, COLOR.amber, 1);
  app.renderer.bitmapText.draw(`horde ${compactMetric(snapshot.swarm.activeEnemies)}`, 322, 5, COLOR.red, 1);
  const fpsX = app.viewport.logicalWidth - 54;
  const timerLabel = `time ${formatRunTimer(snapshot.runTick)}`;
  const timerX = fpsX - timerLabel.length * 6 - 12;
  const spawnLabel = app.viewport.logicalWidth >= 720
    ? `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s x${snapshot.swarm.activeSpawnPoints}`
    : `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s`;
  if (416 + spawnLabel.length * 6 < timerX - 6) app.renderer.bitmapText.draw(spawnLabel, 416, 5, COLOR.ink, 1);
  let telemetryX = 532;
  const goldLabel = `gold ${compactMetric(telemetry.goldPerSecond)}/s`;
  if (telemetryX + goldLabel.length * 6 < timerX - 6) {
    app.renderer.bitmapText.draw(goldLabel, telemetryX, 5, COLOR.amber, 1);
    telemetryX += goldLabel.length * 6 + 8;
  }
  if (app.game.session.networkRole) {
    const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
    const networkLabel = `p2p ${connected}/4`;
    if (telemetryX + networkLabel.length * 6 < timerX - 6) {
      app.renderer.bitmapText.draw(networkLabel, telemetryX, 5, app.game.session.networkRole === 'host' ? COLOR.green : COLOR.cyan, 1);
      telemetryX += networkLabel.length * 6 + 8;
    }
  }
  const kpsLabel = `kps ${compactMetric(telemetry.oneSecond)}`;
  if (app.ui.showKps && telemetryX + kpsLabel.length * 6 < timerX - 6) app.renderer.bitmapText.draw(kpsLabel, telemetryX, 5, COLOR.mint, 1);
  app.renderer.bitmapText.draw(timerLabel, timerX, 5, COLOR.amber, 1);
  app.renderer.bitmapText.draw(`fps ${String(fps).padStart(3, '0')}`, fpsX, 5, COLOR.cyan, 1);
}

export function drawGameTopHud(app, fps, snapshot, telemetry) {
  const layout = pixelHudLayout(app.viewport.logicalWidth);
  const economy = snapshot.teamEconomy || { credits: snapshot.prototypeBalance.startingCredits };
  const elapsed = threatSecondsOf(snapshot);
  const rift = app.game.currentMap.spawnSources.find((source) => source.unlockSeconds > elapsed);
  app.renderer.shapes.rect(0, 0, app.viewport.logicalWidth, app.viewport.HUD_TOP_HEIGHT, COLOR.black);
  app.renderer.shapes.rect(0, app.viewport.HUD_TOP_HEIGHT - 1, app.viewport.logicalWidth, 1, COLOR.dimMint);
  app.renderer.shapes.rect(0, app.viewport.HUD_TOP_HEIGHT - 1, layout.brandWidth, 1, COLOR.mint);
  app.renderer.shapes.rect(4, 5, 2, app.viewport.HUD_TOP_HEIGHT - 12, COLOR.mint);
  app.renderer.bitmapText.draw('framebound', 11, 5, COLOR.mint, 1);
  app.renderer.bitmapText.draw('//horde', 11, 17, COLOR.uiMuted, 1);
  let x = layout.brandWidth + 12;
  // minValueChars reserves layout space for each metric's worst-case width (e.g. compactMetric's
  // longest form, "999.9t") so gaining or losing a digit never shifts this or later metrics.
  const metrics = [
    { label: 'lives', value: snapshot.dev?.infiniteHealth ? 'inf' : String(snapshot.base.lives).padStart(3, '0'), color: COLOR.ink, minValueChars: 3 },
    { label: 'credits', value: snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(economy.credits), color: COLOR.amber, minValueChars: 6 },
    { label: rift ? 'next rift' : 'rifts live', value: rift ? `${Math.ceil(realSecondsUntil(snapshot, rift.unlockSeconds))}s` : String(snapshot.swarm.activeSpawnPoints), color: COLOR.cyan, minValueChars: 4 }
  ];
  const surge = surgeStatus(app, snapshot);
  if (surge) {
    metrics[2] = {
      label: surge.phase === 'warning' ? `surge ${surge.direction}` : `surge ${surge.direction} hot`,
      value: `${surge.seconds}s`,
      color: surge.phase === 'warning' ? COLOR.amber : COLOR.red,
      minValueChars: 4
    };
  }
  for (const metric of metrics) {
    app.renderer.bitmapText.draw(metric.label, x, 4, COLOR.uiMuted, 1);
    app.renderer.bitmapText.draw(metric.value, x, 15, metric.color, layout.valueScale);
    const valueWidth = Math.max(metric.value.length, metric.minValueChars) * 6 * layout.valueScale;
    x += Math.max(metric.label.length * 6, valueWidth) + 16;
  }
  const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
  const columns = [
    { lines: [`time ${formatRunTimer(snapshot.runTick)}`, `horde ${compactMetric(snapshot.swarm.activeEnemies)}`], minChars: [13, 12] },
    { lines: [`gold ${compactMetric(telemetry.goldPerSecond)}/s`, `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s`], minChars: [13, 13] },
    ...(app.game.session.networkRole ? [{ lines: [`p2p ${connected}/4`, app.game.session.networkRole], minChars: [7, 7] }] : []),
    { lines: [`fps ${fps}`, `rifts ${snapshot.swarm.activeSpawnPoints}`], minChars: [7, 8] },
    ...((snapshot.pace || DEFAULT_PACE) !== DEFAULT_PACE ? [{ lines: [`pace x${snapshot.pace.toFixed(1)}`, snapshot.pace < DEFAULT_PACE ? 'slower' : 'faster'], minChars: [9, 6] }] : [])
  ];
  for (const column of fitPixelTelemetry(columns, x + 4, app.viewport.logicalWidth - 8)) {
    app.renderer.bitmapText.draw(column.lines[0], column.x, 5, COLOR.ink, 1);
    app.renderer.bitmapText.draw(column.lines[1], column.x, 17, COLOR.uiMuted, 1);
  }
}

export function drawGameHud(app, snapshot, telemetry) {
  const y = app.viewport.hudBottomY;
  const layout = pixelHudLayout(app.viewport.logicalWidth);
  const selectedTower = snapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId);
  const definition = catalogDefinition(snapshot, selectedTower?.definitionId);
  const input = definition?.control?.input;
  const bulk = catalogDefinition(snapshot, app.ui.bulkPlacementDefinitionId);
  app.renderer.shapes.rect(0, y, app.viewport.logicalWidth, app.viewport.logicalHeight - y, COLOR.black);
  app.renderer.shapes.rect(0, y, app.viewport.logicalWidth, 1, COLOR.dimMint);
  app.renderer.shapes.rect(0, y, 92, 1, COLOR.cyan);
  const button = (rect, id, label, active, color, action) =>
    drawButton(app, id, label, rect.x, y + rect.y, rect.width, active, color, action, rect.height);
  button(layout.left[0], 'place_frame', bulk ? `x ${bulk.label}` : app.ui.placementArmed ? '1 placing one' : '1 frame 100',
    app.ui.placementArmed, COLOR.mint, () => {
      if (app.ui.placementArmed) {
        app.ui.placementArmed = false; app.ui.bulkPlacementDefinitionId = null; setStatus(app, 'placement cancelled');
      } else armFramePlacement(app);
    });
  const canTarget = Boolean(selectedTower
    && (definition?.targetingModes?.length || (input && input !== 'none')));
  button(layout.left[1], 'target', definition?.control ? input === 'none' ? 'passive' : 'a control' : 'q/e target',
    canTarget, COLOR.cyan, () => {
      if (!canTarget) return;
      if (input && input !== 'none') openControlGeometryMenu(app, snapshot, selectedTower);
      else cycleSelectedTargeting(app, 1);
    });
  button(layout.left[2], 'build_catalog', app.ui.buildCatalogOpen ? 'b close' : bulk ? 'b switch' : 'b towers',
    app.ui.buildCatalogOpen || Boolean(bulk), COLOR.amber, app.ui.buildCatalogOpen ? closeBuildCatalog.bind(null, app) : openBuildCatalog.bind(null, app));
  button(layout.right[0], 'toggle_kps', app.ui.showKps ? 'k kps on' : 'k kps off', app.ui.showKps, COLOR.mint, () => { app.ui.showKps = !app.ui.showKps; });
  button(layout.right[1], 'toggle_ranges', app.ui.showAllRanges ? 'g ranges' : 'g range', app.ui.showAllRanges, COLOR.cyan, () => { app.ui.showAllRanges = !app.ui.showAllRanges; });
  button(layout.right[2], 'toggle_test', app.game.session.networkRole ? 'esc menu' : 't test', false, COLOR.amber,
    app.game.session.networkRole ? openEscapeMenu.bind(null, app) : enterTestField.bind(null, app));
  app.renderer.bitmapText.draw(clippedUiText(combatStatus(app, snapshot), app.viewport.logicalWidth - 16), 8, y + layout.statusY,
    performance.now() < app.ui.statusUntil ? COLOR.amber : COLOR.ink, 1);
  const items = [
    { lines: [`gold ${compactMetric(telemetry.goldPerSecond)}/s`], minChars: [13] },
    { lines: [`kills ${compactMetric(snapshot.stats.kills)}`], minChars: [12] },
    ...(app.ui.showKps ? [{ lines: [`kps ${compactMetric(telemetry.oneSecond)}`], minChars: [10] }] : []),
    { lines: [`shots ${compactMetric(snapshot.stats.shotsResolved)}/${compactMetric(snapshot.stats.shotsFired)}`], minChars: [19] },
    ...(app.ui.showKps ? [{ lines: [`10s ${compactMetric(telemetry.tenSecond)} // peak ${compactMetric(telemetry.peak)}`], minChars: [24] }] : [])
  ];
  for (const item of fitPixelTelemetry(items, 8, app.viewport.logicalWidth - 8)) {
    app.renderer.bitmapText.draw(item.lines[0], item.x, y + layout.statsY, COLOR.uiMuted, 1);
  }
}

export function drawSpawnSlider(app, snapshot, x, y, width) {
  const rate = snapshot.test.spawnRatePerSecond;
  const fraction = Math.max(0, Math.min(1, Math.log10(rate + 1) / 5));
  app.renderer.shapes.rect(x, y + 5, width, 3, COLOR.dimMint);
  app.renderer.shapes.rect(x, y + 5, Math.max(1, Math.round(width * fraction)), 3, COLOR.red);
  const knobX = Math.round(x + width * fraction);
  app.renderer.shapes.rect(knobX - 2, y + 2, 5, 9, COLOR.amber);
  registerHitbox(app, 'spawn_rate', x, y, width, 13, { drag: { kind: 'spawn-rate' } });
}

export function drawTestHud(app, snapshot, telemetry) {
  const y = app.viewport.hudBottomY;
  app.renderer.shapes.rect(0, y, app.viewport.logicalWidth, app.viewport.logicalHeight - y, COLOR.black);
  app.renderer.shapes.rect(0, y, app.viewport.logicalWidth, 1, COLOR.dimMint);
  app.renderer.shapes.rect(0, y, Math.min(220, app.viewport.logicalWidth), 1, COLOR.amber);

  const first = y + 3;
  app.renderer.bitmapText.draw(`spawn ${Math.round(snapshot.test.spawnRatePerSecond)}/s`, 8, first + 3, COLOR.red, 1);
  const sliderX = 92;
  const sliderWidth = Math.max(90, Math.min(230, app.viewport.logicalWidth - 520));
  drawSpawnSlider(app, snapshot, sliderX, first, sliderWidth);
  let x = sliderX + sliderWidth + 7;
  for (const rate of [0, 100, 1000, 10000]) {
    const label = rate === 10000 ? '10k' : String(rate);
    drawButton(app, `preset_${rate}`, label, x, first, rate === 10000 ? 28 : 24, snapshot.test.spawnRatePerSecond === rate, COLOR.red, () => setTestConfig(app, { spawnRatePerSecond: rate }));
    x += rate === 10000 ? 32 : 28;
  }
  app.renderer.bitmapText.draw('hp', x + 2, first + 3, COLOR.ink, 1); x += 20;
  for (const hp of [1, 2, 5, 10]) {
    drawButton(app, `hp_${hp}`, String(hp), x, first, hp === 10 ? 22 : 17, snapshot.test.enemyHp === hp, hp === 1 ? COLOR.mint : COLOR.amber, () => setTestConfig(app, { enemyHp: hp }));
    x += hp === 10 ? 26 : 21;
  }
  if (app.viewport.logicalWidth < 850) {
    drawButton(app, 'test_ranges', app.ui.showAllRanges ? 'ranges on' : 'ranges off', app.viewport.logicalWidth - 126, first, 68, app.ui.showAllRanges, COLOR.cyan, () => { app.ui.showAllRanges = !app.ui.showAllRanges; });
    drawButton(app, 'return_game', 't game', app.viewport.logicalWidth - 54, first, 46, false, COLOR.mint, () => activateSession(app, 'game'));
  }

  const formRow = y + 18;
  x = 8;
  const selected = snapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId) || snapshot.towers[0];
  for (const [key, form, color] of [
    ['1', 'frame', COLOR.mint],
    ['2', 'assault', COLOR.amber],
    ['3', 'tether', COLOR.cyan],
    ['4', 'network', COLOR.green],
    ['5', 'barrage', COLOR.amber],
    ['6', 'rocket', COLOR.amber],
    ['7', 'laser', COLOR.cyan]
  ]) {
    const label = `${key} ${form}`;
    const width = Math.max(50, label.length * 6 + 8);
    drawButton(app, `form_${form}`, label, x, formRow, width, selected?.definitionId === form, color, () => switchTestTowerForm(app, form));
    x += width + 4;
  }

  const controlFormRow = y + 33;
  x = 8;
  for (const [key, form, color] of [
    ['8', 'anchor', COLOR.cyan],
    ['9', 'knot', COLOR.green],
    ['0', 'backwash', COLOR.amber],
    ['o', 'overclock', COLOR.amber],
    ['f', 'forge', COLOR.amber],
    ['r', 'relay', COLOR.cyan]
  ]) {
    const label = `${key} ${form}`;
    const width = Math.max(50, label.length * 6 + 8);
    drawButton(app, `form_${form}`, label, x, controlFormRow, width, selected?.definitionId === form, color, () => switchTestTowerForm(app, form));
    x += width + 4;
  }

  const toolRow = y + 48;
  x = 8;
  drawButton(app, 'support', app.ui.placementArmed ? 'b placing' : 'b support', x, toolRow, 62, app.ui.placementArmed, COLOR.mint, () => { app.ui.placementArmed = !app.ui.placementArmed; }); x += 66;
  drawButton(app, 'test_forms', app.ui.buildCatalogOpen ? 'u close' : 'u forms', x, toolRow, 48, app.ui.buildCatalogOpen, COLOR.amber, app.ui.buildCatalogOpen ? closeBuildCatalog.bind(null, app) : () => openBuildCatalog(app, 'assault')); x += 52;
  drawButton(app, 'test_network_forms', 'n net iii', x, toolRow, 57, app.ui.buildCatalogOpen && app.ui.buildCatalogPageId === 'network', COLOR.green, () => openBuildCatalog(app, 'network')); x += 61;
  drawButton(app, 'keep_swarm', app.ui.testKeepSwarm ? 'keep on' : 'keep off', x, toolRow, 52, app.ui.testKeepSwarm, COLOR.amber, () => {
    app.ui.testKeepSwarm = !app.ui.testKeepSwarm;
    saveTestPreferences(app, snapshot.test);
  }); x += 56;
  drawButton(app, 'pause', snapshot.test.paused ? 'resume' : 'pause', x, toolRow, 44, snapshot.test.paused, COLOR.cyan, () => setTestConfig(app, { paused: !snapshot.test.paused })); x += 48;
  drawButton(app, 'step', 'step', x, toolRow, 34, false, COLOR.cyan, () => app.game.session.send(COMMAND.TEST_STEP)); x += 38;
  drawButton(app, 'clear', 'clear', x, toolRow, 40, false, COLOR.red, () => app.game.session.send(COMMAND.TEST_CLEAR, { resetCounters: true })); x += 44;
  drawButton(app, 'invincible', snapshot.test.invincibleBase ? 'base safe' : 'base live', x, toolRow, 58, snapshot.test.invincibleBase, COLOR.green, () => setTestConfig(app, { invincibleBase: !snapshot.test.invincibleBase })); x += 62;
  if (app.viewport.logicalWidth >= 850) {
    for (const scale of [0.25, 1, 2, 4]) {
      const label = scale === 0.25 ? '1/4x' : `${scale}x`;
      drawButton(app, `speed_${scale}`, label, x, toolRow, 28, snapshot.test.timeScale === scale, COLOR.amber, () => setTestConfig(app, { timeScale: scale }));
      x += 32;
    }
  } else {
    const scales = [0.25, 1, 2, 4];
    const currentScale = scales.indexOf(snapshot.test.timeScale);
    drawButton(app, 'speed_cycle', `speed ${snapshot.test.timeScale}x`, x, toolRow, 58, true, COLOR.amber, () => setTestConfig(app, { timeScale: scales[(currentScale + 1) % scales.length] }));
  }
  if (app.viewport.logicalWidth >= 850) {
    drawButton(app, 'test_ranges', app.ui.showAllRanges ? 'ranges on' : 'ranges off', app.viewport.logicalWidth - 126, toolRow, 68, app.ui.showAllRanges, COLOR.cyan, () => { app.ui.showAllRanges = !app.ui.showAllRanges; });
    drawButton(app, 'return_game', 't game', app.viewport.logicalWidth - 54, toolRow, 46, false, COLOR.mint, () => activateSession(app, 'game'));
  }

  const statsRow = y + 65;
  const seconds = snapshot.runTick / AUTHORITY_TICK_RATE;
  app.renderer.bitmapText.draw(`kps 1s ${telemetry.oneSecond.toFixed(1)} // 10s ${telemetry.tenSecond.toFixed(1)} // peak ${telemetry.peak.toFixed(1)}`, 8, statsRow, COLOR.mint, 1);
  if (app.viewport.logicalWidth >= 850) {
    app.renderer.bitmapText.draw(`alive ${compactMetric(snapshot.swarm.activeEnemies)} records ${snapshot.swarm.simulationRecords}/${snapshot.swarm.recordBudget} killed ${compactMetric(snapshot.stats.kills)}`, 246, statsRow, COLOR.ink, 1);
    app.renderer.bitmapText.draw(`gold ${compactMetric(telemetry.goldPerSecond)}/s shots ${compactMetric(snapshot.stats.shotsResolved)}/${compactMetric(snapshot.stats.shotsFired)} fx ${snapshot.stats.controlApplications} bonus ${compactMetric(snapshot.stats.bonusCredits || 0)} time ${seconds.toFixed(1)}s`, Math.max(8, app.viewport.logicalWidth - 338), statsRow, COLOR.cyan, 1);
  } else {
    app.renderer.bitmapText.draw(`alive ${compactMetric(snapshot.swarm.activeEnemies)} rec ${snapshot.swarm.simulationRecords} kill ${compactMetric(snapshot.stats.kills)} gold ${compactMetric(telemetry.goldPerSecond)}/s t${seconds.toFixed(0)}s`, 270, statsRow, COLOR.ink, 1);
  }
  const selectedStats = selected
    ? `${selected.definitionId} // ${Number(selected.effectiveCadence || 0).toFixed(1)}/s r${Math.round(selected.effectiveRange || 0)} // kills ${compactMetric(selected.kills || 0)}${selected.bonusCredits ? ` +${compactMetric(selected.bonusCredits)}cr` : ''} // drag towers and spawns`
    : 'drag spawn markers // drag towers // colour shows remaining hp';
  app.renderer.bitmapText.draw(performance.now() < app.ui.statusUntil ? app.ui.statusMessage : selectedStats, 8, y + 77, COLOR.amber, 1);
}

export function combatStatus(app, snapshot) {
  const selectedTower = snapshot.towers.find((tower) => tower.id === app.ui.selectedTowerId);
  const selectedDefinition = catalogDefinition(snapshot, selectedTower?.definitionId);
  const bulkDefinition = catalogDefinition(snapshot, app.ui.bulkPlacementDefinitionId);
  const targetLabel = selectedTower?.targetingMode?.replaceAll('_', ' ') || 'closest';
  const elapsedSeconds = threatSecondsOf(snapshot);
  const nextRift = app.game.currentMap.spawnSources.find((source) => source.unlockSeconds > elapsedSeconds);
  const surge = surgeStatus(app, snapshot);
  const riftStatus = surge
    ? surge.phase === 'warning'
      ? `surge // ${surge.direction} in ${surge.seconds}s // x${surge.hpMultiplier} hp`
      : `surge // ${surge.direction} hot ${surge.seconds}s // x${surge.hpMultiplier} hp`
    : nextRift
      ? `next rift ${Math.ceil(realSecondsUntil(snapshot, nextRift.unlockSeconds))}s`
      : `${snapshot.swarm.activeSpawnPoints} rifts live`;
  const rebootTicks = Math.max(0, (selectedTower?.controlReadyTick || 0) - snapshot.runTick);
  const countsControlHits = ['stasis_zone', 'recall_gate', 'breaker_wave'].includes(selectedDefinition?.control?.type);
  const controlWork = countsControlHits
    ? `${compactMetric(selectedTower?.controlStats?.affectedUnits || 0)} enemies`
    : `${compactMetric(Math.floor((selectedTower?.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE))} unit-s`;
  const passive = selectedTower
    ? weaponView(snapshot, selectedTower)?.supportOnly && weaponView(snapshot, selectedTower)?.attack
      ? `${selectedTower.definitionId} // control casts ${compactMetric(selectedTower.controlStats?.activations || 0)} // zero damage`
      : selectedDefinition?.control && selectedDefinition.control.type !== 'bond_zone'
      ? `${selectedTower.definitionId} // control ${rebootTicks > 0 ? `reboot ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : 'online'} // affected ${controlWork} // invested ${compactMetric(selectedTower.totalInvestment)}`
      : selectedDefinition?.control?.type === 'bond_zone'
        ? `bond // kills ${compactMetric(selectedTower.kills || 0)} // pairs ${selectedDefinition.control.durationSeconds}s every ${selectedDefinition.control.periodSeconds}s // no chains`
        : `${selectedTower.definitionId} // kills ${compactMetric(selectedTower.kills || 0)} // target ${targetLabel} // invested ${compactMetric(selectedTower.totalInvestment)}`
    : bulkDefinition
      ? `${bulkDefinition.label} repeat // right click ends // b switches tower`
      : `1 one frame // b tower catalog // ${riftStatus} // drag pan // wheel zoom`;
  return performance.now() < app.ui.statusUntil ? app.ui.statusMessage : passive;
}

export function drawHud(app, fps, snapshot) {
  const telemetry = killTelemetry(app, app.game.sessionMode, snapshot);
  drawTopHud(app, fps, snapshot, telemetry);
  if (app.game.sessionMode === 'test') drawTestHud(app, snapshot, telemetry);
  else drawGameHud(app, snapshot, telemetry);
  drawBuildCatalog(app, snapshot);

  if (app.game.session.networkRole === 'guest' && (!app.game.session.connected || !app.game.session.synced || app.game.session.resyncPending || app.game.session.stalled)) {
    const panelWidth = Math.min(236, app.viewport.logicalWidth - 16);
    const panelX = Math.round((app.viewport.logicalWidth - panelWidth) * 0.5);
    const panelY = Math.round(app.viewport.logicalHeight * 0.5 - 30);
    drawTechPanel(app, panelX, panelY, panelWidth, 60, COLOR.amber);
    app.renderer.bitmapText.draw('recovering link', panelX + 14, panelY + 10, COLOR.amber, 2);
    app.renderer.bitmapText.draw('waiting for the host snapshot', panelX + 14, panelY + 32, COLOR.ink, 1);
    app.renderer.bitmapText.draw('replica held // no fake progress', panelX + 14, panelY + 44, COLOR.dimMint, 1);
  } else if (snapshot.phase === 'defeated') {
    app.ui.uiHitboxes.length = 0;
    const layout = defeatLayout(viewport(app));
    const { x: panelX, y: panelY, width, height, buttonX, buttonWidth, rows } = layout;
    drawTechPanel(app, panelX, panelY, width, height, COLOR.red);
    app.renderer.bitmapText.draw('base lost', panelX + 16, panelY + 10, COLOR.red, 2);
    drawReactorShutdown(app, snapshot, layout.reactor.x, layout.reactor.y);
    if (layout.thumbnail && app.game.currentMap.playable) {
      const thumb = layout.thumbnail;
      drawMapThumbnail(app.renderer.shapes, COLOR, app.game.currentMap, thumb.x, thumb.y, thumb.width, thumb.height, COLOR.dimMint);
    }
    const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
    const pace = snapshot.pace || DEFAULT_PACE;
    const statsWidth = (layout.thumbnail ? layout.thumbnail.x : layout.reactor.x) - panelX - 20;
    app.renderer.bitmapText.draw(clippedUiText(`survived ${Math.floor(seconds / 60)}m ${seconds % 60}s${pace === DEFAULT_PACE ? '' : ` // x${pace.toFixed(1)}`}`, statsWidth), panelX + 16, panelY + rows.stats, COLOR.ink, 1);
    app.renderer.bitmapText.draw(clippedUiText(`${compactMetric(snapshot.stats.kills)} kills // ${snapshot.towers.length} towers`, statsWidth), panelX + 16, panelY + rows.stats + 14, COLOR.amber, 1);
    app.renderer.bitmapText.draw(clippedUiText(snapshot.mapLabel || app.game.currentMap.label, statsWidth), panelX + 16, panelY + rows.stats + 28, COLOR.dimMint, 1);
    if (app.game.session.networkRole) {
      drawMenuButton(app, 'defeat_coop', 'room status', buttonX, panelY + rows.retry, buttonWidth, COLOR.cyan, () => { app.ui.frontEndScreen = 'coop'; });
      app.renderer.bitmapText.draw('new coop run needs a fresh room', buttonX, panelY + rows.map + 4, COLOR.ink, 1);
    } else {
      drawMenuButton(app, 'defeat_retry', 'retry same field // r', buttonX, panelY + rows.retry, buttonWidth, COLOR.mint,
        () => { clearTransientUi(app); app.game.session.send(COMMAND.SESSION_RESTART); }, true);
      drawMenuButton(app, 'defeat_map', 'choose another map', buttonX, panelY + rows.map, buttonWidth, COLOR.cyan, () => openMapSelection(app, 'main'));
    }
    drawMenuButton(app, 'defeat_menu', 'main menu', buttonX, panelY + rows.menu, buttonWidth, COLOR.cyan, returnToMainMenu.bind(null, app));
  } else {
    app.effects.defeatSeenAt = null;
  }

}

// Restrained reactor shutdown: the base sprite steps cyan, amber, red, then extinguished
// over 0.6s of wall-clock time (ticks stop at defeat). Retry controls never wait on it.

export function drawReactorShutdown(app, snapshot, x, y) {
  const now = performance.now();
  if (app.effects.defeatSeenAt === null) app.effects.defeatSeenAt = now;
  const age = app.effects.reducedNetworkMotion.matches ? Infinity : (now - app.effects.defeatSeenAt) / 1000;
  const appearance = reactorShutdownAppearance(snapshot, age);
  drawBaseSprite(app.renderer.shapes, COLOR, { x: x + 21, y: y + 15 }, appearance);
}

export function reactorShutdownAppearance(snapshot, age) {
  const step = age < 0.15 ? 0 : age < 0.3 ? 1 : age < 0.45 ? 2 : 3;
  const state = ['healthy', 'damaged', 'critical', 'destroyed'][step];
  return { state, health: step === 3 ? 0 : 1, plates: Math.max(0, 4 - step), phase: 0, hit: step > 0 && step < 3 };
}
