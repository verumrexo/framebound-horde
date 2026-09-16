import { viewport } from '../app/camera.js';
import { beginHostingCoop, beginJoiningCoop, cancelMultiplayer, copyRoomCode, openJoinCoop, retryMultiplayer } from '../app/multiplayer.js';
import { VOLUME_CHANNELS, adjustRunPace, closeMainOptions, getVolume, openMainOptions, volumeLabel, closeEscapeOptions, closeMapSelection, deploySelectedMap, enterTestField, hostilePaletteLabel, openCoopMapSelection, openEscapeOptions, openMapSelection, openNewSoloRun, resumeSession, returnToMainMenu, selectRunMap, selectedRandomRifts, selectedRunPace, startOrContinueGame, toggleAutoSelectPlacedFrame, toggleHostilePalette, toggleRandomRifts } from '../app/navigation.js';
import { playerColor } from '../app/social.js';
import { resetTestFieldFromMenu } from '../app/test-field.js';
import { compactMetric } from '../core/format.js';
import { SIGNALING_URL } from '../core/p2p-transport.js';
import { DEFAULT_PACE, PACE_MAX, PACE_MIN, PACE_STEP, normalizePace } from '../core/progression.js';
import { AUTHORITY_TICK_RATE, COMMAND } from '../core/protocol.js';
import { playableMaps } from '../core/world-config.js';
import { drawMapThumbnail } from '../render/map-thumbnail.js';
import { COLOR } from './palette.js';
import { registerHitbox } from '../app/ui-state.js';
import { MENU_HEADER, coopMenuLayout, escapeMenuLayout, mainMenuLayout, mapSelectionLayout, optionsLayout } from './panel-layout.js';
import { clippedUiText, drawButton, drawMenuButton, drawMenuHeader, drawTechPanel, drawTierDivider } from './widgets.js';

export function mainMenuRunLabel(app, snapshot) {
  if (app.game.gameRestorePending) return 'checking local save // hold on';
  if (snapshot.phase === 'running') {
    const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
    return `${snapshot.mapLabel} // ${seconds}s // ${snapshot.base.lives} lives`;
  }
  if (snapshot.phase === 'defeated') return `${snapshot.mapLabel} // base lost`;
  return 'fresh signal // choose a map';
}

