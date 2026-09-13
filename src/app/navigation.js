import { cancelMultiplayer, updateMultiplayerStatus } from './multiplayer.js';
import { saveGameplayPreferences } from './preferences.js';
import { activateSession } from './sessions.js';
import { clearTransientUi, setStatus } from './ui-state.js';
import { DEFAULT_PACE, PACE_STEP, normalizePace } from '../core/progression.js';
import { COMMAND } from '../core/protocol.js';
import { playableMaps } from '../core/world-config.js';

export function startOrContinueGame(app) {
  if (app.game.gameRestorePending) {
    setStatus(app, 'loading autosave');
    return;
  }
  if (app.game.sessionMode !== 'game') activateSession(app, 'game');
  if (app.game.session.networkRole && app.game.sessionSnapshot.phase !== 'running') {
    app.ui.frontEndScreen = 'coop';
    setStatus(app, app.multiplayer.role === 'host' ? 'coop lobby // share the code' : 'coop lobby // waiting for host');
    return;
  }
  if (app.game.sessionSnapshot.phase !== 'running') {
    openMapSelection(app, 'main');
    return;
  }
  app.game.gameHasEnteredGameplay = true;
  app.ui.frontEndScreen = 'game';
  app.ui.menuConfirm = null;
  clearTransientUi(app);
  setStatus(app, 'run resumed // no pause');
}

export function openNewSoloRun(app) {
  if (app.game.sessions.get('game')?.networkRole) cancelMultiplayer(app, false);
  openMapSelection(app, 'main');
}

export function openMapSelection(app, origin = app.ui.frontEndScreen) {
  if (app.game.gameRestorePending) {
    setStatus(app, 'loading autosave');
    return;
  }
  if (app.game.sessionMode !== 'game') activateSession(app, 'game');
  clearTransientUi(app);
  app.ui.selectedRunMapId = app.game.sessionSnapshot.mapId;
  app.ui.mapSelectOrigin = ['escape', 'coop'].includes(origin) ? origin : 'main';
  app.ui.menuConfirm = null;
  app.ui.frontEndScreen = 'map_select';
  setStatus(app, 'choose the field // horde does not pause');
}

export function closeMapSelection(app) {
  app.ui.menuConfirm = null;
  app.ui.frontEndScreen = app.ui.mapSelectOrigin === 'escape' ? 'escape' : app.ui.mapSelectOrigin === 'coop' ? 'coop' : 'main';
  setStatus(app, app.ui.frontEndScreen === 'escape' ? 'menu open // horde still live' : app.ui.frontEndScreen === 'coop' ? 'coop lobby' : 'main menu');
}

export function openCoopMapSelection(app) {
  const connected = app.game.sessionSnapshot.players.filter((player) => player.connected && !player.spectator).length;
  if (app.multiplayer.role !== 'host') return setStatus(app, 'only the host can deploy');
  if (connected < 2) return updateMultiplayerStatus(app, 'host_lobby', 'need another pilot before deployment');
  openMapSelection(app, 'coop');
}

// Horde pace for the next deployment: a time stretch on the threat clock.

export function selectedRunPace(app) {
  return normalizePace(app.preferences.pace ?? DEFAULT_PACE);
}

export function selectedRandomRifts(app) {
  return Boolean(app.preferences.randomRifts);
}

export function toggleRandomRifts(app) {
  app.preferences.randomRifts = !selectedRandomRifts(app);
  saveGameplayPreferences(app);
  app.ui.menuConfirm = null;
  setStatus(app, app.preferences.randomRifts ? 'rifts shuffled // seeded per run' : 'rifts authored // fixed layout');
}

export function adjustRunPace(app, direction) {
  const next = normalizePace(selectedRunPace(app) + direction * PACE_STEP);
  if (next === selectedRunPace(app)) return;
  app.preferences.pace = next;
  saveGameplayPreferences(app);
  app.ui.menuConfirm = null;
  setStatus(app, `horde pace x${next.toFixed(1)} // ${next < 1 ? 'slower curve, later surges' : next > 1 ? 'faster curve, earlier surges' : 'designed pace'}`);
}

export function selectRunMap(app, mapId) {
  const map = playableMaps().find((candidate) => candidate.id === mapId);
  if (!map) return;
  app.ui.selectedRunMapId = map.id;
  app.ui.menuConfirm = null;
  setStatus(app, `${map.label} selected`);
}

