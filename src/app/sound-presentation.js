import { project } from './camera.js';
import { catalogDefinition } from './queries.js';
import { musicTrackForScreen } from '../audio/music-tracks.js';
import { getSoundEvent, globalSoundEventKey, partSoundEventKey } from '../audio/sound-events.js';
import { CONTROL_FORMS } from '../core/tower-catalog.js';
import { EVENT } from '../core/protocol.js';

// Presentation only: authority events and snapshot deltas become sound hooks.
// Nothing here decides gameplay; muted or missing audio changes no outcome.
const ROCKET_FORMS = new Set(['rocket', 'warhead', 'cluster', 'salvo']);
const SPAMMY_INTERVAL_MS = 24;
const FORGE_INTERVAL_MS = 120;

// Combat density curve. Spammy hooks (fire, hit, deaths, blasts) are metered as
// a smoothed plays-per-second load; above COMFORTABLE_PLAYS_PER_SECOND their
// gain falls along a power curve and their minimum spacing stretches, so a
// thirty-tower late-game mix settles into a steady bed instead of a wall.
export const COMBAT_DENSITY = Object.freeze({
  comfortablePlaysPerSecond: 10,
  loadHalfLifeSeconds: 1.5,
  curvePower: 0.7,
  floorGain: 0.12,
  maxSpacingFactor: 6
});

export function combatDensityGain(load, curve = COMBAT_DENSITY) {
  if (!(load > curve.comfortablePlaysPerSecond)) return 1;
  return Math.max(curve.floorGain, Math.pow(curve.comfortablePlaysPerSecond / load, curve.curvePower));
}

export function combatSpacingFactor(load, curve = COMBAT_DENSITY) {
  if (!(load > curve.comfortablePlaysPerSecond)) return 1;
  return Math.min(curve.maxSpacingFactor, load / curve.comfortablePlaysPerSecond);
}

export function createSoundPresentation() {
  return { seenVolleys: new Set(), seenFields: new Set(), lastPhase: null, lastPlayAt: new Map(), combatLoad: 0, combatGain: 1, loadUpdatedAt: null };
}

// Decay the metered load toward zero, then the frame's plays add to it.
function updateCombatLoad(state, now) {
  const elapsed = state.loadUpdatedAt === null ? 0 : Math.max(0, (now - state.loadUpdatedAt) / 1000);
  state.loadUpdatedAt = now;
  if (elapsed > 0) state.combatLoad *= Math.pow(0.5, elapsed / COMBAT_DENSITY.loadHalfLifeSeconds);
  state.combatGain = combatDensityGain(state.combatLoad);
}

function audible(app) {
  return app.audio?.ready && app.audio.manager?.available && ['game', 'escape'].includes(app.ui.frontEndScreen);
}

function distanceVolume(app, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 1;
  const p = project(app, x, y);
  const margin = 40;
  const inside = p.x >= -margin && p.y >= -margin && p.x <= app.viewport.logicalWidth + margin && p.y <= app.viewport.logicalHeight + margin;
  return inside ? 1 : 0.3;
}

function play(app, eventKey, fallback, { x = null, y = null, volume = 1, minInterval = 0 } = {}) {
  const manager = app.audio.manager;
  const state = app.audio.presentation;
  const now = performance.now();
  const policy = getSoundEvent(fallback)?.policy || {};
  const spammy = Boolean(policy.isSpammy);
  // Every spammy request, played or spaced out, feeds the density meter so it
  // tracks combat pressure rather than what survived the spacing.
  if (spammy) state.combatLoad += Math.LN2 / COMBAT_DENSITY.loadHalfLifeSeconds;
  const spacing = spammy ? minInterval * combatSpacingFactor(state.combatLoad) : minInterval;
  if (spacing > 0 && now - (state.lastPlayAt.get(eventKey) || -Infinity) < spacing) return null;
  state.lastPlayAt.set(eventKey, now);
  const density = spammy ? state.combatGain : 1;
  return manager.playEvent(eventKey, fallback, { volume: volume * density * distanceVolume(app, x, y), isSpammy: spammy, randomizePitch: 0.08 });
}

function playPart(app, formId, slot, fallback, options) {
  return play(app, partSoundEventKey(formId, slot), fallback, options);
}

function playGlobal(app, eventId, options) {
  return play(app, globalSoundEventKey(eventId), eventId, options);
}

export function playUiClick(app, rejected = false) {
  if (!app.audio?.ready || !app.audio.manager?.available) return;
  play(app, globalSoundEventKey(rejected ? 'ui_reject' : 'ui_click'), rejected ? 'ui_reject' : 'ui_click', { minInterval: 30 });
}

function fireFallback(formId) {
  return ROCKET_FORMS.has(formId) ? 'rocket_launch' : 'fire';
}

