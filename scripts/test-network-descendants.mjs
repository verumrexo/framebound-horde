import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS, validateTowerCatalog } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { DEFAULT_MAP_ID } from '../src/core/world-config.js';
import { PROTOCOL_VERSION } from '../src/core/protocol.js';
import { NETWORK_DESCENDANT_IDS, purchaseCost, saleRefund, socketPoint } from '../src/core/network-descendants.js';

let checks = 0;
function test(label, run) { run(); checks++; console.log(`ok ${checks} - ${label}`); }
function setup(mapId = TEST_FIELD_SESSION_CONFIG.mapId) {
  const a = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, mapId });
  a.join({ clientId: 'test', payload: { label: 'test' } });
  const player = a.state.players[0];
  const area = a.map.defenseAreas[0];
  function add(id, targetArea = area) {
    const tower = a.normalizeTower({ id: `tower_${a.nextTowerNumber++}`, definitionId: id,
      ownerId: player.id, x: targetArea.shape.x, y: targetArea.shape.y,
      areaId: targetArea.id, totalInvestment: 1500 });
    a.state.towers.push(tower);
    refresh();
    return tower;
  }
  function refresh() { a.rebuildModifierCache(); a.syncTowerStats(); }
  const command = (payload) => ({ clientId: 'test', playerId: player.id, sequence: 1, payload });
  return { a, player, area, add, refresh, command };
}

test('nine complete paths, no placeholder attacks', () => {
  assert.deepEqual(validateTowerCatalog(), []);
  assert.equal(NETWORK_DESCENDANT_IDS.length, 9);
  for (const id of NETWORK_DESCENDANT_IDS) {
    assert.equal(TOWER_DEFINITIONS[id].evolutionCost, 800);
    assert.equal(TOWER_DEFINITIONS[id].attack, undefined);
    assert.ok(TOWER_DEFINITIONS[TOWER_DEFINITIONS[id].evolvesFrom].evolutionChoices.includes(id));
  }
});

test('amplifier affects local combat bonuses once and aperture scales cluster children', () => {
  const { a, add } = setup();
  const weapon = add('cluster'); add('overclock'); add('aperture'); add('amplifier'); add('amplifier');
  assert.ok(Math.abs(weapon.effectiveCadence - 0.4 * 1.225) < 1e-9);
  const attack = a.applyTowerAttackStats(weapon, createAttackSnapshot(TOWER_DEFINITIONS.cluster, weapon));
  assert.ok(Math.abs(attack.geometry.radius - 48 * 1.15) < 1e-9);
  assert.ok(Math.abs(attack.impactFollowUps[0].radius - 32 * 1.15) < 1e-9);
  assert.equal(weapon.effectiveRange, 240);
});

test('metronome recharges control weapons and preserves static recall gates', () => {
  const { a, add } = setup();
  const one=add('stasis'), two=add('stasis'); add('recall'); add('metronome');
  a.state.runTick=600;
  assert.equal(one.effectiveCadence,.25);
  assert.equal(two.effectiveCadence,.25);
  assert.equal(a.syncControlFields().find((f)=>f.kind==='recall_gate').delayTicks,90);
});

test('old foundry/salvage migrate without free discounts or research', () => {
  const { a, add, area, command, player } = setup();
  add('foundry'); add('salvage'); add('amplifier');
  assert.equal(purchaseCost(a.state, area.id, 800), 800);
  const frame = add('frame'); frame.totalInvestment = 88;
  assert.equal(saleRefund(a.state, frame), 44);
  a.evolveTower(command({ towerId: frame.id, definitionId: 'network' }), player);
  assert.equal(frame.totalInvestment, 288);
  const before = a.state.economyByPlayer[player.id].credits;
  a.sellTower(command({ towerId: frame.id }), player);
  assert.equal(a.state.economyByPlayer[player.id].credits - before, 144);
});

test('echo copies control once, respects network scope, and loses a sold source', () => {
  const { a, add, command, player, refresh } = setup();
  const source = add('stasis'); const echo = add('echo'); add('metronome');
  a.setEchoSource(command({ towerId: echo.id, sourceTowerId: source.id }), player);
  assert.equal(echo.echoWeaponId, 'stasis');
  assert.ok(Math.abs(echo.effectiveCadence - 0.25) < 1e-9);
  a.setEchoSource(command({ towerId: echo.id, sourceTowerId: echo.id }), player);
  assert.equal(echo.echoSourceId, source.id);
  a.sellTower(command({ towerId: source.id }), player); refresh();
  assert.equal(a.weaponDefinition(echo).attack, undefined);
  assert.equal(echo.effectiveCadence, 0);
});

test('redline dispatches one extra volley without spending normal charge', () => {
  const { a, add } = setup();
  const weapon = add('warhead'); add('redline');
  let volleys = 0;
  a.dispatchVolley = (tower) => { volleys++; tower.fireCharge -= 1; };
  weapon.fireCharge = 0.25;
  a.state.runTick = 600;
  a.fireTowers();
  assert.equal(volleys, 1);
  assert.ok(Math.abs(weapon.fireCharge - (0.25 + 0.3 / 60)) < 1e-9);
  a.state.runTick++;
  a.fireTowers();
  assert.equal(volleys, 1);
});

