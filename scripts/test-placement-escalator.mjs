import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { FREE_PLACEMENTS, PLACEMENT_ESCALATOR, placementEscalation, purchaseCost } from '../src/core/network-descendants.js';
import { defenseAreaField } from '../src/core/world-config.js';
import { towerPlacementClear } from '../src/core/placement.js';

let checks = 0;
function test(label, run) { run(); checks++; console.log(`ok ${checks} - ${label}`); }

function production() {
  const a = new EmbeddedAuthority({ ...TEST_FIELD_SESSION_CONFIG, test: null, mode: 'game', mapId: 'map_01', startingCredits: 1e12 });
  a.join({ clientId: 'test', payload: { label: 'test' } });
  const player = a.state.players[0];
  let sequence = 0;
  const command = (payload) => ({ clientId: 'test', playerId: player.id, sequence: ++sequence, payload });
  const spots = [];
  for (const area of a.map.defenseAreas) {
    for (let y = area.shape.y - 120; y <= area.shape.y + 120; y += 26) {
      for (let x = area.shape.x - 180; x <= area.shape.x + 180; x += 26) {
        if (defenseAreaField(area, x, y, -6) <= 0 && towerPlacementClear(spots, x, y)) spots.push({ x, y });
      }
    }
  }
  const wallet = () => a.state.teamEconomy.credits;
  const place = (definitionId = 'frame') => {
    const spot = spots[a.state.towers.length + placed];
    const before = wallet();
    a.placeTower(command({ definitionId, x: spot.x, y: spot.y }), player);
    return before - wallet();
  };
  let placed = 0;
  return { a, player, command, wallet, place, spots };
}

test('the first thirty placements cost their catalog price; later sockets escalate geometrically', () => {
  const { a, place } = production();
  assert.equal(FREE_PLACEMENTS, 30);
  for (let index = 0; index < FREE_PLACEMENTS; index += 1) assert.equal(place('frame'), 100);
  assert.equal(a.state.towers.length, FREE_PLACEMENTS);
  assert.equal(place('frame'), Math.ceil(100 * PLACEMENT_ESCALATOR - 1e-8));
  assert.equal(place('frame'), Math.ceil(100 * PLACEMENT_ESCALATOR ** 2 - 1e-8));
  assert.equal(placementEscalation(a.state), PLACEMENT_ESCALATOR ** 3);
  assert.equal(purchaseCost(a.state, null, 1500, { placement: true }), Math.ceil(1500 * PLACEMENT_ESCALATOR ** 3 - 1e-8));
  assert.equal(place('flechette'), Math.ceil(1500 * PLACEMENT_ESCALATOR ** 3 - 1e-8));
  assert.ok(purchaseCost(a.state, null, 1500, { placement: true }) > 1500 * 1.15, 'placement 34 costs a visible premium');
});

test('upgrades are never escalated and selling lowers the next placement price', () => {
  const { a, player, command, place, wallet } = production();
  for (let index = 0; index < FREE_PLACEMENTS + 5; index += 1) place('frame');
  const tower = a.state.towers[0];
  const before = wallet();
  a.evolveTower(command({ towerId: tower.id, definitionId: 'assault' }), player);
  assert.equal(before - wallet(), 200);
  assert.equal(purchaseCost(a.state, tower.areaId, 400), 400);
  const escalated = purchaseCost(a.state, null, 100, { placement: true });
  a.sellTower(command({ towerId: a.state.towers.at(-1).id }), player);
  assert.ok(purchaseCost(a.state, null, 100, { placement: true }) < escalated);
  assert.equal(a.state.towers.at(-1).totalInvestment, Math.ceil(100 * PLACEMENT_ESCALATOR ** 4 - 1e-8), 'investment records the paid price (placement 34 after one sale)');
});

test('the construction reactor discount multiplies the escalated price', () => {
  const { a, place } = production();
  for (let index = 0; index < FREE_PLACEMENTS + 10; index += 1) place('frame');
  const full = purchaseCost(a.state, null, 1500, { placement: true });
  a.state.research.reactor.construction = 35;
  assert.equal(purchaseCost(a.state, null, 1500, { placement: true }), Math.max(1, Math.ceil(1500 * PLACEMENT_ESCALATOR ** 11 * 0.5 - 1e-8)));
  assert.ok(purchaseCost(a.state, null, 1500, { placement: true }) < full);
});

test('the test field never escalates', () => {
  const a = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  a.state.towers = Array.from({ length: 80 }, (_, index) => ({ id: `t${index}` }));
  assert.equal(placementEscalation(a.state), 1);
  assert.equal(purchaseCost(a.state, null, 1500, { placement: true }), 1500);
});

console.log(`${checks} placement escalator groups passed`);
