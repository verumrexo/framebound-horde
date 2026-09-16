import assert from 'node:assert/strict';
import { createAppState } from '../src/app/state.js';
import { project, unproject } from '../src/app/camera.js';
import { drawEdgeIndicator, drawSurgeEdgeIndicators, edgeIndicatorForPoint } from '../src/render/edge-indicators.js';
import { drawPings } from '../src/ui/social.js';
import { COLOR, PLAYER_COLORS } from '../src/ui/palette.js';

const app = createAppState();
const drawn = [], labels = [];
app.renderer.shapes = {
  rect: (...args) => drawn.push({ kind: 'rect', args }),
  line: (...args) => drawn.push({ kind: 'line', args })
};
app.renderer.bitmapText = { draw: (...args) => labels.push(args) };
app.effects.reducedNetworkMotion = { matches: false };
const reset = () => { drawn.length = 0; labels.length = 0; };
for (const [width, height, top, bottom] of [[320, 180, 26, 116], [640, 360, 32, 317], [960, 540, 32, 497]]) {
  Object.assign(app.viewport, { logicalWidth: width, logicalHeight: height, HUD_TOP_HEIGHT: top, hudBottomY: bottom });
  const cx = width / 2, cy = (top + bottom) / 2;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
    const point = { x: cx + Math.cos(angle) * 10000, y: cy + Math.sin(angle) * 10000 };
    const marker = edgeIndicatorForPoint(point, app.viewport);
    assert.ok(marker);
    assert.ok(marker.x >= 14 && marker.x <= width - 14 && marker.y >= top + 14 && marker.y <= bottom - 14);
    assert.ok(Math.min(marker.x - 14, width - 14 - marker.x, marker.y - top - 14, bottom - 14 - marker.y) <= 1, 'marker touches the inset frame');
    assert.ok(Math.abs((marker.x - cx) * marker.dy - (marker.y - cy) * marker.dx) < 0.8, 'projection preserves target bearing, including corners');
    reset();
    drawEdgeIndicator(app, marker, COLOR.amber, { kind: 'surge', label: 'surge 45s x3', pulse: 1 });
    for (const { kind, args } of drawn) {
      const [x, y, a, b] = args;
      assert.ok(args.slice(0, -1).every(Number.isFinite));
      const right = kind === 'rect' ? x + a : a, lower = kind === 'rect' ? y + b : b;
      assert.ok(Math.min(x, right) >= 0 && Math.max(x, right) <= width);
      assert.ok(Math.min(y, lower) >= top && Math.max(y, lower) <= bottom);
    }
  }
  assert.equal(edgeIndicatorForPoint({ x: cx, y: cy }, app.viewport), null);
  assert.ok(edgeIndicatorForPoint({ x: cx, y: top - 1 }, app.viewport), 'targets hidden by the top HUD count as offscreen');
  assert.ok(edgeIndicatorForPoint({ x: cx, y: bottom + 1 }, app.viewport), 'targets hidden by the bottom HUD count as offscreen');
  assert.equal(edgeIndicatorForPoint({ x: NaN, y: cy }, app.viewport), null);
}
Object.assign(app.viewport, { logicalWidth: 640, logicalHeight: 360, HUD_TOP_HEIGHT: 32, hudBottomY: 317 });
Object.assign(app.viewport.camera, { x: 0, y: 0, scale: 1 });
app.game.currentMap = { spawnSources: [{ id: 'a', x: 4000, y: 0 }, { id: 'b', x: 4100, y: 1 }, { id: 'c', x: -4000, y: 0 }] };
const snapshot = { runTick: 60, pace: 0.8, swarm: { threatSeconds: 40, surge: {
  phase: 'warning', riftIds: ['a', 'b', 'c'], activeAtSeconds: 48
} } };
app.game.sessionSnapshot = { ...snapshot, players: [{ id: 'peer', colorId: 'player_2' }] };
reset(); drawSurgeEdgeIndicators(app, snapshot);
assert.equal(labels.length, 2, 'neighbouring offscreen rifts share a marker while opposite bearings stay separate');
assert.ok(labels.some(([label]) => label === 'surge 10s x2'), 'warning uses real seconds at the chosen pace');
assert.ok(labels.every(([, , , color]) => color === COLOR.amber));
const warningFrame = JSON.stringify(drawn);
reset(); drawSurgeEdgeIndicators(app, snapshot);
assert.equal(JSON.stringify(drawn), warningFrame, 'paused ticks hold surge animation');
snapshot.swarm.surge.phase = 'active';
reset(); drawSurgeEdgeIndicators(app, snapshot);
assert.ok(labels.every(([label, , , color]) => label.startsWith('surge') && !label.includes('s ') && color === COLOR.red));
app.viewport.camera.x = 4050;
reset(); drawSurgeEdgeIndicators(app, snapshot);
assert.equal(labels.length, 1, 'panning to hot rifts removes their edge markers');
snapshot.swarm.surge.phase = 'idle';
reset(); drawSurgeEdgeIndicators(app, snapshot);
assert.equal(drawn.length, 0);

app.viewport.camera.x = 0;
app.social.pings = [{ playerId: 'peer', x: 4000, y: 0, receivedAt: 100 }];
reset(); drawPings(app, 200);
assert.ok(drawn.some(({ kind }) => kind === 'line'), 'offscreen ping has an outward indicator');
assert.ok(drawn.some(({ args }) => args.at(-1) === PLAYER_COLORS[2]), 'ping retains sender colour');
for (const scale of [1, 2, 4, 8]) {
  app.viewport.camera.scale = scale;
  assert.ok(edgeIndicatorForPoint(project(app, 4000, 0), app.viewport));
}
app.viewport.camera.x = 4000;
reset(); drawPings(app, 200);
assert.equal(drawn.length, 4, 'visible ping uses its existing world ring exactly once');
assert.ok(drawn.every(({ kind }) => kind === 'rect'));
app.effects.reducedNetworkMotion.matches = true;
reset(); drawPings(app, 250); const still = JSON.stringify(drawn);
reset(); drawPings(app, 800); assert.equal(JSON.stringify(drawn), still);
for (const y of [app.viewport.HUD_TOP_HEIGHT + 1, app.viewport.hudBottomY - 1]) {
  Object.assign(app.social.pings[0], unproject(app, 320, y));
  reset(); drawPings(app, 800);
  assert.ok(drawn.length > 0);
  for (const { args: [, top, , height] } of drawn) {
    assert.ok(top >= app.viewport.HUD_TOP_HEIGHT && top + height <= app.viewport.hudBottomY, 'onscreen rings cannot bleed onto the HUD');
  }
}
reset(); drawPings(app, 3100);
assert.equal(drawn.length, 0); assert.equal(app.social.pings.length, 0, 'edge pings expire on the original three-second lifetime');
console.log('edge indicators: all bearings, HUD bounds, zoom/pan, surge phases/grouping, ping colour/expiry and reduced motion passed');