export function deploySelectedMap(app) {
  if (app.game.gameRestorePending) {
    setStatus(app, 'loading autosave');
    return;
  }
  const map = playableMaps().find((candidate) => candidate.id === app.ui.selectedRunMapId);
  if (!map) {
    setStatus(app, 'select a map');
    return;
  }
  const networkBundle = app.game.sessions.get('game');
  if (networkBundle?.networkRole === 'guest') {
    setStatus(app, 'only the host can deploy');
    return;
  }
  if (networkBundle?.networkRole === 'host' && app.game.sessionSnapshot.phase !== 'lobby') {
    setStatus(app, 'multiplayer restart voting comes later');
    return;
  }
  if (app.game.sessionSnapshot.phase === 'running' && app.ui.menuConfirm !== 'map_deploy') {
    app.ui.menuConfirm = 'map_deploy';
    setStatus(app, 'deploy again // wipes the live run');
    return;
  }
  const pace = selectedRunPace(app);
  const randomRifts = selectedRandomRifts(app);
  if (app.game.sessionSnapshot.phase === 'lobby') app.game.session.send(COMMAND.SESSION_START, { mapId: map.id, pace, randomRifts });
  else app.game.session.send(COMMAND.SESSION_RESTART, { mapId: map.id, pace, randomRifts });
  app.game.gameHasEnteredGameplay = true;
  app.ui.frontEndScreen = 'game';
  app.ui.menuConfirm = null;
  clearTransientUi(app);
  setStatus(app, `${map.label} // pace x${pace.toFixed(1)} // deploying`);
}

export function openEscapeMenu(app) {
  clearTransientUi(app);
  app.ui.menuConfirm = null;
  app.ui.escapeMenuPage = 'main';
  app.ui.frontEndScreen = 'escape';
  setStatus(app, 'menu open // horde still live');
}

export function resumeSession(app) {
  app.ui.frontEndScreen = 'game';
  app.ui.menuConfirm = null;
  app.ui.escapeMenuPage = 'main';
  setStatus(app, 'back in // horde never stopped');
}

export function openEscapeOptions(app) {
  app.ui.menuConfirm = null;
  app.ui.escapeMenuPage = 'options';
  setStatus(app, 'gameplay options // local only');
}

export function closeEscapeOptions(app) {
  app.ui.escapeMenuPage = 'main';
  setStatus(app, 'menu open // horde still live');
}

// Colour-vision fallback: hostiles swap to a magenta-led ramp that stays apart from
// system green. Presentation only; hp values, statuses and packets are unchanged.

export function toggleHostilePalette(app) {
  app.preferences.hostilePalette = app.preferences.hostilePalette === 'magenta' ? 'red' : 'magenta';
  saveGameplayPreferences(app);
  setStatus(app, `hostile palette ${app.preferences.hostilePalette}`);
}

export function hostilePaletteLabel(app, prefix) {
  return app.preferences.hostilePalette === 'magenta'
    ? `${prefix}: magenta 1 / pink 2 / white 3`
    : `${prefix}: red 1 / orange 2 / yellow 3`;
}

export function toggleAutoSelectPlacedFrame(app) {
  app.preferences.autoSelectPlacedFrame = !app.preferences.autoSelectPlacedFrame;
  saveGameplayPreferences(app);
  setStatus(app, `auto-select frame ${app.preferences.autoSelectPlacedFrame ? 'on' : 'off'}`);
}

export function returnToMainMenu(app) {
  if (app.game.sessionMode !== 'game') activateSession(app, 'game');
  clearTransientUi(app);
  app.ui.menuConfirm = null;
  app.ui.escapeMenuPage = 'main';
  app.ui.frontEndScreen = 'main';
  setStatus(app, app.game.gameHasEnteredGameplay ? 'main menu // run still live' : 'main menu');
}

export function enterTestField(app) {
  if (app.game.sessions.get('game')?.networkRole) {
    setStatus(app, 'leave coop before entering the test field');
    return;
  }
  activateSession(app, 'test');
  app.ui.frontEndScreen = 'game';
  app.ui.menuConfirm = null;
  setStatus(app, 'test field // local tools');
}
