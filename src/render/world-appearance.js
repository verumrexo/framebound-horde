import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { isRelayForm } from '../core/network-descendants.js';

export const ENEMY_VISUAL_SCALE = 0.8;
export const ENEMY_MIN_PIXELS = 2;
export const BASE_HIT_TICKS = Math.ceil(0.18 * AUTHORITY_TICK_RATE);
export const NEBULA_SHADE_FLOOR = 0.006;
export const NEBULA_LEVELS = Object.freeze({
  interior: 0.024, band: 0.038, scratch: 0.09, rim: 0.18,
  scar: 0.36, glint: 0.62, trace: 0.085, research: 0.28,
  link: 0.10, pulse: 0.24, focus: 0.48
});

export function hashString32(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function networkHueFromId(id) {
  return (200 + ((hashString32(id) * 0.6180339887498949) % 1) * 120) / 360;
}

export function nebulaTint({ tier = 0, hue = 200 / 360 } = {}) {
  if (tier === 0) return [0.2, 0.72, 0.38];
  if (tier === 1) return [1, 0.62, 0.23];
  // Same saturated hue equation as the nebula shader; never multiply green terrain.
  return [1, 2 / 3, 1 / 3].map((offset) => {
    const phase = hue + offset;
    return Math.max(0, Math.min(1, Math.abs((phase - Math.floor(phase)) * 6 - 3) - 1));
  });
}

export function nebulaPalette(info) {
  const tint = nebulaTint(info);
  return Object.fromEntries(Object.entries(NEBULA_LEVELS).map(([key, level]) =>
    [key, [...tint.map((channel) => NEBULA_SHADE_FLOOR + channel * level), 1]]));
}

export const DEFAULT_RELAY_PALETTE = nebulaPalette({ tier: 2, hue: 200 / 360 });

// Only reads synced topology. Stable roots preserve colours through relay retirement,
// snapshot reordering and save/restore; a merge adopts its canonical root's colour.
export function relayNetworkPresentation(snapshot) {
  const presentation = new Map();
  const parent = new Map();
  const ensure = (id) => { if (id && !parent.has(id)) parent.set(id, id); };
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a, b) => {
    if (!a || !b) return;
    ensure(a); ensure(b);
    const rootA = find(a), rootB = find(b);
    if (rootA === rootB) return;
    if (rootA < rootB) parent.set(rootB, rootA); else parent.set(rootA, rootB);
  };
  for (const tower of snapshot?.towers || []) {
    if (!isRelayForm(tower.definitionId)) continue;
    ensure(tower.areaId);
    if (tower.relayTargetAreaId) union(tower.areaId, tower.relayTargetAreaId);
  }
  for (const [areaA, areaB] of snapshot?.relayNetwork?.links || []) union(areaA, areaB);
  const members = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  }
  for (const [root, ids] of members) {
    const tier = ids.length >= 2 ? 2 : 1;
    const hue = tier === 2 ? networkHueFromId(root) : 0;
    const info = { tier, hue, palette: nebulaPalette({ tier, hue }) };
    for (const id of ids) presentation.set(id, info);
  }
  return presentation;
}

export function enemyPointSize(viewScale, units = 1) {
  const baseSize = Math.floor(Math.max(3, Math.min(6, 13 / viewScale)) + 0.5);
  return Math.max(ENEMY_MIN_PIXELS, (baseSize + (units > 1.5 ? 3 : 0)) * ENEMY_VISUAL_SCALE);
}

export function baseAppearance(base, startingLives, runTick, hitTick = null, reducedMotion = false) {
  const maximum = Math.max(1, base.maxLives || startingLives || 100);
  const health = Math.max(0, Math.min(1, base.lives / maximum));
  const state = health === 0 ? 'destroyed' : health <= 0.25 ? 'critical' : health <= 0.5 ? 'damaged' : 'healthy';
  return {
    state, health, plates: Math.ceil(health * 4),
    phase: reducedMotion || !health ? 0 : Math.floor(runTick / 18) % 4,
    hit: health > 0 && hitTick !== null && runTick >= hitTick && runTick - hitTick < BASE_HIT_TICKS
  };
}

// No inferred hits from correction snapshots or healing. Only real breach events arm
// the single response; snapshot health always supplies the persistent damage state.
export class BaseDamagePresentation {
  constructor() { this.reset(); }
  reset() { this.hitTick = null; }
  breach(payload, runTick) {
    if (payload.livesLost > 0) this.hitTick = runTick;
  }
  appearance(snapshot, reducedMotion = false) {
    return baseAppearance(snapshot.base, snapshot.prototypeBalance?.startingLives,
      snapshot.runTick, this.hitTick, reducedMotion);
  }
}

export function riftAppearance(snapshot, source, reducedMotion = false) {
  const test = snapshot.test;
  const threat = snapshot.swarm?.threatSeconds ?? snapshot.runTick / AUTHORITY_TICK_RATE;
  const remaining = test ? 0 : Math.max(0, source.unlockSeconds - threat) / (snapshot.pace || 1);
  const surge = snapshot.swarm?.surge;
  const hot = !test && surge && surge.phase !== 'idle' && surge.riftIds.includes(source.id);
  const enabled = test ? (test.activeSpawnSourceIds || []).includes(source.id) : remaining <= 0;
  const state = !enabled ? (test ? 'disabled' : 'countdown') : 'live';
  return {
    state, hot: Boolean(hot), remaining,
    visible: Boolean(test || hot || remaining <= 10),
    phase: reducedMotion || state !== 'live' ? 0
      : (Math.floor(snapshot.runTick / (hot ? 5 : 9)) + hashString32(source.id) % 8) % 8
  };
}
