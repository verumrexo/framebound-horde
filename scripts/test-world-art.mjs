import { createAppState } from '../src/app/state.js';
import { resetWorldPresentation } from '../src/app/presentation.js';
import { drawTower } from '../src/render/world.js';
import { drawReworkedCombat } from '../src/render/projectiles.js';
import { drawNetworkLinks, startRelayCollapse, drawRelayCollapse } from '../src/render/network.js';
import { drawRelayTargetOverlay } from '../src/render/placement-overlay.js';
import { reactorShutdownAppearance } from '../src/ui/hud.js';
import assert from 'node:assert/strict';
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
import { ASSEMBLY_SIZE, ASSEMBLY_TICKS, AssemblyPresentation, drawAssemblyFrame } from '../src/render/assembly.js';
import { drawMapThumbnail, mapThumbnail } from '../src/render/map-thumbnail.js';
import { playableMaps } from '../src/core/world-config.js';
import { BURST_MERGE_SECONDS, BURST_SECONDS, MAX_CONTROL_LINKS, MAX_LIVE_BURSTS, admitBurst, combatMetrics,
  drawImpactMark, impactColors, impactFamily } from '../src/render/combat-marks.js';

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

// Projectile heads and kill marks follow the turret footprint through every zoom and
// never exceed it by much; the floors track the two-pixel enemy minimum.
let previous = null;
for (const zoom of zooms) {
  const marks = combatMetrics(zoom);
  assert.equal(combatMetrics(zoom), marks, 'metrics are cached per zoom');
  assert.ok(marks.shot >= 2 && marks.shot <= 5 && Number.isInteger(marks.shot));
  assert.ok(marks.heavy >= 3 && marks.heavy <= 9 && marks.heavy % 2 === 1);
  assert.ok(marks.burst >= 3 && marks.burst <= 8 && Number.isInteger(marks.burst));
  assert.ok(marks.heavy + 2 <= Math.max(5, marks.tower + 1), `${zoom}: warhead head wider than its turret`);
  assert.ok(marks.burst * 2 + 1 <= Math.max(7, marks.tower * 1.5), `${zoom}: kill mark dwarfs the turret`);
  assert.ok(marks.shot <= Math.max(2, enemyPointSize(zoom) + 1), `${zoom}: light shot outgrows enemies`);
  if (previous) for (const key of ['shot', 'heavy', 'burst', 'rail']) assert.ok(marks[key] <= previous[key], `${key} must not grow when zooming out`);
  previous = marks;
}
assert.equal(combatMetrics(4).heavy, 3);
assert.equal(combatMetrics(1).heavy, 9);
const families = new Map();
for (const definitionId of Object.keys(TOWER_DEFINITIONS)) {
  const family = impactFamily(definitionId);
  if (!families.has(family)) families.set(family, definitionId);
  const palette = impactColors(definitionId, colors);
  assert.ok(palette.early && palette.late && palette.control);
}
assert.deepEqual([...families.keys()].sort(), ['ballistic', 'beam', 'collapse', 'explosive', 'lock', 'shove']);
assert.equal(impactFamily('unknown'), 'ballistic');
for (const zoom of zooms) {
  const reach = combatMetrics(zoom).burst;
  const signatures = new Map();
  for (const [family] of families) {
    for (const progress of [0, 0.25, 0.5, 0.75, 0.999]) for (const alternate of [0, 1]) {
      const rectangles = capture((shapes) => drawImpactMark(shapes, family, origin, progress, reach, alternate, colors.red));
      assert.ok(rectangles.length <= 8, `${family}: too many rectangles`);
      for (const [x, y, w, h] of rectangles) {
        assert.ok([x, y, w, h].every(Number.isInteger));
        assert.ok(x >= -reach && y >= -reach && x + w <= reach + 1 && y + h <= reach + 1, `${family}/${zoom}: mark exceeds burst radius`);
      }
    }
    const signature = JSON.stringify(capture((shapes) => drawImpactMark(shapes, family, origin, 0.5, reach, 0, colors.red)));
    assert.ok(!signatures.has(signature), `${family} looks like ${signatures.get(signature)}`);
    signatures.set(family, signature);
  }
}
const burst = (x, formId, age = 0) => ({ x, y: 0, age, seed: 1, sourceFormId: formId, family: impactFamily(formId), controlTargets: [] });
const live = [];
admitBurst(live, burst(0, 'assault'), 12);
admitBurst(live, burst(5, 'assault'), 12);
assert.equal(live.length, 1, 'same-family kills at one place share a mark');
admitBurst(live, burst(5, 'laser'), 12);
assert.equal(live.length, 2, 'different families keep distinct marks');
live[0].age = BURST_MERGE_SECONDS + 0.01;
admitBurst(live, burst(5, 'assault'), 12);
assert.equal(live.length, 3, 'older marks stop absorbing');
admitBurst(live, burst(40, 'assault'), 12);
assert.equal(live.length, 4, 'distance beyond one burst radius keeps a new mark');
const flood = [];
for (let index = 0; index < MAX_LIVE_BURSTS * 3; index += 1) admitBurst(flood, burst(index * 100, 'rocket', index * 0.001), 12);
assert.equal(flood.length, MAX_LIVE_BURSTS, 'dense combat is capped');
assert.ok(flood.every((entry) => entry.age < BURST_SECONDS));
assert.ok(MAX_CONTROL_LINKS <= 4 && BURST_SECONDS <= 0.25);

