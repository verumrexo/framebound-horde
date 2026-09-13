import assert from 'node:assert/strict';
import { createAppState } from '../src/app/state.js';
import { activateSession } from '../src/app/sessions.js';
import { canvasPoint, fitCanvas, project, unproject } from '../src/app/camera.js';
import { handleSessionEvents } from '../src/app/session-events.js';
import { EVENT } from '../src/core/protocol.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { pixelHudLayout } from '../src/ui/pixel-layout.js';
// Importing input must not register browser listeners before startup installs it.
import { installInput } from '../src/app/input.js';

assert.equal(typeof installInput, 'function');
const canvas = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
const app = createAppState({ canvas, now: 100 });
const other = createAppState({ now: 100 });
app.ui.selectedTowerId = 'test';
app.effects.attackFlashes.push({ age: 0 });
assert.equal(other.ui.selectedTowerId, null);
assert.equal(other.effects.attackFlashes.length, 0);
assert.notEqual(app.game.sessions, other.game.sessions);
assert.notEqual(app.viewport.camera, other.viewport.camera);

const globals = ['window', 'innerWidth', 'innerHeight'];
const saved = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
try {
  Object.assign(globalThis, { window: { devicePixelRatio: 2 }, innerWidth: 1280, innerHeight: 720 });
  const viewportCalls = [];
  app.renderer.gl = { viewport: (...args) => viewportCalls.push(args) };
  app.renderer.enemyRenderer = { lastTick: 20, lastState: {} };
  fitCanvas(app);
  assert.equal(app.viewport.logicalWidth, 640);
  assert.equal(app.viewport.logicalHeight, 360);
  assert.equal(app.viewport.renderScale, 4);
  assert.deepEqual(viewportCalls.at(-1), [0, 0, 2560, 1440]);
  assert.deepEqual(canvasPoint(app, { clientX: 640, clientY: 360 }), { x: 320, y: 180 });

  const makeSession = (mapId, towers = []) => ({
    playerId: 'owner',
    snapshot: () => ({ mapId, seed: 123, runTick: 0, towers })
  });
  const game = makeSession('map_02');
  const test = makeSession('test_field', [{ id: 'test_tower' }]);
  app.game.sessions.set('game', { session: game, authority: { id: 'game' } });
  app.game.sessions.set('test', { session: test, authority: { id: 'test' } });
  activateSession(app, 'game');
  assert.equal(app.game.session, game);
  assert.equal(app.game.currentMap.id, 'map_02');
  assert.equal(app.effects.attackFlashes.length, 0);
  assert.equal(app.renderer.enemyRenderer.lastTick, -1);
  const savedCamera = { ...app.viewport.camera };

  activateSession(app, 'test');
  assert.equal(app.game.session, test);
  assert.equal(app.ui.selectedTowerId, 'test_tower');
  assert.equal(app.game.sessionSnapshot.mapId, 'test_field');
  activateSession(app, 'game');
  assert.equal(app.ui.selectedTowerId, null);
  assert.equal(app.viewport.camera.x, savedCamera.x);
  assert.equal(app.viewport.camera.y, savedCamera.y);
  assert.equal(app.viewport.camera.scale, savedCamera.scale);

  Object.assign(globalThis, { innerWidth: 840, innerHeight: 480 });
  fitCanvas(app);
  assert.equal(app.viewport.logicalWidth, 840);
  assert.equal(app.viewport.displayPixelScale, 1);
  assert.equal(app.viewport.HUD_TOP_HEIGHT, pixelHudLayout(840, 'game').topHeight);
  const world = { x: 35, y: -120 };
  const screen = project(app, world.x, world.y);
  assert.deepEqual(unproject(app, screen.x, screen.y), world);
  assert.deepEqual(viewportCalls.at(-1), [0, 0, 1680, 960]);

  const tower = { id: 'frame_1', ownerId: 'owner', definitionId: 'frame', x: 30, y: 200 };
  app.game.sessionSnapshot = { ...game.snapshot(), towers: [tower], towerCatalog: Object.values(TOWER_DEFINITIONS) };
  handleSessionEvents(app, [{ type: EVENT.TOWER_PLACED, payload: { tower } }]);
  assert.equal(app.ui.selectedTowerId, tower.id);
  assert.equal(app.ui.towerMenuMode, 'actions');
  assert.equal(app.effects.assembly.items.length, 1);
  app.preferences.autoSelectPlacedFrame = false;
  handleSessionEvents(app, [{ type: EVENT.TOWER_PLACED, payload: { tower } }]);
  assert.equal(app.ui.selectedTowerId, null);
  assert.equal(app.ui.towerMenuMode, null);
  app.ui.bulkPlacementDefinitionId = 'frame';
  handleSessionEvents(app, [{ type: EVENT.TOWER_PLACED, payload: { tower } }]);
  assert.equal(app.ui.placementArmed, true);
  assert.equal(app.ui.selectedTowerId, null);
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

console.log('client modules: isolated state, live resize/projection, session switching, render reset, and placement events passed');