export function drawMainMenu(app, snapshot) {
  const layout = mainMenuLayout(viewport(app));
  const { x, y, width, buttonX, buttonWidth, rows } = layout;
  drawTechPanel(app, x, y, width, layout.height, COLOR.mint);
  drawMenuHeader(app, layout, [['framebound', COLOR.mint], ['// horde', COLOR.red]], COLOR.mint, 'survival telemetry // mechanical void', COLOR.dimMint);
  app.renderer.shapes.rect(x + 17, y + MENU_HEADER.runLabelY, 1, 7, app.game.gameRestorePending ? COLOR.amber : COLOR.cyan);
  app.renderer.bitmapText.draw(mainMenuRunLabel(app, snapshot), x + 21, y + MENU_HEADER.runLabelY, app.game.gameRestorePending ? COLOR.amber : COLOR.cyan, 1);
  if (app.game.gameHasEnteredGameplay && snapshot.phase === 'running') {
    app.renderer.bitmapText.draw('warning // the horde is still live', x + 21, y + MENU_HEADER.noteY, COLOR.red, 1);
  } else {
    app.renderer.bitmapText.draw('solo survival // difficulty climbs', x + 21, y + MENU_HEADER.noteY, COLOR.dimMint, 1);
  }

  const networkBundle = app.game.sessions.get('game');
  const networkActive = Boolean(networkBundle?.networkRole);
  const primaryLabel = snapshot.phase === 'running' ? 'continue run' : networkActive ? 'coop // room status' : snapshot.phase === 'defeated' ? 'choose map // retry' : 'solo // choose map';
  drawMenuButton(app, 'menu_continue', primaryLabel, buttonX, y + rows.primary, buttonWidth, COLOR.mint, startOrContinueGame.bind(null, app), true);
  drawMenuButton(app, 'menu_restart', 'new solo run // choose map', buttonX, y + rows.secondary, buttonWidth, COLOR.amber, openNewSoloRun.bind(null, app));
  drawTierDivider(app, buttonX, y + rows.divider, buttonWidth, networkActive ? COLOR.green : COLOR.dimMint);
  const gap = 6;
  const halfWidth = Math.floor((buttonWidth - gap) * 0.5);
  drawMenuButton(app,
    'menu_coop_host',
    networkActive ? `coop ${app.multiplayer.roomCode?.toLowerCase() || 'status'}` : 'h host coop',
    buttonX,
    y + rows.coop,
    halfWidth,
    COLOR.green,
    networkActive ? () => { app.ui.frontEndScreen = 'coop'; } : beginHostingCoop.bind(null, app)
  );
  drawMenuButton(app,
    'menu_coop_join',
    networkActive ? 'leave coop' : 'j join code',
    buttonX + halfWidth + gap,
    y + rows.coop,
    buttonWidth - halfWidth - gap,
    networkActive ? COLOR.red : COLOR.cyan,
    networkActive ? () => cancelMultiplayer(app, true) : openJoinCoop.bind(null, app)
  );
  drawMenuButton(app, 'menu_test', 'test field // t', buttonX, y + rows.test, halfWidth, COLOR.cyan, enterTestField.bind(null, app));
  drawMenuButton(app, 'menu_options', 'o options', buttonX + halfWidth + gap, y + rows.test, buttonWidth - halfWidth - gap, COLOR.cyan, openMainOptions.bind(null, app));
  app.renderer.bitmapText.draw(networkActive ? 'p2p session active' : 'coop // 2-4 pilots // p2p beta', x + 17, y + rows.footer, networkActive ? COLOR.green : COLOR.dimMint, 1);
  app.renderer.bitmapText.draw('enter selects', x + width - 85, y + rows.footer, COLOR.ink, 1);
}

// Volume rows: label, draggable pixel slider, readout. Drags resolve in input.js.
export const VOLUME_ROW_HEIGHT = 16;

export function drawVolumeSliders(app, x, y, width) {
  const labelWidth = 44;
  const readoutWidth = 30;
  const sliderX = x + labelWidth;
  const sliderWidth = Math.max(60, width - labelWidth - readoutWidth);
  VOLUME_CHANNELS.forEach((channel, index) => {
    const rowY = y + index * VOLUME_ROW_HEIGHT;
    const value = getVolume(app, channel.id);
    const fraction = Number.isFinite(value) ? value : 0;
    const hovered = app.ui.uiDrag?.kind === 'volume' && app.ui.uiDrag.channel === channel.id;
    app.renderer.bitmapText.draw(channel.label, x, rowY + 4, COLOR.ink, 1);
    app.renderer.shapes.rect(sliderX, rowY + 6, sliderWidth, 3, COLOR.dimMint);
    app.renderer.shapes.rect(sliderX, rowY + 6, Math.max(0, Math.round(sliderWidth * fraction)), 3, hovered ? COLOR.cyan : COLOR.mint);
    const knobX = Math.round(sliderX + (sliderWidth - 1) * fraction);
    app.renderer.shapes.rect(knobX - 2, rowY + 3, 5, 9, hovered ? COLOR.cyan : COLOR.amber);
    app.renderer.bitmapText.draw(volumeLabel(value), sliderX + sliderWidth + 6, rowY + 4, value === 0 ? COLOR.red : COLOR.cyan, 1);
    registerHitbox(app, `volume_${channel.id}`, sliderX - 3, rowY, sliderWidth + 6, VOLUME_ROW_HEIGHT - 1, { drag: { kind: 'volume', channel: channel.id, sliderX, sliderWidth } });
  });
  return y + VOLUME_CHANNELS.length * VOLUME_ROW_HEIGHT;
}

