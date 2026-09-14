import { catalogDefinition, economyNetworkSummary, relayCandidateAreas, weaponView } from '../app/queries.js';
import { openResearchStation } from '../app/research-actions.js';
import { towerDamageRate } from '../app/tower-telemetry.js';
import { clearSelectedStrikePoint, evolveSelectedTower, openControlGeometryMenu, openRelayTargetMenu, openStrikeTargetMenu, openUpgradeMenu, resetSelectedControlGeometry, sellSelectedTower } from '../app/tower-actions.js';
import { registerHitbox, setStatus } from '../app/ui-state.js';
import { compactMetric } from '../core/format.js';
import { isRelayForm, purchaseCost, saleRefund } from '../core/network-descendants.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { supportsStrikePoint } from '../core/strike-pattern.js';
import { TOWER_PORTRAIT_SIZE, drawTowerPortrait } from '../render/tower-sprites.js';
import { COLOR, towerAccent } from './palette.js';
import { pixelActionLayout } from './pixel-layout.js';
import { clippedUiText, drawButton, drawTechPanel, pointInside, towerPanelPosition } from './widgets.js';

export function towerActionView(app, snapshot, tower) {
  const definition = catalogDefinition(snapshot, tower.definitionId);
  if (!definition) return null;
  const owner = snapshot.players.find((player) => player.id === tower.ownerId);
  const inspectOnly = false;
  const actions = [];
  const panel = { x: 0, y: 0 };
  const addAction = (id, label, x, y, width, active, color, action) => {
    actions.push({ id, label, x, y, width, active, color, action });
  };
  const station = ['arsenal', 'reactor'].includes(definition.id);
  if (station) {
    addAction('station_open', '1 open upgrades', 5, 20, 170, true, COLOR.mint, () => openResearchStation(app, tower));
    addAction('station_sell', `2 sell // ${compactMetric(saleRefund(snapshot, tower))}`, 5, 36, 170, true, COLOR.red, sellSelectedTower.bind(null, app));
    return { title: definition.label, investment: compactMetric(tower.totalInvestment), metric: 'research is never refunded',
      width: 180, height: 66, accent: COLOR.amber, actions, inspectOnly, owner: owner?.label || 'pilot', station: true };
  }
  const canAim = supportsStrikePoint(weaponView(snapshot, tower)?.attack);
  const effectiveControl = weaponView(snapshot, tower)?.control;
  const canControl = Boolean(effectiveControl?.input && effectiveControl.input !== 'none');
  const relayForm = isRelayForm(definition.id);
  const hasManualControl = canAim || canControl || relayForm;
  const isEconomyNode = ['mint', 'forge'].includes(definition.id);
  const width = 150;
  const height = definition.id === 'echo' && (canAim || canControl) ? 97 : ['echo', 'hardpoint'].includes(definition.id) ? 81 : hasManualControl ? 65 : 49;
  const supportLabel = tower.bonusCredits > 0 ? ` +${compactMetric(tower.bonusCredits)} cr` : '';
  const isPureControl = Boolean(weaponView(snapshot, tower)?.supportOnly);
  const isWeapon = Boolean(definition.attack && !isPureControl);
  const damageRate = isWeapon ? towerDamageRate(app, tower) : null;
  const controlLabels = {
    stasis_zone: 'held',
    recall_gate: 'recalled',
    slow_zone: 'slowed', frost_zone: 'chilled', barricade: 'blocked',
    singularity: 'shaped',
    braid: 'shaped',
    breaker_wave: 'pushed',
    crosswind: 'steered',
    splitter: 'split'
  };
  const discreteControl = ['stasis_zone', 'recall_gate', 'breaker_wave'].includes(definition.control?.type);
  const controlValue = discreteControl
    ? tower.controlStats?.affectedUnits || 0
    : Math.floor((tower.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE);
  const economy = isEconomyNode ? economyNetworkSummary(snapshot, tower) : null;
  const metricLabel = isEconomyNode
    ? (definition.id === 'mint'
      ? `+${economy.mintBonusPercent}% income // ${compactMetric(economy.mintCredits)}cr shared // ${economy.mintCount} mint-s`
      : `base income // ${compactMetric(economy.forgeCredits)}cr shared // ${economy.forgeCount} forge-s`)
    : isPureControl && weaponView(snapshot, tower)?.attack
    ? `casts // ${compactMetric(tower.controlStats?.activations || 0)}`
    : isPureControl
    ? `${controlLabels[definition.control?.type] || 'affected'} // ${compactMetric(controlValue)}${discreteControl ? '' : ' unit-s'}`
    : isWeapon ? `hp/s ${damageRate === null ? '--' : compactMetric(damageRate)} // recent`
    : `kills // ${compactMetric(tower.kills || 0)}${supportLabel}`;
  const recentlyActive = isPureControl
    ? tower.controlStats?.lastActiveTick > 0 && snapshot.runTick - tower.controlStats.lastActiveTick <= AUTHORITY_TICK_RATE * 0.45
    : tower.lastDamageTick > 0 && snapshot.runTick - tower.lastDamageTick <= AUTHORITY_TICK_RATE * 0.45;

  const details = isWeapon ? [
    `${compactMetric(tower.hpPopped || 0)} hp // ${compactMetric(tower.kills || 0)} kills`,
    `range ${Math.round(tower.effectiveRange || definition.range)}u // cycle ${tower.effectiveCadence > 0 ? (1 / tower.effectiveCadence).toFixed(2) : '--'}s`
  ] : [];

  const view = { title: definition.label, investment: compactMetric(tower.totalInvestment), metric: metricLabel,
    width, height, accent: towerAccent(tower.definitionId), actions, details, inspectOnly, owner: owner?.label || 'pilot', recentlyActive };
  if (inspectOnly) return view;
  const refund = saleRefund(snapshot, tower);
  const hasChoices = definition.evolutionChoices?.length > 0;
  const isRelay = relayForm && !hasChoices;
  addAction(
    `tower_upgrade_${tower.id}`,
    isRelay ? (tower.relayTargetAreaId ? '1 relink' : '1 link') : hasChoices ? '1 upgrade' : '1 upgrade ?',
    panel.x + 5,
    panel.y + 31,
    65,
    hasChoices || isRelay,
    COLOR.mint,
    () => isRelay ? openRelayTargetMenu(app, snapshot, tower) : openUpgradeMenu(app, snapshot, tower)
  );
  addAction(
    `tower_sell_${tower.id}`,
    `2 sell ${compactMetric(refund)}`,
    panel.x + 75,
    panel.y + 31,
    70,
    true,
    COLOR.red,
    sellSelectedTower.bind(null, app)
  );
  if (relayForm) {
    addAction(`network_link_${tower.id}`, '3 link nebula', panel.x + 5, panel.y + 47, 140, true, COLOR.cyan, () => openRelayTargetMenu(app, snapshot, tower));
    if (['echo', 'hardpoint'].includes(definition.id)) addAction(`network_config_${tower.id}`,
      definition.id === 'echo' ? `copy: ${tower.echoWeaponId || 'select control'}` : 'position build socket',
      panel.x + 5, panel.y + 63, 140, true, COLOR.amber, () => {
        app.ui.towerMenuMode = definition.id === 'echo' ? 'echo' : 'socket';
        setStatus(app, definition.id === 'echo' ? 'click a connected control turret' : 'click along the relay line');
      });
    if (definition.id === 'echo' && canControl) {
      addAction(`echo_control_${tower.id}`, 'reshape control', panel.x + 5, panel.y + 79, 140, true, COLOR.cyan, () => openControlGeometryMenu(app, snapshot, tower));
    } else if (definition.id === 'echo' && canAim) {
      addAction(`echo_aim_${tower.id}`, 'aim point', panel.x + 5, panel.y + 79, 88, true, COLOR.cyan, () => openStrikeTargetMenu(app, snapshot, tower));
      addAction(`echo_auto_${tower.id}`, 'auto', panel.x + 98, panel.y + 79, 47, true, COLOR.amber, clearSelectedStrikePoint.bind(null, app));
    }
  } else if (hasManualControl) {
    addAction(
      `tower_aim_${tower.id}`,
      canControl
        ? (definition.control.input === 'direction' ? '3 redirect' : '3 reshape')
        : (tower.strikePoint ? '3 re-aim' : '3 aim point'),
      panel.x + 5,
      panel.y + 47,
      88,
      true,
      COLOR.cyan,
      () => canControl ? openControlGeometryMenu(app, snapshot, tower) : openStrikeTargetMenu(app, snapshot, tower)
    );
    addAction(
      `tower_auto_aim_${tower.id}`,
      canControl ? '0 reset' : '0 auto',
      panel.x + 98,
      panel.y + 47,
      47,
      Boolean(canControl ? tower.controlGeometry : tower.strikePoint),
      COLOR.amber,
      canControl ? resetSelectedControlGeometry.bind(null, app) : clearSelectedStrikePoint.bind(null, app)
    );
  }
  return view;
}

export function drawTowerActionMenu(app, snapshot, tower) {
  const view = towerActionView(app, snapshot, tower);
  if (!view) return;
  if (app.game.sessionMode === 'game') return drawPixelTowerActions(app, tower, view);
  const panel = towerPanelPosition(app, tower, view.width, view.height);
  drawTechPanel(app, panel.x, panel.y, view.width, view.height, view.accent);
  app.renderer.bitmapText.draw(view.station ? view.title : `${view.title} // ${view.investment} cr`, panel.x + 7, panel.y + 5, view.accent, 1);
  app.renderer.bitmapText.draw(clippedUiText(view.metric, view.width - 14), panel.x + 7, panel.y + (view.station ? 54 : 16), view.station ? COLOR.dimMint : view.recentlyActive ? COLOR.mint : COLOR.ink, 1);
  if (!view.station) {
    app.renderer.shapes.rect(panel.x + view.width - 16, panel.y + 17, 8, 1, view.recentlyActive ? COLOR.amber : COLOR.dimMint);
    if (view.recentlyActive) {
      app.renderer.shapes.rect(panel.x + view.width - 13, panel.y + 15, 2, 5, COLOR.amber);
      app.renderer.shapes.rect(panel.x + view.width - 9, panel.y + 16, 1, 3, COLOR.mint);
    }
  }
  if (view.inspectOnly) {
    app.renderer.bitmapText.draw(clippedUiText(`owner ${view.owner}`, view.width - 14), panel.x + 7, panel.y + 31, COLOR.cyan, 1);
    app.renderer.bitmapText.draw('inspect only', panel.x + 7, panel.y + 40, COLOR.dimMint, 1);
  }
  for (const button of view.actions) drawButton(app, button.id, button.label, panel.x + button.x, panel.y + button.y,
    button.width, button.active, view.station && button.id === 'station_sell' ? COLOR.amber : button.color, button.action);
}

export function drawPixelTowerActions(app, tower, view) {
  if (app.ui.towerActionPageTowerId !== tower.id) {
    app.ui.towerActionPageTowerId = tower.id;
    app.ui.towerActionPage = 0;
  }
  const width = Math.min(208, app.viewport.logicalWidth - 10);
  const availableHeight = app.viewport.hudBottomY - app.viewport.HUD_TOP_HEIGHT - 8;
  const details = (view.details || []).slice(0, Math.max(0, Math.floor((availableHeight - 80) / 11)));
  const layout = pixelActionLayout(view.actions, availableHeight, app.ui.towerActionPage, details.length);
  app.ui.towerActionPage = layout.page;
  const height = view.inspectOnly ? 64 : layout.height;
  const panel = towerPanelPosition(app, tower, width, height);
  drawTechPanel(app, panel.x, panel.y, width, height, view.accent);
  // The panel's empty space must consume clicks too; buttons are registered afterwards.
  registerHitbox(app, `tower_panel_${tower.id}`, panel.x, panel.y, width, height);
  app.renderer.bitmapText.draw(clippedUiText(view.title, width - 24), panel.x + 8, panel.y + 6, view.accent, 1);
  app.renderer.bitmapText.draw(clippedUiText(view.metric, width - 16), panel.x + 8, panel.y + 17, COLOR.ink, 1);
  details.forEach((line, index) => app.renderer.bitmapText.draw(clippedUiText(line, width - 16), panel.x + 8, panel.y + 28 + index * 11, COLOR.uiMuted, 1));
  app.renderer.bitmapText.draw(`invested ${view.investment} cr`, panel.x + 8, panel.y + 28 + details.length * 11, COLOR.uiMuted, 1);
  app.renderer.shapes.rect(panel.x + 8, panel.y + layout.actionsY - 4, width - 16, 1, COLOR.dimMint);
  if (view.inspectOnly) {
    app.renderer.bitmapText.draw(clippedUiText(`owner ${view.owner}`, width - 16), panel.x + 8, panel.y + 43, COLOR.cyan, 1);
    app.renderer.bitmapText.draw('inspect only', panel.x + 8, panel.y + 53, COLOR.uiMuted, 1);
    return;
  }
  for (const [rowIndex, row] of layout.rows.entries()) {
    const buttonWidth = Math.floor((width - 16 - (row.length - 1) * 6) / row.length);
    for (const [index, button] of row.entries()) {
      drawButton(app, button.id, button.label, panel.x + 8 + index * (buttonWidth + 6), panel.y + layout.actionsY + rowIndex * 21,
        buttonWidth, button.active, button.color, button.action, 17);
    }
  }
  if (layout.pages > 1) {
    const y = panel.y + height - 16;
    drawButton(app, 'tower_actions_prev', '<', panel.x + 8, y, 22, false, COLOR.cyan,
      () => { app.ui.towerActionPage = (layout.page + layout.pages - 1) % layout.pages; });
    app.renderer.bitmapText.draw(`actions ${layout.page + 1}/${layout.pages}`, panel.x + 38, y + 3, COLOR.uiMuted, 1);
    drawButton(app, 'tower_actions_next', '>', panel.x + width - 30, y, 22, false, COLOR.cyan,
      () => { app.ui.towerActionPage = (layout.page + 1) % layout.pages; });
  }
}

export function wrappedDescription(lines, maximumCharacters, maximumLines) {
  const output = [];
  for (const sourceLine of lines || []) {
    const words = sourceLine.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maximumCharacters) line = candidate;
      else {
        if (line) output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
    if (output.length >= maximumLines) break;
  }
  return output.slice(0, maximumLines);
}

export function drawUpgradeChoice(app, snapshot, tower, definition, shortcut, x, y, width, height) {
  const economy = snapshot.teamEconomy;
  const cost = purchaseCost(snapshot, tower.areaId, definition.evolutionCost || 0);
  const affordable = (app.game.sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) >= cost;
  const accent = affordable ? towerAccent(definition.id) : COLOR.red;
  const hovered = pointInside(app, x, y, width, height);
  app.renderer.shapes.rect(x, y, width, height, COLOR.black);
  app.renderer.shapes.rect(x, y, width, 1, hovered ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x, y + height - 1, width, 1, hovered ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x, y, 1, height, hovered ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x + width - 1, y, 1, height, hovered ? accent : COLOR.dimMint);
  app.renderer.shapes.rect(x + 3, y + 3, hovered ? 12 : 5, 2, accent);
  if (hovered) app.renderer.shapes.rect(x + width - 5, y + 3, 2, 5, accent);
  // The real body sits in a fixed socket at the top right so the silhouette reads before buying.
  const socketX = x + width - TOWER_PORTRAIT_SIZE - 5;
  const socketY = y + 16;
  app.renderer.shapes.rect(socketX, socketY - 1, TOWER_PORTRAIT_SIZE, 1, COLOR.dimMint);
  app.renderer.shapes.rect(socketX, socketY + TOWER_PORTRAIT_SIZE, TOWER_PORTRAIT_SIZE, 1, COLOR.dimMint);
  drawTowerPortrait(app.renderer.shapes, COLOR, socketX, socketY, definition.id);
  const textWidth = socketX - (x + 5) - 3;
  app.renderer.bitmapText.draw(clippedUiText(`${shortcut} ${definition.label}`, width - 10), x + 5, y + 8, accent, 1);
  app.renderer.bitmapText.draw(clippedUiText(definition.role || 'branch', textWidth), x + 5, y + 19, COLOR.ink, 1);
  app.renderer.bitmapText.draw(clippedUiText(`${compactMetric(cost)} cr`, textWidth), x + 5, y + 29, affordable ? COLOR.amber : COLOR.red, 1);
  app.renderer.shapes.rect(x + 5, y + 44, width - 10, 1, COLOR.dimMint);
  const maximumCharacters = Math.max(6, Math.floor((width - 10) / 6));
  const lines = wrappedDescription(definition.description, maximumCharacters, 4);
  for (let index = 0; index < lines.length; index += 1) {
    app.renderer.bitmapText.draw(lines[index], x + 5, y + 49 + index * 10, COLOR.ink, 1);
  }
  registerHitbox(app, `upgrade_choice_${tower.id}_${definition.id}`, x, y, width, height, {
    action: () => {
      if (!affordable) {
        setStatus(app, `need ${compactMetric(cost)} credits`);
        return;
      }
      evolveSelectedTower(app, definition.id);
    }
  });
}

export function drawTowerUpgradeMenu(app, snapshot, tower) {
  const current = catalogDefinition(snapshot, tower.definitionId);
  const choices = (current?.evolutionChoices || [])
    .map((id) => catalogDefinition(snapshot, id))
    .filter(Boolean);
  if (!choices.length) {
    app.ui.towerMenuMode = 'actions';
    return;
  }
  const width = Math.min(342, app.viewport.logicalWidth - 10);
  const height = 116;
  const panel = towerPanelPosition(app, tower, width, height);
  drawTechPanel(app, panel.x, panel.y, width, height, COLOR.mint);
  const cost = purchaseCost(snapshot, tower.areaId, choices[0]?.evolutionCost || 0);
  app.renderer.bitmapText.draw(`upgrade // 1 2 3 choose // ${compactMetric(cost)} cr`, panel.x + 7, panel.y + 5, COLOR.mint, 1);
  drawButton(app, `upgrade_back_${tower.id}`, 'back', panel.x + width - 39, panel.y + 3, 34, false, COLOR.cyan, () => {
    app.ui.towerMenuMode = 'actions';
  });
  const gap = 3;
  const cardX = panel.x + 5;
  const cardY = panel.y + 19;
  const cardHeight = height - 24;
  const cardWidth = Math.floor((width - 10 - gap * (choices.length - 1)) / choices.length);
  choices.forEach((definition, index) => {
    drawUpgradeChoice(app, snapshot, tower, definition, index + 1, cardX + index * (cardWidth + gap), cardY, cardWidth, cardHeight);
  });
}

export function drawRelayTargetMenu(app, snapshot, tower) {
  const definition = catalogDefinition(snapshot, tower.definitionId);
  const candidates = relayCandidateAreas(app, snapshot, tower);
  const width = 188;
  const height = 43;
  const panel = towerPanelPosition(app, tower, width, height);
  drawTechPanel(app, panel.x, panel.y, width, height, COLOR.cyan);
  app.renderer.bitmapText.draw('relay // choose nebula', panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  app.renderer.bitmapText.draw(`${candidates.length} in ${definition?.linkRange || 0}u // click field`, panel.x + 7, panel.y + 18, candidates.length ? COLOR.ink : COLOR.red, 1);
  drawButton(app, `relay_back_${tower.id}`, 'back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.amber, () => {
    app.ui.towerMenuMode = 'actions';
  });
}

export function drawStrikeTargetMenu(app, snapshot, tower) {
  const definition = catalogDefinition(snapshot, tower.definitionId);
  const width = 210;
  const height = 43;
  const panel = towerPanelPosition(app, tower, width, height);
  drawTechPanel(app, panel.x, panel.y, width, height, COLOR.cyan);
  const shotgun = definition?.attack?.mechanic === 'shotgun';
  const beam = ['hitscan', 'persistent'].includes(definition?.attack?.delivery?.type);
  app.renderer.bitmapText.draw(shotgun ? 'fan aim // click a facing' : beam ? 'beam aim // click a direction' : 'rocket aim // click strike point', panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  app.renderer.bitmapText.draw(`${tower.effectiveRange || definition?.range || 0}u // ${shotgun ? 'fires when the fan has a target' : beam ? 'authority-aimed beam' : 'exact authority airburst'}`, panel.x + 7, panel.y + 18, COLOR.ink, 1);
  drawButton(app, `strike_auto_${tower.id}`, '0 auto', panel.x + width - 82, panel.y + 27, 40, Boolean(tower.strikePoint), COLOR.amber, clearSelectedStrikePoint.bind(null, app));
  drawButton(app, `strike_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
  });
}

export function drawControlGeometryMenu(app, snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const width = 216;
  const height = 43;
  const panel = towerPanelPosition(app, tower, width, height);
  drawTechPanel(app, panel.x, panel.y, width, height, COLOR.cyan);
  const input = definition?.control?.input || 'point';
  const verb = input === 'line' ? (definition?.id === 'braid' ? 'drag along flow' : 'drag line') : input === 'direction' ? (definition.control.type === 'aim' ? 'set facing' : 'choose left / right') : 'place field';
  const rebootTicks = Math.max(0, (tower.controlReadyTick || 0) - snapshot.runTick);
  app.renderer.bitmapText.draw(`${definition?.label || 'control'} // ${verb}`, panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  app.renderer.bitmapText.draw(rebootTicks > 0 ? `reboot // ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : `${tower.effectiveRange || definition?.range || 0}u // authority locked`, panel.x + 7, panel.y + 18, rebootTicks > 0 ? COLOR.amber : COLOR.ink, 1);
  drawButton(app, `control_reset_${tower.id}`, '0 reset', panel.x + width - 88, panel.y + 27, 46, true, COLOR.amber, resetSelectedControlGeometry.bind(null, app));
  drawButton(app, `control_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
  });
}

export function drawTowerMenu(app, snapshot, tower) {
  if (app.ui.towerMenuMode === 'research') return;
  if (app.ui.towerMenuMode === 'upgrades') drawTowerUpgradeMenu(app, snapshot, tower);
  else if (app.ui.towerMenuMode === 'relay') drawRelayTargetMenu(app, snapshot, tower);
  else if (app.ui.towerMenuMode === 'strike') drawStrikeTargetMenu(app, snapshot, tower);
  else if (app.ui.towerMenuMode === 'control') drawControlGeometryMenu(app, snapshot, tower);
  else drawTowerActionMenu(app, snapshot, tower);
}
