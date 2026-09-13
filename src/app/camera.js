import { pixelHudLayout } from '../ui/pixel-layout.js';

export function fitCanvas(app) {
  app.viewport.displayPixelScale = innerWidth >= 960 && innerHeight >= 540 ? 2 : 1;
  const nextWidth = Math.max(320, Math.floor(innerWidth / app.viewport.displayPixelScale));
  const nextHeight = Math.max(180, Math.floor(innerHeight / app.viewport.displayPixelScale));
  app.viewport.logicalWidth = nextWidth;
  app.viewport.logicalHeight = nextHeight;
  const hud = pixelHudLayout(app.viewport.logicalWidth, app.game.sessionMode);
  app.viewport.HUD_TOP_HEIGHT = hud.topHeight;
  app.viewport.hudBottomY = app.viewport.logicalHeight - hud.bottomHeight;
  app.viewport.renderScale = app.viewport.displayPixelScale * Math.max(1, window.devicePixelRatio || 1);
  app.renderer.canvas.width = Math.round(app.viewport.logicalWidth * app.viewport.renderScale);
  app.renderer.canvas.height = Math.round(app.viewport.logicalHeight * app.viewport.renderScale);
  app.renderer.canvas.style.width = `${app.viewport.logicalWidth * app.viewport.displayPixelScale}px`;
  app.renderer.canvas.style.height = `${app.viewport.logicalHeight * app.viewport.displayPixelScale}px`;
  if (app.renderer.gl) app.renderer.gl.viewport(0, 0, app.renderer.canvas.width, app.renderer.canvas.height);
  window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), nativeRenderScale: app.viewport.renderScale };
}

export function allowedZoomLevels(app) {
  return app.viewport.zoomLevels;
}

export function clampCameraToMap(app) {
  if (!app.viewport.zoomLevels.includes(app.viewport.camera.scale)) app.viewport.camera.scale = app.viewport.zoomLevels.at(-1);
  const bounds = app.game.currentMap.bounds;
  const halfWidth = app.viewport.logicalWidth * app.viewport.camera.scale * 0.5;
  const minimumX = bounds.left + halfWidth;
  const maximumX = bounds.right - halfWidth;
  app.viewport.camera.x = minimumX <= maximumX ? Math.max(minimumX, Math.min(maximumX, app.viewport.camera.x)) : (bounds.left + bounds.right) / 2;
  const minimumY = bounds.top + (app.viewport.logicalHeight * 0.5 - app.viewport.HUD_TOP_HEIGHT) * app.viewport.camera.scale;
  // The lower edge of the playable viewport must never show space below the wall.
  const maximumY = bounds.bottom - (app.viewport.hudBottomY - app.viewport.logicalHeight * 0.5) * app.viewport.camera.scale;
  app.viewport.camera.y = Math.min(maximumY, Math.max(minimumY, app.viewport.camera.y));
}

export function canvasPoint(app, event) {
  const rect = app.renderer.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * app.viewport.logicalWidth / rect.width,
    y: (event.clientY - rect.top) * app.viewport.logicalHeight / rect.height
  };
}

export function project(app, x, y) {
  return {
    x: (x - app.viewport.camera.x) / app.viewport.camera.scale + app.viewport.logicalWidth * 0.5,
    y: (y - app.viewport.camera.y) / app.viewport.camera.scale + app.viewport.logicalHeight * 0.5
  };
}

export function unproject(app, screenX, screenY) {
  return {
    x: Math.round((screenX - app.viewport.logicalWidth * 0.5) * app.viewport.camera.scale + app.viewport.camera.x),
    y: Math.round((screenY - app.viewport.logicalHeight * 0.5) * app.viewport.camera.scale + app.viewport.camera.y)
  };
}

export function viewport(app) {
  return { width: app.viewport.logicalWidth, height: app.viewport.logicalHeight };
}

export function updateHudBounds(app) {
  const layout = pixelHudLayout(app.viewport.logicalWidth, app.game.sessionMode);
  const bottom = app.viewport.logicalHeight - layout.bottomHeight;
  if (app.viewport.HUD_TOP_HEIGHT !== layout.topHeight || app.viewport.hudBottomY !== bottom) {
    app.viewport.HUD_TOP_HEIGHT = layout.topHeight;
    app.viewport.hudBottomY = bottom;
    clampCameraToMap(app);
  }
}
