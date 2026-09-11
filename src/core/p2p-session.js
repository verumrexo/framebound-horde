import {
  AUTHORITY_TICK_MS,
  AUTHORITY_TICK_RATE,
  PROTOCOL_VERSION,
  COMMAND,
  EVENT,
  createCommand,
  validateCommand
} from './protocol.js';
import { PeerPacketReceiver, sendPeerControl, sendPeerPacket } from './p2p-wire.js';

const NETWORK_INPUT_DELAY_TICKS = 12;
const NETWORK_SYNC_INTERVAL_MS = 250;
const NETWORK_PRESENTATION_DELAY_TICKS = 3;
const MAX_PLAYERS = 4;
const MAX_INVALID_MESSAGES = 8;
const RESYNC_COOLDOWN_MS = 2000;

const REMOTE_COMMANDS = new Set([
  COMMAND.LEAVE,
  COMMAND.SESSION_START,
  COMMAND.SESSION_RESTART,
  COMMAND.SESSION_CONTINUE_WITHOUT_PLAYER,
  COMMAND.TOWER_PLACE,
  COMMAND.TOWER_EVOLVE,
  COMMAND.TOWER_SELL,
  COMMAND.TOWER_TARGETING_SET,
  COMMAND.TOWER_STRIKE_POINT_SET,
  COMMAND.TOWER_FORCE_DIRECTION_SET,
  COMMAND.TOWER_CONTROL_GEOMETRY_SET,
  COMMAND.TOWER_RELAY_TARGET_SET
]);

export class P2PHostSession {
  constructor(authority, { clientId, label = 'host' }) {
    this.authority = authority;
    this.clientId = sanitizeClientId(clientId);
    this.label = sanitizeLabel(label);
    this.sequence = 0;
    this.playerId = null;
    this.lastEventId = null;
    this.latestSnapshot = authority.snapshot();
    this.peers = new Map();
    this.pendingDepartures = new Set();
    this.resumeTokensByClientId = new Map();
    this.syncElapsedMs = 0;
    this.networkRole = 'host';
    this.roomCode = null;
    this.onStatus = null;
    this.onRosterChanged = null;
  }

  connect() {
    return this.enqueueLocal(COMMAND.JOIN, { label: this.label }, 1);
  }

  disconnect() {
    if (!this.playerId) return false;
    return this.send(COMMAND.LEAVE);
  }

  attachPeer(peerId, transport) {
    this.detachPeer(peerId, 'replaced', false);
    const peer = {
      id: peerId,
      transport,
      receiver: null,
      clientId: null,
      playerId: null,
      resumeToken: null,
      pendingWelcome: false,
      ready: false,
      invalidMessages: 0,
      lastResyncAt: -Infinity
    };
    peer.receiver = new PeerPacketReceiver({
      onControl: (message) => this.receivePeerControl(peer, message),
      onPacket: () => this.rejectPeer(peer, 'binary uploads are not accepted'),
      onError: (message) => this.rejectPeer(peer, message)
    });
    peer.unsubscribeMessage = transport.onMessage((raw) => peer.receiver.receive(raw));
    this.peers.set(peerId, peer);
    this.onStatus?.('peer_handshake', peerId);
    return peer;
  }