export function drawOptionsScreen(app) {
  const layout = optionsLayout(viewport(app));
  const { x, y, width, height, buttonX, buttonWidth } = layout;
  app.ui.uiHitboxes.length = 0;
  drawTechPanel(app, x, y, width, height, COLOR.cyan);
  drawMenuHeader(app, layout, 'options', COLOR.cyan, 'audio // saved on this browser', COLOR.dimMint);
  app.renderer.bitmapText.draw('volume // drag the sliders', x + 18, y + 46, COLOR.ink, 1);
  const end = drawVolumeSliders(app, x + 18, y + 60, buttonWidth - 2);
  app.renderer.bitmapText.draw(clippedUiText('music // menu + gameplay tracks // sfx // part lab', width - 36), x + 18, end + 6, COLOR.dimMint, 1);
  drawMenuButton(app, 'options_back', 'back // esc', buttonX, y + height - 29, buttonWidth, COLOR.cyan, closeMainOptions.bind(null, app), true);
}

export function drawPlayerNameEditor(app, x, y, width) {
  const label = app.multiplayer.editingName
    ? `name ${app.multiplayer.playerName}_`
    : `name ${app.multiplayer.playerName} // edit`;
  drawButton(app, 'coop_player_name', label, x, y, width, app.multiplayer.editingName, COLOR.cyan, () => {
    app.multiplayer.editingName = true;
  }, 15);
}

export function drawCoopRoster(app, snapshot, x, y, width) {
  const players = (snapshot.players || []).slice(0, 4);
  for (let index = 0; index < Math.min(4, players.length); index += 1) {
    const player = players[index];
    const role = player.id === snapshot.hostPlayerId ? 'host' : player.spectator ? 'spectator' : 'peer';
    const state = player.connectionState === 'reconnecting' ? 'reconnect' : player.connectionState === 'departed' ? 'departed' : player.connected ? 'linked' : 'offline';
    const local = player.id === app.game.session.playerId ? ' // you' : '';
    const label = `${index + 1} ${player.label} // ${role} // ${state}${local}`;
    app.renderer.shapes.rect(x, y + index * 10 + 3, 4, 4, playerColor(app, player));
    app.renderer.bitmapText.draw(clippedUiText(label, width - 8), x + 8, y + index * 10, player.connected ? playerColor(app, player) : COLOR.red, 1);
  }
}

