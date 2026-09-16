import assert from 'node:assert/strict';
import {
  healthBudgetAt, spawnProfileAt, surgeScheduleAt, surgeRiftIds, surgeSpawnSources,
  surgeStartSeconds, surgeArcSize, surgeRiftRing, LINEAR_RAMP_START_MINUTE,
  SURGE_PERIOD_SECONDS, SURGE_WARNING_SECONDS, SURGE_ACTIVE_SECONDS, SURGE_HOT_WEIGHT, SURGE_EXTRA_HP_FRACTION, surgeHpMultiplier,
  normalizePace, threatTickAt, DEFAULT_PACE, PACE_MIN, PACE_MAX
} from '../src/core/progression.js';
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
assert.equal(spawnProfileAt(map, 0).meanHp, 1.5);
assert.equal(spawnProfileAt(map, 1200 * 60).meanHp, 2);
console.log('budget identity retained; physical spawns flat from 20 minutes');

// A gentler opening joins a linear late ramp without a value or slope jump.
const untapered = { ...map, spawnCurve: { ...map.spawnCurve, taper: false } };
for (let seconds = 0; seconds <= LINEAR_RAMP_START_MINUTE * 60; seconds += 7) {
  assert.equal(healthBudgetAt(map, seconds * 60), healthBudgetAt(untapered, seconds * 60));
}
assert.ok(healthBudgetAt(map, 30 * 3600) < healthBudgetAt(untapered, 30 * 3600));
for (const world of playableMaps()) {
  const at = (minutes) => healthBudgetAt(world, minutes * 3600);
  const join = LINEAR_RAMP_START_MINUTE;
  const delta = 0.0001;
  assert.ok(Math.abs((at(join) - at(join - delta)) / delta - (at(join + delta) - at(join)) / delta) < 0.01);
  const increase = at(join + 1) - at(join);
  assert.ok(increase > 0);
  for (let minute = join + 2; minute <= 120; minute += 1) {
    assert.ok(Math.abs(at(minute) - at(minute - 1) - increase) < 1e-8, 'late pressure rises by a steady amount');
  }
  for (let minute = 1; minute <= 20; minute += 1) {
    const oldBudget = (2 + 0.8 * minute) * 1.22 ** minute;
    assert.ok(at(minute) < oldBudget && at(minute) > oldBudget * 0.70, 'opening is modestly easier');
  }
}
assert.equal(healthBudgetAt(getMapDefinition('test_field'), 50 * 3600), 0, 'test field keeps its flat zero curve');
console.log('threat curve: gentler opening, continuous slope, steady late ramp');