  detachPeer(peerId, reason = 'peer_left', closeTransport = false) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    peer.unsubscribeMessage?.();
    if (closeTransport) peer.transport.close(reason);
    if (peer.clientId && !this.queuePeerDeparture(peer.clientId)) this.pendingDepartures.add(peer.clientId);
    this.onStatus?.('peer_left', reason);
    this.onRosterChanged?.(this.authority.snapshot());
    return true;
  }

  queuePeerDeparture(clientId) {
    const player = this.authority.state.players.find((candidate) => candidate.clientId === clientId);
    const joining = this.authority.pendingCommands.some((command) => command.clientId === clientId && command.type === COMMAND.JOIN);
    if (!player?.connected) return !joining;
    const sequence = (this.authority.lastSequenceByClient.get(clientId) || 0) + 1;
    const command = this.canonicalCommand(clientId, player.id, sequence, COMMAND.LEAVE, {});
    if (!command || !this.authority.enqueue(command)) return false;
    this.broadcastCommand(command);
    return true;
  }

  send(type, payload = {}) {
    if (type === COMMAND.JOIN) return false;
    return this.enqueueLocal(type, payload, NETWORK_INPUT_DELAY_TICKS);
  }

  enqueueLocal(type, payload, delayTicks) {
    let command;
    try {
      command = createCommand({
        clientId: this.clientId,
        playerId: this.playerId,
        sequence: ++this.sequence,
        intendedTick: this.authority.state.tick + delayTicks,
        type,
        payload
      });
    } catch {
      return false;
    }
    if (!this.authority.enqueue(command)) return false;
    this.broadcastCommand(command);
    return true;
  }

  canonicalCommand(clientId, playerId, sequence, type, payload, delayTicks = NETWORK_INPUT_DELAY_TICKS) {
    try {
      return createCommand({
        clientId,
        playerId,
        sequence,
        intendedTick: this.authority.state.tick + delayTicks,
        type,
        payload
      });
    } catch {
      return null;
    }
  }

  receivePeerControl(peer, message) {
    if (message.type === 'hello') {
      this.acceptPeerHello(peer, message);
      return;
    }
    if (!peer.ready) {
      this.rejectPeer(peer, 'peer hello is required');
      return;
    }
    if (message.type === 'command_request') {
      this.acceptPeerCommand(peer, message);
      return;
    }
    if (message.type === 'resync_request') {
      const now = performance.now();
      if (now - peer.lastResyncAt < RESYNC_COOLDOWN_MS) return;
      peer.lastResyncAt = now;
      this.sendCorrection(peer, 'requested');
      return;
    }
    if (message.type === 'pong') return;
    this.rejectPeer(peer, 'unknown peer control message');
  }

  acceptPeerHello(peer, message) {
    if (peer.clientId) return;
    if (message.protocolVersion !== PROTOCOL_VERSION) return this.rejectPeer(peer, 'game versions differ // both reload the beta', true);
    const clientId = sanitizeClientId(message.clientId);
    const label = sanitizeLabel(message.label);
    if (!clientId || clientId === this.clientId) return this.rejectPeer(peer, 'peer identity is invalid', true);
    const existingPlayer = this.authority.state.players.find((player) => player.clientId === clientId);
    const expectedToken = this.resumeTokensByClientId.get(clientId);
    if (existingPlayer && (!expectedToken || message.resumeToken !== expectedToken)) {
      return this.rejectPeer(peer, 'reconnect token is invalid', true);
    }
    if (!existingPlayer && this.authority.state.rosterLocked) return this.rejectPeer(peer, 'run roster is locked', true);
    if (!existingPlayer && this.authority.state.players.filter((player) => !player.eliminated).length >= MAX_PLAYERS) {
      return this.rejectPeer(peer, 'lobby is full', true);
    }
    if ([...this.peers.values()].some((candidate) => candidate !== peer && candidate.clientId === clientId)) {
      return this.rejectPeer(peer, 'player is already connected', true);
    }

    peer.clientId = clientId;
    this.pendingDepartures.delete(clientId);
    peer.resumeToken = expectedToken || createResumeToken();
    this.resumeTokensByClientId.set(clientId, peer.resumeToken);
    const sequence = (this.authority.lastSequenceByClient.get(clientId) || 0) + 1;
    const command = this.canonicalCommand(clientId, existingPlayer?.id || null, sequence, COMMAND.JOIN, { label });
    if (!command || !this.authority.enqueue(command)) return this.rejectPeer(peer, 'join command was rejected', true);
    peer.pendingWelcome = true;
    this.broadcastCommand(command);
  }

  acceptPeerCommand(peer, message) {
    if (!REMOTE_COMMANDS.has(message.commandType) || !isPlainObject(message.payload) || !Number.isSafeInteger(message.sequence)) {
      this.rejectPeer(peer, 'peer command is invalid');
      return;
    }
    const previous = this.authority.lastSequenceByClient.get(peer.clientId) || 0;
    if (message.sequence <= previous) {
      sendPeerControl(peer.transport, 'error', { message: 'stale command sequence' });
      return;
    }
    const command = this.canonicalCommand(
      peer.clientId,
      peer.playerId,
      message.sequence,
      message.commandType,
      message.payload
    );
    if (!command || validateCommand(command) || !this.authority.enqueue(command)) {
      sendPeerControl(peer.transport, 'error', { message: 'host rejected command envelope' });
      return;
    }
    this.broadcastCommand(command);
  }

  flushPeerWelcomes() {
    for (const peer of this.peers.values()) {
      if (!peer.pendingWelcome) continue;
      const player = this.authority.state.players.find((candidate) => candidate.clientId === peer.clientId && candidate.connected);
      if (!player) continue;
      peer.playerId = player.id;
      peer.pendingWelcome = false;
      peer.ready = true;
      const sequence = this.authority.lastSequenceByClient.get(peer.clientId) || 0;
      sendPeerControl(peer.transport, 'welcome', {
        protocolVersion: PROTOCOL_VERSION,
        playerId: peer.playerId,
        clientId: peer.clientId,
        resumeToken: peer.resumeToken,
        sequence,
        authorityTick: this.authority.state.tick
      });
      this.sendCorrection(peer, 'joined');
      this.onStatus?.('peer_ready', peer.playerId);
      this.onRosterChanged?.(this.authority.snapshot());
    }
  }

  sendCorrection(peer, reason) {
    const payload = {
      reason,
      playerId: peer.playerId,
      clientId: peer.clientId,
      sequence: this.authority.lastSequenceByClient.get(peer.clientId) || 0,
      correction: this.authority.correctionSnapshot()
    };
    const sent = sendPeerPacket(peer.transport, 'correction', payload);
    if (!sent) this.rejectPeer(peer, 'correction could not be queued', true);
    return sent;
  }

  broadcastCommand(command) {
    let sent = false;
    for (const peer of this.peers.values()) {
      if (!peer.ready) continue;
      sent = sendPeerControl(peer.transport, 'command', { command }) || sent;
    }
    return sent;
  }

  broadcastSync() {
    const runTick = this.authority.state.runTick;
    const checksumRunTick = runTick - (runTick % AUTHORITY_TICK_RATE);
    for (const peer of this.peers.values()) {
      if (!peer.ready) continue;
      sendPeerControl(peer.transport, 'sync', {
        authorityTick: this.authority.state.tick,
        runTick,
        checksumRunTick,
        swarmChecksum: this.authority.state.swarm.checksum,
        phase: this.authority.state.phase
      });
    }
  }

  rejectPeer(peer, message, close = false) {
    peer.invalidMessages += 1;
    sendPeerControl(peer.transport, 'error', { message: String(message).slice(0, 160) });
    if (close || peer.invalidMessages >= MAX_INVALID_MESSAGES) {
      peer.transport.close('peer_rejected');
      this.detachPeer(peer.id, 'peer_rejected', false);
    }
  }

  advance(elapsedMs) {
    this.authority.advance(elapsedMs);
    for (const clientId of this.pendingDepartures) {
      if (this.queuePeerDeparture(clientId)) this.pendingDepartures.delete(clientId);
    }
    const events = this.authority.eventsAfter(this.lastEventId);
    for (const event of events) {
      this.lastEventId = event.eventId;
      if (event.type === EVENT.PLAYER_JOINED && event.payload.player.clientId === this.clientId) this.playerId = event.payload.player.id;
      if ([EVENT.PLAYER_JOINED, EVENT.PLAYER_RECONNECTED, EVENT.PLAYER_LEFT, EVENT.BALANCED_INHERITANCE_COMPLETED].includes(event.type)) {
        this.onRosterChanged?.(this.authority.snapshot());
      }
      // A map transition is a high-value boundary. Command replication normally
      // converges it, but an immediate correction makes relay-backed guests
      // enter the same live run even if they arrived around the transition.
      if ([EVENT.RUN_STARTED, EVENT.SESSION_RESTARTED].includes(event.type)) {
        for (const peer of this.peers.values()) {
          if (peer.ready) this.sendCorrection(peer, 'map_transition');
        }
      }
    }
    this.flushPeerWelcomes();
    this.syncElapsedMs += elapsedMs;
    if (this.syncElapsedMs >= NETWORK_SYNC_INTERVAL_MS) {
      this.syncElapsedMs %= NETWORK_SYNC_INTERVAL_MS;
      this.broadcastSync();
    }
    this.latestSnapshot = this.authority.snapshot();
    return { snapshot: this.latestSnapshot, events };
  }

  snapshot() {
    return this.latestSnapshot;
  }

  presentation() {
    return this.authority.presentation();
  }

  networkInfo() {
    return {
      role: 'host',
      connected: true,
      readyPeers: [...this.peers.values()].filter((peer) => peer.ready).length,
      roomCode: this.roomCode
    };
  }
}

