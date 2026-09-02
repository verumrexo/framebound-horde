import {
  AUTHORITY_TICK_MS,
  AUTHORITY_TICK_RATE,
  COMMAND,
  EVENT,
  PROTOCOL_VERSION,
  cloneSerializable,
  createCommand,
  validateCommand
} from './protocol.js';
import {
  activeSpawnSources,
  defenseAreaField,
  findDefenseAreaAt,
  getMapDefinition,
  playableMaps,
  spawnRateAt
} from './world-config.js';
import { EnemySwarm, SWARM_RECORD_BUDGET } from './enemy-swarm.js';
import {
  createAttackSnapshot,
  planAttackImpact,
  resolveAttackPlans
} from './effect-system.js';
import { towerBuildQuote } from './tower-catalog.js';
import { strikeImpactPoints, supportsStrikePoint } from './strike-pattern.js';
import {
  buildControlField,
  controlRebootTicks,
  defaultControlGeometry,
  normalizeControlGeometry,
  supportsControlGeometry
} from './control-system.js';

const MAX_EVENT_HISTORY = 4096;
const MAX_TICKS_PER_ADVANCE = 8;
const RECONNECT_WAIT_TICKS = 90 * AUTHORITY_TICK_RATE;

function sanitizeLabel(label) {
  return String(label || 'player').toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 20) || 'player';
}

function compareStableIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return mix32(hash);
}

function deterministicUnit(seed) {
  return mix32(seed) / 0x100000000;
}

function initialStats() {
  return {
    kills: 0,
    hits: 0,
    breaches: 0,
    spawned: 0,
    unclaimedCredits: 0,
    shotsFired: 0,
    shotsResolved: 0,
    retargets: 0,
    controlApplications: 0,
    triggerEvents: 0,
    triggerOverflows: 0,
    supportTriggers: 0,
    bonusCredits: 0
  };
}

export class EmbeddedAuthority {
  constructor({
    sessionId,
    mode = 'game',
    autoStart = true,
    mapId,
    seed,
    towers,
    towerDefinitions = {},
    swarm,
    startingLives,
    startingCredits,
    test = null
  }) {
    this.accumulatorMs = 0;
    this.eventCounter = 0;
    this.pendingCommands = [];
    this.commandLog = [];
    this.lastSequenceByClient = new Map();
    this.events = [];
    this.nextTowerNumber = towers.length + 1;
    this.nextProjectileNumber = 1;
    this.nextFieldNumber = 1;
    this.nextAttackFieldNumber = 1;
    this.payoutCursor = 0;
    this.modifierCache = null;
    this.seed = seed;
    this.mode = mode;
    this.autoStart = autoStart;
    this.initialTowers = cloneSerializable(towers);
    this.swarmConfig = cloneSerializable(swarm);
    this.startingLives = startingLives;
    this.startingCredits = startingCredits;
    this.towerDefinitions = cloneSerializable(towerDefinitions);
    this.initialTestConfig = test ? cloneSerializable(test) : null;
    this.map = null;
    this.networkAreasByArea = new Map();
    this.relayTargetByTowerId = new Map();
    this.swarm = null;
    this.bindMap(mapId);
    this.state = this.createInitialState(sessionId);
    this.emit(EVENT.SESSION_STARTED, { sessionId, seed, mapId: this.map.id, mode: this.mode });
  }

  bindMap(mapId) {
    this.map = getMapDefinition(mapId);
    this.networkAreasByArea = new Map();
    this.relayTargetByTowerId = new Map();
    this.modifierCache = null;
    this.swarm = this.createSwarm();
  }

  createSwarm() {
    return new EnemySwarm({ seed: this.seed, map: this.map, ...this.swarmConfig });
  }

  resetFreshRun(mapId = this.map.id) {
    const nextMap = getMapDefinition(mapId);
    if (this.mode === 'game' && !nextMap.playable) throw new Error('map is not playable');
    this.bindMap(nextMap.id);
    this.state.mapId = this.map.id;
    this.state.mapLabel = this.map.label;
    this.state.mapCatalog = playableMaps().map((map) => ({ id: map.id, label: map.label }));
    this.state.runTick = 0;
    this.state.base = { ...this.map.base, lives: this.startingLives };
    this.state.towers = this.initialTowers.map((tower) => this.normalizeTower(tower));
    this.state.projectiles = [];
    this.state.attackFields = [];
    this.state.forceFields = [];
    this.state.deployables = [];
    this.state.supportCounters = {};
    this.state.disconnectWait = null;
    this.state.stats = initialStats();
    this.state.test = this.initialTestConfig ? cloneSerializable(this.initialTestConfig) : null;
    this.state.swarm = this.swarmSummary(0, []);
    for (const player of this.state.players) {
      if (!player.eliminated) this.state.economyByPlayer[player.id] = { credits: this.startingCredits, totalEarned: 0, totalSpent: 0 };
    }
    this.payoutCursor = 0;
  }

