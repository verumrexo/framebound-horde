export function registerHitbox(app, id, x, y, width, height, options = {}) {
  app.ui.uiHitboxes.push({ id, x, y, width, height, ...options });
}

export function hitboxAt(app, point) {
  for (let index = app.ui.uiHitboxes.length - 1; index >= 0; index -= 1) {
    const hitbox = app.ui.uiHitboxes[index];
    if (point.x >= hitbox.x && point.x <= hitbox.x + hitbox.width && point.y >= hitbox.y && point.y <= hitbox.y + hitbox.height) return hitbox;
  }
  return null;
}

export function cancelPointerGesture(app) {
  app.ui.dragging = false;
  app.ui.pointerDown = null;
  app.ui.dragDistance = 0;
  app.ui.uiDrag = null;
  app.ui.controlDrag = null;
}

export function clearTransientUi(app) {
  app.ui.dragging = false;
  app.ui.pointerDown = null;
  app.ui.dragDistance = 0;
  app.ui.uiDrag = null;
  app.ui.controlDrag = null;
  app.ui.placementArmed = false;
  app.ui.bulkPlacementDefinitionId = null;
  app.ui.buildCatalogOpen = false;
  app.ui.selectedTowerId = null;
  app.ui.towerMenuMode = null;
}

export function setStatus(app, message, duration = 1800) {
  app.ui.statusMessage = String(message).toLowerCase().slice(0, 36);
  app.ui.statusUntil = performance.now() + duration;
}
