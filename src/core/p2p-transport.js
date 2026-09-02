import { io } from 'socket.io-client';

// Adapted from the user's working framebound signaling client/coordinator.
// The relay is shared; game state and authority remain specific to horde.
export const SIGNALING_URL = 'https://framebound-signaling.onrender.com';

export const DEFAULT_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
  Object.freeze({ urls: 'stun:stun.cloudflare.com:3478' })
]);

const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;

export class DataChannelTransport {
  constructor(channel) {
    this.channel = channel;
    this.readyState = channel.readyState || 'connecting';
    this.queue = [];
    this.queuedBytes = 0;
    this.messageListeners = new Set();
    this.openListeners = new Set();
    this.closeListeners = new Set();
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      if (this.readyState === 'closed') return;
      this.readyState = 'open';
      this.flush();
      for (const listener of this.openListeners) listener();
    };
    channel.onbufferedamountlow = () => this.flush();
    channel.onmessage = (event) => {
      for (const listener of this.messageListeners) listener(event.data);
    };
    channel.onclose = () => this.handleClose('channel_closed');
    channel.onerror = () => this.handleClose('channel_error');
  }

  send(message) {
    if (this.readyState === 'closed') return false;
    const normalized = normalizeChannelData(message);
    if (!normalized) return false;
    const bytes = channelDataBytes(normalized);
    if (this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
      this.handleClose('channel_queue_overflow');
      return false;
    }
    this.queue.push({ data: normalized, bytes });
    this.queuedBytes += bytes;
    this.flush();
    return true;
  }

  flush() {
    if (this.readyState !== 'open' || this.channel.readyState !== 'open') return;
    while (this.queue.length && this.channel.bufferedAmount < MAX_BUFFERED_BYTES) {
      const item = this.queue.shift();
      this.queuedBytes -= item.bytes;
      try {
        this.channel.send(item.data);
      } catch {
        this.handleClose('channel_send_failed');
        return;
      }
    }
  }

  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onOpen(listener) {
    this.openListeners.add(listener);
    if (this.readyState === 'open') queueMicrotask(listener);
    return () => this.openListeners.delete(listener);
  }

  onClose(listener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(reason = 'closed') {
    if (this.readyState === 'closed') return;
    try {
      this.channel.close();
    } finally {
      this.handleClose(reason);
    }
  }

  handleClose(reason) {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.queue.length = 0;
    this.queuedBytes = 0;
    for (const listener of this.closeListeners) listener(reason);
  }
}

export class WebRtcPeerLink {
  constructor({
    RTCPeerConnectionClass = globalThis.RTCPeerConnection,
    initiator = false,
    iceServers = DEFAULT_ICE_SERVERS,
    channelLabel = 'framebound-horde-v1'
  } = {}) {
    if (typeof RTCPeerConnectionClass !== 'function') throw new Error('webrtc is unavailable');
    this.initiator = initiator;
    this.peerConnection = new RTCPeerConnectionClass({ iceServers });
    this.transport = null;
    this.pendingRemoteCandidates = [];
    this.onSignal = null;
    this.onTransport = null;
    this.onStateChange = null;

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.onSignal?.({ candidate: event.candidate.toJSON?.() || event.candidate });
    };
    this.peerConnection.onconnectionstatechange = () => {
      this.onStateChange?.(this.peerConnection.connectionState);
    };
    this.peerConnection.ondatachannel = (event) => this.attachChannel(event.channel);