export function drawCoopMenu(app, snapshot) {
  const layout = coopMenuLayout(viewport(app));
  const { x, y, width, height, buttonX, buttonWidth } = layout;
  const accent = app.multiplayer.phase === 'error' ? COLOR.red : app.multiplayer.role === 'host' ? COLOR.green : COLOR.cyan;
  drawTechPanel(app, x, y, width, height, accent);
  drawMenuHeader(app, layout, 'coop // direct peer link', accent, 'six-character signaling // gameplay stays p2p', COLOR.dimMint, accent);
  app.renderer.shapes.rect(x + 17, y + 46, 1, 7, app.multiplayer.phase === 'error' ? COLOR.red : accent);
  app.renderer.bitmapText.draw(clippedUiText(app.multiplayer.status, width - 38), x + 21, y + 46, app.multiplayer.phase === 'error' ? COLOR.red : COLOR.ink, 1);

  if (app.multiplayer.phase === 'join_entry') {
    const code = app.multiplayer.codeInput.padEnd(6, '_').toLowerCase();
    const boxWidth = 28;
    const totalWidth = boxWidth * 6 + 5 * 4;
    const codeX = Math.round(x + (width - totalWidth) * 0.5);
    for (let index = 0; index < 6; index += 1) {
      const boxX = codeX + index * (boxWidth + 4);
      app.renderer.shapes.rect(boxX, y + 62, boxWidth, 26, COLOR.black);
      app.renderer.shapes.rect(boxX, y + 62, boxWidth, 1, index < app.multiplayer.codeInput.length ? COLOR.cyan : COLOR.dimMint);
      app.renderer.shapes.rect(boxX, y + 87, boxWidth, 1, index < app.multiplayer.codeInput.length ? COLOR.cyan : COLOR.dimMint);
      app.renderer.bitmapText.draw(code[index], boxX + 8, y + 68, index < app.multiplayer.codeInput.length ? COLOR.mint : COLOR.dimMint, 2);
    }
    drawMenuButton(app, 'coop_join_submit', 'join room // enter', buttonX, y + 101, buttonWidth, COLOR.mint, beginJoiningCoop.bind(null, app), app.multiplayer.codeInput.length === 6);
    drawMenuButton(app, 'coop_join_back', 'back // esc', buttonX, y + 122, buttonWidth, COLOR.cyan, () => cancelMultiplayer(app, true));
    app.renderer.bitmapText.draw('type or paste the code your host sends', x + 18, y + 148, COLOR.ink, 1);
    app.renderer.bitmapText.draw('signaling may need a few seconds to wake', x + 18, y + 160, COLOR.dimMint, 1);
    drawPlayerNameEditor(app, x + width - 160, y + 176, 142);
    return;
  }

  if (app.multiplayer.phase === 'connecting') {
    const code = app.multiplayer.roomCode || app.multiplayer.codeInput;
    if (code) app.renderer.bitmapText.draw(`room ${code.toLowerCase()}`, x + 18, y + 67, COLOR.amber, 2);
    app.renderer.bitmapText.draw('opening encrypted webrtc data channel', x + 18, y + 94, COLOR.ink, 1);
    app.renderer.bitmapText.draw('the relay carries connection metadata only', x + 18, y + 106, COLOR.dimMint, 1);
    drawMenuButton(app, 'coop_connect_cancel', 'cancel // esc', buttonX, y + 130, buttonWidth, COLOR.red, () => cancelMultiplayer(app, true));
    return;
  }

  if (app.multiplayer.phase === 'error') {
    app.renderer.bitmapText.draw(clippedUiText(app.multiplayer.detail, width - 36), x + 18, y + 65, COLOR.red, 1);
    drawMenuButton(app, 'coop_retry', 'retry connection', buttonX, y + 91, buttonWidth, COLOR.amber, retryMultiplayer.bind(null, app));
    drawMenuButton(app, 'coop_error_back', 'back to main', buttonX, y + 112, buttonWidth, COLOR.cyan, () => cancelMultiplayer(app, true));
    app.renderer.bitmapText.draw('restrictive nat may require a future turn fallback', x + 18, y + 140, COLOR.dimMint, 1);
    return;
  }

  const roomCode = app.multiplayer.roomCode || app.multiplayer.codeInput;
  if (roomCode) app.renderer.bitmapText.draw(`room ${roomCode.toLowerCase()}`, x + 18, y + 61, COLOR.amber, 2);
  drawPlayerNameEditor(app, x + width - 160, y + 66, 142);
  drawCoopRoster(app, snapshot, x + 18, y + 88, width - 36);
  if (snapshot.phase !== 'lobby') {
    drawMenuButton(app, 'coop_resume', snapshot.phase === 'defeated' ? 'view ended run' : 'return to run', buttonX, y + 132, buttonWidth, COLOR.mint, resumeSession.bind(null, app), true);
  } else if (app.multiplayer.role === 'host') {
    const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
    const half = Math.floor((buttonWidth - 6) * 0.5);
    drawMenuButton(app, 'coop_copy', 'copy room code', buttonX, y + 132, half, COLOR.cyan, copyRoomCode.bind(null, app));
    drawMenuButton(app, 'coop_deploy', connected >= 2 ? 'choose map' : 'need 2 pilots', buttonX + half + 6, y + 132, buttonWidth - half - 6, connected >= 2 ? COLOR.mint : COLOR.red, openCoopMapSelection.bind(null, app), connected >= 2);
  } else {
    app.renderer.bitmapText.draw('host chooses the map and starts the run', x + 18, y + 136, COLOR.mint, 1);
  }
  drawMenuButton(app, 'coop_leave', 'leave coop // esc', buttonX, y + 158, buttonWidth, COLOR.red, () => cancelMultiplayer(app, true));
  app.renderer.bitmapText.draw(SIGNALING_URL.includes('framebound-signaling') ? 'public signal relay online // direct data after handshake' : 'custom signal relay', x + 18, y + 181, COLOR.dimMint, 1);
}

