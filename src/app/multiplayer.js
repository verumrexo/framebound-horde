import { loadResumeToken, localPeerClientId, randomNetworkId, saveResumeToken } from './preferences.js';
import { resetWorldPresentation } from './presentation.js';
import { activateSession, adoptActiveMap, resolveMap, switchGameBundle } from './sessions.js';
import { addSystemMessage, receivePresenceMessage, receiveSocialMessage, resetMultiplayerSocial } from './social.js';
import { setStatus } from './ui-state.js';
import { EmbeddedAuthority } from '../core/embedded-session.js';
import { P2PGuestSession, P2PHostSession } from '../core/p2p-session.js';
import { PeerConnectionCoordinator, RelayConnectionCoordinator, relayUrlForPage, sanitizeRoomCode } from '../core/p2p-transport.js';
import { PROTOTYPE_SESSION_CONFIG } from '../core/session-config.js';

export function createNetworkAuthority(role) {
  const seedWords = new Uint32Array(1);
  globalThis.crypto.getRandomValues(seedWords);
  return new EmbeddedAuthority({
    ...PROTOTYPE_SESSION_CONFIG,
    sessionId: randomNetworkId(`session_${role}`),
    seed: seedWords[0] >>> 0,
    autoStart: false
  });
}

export function createHostNetworkBundle(app) {
  const bundleAuthority = createNetworkAuthority('host');
  const bundleSession = new P2PHostSession(bundleAuthority, {
    clientId: localPeerClientId(),
    label: app.multiplayer.playerName
  });
  bundleSession.connect();
  bundleSession.advance(20);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: resolveMap(bundleAuthority.state.mapId, bundleAuthority.state),
    networkRole: 'host'
  };
}

export function createGuestNetworkBundle(app, code) {
  const bundleAuthority = createNetworkAuthority('guest');
  const clientId = localPeerClientId();
  const bundleSession = new P2PGuestSession(bundleAuthority, {
    clientId,
    label: app.multiplayer.playerName,
    resumeToken: loadResumeToken(code)
  });
  bundleSession.roomCode = code;
  bundleSession.onResumeToken = (token) => saveResumeToken(app, code, token);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: resolveMap(bundleAuthority.state.mapId, bundleAuthority.state),
    networkRole: 'guest'
  };
}

export function updateMultiplayerStatus(app, phase, status, detail = '') {
  if (phase) app.multiplayer.phase = phase;
  app.multiplayer.status = String(status || '').toLowerCase();
  app.multiplayer.detail = String(detail || '').toLowerCase();
  setStatus(app, app.multiplayer.status);
}

export function bindPeerCoordinator(app, bundle, role, code = null) {
  const relayMode = new URLSearchParams(window.location.search).get('relay') === '1';
  const coordinator = relayMode
    ? new RelayConnectionCoordinator({ relayUrl: relayUrlForPage() })
    : new PeerConnectionCoordinator();
  app.connection.peerCoordinator = coordinator;
  bundle.coordinator = coordinator;
  const networkSession = bundle.session;
  networkSession.onSocial = receiveSocialMessage.bind(null, app);
  networkSession.onPresence = receivePresenceMessage.bind(null, app);

  networkSession.onStatus = (status, detail) => {
    if (status === 'peer_ready') {
      const current = networkSession.authority.snapshot();
      const players = current.players.filter((player) => player.connected && !player.spectator).length;
      updateMultiplayerStatus(app, current.phase === 'lobby' ? 'host_lobby' : 'running', `${players}/4 pilots linked`);
    } else if (status === 'error') {
      updateMultiplayerStatus(app, 'error', detail || 'peer session error');
    }
  };

  if (role === 'guest') {
    networkSession.onReady = (snapshot, { firstSync = true } = {}) => {
      bundle.map = resolveMap(snapshot.mapId, snapshot);
      if (app.game.session === networkSession) {
        app.game.sessionSnapshot = snapshot;
        resetWorldPresentation(app);
        if (firstSync || app.game.currentMap.id !== snapshot.mapId || Boolean(app.game.currentMap.randomizedRifts) !== Boolean(snapshot.randomRifts || app.game.currentMap.randomRifts)
          || (app.game.currentMap.randomizedRifts && app.game.currentMap.layoutSeed !== snapshot.seed)) adoptActiveMap(app, snapshot.mapId);
      }
      if (!firstSync) {
        setStatus(app, 'host correction applied');
        return;
      }
      if (snapshot.phase !== 'lobby') {
        app.game.gameHasEnteredGameplay = true;
        app.ui.frontEndScreen = 'game';
        updateMultiplayerStatus(app, 'running', 'rejoined host simulation');
      } else {
        app.ui.frontEndScreen = 'coop';
        updateMultiplayerStatus(app, 'guest_lobby', 'linked // waiting for host');
      }
    };
  }

  coordinator.onStatus = (status, detail) => {
    const labels = {
      creating_session: 'waking signaling relay',
      signaling_connected: 'signaling online',
      waiting_for_peers: 'room open // waiting for pilots',
      joining_session: 'finding room',
      connecting_to_host: 'negotiating direct link',
      peer_connecting: 'pilot found // opening direct link',
      connected: relayMode ? 'relay link open' : 'direct p2p link open',
      reconnecting: 'reconnecting direct link',
      join_timeout: 'room connection timed out',
      connection_lost: 'direct connection lost',
      host_left: 'host left the beta',
      invalid_code: 'invalid room code',
      error: detail || 'network error'
    };
    const error = ['join_timeout', 'connection_lost', 'host_left', 'invalid_code', 'error'].includes(status);
    updateMultiplayerStatus(app, error ? 'error' : app.multiplayer.phase, labels[status] || status, detail || '');
  };
  coordinator.onHosted = ({ code: roomCode, expiresAt }) => {
    app.multiplayer.roomCode = roomCode;
    app.multiplayer.expiresAt = expiresAt;
    networkSession.roomCode = roomCode;
    updateMultiplayerStatus(app, 'host_lobby', 'room ready // share the code');
  };
  coordinator.onConnected = ({ peerId, transport }) => {
    if (role === 'host') networkSession.attachPeer(peerId, transport);
    else networkSession.attachTransport(transport);
  };
  coordinator.onDisconnected = ({ peerId, reason }) => {
    if (app.connection.multiplayerClosing) return;
    if (role === 'host') networkSession.detachPeer(peerId, reason, false);
    else networkSession.detachTransport(reason);
  };
  coordinator.onClosed = ({ reason }) => {
    if (app.connection.multiplayerClosing) return;
    if (reason === 'host_left') addSystemMessage(app, 'host left // room ended');
    updateMultiplayerStatus(app, 'error', reason === 'host_left' ? 'host left // migration is not in this beta' : `peer session closed // ${reason}`);
    app.ui.frontEndScreen = 'coop';
  };

  if (role === 'host') coordinator.host();
  else coordinator.join(code);
  return coordinator;
}