// Rift surges are a pure function of map, seed and tick.
for (const id of ['map_01', 'map_07', 'map_04']) {
  const world = getMapDefinition(id);
  const ring = surgeRiftRing(world);
  assert.equal(new Set(ring).size, world.spawnSources.length);
  const start = surgeStartSeconds(world);
  assert.equal(start, Math.max(...world.spawnSources.map((source) => source.unlockSeconds)) + 60);
  assert.equal(surgeScheduleAt(world, (start - SURGE_WARNING_SECONDS - 1) * 60, 7).phase, 'idle');
  const warning = surgeScheduleAt(world, (start - SURGE_WARNING_SECONDS) * 60, 7);
  assert.equal(warning.phase, 'warning'); assert.equal(warning.index, 0);
  const active = surgeScheduleAt(world, start * 60, 7);
  assert.equal(active.phase, 'active'); assert.deepEqual(active.riftIds, warning.riftIds);
  assert.equal(active.riftIds.length, surgeArcSize(world.spawnSources.length));
  assert.equal(surgeScheduleAt(world, (start + SURGE_ACTIVE_SECONDS) * 60, 7).phase, 'idle');
  const second = surgeScheduleAt(world, (start + SURGE_PERIOD_SECONDS) * 60, 7);
  assert.equal(second.phase, 'active'); assert.equal(second.index, 1);
  assert.deepEqual(surgeRiftIds(world, 7, 1), second.riftIds);
  assert.deepEqual(surgeRiftIds(world, 7, 1), surgeRiftIds(world, 7, 1), 'deterministic');
  for (let index = 1; index < 12; index += 1) {
    const previous = surgeRiftIds(world, 7, index - 1), current = surgeRiftIds(world, 7, index);
    if (world.spawnSources.length > 1) assert.notEqual(previous[Math.floor(previous.length / 2)], current[Math.floor(current.length / 2)], 'centre rift rotates');
    // arc is contiguous on the ring
    const positions = current.map((riftId) => ring.indexOf(riftId));
    for (let step = 1; step < positions.length; step += 1) assert.equal((positions[step] - positions[step - 1] + ring.length) % ring.length, 1);
  }
  assert.equal(surgeHpMultiplier(0), 3); assert.equal(surgeHpMultiplier(4), 5);
}
// Hot rifts carry a larger share of the ordinary stream plus the additional heavy stream.
{
  const world = getMapDefinition('map_01');
  const profile = spawnProfileAt(world, 40 * 3600);
  const surge = surgeScheduleAt(world, surgeStartSeconds(world) * 60, 7);
  const decorated = surgeSpawnSources(world.spawnSources, surge, profile);
  const hot = decorated.filter((source) => surge.riftIds.includes(source.id));
  assert.equal(hot.length, 3);
  for (const source of hot) {
    assert.equal(source.weight, SURGE_HOT_WEIGHT);
    assert.ok(Math.abs(source.extraRatePerSecond * source.extraHp * 3 - profile.hpPerSecond * SURGE_EXTRA_HP_FRACTION) < 1e-9);
    assert.equal(source.extraHp, Math.round(profile.meanHp * 3));
  }
  assert.ok(decorated.filter((source) => !surge.riftIds.includes(source.id)).every((source) => source.weight === 1 && source.extraRatePerSecond === undefined));
  assert.strictEqual(surgeSpawnSources(world.spawnSources, { phase: 'idle', riftIds: [] }, profile), world.spawnSources);
  // the swarm spawns the heavy stream on top of the ordinary rate and keeps it in corrections
  const surged = new EnemySwarm({ seed: 9, map: world });
  const plain = new EnemySwarm({ seed: 9, map: world });
  for (let tick = 0; tick < 600; tick += 1) {
    surged.spawnAtRate(profile.rate, decorated, 1, profile.meanHp);
    plain.spawnAtRate(profile.rate, world.spawnSources, 1, profile.meanHp);
  }
  const extra = surged.spawnedTotal - plain.spawnedTotal;
  const extraRate = hot.reduce((total, source) => total + source.extraRatePerSecond, 0);
  assert.ok(Math.abs(extra - extraRate * 10) <= 2, `extra bodies ${extra}`);
  let heavy = 0;
  for (let i = 0; i < surged.count; i++) if (surged.maxHpById[surged.idByIndex[i]] >= Math.round(profile.meanHp * 3)) heavy += 1;
  assert.ok(heavy >= extra * 0.95, `heavy bodies ${heavy} of ${extra}`);
  const copy = new EnemySwarm({ seed: 9, map: world });
  copy.applyCorrection(surged.exportCorrection());
  for (let tick = 0; tick < 120; tick += 1) {
    surged.spawnAtRate(profile.rate, decorated, 1, profile.meanHp);
    copy.spawnAtRate(profile.rate, decorated, 1, profile.meanHp);
  }
  assert.deepEqual(copy.exportCorrection(), surged.exportCorrection());
  for (const minute of [1, 5, 10, 20, 40, 80]) for (const index of [0, 5, 20]) {
    const current = spawnProfileAt(world, minute * 3600);
    const sources = surgeSpawnSources(world.spawnSources, { ...surge, hpMultiplier: surgeHpMultiplier(index) }, current);
    const extraHpPerSecond = sources.reduce((sum, source) => sum + (source.extraRatePerSecond || 0) * (source.extraHp || 0), 0);
    assert.ok(Math.abs(extraHpPerSecond / current.hpPerSecond - SURGE_EXTRA_HP_FRACTION) < 1e-12, 'surges track current HP pressure at every stage');
  }
}
// The production authority exposes the surge in its swarm summary without extra state.
{
  const live = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', mapId: 'map_01', startingLives: 1e9 });
  const start = surgeStartSeconds(live.map);
  live.state.runTick = (start - SURGE_WARNING_SECONDS) * 60;
  live.tick();
  assert.equal(live.state.swarm.surge.phase, 'warning');
  assert.equal(live.state.swarm.surge.riftIds.length, 3);
  const restored = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', mapId: 'map_01', startingLives: 1e9 });
  restored.applyCorrectionSnapshot(live.correctionSnapshot());
  assert.deepEqual(restored.state.swarm.surge, live.state.swarm.surge);
}
console.log('rift surges are deterministic, contiguous, rotating, additive and correction-safe');