    if (initiator) this.attachChannel(this.peerConnection.createDataChannel(channelLabel, { ordered: true }));
  }

  attachChannel(channel) {
    if (this.transport) return this.transport;
    this.transport = new DataChannelTransport(channel);
    this.transport.onOpen(() => this.onTransport?.(this.transport));
    this.transport.onClose((reason) => {
      this.onStateChange?.(reason === 'peer_link_closed' ? 'closed' : 'disconnected');
    });
    return this.transport;
  }

  async createOffer() {
    if (!this.initiator) throw new Error('only initiators create offers');
    const description = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(description);
    return { description: plainDescription(this.peerConnection.localDescription || description) };
  }

  async acceptSignal(signal) {
    if (!signal || typeof signal !== 'object') return null;
    if (signal.candidate) {
      if (!this.peerConnection.remoteDescription) {
        if (this.pendingRemoteCandidates.length >= 256) throw new Error('too many queued ice candidates');
        this.pendingRemoteCandidates.push(signal.candidate);
        return null;
      }
      await this.peerConnection.addIceCandidate(signal.candidate);
      return null;
    }
    if (!signal.description) return null;
    await this.peerConnection.setRemoteDescription(signal.description);
    for (const candidate of this.pendingRemoteCandidates.splice(0)) await this.peerConnection.addIceCandidate(candidate);
    if (signal.description.type !== 'offer') return null;
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return { description: plainDescription(this.peerConnection.localDescription || answer) };
  }

  close() {
    this.transport?.close('peer_link_closed');
    this.peerConnection.close();
  }
}

export class SocketIOSignalingClient {
  constructor({ serverUrl = SIGNALING_URL, keepaliveMs = 30_000 } = {}) {
    this.serverUrl = serverUrl;
    this.keepaliveMs = keepaliveMs;
    this.socket = null;
    this.connected = false;
    this.code = null;
    this.keepaliveTimer = null;
    this.onConnected = null;
    this.onHosted = null;
    this.onJoined = null;
    this.onPeerJoined = null;
    this.onSignal = null;
    this.onPeerLeft = null;
    this.onHostLeft = null;
    this.onError = null;
  }

  connect() {
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }
    this.socket = io(this.serverUrl, {
      transports: ['polling', 'websocket'],
      forceNew: true,
      timeout: 60_000
    });
    this.socket.on('connect', () => {
      this.connected = true;
      this.onConnected?.();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
    });
    this.socket.on('connect_error', (error) => this.onError?.(error?.message || 'signaling connection failed'));
    this.socket.on('p2p_hosted', (data) => {
      const code = sanitizeRoomCode(data?.code);
      if (!code || !Number.isFinite(data?.expiresAt)) return;
      this.code = code;
      this.startKeepalive();
      this.onHosted?.({ code, expiresAt: data.expiresAt });
    });
    this.socket.on('p2p_joined', (data) => {
      const code = sanitizeRoomCode(data?.code);
      if (!code || !validPeerId(data?.hostId)) return;
      this.code = code;
      this.onJoined?.({ code, hostId: data.hostId });
    });
    this.socket.on('p2p_peer_joined', (data) => {
      const code = sanitizeRoomCode(data?.code);
      if (!code || !validPeerId(data?.peerId)) return;
      this.onPeerJoined?.({ code, peerId: data.peerId });
    });
    this.socket.on('p2p_signal', (data) => {
      const code = sanitizeRoomCode(data?.code);
      if (!code || !validPeerId(data?.fromId) || !safeSignal(data?.signal)) return;
      this.onSignal?.({ code, fromId: data.fromId, signal: data.signal });
    });
    this.socket.on('p2p_peer_left', (data) => {
      if (validPeerId(data?.peerId)) this.onPeerLeft?.(data.peerId);
    });
    this.socket.on('p2p_host_left', (data) => {
      const code = sanitizeRoomCode(data?.code);
      if (code) this.onHostLeft?.(code);
    });
    this.socket.on('p2p_error', (message) => {
      if (typeof message === 'string') this.onError?.(message.slice(0, 200));
    });
  }

  host() {
    if (!this.socket) this.connect();
    this.socket.emit('p2p_host');
  }

  join(code) {
    const sanitized = sanitizeRoomCode(code);
    if (!sanitized) return false;
    if (!this.socket) this.connect();
    this.socket.emit('p2p_join', sanitized);
    return true;
  }

  sendSignal(targetId, signal) {
    if (!this.socket || !this.code || !validPeerId(targetId) || !safeSignal(signal)) return false;
    this.socket.emit('p2p_signal', { code: this.code, targetId, signal });
    return true;
  }

  leave() {
    const hadSession = Boolean(this.code);
    this.stopKeepalive();
    if (hadSession) this.socket?.emit('p2p_leave');
    this.code = null;
  }

  disconnect() {
    this.leave();
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }

  startKeepalive() {
    this.stopKeepalive();
    if (!this.code || this.keepaliveMs <= 0) return;
    this.keepaliveTimer = setInterval(() => {
      if (this.socket?.connected && this.code) this.socket.emit('p2p_keepalive', this.code);
    }, this.keepaliveMs);
  }

  stopKeepalive() {
    if (this.keepaliveTimer === null) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }
}