// Construction reveal: fixed screen size, simulation-tick driven, never a gameplay input.
const assembly = new AssemblyPresentation();
assembly.begin({ id: 't1', x: 10, y: 20 }, 'placed', 100);
assembly.begin({ id: 't1', x: 10, y: 20 }, 'evolved', 104);
assert.equal(assembly.items.length, 1, 'evolution replaces the placement frame of the same tower');
assembly.begin({ id: 't2', x: 50, y: 20 }, 'placed', 100);
assert.equal(assembly.frames(99).length, 0, 'frames from a later session start are ignored');
assert.equal(assembly.items.length, 0);
assembly.begin({ id: 't1', x: 10, y: 20 }, 'evolved', 104);
assembly.begin({ id: 't2', x: 50, y: 20 }, 'placed', 100);
const held = assembly.frames(110);
assert.deepEqual(assembly.frames(110), held, 'paused ticks freeze the reveal');
assert.equal(held.length, 2);
assert.equal(assembly.frames(104 + ASSEMBLY_TICKS).length, 0, 'frames expire by ticks');
assert.equal(assembly.items.length, 0);
assembly.begin({ id: 't3', x: 0, y: 0 }, 'placed', 0);
for (const kind of ['placed', 'evolved']) for (let step = 0; step < ASSEMBLY_TICKS; step += 1) {
  const rectangles = capture((shapes) => drawAssemblyFrame(shapes, colors, origin, { kind, step }));
  for (const [x, y, w, h] of rectangles) {
    assert.ok([x, y, w, h].every(Number.isInteger));
    assert.ok(x >= -8 && y >= -8 && x + w <= 9 && y + h <= 9, `${kind}/${step}: frame leaves its ${ASSEMBLY_SIZE}px box`);
  }
}
const still = capture((shapes) => drawAssemblyFrame(shapes, colors, origin, { kind: 'placed', step: null }));
assert.deepEqual(assembly.frames(5, true).map((frame) => frame.step), [null], 'reduced motion holds a static frame');
assert.ok(still.length < capture((shapes) => drawAssemblyFrame(shapes, colors, origin, { kind: 'placed', step: 5 })).length);
assembly.reset();
assert.equal(assembly.items.length, 0);

