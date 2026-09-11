import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { P2PGuestSession, P2PHostSession, REMOTE_COMMANDS } from '../src/core/p2p-session.js';
import { PROTOTYPE_SESSION_CONFIG } from '../src/core/session-config.js';
import { AUTHORITY_TICK_RATE, COMMAND } from '../src/core/protocol.js';
import { sendPeerControl } from '../src/core/p2p-wire.js';
import { researchNode } from '../src/core/research.js';

let tests = 0;
function test(label, fn) {
  fn();
  console.log(`ok ${++tests} - ${label}`);
}

function authority() {
  return new EmbeddedAuthority({ ...PROTOTYPE_SESSION_CONFIG, sessionId: `coop_${tests}` });
}

function addPlayers(a) {
  a.join({ clientId: 'alpha_client', payload: { label: 'alpha' } });
  a.join({ clientId: 'beta_client', payload: { label: 'beta' } });
  return a.state.players;
}

test('shared pool stays fixed and teammates may upgrade and sell creator-attributed towers', () => {
  const a = authority();
  const [alpha, beta] = addPlayers(a);
  assert.equal(a.state.teamEconomy.credits, PROTOTYPE_SESSION_CONFIG.startingCredits);
  a.state.teamEconomy.credits = 10_000;
  const area = a.map.defenseAreas[0];
  a.placeTower({ payload: { definitionId: 'frame', x: area.shape.x, y: area.shape.y } }, alpha);
  const tower = a.state.towers[0];
  assert.equal(tower.ownerId, alpha.id);
  a.evolveTower({ payload: { towerId: tower.id, definitionId: 'assault' } }, beta);
  assert.equal(tower.definitionId, 'assault');
  assert.equal(tower.ownerId, alpha.id);
  const before = a.state.teamEconomy.credits;
  a.sellTower({ payload: { towerId: tower.id } }, beta);
  assert.ok(a.state.teamEconomy.credits > before);
  assert.equal(a.state.contributionByPlayer[alpha.id].towersCreated, 1);
  assert.equal(a.state.contributionByPlayer[beta.id].towersSold, 1);
});

test('guest disconnect never pauses and timeout leaves attributed towers shared', () => {
  const a = authority();
  const [alpha, beta] = addPlayers(a);
  a.state.phase = 'running';
  a.state.dev = { paused: true };
  const area = a.map.defenseAreas[0];
  a.state.teamEconomy.credits = 10_000;
  a.placeTower({ payload: { definitionId: 'frame', x: area.shape.x, y: area.shape.y } }, beta);
  a.disconnectPlayer({}, beta);
  assert.equal(a.state.phase, 'running');
  assert.equal(beta.connectionState, 'reconnecting');
  for (let tick = 0; tick <= AUTHORITY_TICK_RATE * 90; tick += 1) a.tick();
  assert.equal(beta.connectionState, 'departed');
  assert.equal(a.state.phase, 'running');
  assert.equal(a.state.towers[0].ownerId, beta.id);
  a.setTowerTargeting({ payload: { towerId: a.state.towers[0].id, mode: 'closest' } }, alpha);
  assert.equal(a.state.towers[0].targetingMode, 'closest');
});

test('teammates may buy global research from creator-attributed stations', () => {
  const a = authority();
  const [alpha, beta] = addPlayers(a);
  const area = a.map.defenseAreas[0];
  const station = a.normalizeTower({
    id: 'tower_station', definitionId: 'arsenal', ownerId: alpha.id,
    x: area.shape.x, y: area.shape.y, areaId: area.id, totalInvestment: 1000
  });
  a.state.towers.push(station);
  a.state.teamEconomy.credits = 1_000_000;
  const node = researchNode(1);
  a.purchaseResearch({ payload: { towerId: station.id, researchId: node.id, expectedCost: node.cost } }, beta);
  assert.deepEqual(a.state.research.unlocked, [node.id]);
  assert.equal(a.state.contributionByPlayer[beta.id].creditsSpent, node.cost);
  assert.equal(station.ownerId, alpha.id);
});