export function beginHostingCoop(app) {
  if (app.game.gameRestorePending) return setStatus(app, 'loading solo save');
  cancelMultiplayer(app, false);
  resetMultiplayerSocial(app);
  const bundle = createHostNetworkBundle(app);
  switchGameBundle(app, bundle);
  app.multiplayer.role = 'host';
  app.multiplayer.roomCode = null;
  app.multiplayer.codeInput = '';
  app.ui.frontEndScreen = 'coop';
  updateMultiplayerStatus(app, 'connecting', 'waking signaling relay');
  bindPeerCoordinator(app, bundle, 'host');
}

export function openJoinCoop(app) {
  if (app.game.gameRestorePending) return setStatus(app, 'loading solo save');
  app.multiplayer.role = 'guest';
  app.multiplayer.phase = 'join_entry';
  app.multiplayer.roomCode = null;
  app.multiplayer.codeInput = '';
  app.multiplayer.status = 'type the six-character room code';
  app.multiplayer.detail = '';
  app.ui.frontEndScreen = 'coop';
}

export function beginJoiningCoop(app) {
  const code = sanitizeRoomCode(app.multiplayer.codeInput);
  if (!code) return updateMultiplayerStatus(app, 'join_entry', 'need all six code characters');
  cancelMultiplayer(app, false);
  resetMultiplayerSocial(app);
  const bundle = createGuestNetworkBundle(app, code);
  switchGameBundle(app, bundle);
  app.multiplayer.role = 'guest';
  app.multiplayer.roomCode = code;
  app.multiplayer.codeInput = code;
  app.ui.frontEndScreen = 'coop';
  updateMultiplayerStatus(app, 'connecting', `joining ${code}`);
  bindPeerCoordinator(app, bundle, 'guest', code);
}

export function cancelMultiplayer(app, returnToMenu = true) {
  app.connection.multiplayerClosing = true;
  try {
    const activeBundle = app.game.sessions.get('game');
    if (activeBundle?.networkRole) activeBundle.session.disconnect?.();
    app.connection.peerCoordinator?.disconnect('player_cancelled');
  } finally {
    app.connection.peerCoordinator = null;
    app.connection.multiplayerClosing = false;
  }
  if (app.game.soloGameBundle) {
    app.game.sessions.set('game', app.game.soloGameBundle);
    if (app.game.sessionMode === 'game') activateSession(app, 'game');
  }
  Object.assign(app.multiplayer, {
    role: null,
    phase: 'idle',
    roomCode: null,
    codeInput: '',
    status: 'peer link idle',
    detail: '',
    expiresAt: 0,
    editingName: false
  });
  resetMultiplayerSocial(app);
  if (returnToMenu) {
    app.game.gameHasEnteredGameplay = Boolean(app.game.sessionSnapshot?.runTick > 0);
    app.ui.frontEndScreen = 'main';
    setStatus(app, 'multiplayer closed');
  }
}

export async function copyRoomCode(app) {
  if (!app.multiplayer.roomCode) return;
  try {
    await navigator.clipboard.writeText(app.multiplayer.roomCode);
    updateMultiplayerStatus(app, app.multiplayer.phase, 'room code copied');
  } catch {
    updateMultiplayerStatus(app, app.multiplayer.phase, `copy failed // code ${app.multiplayer.roomCode}`);
  }
}

export function retryMultiplayer(app) {
  if (app.multiplayer.role === 'host') beginHostingCoop(app);
  else beginJoiningCoop(app);
}