  createInitialState(sessionId) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      mode: this.mode,
      mapId: this.map.id,
      mapLabel: this.map.label,
      mapCatalog: playableMaps().map((map) => ({ id: map.id, label: map.label })),
      seed: this.seed,
      tick: 0,
      runTick: 0,
      runNumber: 1,
      phase: this.autoStart ? 'running' : 'lobby',
      rosterLocked: false,
      hostPlayerId: null,
      disconnectWait: null,
      players: [],
      base: { ...this.map.base, lives: this.startingLives },
      towers: this.initialTowers.map((tower) => this.normalizeTower(tower)),
      projectiles: [],
      attackFields: [],
      forceFields: [],
      deployables: [],
      supportCounters: {},
      economyByPlayer: {},
      towerCatalog: Object.values(this.towerDefinitions),
      test: this.initialTestConfig ? cloneSerializable(this.initialTestConfig) : null,
      swarm: this.swarmSummary(0, []),
      stats: initialStats(),
      prototypeBalance: { startingLives: this.startingLives, startingCredits: this.startingCredits }
    };
  }

  normalizeTower(tower) {
    const definition = this.towerDefinitions[tower.definitionId];
    const strikePoint = supportsStrikePoint(definition?.attack)
      && Number.isFinite(tower.strikePoint?.x)
      && Number.isFinite(tower.strikePoint?.y)
      ? { x: tower.strikePoint.x, y: tower.strikePoint.y }
      : null;
    const forceLength = Math.hypot(tower.forceDirection?.x || 0, tower.forceDirection?.y || 0);
    const forceDirection = definition?.manualForceDirection && forceLength > 0.0001
      ? {
          x: tower.forceDirection.x / forceLength,
          y: tower.forceDirection.y / forceLength
        }
      : null;
    const normalized = {
      ...tower,
      kills: Math.max(0, Math.floor(tower.kills || 0)),
      lastKillTick: Math.max(0, Math.floor(tower.lastKillTick || 0)),
      supportTriggers: Math.max(0, Math.floor(tower.supportTriggers || 0)),
      bonusCredits: Math.max(0, Math.floor(tower.bonusCredits || 0)),
      targetingMode: tower.targetingMode || 'closest',
      strikePoint,
      forceDirection,
      totalInvestment: tower.totalInvestment || definition?.cost || 0,
      fireCharge: tower.fireCharge || 0,
      formHistory: tower.formHistory || (tower.definitionId ? [tower.definitionId] : []),
      effectiveRange: tower.effectiveRange || definition?.range || 0
    };
    const legacyGeometry = definition?.control?.input === 'direction' && forceLength > 0.0001
      ? { kind: 'direction', dx: tower.forceDirection.x, dy: tower.forceDirection.y }
      : null;
    normalized.controlGeometry = definition?.control
      ? normalizeControlGeometry(definition, normalized, tower.controlGeometry || legacyGeometry, this.map)
      : null;
    normalized.controlReadyTick = definition?.control
      ? Math.max(0, Math.floor(tower.controlReadyTick || 0))
      : 0;
    normalized.controlStats = {
      activations: Math.max(0, Math.floor(tower.controlStats?.activations || 0)),
      affectedUnits: Math.max(0, Math.floor(tower.controlStats?.affectedUnits || 0)),
      affectedUnitTicks: Math.max(0, Math.floor(tower.controlStats?.affectedUnitTicks || 0)),
      lastActiveTick: Math.max(0, Math.floor(tower.controlStats?.lastActiveTick || 0))
    };
    return normalized;
  }

  swarmSummary(spawnRatePerSecond, sources) {
    return {
      activeEnemies: this.swarm.activeUnitCount,
      simulationRecords: this.swarm.count,
      compressedEnemies: this.swarm.activeUnitCount - this.swarm.count,
      recordBudget: SWARM_RECORD_BUDGET,
      slowedEnemies: this.swarm.slowedCount,
      allocatedCapacity: this.swarm.capacity,
      spawnedTotal: this.swarm.spawnedTotal,
      spawnRatePerSecond,
      activeSpawnPoints: sources.length,
      checksum: this.swarm.lastChecksum
    };
  }

  emit(type, payload) {
    const event = {
      protocolVersion: PROTOCOL_VERSION,
      eventId: `${this.state.sessionId}:${this.state.tick}:${++this.eventCounter}`,
      tick: this.state.tick,
      type,
      payload: cloneSerializable(payload)
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENT_HISTORY) this.events.shift();
    return event;
  }

  enqueue(command) {
    const error = validateCommand(command);
    if (error) {
      this.emit(EVENT.COMMAND_REJECTED, { clientId: command?.clientId || null, sequence: command?.sequence || null, reason: error });
      return false;
    }
    const previousSequence = this.lastSequenceByClient.get(command.clientId) || 0;
    if (command.sequence <= previousSequence) {
      this.emit(EVENT.COMMAND_REJECTED, { clientId: command.clientId, sequence: command.sequence, reason: 'non-monotonic sequence' });
      return false;
    }
    this.lastSequenceByClient.set(command.clientId, command.sequence);
    const copy = cloneSerializable(command);
    this.pendingCommands.push(copy);
    this.commandLog.push(copy);
    return true;
  }

  advance(elapsedMs) {
    this.accumulatorMs += Math.max(0, Math.min(250, elapsedMs));
    let steps = 0;
    while (this.accumulatorMs >= AUTHORITY_TICK_MS && steps < MAX_TICKS_PER_ADVANCE) {
      this.accumulatorMs -= AUTHORITY_TICK_MS;
      this.tick();
      steps += 1;
    }
    if (steps === MAX_TICKS_PER_ADVANCE) this.accumulatorMs = Math.min(this.accumulatorMs, AUTHORITY_TICK_MS);
    return steps;
  }

  tick() {
    this.state.tick += 1;
    const ready = [];
    const waiting = [];
    for (const command of this.pendingCommands) {
      (command.intendedTick <= this.state.tick ? ready : waiting).push(command);
    }
    this.pendingCommands = waiting;
    for (const command of ready) this.applyCommand(command);

    if (this.state.players.length > 0 && this.state.runTick > 0) this.state.rosterLocked = true;
    if (this.state.disconnectWait && this.state.tick >= this.state.disconnectWait.deadlineTick) {
      this.completeBalancedInheritance(this.state.disconnectWait.playerId);
    }
    if (this.state.phase !== 'running' || this.state.test?.paused) return;

    this.state.runTick += 1;
    this.simulateGameplay();
  }

  spawnSettings() {
    if (this.state.test) {
      const enabled = new Set(this.state.test.activeSpawnSourceIds || []);
      const overrides = this.state.test.spawnSourceOverrides || {};
      return {
        rate: this.state.test.spawnRatePerSecond,
        sources: this.map.spawnSources
          .filter((source) => enabled.has(source.id))
          .map((source) => {
            const override = overrides[source.id];
            return override ? { ...source, x: override.x, y: override.y } : source;
          }),
        enemyHp: this.state.test.enemyHp
      };
    }
    return {
      rate: spawnRateAt(this.map, this.state.runTick, AUTHORITY_TICK_RATE),
      sources: activeSpawnSources(this.map, this.state.runTick, AUTHORITY_TICK_RATE),
      enemyHp: this.swarmConfig.enemyHp || 1
    };
  }

  simulateGameplay() {
    const spawn = this.spawnSettings();
    const controlFields = this.syncControlFields();
    this.pulseControlFields(controlFields);
    const swarmTick = this.swarm.tick(this.state.runTick, {
      spawnRatePerSecond: spawn.rate,
      spawnSources: spawn.sources,
      enemyHp: spawn.enemyHp,
      forceFields: this.state.forceFields
    });
    this.recordControlFieldWork(controlFields);
    this.state.stats.spawned += swarmTick.spawned;
    if (swarmTick.breaches > 0) this.recordBreaches(swarmTick.breaches, Boolean(this.state.test?.invincibleBase));
    if (this.state.phase === 'running') {
      this.fireTowers();
      this.moveProjectiles();
      this.tickAttackFields();
    }
    if (this.state.runTick % AUTHORITY_TICK_RATE === 0) this.swarm.updateChecksum();
    this.state.swarm = this.swarmSummary(spawn.rate, spawn.sources);
  }

  syncControlFields() {
    const transient = this.state.forceFields.filter(
      (field) => !field.persistentControl && field.expiresTick > this.state.runTick
    );
    const controlFields = [];
    for (const tower of [...this.state.towers].sort(compareStableIds)) {
      const definition = this.towerDefinitions[tower.definitionId];
      const field = buildControlField(definition, tower, this.map, this.state.runTick);
      if (field) controlFields.push(field);
    }
    this.state.forceFields = [...transient, ...controlFields];
    return controlFields;
  }

  pulseControlFields(controlFields) {
    const claimedStasisIds = new Set();
    for (const field of controlFields) {
      const tower = this.state.towers.find((candidate) => candidate.id === field.sourceTowerId);
      if (!tower) continue;
      const stats = tower.controlStats;
      if (field.kind === 'stasis_zone' && this.state.runTick % field.periodTicks === 0) {
        const targets = this.swarm.enemiesInCircle(field.x, field.y, field.radius)
          .filter((target) => !claimedStasisIds.has(target.id));
        for (const target of targets) claimedStasisIds.add(target.id);
        const affected = this.swarm.applyStatus(targets, {
          status: 'stasis',
          durationSeconds: field.durationTicks / AUTHORITY_TICK_RATE
        });
        const units = affected.reduce((total, enemy) => total + Math.max(1, Math.floor(enemy.units || 1)), 0);
        field.triggeredUnitsTick += units;
        stats.activations += 1;
        stats.lastActiveTick = this.state.runTick;
      } else if ((field.kind === 'singularity_force' || field.kind === 'breaker_wave')
        && this.state.runTick % field.periodTicks === 0) {
        stats.activations += 1;
        stats.lastActiveTick = this.state.runTick;
      }
    }
  }

  recordControlFieldWork(controlFields) {
    for (const field of controlFields) {
      const tower = this.state.towers.find((candidate) => candidate.id === field.sourceTowerId);
      if (!tower) continue;
      const affectedUnitTicks = Math.max(0, Math.floor(field.affectedUnitsTick || 0));
      const triggeredUnits = Math.max(0, Math.floor(field.triggeredUnitsTick || 0));
      tower.controlStats.affectedUnitTicks += affectedUnitTicks;
      tower.controlStats.affectedUnits += triggeredUnits;
      if (affectedUnitTicks > 0 || triggeredUnits > 0) tower.controlStats.lastActiveTick = this.state.runTick;
    }
  }

  towerStat(tower, stat, baseValue) {
    let value = baseValue;
    const modifiers = this.modifierCache?.get(tower.id) || [];
    for (const modifier of modifiers) {
      if (modifier.stat !== stat) continue;
      if (modifier.operation === 'add_percent') value += baseValue * modifier.value;
      else if (modifier.operation === 'add_flat') value += modifier.value;
      else if (modifier.operation === 'multiply') value *= modifier.value;
    }
    return value;
  }

  validRelayTargetAreaId(tower, targetAreaId) {
    const definition = this.towerDefinitions[tower.definitionId];
    const hasRelay = definition?.supportEffects?.some((effect) => effect.type === 'area_link');
    const targetArea = this.map.defenseAreas.find((area) => area.id === targetAreaId);
    if (!hasRelay || !targetArea || targetArea.id === tower.areaId) return null;
    const linkRange = Math.max(0, definition.linkRange || 0);
    return defenseAreaField(targetArea, tower.x, tower.y, linkRange) <= 0 ? targetArea.id : null;
  }

  rebuildNetworkTopology() {
    const adjacency = new Map(this.map.defenseAreas.map((area) => [area.id, new Set([area.id])]));
    this.relayTargetByTowerId.clear();
    const relayTowers = this.state.towers
      .filter((tower) => this.towerDefinitions[tower.definitionId]?.supportEffects?.some((effect) => effect.type === 'area_link'))
      .sort(compareStableIds);
    for (const tower of relayTowers) {
      const targetAreaId = this.validRelayTargetAreaId(tower, tower.relayTargetAreaId);
      this.relayTargetByTowerId.set(tower.id, targetAreaId);
      if (!targetAreaId) continue;
      adjacency.get(tower.areaId)?.add(targetAreaId);
      adjacency.get(targetAreaId)?.add(tower.areaId);
    }

    this.networkAreasByArea.clear();
    for (const area of this.map.defenseAreas) {
      const visited = new Set([area.id]);
      const queue = [area.id];
      while (queue.length) {
        const areaId = queue.shift();
        for (const linkedAreaId of adjacency.get(areaId) || []) {
          if (visited.has(linkedAreaId)) continue;
          visited.add(linkedAreaId);
          queue.push(linkedAreaId);
        }
      }
      this.networkAreasByArea.set(area.id, [...visited].sort());
    }

    for (const tower of this.state.towers) {
      const definition = this.towerDefinitions[tower.definitionId];
      if (definition?.networkNode) {
        tower.networkAreaIds = [...(this.networkAreasByArea.get(tower.areaId) || [tower.areaId])];
        tower.relayTargetAreaId = this.relayTargetByTowerId.get(tower.id) || null;
      } else {
        delete tower.networkAreaIds;
        delete tower.relayTargetAreaId;
      }
    }
  }

  addModifier(cache, target, modifier, source) {
    const modifiers = cache.get(target.id);
    const applied = { ...modifier, sourceTowerId: source.id, sourceAreaId: source.areaId };
    if (modifier.stacking === 'diminishing_additive') {
      const stackOrdinal = modifiers.filter(
        (candidate) => candidate.stackGroup === modifier.stackGroup && candidate.stat === modifier.stat
      ).length;
      applied.value = stackOrdinal === 0 ? modifier.value : modifier.additionalValue;
      applied.stackOrdinal = stackOrdinal;
      modifiers.push(applied);
      return;
    }
    if (modifier.stacking !== 'unique_strongest') {
      modifiers.push(applied);
      return;
    }
    const existingIndex = modifiers.findIndex((candidate) => candidate.stackGroup === modifier.stackGroup && candidate.stat === modifier.stat);
    if (existingIndex < 0) {
      modifiers.push(applied);
      return;
    }
    const existing = modifiers[existingIndex];
    const stronger = Math.abs(applied.value) > Math.abs(existing.value)
      || (Math.abs(applied.value) === Math.abs(existing.value) && applied.sourceTowerId < existing.sourceTowerId);
    if (stronger) modifiers[existingIndex] = applied;
  }

  rebuildModifierCache() {
    this.rebuildNetworkTopology();
    const cache = new Map(this.state.towers.map((tower) => [tower.id, []]));
    for (const source of [...this.state.towers].sort(compareStableIds)) {
      const definition = this.towerDefinitions[source.definitionId];
      const networkAreas = new Set(this.networkAreasByArea.get(source.areaId) || [source.areaId]);
      for (const modifier of definition?.modifiers || []) {
        for (const target of this.state.towers) {
          const applies = modifier.scope === 'self'
            ? source.id === target.id
            : modifier.scope === 'same_area_other'
              ? source.id !== target.id && source.areaId === target.areaId
              : modifier.scope === 'same_area'
                ? source.areaId === target.areaId
                : modifier.scope === 'network_area_other'
                  ? source.id !== target.id && networkAreas.has(target.areaId)
                  : modifier.scope === 'network_area'
                    ? networkAreas.has(target.areaId)
                    : modifier.scope === 'global';
          if (applies) this.addModifier(cache, target, modifier, source);
        }
      }
    }
    this.modifierCache = cache;
  }

  syncTowerStats() {
    for (const tower of this.state.towers) {
      const definition = this.towerDefinitions[tower.definitionId];
      if (!definition) continue;
      tower.effectiveRange = this.towerStat(tower, 'range', definition.range);
      tower.effectiveCadence = definition.attack
        ? this.towerStat(tower, 'cadencePerSecond', definition.attack.cadencePerSecond)
        : 0;
      if (definition.control && definition.control.input !== 'none') {
        const geometry = normalizeControlGeometry(definition, tower, tower.controlGeometry, this.map);
        if (geometry) tower.controlGeometry = geometry;
        else {
          tower.controlGeometry = defaultControlGeometry(definition, tower, this.map);
          tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
        }
      }
    }
  }

  applyTowerAttackStats(tower, attack) {
    if (attack.volley) {
      attack.volley.count = Math.max(1, Math.round(this.towerStat(tower, 'volleyCount', attack.volley.count || 1)));
    }
    if (Number.isFinite(attack.delivery.speed)) attack.delivery.speed = Math.max(1, this.towerStat(tower, 'projectileSpeed', attack.delivery.speed));
    if (Number.isFinite(attack.delivery.collisionRadius)) {
      attack.delivery.collisionRadius = Math.max(0, this.towerStat(tower, 'collisionRadius', attack.delivery.collisionRadius));
    }
    if (Number.isFinite(attack.delivery.maxContacts)) {
      attack.delivery.maxContacts = Math.max(1, Math.round(this.towerStat(tower, 'projectileContacts', attack.delivery.maxContacts)));
    }
    if (attack.geometry.maxVictims !== 'unlimited') {
      attack.geometry.maxVictims = Math.max(1, Math.round(this.towerStat(tower, 'maxVictims', attack.geometry.maxVictims)));
    }
    if (Number.isFinite(attack.geometry.radius)) attack.geometry.radius = Math.max(0, this.towerStat(tower, 'geometryRadius', attack.geometry.radius));
    if (Number.isFinite(attack.geometry.width)) attack.geometry.width = Math.max(0, this.towerStat(tower, 'geometryWidth', attack.geometry.width));
    if (Number.isFinite(attack.geometry.jumpRadius)) attack.geometry.jumpRadius = Math.max(0, this.towerStat(tower, 'chainRadius', attack.geometry.jumpRadius));
    const modifyEffects = (effects) => {
      for (const effect of effects || []) {
        if (effect.type === 'damage') effect.amount = Math.max(0, this.towerStat(tower, 'damage', effect.amount));
        else if (effect.type === 'status') {
          effect.magnitude = Math.max(0, this.towerStat(tower, 'statusMagnitude', effect.magnitude));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'statusDuration', effect.durationSeconds));
        } else if (effect.type === 'position_recall') {
          effect.delaySeconds = Math.max(0, this.towerStat(tower, 'recallDelay', effect.delaySeconds));
        } else if (effect.type === 'slow_field') {
          effect.magnitude = Math.max(0, this.towerStat(tower, 'statusMagnitude', effect.magnitude));
          effect.radius = Math.max(0, this.towerStat(tower, 'controlRadius', effect.radius));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'statusDuration', effect.durationSeconds));
        } else if (effect.type === 'radial_force_field' || effect.type === 'directional_force_field') {
          effect.strength = this.towerStat(tower, 'forceStrength', effect.strength);
          effect.radius = Math.max(0, this.towerStat(tower, 'controlRadius', effect.radius));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'controlDuration', effect.durationSeconds));
        } else if (effect.type === 'vortex_force_field') {
          effect.radialStrength = this.towerStat(tower, 'forceStrength', effect.radialStrength);
          effect.tangentialStrength = this.towerStat(tower, 'forceStrength', effect.tangentialStrength);
          effect.radius = Math.max(0, this.towerStat(tower, 'controlRadius', effect.radius));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'controlDuration', effect.durationSeconds));
        } else if (effect.type === 'pinch_force_field') {
          effect.strength = this.towerStat(tower, 'forceStrength', effect.strength);
          effect.radius = Math.max(0, this.towerStat(tower, 'controlRadius', effect.radius));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'controlDuration', effect.durationSeconds));
        } else if (effect.type === 'force_wall') {
          effect.strength = this.towerStat(tower, 'forceStrength', effect.strength);
          effect.halfLength = Math.max(1, this.towerStat(tower, 'wallLength', effect.halfLength));
          effect.thickness = Math.max(1, this.towerStat(tower, 'wallThickness', effect.thickness));
          effect.durationSeconds = Math.max(0, this.towerStat(tower, 'controlDuration', effect.durationSeconds));
        }
      }
    };
    modifyEffects(attack.effects);
    for (const trigger of attack.triggers || []) modifyEffects(trigger.effects);
    attack.rewardPerKill = Math.max(0, this.towerStat(tower, 'killReward', attack.rewardPerKill));
    return attack;
  }

  fireTowers() {
    if (!this.modifierCache) this.rebuildModifierCache();
    this.syncTowerStats();
    for (const tower of this.state.towers) {
      const definition = this.towerDefinitions[tower.definitionId];
      if (!definition?.attack) continue;
      // Preserve fractional cadence between ticks. Clamping before the shot
      // silently quantized rates down (for example, 6/s behaved as 5.5/s).
      tower.fireCharge = (tower.fireCharge || 0) + tower.effectiveCadence / AUTHORITY_TICK_RATE;
      if (tower.fireCharge < 1) continue;
      const attack = createAttackSnapshot(definition, tower, {
        range: tower.effectiveRange,
        cadencePerSecond: tower.effectiveCadence,
        createdTick: this.state.runTick
      });
      this.applyTowerAttackStats(tower, attack);
      if (attack.delivery.type === 'projectile') this.fireProjectileVolley(tower, attack);
      else if (attack.delivery.type === 'hitscan') this.fireHitscan(tower, attack);
      else if (attack.delivery.type === 'persistent') this.firePersistent(tower, attack);
      // A tower with no target keeps one ready shot, but never stockpiles an
      // arbitrarily large burst while the arena is empty.
      tower.fireCharge = Math.min(1, tower.fireCharge);
    }
  }

  reserveVolleyTargets(tower, attack) {
    const targets = [];
    const count = Math.max(1, attack.volley?.count || 1);
    const targetSpacing = Math.max(0, attack.volley?.targetSpacing || 0);
    const excludedIds = new Set();
    for (let projectileIndex = 0; projectileIndex < count; projectileIndex += 1) {
      const target = this.swarm.findTarget(tower.x, tower.y, attack.range, tower.targetingMode, excludedIds)
        || (targetSpacing > 0 ? this.swarm.findTarget(tower.x, tower.y, attack.range, tower.targetingMode) : null);
      if (!target || !this.swarm.reserve(target.id, target.generation)) break;
      targets.push(target);
      if (targetSpacing > 0) {
        for (const nearby of this.swarm.enemiesInCircle(target.x, target.y, targetSpacing)) excludedIds.add(nearby.id);
      }
    }
    return targets;
  }

  fireProjectileVolley(tower, attack) {
    const strikePoints = tower.strikePoint
      ? strikeImpactPoints(tower, attack, tower.strikePoint)
      : [];
    const manualDetonation = strikePoints.length > 0;
    if (manualDetonation) {
      const activationRadius = Math.max(1, attack.geometry?.radius || attack.delivery?.collisionRadius || 1);
      const hasTargetNearPattern = strikePoints.some((point) => (
        this.swarm.enemiesInCircle(point.x, point.y, activationRadius).length > 0
      ));
      if (!hasTargetNearPattern) return;
    }
    const targets = manualDetonation
      ? strikePoints.map((point) => ({ ...point, id: 0, generation: 0 }))
      : this.reserveVolleyTargets(tower, attack);
    if (!targets.length) return;
    tower.fireCharge -= 1;
    const primaryX = targets[0].x - tower.x;
    const primaryY = targets[0].y - tower.y;
    const primaryDistance = Math.hypot(primaryX, primaryY) || 1;
    const perpendicularX = -primaryY / primaryDistance;
    const perpendicularY = primaryX / primaryDistance;
    const spacing = attack.volley?.muzzleSpacing || 0;
    const parallel = attack.volley?.parallel === true;
    const parallelLaunchTicks = parallel
      ? Math.max(1, Math.round((attack.volley?.parallelLaunchSeconds || 0.14) * AUTHORITY_TICK_RATE))
      : 0;
    const orderedTargets = parallel
      ? [...targets].sort((left, right) => (
        left.x * perpendicularX + left.y * perpendicularY
        - right.x * perpendicularX - right.y * perpendicularY
      ) || left.id - right.id)
      : targets;
    const volleyId = `volley_${this.state.runTick}_${this.nextProjectileNumber}`;

    for (let index = 0; index < orderedTargets.length; index += 1) {
      const target = orderedTargets[index];
      const lateralOffset = (index - (orderedTargets.length - 1) * 0.5) * spacing;
      const formationOffsetX = perpendicularX * lateralOffset;
      const formationOffsetY = perpendicularY * lateralOffset;
      const startX = tower.x + formationOffsetX;
      const startY = tower.y + formationOffsetY;
      const dx = target.x - startX;
      const dy = target.y - startY;
      const distance = Math.hypot(dx, dy) || 1;
      this.state.projectiles.push({
        id: `projectile_${this.nextProjectileNumber++}`,
        volleyId,
        volleyIndex: index,
        volleySize: orderedTargets.length,
        parallel,
        parallelUntilTick: this.state.runTick + parallelLaunchTicks,
        launchDirectionX: primaryX / primaryDistance,
        launchDirectionY: primaryY / primaryDistance,
        formationOffsetX,
        formationOffsetY,
        towerId: tower.id,
        ownerId: tower.ownerId,
        formId: tower.definitionId,
        targetEnemyId: target.id,
        targetGeneration: target.generation,
        manualDetonation,
        manualImpactX: manualDetonation ? target.x : null,
        manualImpactY: manualDetonation ? target.y : null,
        x: startX,
        y: startY,
        vx: (parallel ? primaryX / primaryDistance : dx / distance) * attack.delivery.speed,
        vy: (parallel ? primaryY / primaryDistance : dy / distance) * attack.delivery.speed,
        speed: attack.delivery.speed,
        collisionRadius: attack.delivery.collisionRadius,
        contactsRemaining: Math.max(1, Math.round(attack.delivery.maxContacts || 1)),
        contactsMade: 0,
        createdTick: this.state.runTick,
        expiresTick: this.state.runTick + Math.max(
          1,
          Math.ceil((attack.range / attack.delivery.speed + 0.75) * AUTHORITY_TICK_RATE)
        ),
        attack
      });
      this.state.stats.shotsFired += 1;
    }
  }

  fireHitscan(tower, attack) {
    const pendingKilled = new Set();
    const pendingDamage = new Map();
    const plans = [];
    const beamCount = Math.max(1, Math.round(attack.volley?.count || 1));
    for (let beamIndex = 0; beamIndex < beamCount; beamIndex += 1) {
      const target = this.swarm.findTarget(tower.x, tower.y, attack.range, tower.targetingMode, pendingKilled);
      if (!target) break;
      const dx = target.x - tower.x;
      const dy = target.y - tower.y;
      const distance = Math.hypot(dx, dy) || 1;
      const beamAttack = cloneSerializable(attack);
      beamAttack.geometry = {
        ...beamAttack.geometry,
        type: 'line',
        x1: tower.x,
        y1: tower.y,
        x2: tower.x + dx / distance * attack.range,
        y2: tower.y + dy / distance * attack.range,
        width: beamAttack.geometry.width || 6,
        beamIndex,
        beamCount
      };
      plans.push(planAttackImpact(this.swarm, beamAttack, { ...target }, pendingKilled, pendingDamage));
      this.state.stats.shotsFired += 1;
      this.state.stats.shotsResolved += 1;
    }
    if (!plans.length) return;
    tower.fireCharge -= 1;
    this.resolvePlans(plans);
  }

  firePersistent(tower, attack) {
    const target = this.swarm.findTarget(tower.x, tower.y, attack.range, tower.targetingMode);
    if (!target) return;
    tower.fireCharge -= 1;
    const durationTicks = Math.max(1, Math.round((attack.delivery.durationSeconds || 1) * AUTHORITY_TICK_RATE));
    const pulseTicks = Math.max(1, Math.round((attack.delivery.pulseSeconds || 1 / AUTHORITY_TICK_RATE) * AUTHORITY_TICK_RATE));
    const fieldNumber = this.nextAttackFieldNumber++;
    const field = {
      id: `attack_field_${fieldNumber}`,
      kind: attack.delivery.motion === 'sweep' ? 'sweep_line' : 'persistent',
      attack,
      x: target.x,
      y: target.y,
      nextPulseTick: this.state.runTick,
      pulseTicks,
      createdTick: this.state.runTick,
      durationTicks,
      expiresTick: this.state.runTick + durationTicks + (attack.delivery.motion === 'sweep' ? 1 : 0),
      countsAsShot: true
    };
    if (field.kind === 'sweep_line') {
      field.x = tower.x;
      field.y = tower.y;
      field.baseAngle = Math.atan2(target.y - tower.y, target.x - tower.x);
      field.sweepRadians = attack.delivery.sweepRadians || Math.PI * 0.5;
      field.sweepDirection = fieldNumber % 2 === 0 ? -1 : 1;
      field.range = attack.range;
    }
    this.state.attackFields.push(field);
    this.state.stats.shotsFired += 1;
  }

  scheduleImpactFollowUps(attack, contact) {
    for (const followUp of attack.impactFollowUps || []) {
      if (followUp.type !== 'cluster_circle') continue;
      const count = Math.max(1, Math.round(followUp.count || 1));
      const delayTicks = Math.max(1, Math.round((followUp.delaySeconds || 0) * AUTHORITY_TICK_RATE));
      const delayJitterTicks = Math.max(0, Math.round((followUp.delayJitterSeconds || 0) * AUTHORITY_TICK_RATE));
      const radialJitter = Math.max(0, Math.min(followUp.ringRadius, followUp.radialJitter || 0));
      const minimumRadius = followUp.ringRadius - radialJitter;
      const maximumRadius = followUp.ringRadius + radialJitter;
      const sectorRadians = Math.PI * 2 / count;
      const angleJitter = Math.max(0, Math.min(1, followUp.angleJitter || 0));
      const scatterSeed = hashText(`${attack.sourceTowerId}:${attack.createdTick}:${this.nextAttackFieldNumber}`);
      const phase = deterministicUnit(scatterSeed) * Math.PI * 2;
      for (let index = 0; index < count; index += 1) {
        const ordinal = index + 1;
        const angleNoise = deterministicUnit(scatterSeed ^ Math.imul(ordinal, 0x9e3779b1));
        const radiusNoise = deterministicUnit(scatterSeed ^ Math.imul(ordinal, 0x85ebca6b));
        const delayNoise = deterministicUnit(scatterSeed ^ Math.imul(ordinal, 0xc2b2ae35));
        const angle = phase + index * sectorRadians + (angleNoise - 0.5) * sectorRadians * angleJitter;
        const distance = minimumRadius + (maximumRadius - minimumRadius) * radiusNoise;
        const individualDelayTicks = Math.max(
          1,
          delayTicks + Math.round((delayNoise - 0.5) * delayJitterTicks * 2)
        );
        const activationTick = this.state.runTick + individualDelayTicks;
        const followUpAttack = cloneSerializable(attack);
        followUpAttack.delivery = { type: 'persistent', motion: 'delayed_blast' };
        followUpAttack.geometry = {
          type: 'circle',
          radius: followUp.radius,
          maxVictims: followUp.maxVictims || 'unlimited',
          packetMode: followUp.packetMode || null
        };
        followUpAttack.impactFollowUps = [];
        this.state.attackFields.push({
          id: `attack_field_${this.nextAttackFieldNumber++}`,
          kind: 'delayed_blast',
          attack: followUpAttack,
          x: contact.x + Math.cos(angle) * distance,
          y: contact.y + Math.sin(angle) * distance,
          originX: contact.x,
          originY: contact.y,
          nextPulseTick: activationTick,
          pulseTicks: 1,
          createdTick: this.state.runTick,
          durationTicks: individualDelayTicks,
          expiresTick: activationTick + 1,
          countsAsShot: false
        });
      }
    }
  }

  tickAttackFields() {
    const survivors = [];
    const plans = [];
    const pendingKilled = new Set();
    const pendingDamage = new Map();
    for (const field of this.state.attackFields) {
      if (field.expiresTick <= this.state.runTick) {
        if (field.countsAsShot !== false) this.state.stats.shotsResolved += 1;
        continue;
      }
      if (field.nextPulseTick <= this.state.runTick) {
        field.nextPulseTick += field.pulseTicks;
        let pulseAttack = field.attack;
        let contact = field;
        if (field.kind === 'sweep_line') {
          const phase = Math.max(0, Math.min(1, (this.state.runTick - field.createdTick) / Math.max(1, field.durationTicks)));
          const angle = field.baseAngle + (field.sweepDirection || 1) * field.sweepRadians * phase;
          const endX = field.x + Math.cos(angle) * field.range;
          const endY = field.y + Math.sin(angle) * field.range;
          pulseAttack = cloneSerializable(field.attack);
          pulseAttack.geometry = {
            ...pulseAttack.geometry,
            type: 'line',
            x1: field.x,
            y1: field.y,
            x2: endX,
            y2: endY,
            width: pulseAttack.geometry.width || 6,
            sweepPhase: phase
          };
          contact = { x: endX, y: endY };
        }
        plans.push(planAttackImpact(this.swarm, pulseAttack, contact, pendingKilled, pendingDamage));
      }
      survivors.push(field);
    }
    this.state.attackFields = survivors;
    if (plans.length) this.resolvePlans(plans);
  }

  moveProjectiles() {
    const survivors = [];
    const pendingKilled = new Set();
    const pendingDamage = new Map();
    const plans = [];

    for (const projectile of this.state.projectiles) {
      const fallbackExpiryTick = (projectile.createdTick ?? projectile.attack?.createdTick ?? this.state.runTick)
        + Math.max(1, Math.ceil(((projectile.attack?.range || 170) / Math.max(1, projectile.speed) + 0.75) * AUTHORITY_TICK_RATE));
      const expiresTick = projectile.expiresTick ?? fallbackExpiryTick;
      if (this.state.runTick >= expiresTick) {
        if (!projectile.manualDetonation) this.swarm.release(projectile.targetEnemyId, projectile.targetGeneration);
        this.state.stats.shotsResolved += 1;
        continue;
      }
      if (projectile.manualDetonation) {
        const dx = projectile.manualImpactX - projectile.x;
        const dy = projectile.manualImpactY - projectile.y;
        const distance = Math.hypot(dx, dy);
        const travel = Math.min(projectile.speed / AUTHORITY_TICK_RATE, distance);
        if (distance <= travel + 0.001) {
          const contact = { x: projectile.manualImpactX, y: projectile.manualImpactY };
          projectile.x = contact.x;
          projectile.y = contact.y;
          plans.push(planAttackImpact(this.swarm, projectile.attack, contact, pendingKilled, pendingDamage));
          this.scheduleImpactFollowUps(projectile.attack, contact);
          this.state.stats.shotsResolved += 1;
          continue;
        }
        const directionX = dx / distance;
        const directionY = dy / distance;
        projectile.vx = directionX * projectile.speed;
        projectile.vy = directionY * projectile.speed;
        projectile.x += directionX * travel;
        projectile.y += directionY * travel;
        survivors.push(projectile);
        continue;
      }
      let target = this.swarm.enemy(projectile.targetEnemyId, projectile.targetGeneration);
      if (target && pendingKilled.has(target.id)) target = null;
      if (!target) {
        const replacement = this.swarm.findAnyUnreserved(projectile.x, projectile.y, pendingKilled);
        if (replacement && this.swarm.reserve(replacement.id, replacement.generation)) {
          projectile.targetEnemyId = replacement.id;
          projectile.targetGeneration = replacement.generation;
          target = replacement;
          this.state.stats.retargets += 1;
        }
      }
      if (!target) {
        if ((projectile.contactsMade || 0) > 0) {
          this.state.stats.shotsResolved += 1;
          continue;
        }
      }

      const parallelLaunchActive = projectile.parallel
        && this.state.runTick < (projectile.parallelUntilTick || 0);
      const dx = target ? target.x - projectile.x : 0;
      const dy = target ? target.y - projectile.y : 0;
      const distance = target ? Math.hypot(dx, dy) || 1 : 0;
      const currentVelocityLength = Math.hypot(projectile.vx, projectile.vy) || 1;
      const directionX = parallelLaunchActive
        ? projectile.launchDirectionX ?? projectile.vx / currentVelocityLength
        : target ? dx / distance : projectile.vx / currentVelocityLength;
      const directionY = parallelLaunchActive
        ? projectile.launchDirectionY ?? projectile.vy / currentVelocityLength
        : target ? dy / distance : projectile.vy / currentVelocityLength;
      const travel = parallelLaunchActive || !target
        ? projectile.speed / AUTHORITY_TICK_RATE
        : Math.min(projectile.speed / AUTHORITY_TICK_RATE, distance);
      projectile.vx = directionX * projectile.speed;
      projectile.vy = directionY * projectile.speed;
      const nextX = projectile.x + projectile.vx / projectile.speed * travel;
      const nextY = projectile.y + projectile.vy / projectile.speed * travel;
      const collision = this.swarm.firstEnemyAlongSegment(
        projectile.x,
        projectile.y,
        nextX,
        nextY,
        projectile.collisionRadius,
        pendingKilled
      );

      if (collision) {
        this.swarm.release(projectile.targetEnemyId, projectile.targetGeneration);
        plans.push(planAttackImpact(this.swarm, projectile.attack, collision, pendingKilled, pendingDamage));
        this.scheduleImpactFollowUps(projectile.attack, collision);
        projectile.contactsMade = Math.max(0, Math.floor(projectile.contactsMade || 0)) + 1;
        projectile.contactsRemaining = Math.max(
          1,
          Math.floor(projectile.contactsRemaining || projectile.attack?.delivery?.maxContacts || 1)
        ) - 1;
        if (projectile.contactsRemaining > 0) {
          const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
          const clearance = Math.max(2, projectile.collisionRadius * 1.5);
          projectile.x = collision.x + projectile.vx / speed * clearance;
          projectile.y = collision.y + projectile.vy / speed * clearance;
          projectile.targetEnemyId = 0;
          projectile.targetGeneration = 0;
          survivors.push(projectile);
        } else {
          this.state.stats.shotsResolved += 1;
        }
        continue;
      }

      projectile.x = nextX;
      projectile.y = nextY;
      survivors.push(projectile);
    }

    this.state.projectiles = survivors;
    if (plans.length) this.resolvePlans(plans);
  }

  resolvePlans(plans) {
    const sourceKillCounts = new Map(this.state.towers.map((tower) => [tower.id, tower.kills || 0]));
    const resolution = resolveAttackPlans(this.swarm, plans, {
      tick: this.state.runTick,
      forceFields: this.state.forceFields,
      nextFieldNumber: () => this.nextFieldNumber++,
      sourceKillCounts
    });
    this.state.stats.triggerEvents += resolution.processedTriggers;
    if (resolution.triggerOverflow) this.state.stats.triggerOverflows += 1;
    for (const result of resolution.results) this.recordAttackResult(result);
  }

  recordAttackResult(result) {
    const kills = result.kills;
    const killCount = kills.reduce((total, kill) => total + Math.max(1, Math.floor(kill.unitsKilled || 1)), 0);
    const contact = result.contact || kills[0] || result.hits[0] || null;
    this.state.stats.hits += result.hits.length;
    this.state.stats.controlApplications += result.controlTargets.reduce(
      (total, target) => total + Math.max(1, Math.floor(target.units || 1)),
      0
    );
    this.emit(EVENT.ATTACK_RESOLVED, {
      sourceTowerId: result.attack.sourceTowerId,
      sourceFormId: result.attack.sourceFormId,
      geometry: result.attack.geometry,
      hitEnemyIds: result.hits.map((hit) => hit.id),
      killedEnemyIds: kills.map((kill) => kill.id),
      killedUnitCount: killCount,
      x: contact?.x ?? null,
      y: contact?.y ?? null,
      controlTargets: result.controlTargets,
      createdFields: result.createdFields
    });
    if (killCount < 1) return;
    const totalReward = killCount * result.attack.rewardPerKill;
    this.state.stats.kills += killCount;
    const sourceTower = this.state.towers.find((tower) => tower.id === result.attack.sourceTowerId);
    if (sourceTower) {
      sourceTower.kills = Math.max(0, Math.floor(sourceTower.kills || 0)) + killCount;
      sourceTower.lastKillTick = this.state.runTick;
    }
    this.emit(EVENT.KILLS_RECORDED, {
      count: killCount,
      totalReward,
      sourceTowerId: result.attack.sourceTowerId,
      sourceFormId: result.attack.sourceFormId,
      enemyId: kills[0].id,
      enemyIds: kills.map((kill) => kill.id),
      x: contact?.x ?? kills[0].x,
      y: contact?.y ?? kills[0].y,
      controlTargets: result.controlTargets,
      towerKills: sourceTower?.kills ?? null,
      totalKills: this.state.stats.kills
    });
    if (totalReward > 0) this.distributeIncome(totalReward);
    this.applyKillIncomeSupport(result.attack, killCount);
  }

  activeKillIncomeEffects(areaId) {
    if (!areaId) return [];
    if (!this.modifierCache) this.rebuildModifierCache();
    const candidatesByGroup = new Map();
    for (const tower of [...this.state.towers].sort(compareStableIds)) {
      const definition = this.towerDefinitions[tower.definitionId];
      const sourceAreas = new Set(this.networkAreasByArea.get(tower.areaId) || [tower.areaId]);
      for (const effect of definition?.supportEffects || []) {
        if (effect.type !== 'kill_income') continue;
        if (effect.scope === 'network_area' && !sourceAreas.has(areaId)) continue;
        if (effect.scope === 'same_area' && tower.areaId !== areaId) continue;
        const group = effect.stackGroup || effect.id;
        if (!candidatesByGroup.has(group)) candidatesByGroup.set(group, []);
        candidatesByGroup.get(group).push({ effect, tower });
      }
    }
    const active = [];
    for (const candidates of candidatesByGroup.values()) {
      if (candidates[0].effect.stacking === 'diminishing_sources') {
        active.push({
          ...candidates[0],
          sourceCount: candidates.length,
          sourceTowerIds: candidates.map((candidate) => candidate.tower.id)
        });
        continue;
      }
      let strongest = candidates[0];
      for (const candidate of candidates.slice(1)) {
        const candidateStrength = candidate.effect.bonusCredits / candidate.effect.everyKills;
        const strongestStrength = strongest.effect.bonusCredits / strongest.effect.everyKills;
        if (candidateStrength > strongestStrength
          || (candidateStrength === strongestStrength && candidate.tower.id < strongest.tower.id)) strongest = candidate;
      }
      active.push({ ...strongest, sourceCount: 1, sourceTowerIds: [strongest.tower.id] });
    }
    return active;
  }

  applyKillIncomeSupport(attack, killCount) {
    if (!Number.isSafeInteger(killCount) || killCount < 1) return;
    const sourceTower = this.state.towers.find((tower) => tower.id === attack.sourceTowerId);
    const areaId = attack.sourceAreaId || sourceTower?.areaId;
    if (!areaId) return;
    if (!this.modifierCache) this.rebuildModifierCache();
    const networkAreaIds = this.networkAreasByArea.get(areaId) || [areaId];
    for (const { effect, tower, sourceCount, sourceTowerIds } of this.activeKillIncomeEffects(areaId)) {
      const counterKey = `${effect.stackGroup || effect.id}:${networkAreaIds.join('|')}`;
      const diminishing = effect.stacking === 'diminishing_sources';
      const counterTarget = diminishing ? effect.additionalEveryKills : effect.everyKills;
      const primaryPointsPerKill = diminishing ? counterTarget / effect.everyKills : 1;
      const pointsPerKill = primaryPointsPerKill + (diminishing ? Math.max(0, sourceCount - 1) : 0);
      const accumulated = Math.max(0, Math.floor(this.state.supportCounters[counterKey] || 0)) + killCount * pointsPerKill;
      const milestones = Math.floor(accumulated / counterTarget);
      this.state.supportCounters[counterKey] = accumulated % counterTarget;
      if (milestones < 1) continue;
      const credits = milestones * effect.bonusCredits;
      tower.supportTriggers = Math.max(0, Math.floor(tower.supportTriggers || 0)) + milestones;
      tower.bonusCredits = Math.max(0, Math.floor(tower.bonusCredits || 0)) + credits;
      this.state.stats.supportTriggers += milestones;
      this.state.stats.bonusCredits += credits;
      this.emit(EVENT.SUPPORT_TRIGGERED, {
        type: effect.type,
        effectId: effect.id,
        sourceTowerId: tower.id,
        sourceTowerIds,
        sourceCount,
        sourceFormId: tower.definitionId,
        areaIds: [...networkAreaIds],
        x: tower.x,
        y: tower.y,
        credits,
        milestones,
        progress: this.state.supportCounters[counterKey],
        progressTarget: counterTarget,
        pointsPerKill,
        everyKills: effect.everyKills,
        additionalEveryKills: effect.additionalEveryKills || null
      });
      this.distributeIncome(credits);
    }
  }

  applyCommand(command) {
    if (command.type === COMMAND.JOIN) {
      this.join(command);
      return;
    }
    const player = this.authorizedPlayer(command);
    if (!player) return;
    if (command.type === COMMAND.LEAVE) return this.leave(command, player);
    if (command.type === COMMAND.SESSION_START) return this.startSession(command, player);
    if (command.type === COMMAND.SESSION_CONTINUE_WITHOUT_PLAYER) return this.continueWithoutPlayer(command, player);
    if (this.state.phase === 'reconnect_wait') return this.reject(command, 'waiting for player reconnect');
    if (command.type === COMMAND.SESSION_RESTART) return this.restartSession(command);
    if (this.state.phase !== 'running') return this.reject(command, 'the run is defeated');
    if (command.type === COMMAND.TOWER_PLACE) this.placeTower(command, player);
    else if (command.type === COMMAND.TOWER_EVOLVE) this.evolveTower(command, player);
    else if (command.type === COMMAND.TOWER_SELL) this.sellTower(command, player);
    else if (command.type === COMMAND.TOWER_TARGETING_SET) this.setTowerTargeting(command, player);
    else if (command.type === COMMAND.TOWER_STRIKE_POINT_SET) this.setTowerStrikePoint(command, player);
    else if (command.type === COMMAND.TOWER_FORCE_DIRECTION_SET) this.setTowerForceDirection(command, player);
    else if (command.type === COMMAND.TOWER_CONTROL_GEOMETRY_SET) this.setTowerControlGeometry(command, player);
    else if (command.type === COMMAND.TOWER_RELAY_TARGET_SET) this.setRelayTarget(command, player);
    else if (command.type === COMMAND.TEST_CONFIG_SET) this.setTestConfig(command);
    else if (command.type === COMMAND.TEST_CLEAR) this.clearTestField(command);
    else if (command.type === COMMAND.TEST_STEP) this.stepTestField(command);
    else if (command.type === COMMAND.TEST_TOWER_FORM_SET) this.setTestTowerForm(command, player);
    else if (command.type === COMMAND.TEST_TOWER_MOVE) this.moveTestTower(command, player);
  }

  reject(command, reason) {
    this.emit(EVENT.COMMAND_REJECTED, {
      clientId: command.clientId,
      playerId: command.playerId,
      sequence: command.sequence,
      type: command.type,
      reason
    });
  }

  authorizedPlayer(command) {
    const player = this.state.players.find((candidate) => candidate.id === command.playerId);
    if (!player || player.clientId !== command.clientId || !player.connected || player.spectator) {
      this.reject(command, 'player is not authorized');
      return null;
    }
    return player;
  }

  join(command) {
    const existing = this.state.players.find((player) => player.clientId === command.clientId);
    if (existing) {
      existing.connected = true;
      delete existing.disconnectedTick;
      if (this.state.phase === 'lobby') existing.eliminated = false;
      if (existing.eliminated) {
        existing.spectator = true;
        this.emit(EVENT.PLAYER_BECAME_SPECTATOR, { playerId: existing.id });
        return;
      }
      existing.spectator = false;
      this.emit(EVENT.PLAYER_RECONNECTED, { player: existing });
      if (this.state.disconnectWait?.playerId === existing.id) {
        this.state.disconnectWait = null;
        this.state.phase = 'running';
        this.beginNextReconnectWait();
      }
      return;
    }
    if (this.state.rosterLocked) return this.reject(command, 'run roster is locked');
    const playerId = `player_${this.state.players.length + 1}`;
    const player = {
      id: playerId,
      clientId: command.clientId,
      label: sanitizeLabel(command.payload.label),
      connected: true,
      spectator: false,
      eliminated: false,
      joinedTick: this.state.tick
    };
    this.state.players.push(player);
    this.state.economyByPlayer[playerId] = { credits: this.startingCredits, totalEarned: 0, totalSpent: 0 };
    if (!this.state.hostPlayerId) this.state.hostPlayerId = playerId;
    this.emit(EVENT.PLAYER_JOINED, { player, hostPlayerId: this.state.hostPlayerId });
  }

  leave(command, player) {
    player.connected = false;
    player.disconnectedTick = this.state.tick;
    this.emit(EVENT.PLAYER_LEFT, { playerId: player.id });
    const connected = this.connectedPlayers();
    if (this.state.hostPlayerId === player.id) {
      const successor = connected[0] || null;
      this.state.hostPlayerId = successor?.id || null;
      this.emit(EVENT.HOST_MIGRATED, { previousHostPlayerId: player.id, hostPlayerId: this.state.hostPlayerId });
    }
    if (this.state.phase === 'lobby') {
      player.eliminated = true;
      player.spectator = true;
      return;
    }
    if (this.state.phase === 'defeated') return;
    if (!connected.length) return;
    if (this.state.disconnectWait) return;
    this.beginNextReconnectWait();
  }

  beginNextReconnectWait() {
    if (this.state.disconnectWait || !this.connectedPlayers().length) return false;
    const player = this.state.players
      .filter((candidate) => !candidate.connected && !candidate.eliminated && !candidate.spectator)
      .sort((a, b) => (a.disconnectedTick || 0) - (b.disconnectedTick || 0) || compareStableIds(a, b))[0];
    if (!player) return false;
    const startedTick = Number.isSafeInteger(player.disconnectedTick) ? player.disconnectedTick : this.state.tick;
    this.state.phase = 'reconnect_wait';
    this.state.disconnectWait = {
      playerId: player.id,
      startedTick,
      deadlineTick: startedTick + RECONNECT_WAIT_TICKS
    };
    this.emit(EVENT.PLAYER_RECONNECT_WAIT_STARTED, this.state.disconnectWait);
    return true;
  }

  connectedPlayers() {
    return this.state.players
      .filter((player) => player.connected && !player.spectator)
      .sort((a, b) => a.joinedTick - b.joinedTick || compareStableIds(a, b));
  }

  startSession(command, player) {
    if (this.state.phase !== 'lobby') return this.reject(command, 'the run has already started');
    if (player.id !== this.state.hostPlayerId) return this.reject(command, 'only the host may start the run');
    if (this.connectedPlayers().length < 1) return this.reject(command, 'the lobby has no players');
    try {
      this.resetFreshRun(command.payload.mapId || this.map.id);
    } catch {
      return this.reject(command, 'selected map is unavailable');
    }
    this.state.rosterLocked = true;
    this.state.phase = 'running';
    this.emit(EVENT.RUN_STARTED, {
      hostPlayerId: this.state.hostPlayerId,
      playerIds: this.connectedPlayers().map((candidate) => candidate.id),
      mapId: this.map.id,
      seed: this.seed
    });
  }

  continueWithoutPlayer(command, player) {
    if (player.id !== this.state.hostPlayerId) return this.reject(command, 'only the host may continue without a player');
    if (!this.state.disconnectWait) return this.reject(command, 'no player is waiting to reconnect');
    this.completeBalancedInheritance(this.state.disconnectWait.playerId);
  }

  completeBalancedInheritance(departedPlayerId) {
    const departed = this.state.players.find((player) => player.id === departedPlayerId);
    const recipients = this.connectedPlayers().filter((player) => player.id !== departedPlayerId);
    if (!departed || !recipients.length) return false;
    const inheritedValue = new Map(recipients.map((player) => [player.id, 0]));
    const assignments = [];
    const orphaned = this.state.towers
      .filter((tower) => tower.ownerId === departedPlayerId)
      .sort((a, b) => b.totalInvestment - a.totalInvestment || compareStableIds(a, b));
    for (const tower of orphaned) {
      const recipient = [...recipients].sort((a, b) => {
        return inheritedValue.get(a.id) - inheritedValue.get(b.id)
          || a.joinedTick - b.joinedTick
          || compareStableIds(a, b);
      })[0];
      tower.ownerId = recipient.id;
      inheritedValue.set(recipient.id, inheritedValue.get(recipient.id) + tower.totalInvestment);
      assignments.push({ towerId: tower.id, ownerId: recipient.id, investment: tower.totalInvestment });
    }

    const departedEconomy = this.state.economyByPlayer[departedPlayerId];
    const credits = departedEconomy?.credits || 0;
    const share = Math.floor(credits / recipients.length);
    let remainder = credits % recipients.length;
    const creditTransfers = {};
    for (const recipient of recipients) {
      const amount = share + (remainder-- > 0 ? 1 : 0);
      this.state.economyByPlayer[recipient.id].credits += amount;
      creditTransfers[recipient.id] = amount;
    }
    if (departedEconomy) departedEconomy.credits = 0;
    departed.eliminated = true;
    departed.spectator = true;
    this.state.disconnectWait = null;
    this.state.phase = 'running';
    this.emit(EVENT.BALANCED_INHERITANCE_COMPLETED, {
      departedPlayerId,
      assignments,
      creditTransfers
    });
    this.beginNextReconnectWait();
    return true;
  }

  restartSession(command) {
    if (this.state.phase === 'lobby') return this.reject(command, 'start the lobby instead of restarting it');
    if (this.connectedPlayers().length !== 1) return this.reject(command, 'multiplayer restart voting is not implemented');
    try {
      this.resetFreshRun(command.payload.mapId || this.map.id);
    } catch {
      return this.reject(command, 'selected map is unavailable');
    }
    this.state.runNumber += 1;
    this.state.phase = 'running';
    this.emit(EVENT.SESSION_RESTARTED, { runNumber: this.state.runNumber, seed: this.seed, mapId: this.map.id });
  }

  placeTower(command, player) {
    const { definitionId, x, y } = command.payload;
    const definition = this.towerDefinitions[definitionId];
    if (!definition) return this.reject(command, 'tower definition is unavailable');
    const build = towerBuildQuote(this.towerDefinitions, definitionId);
    if (!build) return this.reject(command, 'tower form cannot be built directly');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.reject(command, 'tower position is invalid');
    const areaId = findDefenseAreaAt(this.map, x, y);
    if (!areaId) return this.reject(command, 'tower must be inside a defense area');
    const cost = build.cost;
    const economy = this.state.economyByPlayer[player.id];
    if (economy.credits < cost) return this.reject(command, 'insufficient credits');
    economy.credits -= cost;
    economy.totalSpent += cost;
    const tower = this.normalizeTower({
      id: `tower_${this.nextTowerNumber++}`,
      ownerId: player.id,
      definitionId,
      x,
      y,
      areaId,
      targetingMode: 'closest',
      totalInvestment: cost,
      fireCharge: 0,
      formHistory: build.path,
      controlReadyTick: definition.control ? this.state.runTick + controlRebootTicks(definition) : 0
    });
    this.state.towers.push(tower);
    this.modifierCache = null;
    this.emit(EVENT.TOWER_PLACED, { tower, credits: economy.credits });
  }

  evolveTower(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may evolve it');
    const current = this.towerDefinitions[tower.definitionId];
    const next = this.towerDefinitions[command.payload.definitionId];
    if (!current || !next || !current.evolutionChoices?.includes(next.id) || next.evolvesFrom !== current.id) {
      return this.reject(command, 'tower form is not a valid replacement');
    }
    const economy = this.state.economyByPlayer[player.id];
    if (economy.credits < next.evolutionCost) return this.reject(command, 'insufficient credits');
    economy.credits -= next.evolutionCost;
    economy.totalSpent += next.evolutionCost;
    const previousDefinitionId = tower.definitionId;
    tower.definitionId = next.id;
    tower.totalInvestment += next.evolutionCost;
    tower.fireCharge = 0;
    tower.formHistory = [...tower.formHistory, next.id];
    if (!supportsStrikePoint(next.attack)) tower.strikePoint = null;
    tower.forceDirection = null;
    tower.controlGeometry = null;
    tower.controlReadyTick = 0;
    tower.controlStats = { activations: 0, affectedUnits: 0, affectedUnitTicks: 0, lastActiveTick: 0 };
    this.modifierCache = null;
    this.rebuildModifierCache();
    this.syncTowerStats();
    if (next.control) {
      tower.controlGeometry = defaultControlGeometry(next, tower, this.map);
      tower.controlReadyTick = this.state.runTick + controlRebootTicks(next);
    }
    this.emit(EVENT.TOWER_EVOLVED, {
      towerId: tower.id,
      previousDefinitionId,
      tower,
      cost: next.evolutionCost,
      credits: economy.credits
    });
  }

  sellTower(command, player) {
    const towerIndex = this.state.towers.findIndex((tower) => tower.id === command.payload.towerId);
    if (towerIndex < 0) return this.reject(command, 'tower does not exist');
    const tower = this.state.towers[towerIndex];
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may sell it');
    const refund = Math.floor(tower.totalInvestment * 0.5);
    const economy = this.state.economyByPlayer[player.id];
    economy.credits += refund;
    this.state.towers.splice(towerIndex, 1);
    this.modifierCache = null;
    this.emit(EVENT.TOWER_SOLD, { towerId: tower.id, ownerId: player.id, refund, credits: economy.credits });
  }

  setTowerTargeting(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may change targeting');
    const allowedModes = this.towerDefinitions[tower.definitionId]?.targetingModes || ['closest'];
    if (!allowedModes.includes(command.payload.mode)) return this.reject(command, 'targeting mode is unavailable');
    tower.targetingMode = command.payload.mode;
    this.emit(EVENT.TOWER_TARGETING_CHANGED, { towerId: tower.id, mode: tower.targetingMode });
  }

  setTowerStrikePoint(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may set its strike point');
    const definition = this.towerDefinitions[tower.definitionId];
    if (!supportsStrikePoint(definition?.attack)) return this.reject(command, 'tower does not support strike points');
    const clearing = command.payload.x === null && command.payload.y === null;
    if (clearing) {
      tower.strikePoint = null;
      this.emit(EVENT.TOWER_STRIKE_POINT_CHANGED, { towerId: tower.id, strikePoint: null });
      return;
    }
    const { x, y } = command.payload;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.reject(command, 'strike point is invalid');
    this.syncTowerStats();
    if (Math.hypot(x - tower.x, y - tower.y) > tower.effectiveRange + 0.001) {
      return this.reject(command, 'strike point is outside tower range');
    }
    tower.strikePoint = { x: Math.round(x), y: Math.round(y) };
    this.emit(EVENT.TOWER_STRIKE_POINT_CHANGED, { towerId: tower.id, strikePoint: tower.strikePoint });
  }

  setTowerForceDirection(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may set its force direction');
    const definition = this.towerDefinitions[tower.definitionId];
    if (definition?.control?.input !== 'direction') return this.reject(command, 'tower does not support manual direction');
    const clearing = command.payload.x === null && command.payload.y === null;
    if (clearing) {
      tower.controlGeometry = defaultControlGeometry(definition, tower, this.map);
      tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
      this.emit(EVENT.TOWER_FORCE_DIRECTION_CHANGED, { towerId: tower.id, forceDirection: tower.controlGeometry });
      return;
    }
    const { x, y } = command.payload;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.reject(command, 'force direction is invalid');
    const dx = x - tower.x;
    const dy = y - tower.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.001) return this.reject(command, 'force direction needs an arrow');
    this.syncTowerStats();
    if (distance > tower.effectiveRange + 0.001) return this.reject(command, 'direction point is outside tower range');
    tower.controlGeometry = { kind: 'direction', dx: dx / distance, dy: dy / distance };
    tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
    this.emit(EVENT.TOWER_FORCE_DIRECTION_CHANGED, { towerId: tower.id, forceDirection: tower.controlGeometry });
  }

  setTowerControlGeometry(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may configure it');
    const definition = this.towerDefinitions[tower.definitionId];
    if (!supportsControlGeometry(definition)) return this.reject(command, 'tower has no configurable control geometry');
    const geometry = normalizeControlGeometry(definition, tower, command.payload.geometry, this.map);
    if (!geometry) return this.reject(command, 'control geometry is invalid or outside range');
    tower.controlGeometry = geometry;
    tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
    this.emit(EVENT.TOWER_CONTROL_GEOMETRY_CHANGED, {
      towerId: tower.id,
      controlGeometry: tower.controlGeometry,
      controlReadyTick: tower.controlReadyTick
    });
  }

  setRelayTarget(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may set its relay');
    const targetAreaId = this.validRelayTargetAreaId(tower, command.payload.targetAreaId);
    if (!targetAreaId) return this.reject(command, 'nebula is outside relay range');
    tower.relayTargetAreaId = targetAreaId;
    this.modifierCache = null;
    this.rebuildModifierCache();
    this.syncTowerStats();
    this.emit(EVENT.TOWER_RELAY_TARGET_CHANGED, {
      towerId: tower.id,
      sourceAreaId: tower.areaId,
      targetAreaId,
      networkAreaIds: [...(tower.networkAreaIds || [tower.areaId])]
    });
  }

  requireTest(command) {
    if (!this.state.test) {
      this.reject(command, 'command is only available in the test field');
      return false;
    }
    return true;
  }

  setTestConfig(command) {
    if (!this.requireTest(command)) return;
    const patch = command.payload;
    if (Number.isFinite(patch.spawnRatePerSecond)) this.state.test.spawnRatePerSecond = Math.max(0, Math.min(100000, patch.spawnRatePerSecond));
    if (Number.isFinite(patch.enemyHp)) this.state.test.enemyHp = Math.max(1, Math.min(10, Math.round(patch.enemyHp)));
    if (typeof patch.invincibleBase === 'boolean') this.state.test.invincibleBase = patch.invincibleBase;
    if (typeof patch.paused === 'boolean') this.state.test.paused = patch.paused;
    if ([0.25, 1, 2, 4].includes(patch.timeScale)) this.state.test.timeScale = patch.timeScale;
    if (Array.isArray(patch.activeSpawnSourceIds)) {
      const valid = new Set(this.map.spawnSources.map((source) => source.id));
      this.state.test.activeSpawnSourceIds = [...new Set(patch.activeSpawnSourceIds.filter((id) => valid.has(id)))];
    }
    if (patch.spawnSourceOverrides && typeof patch.spawnSourceOverrides === 'object') {
      const valid = new Set(this.map.spawnSources.map((source) => source.id));
      const overrides = {};
      for (const [id, point] of Object.entries(patch.spawnSourceOverrides)) {
        if (!valid.has(id) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
        overrides[id] = {
          x: Math.max(this.map.bounds.left, Math.min(this.map.bounds.right, Math.round(point.x))),
          y: Math.max(this.map.bounds.top, Math.min(this.map.bounds.bottom, Math.round(point.y)))
        };
      }
      this.state.test.spawnSourceOverrides = overrides;
    }
    this.emit(EVENT.TEST_CONFIG_CHANGED, { test: this.state.test });
  }

  clearTestField(command) {
    if (!this.requireTest(command)) return;
    const resetCounters = command.payload.resetCounters !== false;
    this.swarm.clearEnemies();
    this.state.projectiles = [];
    this.state.attackFields = [];
    this.state.forceFields = [];
    this.state.base.lives = this.startingLives;
    if (resetCounters) {
      this.state.runTick = 0;
      this.swarm.resetRunCounters();
      this.state.stats = initialStats();
      this.state.supportCounters = {};
      for (const tower of this.state.towers) {
        tower.kills = 0;
        tower.lastKillTick = 0;
        tower.supportTriggers = 0;
        tower.bonusCredits = 0;
        tower.controlStats = { activations: 0, affectedUnits: 0, affectedUnitTicks: 0, lastActiveTick: 0 };
      }
    }
    this.state.swarm = this.swarmSummary(this.state.test.spawnRatePerSecond, []);
    this.emit(EVENT.TEST_CLEARED, { resetCounters });
  }

  stepTestField(command) {
    if (!this.requireTest(command)) return;
    if (!this.state.test.paused) return this.reject(command, 'pause the test field before stepping');
    this.state.runTick += 1;
    this.simulateGameplay();
    this.emit(EVENT.TEST_STEPPED, { runTick: this.state.runTick });
  }

  setTestTowerForm(command, player) {
    if (!this.requireTest(command)) return;
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    const definition = this.towerDefinitions[command.payload.definitionId];
    if (!tower || !definition) return this.reject(command, 'test tower or form is unavailable');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may configure it');
    const previousDefinitionId = tower.definitionId;
    tower.definitionId = definition.id;
    if (!supportsStrikePoint(definition.attack)) tower.strikePoint = null;
    tower.forceDirection = null;
    tower.controlGeometry = null;
    tower.controlReadyTick = 0;
    tower.controlStats = { activations: 0, affectedUnits: 0, affectedUnitTicks: 0, lastActiveTick: 0 };
    tower.fireCharge = 0;
    tower.formHistory = [definition.id];
    this.modifierCache = null;
    this.rebuildModifierCache();
    this.syncTowerStats();
    if (definition.control) {
      tower.controlGeometry = defaultControlGeometry(definition, tower, this.map);
      tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
    }
    this.emit(EVENT.TOWER_EVOLVED, { towerId: tower.id, previousDefinitionId, tower, cost: 0, credits: this.state.economyByPlayer[player.id].credits, test: true });
  }

  moveTestTower(command, player) {
    if (!this.requireTest(command)) return;
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'test tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may move it');
    const { x, y } = command.payload;
    const areaId = findDefenseAreaAt(this.map, x, y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !areaId) return this.reject(command, 'test tower must stay inside a defense area');
    tower.x = Math.round(x);
    tower.y = Math.round(y);
    tower.areaId = areaId;
    this.modifierCache = null;
    this.rebuildModifierCache();
    this.syncTowerStats();
    const definition = this.towerDefinitions[tower.definitionId];
    if (definition?.control) {
      tower.controlGeometry = defaultControlGeometry(definition, tower, this.map);
      tower.controlReadyTick = this.state.runTick + controlRebootTicks(definition);
    }
    this.emit(EVENT.TEST_TOWER_MOVED, { towerId: tower.id, x: tower.x, y: tower.y, areaId });
  }

  distributeIncome(totalCredits) {
    const connected = this.connectedPlayers();
    if (!connected.length) {
      this.state.stats.unclaimedCredits += totalCredits;
      return;
    }
    const share = Math.floor(totalCredits / connected.length);
    const remainder = totalCredits % connected.length;
    const payouts = {};
    for (const player of connected) payouts[player.id] = share;
    for (let index = 0; index < remainder; index += 1) {
      payouts[connected[(this.payoutCursor + index) % connected.length].id] += 1;
    }
    this.payoutCursor = (this.payoutCursor + remainder) % connected.length;
    for (const player of connected) {
      const economy = this.state.economyByPlayer[player.id];
      economy.credits += payouts[player.id];
      economy.totalEarned += payouts[player.id];
    }
    this.emit(EVENT.INCOME_DISTRIBUTED, { totalCredits, payouts });
  }

  recordBreaches(count, invincible = false) {
    const livesLost = invincible ? 0 : Math.min(this.state.base.lives, count);
    this.state.base.lives -= livesLost;
    this.state.stats.breaches += count;
    if (this.state.base.lives === 0) this.state.phase = 'defeated';
    this.emit(EVENT.BASE_BREACHED, { count, livesLost, lives: this.state.base.lives, totalBreaches: this.state.stats.breaches });
  }

  presentation() {
    const alpha = this.state.phase === 'running' && !this.state.test?.paused ? this.accumulatorMs / AUTHORITY_TICK_MS : 0;
    return this.swarm.presentation(alpha);
  }

  correctionSnapshot() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.state.sessionId,
      mapId: this.map.id,
      sessionTick: this.state.tick,
      runTick: this.state.runTick,
      runNumber: this.state.runNumber,
      authority: {
        eventCounter: this.eventCounter,
        nextTowerNumber: this.nextTowerNumber,
        nextProjectileNumber: this.nextProjectileNumber,
        nextFieldNumber: this.nextFieldNumber,
        nextAttackFieldNumber: this.nextAttackFieldNumber,
        payoutCursor: this.payoutCursor,
        lastSequenceByClient: [...this.lastSequenceByClient.entries()],
        pendingCommands: cloneSerializable(this.pendingCommands)
      },
      state: this.snapshot(),
      swarm: this.swarm.exportCorrection()
    };
  }

  applyCorrectionSnapshot(correction) {
    if (!correction || ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, PROTOCOL_VERSION].includes(correction.protocolVersion) || !correction.mapId) {
      throw new Error('session correction is incompatible');
    }
    const correctionSeed = correction.state?.seed;
    if (!Number.isSafeInteger(correctionSeed) || correctionSeed < 0 || correctionSeed > 0xffffffff) {
      throw new Error('session correction seed is incompatible');
    }
    this.seed = correctionSeed >>> 0;
    try {
      const correctionMap = getMapDefinition(correction.mapId);
      if (this.mode === 'game' && !correctionMap.playable) throw new Error('map is not playable');
      this.bindMap(correctionMap.id);
    } catch {
      throw new Error('session correction map is incompatible');
    }
    this.state = cloneSerializable(correction.state);
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.mapId = this.map.id;
    this.state.mapLabel = this.map.label;
    this.state.mapCatalog = playableMaps().map((map) => ({ id: map.id, label: map.label }));
    this.state.stats = { ...initialStats(), ...(this.state.stats || {}) };
    this.state.supportCounters = this.state.supportCounters && typeof this.state.supportCounters === 'object'
      ? this.state.supportCounters
      : {};
    if (correction.protocolVersion < 8) {
      for (const [key, value] of Object.entries(this.state.supportCounters)) {
        if (key.startsWith('forge_income:')) this.state.supportCounters[key] = Math.max(0, Math.floor(value || 0)) * 10;
      }
    }
    this.state.towerCatalog = Object.values(this.towerDefinitions);
    this.state.towers = (this.state.towers || []).map((tower) => this.normalizeTower(tower));
    this.swarm.applyCorrection(correction.swarm);
    const activeSpawnPoints = Math.max(0, Math.floor(this.state.swarm?.activeSpawnPoints || 0));
    this.state.swarm = this.swarmSummary(
      Number(this.state.swarm?.spawnRatePerSecond) || 0,
      { length: activeSpawnPoints }
    );
    const metadata = correction.authority || {};
    this.eventCounter = metadata.eventCounter || this.eventCounter;
    this.nextTowerNumber = metadata.nextTowerNumber
      || this.state.towers.reduce((maximum, tower) => Math.max(maximum, Number(tower.id.split('_').at(-1)) || 0), 0) + 1;
    this.nextProjectileNumber = metadata.nextProjectileNumber
      || this.state.projectiles.reduce((maximum, projectile) => Math.max(maximum, Number(projectile.id.split('_').at(-1)) || 0), 0) + 1;
    this.nextFieldNumber = metadata.nextFieldNumber || 1;
    this.nextAttackFieldNumber = metadata.nextAttackFieldNumber || 1;
    this.payoutCursor = metadata.payoutCursor || 0;
    if (Array.isArray(metadata.lastSequenceByClient)) this.lastSequenceByClient = new Map(metadata.lastSequenceByClient);
    this.pendingCommands = Array.isArray(metadata.pendingCommands) ? cloneSerializable(metadata.pendingCommands) : [];
    this.events = [];
    this.accumulatorMs = 0;
  }

  replayLog() {
    return cloneSerializable(this.commandLog);
  }

  snapshot() {
    return cloneSerializable({ ...this.state, lastEventId: this.events.at(-1)?.eventId || null });
  }

  eventsAfter(eventId = null) {
    if (!eventId) return cloneSerializable(this.events);
    const index = this.events.findIndex((event) => event.eventId === eventId);
    return cloneSerializable(index < 0 ? this.events : this.events.slice(index + 1));
  }
}

