import assert from 'node:assert/strict';
import { healthBudgetAt, spawnProfileAt } from '../src/core/progression.js';
import { getMapDefinition, playableMaps, defenseAreaField } from '../src/core/world-config.js';
import { EnemySwarm } from '../src/core/enemy-swarm.js';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot, resolveAttackPlans } from '../src/core/effect-system.js';
import { towerPlacementClear } from '../src/core/placement.js';

const map = getMapDefinition('map_01');
const cap = spawnProfileAt(map, 20 * 3600).rate;
for (let seconds = 0; seconds <= 80 * 60; seconds++) {
  const profile = spawnProfileAt(map, seconds * 60);
  assert.ok(profile.rate <= cap + 1e-9);
  assert.ok(Math.abs(profile.rate * profile.meanHp / healthBudgetAt(map, seconds * 60) - 1) < 1e-12);
  if (seconds >= 1200) assert.ok(Math.abs(profile.rate - cap) < 1e-9);
}
assert.equal(spawnProfileAt(map, 120 * 60).meanHp, 1);
assert.equal(spawnProfileAt(map, 1200 * 60).meanHp, 2);
console.log('old economy budget retained; physical spawns flat from 20 minutes');

const source = { x: 0, y: -1300, spreadX: 1, spreadY: 1 };
const swarm = new EnemySwarm({ seed: 42, map });
for (let i = 0; i < 60; i++) swarm.spawnAtRate(60, [source], 1, 1.25);
let hp = 0, oranges = 0;
for (let i = 0; i < swarm.count; i++) {
  hp += swarm.hpById[swarm.idByIndex[i]];
  oranges += Number(swarm.hpById[swarm.idByIndex[i]] === 2);
}
assert.equal(hp, 75); assert.equal(oranges, 15);
const restored = new EnemySwarm({ seed: 42, map });
restored.applyCorrection(swarm.exportCorrection());
for (let i = 0; i < 61; i++) {
  swarm.spawnAtRate(60, [source], 1, 1.37);
  restored.spawnAtRate(60, [source], 1, 1.37);
}
assert.deepEqual(restored.exportCorrection(), swarm.exportCorrection());
const tough = swarm.spawnOne(source, 100000);
assert.equal(tough.hp, 100000);
assert.equal(swarm.damage(tough.id, tough.generation, 7).hpPopped, 7);
console.log('mixed colours, high hp and fractional spawn continuation survive corrections');

const a = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
a.join({ clientId: 'test', payload: { label: 'test' } });
const player = a.state.players[0];
const area = a.map.defenseAreas[0];
const command = (payload) => ({ clientId: 'test', playerId: player.id, sequence: 1, payload });
const x = area.shape.x, y = area.shape.y;
a.placeTower(command({ definitionId: 'frame', x, y }), player);
const credits = a.state.economyByPlayer[player.id].credits;
a.placeTower(command({ definitionId: 'frame', x, y }), player);
assert.equal(a.state.towers.length, 1);
assert.equal(a.state.economyByPlayer[player.id].credits, credits);
assert.equal(towerPlacementClear(a.state.towers, x + 23, y), false);
assert.equal(towerPlacementClear(a.state.towers, x + 24, y), true);
console.log('overlap rejected by authority without spending credits');

const tower = a.state.towers[0];
const attack = createAttackSnapshot(TOWER_DEFINITIONS.frame, tower);
const victim = a.swarm.spawnOne({ ...source, x: x + 50, y }, 3);
const starting = a.state.economyByPlayer[player.id].credits;
for (const amount of [1, 10]) {
  const hit = a.swarm.damage(victim.id, victim.generation, amount);
  a.recordAttackResult({ attack, hits: [hit], kills: hit.killed ? [hit] : [], controlTargets: [], createdFields: [] });
}
assert.equal(a.state.economyByPlayer[player.id].credits - starting, 3);
assert.equal(a.state.stats.kills, 1);
assert.equal(a.state.stats.hpPopped, 3);
const packet = a.swarm.spawnOne(source, 1, 4);
assert.equal(a.swarm.damage(packet.id, packet.generation, 100, { packetWide: true }).hpPopped, 4);
const bondVictim = a.swarm.spawnOne(source, 6);
a.swarm.damage(bondVictim.id, bondVictim.generation, 2);
assert.equal(a.swarm.kill(bondVictim.id, bondVictim.generation).hpPopped, 4);
console.log('nonlethal hp pays immediately; overkill, packets and direct kills cannot double-pay');