test('protocol 22 wallet snapshots migrate into one team pool', () => {
  const source = authority();
  const [alpha, beta] = addPlayers(source);
  const correction = source.correctionSnapshot();
  correction.protocolVersion = 22;
  correction.state.protocolVersion = 22;
  correction.state.economyByPlayer = {
    [alpha.id]: { credits: 125, totalEarned: 20, totalSpent: 5 },
    [beta.id]: { credits: 75, totalEarned: 10, totalSpent: 15 }
  };
  delete correction.state.teamEconomy;
  delete correction.state.contributionByPlayer;
  const restored = authority();
  restored.applyCorrectionSnapshot(correction);
  assert.deepEqual(restored.state.teamEconomy, { credits: 200, totalEarned: 30, totalSpent: 20 });
  assert.ok(restored.state.contributionByPlayer[alpha.id]);
  assert.ok(restored.state.contributionByPlayer[beta.id]);
});

test('guest allowlist exposes every cooperative tower and station action', () => {
  for (const command of [
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
  ]) assert.equal(REMOTE_COMMANDS.has(command), true, command);
});

class MemoryTransport {
  constructor() {
    this.readyState = 'open';
    this.listeners = new Set();
    this.closeListeners = new Set();
    this.other = null;
  }
  send(value) {
    if (this.readyState !== 'open' || this.other?.readyState !== 'open') return false;
    const copy = value instanceof ArrayBuffer ? value.slice(0) : value;
    for (const listener of this.other.listeners) listener(copy);
    return true;
  }
  onMessage(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onOpen(listener) { queueMicrotask(listener); return () => {}; }
  onClose(listener) { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }
  close(reason = 'closed') {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    for (const listener of this.closeListeners) listener(reason);
  }
}

function lanePair() {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.other = right;
  right.other = left;
  return [left, right];
}

function bundlePair() {
  const gameplay = lanePair();
  const social = lanePair();
  const presence = lanePair();
  return [
    { gameplay: gameplay[0], social: social[0], presence: presence[0] },
    { gameplay: gameplay[1], social: social[1], presence: presence[1] }
  ];
}

test('four-peer host session authenticates social presence and reconnects without pausing', () => {
  const hostAuthority = authority();
  const host = new P2PHostSession(hostAuthority, { clientId: 'host_client', label: 'host' });
  host.connect();
  host.advance(20);
  const pumpHost = () => { for (let index = 0; index < 4; index += 1) host.advance(100); };
  const guests = [];
  for (let index = 0; index < 3; index += 1) {
    const guestAuthority = authority();
    const guest = new P2PGuestSession(guestAuthority, { clientId: `guest_${index}`, label: `guest ${index}` });
    const [hostBundle, guestBundle] = bundlePair();
    host.attachPeer(`peer_${index}`, hostBundle);
    guest.attachTransport(guestBundle);
    pumpHost();
    assert.equal(guest.synced, true);
    guests.push({ guest, hostBundle, guestBundle });
  }
  assert.equal(hostAuthority.state.players.length, 4);
  assert.equal(hostAuthority.state.teamEconomy.credits, PROTOTYPE_SESSION_CONFIG.startingCredits);
  const social = [];
  const presence = [];
  host.onSocial = (message) => social.push(message);
  host.onPresence = (message) => presence.push(message);
  assert.equal(guests[0].guest.sendChat('hello team'), true);
  assert.equal(social.at(-1).playerId, guests[0].guest.playerId);
  assert.equal(social.at(-1).text, 'hello team');
  sendPeerControl(guests[0].guestBundle.social, 'social_request', {
    kind: 'chat', text: 'forged identity', playerId: host.playerId
  });
  assert.equal(social.at(-1).playerId, guests[0].guest.playerId);
  assert.equal(guests[0].guest.sendChat('x'.repeat(200)), true);
  assert.equal(social.at(-1).text.length, 160);
  for (let index = 0; index < 8; index += 1) guests[0].guest.sendChat(`spam ${index}`);
  assert.equal(social.length, 4);
  const point = hostAuthority.map.base;
  assert.equal(guests[0].guest.sendPresence({ active: true, x: point.x, y: point.y, activity: 'looking' }), true);
  assert.equal(presence.at(-1).playerId, guests[0].guest.playerId);
  sendPeerControl(guests[0].guestBundle.presence, 'presence', {
    sourceSequence: 3, active: true, x: point.x + 1, y: point.y, activity: 'looking', playerId: host.playerId
  });
  sendPeerControl(guests[0].guestBundle.presence, 'presence', {
    sourceSequence: 2, active: true, x: point.x + 2, y: point.y, activity: 'looking'
  });
  assert.equal(presence.at(-1).x, Math.round(point.x + 1));
  assert.equal(presence.at(-1).playerId, guests[0].guest.playerId);
  const acceptedPresence = presence.length;
  sendPeerControl(guests[0].guestBundle.presence, 'presence', {
    sourceSequence: 4, active: true, x: -999999, y: -999999, activity: 'placing', definitionId: 'fake'
  });
  assert.equal(presence.length, acceptedPresence);
  const token = guests[0].guest.resumeToken;
  host.detachPeer('peer_0');
  pumpHost();
  assert.equal(hostAuthority.state.phase, 'lobby');
  assert.equal(hostAuthority.state.players[1].connectionState, 'reconnecting');
  const [rehost, reguest] = bundlePair();
  host.attachPeer('peer_0_reconnect', rehost);
  guests[0].guest.attachTransport(reguest);
  assert.equal(guests[0].guest.resumeToken, token);
  pumpHost();
  assert.equal(hostAuthority.state.players[1].connectionState, 'connected');
  assert.equal(guests[0].guest.synced, true);
});

async function waitUntil(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for relay state');
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('relay websocket failed to open'));
  });
  return socket;
}