export function drawMapSelection(app, snapshot) {
  const maps = playableMaps();
  const layout = mapSelectionLayout(viewport(app), maps.length);
  const { x, y, width, height, rowHeight: mapRowHeight, rowTop: mapRowTop, listWidth } = layout;
  drawTechPanel(app, x, y, width, height, COLOR.amber);
  app.renderer.bitmapText.draw('select survival field', x + 16, y + 9, COLOR.amber, 2);
  const runIsLive = app.game.gameHasEnteredGameplay && snapshot.phase === 'running';
  const warning = runIsLive
    ? 'live run keeps moving // deployment wipes it'
    : snapshot.phase === 'running' ? 'saved run held // deployment wipes it' : 'choose a flow // fresh seed per run';
  app.renderer.bitmapText.draw(warning, x + 16, y + 27, snapshot.phase === 'running' ? COLOR.red : COLOR.dimMint, 1);

  maps.forEach((map,index) => {
    const selected=map.id===app.ui.selectedRunMapId;
    drawMenuButton(app, `map_${map.id}`,`${index+1} ${map.label}`,layout.listX,y+mapRowTop+index*mapRowHeight,listWidth,selected?COLOR.mint:COLOR.cyan,()=>selectRunMap(app, map.id),selected);
  });
  const selected=maps.find((map)=>map.id===app.ui.selectedRunMapId);
  if (layout.thumbnail && selected) {
    const thumb = layout.thumbnail;
    drawMapThumbnail(app.renderer.shapes, COLOR, selected, thumb.x, thumb.y, thumb.width, thumb.height, COLOR.mint, { riftColor: selectedRandomRifts(app) ? COLOR.amber : COLOR.red });
  }
  if(layout.descriptionY < height - 78) app.renderer.bitmapText.draw(selected?.menuLines[1] || '',x+16,y+layout.descriptionY,COLOR.ink,1);
  // horde pace row: [-] pace x1.0 [+], with a small tick bar across the allowed range
  const pace = selectedRunPace(app);
  const paceY = layout.paceY;
  const paceButton = 18;
  drawMenuButton(app, 'pace_down', '-', x + 16, paceY, paceButton, pace > PACE_MIN ? COLOR.cyan : COLOR.dimMint, () => adjustRunPace(app, -1), false);
  drawMenuButton(app, 'pace_up', '+', x + 16 + paceButton + 4 + 92 + 4, paceY, paceButton, pace < PACE_MAX ? COLOR.cyan : COLOR.dimMint, () => adjustRunPace(app, 1), false);
  const paceColor = pace === DEFAULT_PACE ? COLOR.mint : pace < DEFAULT_PACE ? COLOR.cyan : COLOR.amber;
  app.renderer.bitmapText.draw(`pace x${pace.toFixed(1)}`, x + 16 + paceButton + 8, paceY + 4, paceColor, 1);
  const barX = x + 16 + paceButton * 2 + 108;
  const barWidth = Math.max(40, width - (barX - x) - 16);
  const steps = Math.round((PACE_MAX - PACE_MIN) / PACE_STEP);
  for (let step = 0; step <= steps; step += 1) {
    const stepPace = normalizePace(PACE_MIN + step * PACE_STEP);
    const tickX = barX + Math.round(step / steps * (barWidth - 3));
    const on = stepPace <= pace + 1e-9;
    app.renderer.shapes.rect(tickX, paceY + (stepPace === DEFAULT_PACE ? 2 : 5), 3, stepPace === DEFAULT_PACE ? 12 : 6, on ? paceColor : COLOR.dimMint);
  }
  app.renderer.bitmapText.draw(pace < DEFAULT_PACE ? 'slower horde' : pace > DEFAULT_PACE ? 'faster horde' : 'designed pace', barX, paceY + 14, COLOR.dimMint, 1);

  const buttonY = layout.buttonY;
  const backWidth = 76;
  // Rift layout toggle: authored entries or a seeded shuffle of positions and unlock order.
  const shuffled = selectedRandomRifts(app);
  const riftWidth = width >= 400 ? 112 : 58;
  const riftLabel = width >= 400 ? (shuffled ? 'x rifts shuffled' : 'x rifts authored') : (shuffled ? 'x shuf' : 'x auth');
  drawMenuButton(app, 'map_rifts', riftLabel, x + 16 + backWidth + 6, buttonY, riftWidth, shuffled ? COLOR.amber : COLOR.cyan, toggleRandomRifts.bind(null, app), shuffled);
  const deployX = x + 16 + backWidth + 6 + riftWidth + 6;
  const deployLabel = app.ui.menuConfirm === 'map_deploy' ? 'confirm wipe // deploy' : `deploy ${app.ui.selectedRunMapId.replace('map_', 'map ')}`;
  drawMenuButton(app, 'map_back', 'back // esc', x + 16, buttonY, backWidth, COLOR.cyan, closeMapSelection.bind(null, app));
  drawMenuButton(app,
    'map_deploy',
    deployLabel,
    deployX,
    buttonY,
    x + width - 16 - deployX,
    app.ui.menuConfirm === 'map_deploy' ? COLOR.red : COLOR.mint,
    deploySelectedMap.bind(null, app),
    true
  );
  app.renderer.bitmapText.draw(clippedUiText(`1-${maps.length} select // [ ] pace // x rifts // enter deploys`, width - 34), x + 17, y + height - 16, COLOR.ink, 1);
}