export class P2PGuestSession {
  constructor(authority, { clientId, label = 'guest', resumeToken = null }) {
    this.authority = authority;
    this.clientId = sanitizeClientId(clientId);
    this.label = sanitizeLabel(label);
    this.resumeToken = typeof resumeToken === 'string' ? resumeToken.slice(0, 128) : null;
    this.sequence = 0;
    this.playerId = null;
    this.lastEventId = null;
    this.latestSnapshot = authority.snapshot();
    this.transport = null;
    this.receiver = null;
    this.unsubscribeMessage = null;
    this.connected = false;
    this.synced = false;
    this.latestHostTick = 0;
    this.hostTickEstimate = 0;
    this.latestSync = null;
    this.minimumChecksumRunTick = 0;
    this.lastMismatchKey = null;
    this.mismatchCount = 0;
    this.resyncRequestedAt = -Infinity;
    this.resyncPending = false;
    this.lastHostMessageAt = performance.now();
    this.stalled = false;
    this.networkRole = 'guest';
    this.roomCode = null;
    this.onStatus = null;
    this.onReady = null;
    this.onResumeToken = null;
  }

  connect() {
    return false;
  }

  attachTransport(transport) {
    this.detachTransport('replaced');
    this.transport = transport;
    this.connected = true;
    this.lastHostMessageAt = performance.now();
    this.receiver = new PeerPacketReceiver({
      onControl: (message) => this.receiveControl(message),
      onPacket: (kind, payload) => this.receivePacket(kind, payload),
      onError: (message) => this.fail(message)
    });
    this.unsubscribeMessage = transport.onMessage((raw) => this.receiver.receive(raw));
    const sent = sendPeerControl(transport, 'hello', {
      protocolVersion: PROTOCOL_VERSION,
      clientId: this.clientId,
      label: this.label,
      resumeToken: this.resumeToken
    });
    if (!sent) this.fail('peer hello could not be queued');
    return sent;
  }

