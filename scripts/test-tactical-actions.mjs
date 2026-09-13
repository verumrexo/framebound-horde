import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { isRelayForm } from '../src/core/network-descendants.js';
import { COMMAND } from '../src/core/protocol.js';
import { createAppState } from '../src/app/state.js';
import { towerActionView } from '../src/ui/tower-panels.js';

// Import the production view and actions; capture commands at the session boundary.
const calls = [];
const app = createAppState();
app.game.session = { playerId: 'owner', networkRole: 'host', send: (type, payload) => calls.push({ type, payload }) };
const authority = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
authority.join({ clientId: 'owner', payload: { label: 'owner' } });
const snapshot = { ...authority.state, towerCatalog: Object.values(TOWER_DEFINITIONS), players: [{ id: 'owner', label: 'owner' }, { id: 'peer', label: 'peer' }] };
const area = authority.map.defenseAreas[0];
app.game.currentMap = authority.map;
app.game.sessionSnapshot = snapshot;
function tower(id, extra = {}) {
  return authority.normalizeTower({ id: `test_${id}`, definitionId: id, ownerId: 'owner', areaId: area.id,
    x: area.shape.x, y: area.shape.y, totalInvestment: 1000, ...extra });
}
function view(id, extra) {
  const subject = tower(id, extra);
  snapshot.towers = [subject];
  app.ui.selectedTowerId = subject.id;
  return towerActionView(app, snapshot, subject);
}
function runAction(model, prefix, expected) {
  const action = model.actions.find((item) => item.id.startsWith(prefix));
  assert.ok(action, `${model.title}: ${prefix}`);
  calls.length = 0; action.action();
  const modes = {
    openResearchStation: 'research', openRelayTargetMenu: 'relay', openUpgradeMenu: 'upgrades',
    openControlGeometryMenu: 'control', openStrikeTargetMenu: 'strike'
  };
  if (modes[expected]) assert.equal(app.ui.towerMenuMode, modes[expected]);
  else {
    const commands = {
      sellSelectedTower: COMMAND.TOWER_SELL,
      clearSelectedStrikePoint: COMMAND.TOWER_STRIKE_POINT_SET,
      resetSelectedControlGeometry: COMMAND.TOWER_CONTROL_GEOMETRY_SET
    };
    assert.equal(calls[0]?.type, commands[expected]);
    assert.equal(calls[0]?.payload.towerId, app.ui.selectedTowerId);
    if (expected === 'clearSelectedStrikePoint') assert.deepEqual(calls[0].payload, { towerId: app.ui.selectedTowerId, x: null, y: null });
    if (expected === 'resetSelectedControlGeometry') assert.deepEqual(calls[0].payload, { towerId: app.ui.selectedTowerId, geometry: null });
  }
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
assert.equal(app.ui.towerMenuMode, 'socket');
view('echo').actions.find((action) => action.id.startsWith('network_config_')).action();
assert.equal(app.ui.towerMenuMode, 'echo');
const manualControl = Object.values(TOWER_DEFINITIONS).find((definition) => definition.control?.input && definition.control.input !== 'none' && !isRelayForm(definition.id));
runAction(view(manualControl.id), 'tower_aim_', 'openControlGeometryMenu');
runAction(view(manualControl.id), 'tower_auto_aim_', 'resetSelectedControlGeometry');
runAction(view('echo', { echoWeaponId: manualControl.id }), 'echo_control_', 'openControlGeometryMenu');
runAction(view('laser'), 'tower_aim_', 'openStrikeTargetMenu');
runAction(view('laser'), 'tower_auto_aim_', 'clearSelectedStrikePoint');
console.log('tactical actions: all catalog forms, shared control, station, relay/socket, echo, aim, and reset passed');