test('hardpoint buys an off-nebula socket tower, locks occupied links, rejects nesting', () => {
  const { a, add, command, player, refresh } = setup(DEFAULT_MAP_ID);
  const hardpoint = add('hardpoint');
  const target = a.map.defenseAreas.find((area) => a.validRelayTargetAreaId(hardpoint, area.id));
  assert.ok(target, 'test map has a reachable second nebula');
  hardpoint.relayTargetAreaId = target.id; refresh();
  a.setSocket(command({ towerId: hardpoint.id, fraction: 0.5 }), player);
  const point = socketPoint(a.state, a.map, hardpoint);
  a.placeTower(command({ definitionId: 'frame', ...point }), player);
  const hosted = a.state.towers.find((tower) => tower.socketHostId === hardpoint.id);
  assert.ok(hosted);
  assert.equal(hosted.areaId, hardpoint.areaId);
  a.sellTower(command({ towerId: hardpoint.id }), player);
  assert.ok(a.state.towers.includes(hardpoint));
  a.setSocket(command({ towerId: hardpoint.id, fraction: 0.8 }), player);
  assert.equal(hardpoint.socketFraction, 0.5);
  a.sellTower(command({ towerId: hosted.id }), player);
  const count = a.state.towers.length;
  a.placeTower(command({ definitionId: 'hardpoint', ...point }), player);
  assert.equal(a.state.towers.length, count);
});

test('mint accumulates fractional ordinary rewards without compounding forge rewards', () => {
  const { a, add } = setup();
  const weapon = add('frame'); const mint = add('mint'); add('forge');
  const attack = createAttackSnapshot(TOWER_DEFINITIONS.frame, weapon);
  const before = a.state.stats.unclaimedCredits;
  for (let i = 0; i < 5; i++) a.recordAttackResult({ attack, hits: [{ hpPopped: 1 }], kills: [{ id: i + 1, units: 1, x: 0, y: 0 }], controlTargets: [], createdFields: [] });
  assert.equal(mint.bonusCredits, 1);
  assert.equal(a.state.supportCounters[`mint:${weapon.areaId}`], 0);
  assert.equal(a.state.stats.unclaimedCredits, before);
});

test('network state survives correction and produces identical future simulation', () => {
  const { a, add } = setup();
  add('frame'); add('mint'); add('redline'); add('metronome'); add('stasis');
  a.state.supportCounters['mint:remainder'] = 37;
  for (let i = 0; i < 100; i++) a.tick();
  const b = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  b.applyCorrectionSnapshot(a.correctionSnapshot());
  for (let i = 0; i < 650; i++) { a.tick(); b.tick(); }
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.deepEqual(b.swarm.exportCorrection(), a.swarm.exportCorrection());
});

test('redline fires combat projectiles while echo projects a zero-damage control from its muzzle', () => {
  const { a, add, command, player } = setup();
  const gun=add('assault'), source=add('tether'), echo=add('echo'); add('redline');
  echo.x+=30;
  a.setEchoSource(command({towerId:echo.id,sourceTowerId:source.id}),player);
  a.state.runTick=600; a.fireTowers();
  assert.equal(a.state.projectiles.length,0);
  for(let i=0;i<8;i++) a.swarm.spawnOne({x:source.x+60+i,y:source.y+60,spreadX:0,spreadY:0},1,1);
  echo.fireCharge=1; a.state.runTick=1200; a.fireTowers();
  assert.ok(a.state.projectiles.some((p)=>p.attack.sourceTowerId===gun.id));
  const shots=a.state.turretRework.shots.filter((p)=>p.towerId===echo.id);
  assert.equal(shots.length,1);
  assert.equal(shots[0].originX,echo.x);
  assert.equal(shots[0].attack.supportOnly,true);
  assert.deepEqual(shots[0].attack.effects,[]);
});

test('remote buffs cross relay links but amplifiers remain local', () => {
  const { a, add, area, refresh } = setup(DEFAULT_MAP_ID);
  const relay = add('relay');
  const target = a.map.defenseAreas.find((candidate) => a.validRelayTargetAreaId(relay, candidate.id));
  assert.ok(target);
  relay.relayTargetAreaId = target.id;
  const local = add('frame', area); const remote = add('frame', target);
  add('overclock'); add('amplifier'); refresh();
  assert.ok(Math.abs(local.effectiveCadence - 7.35) < 1e-9);
  assert.ok(Math.abs(remote.effectiveCadence - 6.9) < 1e-9);
  relay.relayTargetAreaId = null; refresh();
  assert.equal(remote.effectiveCadence, 6);
});

test('protocol 14 solo saves remain loadable', () => {
  const { a, add } = setup(); add('frame');
  const correction = a.correctionSnapshot(); correction.protocolVersion = 14;
  const b = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  b.applyCorrectionSnapshot(correction); b.tick();
  assert.equal(b.state.protocolVersion, PROTOCOL_VERSION);
  assert.equal(b.state.towers.length, 1);
});

console.log(`${checks} network regression groups passed`);
