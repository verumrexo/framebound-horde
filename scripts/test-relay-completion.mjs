import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { EVENT, PROTOCOL_VERSION } from '../src/core/protocol.js';
import { networkSources, relayLinkPairs, saleRefund } from '../src/core/network-descendants.js';
import { towerPlacementClear } from '../src/core/placement.js';
import { findDefenseAreaAt, getMapDefinition, playableMaps, relayEligibleAreaIds } from '../src/core/world-config.js';

let checks = 0;
function test(label, run) { run(); checks++; console.log(`ok ${checks} - ${label}`); }
// A run-style authority (no sandbox config) on the two-nebula test map: completion is a
// run mechanic, so the sandbox test field itself never retires its single inspectable tower.
const RUN_ON_TEST_MAP = { ...TEST_FIELD_SESSION_CONFIG, test: null };
function setup() {
  const a = new EmbeddedAuthority(RUN_ON_TEST_MAP);
  a.join({ clientId: 'test', payload: { label: 'test' } });
  const player = a.state.players[0];
  const [areaA, areaB] = a.map.defenseAreas;
  function add(id, area = areaA, offsetX = 0) {
    const tower = a.normalizeTower({ id: `tower_${a.nextTowerNumber++}`, definitionId: id, ownerId: player.id,
      x: area.shape.x + offsetX, y: area.shape.y, areaId: area.id, totalInvestment: 900 });
    a.state.towers.push(tower);
    a.modifierCache = null;
    return tower;
  }
  const command = (payload) => ({ clientId: 'test', playerId: player.id, sequence: 1, payload });
  return { a, player, areaA, areaB, add, command };
}

test('every production map is fully relay-eligible and the set is deterministic', () => {
  for (const map of [...playableMaps(), getMapDefinition('test_field')]) {
    const eligible = relayEligibleAreaIds(map);
    assert.deepEqual([...eligible], map.defenseAreas.map((area) => area.id).sort(), map.id);
    assert.equal(relayEligibleAreaIds(map), eligible, 'cached per map');
  }
});

test('completing the network retires connector relays, refunds them, keeps buffs and frees their footprint', () => {
  const { a, player, areaA, areaB, add } = setup();
  const weapon = add('barrage', areaB);
  add('overclock', areaA, 40);
  const relay = add('relay', areaA, 80);
  const amplifier = add('amplifier', areaB, 40);
  a.rebuildModifierCache(); a.syncTowerStats();
  assert.equal(relay.relayTargetAreaId, areaB.id, 'the relay auto-links the only other nebula');
  const buffedCadence = weapon.effectiveCadence;
  assert.ok(buffedCadence > 6, 'overclock reaches across the relay link');
  const before = a.state.teamEconomy.credits;
  const expectedRefund = saleRefund(a.state, relay);
  a.events.length = 0;
  a.tick();
  const network = a.state.relayNetwork;
  assert.equal(network.completedTick, a.state.runTick);
  assert.deepEqual(network.links, [[areaA.id, areaB.id].sort()]);
  assert.ok(!a.state.towers.some((tower) => tower.definitionId === 'relay'), 'plain connectors are gone');
  assert.ok(a.state.towers.some((tower) => tower.id === amplifier.id), 'relay descendants with mechanics stay');
  assert.equal(network.retired.length, 1);
  assert.equal(network.retired[0].towerId, relay.id);
  assert.equal(network.retired[0].refund, expectedRefund);
  assert.equal(a.state.teamEconomy.credits - before, expectedRefund);
  const event = a.events.find((item) => item.type === EVENT.RELAY_NETWORK_COMPLETED);
  assert.ok(event, 'a completion event is emitted for presentation');
  assert.deepEqual(event.payload.areaIds, [areaA.id, areaB.id].sort());
  assert.equal(event.payload.retired[0].x, relay.x);
  a.tick();
  assert.equal(weapon.effectiveCadence, buffedCadence, 'the overclock still reaches the other nebula without the relay');
  assert.deepEqual(a.networkAreasByArea.get(areaB.id), [areaA.id, areaB.id].sort());
  assert.ok(towerPlacementClear(a.state.towers, relay.x, relay.y), 'the old relay footprint is buildable again');
  assert.deepEqual([...new Set(relayLinkPairs(a.state).map((pair) => [...pair].sort().join('|')))], [[areaA.id, areaB.id].sort().join('|')]);
  assert.ok(networkSources(a.state, areaB.id).some((tower) => tower.definitionId === 'overclock'), 'shared helpers see the retained link');
});

test('completion never retriggers; later relays stay buildable and upgradeable', () => {
  const { a, areaA, areaB, add, command, player } = setup();
  add('relay', areaA, 80); a.tick();
  const firstTick = a.state.relayNetwork.completedTick;
  assert.equal(a.state.relayNetwork.retired.length, 1);
  const late = add('relay', areaA, 110);
  for (let i = 0; i < 5; i += 1) a.tick();
  assert.equal(a.state.relayNetwork.completedTick, firstTick);
  assert.equal(a.state.relayNetwork.retired.length, 1);
  assert.ok(a.state.towers.some((tower) => tower.id === late.id), 'post-completion relays remain as descendant stepping stones');
  a.state.teamEconomy.credits = 1e9;
  a.evolveTower(command({ towerId: late.id, definitionId: 'echo' }), player);
  assert.equal(late.definitionId, 'echo');
  assert.deepEqual(late.networkAreaIds, [areaA.id, areaB.id].sort());
  a.sellTower(command({ towerId: late.id }), player); a.tick();
  assert.equal(a.networkAreasByArea.get(areaB.id).length, 2, 'selling every relay-family tower cannot break the completed network');
});