export function drawDevTools(app, snapshot) {
  app.ui.uiHitboxes.length = 0;
  const width = Math.min(300, app.viewport.logicalWidth - 20), height = 228;
  const x = (app.viewport.logicalWidth - width) / 2, y = (app.viewport.logicalHeight - height) / 2;
  const host = app.game.session.playerId === snapshot.hostPlayerId;
  drawTechPanel(app, x, y, width, height, COLOR.amber);
  app.renderer.bitmapText.draw('dev tools // f2', x + 12, y + 10, COLOR.amber, 1);
  app.renderer.bitmapText.draw(host ? 'changes apply to this run' : 'host controls // inspect only', x + 12, y + 25, COLOR.ink, 1);
  const options = [['infiniteMoney', 'infinite money'], ['infiniteHealth', 'infinite base health'], ['paused', 'pause simulation'], ['stopSpawns', 'stop new spawns']];
  options.forEach(([option, label], index) => {
    const enabled = Boolean(snapshot.dev?.[option]);
    drawMenuButton(app, `dev_${option}`, `${enabled ? '[on]' : '[off]'} ${label}`, x + 12, y + 42 + index * 22, width - 24,
      enabled ? COLOR.amber : COLOR.ink, () => { if (host) app.game.session.send(COMMAND.DEV_TOOLS, { option, enabled: !enabled }); }, enabled);
  });
  drawMenuButton(app, 'dev_clear', 'clear enemies // no rewards', x + 12, y + 134, width - 24, COLOR.red,
    () => { if (host) app.game.session.send(COMMAND.DEV_TOOLS, { action: 'clearEnemies' }); });
  drawMenuButton(app, 'dev_heal', 'heal base / revive', x + 12, y + 156, width - 24, COLOR.mint,
    () => { if (host) app.game.session.send(COMMAND.DEV_TOOLS, { action: 'healBase' }); });
  drawMenuButton(app, 'dev_part_lab', 'part lab // f3 // art + sounds', x + 12, y + 178, width - 24, COLOR.mint,
    () => { void app.openPartLab?.().then((lab) => lab.open()); });
  drawMenuButton(app, 'dev_close', 'close // f2 or esc', x + 12, y + 200, width - 24, COLOR.cyan, () => { app.ui.devToolsOpen = false; });
}