async function testRelayRoutesThreeGuests() {
  const port = 20_000 + (process.pid % 10_000);
  const child = spawn(process.execPath, ['scripts/relay-server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  const sockets = [];
  try {
    const relayReady = await waitUntil(async () => {
      if (child.exitCode !== null) return 'unavailable';
      try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
    });
    if (relayReady === 'unavailable') {
      console.log('skip - websocket fallback socket binding is unavailable in this environment');
      return;
    }
    const room = 'COOP23';
    const host = await openSocket(`ws://127.0.0.1:${port}/relay?room=${room}&role=host`);
    sockets.push(host);
    const hostMessages = [];
    host.onmessage = (event) => hostMessages.push(event.data);
    const guests = [];
    const guestMessages = [[], [], []];
    for (let index = 0; index < 3; index += 1) {
      const guest = await openSocket(`ws://127.0.0.1:${port}/relay?room=${room}&role=guest`);
      guest.onmessage = (event) => guestMessages[index].push(event.data);
      guests.push(guest);
      sockets.push(guest);
    }
    await waitUntil(() => hostMessages.filter((value) => typeof value === 'string').length === 3);
    const peerIds = hostMessages.filter((value) => typeof value === 'string').map((value) => JSON.parse(value).peerId);
    assert.deepEqual(peerIds, ['relay-guest-1', 'relay-guest-2', 'relay-guest-3']);
    for (let index = 0; index < 3; index += 1) guests[index].send(new Uint8Array([10 + index, 20 + index]));
    await waitUntil(() => hostMessages.filter((value) => value instanceof ArrayBuffer).length === 3);
    const routed = hostMessages.filter((value) => value instanceof ArrayBuffer).map((value) => [...new Uint8Array(value)]);
    assert.deepEqual(routed, [[1, 10, 20], [2, 11, 21], [3, 12, 22]]);
    for (let slot = 1; slot <= 3; slot += 1) host.send(new Uint8Array([slot, 30 + slot]));
    await waitUntil(() => guestMessages.every((messages) => messages.some((value) => value instanceof ArrayBuffer)));
    assert.deepEqual(guestMessages.map((messages) => [...new Uint8Array(messages.find((value) => value instanceof ArrayBuffer))]), [[31], [32], [33]]);
    host.close();
    await waitUntil(() => guestMessages.every((messages) => messages.some((value) => typeof value === 'string' && JSON.parse(value).peerId === 'relay-host')));
    console.log(`ok ${++tests} - websocket fallback routes three guests and reports host loss`);
  } finally {
    for (const socket of sockets) try { socket.close(); } catch {}
    child.kill('SIGTERM');
  }
}

await testRelayRoutesThreeGuests();

console.log(`${tests} cooperative multiplayer groups passed`);
