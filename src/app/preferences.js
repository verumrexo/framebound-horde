import { setStatus } from './ui-state.js';
import { DEFAULT_PACE, normalizePace } from '../core/progression.js';
import { COMMAND } from '../core/protocol.js';

export function loadTestPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('framebound_horde_test_field') || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function loadGameplayPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('framebound_horde_preferences') || 'null');
    return {
      autoSelectPlacedFrame: saved?.autoSelectPlacedFrame !== false,
      pace: normalizePace(saved?.pace ?? DEFAULT_PACE),
      hostilePalette: saved?.hostilePalette === 'magenta' ? 'magenta' : 'red',
      randomRifts: saved?.randomRifts === true
    };
  } catch {
    return { autoSelectPlacedFrame: true, pace: DEFAULT_PACE, hostilePalette: 'red', randomRifts: false };
  }
}

export function loadPlayerName() {
  try {
    return sanitizePlayerName(localStorage.getItem('framebound_horde_player_name')) || 'pilot';
  } catch {
    return 'pilot';
  }
}

export function sanitizePlayerName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function savePlayerName(app, value) {
  const name = sanitizePlayerName(value) || 'pilot';
  app.multiplayer.playerName = name;
  try { localStorage.setItem('framebound_horde_player_name', name); } catch {}
  if (app.game.session?.networkRole && app.game.session.playerId) app.game.session.send(COMMAND.PLAYER_RENAME, { label: name });
}

export function saveGameplayPreferences(app) {
  try {
    localStorage.setItem('framebound_horde_preferences', JSON.stringify(app.preferences));
  } catch {
    setStatus(app, 'gameplay options could not save');
  }
}

export function saveTestPreferences(app, test) {
  if (!test) return;
  try {
    localStorage.setItem('framebound_horde_test_field', JSON.stringify({
      spawnRatePerSecond: test.spawnRatePerSecond,
      enemyHp: test.enemyHp,
      invincibleBase: test.invincibleBase,
      timeScale: test.timeScale,
      activeSpawnSourceIds: test.activeSpawnSourceIds,
      spawnSourceOverrides: test.spawnSourceOverrides || {},
      keepSwarm: app.ui.testKeepSwarm
    }));
  } catch {
    setStatus(app, 'test settings could not save');
  }
}

export function randomNetworkId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return `${prefix}_${values[0].toString(36)}${values[1].toString(36)}`;
}

export function localPeerClientId() {
  const key = 'framebound_horde_peer_client';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = randomNetworkId('client').slice(0, 64);
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return randomNetworkId('client').slice(0, 64);
  }
}

export function loadResumeToken(code) {
  try {
    return sessionStorage.getItem(`framebound_horde_resume_${code}`);
  } catch {
    return null;
  }
}

export function saveResumeToken(app, code, token) {
  if (!code || !token) return;
  try {
    sessionStorage.setItem(`framebound_horde_resume_${code}`, token);
  } catch {
    setStatus(app, 'reconnect token could not save');
  }
}
