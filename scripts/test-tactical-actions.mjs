import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { compactMetric } from '../src/core/format.js';
import { supportsStrikePoint } from '../src/core/strike-pattern.js';
import { isRelayForm, networkSources, saleRefund } from '../src/core/network-descendants.js';
import { AUTHORITY_TICK_RATE } from '../src/core/protocol.js';

// Exercise the actual shared view builder without booting WebGL or automating gameplay.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
};
const calls = [];
const context = vm.createContext({
  compactMetric, supportsStrikePoint, isRelayForm, networkSources, saleRefund, AUTHORITY_TICK_RATE,
  session: { playerId: 'owner', networkRole: 'host' },
  COLOR: Object.fromEntries(['amber', 'cyan', 'mint', 'green', 'red', 'ink', 'dimMint'].map((key) => [key, key])),
  towerMenuMode: 'actions',
  ...Object.fromEntries(['openResearchStation', 'sellSelectedTower', 'openRelayTargetMenu', 'openUpgradeMenu',
    'openControlGeometryMenu', 'openStrikeTargetMenu', 'clearSelectedStrikePoint', 'resetSelectedControlGeometry', 'setStatus']
    .map((name) => [name, (...args) => calls.push({ name, args })]))
});
vm.runInContext([extract('towerAccent'), extract('weaponView'), extract('economyNetworkSummary'), extract('towerActionView')].join('\n'), context);
const authority = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
authority.join({ clientId: 'owner', payload: { label: 'owner' } });
const snapshot = { ...authority.state, towerCatalog: Object.values(TOWER_DEFINITIONS), players: [{ id: 'owner', label: 'owner' }, { id: 'peer', label: 'peer' }] };
const area = authority.map.defenseAreas[0];
function tower(id, extra = {}) {
  return authority.normalizeTower({ id: `test_${id}`, definitionId: id, ownerId: 'owner', areaId: area.id,
    x: area.shape.x, y: area.shape.y, totalInvestment: 1000, ...extra });
}
function view(id, extra) { return context.towerActionView(snapshot, tower(id, extra)); }
function runAction(model, prefix, expected) {
  const action = model.actions.find((item) => item.id.startsWith(prefix));
  assert.ok(action, `${model.title}: ${prefix}`);
  calls.length = 0; action.action();
  assert.equal(calls[0]?.name, expected);
}
for (const id of Object.keys(TOWER_DEFINITIONS)) {
  const owned = view(id);
  assert.ok(owned.title && owned.metric, `${id}: readable heading and metric`);
  assert.ok(owned.actions.some((action) => action.id.includes('sell')), `${id}: sale available`);
  const inspected = view(id, { ownerId: 'peer' });
  assert.equal(inspected.inspectOnly, false, id);
  assert.ok(inspected.actions.some((action) => action.id.includes('sell')), `${id}: teammate sale available`);
}
runAction(view('frame'), 'tower_upgrade_', 'openUpgradeMenu');
runAction(view('frame'), 'tower_sell_', 'sellSelectedTower');
for (const id of ['arsenal', 'reactor']) runAction(view(id), 'station_open', 'openResearchStation');
runAction(view('hardpoint'), 'network_link_', 'openRelayTargetMenu');
view('hardpoint').actions.find((action) => action.id.startsWith('network_config_')).action();
assert.equal(context.towerMenuMode, 'socket');
view('echo').actions.find((action) => action.id.startsWith('network_config_')).action();
assert.equal(context.towerMenuMode, 'echo');
const manualControl = Object.values(TOWER_DEFINITIONS).find((definition) => definition.control?.input && definition.control.input !== 'none' && !isRelayForm(definition.id));
runAction(view(manualControl.id), 'tower_aim_', 'openControlGeometryMenu');
runAction(view(manualControl.id), 'tower_auto_aim_', 'resetSelectedControlGeometry');
runAction(view('echo', { echoWeaponId: manualControl.id }), 'echo_control_', 'openControlGeometryMenu');
runAction(view('laser'), 'tower_aim_', 'openStrikeTargetMenu');
runAction(view('laser'), 'tower_auto_aim_', 'clearSelectedStrikePoint');
console.log('tactical actions: all catalog forms, shared control, station, relay/socket, echo, aim, and reset passed');
