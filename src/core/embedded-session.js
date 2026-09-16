import { fireReworked, tickReworked } from './turret-rework.js';
import { decorateResearchAttack, secondaryAttack, damageFixed, damageResearchBonus, researchSecondaryPlans, pruneResearchCombat, enemyKey, physicalBullet } from './research-combat.js';
import { freshResearch, hasResearch, reactorRank, reactorBatchQuote, researchNode, arsenalChoices, researchStat } from './research.js';
import { towerPlacementClear } from './placement.js';
import { DEFAULT_PACE, normalizePace, spawnProfileAt, surgeScheduleAt, surgeSpawnSources, threatTickAt } from './progression.js';
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
  relayEligibleAreaIds,
  spawnRateAt
} from './world-config.js';
import { EnemySwarm, SWARM_RECORD_BUDGET } from './enemy-swarm.js';
import {
  createAttackSnapshot,
  planAttackImpact,
  resolveAttackPlans
} from './effect-system.js';
import { towerBuildQuote } from './tower-catalog.js';
import { controlSource, purchaseCost, saleRefund, socketPoint } from './network-descendants.js';
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

// Established relay links outlive their connector towers once the network is complete.
function freshRelayNetwork() {
  return { completedTick: null, links: [], retired: [] };
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

function initialContribution() {
  return {
    hpPopped: 0,
    kills: 0,
    creditsSpent: 0,
    towersCreated: 0,
    towersSold: 0,
    supportCredits: 0,
    controlApplications: 0
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

  bindMap(mapId, randomRifts = Boolean(this.state?.randomRifts)) {
    this.map = getMapDefinition(mapId, this.seed, { randomRifts });
    this.networkAreasByArea = new Map();
    this.relayTargetByTowerId = new Map();
    this.modifierCache = null;
    this.swarm = this.createSwarm();
  }

  createSwarm() {
    return new EnemySwarm({ seed: this.seed, map: this.map, ...this.swarmConfig });
  }

  resetFreshRun(mapId = this.map.id, pace = this.state.pace ?? DEFAULT_PACE, randomRifts = Boolean(this.state.randomRifts)) {
    this.state.dev = {};
    const nextMap = getMapDefinition(mapId);
    if (this.mode === 'game' && !nextMap.playable) throw new Error('map is not playable');
    if (this.mode === 'game') this.seed = mix32((this.seed + 0x9e3779b9) >>> 0);
    this.state.randomRifts = Boolean(randomRifts);
    this.bindMap(nextMap.id, this.state.randomRifts);
    this.state.seed = this.seed;
    this.state.mapId = this.map.id;
    this.state.mapLabel = this.map.label;
    this.state.mapCatalog = playableMaps().map((map) => ({ id: map.id, label: map.label }));
    this.state.pace = normalizePace(pace);
    this.state.runTick = 0;
    this.state.base = { ...this.map.base, lives: this.startingLives };
    this.state.towers = this.initialTowers.map((tower) => this.normalizeTower(tower));
    this.state.projectiles = [];
    delete this.state.turretRework;
    this.state.attackFields = [];
    this.state.forceFields = [];
    this.state.deployables = [];
    this.state.supportCounters = {};
    this.state.relayNetwork = freshRelayNetwork();
    this.state.research = freshResearch();
    this.state.stats = initialStats();
    this.state.test = this.initialTestConfig ? cloneSerializable(this.initialTestConfig) : null;
    this.state.swarm = this.swarmSummary(0, []);
    this.state.teamEconomy = { credits: this.startingCredits, totalEarned: 0, totalSpent: 0 };
    this.state.contributionByPlayer = Object.fromEntries(
      this.state.players.map((player) => [player.id, initialContribution()])
    );
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
      pace: DEFAULT_PACE,
      randomRifts: false,
      tick: 0,
      runTick: 0,
      runNumber: 1,
      phase: this.autoStart ? 'running' : 'lobby',
      rosterLocked: false,
      hostPlayerId: null,
      players: [],
      base: { ...this.map.base, lives: this.startingLives },
      towers: this.initialTowers.map((tower) => this.normalizeTower(tower)),
      projectiles: [],
      attackFields: [],
      forceFields: [],
      deployables: [],
      supportCounters: {},
      relayNetwork: freshRelayNetwork(),
      research: freshResearch(),
      teamEconomy: { credits: this.startingCredits, totalEarned: 0, totalSpent: 0 },
      contributionByPlayer: {},
      towerCatalog: Object.values(this.towerDefinitions),
      test: this.initialTestConfig ? cloneSerializable(this.initialTestConfig) : null,
      swarm: this.swarmSummary(0, []),
      stats: initialStats(),
      prototypeBalance: { startingLives: this.startingLives, startingCredits: this.startingCredits }
    };
  }

  normalizeTower(tower) {
    const migrated = { salvage: 'reactor', foundry: 'arsenal' };
    if (migrated[tower.definitionId]) tower = { ...tower,
      definitionId: migrated[tower.definitionId],
      formHistory: (tower.formHistory || [tower.definitionId]).map((id) => migrated[id] || id),
      researchPath: []
    };
    // Orbit is replaced in-place: old solo saves keep their tower, investment,
    // ownership and lifetime statistics rather than losing a paid upgrade.
    if (tower.definitionId === 'orbit') {
      tower = {
        ...tower,
        definitionId: 'bond',
        formHistory: (tower.formHistory || ['frame', 'tether', 'knot', 'orbit']).map((id) => id === 'orbit' ? 'bond' : id),
        controlGeometry: null,
        controlStats: null
      };
    }
    const ownDefinition = this.towerDefinitions[tower.definitionId];
    const copiedDefinition = tower.definitionId === 'echo' ? this.towerDefinitions[tower.echoWeaponId] : null;
    const definition = copiedDefinition?.supportOnly ? copiedDefinition : ownDefinition;
    const strikePoint = (supportsStrikePoint(definition?.attack) || tower.definitionId === 'echo')
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
      researchPath: [...(tower.researchPath || [])],
      kills: Math.max(0, Math.floor(tower.kills || 0)),
      lastKillTick: Math.max(0, Math.floor(tower.lastKillTick || 0)),
      hpPopped: Number.isFinite(tower.hpPopped) ? damageFixed(Math.max(0, tower.hpPopped)) : 0,
      lastDamageTick: Math.max(0, Math.floor(tower.lastDamageTick || 0)),
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
    normalized.controlReadyTick = definition?.control || tower.definitionId === 'echo'
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

  swarmSummary(spawnRatePerSecond, sources, meanHp = 1, surge = null) {
    return {
      pace: this.state?.pace ?? DEFAULT_PACE,
      threatSeconds: threatTickAt(this.state?.runTick || 0, this.state?.pace) / AUTHORITY_TICK_RATE,
      surge: surge ? {
        phase: surge.phase,
        index: surge.index,
        riftIds: [...surge.riftIds],
        activeAtSeconds: surge.activeAtSeconds,
        endsAtSeconds: surge.endsAtSeconds,
        hpMultiplier: surge.hpMultiplier ?? null
      } : null,
      activeEnemies: this.swarm.activeUnitCount,
      simulationRecords: this.swarm.count,
      compressedEnemies: this.swarm.activeUnitCount - this.swarm.count,
      recordBudget: SWARM_RECORD_BUDGET,
      slowedEnemies: this.swarm.slowedCount,
      allocatedCapacity: this.swarm.capacity,
      spawnedTotal: this.swarm.spawnedTotal,
      spawnRatePerSecond,
      meanHp,
      hpPerSecond: spawnRatePerSecond * meanHp,
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
    for (const player of this.state.players) {
      if (player.connectionState === 'reconnecting' && this.state.tick >= (player.reconnectDeadlineTick || Infinity)) {
        this.markPlayerDeparted(player);
      }
    }
    if (this.state.phase !== 'running' || this.state.test?.paused || this.state.dev?.paused) return;

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
    // everything threat-related reads the paced clock, so a slower pace delays the
    // curve, the rift unlocks and the surges together
    const threatTick = threatTickAt(this.state.runTick, this.state.pace);
    const profile = spawnProfileAt(this.map, threatTick, AUTHORITY_TICK_RATE);
    const surge = surgeScheduleAt(this.map, threatTick, this.seed, AUTHORITY_TICK_RATE);
    return {
      ...profile,
      surge,
      sources: surgeSpawnSources(activeSpawnSources(this.map, threatTick, AUTHORITY_TICK_RATE), surge, profile),
      enemyHp: this.swarmConfig.enemyHp || 1
    };
  }

  simulateGameplay() {
    if (!this.modifierCache) this.rebuildModifierCache();
    if (this.settleRelayNetwork()) {
      this.rebuildModifierCache();
    }
    this.syncTowerStats();
    const spawn = this.spawnSettings();
    pruneResearchCombat(this.state.research, this.swarm, this.state.runTick);
    const controlFields = this.syncControlFields();
    this.pulseControlFields(controlFields);
    const swarmTick = this.swarm.tick(this.state.runTick, {
      spawnRatePerSecond: this.state.dev?.stopSpawns ? 0 : spawn.rate,
      meanHp: spawn.meanHp ?? null,
      spawnSources: spawn.sources,
      enemyHp: spawn.enemyHp,
      forceFields: this.state.forceFields
    });
    this.recordControlFieldWork(controlFields);
    this.state.stats.spawned += swarmTick.spawned;
    if (swarmTick.breaches > 0) this.recordBreaches(swarmTick.breaches, Boolean(this.state.test?.invincibleBase));
    if (this.state.phase === 'running') {
      tickReworked(this);
      this.fireTowers();
      this.moveProjectiles();
      this.tickAttackFields();
    }
    if (this.state.runTick % AUTHORITY_TICK_RATE === 0) this.swarm.updateChecksum();
    this.state.swarm = this.swarmSummary(spawn.rate, spawn.sources, spawn.meanHp ?? spawn.enemyHp, spawn.surge || null);
  }

  syncControlFields() {
    const transient = this.state.forceFields.filter(
      (field) => !field.persistentControl && field.expiresTick > this.state.runTick
    );
    const controlFields = [];
    for (const tower of [...this.state.towers].sort(compareStableIds)) {
      const definition = this.weaponDefinition(tower);
      let effective = definition;
      if (definition?.control) {
        const control = { ...definition.control };
        for (const key of ['radius', 'width', 'thickness', 'waveThickness']) {
          if (Number.isFinite(control[key])) control[key] = this.towerStat(tower, key === 'radius' ? 'controlRadius' : 'controlWidth', control[key]);
        }
        if (control.periodSeconds) {
          control.periodSeconds = Math.max(2 * (control.durationSeconds || control.activeSeconds || control.travelSeconds || 0),
            control.periodSeconds / this.towerStat(tower, 'controlRecharge', 1));
        }
        effective = { ...definition, control };
        tower.effectiveControl = control;
      }
      const field = buildControlField(effective, tower, this.map, this.state.runTick);
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
          appliedTick: this.state.runTick,
          durationSeconds: field.durationTicks / AUTHORITY_TICK_RATE
        });
        const units = affected.reduce((total, enemy) => total + Math.max(1, Math.floor(enemy.units || 1)), 0);
        field.triggeredUnitsTick += units;
        stats.activations += 1;
        stats.lastActiveTick = this.state.runTick;
      } else if (field.kind === 'bond_zone' && this.state.runTick % field.periodTicks === 0) {
        field.triggeredUnitsTick += this.swarm.pulseBonds(field, this.state.runTick);
        stats.activations += 1;
        if (field.triggeredUnitsTick > 0) stats.lastActiveTick = this.state.runTick;
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
      const contribution = this.state.contributionByPlayer[tower.ownerId];
      if (contribution) contribution.controlApplications += affectedUnitTicks + triggeredUnits;
      if (affectedUnitTicks > 0 || triggeredUnits > 0) tower.controlStats.lastActiveTick = this.state.runTick;
    }
  }

  towerStat(tower, stat, baseValue) {
    let value = baseValue + researchStat(this.state, stat, baseValue, tower, this.swarm);
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
    const occupied = new Set(relayTowers.map((tower) => this.validRelayTargetAreaId(tower, tower.relayTargetAreaId)).filter(Boolean));
    // Completed networks keep their established links without physical connectors.
    for (const [areaA, areaB] of this.state.relayNetwork?.links || []) {
      if (!adjacency.has(areaA) || !adjacency.has(areaB)) continue;
      adjacency.get(areaA).add(areaB);
      adjacency.get(areaB).add(areaA);
    }
    for (const tower of relayTowers) {
      let targetAreaId = this.validRelayTargetAreaId(tower, tower.relayTargetAreaId);
      if (!targetAreaId) {
        targetAreaId = this.map.defenseAreas
          .filter((area) => !occupied.has(area.id) && !adjacency.get(tower.areaId)?.has(area.id)
            && this.validRelayTargetAreaId(tower, area.id))
          .sort((a, b) => Math.hypot(a.shape.x - tower.x, a.shape.y - tower.y)
            - Math.hypot(b.shape.x - tower.x, b.shape.y - tower.y) || a.id.localeCompare(b.id))[0]?.id || null;
        tower.relayTargetAreaId = targetAreaId;
      }
      if (targetAreaId) occupied.add(targetAreaId);
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

  // Once every eligible nebula shares one relay network, the links are written into
  // authoritative state and the ordinary connector relays retire: they collapse into
  // the established network, refund like a sale, and free their placement footprint.
  // Amplifier, echo and hardpoint keep their bodies because their mechanics need them.
  // This runs once per run on a fixed tick, so every peer and save reproduces it.
  settleRelayNetwork() {
    const network = this.state.relayNetwork ||= freshRelayNetwork();
    if (network.completedTick !== null) return false;
    // The sandbox test field keeps its single inspectable tower; completion is a run mechanic.
    if (this.state.test) return false;
    const eligible = relayEligibleAreaIds(this.map);
    if (eligible.length < 2) return false;
    const component = this.networkAreasByArea.get(eligible[0]);
    if (!component || component.length < eligible.length) return false;
    const covered = new Set(component);
    if (!eligible.every((areaId) => covered.has(areaId))) return false;
    const links = new Map();
    for (const tower of this.state.towers) {
      const targetAreaId = this.relayTargetByTowerId.get(tower.id);
      if (!targetAreaId) continue;
      const pair = [tower.areaId, targetAreaId].sort();
      links.set(pair.join('|'), pair);
    }
    network.links = [...links.keys()].sort().map((key) => links.get(key));
    network.completedTick = this.state.runTick;
    const retired = [];
    const survivors = [];
    for (const tower of [...this.state.towers].sort(compareStableIds)) {
      if (tower.definitionId !== 'relay') { survivors.push(tower); continue; }
      const refund = saleRefund(this.state, tower);
      this.state.teamEconomy.credits += refund;
      const record = {
        towerId: tower.id, ownerId: tower.ownerId, areaId: tower.areaId,
        targetAreaId: this.relayTargetByTowerId.get(tower.id) || null,
        x: tower.x, y: tower.y, totalInvestment: tower.totalInvestment, kills: tower.kills || 0,
        formHistory: [...(tower.formHistory || [])], refund
      };
      network.retired.push(record);
      retired.push(record);
    }
    this.state.towers = this.state.towers.filter((tower) => tower.definitionId !== 'relay');
    this.modifierCache = null;
    this.emit(EVENT.RELAY_NETWORK_COMPLETED, {
      tick: this.state.runTick, areaIds: [...eligible], links: network.links.map((pair) => [...pair]), retired
    });
    return true;
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
    this.networkSourcesByArea = new Map(this.map.defenseAreas.map((area) => [area.id,
      this.state.towers.filter((tower) => this.networkAreasByArea.get(area.id)?.includes(tower.areaId))]));
    const amplifiedAreas = new Set(this.state.towers.filter((tower) => tower.definitionId === 'amplifier').map((tower) => tower.areaId));
    for (const tower of this.state.towers) {
      if (!amplifiedAreas.has(tower.areaId)) continue;
      for (const modifier of cache.get(tower.id)) {
        if (['range', 'cadencePerSecond', 'controlRecharge', 'geometryRadius', 'geometryWidth', 'controlRadius', 'controlWidth'].includes(modifier.stat)) modifier.value *= 1.5;
      }
    }
  }

  weaponDefinition(tower) {
    if (tower.definitionId !== 'echo') return this.towerDefinitions[tower.definitionId];
    const source = (this.networkSourcesByArea?.get(tower.areaId) || []).find((candidate) => candidate.id === tower.echoSourceId);
    return source && controlSource(this.state, tower, source.id)
      ? this.towerDefinitions[source.definitionId] : this.towerDefinitions.echo;
  }

  syncTowerStats() {
    for (const tower of this.state.towers) {
      const definition = this.weaponDefinition(tower);
      if (!definition) continue;
      tower.effectiveRange = this.towerStat(tower, 'range', definition.range);
      tower.echoWeaponId = tower.definitionId === 'echo' && definition.id !== 'echo' ? definition.id : null;
      if (!definition.control) delete tower.effectiveControl;
      tower.effectiveCadence = definition.attack
        ? this.towerStat(tower, definition.supportOnly ? 'controlRecharge' : 'cadencePerSecond', definition.attack.cadencePerSecond)
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
    for (const followUp of attack.impactFollowUps || []) {
      if (Number.isFinite(followUp.radius)) followUp.radius = this.towerStat(tower, 'geometryRadius', followUp.radius);
    }
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
    return decorateResearchAttack(this.state, tower, attack);
  }

  researchTarget(tower, attack, excludedIds = null) {
    const ids = attack.research?.ids || this.state.research.unlocked;
    const special = ids.includes(27) || ids.includes(19) || ['execution', 'highest_hp'].includes(tower.targetingMode) || attack.research?.split;
    let target;
    if (!special) target = this.swarm.findTarget(tower.x, tower.y, attack.range, tower.targetingMode, excludedIds);
    else {
      let candidates = this.swarm.enemiesInCircle(tower.x, tower.y, attack.range, excludedIds)
        .filter((enemy) => ids.includes(27) || !this.swarm.reservedById[enemy.id]);
      if (attack.research?.split && attack.research.group) {
        const separate = candidates.filter((enemy) => Math.hypot(enemy.x - attack.research.group.x, enemy.y - attack.research.group.y) >= 64);
        if (separate.length) candidates = separate;
      }
      const baseDamage = (attack.effects || []).filter((effect) => effect.type === 'damage').reduce((sum,effect) => sum + effect.amount, 0);
      const linked = new Set((this.networkSourcesByArea?.get(tower.areaId) || []).map((source) => source.id));
      const score = (enemy) => {
        const remaining = enemy.hp - (this.researchReservations?.get(enemyKey(enemy)) || 0);
        const covered = ids.includes(27) && remaining <= 0 ? 1e15 : 0;
        const entry = this.state.research.combat[enemyKey(enemy)];
        const exposed = ids.includes(19) && entry?.exposedUntil > this.state.runTick
          && Object.keys(entry.contributors).some((id) => linked.has(id));
        if (tower.targetingMode === 'highest_hp') return covered - enemy.hp;
        if (tower.targetingMode === 'execution') return covered + (enemy.hp <= baseDamage ? enemy.hp : 1e12 + enemy.hp);
        if (exposed) return covered - 1e10 + enemy.hp;
        if (tower.targetingMode === 'nearest_base') return covered + Math.hypot(enemy.x - this.map.base.x, enemy.y - this.map.base.y);
        if (tower.targetingMode === 'farthest_base') return covered - Math.hypot(enemy.x - this.map.base.x, enemy.y - this.map.base.y);
        if (tower.targetingMode === 'densest_group') return covered - this.swarm.density[this.swarm.cellIndex(enemy.x,enemy.y)];
        return covered + Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
      };
      candidates.sort((a,b) => score(a) - score(b) || a.id - b.id);
      target = candidates[0] || null;
    }
    return target;
  }

  fireTowers() {
    if (!this.modifierCache) this.rebuildModifierCache();
    this.syncTowerStats();
    this.researchReservations = new Map();
    if (hasResearch(this.state, 27)) for (const projectile of this.state.projectiles) {
      const key = `${projectile.targetEnemyId}:${projectile.targetGeneration}`;
      const damage = projectile.attack.effects.filter((effect) => effect.type === 'damage').reduce((sum,effect) => sum + effect.amount,0);
      this.researchReservations.set(key, (this.researchReservations.get(key) || 0) + damage);
    }
    for (const tower of this.state.towers) {
      const definition = this.weaponDefinition(tower);
      if (!definition?.attack) continue;
      const target = this.researchTarget(tower, { ...definition.attack, range: tower.effectiveRange });
      if (hasResearch(this.state,34)) {
        const key = target ? enemyKey(target) : null;
        if (key !== tower.researchTrackingKey) {
          tower.researchTrackingKey = key;
          tower.researchTrackingSince = this.state.runTick;
        }
      }
      if (!target) tower.researchIdleSince ??= this.state.runTick;
      const redlines = (this.networkSourcesByArea.get(tower.areaId) || []).filter((source) => source.definitionId === 'redline').length;
      const period = Math.max(1, Math.round(10 * AUTHORITY_TICK_RATE / (1 + Math.max(0, redlines - 1) * 0.01)));
      if (!definition.supportOnly && redlines && this.state.runTick % period === 0) {
        const charge = tower.fireCharge;
        const bonus = createAttackSnapshot(definition, tower, { range: tower.effectiveRange, cadencePerSecond: tower.effectiveCadence, createdTick: this.state.runTick });
        this.applyTowerAttackStats(tower, bonus);
        bonus.research.cycle += ':redline';
        this.dispatchVolley(tower, bonus);
        tower.fireCharge = charge;
      }
      const magazine = !definition.supportOnly && hasResearch(this.state,7) ? (hasResearch(this.state,22) ? 3 : 1) : 0;
      tower.fireCharge = (tower.fireCharge || 0) + tower.effectiveCadence / AUTHORITY_TICK_RATE;
      const stored = Math.max(0, Math.floor(tower.fireCharge) - 1);
      const emergency = hasResearch(this.state,23) && target && Math.hypot(target.x - this.map.base.x, target.y - this.map.base.y) <= 180;
      const ready = this.state.runTick >= (tower.researchNextStoredTick || 0);
      if (tower.fireCharge >= 1 && ready) {
        tower.researchCharged = hasResearch(this.state,24) && stored > 0
          && tower.researchIdleSince != null && this.state.runTick - tower.researchIdleSince >= 300;
        const attack = createAttackSnapshot(definition, tower, { range: tower.effectiveRange, cadencePerSecond: tower.effectiveCadence, createdTick: this.state.runTick });
        this.applyTowerAttackStats(tower, attack);
        const charge = tower.fireCharge;
        this.dispatchVolley(tower, attack);
        tower.researchCharged = false;
        if (tower.fireCharge < charge) {
          tower.researchIdleSince = null;
          tower.researchCycle = (tower.researchCycle || 0) + 1;
          tower.researchNextStoredTick = this.state.runTick + (stored > 0 ? (emergency ? 1 : 6) : 1);
          if (!definition.supportOnly && hasResearch(this.state,9) && tower.researchCycle % (hasResearch(this.state,28) ? 2 : 5) === 0) {
            const extra = secondaryAttack(attack, hasResearch(this.state,30) ? .4 : .25);
            extra.volley = { ...extra.volley, count: 1 };
            extra.research.split = hasResearch(this.state,29);
            extra.research.group = target ? { x: target.x, y: target.y } : null;
            this.state.research.pending.push({ tick: this.state.runTick + (hasResearch(this.state,30) ? 36 : 1), towerId: tower.id, attack: extra });
          }
        }
      }
      tower.fireCharge = Math.min(1 + magazine, tower.fireCharge);
    }
    const pending = this.state.research.pending;
    this.state.research.pending = [];
    for (const entry of pending) {
      if (entry.tick > this.state.runTick) { this.state.research.pending.push(entry); continue; }
      const tower = this.state.towers.find((item) => item.id === entry.towerId);
      if (!tower) continue;
      const charge = tower.fireCharge;
      this.dispatchVolley(tower, entry.attack);
      tower.fireCharge = charge;
    }
  }

  dispatchVolley(tower, attack) {
    if (fireReworked(this, tower, attack)) return;
    if (attack.delivery.type === 'projectile') this.fireProjectileVolley(tower, attack);
    else if (attack.delivery.type === 'hitscan') this.fireHitscan(tower, attack);
    else if (attack.delivery.type === 'persistent') this.firePersistent(tower, attack);
  }

  reserveVolleyTargets(tower, attack) {
    const targets = [];
    const count = Math.max(1, attack.volley?.count || 1);
    const targetSpacing = Math.max(0, attack.volley?.targetSpacing || 0);
    const excludedIds = new Set();
    for (let projectileIndex = 0; projectileIndex < count; projectileIndex += 1) {
      const target = this.researchTarget(tower, attack, excludedIds)
        || (targetSpacing > 0 ? this.researchTarget(tower, attack) : null);
      if (!target) break;
      const routing = attack.research?.ids.includes(27);
      if (!routing && !this.swarm.reserve(target.id, target.generation)) break;
      if (routing) {
        this.swarm.reservedById[target.id] = 1;
        const key = enemyKey(target);
        const damage = attack.effects.filter((effect) => effect.type === 'damage').reduce((sum,effect) => sum + effect.amount,0);
        this.researchReservations ||= new Map();
        this.researchReservations.set(key, (this.researchReservations.get(key) || 0) + damage);
      }
      targets.push(target);
      if (targetSpacing > 0) {
        for (const nearby of this.swarm.enemiesInCircle(target.x, target.y, targetSpacing)) excludedIds.add(nearby.id);
      }
    }
    return targets;
  }

  fireProjectileVolley(tower, attack) {
    let strikePoints = tower.strikePoint
      ? strikeImpactPoints(tower, attack, tower.strikePoint)
      : [];
    if (!tower.strikePoint && attack.research?.ids.includes(26) && supportsStrikePoint(attack)) {
      const target = this.researchTarget(tower, attack);
      if (target) {
        const index = this.swarm.indexById[target.id] * 4;
        const flight = Math.hypot(target.x - tower.x, target.y - tower.y) / attack.delivery.speed;
        const aim = { x: target.x + this.swarm.state[index + 2] * flight, y: target.y + this.swarm.state[index + 3] * flight };
        strikePoints = strikeImpactPoints(tower, attack, aim);
      }
    }
    const manualDetonation = strikePoints.length > 0;
    if (manualDetonation) {
      const activationRadius = Math.max(1, attack.geometry?.radius || attack.delivery?.collisionRadius || 1);
      const hasTargetNearPattern = strikePoints.some((point) => (
        this.swarm.enemiesInCircle(point.x, point.y, activationRadius).length > 0
      ));
      if (tower.strikePoint && !hasTargetNearPattern) return;
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
      const target = tower.strikePoint || this.researchTarget(tower, attack, pendingKilled);
      if (!target) break;
      const aimAngle = Math.atan2(target.y-tower.y,target.x-tower.x) + (tower.strikePoint ? (beamIndex-(beamCount-1)/2)*.12 : 0);
      const dx = Math.cos(aimAngle), dy = Math.sin(aimAngle), distance = 1;
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
    const target = tower.strikePoint || this.researchTarget(tower, attack);
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
      if (tower.strikePoint) field.baseAngle -= field.sweepDirection * field.sweepRadians * .5;
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
      if (field.nextPulseTick <= this.state.runTick
        || (field.kind === 'sweep_line' && this.state.runTick >= field.createdTick + field.durationTicks)) {
        field.nextPulseTick += field.pulseTicks;
        let pulseAttack = field.attack;
        let contact = field;
        if (field.kind === 'sweep_line') {
          const phase = Math.max(0, Math.min(1, (this.state.runTick - field.createdTick) / Math.max(1, field.durationTicks)));
          const previousPhase = field.lastSweepPhase ?? Math.max(0,
            (this.state.runTick - field.pulseTicks - field.createdTick) / Math.max(1, field.durationTicks));
          const fromAngle = field.baseAngle + (field.sweepDirection || 1) * field.sweepRadians * previousPhase;
          const angle = field.baseAngle + (field.sweepDirection || 1) * field.sweepRadians * phase;
          field.lastSweepPhase = phase;
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
            sweepPhase: phase,
            sweepFromAngle: fromAngle,
            sweepToAngle: angle
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
    const continuations = [];

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
      let target = projectile.researchStraight ? null : this.swarm.enemy(projectile.targetEnemyId, projectile.targetGeneration);
      if (target && pendingKilled.has(target.id)) target = null;
      if (!target && !projectile.researchStraight) {
        const replacement = projectile.attack.research?.ids.includes(8)
          ? this.swarm.findTarget(projectile.x, projectile.y, projectile.attack.range * 1.5, 'closest', pendingKilled)
            || this.swarm.findAnyUnreserved(projectile.x, projectile.y, pendingKilled)
          : this.swarm.findTarget(projectile.x, projectile.y, projectile.attack.range, 'closest', pendingKilled);
        if (replacement && this.swarm.reserve(replacement.id, replacement.generation)) {
          projectile.targetEnemyId = replacement.id;
          projectile.targetGeneration = replacement.generation;
          target = replacement;
          this.state.stats.retargets += 1;
        }
      }
      if (!target) {
        if ((projectile.contactsMade || 0) > 0 && !projectile.researchStraight) {
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
      let directionX = parallelLaunchActive
        ? projectile.launchDirectionX ?? projectile.vx / currentVelocityLength
        : target ? dx / distance : projectile.vx / currentVelocityLength;
      let directionY = parallelLaunchActive
        ? projectile.launchDirectionY ?? projectile.vy / currentVelocityLength
        : target ? dy / distance : projectile.vy / currentVelocityLength;
      if (!parallelLaunchActive && target && !projectile.researchStraight) {
        const turn = Math.min(1, .75 * (projectile.attack.research?.guidance || 1));
        const blendedX = projectile.vx / currentVelocityLength * (1 - turn) + directionX * turn;
        const blendedY = projectile.vy / currentVelocityLength * (1 - turn) + directionY * turn;
        const length = Math.hypot(blendedX, blendedY) || 1;
        directionX = blendedX / length; directionY = blendedY / length;
      }
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
        if (physicalBullet(projectile.attack) && !projectile.attack.research?.secondary
          && (projectile.attack.research?.ids.includes(13) || projectile.attack.research?.ids.includes(25))) {
          continuations.push({ projectile, collision });
          continue;
        }
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
    const resolution = plans.length ? this.resolvePlans(plans) : null;
    for (const { projectile, collision } of continuations) {
      const killed = resolution?.results.some((result) => result.attack === projectile.attack
        && result.kills.some((hit) => hit.id === collision.id && hit.generation === collision.generation));
      const ricochet = killed && projectile.attack.research.ids.includes(25);
      const through = projectile.attack.research.ids.includes(13);
      const target = ricochet ? this.swarm.enemiesInCircle(collision.x, collision.y, 80, new Set([collision.id]))[0] : null;
      if (!target && !through) { this.state.stats.shotsResolved++; continue; }
      const redirected = Boolean(target);
      const speed = Math.hypot(projectile.vx,projectile.vy) || 1;
      const dx = redirected ? target.x - collision.x : projectile.vx;
      const dy = redirected ? target.y - collision.y : projectile.vy;
      const length = Math.hypot(dx,dy) || 1;
      const clearance = Math.max(2, projectile.collisionRadius * 1.5);
      projectile.x = collision.x + dx / length * clearance;
      projectile.y = collision.y + dy / length * clearance;
      projectile.vx = dx / length * speed; projectile.vy = dy / length * speed;
      projectile.attack = secondaryAttack(projectile.attack, redirected ? .25 : .5);
      projectile.contactsRemaining = 1; projectile.contactsMade = 1;
      projectile.researchStraight = !redirected;
      projectile.targetEnemyId = target?.id || 0; projectile.targetGeneration = target?.generation || 0;
      if (target) this.swarm.reserve(target.id,target.generation);
      this.state.projectiles.push(projectile);
    }
  }

  resolvePlans(plans) {
    const sourceKillCounts = new Map(this.state.towers.map((tower) => [tower.id, tower.kills || 0]));
    const resolution = resolveAttackPlans(this.swarm, plans, {
      tick: this.state.runTick,
      forceFields: this.state.forceFields,
      nextFieldNumber: () => this.nextFieldNumber++,
      sourceKillCounts,
      research: this.state.research
    });
    this.state.stats.triggerEvents += resolution.processedTriggers;
    if (resolution.triggerOverflow) this.state.stats.triggerOverflows += 1;
    const extraPlans = [];
    for (const result of resolution.results) {
      this.recordAttackResult(result);
      extraPlans.push(...researchSecondaryPlans(this.state.research, this.swarm, result, this.state.runTick));
    }
    if (extraPlans.length) this.resolvePlans(extraPlans);
    const bondKillsBySource = new Map();
    for (const kill of resolution.bondKills) {
      if (!bondKillsBySource.has(kill.sourceTowerId)) bondKillsBySource.set(kill.sourceTowerId, []);
      bondKillsBySource.get(kill.sourceTowerId).push(kill);
    }
    for (const [sourceTowerId, kills] of bondKillsBySource) {
      const tower = this.state.towers.find((candidate) => candidate.id === sourceTowerId);
      this.recordAttackResult({
        attack: {
          sourceTowerId,
          sourceFormId: 'bond',
          sourceAreaId: tower?.areaId || null,
          ownerId: tower?.ownerId || null,
          rewardPerKill: tower ? this.towerStat(tower, 'killReward', this.towerDefinitions.bond.killReward) : 1,
          geometry: { type: 'bond' }
        },
        contact: kills[0],
        hits: kills,
        kills,
        controlTargets: [],
        createdFields: []
      });
    }
    return resolution;
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
    const hpPopped = damageFixed(result.hits.reduce((total, hit) => total + (hit.hpPopped ?? hit.damage ?? 0), 0));
    const rewardKey = `hp_credit:${result.attack.sourceAreaId || 'global'}`;
    const mills = (this.state.supportCounters[rewardKey] || 0) + Math.round(hpPopped * 1000);
    const paidHp = Math.floor(mills / 1000);
    this.state.supportCounters[rewardKey] = mills % 1000;
    const totalReward = paidHp * result.attack.rewardPerKill;
    this.state.stats.hpPopped = damageFixed((this.state.stats.hpPopped || 0) + hpPopped);
    const sourceTower = this.state.towers.find((tower) => tower.id === result.attack.sourceTowerId);
    if (sourceTower && hpPopped > 0) {
      sourceTower.hpPopped = damageFixed((sourceTower.hpPopped || 0) + hpPopped);
      sourceTower.lastDamageTick = this.state.runTick;
    }
    const attributedPlayerId = sourceTower?.ownerId || result.attack.ownerId || null;
    const contribution = attributedPlayerId ? this.state.contributionByPlayer[attributedPlayerId] : null;
    if (contribution) {
      contribution.hpPopped = damageFixed(contribution.hpPopped + hpPopped);
      contribution.controlApplications += result.controlTargets.reduce(
        (total, target) => total + Math.max(1, Math.floor(target.units || 1)),
        0
      );
    }
    if (totalReward > 0) this.distributeIncome(totalReward);
    const areaId = result.attack.sourceAreaId || sourceTower?.areaId;
    const mints = (this.networkSourcesByArea?.get(areaId) || []).filter((tower) => tower.definitionId === 'mint');
    if (mints.length && totalReward > 0) {
      const key = `mint:${areaId}`;
      const points = (this.state.supportCounters[key] || 0) + totalReward * (20 + mints.length - 1);
      const credits = Math.floor(points / 100);
      this.state.supportCounters[key] = points % 100;
      if (credits) {
        this.distributeIncome(credits);
        mints[0].bonusCredits = (mints[0].bonusCredits || 0) + credits;
        this.state.stats.bonusCredits += credits;
        const mintContribution = this.state.contributionByPlayer[mints[0].ownerId];
        if (mintContribution) mintContribution.supportCredits += credits;
      }
    }
    this.applyKillIncomeSupport(result.attack, paidHp);
    if (killCount < 1) return;
    this.state.stats.kills += killCount;
    if (sourceTower) {
      sourceTower.kills = Math.max(0, Math.floor(sourceTower.kills || 0)) + killCount;
      sourceTower.lastKillTick = this.state.runTick;
    }
    if (contribution) contribution.kills += killCount;
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
      const contribution = this.state.contributionByPlayer[tower.ownerId];
      if (contribution) contribution.supportCredits += credits;
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
    if (command.type === COMMAND.DISCONNECT) return this.disconnectPlayer(command, player);
    if (command.type === COMMAND.PLAYER_RENAME) return this.renamePlayer(command, player);
    if (command.type === COMMAND.SESSION_START) return this.startSession(command, player);
    if (command.type === COMMAND.DEV_TOOLS) return this.setDevTools(command, player);
    if (command.type === COMMAND.SESSION_RESTART) return this.restartSession(command);
    if (this.state.phase !== 'running') return this.reject(command, 'the run is defeated');
    if (command.type === COMMAND.RESEARCH_PURCHASE) this.purchaseResearch(command, player);
    else if (command.type === COMMAND.REACTOR_PURCHASE) this.purchaseReactor(command, player);
    else if (command.type === COMMAND.TOWER_PLACE) this.placeTower(command, player);
    else if (command.type === COMMAND.TOWER_EVOLVE) this.evolveTower(command, player);
    else if (command.type === COMMAND.TOWER_SELL) this.sellTower(command, player);
    else if (command.type === COMMAND.TOWER_ECHO_SOURCE_SET) this.setEchoSource(command, player);
    else if (command.type === COMMAND.TOWER_SOCKET_SET) this.setSocket(command, player);
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
      existing.connectionState = 'connected';
      delete existing.disconnectedTick;
      delete existing.reconnectDeadlineTick;
      if (this.state.phase === 'lobby') existing.eliminated = false;
      if (existing.eliminated) {
        existing.spectator = true;
        this.emit(EVENT.PLAYER_BECAME_SPECTATOR, { playerId: existing.id });
        return;
      }
      existing.spectator = false;
      this.emit(EVENT.PLAYER_RECONNECTED, { player: existing });
      return;
    }
    if (this.state.rosterLocked) return this.reject(command, 'run roster is locked');
    const playerId = `player_${this.state.players.length + 1}`;
    const player = {
      id: playerId,
      clientId: command.clientId,
      label: sanitizeLabel(command.payload.label),
      colorId: `player_${this.state.players.length % 4}`,
      connected: true,
      connectionState: 'connected',
      spectator: false,
      eliminated: false,
      joinedTick: this.state.tick
    };
    this.state.players.push(player);
    this.state.contributionByPlayer[playerId] = initialContribution();
    if (!this.state.hostPlayerId) this.state.hostPlayerId = playerId;
    this.emit(EVENT.PLAYER_JOINED, { player, hostPlayerId: this.state.hostPlayerId });
  }

  leave(command, player) {
    player.connected = false;
    player.connectionState = 'departed';
    player.disconnectedTick = this.state.tick;
    delete player.reconnectDeadlineTick;
    player.eliminated = true;
    player.spectator = true;
    this.emit(EVENT.PLAYER_LEFT, { playerId: player.id });
    if (this.state.hostPlayerId === player.id) {
      this.state.hostPlayerId = null;
    }
    this.emit(EVENT.PLAYER_DEPARTED, { playerId: player.id, reason: 'left' });
  }

  renamePlayer(command, player) {
    const label = sanitizeLabel(command.payload.label);
    if (!label) return this.reject(command, 'player name is invalid');
    player.label = label;
  }

  disconnectPlayer(command, player) {
    if (player.id === this.state.hostPlayerId) return this.leave(command, player);
    player.connected = false;
    player.connectionState = 'reconnecting';
    player.disconnectedTick = this.state.tick;
    player.reconnectDeadlineTick = this.state.tick + RECONNECT_WAIT_TICKS;
    this.emit(EVENT.PLAYER_DISCONNECTED, {
      playerId: player.id,
      reconnectDeadlineTick: player.reconnectDeadlineTick
    });
  }

  markPlayerDeparted(player) {
    if (!player || player.connectionState !== 'reconnecting') return false;
    player.connectionState = 'departed';
    player.eliminated = true;
    player.spectator = true;
    delete player.reconnectDeadlineTick;
    this.emit(EVENT.PLAYER_DEPARTED, { playerId: player.id, reason: 'timeout' });
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
      this.resetFreshRun(command.payload.mapId || this.map.id, command.payload.pace ?? DEFAULT_PACE, command.payload.randomRifts ?? this.state.randomRifts);
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

  restartSession(command) {
    if (this.state.phase === 'lobby') return this.reject(command, 'start the lobby instead of restarting it');
    if (this.connectedPlayers().length !== 1) return this.reject(command, 'multiplayer restart voting is not implemented');
    try {
      this.resetFreshRun(command.payload.mapId || this.map.id, command.payload.pace ?? DEFAULT_PACE, command.payload.randomRifts ?? this.state.randomRifts);
    } catch {
      return this.reject(command, 'selected map is unavailable');
    }
    this.state.runNumber += 1;
    this.state.phase = 'running';
    this.emit(EVENT.SESSION_RESTARTED, { runNumber: this.state.runNumber, seed: this.seed, mapId: this.map.id });
  }

  setDevTools(command, player) {
    if (player.id !== this.state.hostPlayerId) return this.reject(command, 'only the host may change dev tools');
    const { option, enabled, action } = command.payload;
    const options = ['infiniteMoney', 'infiniteHealth', 'paused', 'stopSpawns'];
    if (option && (!options.includes(option) || typeof enabled !== 'boolean')) return this.reject(command, 'invalid dev option');
    if (action && !['clearEnemies', 'healBase'].includes(action)) return this.reject(command, 'invalid dev action');
    this.state.dev ||= {};
    if (option) this.state.dev[option] = enabled;
    if (action === 'clearEnemies') {
      this.swarm.clearEnemies();
      this.state.projectiles = [];
    delete this.state.turretRework;
      this.state.attackFields = [];
      this.state.forceFields = [];
      const spawn = this.spawnSettings();
      this.state.swarm = this.swarmSummary(this.state.dev.stopSpawns ? 0 : spawn.rate, spawn.sources, spawn.meanHp ?? spawn.enemyHp, spawn.surge || null);
    }
    if (action === 'healBase' || (option === 'infiniteHealth' && enabled)) {
      this.state.base.lives = this.state.base.maxLives || this.startingLives;
      if (this.state.phase === 'defeated') this.state.phase = 'running';
    }
  }

  purchaseResearch(command, player) {
    const tower = this.state.towers.find((item) => item.id === command.payload.towerId);
    if (!tower || tower.definitionId !== 'arsenal') return this.reject(command, 'an arsenal is required to research');
    const node = researchNode(command.payload.researchId);
    if (!node || !arsenalChoices(this.state).some((item) => item.id === node.id)) return this.reject(command, 'unlock the parent research first');
    const owned = hasResearch(this.state, node.id);
    if (owned) return this.reject(command, 'research already owned');
    const cost = node.cost;
    if (command.payload.expectedCost !== cost) return this.reject(command, 'research changed; refresh the price');
    const economy = this.state.teamEconomy;
    if (!this.state.dev?.infiniteMoney && economy.credits < cost) return this.reject(command, 'insufficient research credits');
    if (!this.state.dev?.infiniteMoney) economy.credits -= cost;
    economy.totalSpent += cost;
    this.state.contributionByPlayer[player.id].creditsSpent += cost;
    if (!owned) this.state.research.unlocked.push(node.id);
    tower.researchPath = []; // Legacy physical-station paths are no longer used.
    this.modifierCache = null;
    this.emit(EVENT.RESEARCH_PURCHASED, { towerId: tower.id, researchId: node.id, cost, label: node.label });
  }

  purchaseReactor(command, player) {
    const tower = this.state.towers.find((item) => item.id === command.payload.towerId);
    if (!tower || tower.definitionId !== 'reactor') return this.reject(command, 'a reactor is required to upgrade');
    const count = command.payload.count === undefined ? 1 : command.payload.count;
    const quote = reactorBatchQuote(this.state, command.payload.categoryId, count);
    if (!quote || quote.count !== count || command.payload.expectedRank !== quote.rank || command.payload.expectedCost !== quote.cost) return this.reject(command, 'reactor rank or price changed');
    const economy = this.state.teamEconomy;
    if (!this.state.dev?.infiniteMoney && economy.credits < quote.cost) return this.reject(command, 'insufficient reactor credits');
    if (!this.state.dev?.infiniteMoney) economy.credits -= quote.cost;
    economy.totalSpent += quote.cost;
    this.state.contributionByPlayer[player.id].creditsSpent += quote.cost;
    this.state.research.reactor[quote.id] = quote.targetRank;
    if (quote.id === 'lives') {
      this.state.base.maxLives = this.startingLives + quote.targetRank * 5;
      this.state.base.lives = Math.min(this.state.base.maxLives, this.state.base.lives + quote.count * 5);
    }
    this.modifierCache = null;
    this.emit(EVENT.REACTOR_PURCHASED, { towerId: tower.id, categoryId: quote.id, rank: quote.targetRank, count: quote.count, cost: quote.cost });
  }

  placeTower(command, player) {
    const { definitionId, x, y } = command.payload;
    const definition = this.towerDefinitions[definitionId];
    if (!definition) return this.reject(command, 'tower definition is unavailable');
    const build = towerBuildQuote(this.towerDefinitions, definitionId);
    if (!build) return this.reject(command, 'tower form cannot be built directly');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.reject(command, 'tower position is invalid');
    const socket = this.state.towers.find((candidate) => {
      const point = socketPoint(this.state, this.map, candidate);
      return point && Math.hypot(point.x - x, point.y - y) <= 10;
    });
    if (socket && (definitionId === 'hardpoint'
      || this.state.towers.some((candidate) => candidate.socketHostId === socket.id))) return this.reject(command, 'socket unavailable');
    const point = socket ? socketPoint(this.state, this.map, socket) : { x, y };
    const areaId = socket?.areaId || findDefenseAreaAt(this.map, x, y);
    if (!areaId) return this.reject(command, 'tower must be inside a defense area');
    if (!towerPlacementClear(this.state.towers, point.x, point.y)) return this.reject(command, 'towers need 24 units of clearance');
    const cost = purchaseCost(this.state, areaId, build.cost, { placement: true, escalatableCost: build.rootCost });
    const economy = this.state.teamEconomy;
    if (!this.state.dev?.infiniteMoney && economy.credits < cost) return this.reject(command, 'insufficient credits');
    if (!this.state.dev?.infiniteMoney) economy.credits -= cost;
    economy.totalSpent += cost;
    const contribution = this.state.contributionByPlayer[player.id];
    contribution.creditsSpent += cost;
    contribution.towersCreated += 1;
    const tower = this.normalizeTower({
      id: `tower_${this.nextTowerNumber++}`,
      ownerId: player.id,
      definitionId,
      x: point.x,
      y: point.y,
      socketHostId: socket?.id || null,
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
    const current = this.towerDefinitions[tower.definitionId];
    const next = this.towerDefinitions[command.payload.definitionId];
    if (!current || !next || !current.evolutionChoices?.includes(next.id) || next.evolvesFrom !== current.id) {
      return this.reject(command, 'tower form is not a valid replacement');
    }
    const economy = this.state.teamEconomy;
    if (tower.socketHostId && next.id === 'hardpoint') return this.reject(command, 'hardpoints cannot nest');
    const cost = purchaseCost(this.state, tower.areaId, next.evolutionCost);
    if (!this.state.dev?.infiniteMoney && economy.credits < cost) return this.reject(command, 'insufficient credits');
    if (!this.state.dev?.infiniteMoney) economy.credits -= cost;
    economy.totalSpent += cost;
    this.state.contributionByPlayer[player.id].creditsSpent += cost;
    const previousDefinitionId = tower.definitionId;
    tower.definitionId = next.id;
    if (next.supportOnly || next.networkNode) {
      const harmful = (attack) => attack?.effects?.some((effect) => effect.type === 'damage');
      this.state.projectiles = this.state.projectiles.filter((shot) => {
        if (shot.attack?.sourceTowerId !== tower.id || !harmful(shot.attack)) return true;
        this.swarm.release(shot.targetEnemyId, shot.targetGeneration);
        return false;
      });
      this.state.attackFields = this.state.attackFields.filter((field) => field.attack?.sourceTowerId !== tower.id || !harmful(field.attack));
      this.state.research.pending = this.state.research.pending.filter((entry) => entry.towerId !== tower.id);
    }
    tower.totalInvestment += cost;
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
      actorPlayerId: player.id,
      cost,
      credits: economy.credits
    });
  }

  sellTower(command, player) {
    const towerIndex = this.state.towers.findIndex((tower) => tower.id === command.payload.towerId);
    if (towerIndex < 0) return this.reject(command, 'tower does not exist');
    const tower = this.state.towers[towerIndex];
    if (this.state.towers.some((candidate) => candidate.socketHostId === tower.id)) return this.reject(command, 'sell the socket tower first');
    const refund = saleRefund(this.state, tower);
    const economy = this.state.teamEconomy;
    economy.credits += refund;
    this.state.contributionByPlayer[player.id].towersSold += 1;
    this.state.towers.splice(towerIndex, 1);
    this.modifierCache = null;
    this.emit(EVENT.TOWER_SOLD, { towerId: tower.id, ownerId: tower.ownerId, actorPlayerId: player.id, refund, credits: economy.credits });
  }

  setEchoSource(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower || tower.definitionId !== 'echo') return this.reject(command, 'echo unavailable');
    if (!controlSource(this.state, tower, command.payload.sourceTowerId)) return this.reject(command, 'select a connected control turret');
    tower.echoSourceId = command.payload.sourceTowerId;
    tower.controlGeometry = null;
    tower.controlReadyTick = this.state.runTick + AUTHORITY_TICK_RATE;
    tower.strikePoint = null;
    tower.fireCharge = 0;
    this.syncTowerStats();
  }

  setSocket(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    const fraction = command.payload.fraction;
    if (!tower || !socketPoint(this.state, this.map, tower)) return this.reject(command, 'linked hardpoint required');
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return this.reject(command, 'socket must lie on the relay line');
    if (this.state.towers.some((candidate) => candidate.socketHostId === tower.id)) return this.reject(command, 'sell the socket tower first');
    tower.socketFraction = fraction;
  }

  setTowerTargeting(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    const allowedModes = [...(this.weaponDefinition(tower)?.targetingModes || ['closest']), ...(hasResearch(this.state,16) ? ['execution'] : []), ...(hasResearch(this.state,36) ? ['highest_hp'] : [])];
    if (!allowedModes.includes(command.payload.mode)) return this.reject(command, 'targeting mode is unavailable');
    tower.targetingMode = command.payload.mode;
    this.emit(EVENT.TOWER_TARGETING_CHANGED, { towerId: tower.id, mode: tower.targetingMode });
  }

  setTowerStrikePoint(command, player) {
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'tower does not exist');
    const definition = this.weaponDefinition(tower);
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
    const definition = this.weaponDefinition(tower);
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
    const definition = this.weaponDefinition(tower);
    if ((tower.socketHostId && definition.id === 'hardpoint') || this.state.towers.some((candidate) => candidate.socketHostId === tower.id)) return this.reject(command, 'sell the socket tower first');
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
    if (this.state.towers.some((candidate) => candidate.socketHostId === tower.id)) return this.reject(command, 'sell the socket tower first');
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
    delete this.state.turretRework;
    this.state.attackFields = [];
    this.state.forceFields = [];
    this.state.base.lives = this.startingLives;
    if (resetCounters) {
      this.state.runTick = 0;
      this.swarm.resetRunCounters();
      this.state.stats = initialStats();
      this.state.supportCounters = {};
    this.state.research = freshResearch();
      for (const tower of this.state.towers) {
        tower.kills = 0;
        tower.lastKillTick = 0;
        tower.hpPopped = 0;
        tower.lastDamageTick = 0;
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
    this.emit(EVENT.TOWER_EVOLVED, { towerId: tower.id, previousDefinitionId, tower, cost: 0, credits: this.state.teamEconomy.credits, test: true });
  }

  moveTestTower(command, player) {
    if (!this.requireTest(command)) return;
    const tower = this.state.towers.find((candidate) => candidate.id === command.payload.towerId);
    if (!tower) return this.reject(command, 'test tower does not exist');
    if (tower.ownerId !== player.id) return this.reject(command, 'only the tower owner may move it');
    if (tower.socketHostId || this.state.towers.some((candidate) => candidate.socketHostId === tower.id)) return this.reject(command, 'sell the socket tower first');
    const { x, y } = command.payload;
    const areaId = findDefenseAreaAt(this.map, x, y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !areaId) return this.reject(command, 'test tower must stay inside a defense area');
    if (!towerPlacementClear(this.state.towers, Math.round(x), Math.round(y), tower.id)) return this.reject(command, 'towers need 24 units of clearance');
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
    if (!this.connectedPlayers().length) {
      this.state.stats.unclaimedCredits += totalCredits;
      return;
    }
    this.state.teamEconomy.credits += totalCredits;
    this.state.teamEconomy.totalEarned += totalCredits;
    this.emit(EVENT.INCOME_DISTRIBUTED, { totalCredits, credits: this.state.teamEconomy.credits });
  }

  recordBreaches(count, invincible = false) {
    const livesLost = invincible || this.state.dev?.infiniteHealth ? 0 : Math.min(this.state.base.lives, count);
    this.state.base.lives -= livesLost;
    this.state.stats.breaches += count;
    if (this.state.base.lives === 0) this.state.phase = 'defeated';
    this.emit(EVENT.BASE_BREACHED, { count, livesLost, lives: this.state.base.lives, totalBreaches: this.state.stats.breaches });
  }

  presentation() {
    const alpha = this.state.phase === 'running' && !this.state.test?.paused && !this.state.dev?.paused ? this.accumulatorMs / AUTHORITY_TICK_MS : 0;
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
        lastSequenceByClient: [...this.lastSequenceByClient.entries()],
        pendingCommands: cloneSerializable(this.pendingCommands)
      },
      state: this.snapshot(),
      swarm: this.swarm.exportCorrection()
    };
  }

  applyCorrectionSnapshot(correction) {
    if (!correction || ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, PROTOCOL_VERSION].includes(correction.protocolVersion) || !correction.mapId) {
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
      this.bindMap(correctionMap.id, Boolean(correction.state?.randomRifts));
    } catch {
      throw new Error('session correction map is incompatible');
    }
    this.state = cloneSerializable(correction.state);
    this.state.protocolVersion = PROTOCOL_VERSION;
    if (!this.state.teamEconomy) {
      const wallets = Object.values(this.state.economyByPlayer || {});
      this.state.teamEconomy = {
        credits: wallets.reduce((sum, wallet) => sum + Math.max(0, Math.floor(wallet?.credits || 0)), 0),
        totalEarned: wallets.reduce((sum, wallet) => sum + Math.max(0, Math.floor(wallet?.totalEarned || 0)), 0),
        totalSpent: wallets.reduce((sum, wallet) => sum + Math.max(0, Math.floor(wallet?.totalSpent || 0)), 0)
      };
    }
    delete this.state.economyByPlayer;
    this.state.contributionByPlayer ||= {};
    for (let index = 0; index < (this.state.players || []).length; index += 1) {
      const player = this.state.players[index];
      player.colorId ||= `player_${index % 4}`;
      player.connectionState ||= player.connected ? 'connected' : player.eliminated ? 'departed' : 'reconnecting';
      this.state.contributionByPlayer[player.id] = {
        ...initialContribution(),
        ...(this.state.contributionByPlayer[player.id] || {})
      };
    }
    this.state.research = { ...freshResearch(), ...(this.state.research || {}) };
    this.state.relayNetwork = { ...freshRelayNetwork(), ...(this.state.relayNetwork || {}) };
    this.state.pace = normalizePace(this.state.pace ?? DEFAULT_PACE);
    this.state.randomRifts = Boolean(this.state.randomRifts);
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
    if (correction.protocolVersion < 18) {
      const oldSupport = (attack) => this.towerDefinitions[attack?.sourceFormId]?.supportOnly
        || this.state.towers.some((t) => t.id === attack?.sourceTowerId && t.definitionId === 'echo');
      this.state.projectiles = this.state.projectiles.filter((p) => {
        if (!oldSupport(p.attack)) return true;
        this.swarm.release(p.targetEnemyId, p.targetGeneration);
        return false;
      });
      this.state.attackFields = this.state.attackFields.filter((f) => !oldSupport(f.attack));
      this.state.research.pending = this.state.research.pending.filter((p) => !oldSupport(p.attack));
      this.state.forceFields = [];
      for (let id = 1; id < this.swarm.nextFreshId; id++) this.swarm.clearBond(id);
      delete this.state.turretRework;
    }
    if (correction.protocolVersion < 14) {
      this.state.forceFields = (this.state.forceFields || []).filter((field) => !field.persistentControl && field.sourceFormId !== 'orbit');
      this.syncControlFields();
    }
    const activeSpawnPoints = Math.max(0, Math.floor(this.state.swarm?.activeSpawnPoints || 0));
    this.state.swarm = this.swarmSummary(
      Number(this.state.swarm?.spawnRatePerSecond) || 0,
      { length: activeSpawnPoints },
      this.state.swarm?.meanHp || 1,
      // surges are derived from the seed and tick, so a save without one simply recomputes
      this.state.test ? null : surgeScheduleAt(this.map, threatTickAt(this.state.runTick, this.state.pace), this.seed, AUTHORITY_TICK_RATE)
    );
    const metadata = correction.authority || {};
    this.eventCounter = metadata.eventCounter || this.eventCounter;
    this.nextTowerNumber = metadata.nextTowerNumber
      || this.state.towers.reduce((maximum, tower) => Math.max(maximum, Number(tower.id.split('_').at(-1)) || 0), 0) + 1;
    this.nextProjectileNumber = metadata.nextProjectileNumber
      || this.state.projectiles.reduce((maximum, projectile) => Math.max(maximum, Number(projectile.id.split('_').at(-1)) || 0), 0) + 1;
    this.nextFieldNumber = metadata.nextFieldNumber || 1;
    this.nextAttackFieldNumber = metadata.nextAttackFieldNumber || 1;
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