function presentAttack(app, snapshot, payload) {
  const formId = payload.sourceFormId;
  const definition = catalogDefinition(snapshot, formId);
  const delivery = definition?.attack?.delivery?.type;
  const at = { x: payload.x, y: payload.y, minInterval: SPAMMY_INTERVAL_MS };
  if (delivery === 'hitscan') {
    const tower = snapshot.towers.find((candidate) => candidate.id === payload.sourceTowerId);
    playPart(app, formId, 'beam', 'laser', { x: tower?.x ?? payload.x, y: tower?.y ?? payload.y, minInterval: SPAMMY_INTERVAL_MS });
    return;
  }
  if (CONTROL_FORMS.includes(formId)) {
    if (payload.controlTargets?.length || payload.createdFields?.length) playPart(app, formId, 'apply', 'control_apply', at);
    return;
  }
  if (!payload.hitEnemyIds?.length && !payload.killedEnemyIds?.length && payload.geometry?.type !== 'circle') return;
  if (payload.geometry?.type === 'circle') playPart(app, formId, 'impact', 'explosion', { ...at, minInterval: 40 });
  else playPart(app, formId, 'hit', 'hit', at);
}

// Music follows the front-end screen; the manager ignores repeat requests.
export function presentMusic(app) {
  const manager = app.audio?.manager;
  if (!manager?.available) return;
  const track = musicTrackForScreen(app.ui.frontEndScreen);
  if (track) manager.playMusic(track.id, track.url);
  else manager.stopMusic();
}

export function presentSounds(app, events, snapshot) {
  if (!snapshot || !audible(app)) return;
  const state = app.audio.presentation;
  updateCombatLoad(state, performance.now());

  // New projectile volleys are the fire moment for every projectile form.
  const liveVolleys = new Set();
  for (const projectile of snapshot.projectiles || []) {
    const volleyId = projectile.volleyId || projectile.id;
    liveVolleys.add(volleyId);
    if (state.seenVolleys.has(volleyId)) continue;
    state.seenVolleys.add(volleyId);
    const tower = snapshot.towers.find((candidate) => candidate.id === projectile.towerId);
    playPart(app, projectile.formId, 'fire', fireFallback(projectile.formId), {
      x: tower?.x ?? projectile.x, y: tower?.y ?? projectile.y, minInterval: SPAMMY_INTERVAL_MS
    });
  }
  for (const volleyId of state.seenVolleys) if (!liveVolleys.has(volleyId)) state.seenVolleys.delete(volleyId);

  // Persistent fields (sweeper) announce themselves when they appear.
  const liveFields = new Set();
  for (const field of snapshot.attackFields || []) {
    if (field.kind !== 'sweep_line') continue;
    liveFields.add(field.id);
    if (state.seenFields.has(field.id)) continue;
    state.seenFields.add(field.id);
    playPart(app, field.attack?.sourceFormId || 'sweeper', 'sweep', 'laser', { x: field.x, y: field.y });
  }
  for (const fieldId of state.seenFields) if (!liveFields.has(fieldId)) state.seenFields.delete(fieldId);

  if (state.lastPhase !== snapshot.phase) {
    if (snapshot.phase === 'defeated' && state.lastPhase === 'running') playGlobal(app, 'defeat');
    state.lastPhase = snapshot.phase;
  }

  for (const event of events) {
    const payload = event.payload;
    switch (event.type) {
      case EVENT.ATTACK_RESOLVED: presentAttack(app, snapshot, payload); break;
      case EVENT.KILLS_RECORDED: playGlobal(app, 'enemy_death', { x: payload.x, y: payload.y, minInterval: SPAMMY_INTERVAL_MS }); break;
      case EVENT.TOWER_PLACED: playPart(app, payload.tower.definitionId, 'deploy', 'tower_placed', { x: payload.tower.x, y: payload.tower.y }); break;
      case EVENT.TOWER_EVOLVED: playPart(app, payload.tower.definitionId, 'deploy', 'tower_evolved', { x: payload.tower.x, y: payload.tower.y }); break;
      case EVENT.TOWER_SOLD: playGlobal(app, 'tower_sold'); break;
      case EVENT.BASE_BREACHED: playGlobal(app, 'base_breached', { minInterval: 80 }); break;
      case EVENT.RUN_STARTED:
      case EVENT.SESSION_RESTARTED: playGlobal(app, 'run_started'); break;
      case EVENT.RESEARCH_PURCHASED:
      case EVENT.REACTOR_PURCHASED: playGlobal(app, 'research_purchased'); break;
      case EVENT.RELAY_NETWORK_COMPLETED: playGlobal(app, 'relay_completed'); break;
      case EVENT.SUPPORT_TRIGGERED:
        if (payload.type === 'kill_income') playGlobal(app, 'forge_income', { x: payload.x, y: payload.y, minInterval: FORGE_INTERVAL_MS });
        break;
      case EVENT.COMMAND_REJECTED:
        if (payload.clientId === app.game.session.clientId) playUiClick(app, true);
        break;
      default: break;
    }
  }
}
