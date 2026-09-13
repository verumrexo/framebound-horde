import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { P2PGuestSession, P2PHostSession } from '../src/core/p2p-session.js';
import { PROTOTYPE_SESSION_CONFIG } from '../src/core/session-config.js';
import { AUTHORITY_TICK_RATE, COMMAND } from '../src/core/protocol.js';

let tests = 0;
function test(label, run) {
  run();
  console.log(`ok ${++tests} - ${label}`);
}

// Deterministic wall clock and ordered, bandwidth-limited delivery. Presence has
// its own lane so a snapshot can stall gameplay while cursors still arrive.
function withNetwork(run) {
  let now = 0;
  const clockDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  const deliveries = [];
  class Transport {
    readyState = 'open';
    listeners = new Set();
    latencyMs = 40;
    bytesPerMs = Infinity;
    nextDeliveryAt = 0;
    controls = [];
    omitNextBinary = false;
    immediate = false;
    send(value) {
      if (this.readyState !== 'open') return false;
      const data = typeof value === 'string' ? value
        : value instanceof ArrayBuffer ? value.slice(0)
          : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      if (typeof data === 'string') this.controls.push(JSON.parse(data));
      else if (this.omitNextBinary) { this.omitNextBinary = false; return true; }
      if (this.immediate) {
        for (const listener of this.other.listeners) listener(data);
        return true;
      }
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
      this.nextDeliveryAt = Math.max(now + this.latencyMs, this.nextDeliveryAt) + bytes / this.bytesPerMs;
      deliveries.push({ at: this.nextDeliveryAt, target: this.other, data });
      return true;
    }
    onMessage(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    onOpen() { return () => {}; }
    onClose() { return () => {}; }
    close() { this.readyState = 'closed'; }
  }
  const hostBundle = {}, guestBundle = {};
  for (const lane of ['gameplay', 'social', 'presence']) {
    hostBundle[lane] = new Transport();
    guestBundle[lane] = new Transport();
    hostBundle[lane].other = guestBundle[lane];
    guestBundle[lane].other = hostBundle[lane];
  }
  const host = new P2PHostSession(new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG), { clientId: 'recovery_host' });
  const guest = new P2PGuestSession(new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG), { clientId: 'recovery_guest' });
  const step = (duration) => {
    const end = now + duration;
    while (now < end) {
      const elapsed = Math.min(20, end - now);
      now += elapsed;
      host.advance(elapsed);
      for (let index = 0; index < deliveries.length;) {
        const message = deliveries[index];
        if (message.at > now) { index++; continue; }
        deliveries.splice(index, 1);
        for (const listener of message.target.listeners) listener(message.data);
      }
      guest.advance(elapsed);
    }
  };
  const seedLateRun = (enemies) => {
    host.authority.state.phase = 'running';
    host.authority.state.runTick = 14 * 60 * AUTHORITY_TICK_RATE;
    host.authority.state.dev = { paused: true, infiniteHealth: true, stopSpawns: true };
    host.authority.swarm.tickNumber = host.authority.state.runTick;
    for (let index = 0; index < enemies; index++) host.authority.swarm.spawnOne(host.authority.map.spawnSources[0], 100);
  };
  try {
    host.connect();
    host.advance(20);
    host.attachPeer('recovery_peer', hostBundle);
    guest.attachTransport(guestBundle);
    step(1000);
    assert.equal(guest.synced, true);
    hostBundle.gameplay.controls.length = 0;
    guestBundle.gameplay.controls.length = 0;
    run({ host, guest, hostBundle, guestBundle, step, seedLateRun });
  } finally {
    if (clockDescriptor) Object.defineProperty(performance, 'now', clockDescriptor);
    else delete performance.now;
  }
}