export class PeerConnectionCoordinator {
  constructor({ signaling = new SocketIOSignalingClient(), reconnectDelayMs = 750, maxReconnectAttempts = 3 } = {}) {
    this.signaling = signaling;
    this.reconnectDelayMs = reconnectDelayMs;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.role = null;
    this.code = null;
    this.hostId = null;
    this.links = new Map();
    this.connectionTimers = new Map();
    this.joinTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.onStatus = null;
    this.onHosted = null;
    this.onConnected = null;
    this.onDisconnected = null;
    this.onClosed = null;
    this.bindSignaling();
  }

  bindSignaling() {
    this.signaling.onConnected = () => this.onStatus?.('signaling_connected');
    this.signaling.onHosted = (data) => {
      if (this.role !== 'host') return;
      this.code = data.code;
      this.onStatus?.('waiting_for_peers');
      this.onHosted?.(data);
    };
    this.signaling.onJoined = (data) => {
      if (this.role !== 'guest') return;
      this.cancelJoinTimeout();
      this.code = data.code;
      this.hostId = data.hostId;
      this.createGuestLink(data.hostId);
      this.onStatus?.('connecting_to_host');
    };
    this.signaling.onPeerJoined = (data) => {
      if (this.role !== 'host' || data.code !== this.code) return;
      void this.createHostLink(data.peerId).catch((error) => this.failPeer(data.peerId, error));
    };
    this.signaling.onSignal = (data) => {
      if (data.code !== this.code) return;
      void this.acceptSignal(data.fromId, data.signal).catch((error) => this.failPeer(data.fromId, error));
    };
    this.signaling.onPeerLeft = (peerId) => this.removePeer(peerId, 'peer_left');
    this.signaling.onHostLeft = () => {
      if (this.role !== 'guest') return;
      this.onStatus?.('host_left');
      this.disconnect('host_left');
    };
    this.signaling.onError = (message) => {
      this.onStatus?.('error', message);
      if ((this.role === 'guest' && this.links.size === 0) || (this.role === 'host' && !this.code)) this.disconnect('signaling_error');
    };
  }

  host() {
    this.resetConnections();
    this.role = 'host';
    this.onStatus?.('creating_session');
    this.signaling.connect();
    this.signaling.host();
  }

  join(code) {
    this.resetConnections();
    this.role = 'guest';
    this.code = sanitizeRoomCode(code);
    if (!this.code) {
      this.role = null;
      this.onStatus?.('invalid_code');
      return false;
    }
    this.onStatus?.('joining_session');
    this.signaling.connect();
    this.armJoinTimeout();
    if (!this.signaling.join(this.code)) {
      this.cancelJoinTimeout();
      this.role = null;
      this.onStatus?.('invalid_code');
      return false;
    }
    return true;
  }

  async createHostLink(peerId) {
    this.removePeer(peerId, 'replaced');
    const link = this.configureLink(peerId, new WebRtcPeerLink({ initiator: true }));
    this.links.set(peerId, link);
    this.armConnectionTimeout(peerId);
    const offer = await link.createOffer();
    if (this.links.get(peerId) !== link) return null;
    this.signaling.sendSignal(peerId, offer);
    this.onStatus?.('peer_connecting', peerId);
    return link;
  }

  createGuestLink(hostId) {
    this.removePeer(hostId, 'replaced');
    const link = this.configureLink(hostId, new WebRtcPeerLink({ initiator: false }));
    this.links.set(hostId, link);
    this.armConnectionTimeout(hostId);
    return link;
  }

