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
const RECOVERY_RETRY_MS = 10_000;
const CHAT_WINDOW_MS = 5000;
const CHAT_WINDOW_LIMIT = 4;
const PING_COOLDOWN_MS = 1000;

export const REMOTE_COMMANDS = new Set([
  COMMAND.LEAVE,
  COMMAND.SESSION_START,
  COMMAND.SESSION_RESTART,
  COMMAND.PLAYER_RENAME,
  COMMAND.RESEARCH_PURCHASE,
  COMMAND.REACTOR_PURCHASE,
  COMMAND.TOWER_PLACE,
  COMMAND.TOWER_EVOLVE,
  COMMAND.TOWER_SELL,
  COMMAND.TOWER_TARGETING_SET,
  COMMAND.TOWER_STRIKE_POINT_SET,
  COMMAND.TOWER_FORCE_DIRECTION_SET,
  COMMAND.TOWER_CONTROL_GEOMETRY_SET,
  COMMAND.TOWER_RELAY_TARGET_SET,
  COMMAND.TOWER_ECHO_SOURCE_SET,
  COMMAND.TOWER_SOCKET_SET
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
    this.onSocial = null;
    this.onPresence = null;
    this.socialCounter = 0;
    this.localSocialRate = { chat: [], pingAt: -Infinity };
    this.presenceSequenceByPlayer = new Map();
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
    const lanes = normalizeTransportBundle(transport);
    const peer = {
      id: peerId,
      transport: lanes.gameplay,
      socialTransport: lanes.social,
      presenceTransport: lanes.presence,
      receiver: null,
      clientId: null,
      playerId: null,
      resumeToken: null,
      pendingWelcome: false,
      ready: false,
      invalidMessages: 0,
      lastResyncAt: -Infinity,
      resyncRequested: false,
      socialRate: { chat: [], pingAt: -Infinity },
      incomingPresenceSequence: -1
    };
    peer.receiver = new PeerPacketReceiver({
      onControl: (message) => this.receivePeerControl(peer, message),
      onPacket: () => this.rejectPeer(peer, 'binary uploads are not accepted'),
      onError: (message) => this.rejectPeer(peer, message)
    });
    peer.unsubscribeMessage = peer.transport.onMessage((raw) => peer.receiver.receive(raw));
    peer.socialReceiver = createControlReceiver(
      (message) => this.receivePeerSocial(peer, message),
      () => this.rejectPeer(peer, 'invalid social payload')
    );
    peer.presenceReceiver = createControlReceiver(
      (message) => this.receivePeerPresence(peer, message),
      () => {}
    );
    peer.unsubscribeSocial = peer.socialTransport?.onMessage((raw) => peer.socialReceiver.receive(raw));
    peer.unsubscribePresence = peer.presenceTransport?.onMessage((raw) => peer.presenceReceiver.receive(raw));
    this.peers.set(peerId, peer);
    this.onStatus?.('peer_handshake', peerId);
    return peer;
  }

  detachPeer(peerId, reason = 'peer_left', closeTransport = false) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    peer.unsubscribeMessage?.();
    peer.unsubscribeSocial?.();
    peer.unsubscribePresence?.();
    if (closeTransport) closeTransportBundle(peer, reason);
    if (peer.playerId) {
      const idle = {
        type: 'presence',
        playerId: peer.playerId,
        sequence: this.nextPresenceSequence(peer.playerId),
        active: false
      };
      this.onPresence?.(idle);
      for (const candidate of this.peers.values()) {
        if (candidate.ready && candidate.presenceTransport) sendPeerControl(candidate.presenceTransport, 'presence', idle);
      }
    }
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
    const command = this.canonicalCommand(clientId, player.id, sequence, COMMAND.DISCONNECT, {});
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
      peer.resyncRequested = true;
      this.flushPeerResyncs();
      return;
    }
    if (message.type === 'pong') return;
    this.rejectPeer(peer, 'unknown peer control message');
  }

  receivePeerSocial(peer, message) {
    if (!peer.ready || message.type !== 'social_request') return;
    this.acceptSocial(peer.playerId, message.kind, message, peer.socialRate);
  }

  receivePeerPresence(peer, message) {
    if (!peer.ready || message.type !== 'presence') return;
    if (!Number.isSafeInteger(message.sourceSequence) || message.sourceSequence <= peer.incomingPresenceSequence) return;
    const presence = sanitizePresence(message, this.authority);
    if (!presence) return;
    peer.incomingPresenceSequence = message.sourceSequence;
    const stamped = {
      type: 'presence',
      playerId: peer.playerId,
      sequence: this.nextPresenceSequence(peer.playerId),
      ...presence
    };
    this.onPresence?.(stamped);
    for (const candidate of this.peers.values()) {
      if (candidate.ready && candidate !== peer && candidate.presenceTransport) {
        sendPeerControl(candidate.presenceTransport, 'presence', stamped);
      }
    }
  }

  acceptSocial(playerId, kind, payload, rate) {
    const now = performance.now();
    let message = null;
    if (kind === 'chat') {
      rate.chat = rate.chat.filter((at) => now - at < CHAT_WINDOW_MS);
      if (rate.chat.length >= CHAT_WINDOW_LIMIT) return false;
      const text = sanitizeChat(payload.text);
      if (!text) return false;
      rate.chat.push(now);
      message = { kind, text };
    } else if (kind === 'ping') {
      if (now - rate.pingAt < PING_COOLDOWN_MS) return false;
      const point = sanitizeWorldPoint(payload, this.authority);
      if (!point) return false;
      rate.pingAt = now;
      message = { kind, ...point };
    } else return false;
    const stamped = { type: 'social', id: `social_${++this.socialCounter}`, playerId, ...message };
    this.onSocial?.(stamped);
    for (const peer of this.peers.values()) {
      if (peer.ready && peer.socialTransport) sendPeerControl(peer.socialTransport, 'social', stamped);
    }
    return true;
  }

  sendChat(text) {
    return Boolean(this.playerId) && this.acceptSocial(this.playerId, 'chat', { text }, this.localSocialRate);
  }

  sendPing(x, y) {
    return Boolean(this.playerId) && this.acceptSocial(this.playerId, 'ping', { x, y }, this.localSocialRate);
  }

  sendPresence(payload) {
    const presence = sanitizePresence(payload, this.authority);
    if (!this.playerId || !presence) return false;
    const stamped = {
      type: 'presence',
      playerId: this.playerId,
      sequence: this.nextPresenceSequence(this.playerId),
      ...presence
    };
    for (const peer of this.peers.values()) {
      if (peer.ready && peer.presenceTransport) sendPeerControl(peer.presenceTransport, 'presence', stamped);
    }
    return true;
  }

  nextPresenceSequence(playerId) {
    const sequence = (this.presenceSequenceByPlayer.get(playerId) || 0) + 1;
    this.presenceSequenceByPlayer.set(playerId, sequence);
    return sequence;
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

  flushPeerResyncs() {
    const now = performance.now();
    for (const peer of this.peers.values()) {
      if (!peer.ready || !peer.resyncRequested || now - peer.lastResyncAt < RESYNC_COOLDOWN_MS) continue;
      peer.resyncRequested = false;
      peer.lastResyncAt = now;
      this.sendCorrection(peer, 'requested');
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
        authorityChecksum: authoritativeChecksum(this.authority.state),
        phase: this.authority.state.phase
      });
    }
  }

  rejectPeer(peer, message, close = false) {
    peer.invalidMessages += 1;
    sendPeerControl(peer.transport, 'error', { message: String(message).slice(0, 160) });
    if (close || peer.invalidMessages >= MAX_INVALID_MESSAGES) {
      closeTransportBundle(peer, 'peer_rejected');
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
      if ([EVENT.PLAYER_JOINED, EVENT.PLAYER_RECONNECTED, EVENT.PLAYER_LEFT, EVENT.PLAYER_DISCONNECTED, EVENT.PLAYER_DEPARTED].includes(event.type)) {
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
    this.flushPeerResyncs();
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
    this.socialTransport = null;
    this.presenceTransport = null;
    this.receiver = null;
    this.unsubscribeMessage = null;
    this.connected = false;
    this.welcomed = false;
    this.synced = false;
    this.latestHostTick = 0;
    this.hostTickEstimate = 0;
    this.latestSync = null;
    this.minimumChecksumRunTick = 0;
    this.lastMismatchKey = null;
    this.mismatchCount = 0;
    this.resyncRequestedAt = -Infinity;
    this.lastCorrectionProgressAt = -Infinity;
    this.resyncPending = false;
    this.lastHostMessageAt = performance.now();
    this.stalled = false;
    this.networkRole = 'guest';
    this.roomCode = null;
    this.onStatus = null;
    this.onReady = null;
    this.onResumeToken = null;
    this.onSocial = null;
    this.onPresence = null;
    this.presenceSequence = 0;
  }

  connect() {
    return false;
  }

  attachTransport(transport) {
    this.detachTransport('replaced');
    const lanes = normalizeTransportBundle(transport);
    this.transport = lanes.gameplay;
    this.socialTransport = lanes.social;
    this.presenceTransport = lanes.presence;
    this.connected = true;
    this.lastHostMessageAt = performance.now();
    this.receiver = new PeerPacketReceiver({
      onControl: (message) => this.receiveControl(message),
      onPacket: (kind, payload) => this.receivePacket(kind, payload),
      onPacketProgress: ({ kind }) => {
        if (kind !== 'correction') return;
        this.lastCorrectionProgressAt = performance.now();
        this.resyncPending = true;
      },
      onError: (message) => this.fail(message)
    });
    this.unsubscribeMessage = this.transport.onMessage((raw) => this.receiver.receive(raw));
    this.socialReceiver = createControlReceiver((message) => {
      if (message.type === 'social' && validIdentity(message.playerId)) this.onSocial?.(message);
    }, () => this.fail('host social payload is invalid'));
    this.presenceReceiver = createControlReceiver((message) => {
      if (message.type === 'presence' && validIdentity(message.playerId)) this.onPresence?.(message);
    }, () => {});
    this.unsubscribeSocial = this.socialTransport?.onMessage((raw) => this.socialReceiver.receive(raw));
    this.unsubscribePresence = this.presenceTransport?.onMessage((raw) => this.presenceReceiver.receive(raw));
    const sent = sendPeerControl(this.transport, 'hello', {
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
    this.unsubscribeSocial?.();
    this.unsubscribePresence?.();
    this.unsubscribeMessage = null;
    this.transport = null;
    this.socialTransport = null;
    this.presenceTransport = null;
    this.receiver = null;
    this.connected = false;
    this.welcomed = false;
    this.synced = false;
    this.resyncPending = false;
    this.resyncRequestedAt = -Infinity;
    this.lastCorrectionProgressAt = -Infinity;
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

  sendChat(text) {
    const sanitized = sanitizeChat(text);
    return Boolean(sanitized && this.socialTransport && this.synced)
      && sendPeerControl(this.socialTransport, 'social_request', { kind: 'chat', text: sanitized });
  }

  sendPing(x, y) {
    const point = sanitizeWorldPoint({ x, y }, this.authority);
    return Boolean(point && this.socialTransport && this.synced)
      && sendPeerControl(this.socialTransport, 'social_request', { kind: 'ping', ...point });
  }

  sendPresence(payload) {
    const presence = sanitizePresence(payload, this.authority);
    return Boolean(presence && this.presenceTransport && this.synced)
      && sendPeerControl(this.presenceTransport, 'presence', {
        sourceSequence: ++this.presenceSequence,
        ...presence
      });
  }

  receiveControl(message) {
    if (message.type === 'welcome') {
      if (message.protocolVersion !== PROTOCOL_VERSION || !validIdentity(message.playerId) || message.clientId !== this.clientId || !Number.isSafeInteger(message.sequence)) {
        return this.fail('host welcome is invalid');
      }
      this.playerId = message.playerId;
      this.welcomed = true;
      this.lastHostMessageAt = performance.now();
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
      if (Math.abs(clockError) > AUTHORITY_TICK_RATE * 0.5) {
        // A slow snapshot queues newer clock samples behind it. Catch up from
        // the valid state we received; clock drift alone is not state divergence.
        this.hostTickEstimate = message.authorityTick;
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
    if (this.resyncPending && now - Math.max(this.resyncRequestedAt, this.lastCorrectionProgressAt) < RECOVERY_RETRY_MS) return false;
    // The reliable stream delivers any old trailing chunks before the new
    // header. Discard an incomplete packet so it cannot poison the retry.
    this.receiver?.reset();
    this.resyncRequestedAt = now;
    this.resyncPending = true;
    return sendPeerControl(this.transport, 'resync_request', { reason });
  }

  checkSync() {
    const sync = this.latestSync;
    if (!sync || !this.synced) return;
    if (sync.checksumRunTick < this.minimumChecksumRunTick) return;
    const localRunTick = this.authority.state.runTick;
    const localChecksumTick = localRunTick - (localRunTick % AUTHORITY_TICK_RATE);
    if (localChecksumTick !== sync.checksumRunTick || !sync.swarmChecksum) return;
    const swarmMatches = this.authority.state.swarm.checksum === sync.swarmChecksum;
    const authorityComparable = localRunTick === sync.runTick && Boolean(sync.authorityChecksum);
    if (swarmMatches && !authorityComparable) {
      this.mismatchCount = 0;
      this.lastMismatchKey = null;
      return;
    }
    const authorityMatches = !authorityComparable || authoritativeChecksum(this.authority.state) === sync.authorityChecksum;
    if (swarmMatches && authorityMatches) {
      this.mismatchCount = 0;
      this.lastMismatchKey = null;
      return;
    }
    const key = swarmMatches
      ? 'authority'
      : `${sync.checksumRunTick}:${sync.swarmChecksum}`;
    this.mismatchCount = this.lastMismatchKey === key ? this.mismatchCount + 1 : 1;
    this.lastMismatchKey = key;
    if (this.mismatchCount >= 2) this.requestResync('checksum_mismatch');
  }

  advance(elapsedMs) {
    let adjusted = 0;
    const now = performance.now();
    this.stalled = this.connected && this.synced && now - this.lastHostMessageAt > 1500;
    const recoveryProgressAt = this.resyncPending
      ? Math.max(this.resyncRequestedAt, this.lastCorrectionProgressAt)
      : this.lastHostMessageAt;
    if (this.connected && this.welcomed && (this.resyncPending || this.stalled || !this.synced)
      && now - recoveryProgressAt >= RECOVERY_RETRY_MS) this.requestResync('snapshot_timeout');
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

function normalizeTransportBundle(value) {
  if (value?.gameplay) return value;
  return { gameplay: value, social: null, presence: null };
}

function closeTransportBundle(peer, reason) {
  const transports = new Set([peer.transport, peer.socialTransport, peer.presenceTransport].filter(Boolean));
  for (const transport of transports) transport.close(reason);
}

function createControlReceiver(onControl, onError) {
  return new PeerPacketReceiver({ onControl, onPacket: onError, onError });
}

function sanitizeChat(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function sanitizeWorldPoint(value, authority) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) return null;
  const bounds = authority.map?.bounds;
  if (!bounds) return null;
  const x = Math.round(value.x);
  const y = Math.round(value.y);
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  return { x, y };
}

function sanitizePresence(value, authority) {
  if (value?.active === false) return { active: false };
  const point = sanitizeWorldPoint(value, authority);
  if (!point) return null;
  const activity = ['looking', 'placing', 'inspecting'].includes(value.activity) ? value.activity : 'looking';
  const towerId = typeof value.towerId === 'string'
    && authority.state.towers.some((tower) => tower.id === value.towerId) ? value.towerId : null;
  const definitionId = typeof value.definitionId === 'string'
    && authority.towerDefinitions[value.definitionId] ? value.definitionId : null;
  return {
    active: true,
    ...point,
    activity,
    towerId,
    definitionId,
    valid: value.valid === true
  };
}

function authoritativeChecksum(state) {
  const value = JSON.stringify({
    phase: state.phase,
    runTick: state.runTick,
    rosterLocked: state.rosterLocked,
    hostPlayerId: state.hostPlayerId,
    players: state.players,
    teamEconomy: state.teamEconomy,
    contributionByPlayer: state.contributionByPlayer,
    base: state.base,
    stats: state.stats,
    towers: state.towers,
    projectiles: state.projectiles,
    attackFields: state.attackFields,
    forceFields: state.forceFields,
    research: state.research,
    relayNetwork: state.relayNetwork,
    supportCounters: state.supportCounters
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createResumeToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '');
  const values = new Uint8Array(16);
  globalThis.crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
}