export class EmbeddedClient {
  constructor(authority, { clientId, label }) {
    this.authority = authority;
    this.clientId = clientId;
    this.label = label;
    this.sequence = 0;
    this.playerId = null;
    this.lastEventId = null;
    this.latestSnapshot = authority.snapshot();
  }

  connect() {
    this.send(COMMAND.JOIN, { label: this.label });
  }

  disconnect() {
    if (!this.playerId) return false;
    return this.send(COMMAND.LEAVE);
  }

  send(type, payload = {}) {
    const command = createCommand({
      clientId: this.clientId,
      playerId: this.playerId,
      sequence: ++this.sequence,
      intendedTick: this.authority.state.tick + 1,
      type,
      payload
    });
    return this.authority.enqueue(command);
  }

  advance(elapsedMs) {
    this.authority.advance(elapsedMs);
    const events = this.authority.eventsAfter(this.lastEventId);
    for (const event of events) {
      this.lastEventId = event.eventId;
      if (event.type === EVENT.PLAYER_JOINED && event.payload.player.clientId === this.clientId) this.playerId = event.payload.player.id;
    }
    this.latestSnapshot = this.authority.snapshot();
    return { snapshot: this.latestSnapshot, events };
  }

  snapshot() {
    return this.latestSnapshot;
  }

  presentation() {
    return this.authority.presentation();
  }
}