test('a slow late-run snapshot catches up without entering a correction loop', () => withNetwork((network) => {
  const { host, guest, hostBundle, guestBundle, step, seedLateRun } = network;
  seedLateRun(2000);
  host.authority.state.dev.paused = false;
  hostBundle.gameplay.bytesPerMs = 16; // A real ~225 KB correction takes over fourteen seconds.
  hostBundle.gameplay.latencyMs = 750;
  assert.equal(guest.requestResync('late_run'), true);
  step(2000);
  assert.equal(guest.resyncPending, true);
  assert.ok(guest.receiver.pending, 'snapshot is still arriving');
  let hostCursor = null, guestCursor = null;
  host.onPresence = (value) => { guestCursor = value; };
  guest.onPresence = (value) => { hostCursor = value; };
  const point = host.authority.map.base;
  host.sendPresence({ active: true, ...point });
  guest.sendPresence({ active: true, ...point });
  step(100);
  assert.equal(hostCursor.playerId, host.playerId);
  assert.equal(guestCursor.playerId, guest.playerId);
  step(23_000);
  assert.equal(guest.resyncPending, false);
  assert.equal(guest.stalled, false);
  assert.ok(host.authority.state.tick - guest.authority.state.tick < 65, 'replica catches up to the delayed host clock');
  assert.equal(guestBundle.gameplay.controls.filter((value) => value.type === 'resync_request').length, 1);
  assert.equal(hostBundle.gameplay.controls.filter((value) => value.type === 'packet').length, 1);
  assert.equal(guest.send(COMMAND.PLAYER_RENAME, { label: 'recovered' }), true);
  step(1500);
  assert.equal(host.authority.state.players.find((player) => player.id === guest.playerId).label, 'recovered');
  assert.equal(guest.authority.state.players.find((player) => player.id === guest.playerId).label, 'recovered');
  while (guest.authority.state.tick < host.authority.state.tick) guest.authority.tick();
  assert.equal(guest.authority.swarm.updateChecksum(), host.authority.swarm.updateChecksum());
  assert.deepEqual(guest.authority.state.stats, host.authority.state.stats);
}));

test('an incomplete snapshot is retried even while normal sync messages keep arriving', () => withNetwork((network) => {
  const { guest, hostBundle, guestBundle, step, seedLateRun } = network;
  seedLateRun(1000);
  hostBundle.gameplay.omitNextBinary = true;
  assert.equal(guest.requestResync('incomplete_snapshot'), true);
  step(1000);
  assert.equal(guest.resyncPending, true);
  assert.ok(guest.receiver.pending);
  step(15_000);
  assert.equal(guest.resyncPending, false);
  assert.equal(guest.receiver.pending, null);
  assert.equal(guest.synced, true);
  assert.equal(guestBundle.gameplay.controls.filter((value) => value.type === 'resync_request').length, 2);
}));

test('host coalesces a rate-limited recovery request instead of discarding it', () => withNetwork((network) => {
  const { host, guest, hostBundle, guestBundle, step } = network;
  host.peers.get('recovery_peer').lastResyncAt = performance.now() - 1000;
  assert.equal(guest.requestResync('cooldown'), true);
  step(1400);
  assert.equal(guest.resyncPending, false);
  assert.equal(hostBundle.gameplay.controls.filter((value) => value.type === 'packet').length, 1);
  assert.equal(guestBundle.gameplay.controls.filter((value) => value.type === 'resync_request').length, 1);
}));

test('an immediately returned correction clears the pending request', () => withNetwork((network) => {
  const { guest, hostBundle, guestBundle } = network;
  hostBundle.gameplay.immediate = true;
  guestBundle.gameplay.immediate = true;
  assert.equal(guest.requestResync('immediate'), true);
  assert.equal(guest.resyncPending, false);
}));

test('actual state divergence still requests and applies an authoritative correction', () => withNetwork((network) => {
  const { host, guest, guestBundle, step } = network;
  guest.minimumChecksumRunTick = 0;
  guest.authority.state.teamEconomy.credits += 100;
  step(1000);
  assert.ok(guestBundle.gameplay.controls.some((value) => value.type === 'resync_request' && value.reason === 'checksum_mismatch'));
  assert.equal(guest.resyncPending, false);
  assert.deepEqual(guest.authority.state.teamEconomy, host.authority.state.teamEconomy);
}));

console.log(`${tests} peer recovery groups passed`);
