import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { PROTOTYPE_SESSION_CONFIG } from '../src/core/session-config.js';
import { activeSpawnSources, defenseAreaField, findDefenseAreaAt, getMapDefinition, playableMaps } from '../src/core/world-config.js';

// map 07 // crucible: central base, three gapped nebula rings, rifts opening around the
// whole perimeter. These checks pin the geometry contract rather than balance.
const map = getMapDefinition('map_07');
assert.ok(map.playable && map.arena);
assert.equal(playableMaps().at(-1).id, 'map_07');
assert.deepEqual({ x: map.base.x, y: map.base.y }, { x: 0, y: 0 }, 'the base sits at the exact centre');
assert.equal(map.defenseAreas.length, 34);
assert.equal(findDefenseAreaAt(map, map.base.x, map.base.y), null, 'no nebula covers the base');

function contour(area, steps = 48) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = i / steps * Math.PI * 2;
    let low = 0, high = 600;
    for (let k = 0; k < 24; k += 1) {
      const mid = (low + high) / 2;
      if (defenseAreaField(area, area.shape.x + Math.cos(angle) * mid, area.shape.y + Math.sin(angle) * mid) <= 0) low = mid; else high = mid;
    }
    points.push({ x: area.shape.x + Math.cos(angle) * low, y: area.shape.y + Math.sin(angle) * low });
  }
  return points;
}
const contours = map.defenseAreas.map((area) => contour(area));
let minimumGap = Infinity, baseClearance = Infinity;
for (let i = 0; i < contours.length; i += 1) {
  for (const point of contours[i]) baseClearance = Math.min(baseClearance, Math.hypot(point.x - map.base.x, point.y - map.base.y));
  for (let j = i + 1; j < contours.length; j += 1) {
    assert.ok(!contours[i].some((p) => defenseAreaField(map.defenseAreas[j], p.x, p.y) <= 0), `${map.defenseAreas[i].id} overlaps ${map.defenseAreas[j].id}`);
    for (const p of contours[i]) for (const q of contours[j]) minimumGap = Math.min(minimumGap, Math.hypot(p.x - q.x, p.y - q.y));
  }
}
assert.ok(minimumGap >= 60, `ring gaps stay open for the flow (${minimumGap.toFixed(1)})`);
assert.ok(baseClearance >= 150, 'the base keeps open ground on every side');

// Every nebula can join one relay network: link range 360 from some interior point.
const interior = map.defenseAreas.map((area) => {
  const points = [];
  for (let r = 0; r <= 0.9; r += 0.15) for (let i = 0; i < 24; i += 1) {
    const angle = i / 24 * Math.PI * 2;
    const x = area.shape.x + Math.cos(angle) * area.shape.radiusX * r, y = area.shape.y + Math.sin(angle) * area.shape.radiusY * r;
    if (defenseAreaField(area, x, y) <= 0) points.push({ x, y });
  }
  return points;
});
const seen = new Set([0]), queue = [0];
while (queue.length) {
  const i = queue.shift();
  for (let j = 0; j < map.defenseAreas.length; j += 1) {
    if (seen.has(j) || !interior[i].some((p) => defenseAreaField(map.defenseAreas[j], p.x, p.y, 360) <= 0)) continue;
    seen.add(j); queue.push(j);
  }
}
assert.equal(seen.size, map.defenseAreas.length, 'every ring area is relay-linkable into one network');

// Rifts: 32 unique frame slots, all outside the camera-safe bounds and inside the simulation.
assert.equal(map.spawnSources.length, 32);
assert.equal(new Set(map.spawnSources.map((s) => `${s.x},${s.y}`)).size, 32);
for (const source of map.spawnSources) {
  assert.ok(source.x - source.spreadX >= map.bounds.left && source.x + source.spreadX <= map.bounds.right);
  assert.ok(source.y - source.spreadY >= map.bounds.top && source.y + source.spreadY <= map.bounds.bottom);
  assert.ok(source.x < map.cameraBounds.left || source.x > map.cameraBounds.right || source.y < map.cameraBounds.top || source.y > map.cameraBounds.bottom, source.id);
  assert.equal(findDefenseAreaAt(map, source.x, source.y), null);
}
const side = (s) => Math.abs(s.x) > Math.abs(s.y) ? (s.x > 0 ? 'e' : 'w') : (s.y > 0 ? 's' : 'n');
const sidesAt = (seconds) => new Set(activeSpawnSources(map, seconds * 60).map(side));
assert.deepEqual([...sidesAt(0)], ['n'], 'the first rift is due north');
assert.equal(activeSpawnSources(map, 0).length, 1);
assert.deepEqual([...sidesAt(4 * 60)], ['n'], 'the opening minutes stay a northern front');
assert.deepEqual([...sidesAt(9 * 60)].sort(), ['e', 'n', 'w'], 'pressure widens over both flanks before the south opens');
assert.ok(!sidesAt(15 * 60).has('s'), 'the southern half stays quiet through the first quarter hour');
assert.ok(sidesAt(20 * 60).has('s'), 'by twenty minutes the fronts have wrapped behind the base');
assert.deepEqual([...sidesAt(31 * 50)].sort(), ['e', 'n', 's', 'w'], 'every side is live once all rifts are open');
assert.equal(map.spawnSources.at(-1).unlockSeconds, 31 * 50);
assert.ok(map.spawnSources.every((s, i) => i === 0 || s.unlockSeconds > map.spawnSources[i - 1].unlockSeconds));
const southFinal = map.spawnSources.at(-1);
assert.ok(southFinal.y > 1500 && Math.abs(southFinal.x) < 200, 'the final rift closes the ring due south');

// Deterministic reconstruction: host, guest and a save all rebuild the same map and flow.
const host = new EmbeddedAuthority({ ...PROTOTYPE_SESSION_CONFIG, seed: 99, mapId: 'map_07' });
host.join({ clientId: 'h', payload: { label: 'h' } });
host.state.phase = 'running';
assert.equal(host.state.base.x, 0);
const guest = new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG);
guest.applyCorrectionSnapshot(host.correctionSnapshot());
assert.equal(guest.map.id, 'map_07');
assert.deepEqual(guest.map.spawnSources, host.map.spawnSources);
for (let i = 0; i < 240; i += 1) { host.tick(); guest.tick(); }
assert.ok(host.state.stats.spawned > 0);
const strip = (snapshot) => { const { lastEventId, ...rest } = snapshot; return rest; };
assert.deepEqual(strip(host.snapshot()), strip(guest.snapshot()));
assert.equal(host.swarm.lastChecksum, guest.swarm.lastChecksum);
// restart on the same map rebinds cleanly and the flow still converges on the centre.
host.resetFreshRun('map_07');
assert.equal(host.state.mapId, 'map_07');
assert.deepEqual({ x: host.state.base.x, y: host.state.base.y }, { x: 0, y: 0 });
console.log('arena map: central base, gapped rings, full relay linkability, perimeter rift progression and deterministic reconstruction passed');