// Map thumbnails come from the real field boundary, not rectangles, and show the base
// and every distinct rift entry inside a bounded frame.
for (const map of playableMaps()) {
  const thumb = mapThumbnail(map, 188, 155);
  assert.equal(mapThumbnail(map, 188, 155), thumb, 'thumbnails are cached per map and size');
  assert.ok(thumb.frameWidth <= 188 && thumb.frameHeight <= 155);
  assert.ok(thumb.interior.length > 20 && thumb.edge.length > thumb.interior.length, `${map.id}: contour detail missing`);
  for (const [px, py, w] of [...thumb.interior, ...thumb.edge]) assert.ok(px >= 0 && py >= 0 && px + w <= thumb.frameWidth && py < thumb.frameHeight);
  assert.ok(thumb.rifts.length >= Math.min(3, map.spawnSources.length) && thumb.rifts.length <= map.spawnSources.length);
  for (const point of [thumb.base, ...thumb.rifts]) assert.ok(point.x >= 1 && point.y >= 1 && point.x < thumb.frameWidth - 1 && point.y < thumb.frameHeight - 1);
  assert.equal(thumb.arena, Boolean(map.arena));
  const inside = new Set();
  for (const [px, py, w] of [...thumb.interior, ...thumb.edge]) for (let i = 0; i < w; i += 1) inside.add(`${px + i},${py}`);
  const visible = map.defenseAreas.filter((area) => area.shape.x > map.cameraBounds.left + 40 && area.shape.x < map.cameraBounds.right - 40
    && area.shape.y > map.cameraBounds.top + 40 && area.shape.y < map.cameraBounds.bottom - 40);
  const centred = visible.filter((area) => {
    const px = Math.floor((area.shape.x - map.cameraBounds.left) / (map.cameraBounds.right - map.cameraBounds.left) * thumb.frameWidth);
    const py = Math.floor((area.shape.y - map.cameraBounds.top) / (map.cameraBounds.bottom - map.cameraBounds.top) * thumb.frameHeight);
    return inside.has(`${px},${py}`);
  });
  assert.ok(centred.length >= visible.length * 0.9, `${map.id}: field centres fall outside the drawn contour`);
  const rectangles = capture((shapes) => drawMapThumbnail(shapes, colors, map, 0, 0, 188, 155, colors.mint));
  for (const [x, y, w, h] of rectangles) assert.ok(x >= -2 && y >= -2 && x + w <= 190 && y + h <= 157, `${map.id}: thumbnail paints outside its box`);
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
const calls = [];
const shapes = Object.fromEntries(['rect', 'line', 'ring'].map((kind) => [kind, (...args) => calls.push({ kind, args })]));
const template = getMapDefinition('map_01').defenseAreas[0].shape;
const areas = ['a', 'b', 'd', 'e', 'pending'].map((id, index) => ({ id, shape: { ...template, x: 60 + index * 80, y: 200 } }));
const app = createAppState();
Object.assign(app.viewport, { logicalWidth: 800, logicalHeight: 600, camera: { x: 0, y: 0, scale: 1 } });
app.renderer.shapes = shapes;
app.game.session = { networkRole: null, presentation: () => ({ count: 0, state: new Float32Array(0) }) };
app.game.sessionSnapshot = { runTick: 0, towers: [], attackFields: [], towerCatalog: Object.values(TOWER_DEFINITIONS) };
app.game.currentMap = { id: 'test', defenseAreas: areas };
app.effects.networkPresentation = shown;
app.effects.baseDamage = damage;
const draw = (operation) => { calls.length = 0; operation(); return structuredClone(calls); };
for (const definitionId of Object.keys(TOWER_DEFINITIONS)) for (const zoom of zooms) {
  const tower = { id: 'subject', definitionId, x: 200, y: 200 };
  app.viewport.camera.scale = zoom;
  app.game.sessionSnapshot.towers = [tower];
  const alone = draw(() => drawTower(app, tower));
  for (const distance of [100, 24, 12, 0]) {
    app.game.sessionSnapshot.towers = [tower, { id: 'neighbour', x: 200 + distance, y: 200 }];
    assert.deepEqual(draw(() => drawTower(app, tower)), alone, `${definitionId}/${zoom}: neighbours cannot resize bodies`);
  }
  app.game.sessionSnapshot.towers = [];
  assert.deepEqual(draw(() => drawTower(app, { ...tower, id: undefined })), alone, 'placement ghost and retired/sold neighbours keep identical size');
}
// Barrage descendants (broadside pellets, flechette nails, cyclone orbits) and the
// reworked control forms draw from state.turretRework, which is recreated every tick.
for (const zoom of zooms) {
  app.viewport.camera.scale = zoom;
  const shots = ['pellet', 'nail', 'splinter', 'orbit', 'embedded', 'freeze_shell', 'gravity_seed', 'chain']
    .map((type, index) => ({ type, x: 100 + index * 20, y: 100, dx: 1, dy: 0 }));
  const visuals = [{ type: 'ray', x: 0, y: 0, x2: 50, y2: 0 }, { type: 'gravity', x: 0, y: 0, radius: 40 }];
  const result = draw(() => drawReworkedCombat(app, { runTick: 5, turretRework: { shots, chains: [], visuals } }));
  const rectangles = result.filter(({ kind }) => kind === 'rect');
  assert.ok(rectangles.length >= shots.length + 1, `${zoom}: every reworked shot draws a visible head`);
  const reach = combatMetrics(zoom).heavy + 2;
  for (const { args } of rectangles) assert.ok(args[2] <= reach && args[3] <= reach, `${zoom}: reworked heads stay proportional`);
  assert.equal(draw(() => drawReworkedCombat(app, { runTick: 5 })).length, 0, 'no rework state draws nothing');
}
app.viewport.camera.scale = 4;
const linked = { ...topology, towers: topology.towers.map((tower, index) => ({ ...tower, x: 60 + index * 80, y: 200 })),
  runTick: 30, towerCatalog: Object.values(TOWER_DEFINITIONS) };
const assertNoGreen = (result) => {
  assert.ok(result.length);
  for (const { args } of result) assert.ok(nonGreen(args.at(-1)), 'relay route emitted green');
};
assertNoGreen(draw(() => drawNetworkLinks(app, linked)));
assertNoGreen(draw(() => drawNetworkLinks(app, { ...linked, ...completed })));
assertNoGreen(draw(() => drawRelayTargetOverlay(app, linked, linked.towers[0])));
app.game.sessionSnapshot.runTick = 0;
startRelayCollapse(app, { payload: { tick: 0, retired: [{ towerId: 'r1', areaId: 'a', targetAreaId: 'b', x: 60, y: 200 }], areaIds: ['a', 'b'] } });
for (const runTick of [0, 25, 55, 90, 120]) {
  const result = draw(() => drawRelayCollapse(app, { runTick }));
  assertNoGreen(result);
  assert.deepEqual(draw(() => drawRelayCollapse(app, { runTick })), result, 'completion freezes with paused ticks');
}
app.effects.reducedNetworkMotion.matches = true;
assert.deepEqual(draw(() => drawRelayCollapse(app, { runTick: 120 })), []);
for (const [age, state] of [[0, 'healthy'], [0.2, 'damaged'], [0.35, 'critical'], [0.6, 'destroyed'], [Infinity, 'destroyed']]) {
  const appearance = reactorShutdownAppearance({}, age);
  assert.equal(appearance.state, state);
  capture((shapes) => drawBaseSprite(shapes, colors, origin, appearance));
}
app.effects.researchWave = { startedTick: 0 };
app.effects.assembly = assembly;
app.effects.defeatSeenAt = 5;
assembly.begin({ id: 't9', x: 0, y: 0 }, 'placed', 0);
resetWorldPresentation(app);
assert.equal(assembly.items.length, 0, 'replacement sessions clear pending reveals');
assert.equal(app.effects.defeatSeenAt, null);
assert.equal(app.effects.relayCollapse, null);
assert.equal(app.effects.researchWave, null);
assert.equal(damage.hitTick, null);

console.log('world art: fixed tower bounds, combat mark proportions, assembly reveal, map contours, reactor shutdown, relay palettes/routes, rift states, base damage, reduced motion and pause passed');