  detachTransport(reason = 'disconnected') {
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;
    this.transport = null;
    this.receiver = null;
    this.connected = false;
    this.synced = false;
    this.onStatus?.('disconnected', reason);
  }

  disconnect() {
    if (!this.connected) return false;
    const sent = this.send(COMMAND.LEAVE, {});
    this.detachTransport('left');
    return sent;
  }

  send(type, payload = {}) {
    if (!this.transport || !this.connected || !this.synced || !REMOTE_COMMANDS.has(type)) return false;
    const sequence = this.sequence + 1;
    const sent = sendPeerControl(this.transport, 'command_request', {
      sequence,
      commandType: type,
      payload
    });
    if (sent) this.sequence = sequence;
    return sent;
  }

  receiveControl(message) {
    if (message.type === 'welcome') {
      if (message.protocolVersion !== PROTOCOL_VERSION || !validIdentity(message.playerId) || message.clientId !== this.clientId || !Number.isSafeInteger(message.sequence)) {
        return this.fail('host welcome is invalid');
      }
      this.playerId = message.playerId;
      this.sequence = Math.max(this.sequence, message.sequence);
      this.latestHostTick = Math.max(this.latestHostTick, Number(message.authorityTick) || 0);
      this.resumeToken = typeof message.resumeToken === 'string' ? message.resumeToken.slice(0, 128) : this.resumeToken;
      this.onResumeToken?.(this.resumeToken);
      this.onStatus?.('awaiting_correction');
      return;
    }
    if (message.type === 'command') {
      const command = message.command;
      if (validateCommand(command)) return this.fail('host command is invalid');
      if (!this.authority.enqueue(command)) return;
      if (command.clientId === this.clientId) this.sequence = Math.max(this.sequence, command.sequence);
      if (command.intendedTick <= this.authority.state.tick) this.requestResync('late_command');
      return;
    }
    if (message.type === 'sync') {
      if (!Number.isSafeInteger(message.authorityTick) || !Number.isSafeInteger(message.runTick)) return;
      this.lastHostMessageAt = performance.now();
      this.latestHostTick = Math.max(this.latestHostTick, message.authorityTick);
      const clockError = message.authorityTick - this.hostTickEstimate;
      if (this.synced && Math.abs(clockError) > AUTHORITY_TICK_RATE * 0.5) {
        this.requestResync('clock_gap');
      } else {
        this.hostTickEstimate += Math.max(-2, Math.min(4, clockError * 0.5));
      }
      this.latestSync = message;
      this.checkSync();
      return;
    }
    if (message.type === 'error') {
      this.onStatus?.('error', String(message.message || 'host rejected peer action').slice(0, 160));
      return;
    }
    if (message.type === 'ping') sendPeerControl(this.transport, 'pong', { nonce: message.nonce || null });
  }