test('incomplete networks and the sandbox test field keep their relays', () => {
  const { a, add } = setup();
  const relay = add('relay');
  relay.relayTargetAreaId = null;
  a.validRelayTargetAreaId = () => null; // no reachable target: the network stays incomplete
  a.tick();
  assert.equal(a.state.relayNetwork.completedTick, null);
  assert.ok(a.state.towers.some((tower) => tower.id === relay.id));
  const field = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  field.join({ clientId: 'tester', payload: { label: 'tester' } });
  const area = field.map.defenseAreas[0];
  field.state.towers.push(field.normalizeTower({ id: 'tower_1', definitionId: 'relay', ownerId: field.state.players[0].id,
    x: area.shape.x + 80, y: area.shape.y, areaId: area.id, totalInvestment: 900 }));
  field.modifierCache = null;
  for (let i = 0; i < 5; i += 1) field.tick();
  assert.equal(field.state.towers[0].relayTargetAreaId, field.map.defenseAreas[1].id, 'the test relay still links');
  assert.equal(field.state.relayNetwork.completedTick, null, 'the test field never retires its inspectable tower');
});

test('saves, corrections and fresh runs reproduce the completed state exactly', () => {
  const { a, areaA, areaB, add } = setup();
  add('mint', areaA); add('barrage', areaB); add('relay', areaA, 80);
  a.tick();
  a.state.supportCounters['mint_income:test_area|test_link_area'] = 37;
  const correction = a.correctionSnapshot();
  const b = new EmbeddedAuthority(RUN_ON_TEST_MAP);
  b.applyCorrectionSnapshot(correction);
  assert.deepEqual(b.state.relayNetwork, a.state.relayNetwork);
  assert.equal(b.state.protocolVersion, PROTOCOL_VERSION);
  for (let i = 0; i < 60; i += 1) { a.tick(); b.tick(); }
  const strip = (snapshot) => { const { lastEventId, ...rest } = snapshot; return rest; };
  assert.deepEqual(strip(a.snapshot()), strip(b.snapshot()));
  assert.deepEqual(b.networkAreasByArea.get(areaB.id), [areaA.id, areaB.id].sort());
  assert.equal(b.state.supportCounters['mint_income:test_area|test_link_area'], 37);
  // an old save without the field loads as an untouched network.
  const legacy = a.correctionSnapshot(); legacy.protocolVersion = 20; delete legacy.state.relayNetwork;
  const c = new EmbeddedAuthority(RUN_ON_TEST_MAP); c.applyCorrectionSnapshot(legacy);
  assert.deepEqual(c.state.relayNetwork, { completedTick: null, links: [], retired: [] });
  a.resetFreshRun();
  assert.deepEqual(a.state.relayNetwork, { completedTick: null, links: [], retired: [] });
});

test('a production map completes only when every nebula is joined', () => {
  const a = new EmbeddedAuthority({ ...PROTOTYPE_SESSION_CONFIG, mapId: 'map_07', autoStart: true });
  a.join({ clientId: 'host', payload: { label: 'host' } });
  const player = a.state.players[0];
  a.state.teamEconomy.credits = 1e12;
  const eligible = relayEligibleAreaIds(a.map);
  assert.equal(eligible.length, 34);
  // Link areas in a chain by placing relays that target their linkable neighbour.
  const areas = a.map.defenseAreas;
  const placed = [];
  const linked = new Set([areas[0].id]);
  let progress = true;
  while (progress && linked.size < areas.length) {
    progress = false;
    for (const area of areas) {
      if (!linked.has(area.id)) continue;
      for (const other of areas) {
        if (linked.has(other.id)) continue;
        let spot = null;
        for (const fx of [0, 0.5, -0.5, 0.8, -0.8]) for (const fy of [0, 0.5, -0.5, 0.8, -0.8]) {
          const x = Math.round(area.shape.x + fx * area.shape.radiusX), y = Math.round(area.shape.y + fy * area.shape.radiusY);
          if (spot || findDefenseAreaAt(a.map, x, y) !== area.id || !towerPlacementClear(a.state.towers, x, y)) continue;
          if (a.validRelayTargetAreaId({ definitionId: 'relay', areaId: area.id, x, y }, other.id)) spot = { x, y };
        }
        if (!spot) continue;
        const tower = a.normalizeTower({ id: `tower_${a.nextTowerNumber++}`, definitionId: 'relay', ownerId: player.id,
          ...spot, areaId: area.id, relayTargetAreaId: other.id, totalInvestment: 900 });
        a.state.towers.push(tower); placed.push(tower); linked.add(other.id); progress = true;
        if (linked.size === areas.length) break;
      }
      if (linked.size === areas.length) break;
    }
  }
  assert.equal(linked.size, areas.length);
  // Remove the last link: the network must stay incomplete.
  const last = a.state.towers.pop();
  a.modifierCache = null; a.tick();
  assert.equal(a.state.relayNetwork.completedTick, null);
  a.state.towers.push(last); a.modifierCache = null; a.tick();
  assert.equal(a.state.relayNetwork.completedTick, a.state.runTick);
  assert.equal(a.state.relayNetwork.retired.length, placed.length);
  assert.equal(a.state.towers.length, 0);
  assert.equal(a.state.relayNetwork.links.length, placed.length);
  a.tick();
  for (const area of areas) assert.equal(a.networkAreasByArea.get(area.id).length, 34);
});

console.log(`${checks} relay completion groups passed`);
