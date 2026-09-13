import { updateHudBounds } from './camera.js';
import { showFatal, syncDiagnostics } from './diagnostics.js';
import { renderFrame } from './render-frame.js';
import { handleSessionEvents } from './session-events.js';
import { saveGameBundle } from './sessions.js';
import { updatePresence } from './social.js';

export function frame(app, now) {
  const elapsedMs = Math.min(133, Math.max(1, now - app.timing.previousTime));
  const dt = Math.min(0.033, elapsedMs / 1000);
  app.timing.previousTime = now;
  if (app.game.sessionMode === 'test' && app.game.gameHasEnteredGameplay) app.game.sessions.get('game')?.session.advance(elapsedMs);
  const timeScale = app.game.sessionMode === 'test' ? (app.game.sessionSnapshot.test?.timeScale || 1) : 1;
  const shouldAdvance = Boolean(app.game.session.networkRole) || app.game.sessionMode !== 'game' || app.game.gameHasEnteredGameplay;
  const sessionFrame = app.game.session.advance(shouldAdvance ? elapsedMs * timeScale : 0);
  app.game.sessionSnapshot = sessionFrame.snapshot;
  handleSessionEvents(app, sessionFrame.events);
  updatePresence(app, now);
  app.timing.frameCounter += 1;
  if (now - app.timing.fpsWindow >= 500) {
    app.timing.fps = Math.round(app.timing.frameCounter * 1000 / (now - app.timing.fpsWindow));
    app.timing.frameCounter = 0;
    app.timing.fpsWindow = now;
  }
  if (now - app.game.lastAutosaveAt >= 15000) {
    app.game.lastAutosaveAt = now;
    void saveGameBundle(app);
  }

  updateHudBounds(app);
  renderFrame(app, now, dt, app.timing.fps);
  const frameCost = performance.now() - now;
  app.timing.frameTiming.last = frameCost;
  app.timing.frameTiming.average += (frameCost - app.timing.frameTiming.average) * 0.05;
  app.timing.frameTiming.worst = Math.max(frameCost, app.timing.frameTiming.worst * 0.98);
  if (now - app.timing.lastGpuCheck > 1000) {
    const error = app.renderer.gl.getError();
    if (error !== app.renderer.gl.NO_ERROR) {
      showFatal(app, `webgl error 0x${error.toString(16)}`);
      return;
    }
    app.timing.lastGpuCheck = now;
    syncDiagnostics(app);
  }
  app.renderer.shapes.endFrame();

  requestAnimationFrame(frame.bind(null, app));
}
