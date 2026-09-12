import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { AUTHORITY_TICK_RATE } from '../src/core/protocol.js';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { PROTOTYPE_SESSION_CONFIG } from '../src/core/session-config.js';
import { isRelayForm } from '../src/core/network-descendants.js';
import { defenseAreaBounds, getMapDefinition } from '../src/core/world-config.js';
import { drawCompactTowerSprite, towerScreenBounds, towerSpriteMetrics, TOWER_WORLD_DIAMETER } from '../src/render/tower-sprites.js';
import { BASE_HIT_TICKS, BaseDamagePresentation, DEFAULT_RELAY_PALETTE, baseAppearance, enemyPointSize,
  hashString32, nebulaPalette, networkHueFromId, relayNetworkPresentation, riftAppearance } from '../src/render/world-appearance.js';
import { drawBaseSprite, drawBodyBrackets, drawRiftSprite, RIFT_BOUNDS } from '../src/render/world-sprites.js';

const colors = {
  black: [1 / 255, 6 / 255, 7 / 255, 1], cyan: [53 / 255, 242 / 255, 1, 1],
  mint: [85 / 255, 1, 194 / 255, 1], green: [116 / 255, 1, 106 / 255, 1],
  amber: [1, 200 / 255, 87 / 255, 1], red: [1, 77 / 255, 90 / 255, 1],
  dimMint: [14 / 255, 66 / 255, 59 / 255, 1], ink: [189 / 255, 233 / 255, 223 / 255, 1]
};
const origin = { x: 0, y: 0 };
const zooms = [1, 2, 3, 4, 5, 6, 8];
const capture = (draw) => {
  const rectangles = [];
  draw({ rect: (...args) => rectangles.push(args) });
  assert.ok(rectangles.length);
  for (const [x, y, w, h, color] of rectangles) {
    assert.ok([x, y, w, h, ...color].every(Number.isFinite));
    assert.ok(w > 0 && h > 0);
  }
  return rectangles;
};

// The complete animated envelope must fit a diameter smaller than placement spacing.
// Check all rail poses independently of the one-time sampling used to measure it.
for (const definitionId of Object.keys(TOWER_DEFINITIONS)) {
  const metrics = towerSpriteMetrics(definitionId);
  assert.equal(towerSpriteMetrics(definitionId), metrics, 'metrics are computed once per form');
  for (let runTick = 0; runTick < 360; runTick += 1) {
    const rectangles = capture((shapes) => drawCompactTowerSprite(shapes, colors, origin, { definitionId }, 1,
      null, { runTick, sweepPhase: (runTick % 121) / 120, controlActive: runTick % 2 === 0 }));
    for (const [x, y, w, h] of rectangles) {
      assert.ok(x >= metrics.left * metrics.worldScale - 1e-9 && y >= metrics.top * metrics.worldScale - 1e-9);
      assert.ok(x + w <= metrics.right * metrics.worldScale + 1e-9 && y + h <= metrics.bottom * metrics.worldScale + 1e-9);
      for (const px of [x, x + w]) for (const py of [y, y + h])
        assert.ok(Math.hypot(px, py) <= TOWER_WORLD_DIAMETER / 2 + 1e-9, `${definitionId}: fixed footprint`);
    }
  }
  for (const zoom of zooms) {
    const bounds = towerScreenBounds(definitionId, zoom);
    assert.equal(bounds.scale, metrics.worldScale / zoom);
    const brackets = capture((shapes) => drawBodyBrackets(shapes, origin, bounds, colors.amber));
    assert.ok(Math.min(...brackets.map(([x]) => x)) < bounds.left);
    assert.ok(Math.max(...brackets.map(([x, , w]) => x + w)) > bounds.right);
  }
}

const relay = (id, areaId, relayTargetAreaId) => ({ id, definitionId: 'relay', areaId, relayTargetAreaId });
const topology = { towers: [relay('r1', 'a', 'b'), relay('r2', 'd', 'e'), relay('r3', 'pending')], relayNetwork: { links: [] } };
const original = JSON.stringify(topology);
const shown = relayNetworkPresentation(topology);
assert.equal(shown.get('pending').tier, 1);
assert.equal(shown.get('a'), shown.get('b'));
assert.notEqual(shown.get('a').hue, shown.get('d').hue);
const sorted = (map) => [...map].sort(([a], [b]) => a.localeCompare(b));
assert.deepEqual(sorted(shown), sorted(relayNetworkPresentation({ ...topology, towers: [...topology.towers].reverse() })));
assert.deepEqual(sorted(shown), sorted(relayNetworkPresentation(JSON.parse(original))));
assert.equal(JSON.stringify(topology), original, 'presentation must not mutate authoritative snapshots');
const merged = { ...topology, towers: [...topology.towers, relay('join', 'b', 'd')] };
assert.equal(relayNetworkPresentation(merged).get('e').hue, shown.get('a').hue, 'merge uses canonical root');
const completed = { towers: [], relayNetwork: { links: [['a', 'b'], ['d', 'e']] } };
for (const id of ['a', 'b', 'd', 'e']) assert.deepEqual(relayNetworkPresentation(completed).get(id), shown.get(id));
const nonGreen = (color) => color[0] > color[1] || color[2] > color[1];
for (let i = 0; i < 4096; i += 1) {
  const hue = networkHueFromId(`network_${i}`);
  assert.ok(hue >= 200 / 360 && hue <= 320 / 360);
  for (const color of Object.values(nebulaPalette({ tier: 2, hue }))) assert.ok(nonGreen(color));
}
for (const color of Object.values(nebulaPalette({ tier: 1 }))) assert.ok(color[0] > color[1], 'pending is amber, including its interior');

