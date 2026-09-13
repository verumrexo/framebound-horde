import { saveTestPreferences } from './preferences.js';
import { catalogDefinition } from './queries.js';
import { openResearchStation } from './research-actions.js';
import { adoptActiveMap, saveGameBundle } from './sessions.js';
import { addSystemMessage } from './social.js';
import { setStatus } from './ui-state.js';
import { compactMetric } from '../core/format.js';
import { isRelayForm } from '../core/network-descendants.js';
import { EVENT } from '../core/protocol.js';
import { addAttackFlash, addImpactBurst, addSupportFlash } from '../render/combat-effects.js';
import { startRelayCollapse } from '../render/network.js';

export function handleSessionEvents(app, events) {
  for (const event of events) {
    if (event.type === EVENT.TOWER_PLACED || event.type === EVENT.TOWER_EVOLVED) {
      app.effects.assembly.begin(event.payload.tower, event.type === EVENT.TOWER_EVOLVED ? 'evolved' : 'placed', app.game.sessionSnapshot.runTick);
    }
    if ([EVENT.RESEARCH_PURCHASED, EVENT.REACTOR_PURCHASED].includes(event.type)) {
      setStatus(app, event.type===EVENT.RESEARCH_PURCHASED ? `${event.payload.label} unlocked` : `${event.payload.categoryId} rank ${event.payload.rank}`);
      app.ui.researchDetailPage=0;
      const station = app.game.sessionSnapshot.towers.find((tower) => tower.id === event.payload.towerId);
      if (station && (event.payload.cost || 0) > 0) app.effects.researchWave = {
        x: station.x, y: station.y, mapId: app.game.currentMap.id, startedTick: app.game.sessionSnapshot.runTick
      };
      void saveGameBundle(app);
    } else if (event.type === EVENT.TOWER_PLACED && event.payload.tower.ownerId === app.game.session.playerId) {
      const keepBulkPlacement = app.game.sessionMode === 'game'
        && app.ui.bulkPlacementDefinitionId === event.payload.tower.definitionId;
      app.ui.placementArmed = keepBulkPlacement;
      const autoSelect = !keepBulkPlacement && (app.game.sessionMode === 'test' || app.preferences.autoSelectPlacedFrame);
      app.ui.selectedTowerId = autoSelect ? event.payload.tower.id : null;
      app.ui.towerMenuMode = autoSelect && app.game.sessionMode === 'game' ? 'actions' : null;
      if (['arsenal','reactor'].includes(event.payload.tower.definitionId)) openResearchStation(app, event.payload.tower);
      setStatus(app, keepBulkPlacement
        ? `${event.payload.tower.definitionId} placed // click next // right click ends`
        : autoSelect ? 'frame selected // 1 upgrade // 2 sell' : 'frame placed // press 1 for another');
    } else if (event.type === EVENT.TOWER_EVOLVED && (event.payload.actorPlayerId || event.payload.tower.ownerId) === app.game.session.playerId) {
      app.ui.selectedTowerId = event.payload.tower.id;
      const evolved = catalogDefinition(app.game.sessionSnapshot, event.payload.tower.definitionId);
      app.ui.towerMenuMode = app.game.sessionMode === 'test'
        ? isRelayForm(evolved?.id) ? 'actions' : evolved?.control?.input !== 'none' && evolved?.control?.input ? 'control' : null
        : evolved?.evolutionChoices?.length
          ? 'upgrades'
          : evolved?.id === 'relay'
            ? 'relay'
            : evolved?.control?.input !== 'none' && evolved?.control?.input
              ? 'control'
              : 'actions';
      if (['arsenal','reactor'].includes(event.payload.tower.definitionId)) openResearchStation(app, event.payload.tower);
      setStatus(app, `${event.payload.tower.definitionId} online`);
    } else if (event.type === EVENT.TOWER_SOLD) {
      if (app.ui.selectedTowerId === event.payload.towerId) {
        app.ui.selectedTowerId = null;
        app.ui.towerMenuMode = null;
      }
      setStatus(app, `sold // refund ${compactMetric(event.payload.refund)}`);
    } else if (event.type === EVENT.TOWER_TARGETING_CHANGED && event.payload.towerId === app.ui.selectedTowerId) {
      setStatus(app, `target ${event.payload.mode.replace('_', ' ')}`);
    } else if (event.type === EVENT.TOWER_STRIKE_POINT_CHANGED && event.payload.towerId === app.ui.selectedTowerId) {
      app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
      setStatus(app, event.payload.strikePoint ? 'manual strike point locked' : 'automatic impact restored');
    } else if (event.type === EVENT.TOWER_FORCE_DIRECTION_CHANGED && event.payload.towerId === app.ui.selectedTowerId) {
      app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
      setStatus(app, event.payload.forceDirection ? 'crosswind direction locked' : 'automatic crosswind restored');
    } else if (event.type === EVENT.TOWER_CONTROL_GEOMETRY_CHANGED && event.payload.towerId === app.ui.selectedTowerId) {
      app.ui.towerMenuMode = app.game.sessionMode === 'game' ? 'actions' : null;
      app.ui.controlDrag = null;
      setStatus(app, 'control locked // rebooting 1s');
    } else if (event.type === EVENT.BASE_BREACHED) {
      app.effects.baseDamage.breach(event.payload, app.game.sessionSnapshot.runTick);
    } else if (event.type === EVENT.RELAY_NETWORK_COMPLETED) {
      if (!['main', 'map_select', 'coop'].includes(app.ui.frontEndScreen)) startRelayCollapse(app, event);
      if (event.payload.retired.some((record) => record.towerId === app.ui.selectedTowerId)) { app.ui.selectedTowerId = null; app.ui.towerMenuMode = null; }
      const refund = event.payload.retired.reduce((sum, record) => sum + (record.refund || 0), 0);
      setStatus(app, `relay network complete // ${event.payload.retired.length} connector-s uploaded${refund > 0 ? ` // +${compactMetric(refund)} cr` : ''}`);
      void saveGameBundle(app);
    } else if (event.type === EVENT.TOWER_RELAY_TARGET_CHANGED && event.payload.towerId === app.ui.selectedTowerId) {
      app.ui.towerMenuMode = 'actions';
      setStatus(app, `relay linked // ${event.payload.targetAreaId}`);
    } else if (event.type === EVENT.SESSION_RESTARTED) {
      adoptActiveMap(app, event.payload.mapId);
      app.effects.projectilePresentation.clear();
      app.effects.impactBursts.length = 0;
      app.effects.attackFlashes.length = 0;
      app.effects.relayCollapse = null;
      app.ui.selectedTowerId = null;
      app.ui.towerMenuMode = null;
      app.ui.placementArmed = false;
      app.ui.bulkPlacementDefinitionId = null;
      app.ui.buildCatalogOpen = false;
      app.ui.menuConfirm = null;
      setStatus(app, `${app.game.currentMap.label} // run ${event.payload.runNumber}`);
      void saveGameBundle(app);
    } else if (event.type === EVENT.RUN_STARTED) {
      adoptActiveMap(app, event.payload.mapId);
      if (app.game.session.networkRole) {
        app.game.gameHasEnteredGameplay = true;
        app.ui.frontEndScreen = 'game';
        app.multiplayer.phase = 'running';
        app.multiplayer.status = 'coop run live';
      }
      setStatus(app, `${app.game.currentMap.label} // good luck`);
      void saveGameBundle(app);
    } else if (event.type === EVENT.PLAYER_JOINED) {
      addSystemMessage(app, `${event.payload.player.label} joined`);
    } else if (event.type === EVENT.PLAYER_DISCONNECTED) {
      const player = app.game.sessionSnapshot.players.find((candidate) => candidate.id === event.payload.playerId);
      addSystemMessage(app, `${player?.label || 'pilot'} disconnected`);
      app.social.presenceByPlayer.delete(event.payload.playerId);
      setStatus(app, 'pilot disconnected // run continues');
    } else if (event.type === EVENT.PLAYER_RECONNECTED) {
      addSystemMessage(app, `${event.payload.player.label} reconnected`);
      setStatus(app, `${event.payload.player.label} reconnected`);
    } else if (event.type === EVENT.PLAYER_DEPARTED) {
      const player = app.game.sessionSnapshot.players.find((candidate) => candidate.id === event.payload.playerId);
      addSystemMessage(app, `${player?.label || 'pilot'} departed`);
      setStatus(app, 'pilot departed // towers remain shared');
    } else if (event.type === EVENT.ATTACK_RESOLVED) {
      if (!['main', 'map_select', 'coop'].includes(app.ui.frontEndScreen)) addAttackFlash(app, event);
    } else if (event.type === EVENT.KILLS_RECORDED) {
      if (!['main', 'map_select', 'coop'].includes(app.ui.frontEndScreen)) addImpactBurst(app, event);
    } else if (event.type === EVENT.SUPPORT_TRIGGERED) {
      if (!['main', 'map_select', 'coop'].includes(app.ui.frontEndScreen)) addSupportFlash(app, event);
      if (event.payload.sourceTowerId === app.ui.selectedTowerId) setStatus(app, `forge +${compactMetric(event.payload.credits)} credits`);
    } else if (event.type === EVENT.TEST_CONFIG_CHANGED) {
      saveTestPreferences(app, event.payload.test);
    } else if (event.type === EVENT.COMMAND_REJECTED && event.payload.clientId === app.game.session.clientId) {
      setStatus(app, event.payload.reason);
    }
  }
}