  receivePacket(kind, payload) {
    if (kind !== 'correction' || !payload?.correction) return this.fail('host packet is invalid');
    if (payload.correction.protocolVersion !== PROTOCOL_VERSION || payload.clientId !== this.clientId || !validIdentity(payload.playerId)) {
      return this.fail('host correction version or identity is incompatible');
    }
    const firstSync = !this.synced;
    try {
      this.authority.applyCorrectionSnapshot(payload.correction);
    } catch (error) {
      return this.fail(error?.message || 'host correction is incompatible');
    }
    this.playerId = payload.playerId;
    this.sequence = Math.max(this.sequence, Number(payload.sequence) || 0);
    this.lastEventId = null;
    this.latestSnapshot = this.authority.snapshot();
    this.latestHostTick = Math.max(this.latestHostTick, this.authority.state.tick);
    this.hostTickEstimate = this.authority.state.tick;
    this.latestSync = null;
    this.minimumChecksumRunTick = this.authority.state.runTick - (this.authority.state.runTick % AUTHORITY_TICK_RATE) + AUTHORITY_TICK_RATE;
    this.synced = true;
    this.resyncPending = false;
    this.stalled = false;
    this.lastHostMessageAt = performance.now();
    this.mismatchCount = 0;
    this.lastMismatchKey = null;
    this.onStatus?.('ready', payload.reason);
    this.onReady?.(this.latestSnapshot, { firstSync, reason: payload.reason });
  }

  requestResync(reason) {
    const now = performance.now();
    if (!this.transport || now - this.resyncRequestedAt < RESYNC_COOLDOWN_MS) return false;
    this.resyncRequestedAt = now;
    const sent = sendPeerControl(this.transport, 'resync_request', { reason });
    if (sent) this.resyncPending = true;
    return sent;
  }

  checkSync() {
    const sync = this.latestSync;
    if (!sync || !this.synced) return;
    if (sync.checksumRunTick < this.minimumChecksumRunTick) return;
    const localRunTick = this.authority.state.runTick;
    const localChecksumTick = localRunTick - (localRunTick % AUTHORITY_TICK_RATE);
    if (localChecksumTick !== sync.checksumRunTick || !sync.swarmChecksum) return;
    const key = `${sync.checksumRunTick}:${sync.swarmChecksum}`;
    if (this.authority.state.swarm.checksum === sync.swarmChecksum) {
      this.mismatchCount = 0;
      this.lastMismatchKey = null;
      return;
    }
    this.mismatchCount = this.lastMismatchKey === key ? this.mismatchCount + 1 : 1;
    this.lastMismatchKey = key;
    if (this.mismatchCount >= 2) this.requestResync('checksum_mismatch');
  }

  advance(elapsedMs) {
    let adjusted = 0;
    this.stalled = this.connected && this.synced && performance.now() - this.lastHostMessageAt > 1500;
    if (this.connected && this.synced && !this.resyncPending && !this.stalled) {
      this.hostTickEstimate += Math.max(0, elapsedMs) / AUTHORITY_TICK_MS;
      const targetTick = this.hostTickEstimate - NETWORK_PRESENTATION_DELAY_TICKS;
      const neededMs = (targetTick - this.authority.state.tick) * AUTHORITY_TICK_MS - this.authority.accumulatorMs;
      adjusted = Math.min(80, Math.max(0, neededMs));
    }
    this.authority.advance(adjusted);
    const events = this.authority.eventsAfter(this.lastEventId);
    for (const event of events) this.lastEventId = event.eventId;
    this.latestSnapshot = this.authority.snapshot();
    this.checkSync();
    return { snapshot: this.latestSnapshot, events };
  }

  snapshot() {
    return this.latestSnapshot;
  }

  presentation() {
    return this.authority.presentation();
  }

  networkInfo() {
    return {
      role: 'guest',
      connected: this.connected,
      synced: this.synced,
      resyncPending: this.resyncPending,
      stalled: this.stalled,
      authorityTick: this.latestHostTick,
      estimatedHostTick: this.hostTickEstimate,
      localTick: this.authority.state.tick,
      presentationDelayTicks: NETWORK_PRESENTATION_DELAY_TICKS,
      roomCode: this.roomCode
    };
  }

  fail(message) {
    this.onStatus?.('error', String(message).slice(0, 160));
  }
}

function sanitizeClientId(value) {
  const sanitized = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return sanitized || null;
}

function sanitizeLabel(value) {
  return String(value || 'pilot').toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 20) || 'pilot';
}

function validIdentity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createResumeToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '');
  const values = new Uint8Array(16);
  globalThis.crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
}