for (const zoom of zooms) for (const units of [1, 2, 3, 4, 5, 100]) {
  const oldSize = Math.floor(Math.max(3, Math.min(6, 13 / zoom)) + 0.5) + (units > 1.5 ? 3 : 0);
  const size = enemyPointSize(zoom, units);
  assert.ok(size >= 2);
  assert.equal(size, oldSize * 0.8);
  if (units > 1) assert.ok(size > enemyPointSize(zoom, 1));
}

const source = { id: 'rift-a', unlockSeconds: 100 };
const snapshot = { runTick: 100 * AUTHORITY_TICK_RATE, pace: 1, swarm: { threatSeconds: 100 } };
assert.equal(riftAppearance({ ...snapshot, swarm: { threatSeconds: 89 } }, source).visible, false);
assert.equal(riftAppearance({ ...snapshot, swarm: { threatSeconds: 90 } }, source).state, 'countdown');
assert.equal(riftAppearance(snapshot, source).state, 'live');
assert.equal(riftAppearance({ ...snapshot, pace: 2, swarm: { threatSeconds: 90 } }, source).remaining, 5);
const hot = { ...snapshot, swarm: { threatSeconds: 100, surge: { phase: 'warning', riftIds: [source.id] } } };
assert.ok(riftAppearance(hot, source).hot);
assert.ok(riftAppearance({ ...hot, swarm: { ...hot.swarm, surge: { phase: 'active', riftIds: [source.id] } } }, source).hot);
assert.equal(riftAppearance({ ...snapshot, test: { activeSpawnSourceIds: [] } }, source).state, 'disabled');
assert.equal(riftAppearance({ ...snapshot, test: { activeSpawnSourceIds: [source.id] } }, source).state, 'live');
assert.deepEqual(riftAppearance(snapshot, source, true), riftAppearance({ ...snapshot, runTick: snapshot.runTick + 180 }, source, true));
for (const state of ['disabled', 'countdown', 'live']) for (const hot of [false, true]) for (let phase = 0; phase < 8; phase += 1) {
  const rectangles = capture((shapes) => drawRiftSprite(shapes, colors, origin, { state, hot, phase }));
  for (const [x, y, w, h] of rectangles) {
    assert.ok([x, y, w, h].every(Number.isInteger));
    assert.ok(x >= RIFT_BOUNDS.left && x + w <= RIFT_BOUNDS.right && y >= RIFT_BOUNDS.top && y + h <= RIFT_BOUNDS.bottom);
  }
}
const riftAt = (runTick) => capture((shapes) => drawRiftSprite(shapes, colors, origin, riftAppearance({ ...snapshot, runTick }, source)));
assert.deepEqual(riftAt(300), riftAt(300), 'paused simulation ticks keep rifts still');
assert.notDeepEqual(riftAt(300), riftAt(336), 'live apertures animate');

for (const [lives, state] of [[100, 'healthy'], [51, 'healthy'], [50, 'damaged'], [26, 'damaged'], [25, 'critical'], [1, 'critical'], [0, 'destroyed']]) {
  const appearance = baseAppearance({ lives }, 100, 90);
  assert.equal(appearance.state, state);
  const rectangles = capture((shapes) => drawBaseSprite(shapes, colors, origin, appearance));
  assert.ok(rectangles.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger)));
}
assert.equal(baseAppearance({ lives: 50, maxLives: 200 }, 100, 0).state, 'critical');
assert.equal(baseAppearance({ lives: 50 }, 200, 0).state, 'critical');
const damage = new BaseDamagePresentation();
const authority = new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG);
authority.state.runTick = 100;
authority.recordBreaches(65);
damage.breach(authority.events.at(-1).payload, authority.state.runTick);
assert.equal(damage.appearance(authority.state).state, 'damaged');
assert.ok(damage.appearance(authority.state).hit);
const paused = damage.appearance(authority.state);
assert.deepEqual(damage.appearance(authority.state), paused);
damage.breach({ livesLost: 1 }, 100 + BASE_HIT_TICKS - 1);
authority.state.runTick += BASE_HIT_TICKS;
assert.ok(damage.appearance(authority.state).hit, 'repeated hits refresh one response');
authority.state.runTick += BASE_HIT_TICKS;
assert.equal(damage.appearance(authority.state).hit, false);
authority.state.base.lives = 100;
assert.equal(damage.appearance(authority.state).state, 'healthy', 'healing restores armour');
damage.reset();
authority.recordBreaches(10, true);
damage.breach(authority.events.at(-1).payload, authority.state.runTick);
assert.equal(damage.appearance(authority.state).hit, false, 'invincibility cannot create fake damage');
damage.breach({ livesLost: 1 }, authority.state.runTick);
damage.reset();
assert.equal(damage.appearance(authority.state).hit, false, 'replacement snapshots clear transient damage');
assert.deepEqual(baseAppearance({ lives: 100 }, 100, 0, null, true), baseAppearance({ lives: 100 }, 100, 999, null, true));