  configureLink(peerId, link) {
    link.onSignal = (signal) => this.signaling.sendSignal(peerId, signal);
    link.onTransport = (transport) => {
      this.cancelConnectionTimeout(peerId);
      this.reconnectAttempts = 0;
      this.cancelReconnect();
      this.onStatus?.('connected', peerId);
      this.onConnected?.({ role: this.role, peerId, transport });
    };
    link.onStateChange = (state) => {
      if (['failed', 'disconnected', 'closed'].includes(state)) this.removePeer(peerId, state);
    };
    return link;
  }

  async acceptSignal(fromId, signal) {
    let link = this.links.get(fromId);
    if (!link && this.role === 'guest' && fromId === this.hostId) link = this.createGuestLink(fromId);
    if (!link) return false;
    const response = await link.acceptSignal(signal);
    if (response) this.signaling.sendSignal(fromId, response);
    return true;
  }

  removePeer(peerId, reason = 'removed') {
    const link = this.links.get(peerId);
    if (!link) return false;
    this.links.delete(peerId);
    this.cancelConnectionTimeout(peerId);
    const shouldReconnect = this.role === 'guest'
      && peerId === this.hostId
      && ['failed', 'disconnected', 'channel_error'].includes(reason);
    link.close();
    if (this.role === 'guest' && peerId === this.hostId) this.hostId = null;
    this.onDisconnected?.({ role: this.role, peerId, reason });
    if (shouldReconnect) this.scheduleReconnect();
    return true;
  }

  scheduleReconnect() {
    if (this.role !== 'guest' || !this.code || this.reconnectTimer !== null) return false;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onStatus?.('connection_lost');
      this.disconnect('connection_lost');
      return false;
    }
    this.reconnectAttempts += 1;
    this.onStatus?.('reconnecting', this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.armJoinTimeout();
      if (!this.signaling.join(this.code)) this.disconnect('reconnect_failed');
    }, this.reconnectDelayMs * this.reconnectAttempts);
    return true;
  }

  armJoinTimeout() {
    this.cancelJoinTimeout();
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (this.role === 'guest' && !this.hostId) {
        this.onStatus?.('join_timeout');
        this.disconnect('join_timeout');
      }
    }, 60_000);
  }

  cancelJoinTimeout() {
    if (this.joinTimer === null) return;
    clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }

  armConnectionTimeout(peerId) {
    this.cancelConnectionTimeout(peerId);
    this.connectionTimers.set(peerId, setTimeout(() => {
      this.connectionTimers.delete(peerId);
      if (this.links.has(peerId)) this.failPeer(peerId, new Error('direct peer connection timed out'));
    }, 20_000));
  }

  cancelConnectionTimeout(peerId) {
    const timer = this.connectionTimers.get(peerId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.connectionTimers.delete(peerId);
  }

  cancelReconnect() {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  failPeer(peerId, error) {
    this.onStatus?.('error', error?.message || 'peer negotiation failed');
    this.removePeer(peerId, 'negotiation_failed');
  }

  disconnect(reason = 'closed') {
    const previousRole = this.role;
    this.cancelJoinTimeout();
    this.cancelReconnect();
    for (const peerId of [...this.connectionTimers.keys()]) this.cancelConnectionTimeout(peerId);
    for (const peerId of [...this.links.keys()]) this.removePeer(peerId, reason);
    this.signaling.disconnect();
    this.role = null;
    this.code = null;
    this.hostId = null;
    this.reconnectAttempts = 0;
    this.onClosed?.({ role: previousRole, reason });
  }

  resetConnections() {
    if (this.role || this.links.size > 0 || this.signaling.socket) this.disconnect('restarting');
  }
}

export function sanitizeRoomCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return code.length === 6 ? code : '';
}

function normalizeChannelData(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return null;
}

function channelDataBytes(value) {
  return typeof value === 'string' ? value.length * 2 : value.byteLength;
}

function plainDescription(description) {
  return { type: description.type, sdp: description.sdp };
}

function validPeerId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function safeSignal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 0 && encoded.length <= 100_000;
  } catch {
    return false;
  }
}
