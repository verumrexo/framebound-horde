import { AUTHORITY_TICK_RATE } from '../core/protocol.js';

const WINDOW_TICKS = 10 * AUTHORITY_TICK_RATE;
const SAMPLE_TICKS = AUTHORITY_TICK_RATE / 2;

// Keep a small rolling history of authoritative damage counters. Sampling every
// half-second bounds memory to 22 samples per tower; the rate uses the actual
// observed interval (roughly ten seconds), never wall time or kill estimates.
export class TowerDamageTelemetry {
  constructor() {
    this.identity = null;
    this.lastTick = null;
    this.towers = new Map();
  }

  update(snapshot) {
    const tick = snapshot.runTick;
    const identity = `${snapshot.sessionId}/${snapshot.runNumber}/${snapshot.mapId}/${snapshot.seed}`;
    if (identity !== this.identity || tick < this.lastTick || tick - this.lastTick > AUTHORITY_TICK_RATE) this.towers.clear();
    this.identity = identity;
    this.lastTick = tick;
    const liveIds = new Set();
    for (const tower of snapshot.towers) {
      liveIds.add(tower.id);
      const hp = tower.hpPopped || 0;
      let entry = this.towers.get(tower.id);
      if (!entry || hp < entry.hp || entry.form !== tower.definitionId) {
        entry = { form: tower.definitionId, hp, samples: [{ tick, hp }], hpPerSecond: null };
        this.towers.set(tower.id, entry);
      }
      entry.hp = hp;
      const samples = entry.samples;
      if (tick - samples.at(-1).tick >= SAMPLE_TICKS) samples.push({ tick, hp });
      while (samples.length > 1 && samples[1].tick <= tick - WINDOW_TICKS) samples.shift();
      const elapsed = tick - samples[0].tick;
      entry.hpPerSecond = elapsed > 0 ? Math.max(0, hp - samples[0].hp) * AUTHORITY_TICK_RATE / elapsed : null;
    }
    for (const id of this.towers.keys()) if (!liveIds.has(id)) this.towers.delete(id);
  }
}

export function updateTowerTelemetry(app, snapshot) {
  const byMode = app.timing.towerTelemetryByMode;
  if (!byMode.has(app.game.sessionMode)) byMode.set(app.game.sessionMode, new TowerDamageTelemetry());
  byMode.get(app.game.sessionMode).update(snapshot);
}

export function towerDamageRate(app, tower) {
  return app.timing?.towerTelemetryByMode?.get(app.game.sessionMode)?.towers.get(tower.id)?.hpPerSecond ?? null;
}
