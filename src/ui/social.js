import { project } from '../app/camera.js';
import { playerActivity, playerColor } from '../app/social.js';
import { registerHitbox } from '../app/ui-state.js';
import { compactMetric } from '../core/format.js';
import { towerScreenBounds } from '../render/tower-sprites.js';
import { drawBodyBrackets } from '../render/world-sprites.js';
import { drawTower } from '../render/world.js';
import { COLOR } from './palette.js';
import { clippedUiText, drawButton, drawTechPanel } from './widgets.js';

export function drawRemotePresence(app, now) {
  for (const [playerId, presence] of app.social.presenceByPlayer) {
    if (playerId === app.game.session.playerId || now - presence.receivedAt > 1500) {
      if (now - presence.receivedAt > 1500) app.social.presenceByPlayer.delete(playerId);
      continue;
    }
    const player = app.game.sessionSnapshot.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connectionState !== 'connected') continue;
    const color = playerColor(app, player);
    const p = project(app, presence.x, presence.y);
    if (p.y <= app.viewport.HUD_TOP_HEIGHT || p.y >= app.viewport.hudBottomY) continue;
    if (presence.activity === 'placing' && presence.definitionId) {
      const ghost = { definitionId: presence.definitionId, x: presence.x, y: presence.y };
      const tint = presence.valid ? color : COLOR.red;
      drawTower(app, ghost, { accent: tint, core: tint });
      drawBodyBrackets(app.renderer.shapes, p, towerScreenBounds(ghost.definitionId, app.viewport.camera.scale), tint);
    }
    if (presence.towerId) {
      const tower = app.game.sessionSnapshot.towers.find((candidate) => candidate.id === presence.towerId);
      if (tower) {
        const selected = project(app, tower.x, tower.y);
        drawBodyBrackets(app.renderer.shapes, selected, towerScreenBounds(tower.definitionId, app.viewport.camera.scale), color);
      }
    }
    app.renderer.shapes.rect(p.x - 4, p.y, 3, 1, color);
    app.renderer.shapes.rect(p.x + 2, p.y, 3, 1, color);
    app.renderer.shapes.rect(p.x, p.y - 4, 1, 3, color);
    app.renderer.shapes.rect(p.x, p.y + 2, 1, 3, color);
    app.renderer.bitmapText.draw(clippedUiText(player.label, 72), p.x + 7, p.y - 4, color, 1);
  }
  app.social.pings = app.social.pings.filter((ping) => now - ping.receivedAt < 3000);
  for (const ping of app.social.pings) {
    const p = project(app, ping.x, ping.y);
    const color = playerColor(app, ping.playerId);
    const phase = Math.floor((now - ping.receivedAt) / 150) % 4;
    const radius = 8 + phase * 3;
    app.renderer.shapes.rect(p.x - radius, p.y - radius, radius * 2 + 1, 1, color);
    app.renderer.shapes.rect(p.x - radius, p.y + radius, radius * 2 + 1, 1, color);
    app.renderer.shapes.rect(p.x - radius, p.y - radius + 1, 1, radius * 2 - 1, color);
    app.renderer.shapes.rect(p.x + radius, p.y - radius + 1, 1, radius * 2 - 1, color);
  }
}