export function drawEscapeMenu(app, snapshot) {
  const networkActive = Boolean(app.game.session.networkRole);
  const layout = escapeMenuLayout(viewport(app), { page: app.ui.escapeMenuPage, networkActive });
  const { x, y, width, height, buttonX, buttonWidth } = layout;
  drawTechPanel(app, x, y, width, height, COLOR.cyan);

  if (app.ui.escapeMenuPage === 'help') {
    drawMenuHeader(app, layout, 'field guide', COLOR.cyan, 'operational reference // local only', COLOR.dimMint);
    const rows = [
      hostilePaletteLabel(app, 'hp'),
      'build in nebulae. each hp pays 1 credit.',
      'upgrades replace a tower permanently.',
      app.game.sessionMode === 'test' ? 'b place support // drag towers to move' : '1 place frame // click tower to manage',
      app.game.sessionMode === 'test' ? 'u catalog // space pause // . step' : 'b build catalog // tab next page',
      'q / e targeting // a aim or control',
      'drag empty space to pan // wheel zoom',
      'right click cancels // g shows ranges',
      'k kill rate // t test field // ? help',
      'solo autosaves on this browser.',
      'menus and test field do not pause solo.'
    ];
    const lineHeight = Math.min(14, Math.floor((height - 78) / rows.length));
    rows.forEach((line, i) => app.renderer.bitmapText.draw(line, x + 18, y + 46 + i * lineHeight, i === 10 ? COLOR.red : COLOR.ink, 1));
    drawMenuButton(app, 'help_back', 'back // esc', buttonX, y + height - 29, buttonWidth, COLOR.cyan, closeEscapeOptions.bind(null, app), true);
    return;
  }

  if (app.ui.escapeMenuPage === 'options') {
    drawMenuHeader(app, layout, 'gameplay options', COLOR.cyan, 'local controls // run still live', COLOR.red);
    app.renderer.bitmapText.draw('placement flow', x + 18, y + 46, COLOR.ink, 1);
    drawMenuButton(app,
      'option_auto_select_frame',
      `1 auto-select frame // ${app.preferences.autoSelectPlacedFrame ? 'on' : 'off'}`,
      buttonX,
      y + 58,
      buttonWidth,
      app.preferences.autoSelectPlacedFrame ? COLOR.mint : COLOR.amber,
      toggleAutoSelectPlacedFrame.bind(null, app),
      app.preferences.autoSelectPlacedFrame
    );
    app.renderer.bitmapText.draw('1 place > selected > 1 > 1 assault', x + 18, y + 80, COLOR.dimMint, 1);
    drawTierDivider(app, buttonX, y + 92, buttonWidth);
    app.renderer.bitmapText.draw('hostile colours', x + 18, y + 98, COLOR.ink, 1);
    drawMenuButton(app,
      'option_hostile_palette',
      `2 hostile palette // ${app.preferences.hostilePalette === 'magenta' ? 'magenta' : 'mixed'}`,
      buttonX,
      y + 110,
      buttonWidth,
      app.preferences.hostilePalette === 'magenta' ? COLOR.amber : COLOR.mint,
      toggleHostilePalette.bind(null, app),
      app.preferences.hostilePalette === 'magenta'
    );
    app.renderer.bitmapText.draw(app.preferences.hostilePalette === 'magenta' ? 'magenta ramp keeps hostiles apart from green' : 'mixed hp colours // dark cores mark hostiles', x + 18, y + 132, COLOR.dimMint, 1);
    drawTierDivider(app, buttonX, y + 144, buttonWidth);
    app.renderer.bitmapText.draw('audio // drag the sliders', x + 18, y + 150, COLOR.ink, 1);
    drawVolumeSliders(app, x + 18, y + 162, buttonWidth - 2);
    drawMenuButton(app, 'options_back', 'back // esc', buttonX, y + height - 29, buttonWidth, COLOR.cyan, closeEscapeOptions.bind(null, app), true);
    app.renderer.bitmapText.draw('saved on this browser', x + 18, y + height - 10, COLOR.ink, 1);
    return;
  }

  const { compact, rowY, runTierWidth } = layout;
  const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
  const runLabel = networkActive ? `coop ${app.multiplayer.roomCode?.toLowerCase() || 'link'}` : app.game.sessionMode;
  if (compact) {
    app.renderer.bitmapText.draw('command interrupt', x + 18, y + 10, COLOR.cyan, 2);
    app.renderer.bitmapText.draw('simulation is not paused', x + 18, y + 31, COLOR.red, 1);
  } else {
    drawMenuHeader(app, layout, 'command interrupt', COLOR.cyan, 'simulation is not paused', COLOR.red);
    app.renderer.shapes.rect(x + 17, y + MENU_HEADER.runLabelY, 1, 7, COLOR.cyan);
    const runState = `${networkActive ? `${runLabel} // ${seconds}s` : `${seconds}s // ${compactMetric(snapshot.swarm.activeEnemies)} hostiles`}${snapshot.randomRifts ? ' // shuffled' : ''}`;
    app.renderer.bitmapText.draw(clippedUiText(runState, runTierWidth - 4), x + 21, y + MENU_HEADER.runLabelY, COLOR.ink, 1);
    if (layout.thumbnail && app.game.currentMap.playable) {
      const thumb = layout.thumbnail;
      drawMapThumbnail(app.renderer.shapes, COLOR, app.game.currentMap, thumb.x, thumb.y, thumb.width, thumb.height, COLOR.dimMint);
    }
  }
  drawMenuButton(app, 'escape_resume', 'resume // esc', buttonX, rowY(0), runTierWidth, COLOR.mint, resumeSession.bind(null, app), true);
  if (networkActive) {
    drawMenuButton(app,
      'escape_coop_status',
      `coop status // ${app.multiplayer.roomCode?.toLowerCase() || 'linked'}`,
      buttonX,
      rowY(1),
      runTierWidth,
      COLOR.green,
      () => { app.ui.frontEndScreen = 'coop'; },
      true
    );
  } else if (app.game.sessionMode === 'game') {
    drawMenuButton(app, 'escape_restart', 'new run // choose map', buttonX, rowY(1), runTierWidth, COLOR.amber, () => openMapSelection(app, 'escape'));
  } else {
    drawMenuButton(app, 'escape_test_reset', 'clear test field', buttonX, rowY(1), runTierWidth, COLOR.amber, resetTestFieldFromMenu.bind(null, app));
  }
  if (layout.dividerY !== null) drawTierDivider(app, buttonX, layout.dividerY, buttonWidth, networkActive ? COLOR.green : COLOR.dimMint);
  drawMenuButton(app, 'escape_options', 'gameplay options', buttonX, rowY(2), buttonWidth, COLOR.cyan, openEscapeOptions.bind(null, app));
  drawMenuButton(app, 'escape_help', 'field guide // ?', buttonX, rowY(3), buttonWidth, COLOR.green, () => { app.ui.escapeMenuPage = 'help'; });
  drawMenuButton(app, 'escape_main', 'main menu', buttonX, rowY(4), buttonWidth, COLOR.cyan, returnToMainMenu.bind(null, app));
  if (networkActive) {
    drawMenuButton(app, 'escape_leave_coop', 'leave coop', buttonX, rowY(5), buttonWidth, COLOR.red, () => cancelMultiplayer(app, true));
    app.renderer.bitmapText.draw('leaving marks your seat departed', x + 18, y + height - 14, COLOR.dimMint, 1);
  } else {
    app.renderer.bitmapText.draw('no pause means no cheese. sorry.', x + 18, y + height - 14, COLOR.dimMint, 1);
  }
}