for (const id of ['map_01', 'map_02', 'map_03']) {
  const world = getMapDefinition(id);
  for (const spawn of world.spawnSources) assert.ok(spawn.y + spawn.spreadY <= world.bounds.bottom - 2);
  const boundarySwarm = new EnemySwarm({ seed: 1, map: world });
  boundarySwarm.spawnOne({ x: -1400, y: 5000, spreadX: 0, spreadY: 0 });
  boundarySwarm.tick(1);
  assert.ok(boundarySwarm.state[1] <= world.bounds.bottom - 2);
}
console.log('all production entrances and moving enemies remain above the bottom wall');

const relayAuthority = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, mapId: 'map_01' });
const relayArea = relayAuthority.map.defenseAreas.find((area) => relayAuthority.map.defenseAreas.some((target) =>
  target.id !== area.id && relayAuthority.validRelayTargetAreaId({ definitionId: 'relay', areaId: area.id, x: area.shape.x, y: area.shape.y }, target.id)));
function addRelay(id) {
  const relay = relayAuthority.normalizeTower({ id, definitionId: 'relay', areaId: relayArea.id, x: relayArea.shape.x, y: relayArea.shape.y });
  relayAuthority.state.towers.push(relay);
  relayAuthority.rebuildModifierCache();
  return relay;
}
const r1 = addRelay('relay_1');
const expected = relayAuthority.map.defenseAreas.filter((area) => relayAuthority.validRelayTargetAreaId(r1, area.id))
  .sort((a,b) => Math.hypot(a.shape.x-r1.x,a.shape.y-r1.y)-Math.hypot(b.shape.x-r1.x,b.shape.y-r1.y) || a.id.localeCompare(b.id))[0];
assert.equal(r1.relayTargetAreaId, expected.id);
const r2 = addRelay('relay_2');
assert.notEqual(r2.relayTargetAreaId, r1.relayTargetAreaId);
relayAuthority.rebuildModifierCache();
assert.equal(r1.relayTargetAreaId, expected.id);
console.log('relays automatically choose stable nearest available nebulae');

const multiVictim = a.swarm.spawnOne(source, 5);
const multiAttack = { ...attack, effects: [{ type: 'damage', amount: 1 }, { type: 'damage', amount: 2 }] };
const resolution = resolveAttackPlans(a.swarm, [{ attack: multiAttack, contact: multiVictim, victims: [multiVictim] }], { tick: 1, forceFields: [] });
assert.equal(resolution.results[0].hits[0].hpPopped, 3);
assert.equal(a.swarm.enemy(multiVictim.id, multiVictim.generation).hp, 2);
console.log('multiple damage effects report all hp removed, not only the last effect');

const production = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', mapId: 'map_01' });
production.state.swarm.meanHp = 608.5;
production.state.swarm.hpPerSecond = production.state.swarm.spawnRatePerSecond * 608.5;
const productionCopy = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', mapId: 'map_01' });
productionCopy.applyCorrectionSnapshot(production.correctionSnapshot());
assert.equal(productionCopy.state.swarm.meanHp, 608.5);
console.log('hp profile survives authority correction before the next tick');

// Check every authored nebula, not only a convenient test-field circle.
for (const world of playableMaps()) {
  for (const area of world.defenseAreas) {
    const spots = [];
    for (let y = area.shape.y - 100; y <= area.shape.y + 100; y += 24) {
      for (let x = area.shape.x - 160; x <= area.shape.x + 160; x += 24) {
        if (defenseAreaField(area, x, y) <= 0 && towerPlacementClear(spots, x, y)) spots.push({ x, y });
      }
    }
    assert.ok(spots.length >= 6, `${world.id}/${area.id}: fewer than six placements`);
  }
  for (const source of world.spawnSources) {
    assert.ok(world.sideWalls ? source.y <= -950 : Math.abs(source.x) >= 3000 || source.y <= -2600, 'rift must sit beyond the defense field');
    assert.ok(source.x - source.spreadX >= world.bounds.left);
    assert.ok(source.x + source.spreadX <= world.bounds.right);
    assert.ok(source.y - source.spreadY >= world.bounds.top);
  }
}
console.log('six placements fit every production nebula; rifts stay in expanded outer bounds');