export function drawGameplayRoster(app, snapshot) {
  if (!app.game.session.networkRole) return;
  const players = snapshot.players.slice(0, 4);
  const width = 132;
  const x = app.viewport.logicalWidth - width - 6;
  const y = app.viewport.HUD_TOP_HEIGHT + 5;
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const rowY = y + index * 12;
    const color = playerColor(app, player);
    const state = player.connectionState === 'reconnecting' ? 'reconnect' : player.connectionState === 'departed' ? 'departed' : player.spectator ? 'spectator' : playerActivity(app, player);
    app.renderer.shapes.rect(x, rowY, width, 10, COLOR.black);
    app.renderer.shapes.rect(x + 2, rowY + 3, 4, 4, color);
    app.renderer.bitmapText.draw(clippedUiText(`${player.label} // ${state}`, width - 12), x + 10, rowY + 1, player.connectionState === 'connected' ? color : COLOR.red, 1);
    registerHitbox(app, `roster_${player.id}`, x, rowY, width, 10, { action: () => { app.social.rosterExpanded = !app.social.rosterExpanded; } });
  }
  drawButton(app, 'coop_ping', app.social.pingArmed ? 'ping // click world' : 'p ping', x + width - 82, y + players.length * 12 + 1, 82,
    app.social.pingArmed, COLOR.amber, () => { app.social.pingArmed = !app.social.pingArmed; }, 13);
  if (!app.social.rosterExpanded) return;
  const panelWidth = Math.min(310, app.viewport.logicalWidth - 16);
  const panelHeight = 28 + players.length * 30;
  const panelX = app.viewport.logicalWidth - panelWidth - 8;
  const panelY = y + players.length * 12 + 18;
  drawTechPanel(app, panelX, panelY, panelWidth, panelHeight, COLOR.cyan);
  app.renderer.bitmapText.draw(`team credits ${compactMetric(snapshot.teamEconomy?.credits || 0)} // tab`, panelX + 8, panelY + 7, COLOR.amber, 1);
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const contribution = snapshot.contributionByPlayer?.[player.id] || {};
    const rowY = panelY + 23 + index * 30;
    app.renderer.bitmapText.draw(clippedUiText(player.label, 90), panelX + 8, rowY, playerColor(app, player), 1);
    app.renderer.bitmapText.draw(`hp ${compactMetric(contribution.hpPopped || 0)} // kills ${compactMetric(contribution.kills || 0)} // spent ${compactMetric(contribution.creditsSpent || 0)}`, panelX + 78, rowY, COLOR.ink, 1);
    app.renderer.bitmapText.draw(`towers ${contribution.towersCreated || 0} // support ${compactMetric(contribution.supportCredits || 0)} // control ${compactMetric(contribution.controlApplications || 0)}`, panelX + 78, rowY + 11, COLOR.uiMuted, 1);
  }
}

export function drawChat(app, snapshot, now) {
  if (!app.game.session.networkRole) return;
  const visible = app.social.chatOpen
    ? app.social.messages.slice(-6)
    : app.social.messages.filter((message) => now - message.receivedAt < 5000).slice(-2);
  const width = Math.min(320, app.viewport.logicalWidth - 16);
  const x = 8;
  const lineHeight = 11;
  const height = Math.max(0, visible.length * lineHeight) + (app.social.chatOpen ? 22 : 0);
  const y = app.viewport.hudBottomY - height - 8;
  if (height) app.renderer.shapes.rect(x - 3, y - 3, width + 6, height + 6, COLOR.black);
  for (let index = 0; index < visible.length; index += 1) {
    const message = visible[index];
    const player = snapshot.players.find((candidate) => candidate.id === message.playerId);
    const prefix = message.kind === 'system' ? '// ' : `${player?.label || 'pilot'}: `;
    app.renderer.bitmapText.draw(clippedUiText(prefix + message.text, width), x, y + index * lineHeight, message.kind === 'system' ? COLOR.uiMuted : playerColor(app, player), 1);
  }
  if (app.social.chatOpen) {
    const inputY = y + visible.length * lineHeight + 5;
    app.renderer.bitmapText.draw(clippedUiText(`> ${app.social.chatInput}_`, width), x, inputY, COLOR.ink, 1);
  }
}

export function drawCursor(app) {
  const color = app.ui.frontEndScreen === 'main' ? COLOR.mint : ['escape', 'map_select'].includes(app.ui.frontEndScreen) ? COLOR.amber : app.ui.frontEndScreen === 'coop' ? COLOR.green : COLOR.cyan;
  app.renderer.shapes.rect(app.ui.pointer.x - 4, app.ui.pointer.y, 3, 1, color);
  app.renderer.shapes.rect(app.ui.pointer.x + 2, app.ui.pointer.y, 3, 1, color);
  app.renderer.shapes.rect(app.ui.pointer.x, app.ui.pointer.y - 4, 1, 3, color);
  app.renderer.shapes.rect(app.ui.pointer.x, app.ui.pointer.y + 2, 1, 3, color);
}
