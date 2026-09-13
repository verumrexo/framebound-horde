import { clampCameraToMap, fitCanvas } from './app/camera.js';
import { captureLosslessFramebuffer, showFatal, syncDiagnostics } from './app/diagnostics.js';
import { frame } from './app/frame-loop.js';
import { installInput } from './app/input.js';
import { activateSession, saveGameBundle } from './app/sessions.js';
import { createAppState } from './app/state.js';
import { PROTOTYPE_SESSION_CONFIG } from './core/session-config.js';
import { playableMaps } from './core/world-config.js';
import { BACKGROUND_FRAGMENT, FULLSCREEN_VERTEX } from './render/background.js';
import { BitmapText } from './render/bitmap-text.js';
import { EnemyRenderer } from './render/enemy-renderer.js';
import { mapThumbnail } from './render/map-thumbnail.js';
import { NebulaRenderer } from './render/nebula-renderer.js';
import { ShapeBatch } from './render/shape-batch.js';
import { createProgram } from './render/webgl.js';

const app = createAppState({
  canvas: document.querySelector('#game'),
  errorPanel: document.querySelector('#gpu-error'),
  reducedNetworkMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
});

addEventListener('error', (event) => showFatal(app, event.error?.stack || event.message || 'uncaught runtime error', 'runtime'));

addEventListener('unhandledrejection', (event) => showFatal(app, event.reason?.stack || event.reason || 'unhandled promise rejection', 'runtime'));

fitCanvas(app);

addEventListener('resize', () => {
  fitCanvas(app);
  if (app.game.sessionSnapshot) clampCameraToMap(app);
}, { passive: true });

app.renderer.gl = app.renderer.canvas.getContext('webgl2', {
  alpha: false,
  antialias: true,
  depth: false,
  desynchronized: false,
  failIfMajorPerformanceCaveat: true,
  powerPreference: 'high-performance',
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  stencil: false
});

if (!app.renderer.gl) {
  showFatal(app, 'webgl2 is unavailable. this prototype does not silently fall back to a softened renderer.');
  throw new Error('webgl2 unavailable');
}

app.renderer.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showFatal(app, 'webgl2 context lost');
});

app.renderer.gl.disable(app.renderer.gl.BLEND);

app.renderer.gl.disable(app.renderer.gl.DEPTH_TEST);

app.renderer.gl.disable(app.renderer.gl.DITHER);

app.renderer.gl.disable(app.renderer.gl.SAMPLE_ALPHA_TO_COVERAGE);

app.renderer.gl.viewport(0, 0, app.renderer.canvas.width, app.renderer.canvas.height);

Object.assign(app.renderer, {
  backgroundProgram: createProgram(app.renderer.gl, FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT),
  nebulaRenderer: new NebulaRenderer(app.renderer.gl, app.viewport),
  enemyRenderer: new EnemyRenderer(app.renderer.gl, app.viewport, PROTOTYPE_SESSION_CONFIG.swarm.initialCapacity),
  shapes: new ShapeBatch(app.renderer.gl, app.viewport),
  bitmapText: new BitmapText(app.renderer.gl, app.viewport)
});

app.ui.pointer = { x: app.viewport.logicalWidth * 0.5, y: app.viewport.logicalHeight * 0.5 };
app.game.lastAutosaveAt = performance.now();
activateSession(app, 'game');
installInput(app);

window.__saveHordeRun = saveGameBundle.bind(null, app);

addEventListener('pagehide', () => { void saveGameBundle(app); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveGameBundle(app);
});

window.__captureHordeFramebuffer = () => captureLosslessFramebuffer(app);
syncDiagnostics(app);

// Prepare map thumbnails while the browser is idle.
(window.requestIdleCallback || ((callback) => setTimeout(callback, 400)))(() => {
  const maps = playableMaps();
  for (const map of maps) mapThumbnail(map, 188, maps.length * 23 - 6);
});

app.timing.previousTime = performance.now();
app.timing.fpsWindow = app.timing.previousTime;
app.timing.lastGpuCheck = app.timing.previousTime;

try {
  requestAnimationFrame(frame.bind(null, app));
} catch (error) {
  showFatal(app, error?.stack || error);
  throw error;
}
