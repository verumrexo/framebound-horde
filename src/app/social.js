import { unproject } from './camera.js';
import { towerPlacementClear } from '../core/placement.js';
import { findDefenseAreaAt } from '../core/world-config.js';
import { PLAYER_COLORS } from '../ui/palette.js';

export function playerColor(app, playerOrId) {
  const player = typeof playerOrId === 'string'
    ? app.game.sessionSnapshot?.players.find((candidate) => candidate.id === playerOrId)
    : playerOrId;
  const index = Number(String(player?.colorId || 'player_0').split('_').at(-1)) || 0;
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export function resetMultiplayerSocial(app) {
  app.social.messages.length = 0;
  app.social.presenceByPlayer.clear();
  app.social.presenceSequenceByPlayer.clear();
  app.social.pings.length = 0;
  app.social.chatOpen = false;
  app.social.chatInput = '';
  app.social.rosterExpanded = false;
  app.social.pingArmed = false;
  app.social.lastPresenceSignature = '';
  app.social.idleSent = true;
}

export function addSystemMessage(app, text) {
  addChatMessage(app, { kind: 'system', text: String(text || '').toLowerCase() });
}

export function addChatMessage(app, message) {
  app.social.messages.push({ ...message, receivedAt: performance.now() });
  if (app.social.messages.length > 50) app.social.messages.splice(0, app.social.messages.length - 50);
}

export function receiveSocialMessage(app, message) {
  if (message.kind === 'chat') addChatMessage(app, message);
  else if (message.kind === 'ping') app.social.pings.push({ ...message, receivedAt: performance.now() });
}

export function receivePresenceMessage(app, message) {
  const sequence = Number.isSafeInteger(message.sequence) ? message.sequence : -1;
  const previous = app.social.presenceSequenceByPlayer.get(message.playerId) || -1;
  if (sequence <= previous) return;
  app.social.presenceSequenceByPlayer.set(message.playerId, sequence);
  if (!message.active) {
    app.social.presenceByPlayer.delete(message.playerId);
    return;
  }
  app.social.presenceByPlayer.set(message.playerId, { ...message, receivedAt: performance.now() });
}

export function currentPresencePayload(app, now) {
  const inWorld = app.ui.frontEndScreen === 'game' && app.ui.pointer.y > app.viewport.HUD_TOP_HEIGHT && app.ui.pointer.y < app.viewport.hudBottomY && document.hasFocus();
  const interacting = app.ui.placementArmed || Boolean(app.ui.selectedTowerId) || Boolean(app.ui.controlDrag);
  if (!app.game.session.networkRole || !inWorld || (!interacting && now - app.ui.lastPointerMotionAt > 300)) return { active: false };
  const world = unproject(app, app.ui.pointer.x, app.ui.pointer.y);
  const definitionId = app.ui.placementArmed ? (app.ui.bulkPlacementDefinitionId || 'frame') : null;
  const areaId = definitionId ? findDefenseAreaAt(app.game.currentMap, world.x, world.y) : null;
  const clear = definitionId ? towerPlacementClear(app.game.sessionSnapshot.towers, world.x, world.y) : false;
  return {
    active: true,
    x: Math.round(world.x),
    y: Math.round(world.y),
    activity: definitionId ? 'placing' : app.ui.selectedTowerId ? 'inspecting' : 'looking',
    towerId: app.ui.selectedTowerId,
    definitionId,
    valid: Boolean(areaId && clear)
  };
}

export function updatePresence(app, now) {
  if (!app.game.session.networkRole || !app.game.session.sendPresence) return;
  const payload = currentPresencePayload(app, now);
  const signature = JSON.stringify(payload);
  if (!payload.active) {
    if (!app.social.idleSent) app.game.session.sendPresence(payload);
    app.social.idleSent = true;
    app.social.lastPresenceSignature = signature;
    return;
  }
  app.social.idleSent = false;
  if (now - app.social.lastPresenceSentAt < 1000 / 12) return;
  if (signature === app.social.lastPresenceSignature && now - app.social.lastPresenceSentAt < 1000) return;
  if (app.game.session.sendPresence(payload)) {
    app.social.lastPresenceSentAt = now;
    app.social.lastPresenceSignature = signature;
  }
}

export function playerActivity(app, player) {
  if (player.id === app.game.session.playerId) return app.ui.placementArmed ? 'placing' : app.ui.selectedTowerId ? 'inspecting' : 'active';
  return app.social.presenceByPlayer.get(player.id)?.activity || 'idle';
}