// Horde pace stretches the threat clock: curve, hp mixture, rift unlocks and surges together.
{
  assert.equal(normalizePace(undefined), DEFAULT_PACE);
  assert.equal(normalizePace('abc'), DEFAULT_PACE);
  assert.equal(normalizePace(0.01), PACE_MIN);
  assert.equal(normalizePace(9), PACE_MAX);
  assert.equal(normalizePace(1.24), 1.2);
  assert.equal(threatTickAt(3600, 0.8), 2880);
  const config = { ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', autoStart: false, mapId: 'map_01', startingLives: 1e9 };
  const paced = new EmbeddedAuthority(config);
  paced.join({ clientId: 'p', payload: { label: 'p' } });
  const host = paced.state.players[0];
  paced.startSession({ clientId: 'p', playerId: host.id, sequence: 1, payload: { mapId: 'map_01', pace: 0.8 } }, host);
  assert.equal(paced.state.pace, 0.8);
  const reference = new EmbeddedAuthority(config);
  reference.join({ clientId: 'p', payload: { label: 'p' } });
  reference.startSession({ clientId: 'p', playerId: reference.state.players[0].id, sequence: 1, payload: { mapId: 'map_01', pace: 7 } }, reference.state.players[0]);
  assert.equal(reference.state.pace, PACE_MAX, 'pace is clamped by the authority');
  reference.state.pace = 1;
  paced.state.runTick = 40 * 3600; reference.state.runTick = 32 * 3600;
  const pacedSpawn = paced.spawnSettings(), referenceSpawn = reference.spawnSettings();
  assert.ok(Math.abs(pacedSpawn.hpPerSecond - referenceSpawn.hpPerSecond) < 1e-9, 'pace 0.8 at 40 minutes equals pace 1 at 32');
  assert.equal(pacedSpawn.sources.length, referenceSpawn.sources.length, 'rift unlocks follow the paced clock');
  paced.state.runTick = Math.round((surgeStartSeconds(paced.map) - SURGE_WARNING_SECONDS) / 0.8 * 60);
  assert.equal(paced.spawnSettings().surge.phase, 'warning', 'surges follow the paced clock');
  paced.tick();
  assert.equal(paced.state.swarm.pace, 0.8);
  assert.ok(Math.abs(paced.state.swarm.threatSeconds - paced.state.runTick * 0.8 / 60) < 1e-9);
  const restored = new EmbeddedAuthority(config);
  restored.applyCorrectionSnapshot(paced.correctionSnapshot());
  assert.equal(restored.state.pace, 0.8);
  assert.equal(restored.state.swarm.surge.phase, 'warning');
  const legacy = paced.correctionSnapshot(); delete legacy.state.pace;
  const fallback = new EmbeddedAuthority(config); fallback.applyCorrectionSnapshot(legacy);
  assert.equal(fallback.state.pace, DEFAULT_PACE, 'saves without a pace load at the designed pace');
  legacy.protocolVersion = 24; legacy.state.protocolVersion = 24;
  delete legacy.swarm.spawnMixCursor; delete legacy.swarm.spawnMixFraction;
  fallback.applyCorrectionSnapshot(legacy);
  assert.equal(fallback.swarm.spawnMixCursor, 0, 'previous-version saves start a new HP group');
  assert.equal(fallback.swarm.spawnMixFraction, 0);
  paced.restartSession({ clientId: 'p', playerId: host.id, sequence: 2, payload: { mapId: 'map_01' } });
  assert.equal(paced.state.pace, DEFAULT_PACE, 'a restart without a pace uses the designed pace');
}
console.log('horde pace stretches curve, rifts and surges together and survives corrections');

const source = { x: 0, y: -1300, spreadX: 1, spreadY: 1 };
const swarm = new EnemySwarm({ seed: 42, map });
for (let i = 0; i < 160; i++) swarm.spawnAtRate(60, [source], 1, 1.5);
let hp = 0;
const tiers = new Set();
for (let i = 0; i < swarm.count; i++) {
  hp += swarm.hpById[swarm.idByIndex[i]];
  tiers.add(swarm.hpById[swarm.idByIndex[i]]);
}
assert.equal(hp, 240); assert.ok(tiers.size >= 3, 'opening already contains three HP tiers');
for (const mean of [1, 1.25, 1.5, 1.625, 2, 6.7, 100.37, 1234.56]) {
  const mixed = new EnemySwarm({ seed: 7, map });
  const health = new Set(); let budget = 0, spent = 0;
  for (let index = 0; index < 1600; index += 1) {
    const expected = mean + (mean === 1 ? 0 : index / 10000);
    const nextHp = mixed.nextMixedHp(expected);
    budget += expected; spent += nextHp; health.add(nextHp);
    assert.ok(Number.isInteger(nextHp) && nextHp >= 1);
    assert.ok(Math.abs(spent + mixed.spawnHpAccumulator - budget) < 1e-7, 'variety spends only accrued HP');
    if ((index + 1) % 16 === 0) assert.ok(mixed.spawnHpAccumulator < 1, 'every full group pays its budget');
  }
  if (mean >= 1.5) assert.ok(health.size >= 3, 'tiers stay mixed as average HP rises');
}
// Save mid-group, including banked HP and the fractional tier allocation.
for (let i = 0; i < 7; i++) swarm.spawnAtRate(60, [source], 1, 1.37);
const restored = new EnemySwarm({ seed: 42, map });
restored.applyCorrection(swarm.exportCorrection());
for (let i = 0; i < 61; i++) {
  swarm.spawnAtRate(60, [source], 1, 1.37);
  restored.spawnAtRate(60, [source], 1, 1.37);
}
assert.deepEqual(restored.exportCorrection(), swarm.exportCorrection());
assert.equal(restored.updateChecksum(), swarm.updateChecksum());
const changedMix = new EnemySwarm({ seed: 42, map });
changedMix.applyCorrection(swarm.exportCorrection());
changedMix.spawnMixCursor = (changedMix.spawnMixCursor + 1) % 16;
assert.notEqual(changedMix.updateChecksum(), swarm.updateChecksum(), 'future HP composition participates in authority checksums');
const legacy = swarm.exportCorrection(); delete legacy.spawnMixCursor; delete legacy.spawnMixFraction;
restored.applyCorrection(legacy);
assert.equal(restored.spawnMixCursor, 0); assert.equal(restored.spawnMixFraction, 0);
restored.clearEnemies();
assert.equal(restored.spawnHpAccumulator, 0); assert.equal(restored.spawnMixCursor, 0); assert.equal(restored.spawnMixFraction, 0);
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
const credits = a.state.teamEconomy.credits;
a.placeTower(command({ definitionId: 'frame', x, y }), player);
assert.equal(a.state.towers.length, 1);
assert.equal(a.state.teamEconomy.credits, credits);
assert.equal(towerPlacementClear(a.state.towers, x + 23, y), false);
assert.equal(towerPlacementClear(a.state.towers, x + 24, y), true);
console.log('overlap rejected by authority without spending credits');

const tower = a.state.towers[0];
const attack = createAttackSnapshot(TOWER_DEFINITIONS.frame, tower);
const victim = a.swarm.spawnOne({ ...source, x: x + 50, y }, 3);
const starting = a.state.teamEconomy.credits;
for (const amount of [1, 10]) {
  const hit = a.swarm.damage(victim.id, victim.generation, amount);
  a.recordAttackResult({ attack, hits: [hit], kills: hit.killed ? [hit] : [], controlTargets: [], createdFields: [] });
}
assert.equal(a.state.teamEconomy.credits - starting, 3);
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
    const beyondField = world.arena
      ? Math.abs(source.x) >= 1700 || Math.abs(source.y) >= 1700
      : world.flow === 'west' ? source.x >= world.bounds.right - 200
        : world.sideWalls ? source.y <= -950 : Math.abs(source.x) >= 3000 || source.y <= -2600;
    assert.ok(beyondField, 'rift must sit beyond the defense field');
    assert.ok(source.x - source.spreadX >= world.bounds.left);
    assert.ok(source.x + source.spreadX <= world.bounds.right);
    assert.ok(source.y - source.spreadY >= world.bounds.top);
  }
}
console.log('six placements fit every production nebula; rifts stay in expanded outer bounds');