// Exercise the production draw routes, not just the standalone artwork helpers.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (name) => {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf('\nfunction ', start + 1));
};
const calls = [];
const shapes = Object.fromEntries(['rect', 'line', 'ring'].map((kind) => [kind, (...args) => calls.push({ kind, args })]));
const template = getMapDefinition('map_01').defenseAreas[0].shape;
const areas = ['a', 'b', 'd', 'e', 'pending'].map((id, index) => ({ id, shape: { ...template, x: 60 + index * 80, y: 200 } }));
const context = vm.createContext({
  drawCompactTowerSprite, towerScreenBounds, drawBodyBrackets, AUTHORITY_TICK_RATE, DEFAULT_RELAY_PALETTE,
  hashString32, isRelayForm, defenseAreaBounds, shapes, COLOR: colors,
  camera: { x: 0, y: 0, scale: 1 }, logicalWidth: 800, logicalHeight: 600,
  session: { networkRole: null }, sessionSnapshot: { runTick: 0, towers: [], attackFields: [], towerCatalog: Object.values(TOWER_DEFINITIONS) },
  currentMap: { id: 'test', defenseAreas: areas }, reducedNetworkMotion: { matches: false },
  project: (x, y) => ({ x, y }), socketPoint: () => null, sweepPose: () => null,
  selectedTowerId: null, networkPresentation: shown, relayCollapse: null, RELAY_COLLAPSE_SECONDS: 2.2,
  pointer: { x: 0, y: 0 }, unproject: () => origin, findDefenseAreaAt: () => 'b', relayCandidateAreas: () => areas,
  baseDamage: damage, researchWave: null
});
vm.runInContext(['drawTower', 'defenseAreaCenterById', 'drawDashedLink', 'relayColors', 'drawNetworkLinks',
  'drawWorldRing', 'drawAreaTargetBrackets', 'drawRelayTargetOverlay', 'startRelayCollapse', 'drawRelayCollapse',
  'resetWorldPresentation'].map(extract).join('\n'), context);
const draw = (operation) => { calls.length = 0; operation(); return structuredClone(calls); };
for (const definitionId of Object.keys(TOWER_DEFINITIONS)) for (const zoom of zooms) {
  const tower = { id: 'subject', definitionId, x: 200, y: 200 };
  context.camera.scale = zoom;
  context.sessionSnapshot.towers = [tower];
  const alone = draw(() => context.drawTower(tower));
  for (const distance of [100, 24, 12, 0]) {
    context.sessionSnapshot.towers = [tower, { id: 'neighbour', x: 200 + distance, y: 200 }];
    assert.deepEqual(draw(() => context.drawTower(tower)), alone, `${definitionId}/${zoom}: neighbours cannot resize bodies`);
  }
  context.sessionSnapshot.towers = [];
  assert.deepEqual(draw(() => context.drawTower({ ...tower, id: undefined })), alone, 'placement ghost and retired/sold neighbours keep identical size');
}
context.camera.scale = 4;
const linked = { ...topology, towers: topology.towers.map((tower, index) => ({ ...tower, x: 60 + index * 80, y: 200 })),
  runTick: 30, towerCatalog: Object.values(TOWER_DEFINITIONS) };
const assertNoGreen = (result) => {
  assert.ok(result.length);
  for (const { args } of result) assert.ok(nonGreen(args.at(-1)), 'relay route emitted green');
};
assertNoGreen(draw(() => context.drawNetworkLinks(linked)));
assertNoGreen(draw(() => context.drawNetworkLinks({ ...linked, ...completed })));
assertNoGreen(draw(() => context.drawRelayTargetOverlay(linked, linked.towers[0])));
context.sessionSnapshot.runTick = 0;
context.startRelayCollapse({ payload: { tick: 0, retired: [{ towerId: 'r1', areaId: 'a', targetAreaId: 'b', x: 60, y: 200 }], areaIds: ['a', 'b'] } });
for (const runTick of [0, 25, 55, 90, 120]) {
  const result = draw(() => context.drawRelayCollapse({ runTick }));
  assertNoGreen(result);
  assert.deepEqual(draw(() => context.drawRelayCollapse({ runTick })), result, 'completion freezes with paused ticks');
}
context.reducedNetworkMotion.matches = true;
assert.deepEqual(draw(() => context.drawRelayCollapse({ runTick: 120 })), []);
context.researchWave = { startedTick: 0 };
context.resetWorldPresentation();
assert.equal(context.relayCollapse, null);
assert.equal(context.researchWave, null);
assert.equal(damage.hitTick, null);

console.log('world art: fixed tower bounds, relay palettes/routes, rift states, base damage, reduced motion and pause passed');
