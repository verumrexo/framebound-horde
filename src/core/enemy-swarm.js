import { damageFixed } from './research-combat.js';
import { AUTHORITY_TICK_RATE } from './protocol.js';
import { defenseAreaBounds, defenseAreaField } from './world-config.js';

const STATE_STRIDE = 4;
const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const GRID_CELL_SIZE = 64;
const CROWD_CELL_SIZE = 24;
const CROWD_PRESSURE_STRENGTH = 18;
const CROWD_PRESSURE_LIMIT = 52;
const CROWD_FLOW_WEIGHT = 0.22;
const APPROACH_SPREAD = 320;
const APPROACH_FADE_DISTANCE = 360;
const OBSTACLE_INFLUENCE = 0.62;
const OBSTACLE_RELEASE = 0.82;
const PACKET_COMPRESSION_START = 20000;
const PACKET_TRIPLE_START = 22500;
const PACKET_QUAD_START = 24000;
export const SWARM_RECORD_BUDGET = 25000;
const SIN_LUT_SIZE = 2048;
const SIN_LUT_MASK = SIN_LUT_SIZE - 1;
const SIN_LUT = new Float32Array(SIN_LUT_SIZE);
for (let index = 0; index < SIN_LUT_SIZE; index += 1) SIN_LUT[index] = Math.sin(index / SIN_LUT_SIZE * Math.PI * 2);

export const STATUS_MARKER = Object.freeze({
  none: 0,
  slow: 1,
  burn: 2,
  mark: 3,
  recall: 3,
  stun: 4,
  stasis: 4,
  bond: 5
});

// Identity-indexed control state survives packed-record swaps and peer corrections.
const CONTROL_ID_TABLES = Object.freeze({
  recallUsedById: Uint8Array,
  breakerCycleById: Uint32Array,
  bondPartnerById: Uint32Array,
  bondGenerationById: Uint32Array,
  bondUntilById: Uint32Array,
  bondSourceById: Uint32Array,
  bondUnitsById: Float32Array
});
const BOND_TABLES = Object.freeze([
  'bondPartnerById', 'bondGenerationById', 'bondUntilById', 'bondSourceById', 'bondUnitsById'
]);
const CONTROL_ID_NAMES = Object.freeze(Object.keys(CONTROL_ID_TABLES));

// Sum = 16. Light bodies bank HP for interleaved medium/heavy bodies; every complete
// cycle spends exactly its accrued budget (apart from the retained fractional HP).
const HP_MIX_WEIGHTS = Object.freeze([0, 0.5, 0, 1, 0, 2, 0.5, 0, 4, 0.5, 1, 0, 2, 0, 0.5, 4]);

function hash32(value) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function segmentPointDistanceSquared(x1, y1, x2, y2, pointX, pointY) {
  const segmentX = x2 - x1;
  const segmentY = y2 - y1;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const projection = lengthSquared > 0
    ? ((pointX - x1) * segmentX + (pointY - y1) * segmentY) / lengthSquared
    : 0;
  const travel = Math.max(0, Math.min(1, projection));
  const dx = pointX - (x1 + segmentX * travel);
  const dy = pointY - (y1 + segmentY * travel);
  return dx * dx + dy * dy;
}

function growTypedArray(current, Constructor, length, fillValue = null) {
  const next = new Constructor(length);
  if (fillValue !== null) next.fill(fillValue);
  if (current) next.set(current.subarray(0, Math.min(current.length, next.length)));
  return next;
}

export class EnemySwarm {
  constructor({ seed, initialCapacity = 4096, enemyHp = 1, map }) {
    if (!map) throw new Error('enemy swarm requires a map definition');
    this.seed = seed >>> 0;
    this.randomState = this.seed || 0x6d2b79f5;
    this.map = map;
    this.base = map.base;
    this.defaultEnemyHp = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(enemyHp)));
    this.capacity = 0;
    this.count = 0;
    this.activeUnitCount = 0;
    this.nextFreshId = 1;
    this.freeCount = 0;
    this.tickNumber = 0;
    this.spawnAccumulator = 0;
    this.spawnHpAccumulator = 0;
    this.spawnMixCursor = 0;
    this.spawnMixFraction = 0;
    this.surgeAccumulator = 0;
    this.spawnSourceCursor = 0;
    this.spawnedTotal = 0;
    this.slowedCount = 0;
    this.lastChecksum = '00000000';
    this.resolveScratch = new Float64Array(5);
    this.bondSourceIds = [''];
    this.bondSourceIndex = new Map();
    this.defenseAreas = map.defenseAreas;

    this.gridLeft = map.bounds.left;
    this.gridTop = map.bounds.top;
    this.gridRight = map.bounds.right;
    this.gridBottom = map.bounds.bottom;
    this.gridColumns = Math.max(1, Math.ceil((this.gridRight - this.gridLeft) / GRID_CELL_SIZE));
    this.gridRows = Math.max(1, Math.ceil((this.gridBottom - this.gridTop) / GRID_CELL_SIZE));
    this.gridCellCount = this.gridColumns * this.gridRows;
    this.bucketHead = new Int32Array(this.gridCellCount);
    this.density = new Uint32Array(this.gridCellCount);
    this.areaIndicesByCell = Array.from({ length: this.gridCellCount }, () => []);
    this.forceFieldIndicesByCell = Array.from({ length: this.gridCellCount }, () => []);
    for (let areaIndex = 0; areaIndex < this.defenseAreas.length; areaIndex += 1) {
      const area = this.defenseAreas[areaIndex];
      const areaBounds = defenseAreaBounds(area, 6, 1.72);
      const bounds = this.cellBounds(areaBounds.left, areaBounds.top, areaBounds.right, areaBounds.bottom);
      for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
        for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
          this.areaIndicesByCell[row * this.gridColumns + column].push(areaIndex);
        }
      }
    }

    this.crowdColumns = Math.max(1, Math.ceil((this.gridRight - this.gridLeft) / CROWD_CELL_SIZE));
    this.crowdRows = Math.max(1, Math.ceil((this.gridBottom - this.gridTop) / CROWD_CELL_SIZE));
    this.crowdCellCount = this.crowdColumns * this.crowdRows;
    this.crowdMass = new Uint32Array(this.crowdCellCount);
    this.crowdMomentumX = new Float32Array(this.crowdCellCount);
    this.crowdMomentumY = new Float32Array(this.crowdCellCount);
    this.crowdDensity = new Float32Array(this.crowdCellCount);
    this.crowdVelocityX = new Float32Array(this.crowdCellCount);
    this.crowdVelocityY = new Float32Array(this.crowdCellCount);
    this.crowdPressureX = new Float32Array(this.crowdCellCount);
    this.crowdPressureY = new Float32Array(this.crowdCellCount);
    this.crowdSampleScratch = new Float64Array(4);
    this.steeringScratch = new Float64Array(2);

    this.ensureCapacity(Math.max(64, initialCapacity));
    this.rebuildSpatialIndex();
    this.updateChecksum();
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return false;
    let nextCapacity = Math.max(64, this.capacity || 64);
    while (nextCapacity < required) nextCapacity *= 2;
    this.state = growTypedArray(this.state, Float32Array, nextCapacity * STATE_STRIDE);
    this.idByIndex = growTypedArray(this.idByIndex, Uint32Array, nextCapacity);
    this.indexById = growTypedArray(this.indexById, Int32Array, nextCapacity + 1, -1);
    this.generationById = growTypedArray(this.generationById, Uint32Array, nextCapacity + 1);
    this.reservedById = growTypedArray(this.reservedById, Uint8Array, nextCapacity + 1);
    this.hpById = growTypedArray(this.hpById, Float64Array, nextCapacity + 1);
    this.maxHpById = growTypedArray(this.maxHpById, Float64Array, nextCapacity + 1);
    this.slowUntilById = growTypedArray(this.slowUntilById, Uint32Array, nextCapacity + 1);
    this.slowFactorById = growTypedArray(this.slowFactorById, Float32Array, nextCapacity + 1, 1);
    this.stasisUntilById = growTypedArray(this.stasisUntilById, Uint32Array, nextCapacity + 1);
    this.recallDueById = growTypedArray(this.recallDueById, Uint32Array, nextCapacity + 1);
    for (const [name, Constructor] of Object.entries(CONTROL_ID_TABLES)) {
      this[name] = growTypedArray(this[name], Constructor, nextCapacity + 1);
    }
    this.bondCandidateIds = growTypedArray(this.bondCandidateIds, Uint32Array, nextCapacity);
    this.recallXById = growTypedArray(this.recallXById, Float32Array, nextCapacity + 1);
    this.recallYById = growTypedArray(this.recallYById, Float32Array, nextCapacity + 1);
    this.statusCodeById = growTypedArray(this.statusCodeById, Uint8Array, nextCapacity + 1);
    this.speedById = growTypedArray(this.speedById, Uint8Array, nextCapacity + 1);
    this.obstacleAreaById = growTypedArray(this.obstacleAreaById, Uint16Array, nextCapacity + 1);
    this.obstacleSideById = growTypedArray(this.obstacleSideById, Int8Array, nextCapacity + 1);
    this.statusByIndex = growTypedArray(this.statusByIndex, Float32Array, nextCapacity);
    this.unitsByIndex = growTypedArray(this.unitsByIndex, Float32Array, nextCapacity);
    this.freeIds = growTypedArray(this.freeIds, Uint32Array, nextCapacity);
    this.bucketNext = growTypedArray(this.bucketNext, Int32Array, nextCapacity, -1);
    this.breachIds = growTypedArray(this.breachIds, Uint32Array, nextCapacity);
    this.breachGenerations = growTypedArray(this.breachGenerations, Uint32Array, nextCapacity);
    this.capacity = nextCapacity;
    return true;
  }

  random() {
    let value = this.randomState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 4294967296;
  }

  allocateId() {
    if (this.freeCount > 0) return this.freeIds[--this.freeCount];
    const id = this.nextFreshId++;
    this.ensureCapacity(id);
    return id;
  }

  selectSpawnSource(sources) {
    let totalWeight = 0;
    for (const candidate of sources) totalWeight += Math.max(0, candidate.weight || 1);
    let selection = this.random() * Math.max(1, totalWeight);
    let source = sources.at(-1);
    for (const candidate of sources) {
      selection -= Math.max(0, candidate.weight || 1);
      if (selection <= 0) {
        source = candidate;
        break;
      }
    }
    return source;
  }

  packetSizeForPopulation(enemyHp) {
    if (enemyHp !== 1 || this.count < PACKET_COMPRESSION_START) return 1;
    if (this.count < PACKET_TRIPLE_START) return 2;
    if (this.count < PACKET_QUAD_START) return 3;
    return 4;
  }

  findPacketMergeIndex(x, y, enemyHp) {
    const centerColumn = Math.max(0, Math.min(this.gridColumns - 1, Math.floor((x - this.gridLeft) / GRID_CELL_SIZE)));
    const centerRow = Math.max(0, Math.min(this.gridRows - 1, Math.floor((y - this.gridTop) / GRID_CELL_SIZE)));
    const maximumRing = Math.max(this.gridColumns, this.gridRows);
    for (let ring = 0; ring < maximumRing; ring += 1) {
      let bestIndex = -1;
      let bestUnits = Infinity;
      let bestDistanceSquared = Infinity;
      let bestId = Infinity;
      const minimumColumn = Math.max(0, centerColumn - ring);
      const maximumColumn = Math.min(this.gridColumns - 1, centerColumn + ring);
      const minimumRow = Math.max(0, centerRow - ring);
      const maximumRow = Math.min(this.gridRows - 1, centerRow + ring);
      for (let row = minimumRow; row <= maximumRow; row += 1) {
        for (let column = minimumColumn; column <= maximumColumn; column += 1) {
          if (ring > 0 && row !== minimumRow && row !== maximumRow && column !== minimumColumn && column !== maximumColumn) continue;
          let index = this.bucketHead[row * this.gridColumns + column];
          while (index >= 0) {
            const id = this.idByIndex[index];
            if (this.maxHpById[id] === enemyHp) {
              const offset = index * STATE_STRIDE;
              const dx = this.state[offset + X] - x;
              const dy = this.state[offset + Y] - y;
              const distanceSquared = dx * dx + dy * dy;
              const units = this.unitsByIndex[index];
              if (units < bestUnits
                || (units === bestUnits && (distanceSquared < bestDistanceSquared
                  || (distanceSquared === bestDistanceSquared && id < bestId)))) {
                bestIndex = index;
                bestUnits = units;
                bestDistanceSquared = distanceSquared;
                bestId = id;
              }
            }
            index = this.bucketNext[index];
          }
        }
      }
      if (bestIndex >= 0) return bestIndex;
    }
    return -1;
  }

  mergeSpawnUnits(source, unitCount, enemyHp) {
    const x = source.x + (this.random() - 0.5) * source.spreadX * 2;
    const y = Math.min(this.map.bounds.bottom - 2, source.y + (this.random() - 0.5) * source.spreadY * 2);
    this.random();
    const index = this.findPacketMergeIndex(x, y, enemyHp);
    if (index < 0) return false;
    this.unitsByIndex[index] += unitCount;
    this.activeUnitCount += unitCount;
    this.spawnedTotal += unitCount;
    if (this.slowUntilById[this.idByIndex[index]] > this.tickNumber) this.slowedCount += unitCount;
    const offset = index * STATE_STRIDE;
    this.density[this.cellIndex(this.state[offset + X], this.state[offset + Y])] += unitCount;
    return true;
  }

  spawnAtRate(ratePerSecond, sources, enemyHp = this.defaultEnemyHp, meanHp = null) {
    if (!sources?.length || !Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return 0;
    this.spawnAccumulator += ratePerSecond / AUTHORITY_TICK_RATE;
    const spawnCount = Math.floor(this.spawnAccumulator);
    this.spawnAccumulator -= spawnCount;
    let remaining = spawnCount;
    const mergedUnitsBySource = new Map();
    while (remaining > 0) {
      if (meanHp !== null) {
        enemyHp = this.nextMixedHp(meanHp);
      }
      const packetUnits = meanHp !== null ? 1 : Math.min(remaining, this.packetSizeForPopulation(enemyHp));
      const source = this.selectSpawnSource(sources);
      this.spawnSourceCursor = (this.spawnSourceCursor + packetUnits) >>> 0;
      if (meanHp === null && enemyHp === 1 && this.count >= SWARM_RECORD_BUDGET) {
        mergedUnitsBySource.set(source, (mergedUnitsBySource.get(source) || 0) + packetUnits);
      } else {
        this.spawnOne(source, enemyHp, packetUnits);
      }
      remaining -= packetUnits;
    }
    for (const [source, unitCount] of mergedUnitsBySource) {
      if (!this.mergeSpawnUnits(source, unitCount, enemyHp)) this.spawnOne(source, enemyHp, unitCount);
    }
    return spawnCount + this.spawnSurgeStream(sources);
  }

  nextMixedHp(meanHp) {
    this.spawnHpAccumulator += meanHp;
    const lightHp = Math.max(1, Math.floor(meanHp * 0.4));
    this.spawnMixFraction += (meanHp - lightHp) * HP_MIX_WEIGHTS[this.spawnMixCursor];
    const extraHp = Math.floor(this.spawnMixFraction + 1e-9);
    this.spawnMixFraction = Math.max(0, this.spawnMixFraction - extraHp);
    this.spawnMixCursor = (this.spawnMixCursor + 1) % HP_MIX_WEIGHTS.length;
    const available = Math.floor(this.spawnHpAccumulator + 1e-9);
    const hp = Math.max(1, this.spawnMixCursor === 0 ? available : Math.min(available, lightHp + extraHp));
    this.spawnHpAccumulator = Math.max(0, this.spawnHpAccumulator - hp);
    if (this.spawnMixCursor === 0) this.spawnMixFraction = 0;
    return hp;
  }

  // Surge rifts add a separate heavier stream on top of the ordinary budget. The stream
  // keeps its own fractional accumulator so the base cadence is untouched, and each body
  // is dealt to a hot rift in proportion to that rift's extra rate.
  spawnSurgeStream(sources) {
    const hot = sources.filter((source) => Number.isFinite(source.extraRatePerSecond) && source.extraRatePerSecond > 0);
    if (!hot.length) {
      this.surgeAccumulator = 0;
      return 0;
    }
    let totalRate = 0;
    for (const source of hot) totalRate += source.extraRatePerSecond;
    this.surgeAccumulator += totalRate / AUTHORITY_TICK_RATE;
    const spawnCount = Math.floor(this.surgeAccumulator);
    this.surgeAccumulator -= spawnCount;
    const weighted = hot.map((source) => ({ ...source, weight: source.extraRatePerSecond }));
    for (let index = 0; index < spawnCount; index += 1) {
      const source = this.selectSpawnSource(weighted);
      this.spawnSourceCursor = (this.spawnSourceCursor + 1) >>> 0;
      this.spawnOne(source, Math.max(1, Math.round(source.extraHp || 1)), 1);
    }
    return spawnCount;
  }

  spawnOne(source, enemyHp = this.defaultEnemyHp, unitCount = 1) {
    this.ensureCapacity(this.count + 1);
    const id = this.allocateId();
    const generation = (this.generationById[id] + 1) >>> 0 || 1;
    const hp = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(enemyHp)));
    const units = Math.max(1, Math.floor(unitCount));
    this.generationById[id] = generation;
    this.reservedById[id] = 0;
    this.hpById[id] = hp;
    this.maxHpById[id] = hp;
    this.slowUntilById[id] = 0;
    this.slowFactorById[id] = 1;
    this.stasisUntilById[id] = 0;
    this.recallDueById[id] = 0;
    for (const name of CONTROL_ID_NAMES) this[name][id] = 0;
    this.recallXById[id] = 0;
    this.recallYById[id] = 0;
    this.statusCodeById[id] = STATUS_MARKER.none;
    this.obstacleAreaById[id] = 0;
    this.obstacleSideById[id] = 0;

    const index = this.count++;
    const offset = index * STATE_STRIDE;
    const x = source.x + (this.random() - 0.5) * source.spreadX * 2;
    const y = Math.min(this.map.bounds.bottom - 2, source.y + (this.random() - 0.5) * source.spreadY * 2);
    const toBaseX = this.base.x - x;
    const toBaseY = this.base.y - y;
    const distance = Math.hypot(toBaseX, toBaseY) || 1;
    const speed = 50 + (hash32(id) & 15);
    this.speedById[id] = speed;
    const perpendicularX = -toBaseY / distance;
    const perpendicularY = toBaseX / distance;
    const lateral = (this.random() - 0.5) * 18;
    this.idByIndex[index] = id;
    this.indexById[id] = index;
    this.unitsByIndex[index] = units;
    this.state[offset + X] = Math.fround(x);
    this.state[offset + Y] = Math.fround(y);
    this.state[offset + VX] = Math.fround(toBaseX / distance * speed + perpendicularX * lateral);
    this.state[offset + VY] = Math.fround(toBaseY / distance * speed + perpendicularY * lateral);
    this.statusByIndex[index] = STATUS_MARKER.none;
    const cell = this.cellIndex(x, y);
    this.bucketNext[index] = this.bucketHead[cell];
    this.bucketHead[cell] = index;
    this.density[cell] += units;
    this.activeUnitCount += units;
    this.spawnedTotal += units;
    return this.enemyAtIndex(index);
  }

  clearEnemies() {
    while (this.count > 0) {
      const id = this.idByIndex[this.count - 1];
      this.remove(id, this.generationById[id]);
    }
    this.spawnAccumulator = 0;
    this.spawnHpAccumulator = 0;
    this.spawnMixCursor = 0;
    this.spawnMixFraction = 0;
    this.surgeAccumulator = 0;
    this.activeUnitCount = 0;
    this.rebuildSpatialIndex();
  }

  resetRunCounters() {
    this.tickNumber = 0;
    this.spawnAccumulator = 0;
    this.spawnHpAccumulator = 0;
    this.spawnMixCursor = 0;
    this.spawnMixFraction = 0;
    this.surgeAccumulator = 0;
    this.spawnSourceCursor = 0;
    this.spawnedTotal = 0;
    this.updateChecksum();
  }

  cellIndex(x, y) {
    const column = Math.max(0, Math.min(this.gridColumns - 1, Math.floor((x - this.gridLeft) / GRID_CELL_SIZE)));
    const row = Math.max(0, Math.min(this.gridRows - 1, Math.floor((y - this.gridTop) / GRID_CELL_SIZE)));
    return row * this.gridColumns + column;
  }

  rebuildSpatialIndex() {
    this.bucketHead.fill(-1);
    this.density.fill(0);
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * STATE_STRIDE;
      const cell = this.cellIndex(this.state[offset + X], this.state[offset + Y]);
      this.bucketNext[index] = this.bucketHead[cell];
      this.bucketHead[cell] = index;
      this.density[cell] += this.unitsByIndex[index];
    }
  }

  densityAt(column, row) {
    if (column < 0 || column >= this.gridColumns || row < 0 || row >= this.gridRows) return 0;
    return this.density[row * this.gridColumns + column];
  }

  rebuildForceFieldIndex(forceFields) {
    for (const indices of this.forceFieldIndicesByCell) indices.length = 0;
    for (let fieldIndex = 0; fieldIndex < forceFields.length; fieldIndex += 1) {
      const field = forceFields[fieldIndex];
      if (field.expiresTick <= this.tickNumber || !Number.isFinite(field.radius) || field.radius <= 0) continue;
      if (field.kind === 'stasis_zone' || field.kind === 'bond_zone') continue;
      if (field.kind === 'singularity_force' && this.tickNumber % field.periodTicks >= field.activeTicks) continue;
      if (field.kind === 'breaker_wave' && this.tickNumber % field.periodTicks >= field.travelTicks) continue;
      const bounds = this.cellBounds(field.x - field.radius, field.y - field.radius, field.x + field.radius, field.y + field.radius);
      for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
        for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
          this.forceFieldIndicesByCell[row * this.gridColumns + column].push(fieldIndex);
        }
      }
    }
  }

  crowdCellIndex(x, y) {
    const column = Math.max(0, Math.min(this.crowdColumns - 1, Math.floor((x - this.gridLeft) / CROWD_CELL_SIZE)));
    const row = Math.max(0, Math.min(this.crowdRows - 1, Math.floor((y - this.gridTop) / CROWD_CELL_SIZE)));
    return row * this.crowdColumns + column;
  }

  rebuildCrowdField() {
    this.crowdMass.fill(0);
    this.crowdMomentumX.fill(0);
    this.crowdMomentumY.fill(0);
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * STATE_STRIDE;
      const cell = this.crowdCellIndex(this.state[offset + X], this.state[offset + Y]);
      const units = this.unitsByIndex[index];
      this.crowdMass[cell] += units;
      this.crowdMomentumX[cell] += this.state[offset + VX] * units;
      this.crowdMomentumY[cell] += this.state[offset + VY] * units;
    }

    for (let row = 0; row < this.crowdRows; row += 1) {
      for (let column = 0; column < this.crowdColumns; column += 1) {
        let weightedMass = 0;
        let weightedMomentumX = 0;
        let weightedMomentumY = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleRow = row + offsetY;
          if (sampleRow < 0 || sampleRow >= this.crowdRows) continue;
          const weightY = offsetY === 0 ? 2 : 1;
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleColumn = column + offsetX;
            if (sampleColumn < 0 || sampleColumn >= this.crowdColumns) continue;
            const weight = weightY * (offsetX === 0 ? 2 : 1);
            const sampleCell = sampleRow * this.crowdColumns + sampleColumn;
            weightedMass += this.crowdMass[sampleCell] * weight;
            weightedMomentumX += this.crowdMomentumX[sampleCell] * weight;
            weightedMomentumY += this.crowdMomentumY[sampleCell] * weight;
          }
        }
        const cell = row * this.crowdColumns + column;
        this.crowdDensity[cell] = Math.fround(weightedMass / 16);
        this.crowdVelocityX[cell] = weightedMass > 0 ? Math.fround(weightedMomentumX / weightedMass) : 0;
        this.crowdVelocityY[cell] = weightedMass > 0 ? Math.fround(weightedMomentumY / weightedMass) : 0;
      }
    }

    for (let row = 0; row < this.crowdRows; row += 1) {
      const rowOffset = row * this.crowdColumns;
      for (let column = 0; column < this.crowdColumns; column += 1) {
        const cell = rowOffset + column;
        const center = this.crowdDensity[cell];
        const left = column > 0 ? this.crowdDensity[cell - 1] : center;
        const right = column + 1 < this.crowdColumns ? this.crowdDensity[cell + 1] : center;
        const upper = row > 0 ? this.crowdDensity[cell - this.crowdColumns] : center;
        const lower = row + 1 < this.crowdRows ? this.crowdDensity[cell + this.crowdColumns] : center;
        this.crowdPressureX[cell] = Math.fround(left - right);
        this.crowdPressureY[cell] = Math.fround(upper - lower);
      }
    }
  }

  crowdSampleAt(x, y) {
    const gridX = Math.max(0, Math.min(this.crowdColumns - 1, (x - this.gridLeft) / CROWD_CELL_SIZE - 0.5));
    const gridY = Math.max(0, Math.min(this.crowdRows - 1, (y - this.gridTop) / CROWD_CELL_SIZE - 0.5));
    const column0 = Math.floor(gridX);
    const row0 = Math.floor(gridY);
    const column1 = Math.min(this.crowdColumns - 1, column0 + 1);
    const row1 = Math.min(this.crowdRows - 1, row0 + 1);
    const blendX = gridX - column0;
    const blendY = gridY - row0;
    const cell00 = row0 * this.crowdColumns + column0;
    const cell10 = row0 * this.crowdColumns + column1;
    const cell01 = row1 * this.crowdColumns + column0;
    const cell11 = row1 * this.crowdColumns + column1;
    const weight00 = (1 - blendX) * (1 - blendY);
    const weight10 = blendX * (1 - blendY);
    const weight01 = (1 - blendX) * blendY;
    const weight11 = blendX * blendY;
    this.crowdSampleScratch[0] = this.crowdVelocityX[cell00] * weight00 + this.crowdVelocityX[cell10] * weight10
      + this.crowdVelocityX[cell01] * weight01 + this.crowdVelocityX[cell11] * weight11;
    this.crowdSampleScratch[1] = this.crowdVelocityY[cell00] * weight00 + this.crowdVelocityY[cell10] * weight10
      + this.crowdVelocityY[cell01] * weight01 + this.crowdVelocityY[cell11] * weight11;
    this.crowdSampleScratch[2] = this.crowdPressureX[cell00] * weight00 + this.crowdPressureX[cell10] * weight10
      + this.crowdPressureX[cell01] * weight01 + this.crowdPressureX[cell11] * weight11;
    this.crowdSampleScratch[3] = this.crowdPressureY[cell00] * weight00 + this.crowdPressureY[cell10] * weight10
      + this.crowdPressureY[cell01] * weight01 + this.crowdPressureY[cell11] * weight11;
    return this.crowdSampleScratch;
  }

  steerAroundDefenseAreas(id, x, y, guideX, guideY) {
    const candidates = this.areaIndicesByCell[this.cellIndex(x, y)];
    let areaIndex = this.obstacleAreaById[id] - 1;
    let area = areaIndex >= 0 ? this.defenseAreas[areaIndex] : null;
    let field = area ? defenseAreaField(area, x, y) : Infinity;
    if (!area || field > OBSTACLE_RELEASE) {
      this.obstacleAreaById[id] = 0;
      this.obstacleSideById[id] = 0;
      areaIndex = -1;
      area = null;
      field = Infinity;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidateAreaIndex = candidates[candidateIndex];
        const candidateArea = this.defenseAreas[candidateAreaIndex];
        const candidateField = defenseAreaField(candidateArea, x, y);
        if (candidateField >= field) continue;
        areaIndex = candidateAreaIndex;
        area = candidateArea;
        field = candidateField;
      }
    }
    if (!area || field >= OBSTACLE_INFLUENCE) {
      this.steeringScratch[0] = guideX;
      this.steeringScratch[1] = guideY;
      return this.steeringScratch;
    }

    const epsilon = 2;
    let normalX = defenseAreaField(area, x + epsilon, y) - defenseAreaField(area, x - epsilon, y);
    let normalY = defenseAreaField(area, x, y + epsilon) - defenseAreaField(area, x, y - epsilon);
    const normalLength = Math.hypot(normalX, normalY) || 0.0001;
    normalX /= normalLength;
    normalY /= normalLength;
    const headingInward = Math.max(0, -(guideX * normalX + guideY * normalY));
    const proximity = Math.max(0, Math.min(1, (OBSTACLE_INFLUENCE - field) / OBSTACLE_INFLUENCE));
    const emergency = Math.max(0, Math.min(1, (0.14 - field) / 0.28));
    const influence = Math.max(emergency, proximity * (0.08 + headingInward * 0.92));

    let tangentX = -normalY;
    let tangentY = normalX;
    let side = this.obstacleAreaById[id] === areaIndex + 1 ? this.obstacleSideById[id] : 0;
    const baseDeltaX = this.base.x - x;
    const baseDeltaY = this.base.y - y;
    const baseDistance = Math.hypot(baseDeltaX, baseDeltaY) || 1;
    const downstreamAlignment = tangentX * (baseDeltaX / baseDistance) + tangentY * (baseDeltaY / baseDistance);
    if (side === 0) {
      let initialAlignment = downstreamAlignment;
      if (Math.abs(initialAlignment) <= 0.005) initialAlignment = tangentX * guideX + tangentY * guideY;
      if (Math.abs(initialAlignment) > 0.005) {
        side = initialAlignment > 0 ? 1 : -1;
      } else {
        const anchor = area.shape;
        const sideOffset = (x - anchor.x) * tangentX + (y - anchor.y) * tangentY;
        if (Math.abs(sideOffset) > 4) side = sideOffset > 0 ? 1 : -1;
        else side = (hash32(id ^ this.seed ^ Math.imul(areaIndex + 1, 0x9e3779b1)) & 1) === 0 ? -1 : 1;
      }
      this.obstacleAreaById[id] = areaIndex + 1;
      this.obstacleSideById[id] = side;
    } else if (downstreamAlignment * side < -0.24) {
      // a remembered route can become locally upstream on a strongly warped edge.
      // flip only on a decisive signal so the swarm keeps flowing instead of orbiting.
      side = downstreamAlignment > 0 ? 1 : -1;
      this.obstacleSideById[id] = side;
    }
    if (side < 0) {
      tangentX = -tangentX;
      tangentY = -tangentY;
    }
    let avoidX = tangentX * 0.86 + normalX * (0.28 + emergency * 0.62);
    let avoidY = tangentY * 0.86 + normalY * (0.28 + emergency * 0.62);
    const avoidLength = Math.hypot(avoidX, avoidY) || 1;
    avoidX /= avoidLength;
    avoidY /= avoidLength;
    guideX = guideX * (1 - influence) + avoidX * influence;
    guideY = guideY * (1 - influence) + avoidY * influence;
    const guideLength = Math.hypot(guideX, guideY) || 1;
    guideX /= guideLength;
    guideY /= guideLength;
    this.steeringScratch[0] = guideX;
    this.steeringScratch[1] = guideY;
    return this.steeringScratch;
  }

  resolveDefenseAreas(id, x, y, vx, vy, guideX, guideY) {
    const avoidanceSign = (hash32(id ^ this.seed) & 1) === 0 ? -1 : 1;
    for (let pass = 0; pass < 4; pass += 1) {
      const candidates = this.areaIndicesByCell[this.cellIndex(x, y)];
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const areaIndex = candidates[candidateIndex];
        const area = this.defenseAreas[areaIndex];
        const field = defenseAreaField(area, x, y);
        if (field >= 0.035) continue;
        const epsilon = 1;
        let nx = (defenseAreaField(area, x + epsilon, y) - defenseAreaField(area, x - epsilon, y)) / (epsilon * 2);
        let ny = (defenseAreaField(area, x, y + epsilon) - defenseAreaField(area, x, y - epsilon)) / (epsilon * 2);
        const gradientLength = Math.hypot(nx, ny) || 0.0001;
        nx /= gradientLength;
        ny /= gradientLength;
        const push = Math.min(42, Math.max(0, (0.055 - field) / gradientLength));
        x += nx * push;
        y += ny * push;
        let tx = -ny;
        let ty = nx;
        let side = this.obstacleAreaById[id] === areaIndex + 1 ? this.obstacleSideById[id] : 0;
        const baseDeltaX = this.base.x - x;
        const baseDeltaY = this.base.y - y;
        const baseDistance = Math.hypot(baseDeltaX, baseDeltaY) || 1;
        const downstreamAlignment = tx * (baseDeltaX / baseDistance) + ty * (baseDeltaY / baseDistance);
        if (side === 0) {
          let alignment = downstreamAlignment;
          if (Math.abs(alignment) <= 0.005) alignment = tx * guideX + ty * guideY;
          side = Math.abs(alignment) <= 0.005 ? avoidanceSign : alignment > 0 ? 1 : -1;
          this.obstacleAreaById[id] = areaIndex + 1;
          this.obstacleSideById[id] = side;
        } else if (downstreamAlignment * side < -0.24) {
          side = downstreamAlignment > 0 ? 1 : -1;
          this.obstacleSideById[id] = side;
        }
        if (side < 0) {
          tx = -tx;
          ty = -ty;
        }
        const boundarySpeed = Math.max(48, Math.hypot(vx, vy));
        vx = vx * 0.18 + tx * boundarySpeed * 0.82 + nx * 28;
        vy = vy * 0.18 + ty * boundarySpeed * 0.82 + ny * 28;
      }
    }
    this.resolveScratch[0] = x;
    this.resolveScratch[1] = y;
    this.resolveScratch[2] = vx;
    this.resolveScratch[3] = vy;
    return this.resolveScratch;
  }

  clearBond(id) {
    const partner = this.bondPartnerById[id];
    if (partner > 0 && partner < this.nextFreshId
      && this.bondPartnerById[partner] === id
      && this.bondGenerationById[partner] === this.generationById[id]) {
      for (const name of BOND_TABLES) this[name][partner] = 0;
      if (this.statusCodeById[partner] === STATUS_MARKER.bond) {
        this.statusCodeById[partner] = STATUS_MARKER.none;
        const index = this.indexById[partner];
        if (index >= 0) this.statusByIndex[index] = STATUS_MARKER.none;
      }
    }
    for (const name of BOND_TABLES) this[name][id] = 0;
    if (this.statusCodeById[id] === STATUS_MARKER.bond) {
      this.statusCodeById[id] = STATUS_MARKER.none;
      const index = this.indexById[id];
      if (index >= 0) this.statusByIndex[index] = STATUS_MARKER.none;
    }
  }

  pulseBonds(field, tick) {
    let source = this.bondSourceIndex.get(field.sourceTowerId);
    if (source === undefined) {
      source = this.bondSourceIds.length;
      this.bondSourceIds.push(field.sourceTowerId);
      this.bondSourceIndex.set(field.sourceTowerId, source);
    }
    const bounds = this.cellBounds(field.x - field.radius, field.y - field.radius, field.x + field.radius, field.y + field.radius);
    const radiusSquared = field.radius * field.radius;
    let count = 0;
    for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
      for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
        let index = this.bucketHead[row * this.gridColumns + column];
        while (index >= 0) {
          const id = this.idByIndex[index];
          const offset = index * STATE_STRIDE;
          const dx = this.state[offset + X] - field.x;
          const dy = this.state[offset + Y] - field.y;
          if (dx * dx + dy * dy <= radiusSquared && this.bondUntilById[id] <= tick) {
            if (this.bondPartnerById[id]) this.clearBond(id);
            this.bondCandidateIds[count++] = id;
          }
          index = this.bucketNext[index];
        }
      }
    }
    // Spatially ordered neighbours, not an all-pairs nearest-neighbour search.
    // Stable id ties make the matching identical on both peers.
    const candidates = this.bondCandidateIds.subarray(0, count);
    candidates.sort((left, right) => {
      const a = this.indexById[left] * STATE_STRIDE;
      const b = this.indexById[right] * STATE_STRIDE;
      return Math.floor(this.state[a + Y] / CROWD_CELL_SIZE) - Math.floor(this.state[b + Y] / CROWD_CELL_SIZE)
        || this.state[a + X] - this.state[b + X]
        || this.state[a + Y] - this.state[b + Y]
        || left - right;
    });
    let pairedUnits = 0;
    for (let index = 0; index + 1 < count; index += 2) {
      const a = candidates[index];
      const b = candidates[index + 1];
      const units = Math.min(this.unitsByIndex[this.indexById[a]], this.unitsByIndex[this.indexById[b]]);
      this.bondPartnerById[a] = b;
      this.bondPartnerById[b] = a;
      this.bondGenerationById[a] = this.generationById[b];
      this.bondGenerationById[b] = this.generationById[a];
      this.bondUntilById[a] = this.bondUntilById[b] = tick + field.durationTicks;
      this.bondSourceById[a] = this.bondSourceById[b] = source;
      this.bondUnitsById[a] = this.bondUnitsById[b] = units;
      pairedUnits += units * 2;
    }
    return pairedUnits;
  }

  consumeBond(id, killedUnits) {
    const partnerId = this.bondPartnerById[id];
    if (!partnerId) return null;
    const generation = this.bondGenerationById[id];
    const partnerIndex = this.indexById[partnerId];
    if (this.bondUntilById[id] <= this.tickNumber || partnerIndex < 0
      || this.generationById[partnerId] !== generation || this.bondPartnerById[partnerId] !== id) {
      this.clearBond(id);
      return null;
    }
    const units = Math.min(killedUnits, this.bondUnitsById[id], this.unitsByIndex[partnerIndex]);
    const sourceTowerId = this.bondSourceIds[this.bondSourceById[id]];
    this.bondUnitsById[id] -= units;
    this.bondUnitsById[partnerId] -= units;
    if (this.bondUnitsById[id] <= 0) this.clearBond(id);
    return units > 0 ? { partnerId, generation, units, sourceTowerId } : null;
  }

  resolveBondKill(bond) {
    if (!bond) return null;
    // Raw removal intentionally bypasses damage/on-kill propagation. A bond can
    // claim only its surviving paired units, never an entire compressed packet.
    const hit = this.kill(bond.partnerId, bond.generation, { unitCount: bond.units });
    return hit ? { ...hit, sourceTowerId: bond.sourceTowerId } : null;
  }

  applyForceFields(id, x, y, vx, vy, forceFields, dt, units, guideX, guideY, desiredSpeed) {
    const indices = this.forceFieldIndicesByCell[this.cellIndex(x, y)];
    let movementFactor = 1;
    let slowField = null;
    let vortexField = null;
    let vortexX = 0;
    let vortexY = 0;
    let vortexScore = -1;
    let singularityField = null;
    let singularityX = 0;
    let singularityY = 0;
    let singularityScore = -1;
    let braidField = null;
    let braidX = 0;
    let braidY = 0;
    let braidScore = -1;
    let breakerField = null;
    let breakerX = 0;
    let breakerY = 0;
    let breakerScore = -1;
    let crosswindField = null;
    let crosswindX = 0;
    let crosswindY = 0;
    let crosswindScore = -1;
    let wallField = null;
    let wallX = 0;
    let wallY = 0;
    let wallScore = -1;
    let splitterField = null;
    let splitterX = 0;
    let splitterY = 0;
    let splitterScore = -1;
    let shoveX = 0;
    let shoveY = 0;
    for (let fieldOffset = 0; fieldOffset < indices.length; fieldOffset += 1) {
      const field = forceFields[indices[fieldOffset]];
      if (field.expiresTick <= this.tickNumber) continue;
      const dx = x - field.x;
      const dy = y - field.y;
      const distance = Math.hypot(dx, dy) || 0.0001;
      if (distance >= field.radius) continue;
      const falloff = 1 - distance / field.radius;
      if (field.kind === 'radial_force') {
        const force = field.strength * falloff * dt;
        vx += dx / distance * force;
        vy += dy / distance * force;
      } else if (field.kind === 'directional_force') {
        const force = field.strength * falloff * dt;
        vx += field.directionX * force;
        vy += field.directionY * force;
      } else if (field.kind === 'slow_field') {
        if (!field.persistentControl) {
          movementFactor = Math.min(movementFactor, field.speedFactor);
        } else if (field.speedFactor < movementFactor) {
          movementFactor = field.speedFactor;
          slowField = field;
        }
      } else if (field.kind === 'vortex_force') {
        const radialForce = field.radialStrength * falloff * dt;
        const tangentialForce = field.tangentialStrength * field.spin * falloff * dt;
        const forceX = dx / distance * radialForce - dy / distance * tangentialForce;
        const forceY = dy / distance * radialForce + dx / distance * tangentialForce;
        if (!field.persistentControl) {
          vx += forceX;
          vy += forceY;
        } else {
          const score = forceX * forceX + forceY * forceY;
          if (score > vortexScore) {
            vortexScore = score;
            vortexField = field;
            vortexX = forceX;
            vortexY = forceY;
          }
        }
      } else if (field.kind === 'pinch_force') {
        const perpendicularX = -field.axisY;
        const perpendicularY = field.axisX;
        const side = dx * perpendicularX + dy * perpendicularY;
        const sideScale = Math.min(1, Math.abs(side) / Math.max(1, field.radius * 0.32));
        const force = field.strength * falloff * sideScale * dt;
        const sideSign = side < 0 ? 1 : -1;
        vx += perpendicularX * force * sideSign;
        vy += perpendicularY * force * sideSign;
      } else if (field.kind === 'singularity_force') {
        const phase = this.tickNumber % field.periodTicks;
        if (phase >= field.activeTicks) continue;
        const force = field.strength * falloff * dt;
        const forceX = dx / distance * force;
        const forceY = dy / distance * force;
        const score = forceX * forceX + forceY * forceY;
        if (score > singularityScore) {
          singularityScore = score;
          singularityField = field;
          singularityX = forceX;
          singularityY = forceY;
        }
      } else if (field.kind === 'braid_force') {
        const along = dx * field.axisX + dy * field.axisY;
        const side = dx * field.normalX + dy * field.normalY;
        if (Math.abs(along) > field.halfLength || Math.abs(side) > field.width * 0.5) continue;
        const sideScale = Math.min(1, Math.abs(side) / Math.max(1, field.width * 0.34));
        const edgeScale = 1 - Math.abs(along) / Math.max(1, field.halfLength);
        const force = field.strength * sideScale * (0.35 + edgeScale * 0.65) * dt;
        const sign = side < 0 ? 1 : -1;
        const forceX = field.normalX * force * sign;
        const forceY = field.normalY * force * sign;
        const score = forceX * forceX + forceY * forceY;
        if (score > braidScore) {
          braidScore = score;
          braidField = field;
          braidX = forceX;
          braidY = forceY;
        }
      } else if (field.kind === 'breaker_wave') {
        const phase = this.tickNumber % field.periodTicks;
        if (phase >= field.travelTicks) continue;
        const cycle = 1 + Math.floor(this.tickNumber / field.periodTicks);
        if (this.breakerCycleById[id] === cycle) continue;
        const forward = dx * field.directionX + dy * field.directionY;
        const lateral = Math.abs(dx * -field.directionY + dy * field.directionX);
        const waveDistance = field.range * phase / Math.max(1, field.travelTicks - 1);
        const depth = Math.abs(forward - waveDistance);
        if (forward < 0 || lateral > field.halfWidth || depth > field.waveThickness * 0.5) continue;
        const forceX = field.directionX * field.shoveDistance;
        const forceY = field.directionY * field.shoveDistance;
        const score = 1 - depth / Math.max(1, field.waveThickness * 0.5);
        if (score > breakerScore) {
          breakerScore = score;
          breakerField = field;
          breakerX = forceX;
          breakerY = forceY;
        }
      } else if (field.kind === 'crosswind_force') {
        const force = field.strength * falloff * dt;
        const forceX = field.directionX * force;
        const forceY = field.directionY * force;
        const score = forceX * forceX + forceY * forceY;
        if (score > crosswindScore) {
          crosswindScore = score;
          crosswindField = field;
          crosswindX = forceX;
          crosswindY = forceY;
        }
      } else if (field.kind === 'splitter_force') {
        const along = dx * field.wallAxisX + dy * field.wallAxisY;
        const depth = dx * field.wallNormalX + dy * field.wallNormalY;
        if (Math.abs(along) > field.halfLength || Math.abs(depth) > field.thickness) continue;
        // Alternate stable enemy identities toward opposite ends.
        const sign = (id & 1) ? 1 : -1;
        const edge = Math.min(1, (field.halfLength - Math.abs(along)) / Math.max(1, field.thickness));
        const force = field.strength * (1 - Math.abs(depth) / field.thickness) * edge * dt;
        const forceX = field.wallAxisX * sign * force;
        const forceY = field.wallAxisY * sign * force;
        const score = forceX * forceX + forceY * forceY;
        if (score > splitterScore) {
          splitterScore = score;
          splitterField = field;
          splitterX = forceX;
          splitterY = forceY;
        }
      } else if (field.kind === 'force_wall') {
        const along = dx * field.wallAxisX + dy * field.wallAxisY;
        const depth = dx * (field.wallNormalX ?? field.pushX) + dy * (field.wallNormalY ?? field.pushY);
        if (Math.abs(along) > field.halfLength || Math.abs(depth) > field.thickness) continue;
        const depthFalloff = 1 - Math.abs(depth) / field.thickness;
        const edgeStart = field.halfLength * 0.78;
        const edgeFalloff = Math.abs(along) <= edgeStart
          ? 1
          : 1 - (Math.abs(along) - edgeStart) / Math.max(1, field.halfLength - edgeStart);
        const force = field.strength * depthFalloff * Math.max(0, edgeFalloff) * dt;
        const forceX = field.pushX * force;
        const forceY = field.pushY * force;
        if (!field.persistentControl) {
          vx += forceX;
          vy += forceY;
        } else {
          const score = forceX * forceX + forceY * forceY;
          if (score > wallScore) {
            wallScore = score;
            wallField = field;
            wallX = forceX;
            wallY = forceY;
          }
        }
      }
    }
    if (vortexField) {
      vx += vortexX;
      vy += vortexY;
      vortexField.affectedUnitsTick += units;
    }
    if (wallField) {
      vx += wallX;
      vy += wallY;
      wallField.affectedUnitsTick += units;
    }
    if (braidField || crosswindField || splitterField) {
      // Shapers can only add sideways motion relative to obstacle-aware flow.
      // Project the *combined* change and bound its lateral speed so mixed kinds
      // cannot become a disguised upstream wall or spin an enemy indefinitely.
      const sideX = -guideY;
      const sideY = guideX;
      const lateralForce = (braidX + crosswindX + splitterX) * sideX
        + (braidY + crosswindY + splitterY) * sideY;
      const forward = Math.max(desiredSpeed * 0.68, vx * guideX + vy * guideY);
      const lateralLimit = desiredSpeed * 1.2;
      const lateral = Math.max(-lateralLimit, Math.min(lateralLimit, vx * sideX + vy * sideY + lateralForce));
      vx = guideX * forward + sideX * lateral;
      vy = guideY * forward + sideY * lateral;
      if (braidField) braidField.affectedUnitsTick += units;
      if (crosswindField) crosswindField.affectedUnitsTick += units;
      if (splitterField) splitterField.affectedUnitsTick += units;
    }
    // Only the brief, globally phased gathering pulse may pull backwards.
    if (singularityField) {
      vx += singularityX;
      vy += singularityY;
      singularityField.affectedUnitsTick += units;
    }
    if (breakerField) {
      // A wave grants one bounded displacement, never repeated acceleration.
      // All breakers share this cycle, so overlapping waves cannot farm a queue.
      this.breakerCycleById[id] = 1 + Math.floor(this.tickNumber / breakerField.periodTicks);
      shoveX = breakerX;
      shoveY = breakerY;
      breakerField.triggeredUnitsTick += units;
    }
    if (slowField) slowField.affectedUnitsTick += units;
    this.resolveScratch[0] = vx;
    this.resolveScratch[1] = vy;
    this.resolveScratch[2] = movementFactor;
    this.resolveScratch[3] = shoveX;
    this.resolveScratch[4] = shoveY;
    return this.resolveScratch;
  }

  applyRecallGates(id, generation, previousX, previousY, x, y, forceFields, units) {
    if (this.recallUsedById[id] || this.recallDueById[id] > this.tickNumber) return false;
    const indices = this.forceFieldIndicesByCell[this.cellIndex(x, y)];
    for (let fieldOffset = 0; fieldOffset < indices.length; fieldOffset += 1) {
      const field = forceFields[indices[fieldOffset]];
      if (field.kind !== 'recall_gate' || field.expiresTick <= this.tickNumber) continue;
      const previousDistance = (previousX - field.x) * field.normalX + (previousY - field.y) * field.normalY;
      const currentDistance = (x - field.x) * field.normalX + (y - field.y) * field.normalY;
      if ((previousDistance < 0 && currentDistance < 0) || (previousDistance > 0 && currentDistance > 0)) continue;
      const denominator = previousDistance - currentDistance;
      if (Math.abs(denominator) <= 0.0001) continue;
      const travel = previousDistance / denominator;
      if (travel < 0 || travel > 1) continue;
      const crossX = previousX + (x - previousX) * travel;
      const crossY = previousY + (y - previousY) * travel;
      const along = (crossX - field.x) * field.axisX + (crossY - field.y) * field.axisY;
      if (Math.abs(along) > field.halfLength) continue;
      if (this.generationById[id] !== generation || this.indexById[id] < 0) return false;
      this.recallDueById[id] = this.tickNumber + field.delayTicks;
      this.recallUsedById[id] = 1;
      this.recallXById[id] = Math.fround(crossX);
      this.recallYById[id] = Math.fround(crossY);
      if (this.stasisUntilById[id] <= this.tickNumber) this.statusCodeById[id] = STATUS_MARKER.recall;
      field.triggeredUnitsTick += units;
      return true;
    }
    return false;
  }

  tick(tick, { spawnRatePerSecond = 0, spawnSources = [], enemyHp = this.defaultEnemyHp, meanHp = null, forceFields = [] } = {}) {
    this.tickNumber = tick;
    const spawned = this.spawnAtRate(spawnRatePerSecond, spawnSources, enemyHp, meanHp);
    this.rebuildCrowdField();
    this.rebuildForceFieldIndex(forceFields);
    let breachCandidateCount = 0;
    let slowedCount = 0;
    const dt = 1 / AUTHORITY_TICK_RATE;
    const velocityBlend = Math.min(1, dt * 2.35);
    const baseRadius = this.base.reachRadius || 30;
    const baseRadiusSquared = baseRadius ** 2;
    const approachFadeRange = Math.max(1, APPROACH_FADE_DISTANCE - baseRadius);
    const seedPhaseA = this.seed & SIN_LUT_MASK;
    const seedPhaseB = (this.seed >>> 11) & SIN_LUT_MASK;
    const minimumX = this.map.bounds.left + 2;
    const maximumX = this.map.bounds.right - 2;
    const minimumY = this.map.bounds.top + 2;
    const maximumY = this.map.bounds.bottom - 2;
    const activeBondSources = new Set(forceFields.filter((field) => field.kind === 'bond_zone').map((field) => field.sourceTowerId));

    for (let index = 0; index < this.count; index += 1) {
      const offset = index * STATE_STRIDE;
      const id = this.idByIndex[index];
      if (this.bondPartnerById[id] && (this.bondUntilById[id] <= tick
        || !activeBondSources.has(this.bondSourceIds[this.bondSourceById[id]]))) this.clearBond(id);
      let x = this.state[offset + X];
      let y = this.state[offset + Y];
      let vx = this.state[offset + VX];
      let vy = this.state[offset + VY];
      const recallDue = this.recallDueById[id];
      if (recallDue > 0 && recallDue <= tick) {
        x = this.recallXById[id];
        y = this.recallYById[id];
        vx *= 0.25;
        vy *= 0.25;
        this.recallDueById[id] = 0;
        this.recallXById[id] = 0;
        this.recallYById[id] = 0;
      }
      const previousX = x;
      const previousY = y;
      const toBaseX = this.base.x - x;
      const toBaseY = this.base.y - y;
      const distanceToBase = Math.hypot(toBaseX, toBaseY) || 1;
      const desiredSpeed = this.speedById[id];
      const directX = toBaseX / distanceToBase;
      const directY = toBaseY / distanceToBase;
      const tangentX = -directY;
      const tangentY = directX;
      const approachHash = hash32(id ^ this.seed);
      const approachUnit = (approachHash & 0xffff) / 32767.5 - 1;
      const approachFade = Math.max(0, Math.min(1, (distanceToBase - baseRadius) / approachFadeRange));
      const lateralTarget = approachUnit * APPROACH_SPREAD * approachFade;
      let guideX = toBaseX + tangentX * lateralTarget;
      let guideY = toBaseY + tangentY * lateralTarget;
      const guideLength = Math.hypot(guideX, guideY) || 1;
      guideX /= guideLength;
      guideY /= guideLength;
      const steered = this.steerAroundDefenseAreas(id, x, y, guideX, guideY);
      guideX = steered[0];
      guideY = steered[1];

      const crowd = this.crowdSampleAt(x, y);
      let sharedVelocityX = crowd[0];
      let sharedVelocityY = crowd[1];
      const backwardsFlow = sharedVelocityX * guideX + sharedVelocityY * guideY;
      if (backwardsFlow < 0) {
        sharedVelocityX -= guideX * backwardsFlow;
        sharedVelocityY -= guideY * backwardsFlow;
      }
      let pressureX = crowd[2] * CROWD_PRESSURE_STRENGTH;
      let pressureY = crowd[3] * CROWD_PRESSURE_STRENGTH;
      const pressureLength = Math.hypot(pressureX, pressureY);
      if (pressureLength > CROWD_PRESSURE_LIMIT) {
        const pressureScale = CROWD_PRESSURE_LIMIT / pressureLength;
        pressureX *= pressureScale;
        pressureY *= pressureScale;
      }
      const curlCross = SIN_LUT[(Math.floor((x + y) * 2) + tick + seedPhaseA + seedPhaseB) & SIN_LUT_MASK];
      const curlX = (SIN_LUT[(Math.floor(y * 5) + tick * 2 + seedPhaseA) & SIN_LUT_MASK] + curlCross * 0.45) * 10;
      const curlY = (-SIN_LUT[(Math.floor(x * 5) - tick * 2 + seedPhaseB) & SIN_LUT_MASK] + curlCross * 0.45) * 10;
      const guidedVelocityX = guideX * desiredSpeed;
      const guidedVelocityY = guideY * desiredSpeed;
      let desiredX = guidedVelocityX + (sharedVelocityX - guidedVelocityX) * CROWD_FLOW_WEIGHT + pressureX + curlX;
      let desiredY = guidedVelocityY + (sharedVelocityY - guidedVelocityY) * CROWD_FLOW_WEIGHT + pressureY + curlY;
      const minimumForwardSpeed = desiredSpeed * 0.68;
      const forwardSpeed = desiredX * guideX + desiredY * guideY;
      if (forwardSpeed < minimumForwardSpeed) {
        desiredX += guideX * (minimumForwardSpeed - forwardSpeed);
        desiredY += guideY * (minimumForwardSpeed - forwardSpeed);
      }
      vx += (desiredX - vx) * velocityBlend;
      vy += (desiredY - vy) * velocityBlend;

      let fieldMovementFactor = 1;
      let shoveX = 0;
      let shoveY = 0;
      if (forceFields.length > 0) {
        const forced = this.applyForceFields(id, x, y, vx, vy, forceFields, dt, this.unitsByIndex[index], guideX, guideY, desiredSpeed);
        vx = forced[0];
        vy = forced[1];
        fieldMovementFactor = forced[2];
        shoveX = forced[3];
        shoveY = forced[4];
      }

      const slowed = this.slowUntilById[id] > tick;
      const inStasis = this.stasisUntilById[id] > tick;
      const recallPending = this.recallDueById[id] > tick;
      const movementFactor = inStasis
        ? 0
        : Math.min(slowed ? this.slowFactorById[id] : 1, fieldMovementFactor);
      if (movementFactor < 1) {
        slowedCount += this.unitsByIndex[index];
      }
      if (!slowed) {
        this.slowFactorById[id] = 1;
      }
      if (inStasis) {
        this.statusCodeById[id] = STATUS_MARKER.stasis;
      } else if (recallPending) {
        this.statusCodeById[id] = STATUS_MARKER.recall;
      } else if (movementFactor < 1) {
        this.statusCodeById[id] = STATUS_MARKER.slow;
      } else if (this.bondPartnerById[id]) {
        this.statusCodeById[id] = STATUS_MARKER.bond;
      } else {
        this.statusCodeById[id] = STATUS_MARKER.none;
      }
      x += vx * dt * movementFactor + shoveX;
      y += vy * dt * movementFactor + shoveY;

      const resolved = this.resolveDefenseAreas(id, x, y, vx, vy, guideX, guideY);
      x = resolved[0];
      y = resolved[1];
      vx = resolved[2];
      vy = resolved[3];

      if (x < minimumX) {
        x = minimumX;
        vx = Math.max(12, Math.abs(vx) * 0.45);
      } else if (x > maximumX) {
        x = maximumX;
        vx = -Math.max(12, Math.abs(vx) * 0.45);
      }
      if (y < minimumY) {
        y = minimumY;
        vy = Math.max(12, Math.abs(vy) * 0.45);
      } else if (y > maximumY) {
        y = maximumY;
        vy = -Math.max(12, Math.abs(vy) * 0.45);
      }

      // Solid, short-lived barricades stop crossings, with open ends and a
      // tangential escape nudge. Swept depth prevents fast packets tunnelling.
      for (const field of forceFields) {
        if (field.kind !== 'barricade' || field.expiresTick <= tick) continue;
        const oldDepth = (previousX-field.x)*field.normalX+(previousY-field.y)*field.normalY;
        const depth = (x-field.x)*field.normalX+(y-field.y)*field.normalY;
        const crossing = oldDepth * depth <= 0;
        const fraction = crossing ? oldDepth / (oldDepth - depth || 1) : 1;
        const contactX = previousX + (x-previousX)*fraction;
        const contactY = previousY + (y-previousY)*fraction;
        const along = (contactX-field.x)*field.axisX+(contactY-field.y)*field.axisY;
        if (Math.abs(along) > field.halfLength + 2 || (oldDepth*depth > 0 && Math.abs(depth) >= field.thickness)) continue;
        const side = Math.sign(oldDepth) || 1;
        const correction = side*(field.thickness+1)-depth;
        x += field.normalX*correction; y += field.normalY*correction;
        const normalVelocity = vx*field.normalX+vy*field.normalY;
        vx -= field.normalX*normalVelocity; vy -= field.normalY*normalVelocity;
        const escape = Math.sign(along) || ((id&1)?1:-1);
        x += field.axisX*escape*35*dt; y += field.axisY*escape*35*dt;
        field.affectedUnitsTick += this.unitsByIndex[index];
      }

      if (forceFields.length > 0) {
        this.applyRecallGates(
          id,
          this.generationById[id],
          previousX,
          previousY,
          x,
          y,
          forceFields,
          this.unitsByIndex[index]
        );
      }

      const reachedBase = segmentPointDistanceSquared(previousX, previousY, x, y, this.base.x, this.base.y) <= baseRadiusSquared;
      if (reachedBase) {
        this.breachIds[breachCandidateCount] = id;
        this.breachGenerations[breachCandidateCount] = this.generationById[id];
        breachCandidateCount += 1;
      }

      this.state[offset + X] = Math.fround(x);
      this.state[offset + Y] = Math.fround(y);
      this.state[offset + VX] = Math.fround(vx);
      this.state[offset + VY] = Math.fround(vy);
      this.statusByIndex[index] = this.statusCodeById[id];
    }

    this.slowedCount = slowedCount;
    let breaches = 0;
    for (let candidate = 0; candidate < breachCandidateCount; candidate += 1) {
      const id = this.breachIds[candidate];
      const generation = this.breachGenerations[candidate];
      const index = id < this.indexById.length ? this.indexById[id] : -1;
      const units = index >= 0 && this.generationById[id] === generation ? this.unitsByIndex[index] : 0;
      if (this.remove(id, generation)) breaches += units;
    }
    this.rebuildSpatialIndex();
    return { breaches, spawned };
  }

  cellBounds(minX, minY, maxX, maxY) {
    return {
      minimumColumn: Math.max(0, Math.floor((minX - this.gridLeft) / GRID_CELL_SIZE)),
      maximumColumn: Math.min(this.gridColumns - 1, Math.floor((maxX - this.gridLeft) / GRID_CELL_SIZE)),
      minimumRow: Math.max(0, Math.floor((minY - this.gridTop) / GRID_CELL_SIZE)),
      maximumRow: Math.min(this.gridRows - 1, Math.floor((maxY - this.gridTop) / GRID_CELL_SIZE))
    };
  }

  enemiesInCircle(x, y, radius, excludedIds = null) {
    const radiusSquared = radius * radius;
    const bounds = this.cellBounds(x - radius, y - radius, x + radius, y + radius);
    const matches = [];
    for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
      for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
        let index = this.bucketHead[row * this.gridColumns + column];
        while (index >= 0) {
          const id = this.idByIndex[index];
          if (!excludedIds?.has(id)) {
            const offset = index * STATE_STRIDE;
            const dx = this.state[offset + X] - x;
            const dy = this.state[offset + Y] - y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= radiusSquared) matches.push({ ...this.enemyAtIndex(index), distanceSquared });
          }
          index = this.bucketNext[index];
        }
      }
    }
    matches.sort((a, b) => a.distanceSquared - b.distanceSquared || a.id - b.id);
    return matches;
  }

  enemiesAlongSegment(x1, y1, x2, y2, radius, excludedIds = null) {
    const bounds = this.cellBounds(
      Math.min(x1, x2) - radius,
      Math.min(y1, y2) - radius,
      Math.max(x1, x2) + radius,
      Math.max(y1, y2) + radius
    );
    const segmentX = x2 - x1;
    const segmentY = y2 - y1;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const radiusSquared = radius * radius;
    const matches = [];
    for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
      for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
        let index = this.bucketHead[row * this.gridColumns + column];
        while (index >= 0) {
          const id = this.idByIndex[index];
          if (!excludedIds?.has(id)) {
            const offset = index * STATE_STRIDE;
            const enemyX = this.state[offset + X];
            const enemyY = this.state[offset + Y];
            const projection = segmentLengthSquared > 0
              ? ((enemyX - x1) * segmentX + (enemyY - y1) * segmentY) / segmentLengthSquared
              : 0;
            const travel = Math.max(0, Math.min(1, projection));
            const closestX = x1 + segmentX * travel;
            const closestY = y1 + segmentY * travel;
            const dx = enemyX - closestX;
            const dy = enemyY - closestY;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= radiusSquared) matches.push({ ...this.enemyAtIndex(index), travel, distanceSquared });
          }
          index = this.bucketNext[index];
        }
      }
    }
    matches.sort((a, b) => a.travel - b.travel || a.distanceSquared - b.distanceSquared || a.id - b.id);
    return matches;
  }

  firstEnemyAlongSegment(x1, y1, x2, y2, radius, excludedIds = null) {
    const bounds = this.cellBounds(
      Math.min(x1, x2) - radius,
      Math.min(y1, y2) - radius,
      Math.max(x1, x2) + radius,
      Math.max(y1, y2) + radius
    );
    const segmentX = x2 - x1;
    const segmentY = y2 - y1;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const radiusSquared = radius * radius;
    let bestIndex = -1;
    let bestTravel = Infinity;
    let bestDistanceSquared = Infinity;
    let bestId = Infinity;
    for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
      for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
        let index = this.bucketHead[row * this.gridColumns + column];
        while (index >= 0) {
          const id = this.idByIndex[index];
          if (!excludedIds?.has(id)) {
            const offset = index * STATE_STRIDE;
            const enemyX = this.state[offset + X];
            const enemyY = this.state[offset + Y];
            const projection = segmentLengthSquared > 0
              ? ((enemyX - x1) * segmentX + (enemyY - y1) * segmentY) / segmentLengthSquared
              : 0;
            const travel = Math.max(0, Math.min(1, projection));
            const dx = enemyX - (x1 + segmentX * travel);
            const dy = enemyY - (y1 + segmentY * travel);
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= radiusSquared && (
              travel < bestTravel
              || (travel === bestTravel && (distanceSquared < bestDistanceSquared || (distanceSquared === bestDistanceSquared && id < bestId)))
            )) {
              bestIndex = index;
              bestTravel = travel;
              bestDistanceSquared = distanceSquared;
              bestId = id;
            }
          }
          index = this.bucketNext[index];
        }
      }
    }
    return bestIndex < 0 ? null : { ...this.enemyAtIndex(bestIndex), travel: bestTravel, distanceSquared: bestDistanceSquared };
  }

  applyStatus(targets, effect) {
    const affected = [];
    const appliedTick = effect.appliedTick ?? this.tickNumber;
    for (const target of targets) {
      const current = this.enemy(target.id, target.generation);
      if (!current) continue;
      if (effect.status === 'slow') {
        const speedFactor = Math.max(0.25, 1 - effect.magnitude);
        const durationTicks = Math.max(1, Math.round(effect.durationSeconds * AUTHORITY_TICK_RATE));
        const alreadySlowed = this.slowUntilById[target.id] > this.tickNumber;
        this.slowFactorById[target.id] = Math.fround(Math.min(alreadySlowed ? this.slowFactorById[target.id] : 1, speedFactor));
        this.slowUntilById[target.id] = Math.max(this.slowUntilById[target.id], this.tickNumber + durationTicks);
        if (this.stasisUntilById[target.id] <= this.tickNumber) {
          this.statusCodeById[target.id] = STATUS_MARKER.slow;
          this.statusByIndex[this.indexById[target.id]] = STATUS_MARKER.slow;
        }
      } else if (effect.status === 'stasis') {
        const durationTicks = Math.max(1, Math.round(effect.durationSeconds * AUTHORITY_TICK_RATE));
        this.stasisUntilById[target.id] = Math.max(this.stasisUntilById[target.id], appliedTick + durationTicks);
        this.statusCodeById[target.id] = STATUS_MARKER.stasis;
        this.statusByIndex[this.indexById[target.id]] = STATUS_MARKER.stasis;
      } else continue;
      affected.push(this.enemy(target.id, target.generation));
    }
    if (!effect.deferCount) this.slowedCount = this.countSlowed();
    return affected;
  }

  scheduleRecall(targets, effect) {
    const affected = [];
    const delayTicks = Math.max(1, Math.round(effect.delaySeconds * AUTHORITY_TICK_RATE));
    for (const target of targets) {
      const current = this.enemy(target.id, target.generation);
      if (!current || this.recallUsedById[target.id] || this.recallDueById[target.id] > this.tickNumber) continue;
      const index = this.indexById[target.id];
      const offset = index * STATE_STRIDE;
      this.recallDueById[target.id] = this.tickNumber + delayTicks;
      this.recallUsedById[target.id] = 1;
      this.recallXById[target.id] = this.state[offset + X];
      this.recallYById[target.id] = this.state[offset + Y];
      if (this.stasisUntilById[target.id] <= this.tickNumber) {
        this.statusCodeById[target.id] = STATUS_MARKER.recall;
        this.statusByIndex[index] = STATUS_MARKER.recall;
      }
      affected.push(this.enemy(target.id, target.generation));
    }
    return affected;
  }

  applySlowNear(x, y, { radius, maxTargets, speedFactor, durationTicks }) {
    return this.applyStatus(this.enemiesInCircle(x, y, radius).slice(0, maxTargets), {
      type: 'status',
      status: 'slow',
      magnitude: 1 - speedFactor,
      durationSeconds: durationTicks / AUTHORITY_TICK_RATE
    });
  }

  countSlowed() {
    let count = 0;
    for (let index = 0; index < this.count; index += 1) {
      const id = this.idByIndex[index];
      if (this.slowUntilById[id] > this.tickNumber || this.stasisUntilById[id] > this.tickNumber) {
        count += this.unitsByIndex[index];
      }
    }
    return count;
  }

  findTarget(x, y, range, mode = 'closest', excludedIds = null) {
    const rangeSquared = range * range;
    const bounds = this.cellBounds(x - range, y - range, x + range, y + range);
    let bestIndex = -1;
    let bestPrimary = Infinity;
    let bestSecondary = Infinity;
    let bestId = Infinity;
    for (let row = bounds.minimumRow; row <= bounds.maximumRow; row += 1) {
      for (let column = bounds.minimumColumn; column <= bounds.maximumColumn; column += 1) {
        let index = this.bucketHead[row * this.gridColumns + column];
        while (index >= 0) {
          const id = this.idByIndex[index];
          if (this.reservedById[id] === 0 && !excludedIds?.has(id)) {
            const offset = index * STATE_STRIDE;
            const dx = this.state[offset + X] - x;
            const dy = this.state[offset + Y] - y;
            const towerDistanceSquared = dx * dx + dy * dy;
            if (towerDistanceSquared <= rangeSquared) {
              const baseDx = this.state[offset + X] - this.base.x;
              const baseDy = this.state[offset + Y] - this.base.y;
              const baseDistanceSquared = baseDx * baseDx + baseDy * baseDy;
              const cellDensity = this.density[this.cellIndex(this.state[offset + X], this.state[offset + Y])];
              const primary = mode === 'nearest_base'
                ? baseDistanceSquared
                : mode === 'farthest_base'
                  ? -baseDistanceSquared
                  : mode === 'densest_group'
                    ? -cellDensity
                    : towerDistanceSquared;
              const secondary = mode === 'closest' ? baseDistanceSquared : towerDistanceSquared;
              if (primary < bestPrimary || (primary === bestPrimary && (secondary < bestSecondary || (secondary === bestSecondary && id < bestId)))) {
                bestIndex = index;
                bestPrimary = primary;
                bestSecondary = secondary;
                bestId = id;
              }
            }
          }
          index = this.bucketNext[index];
        }
      }
    }
    return bestIndex < 0 ? null : this.enemyAtIndex(bestIndex);
  }

  findAnyUnreserved(x, y, excludedIds = null) {
    const centerColumn = Math.max(0, Math.min(this.gridColumns - 1, Math.floor((x - this.gridLeft) / GRID_CELL_SIZE)));
    const centerRow = Math.max(0, Math.min(this.gridRows - 1, Math.floor((y - this.gridTop) / GRID_CELL_SIZE)));
    const maximumRing = Math.max(this.gridColumns, this.gridRows);
    for (let ring = 0; ring < maximumRing; ring += 1) {
      let bestIndex = -1;
      let bestDistanceSquared = Infinity;
      let bestId = Infinity;
      const minimumColumn = Math.max(0, centerColumn - ring);
      const maximumColumn = Math.min(this.gridColumns - 1, centerColumn + ring);
      const minimumRow = Math.max(0, centerRow - ring);
      const maximumRow = Math.min(this.gridRows - 1, centerRow + ring);
      for (let row = minimumRow; row <= maximumRow; row += 1) {
        for (let column = minimumColumn; column <= maximumColumn; column += 1) {
          if (ring > 0 && row !== minimumRow && row !== maximumRow && column !== minimumColumn && column !== maximumColumn) continue;
          let index = this.bucketHead[row * this.gridColumns + column];
          while (index >= 0) {
            const id = this.idByIndex[index];
            if (this.reservedById[id] === 0 && !excludedIds?.has(id)) {
              const offset = index * STATE_STRIDE;
              const dx = this.state[offset + X] - x;
              const dy = this.state[offset + Y] - y;
              const distanceSquared = dx * dx + dy * dy;
              if (distanceSquared < bestDistanceSquared || (distanceSquared === bestDistanceSquared && id < bestId)) {
                bestIndex = index;
                bestDistanceSquared = distanceSquared;
                bestId = id;
              }
            }
            index = this.bucketNext[index];
          }
        }
      }
      if (bestIndex >= 0) return this.enemyAtIndex(bestIndex);
    }
    return null;
  }

  enemyAtIndex(index) {
    const id = this.idByIndex[index];
    const offset = index * STATE_STRIDE;
    return {
      id,
      generation: this.generationById[id],
      x: this.state[offset + X],
      y: this.state[offset + Y],
      vx: this.state[offset + VX],
      vy: this.state[offset + VY],
      hp: this.hpById[id],
      maxHp: this.maxHpById[id],
      status: this.statusCodeById[id],
      units: this.unitsByIndex[index]
    };
  }

  enemy(id, generation) {
    if (id < 1 || id >= this.nextFreshId || this.generationById[id] !== generation) return null;
    const index = this.indexById[id];
    return index < 0 ? null : this.enemyAtIndex(index);
  }

  reserve(id, generation) {
    if (!this.enemy(id, generation) || this.reservedById[id] !== 0) return false;
    this.reservedById[id] = 1;
    return true;
  }

  release(id, generation) {
    if (id >= 1 && id < this.nextFreshId && this.generationById[id] === generation) this.reservedById[id] = 0;
  }

  damage(id, generation, amount = 1, { packetWide = false } = {}) {
    const enemy = this.enemy(id, generation);
    if (!enemy) return null;
    const applied = damageFixed(Math.min(this.hpById[id], amount));
    this.hpById[id] = damageFixed(this.hpById[id] - applied);
    if (this.hpById[id] > 0) {
      return {
        ...enemy,
        damage: applied,
        hpPopped: applied * (packetWide ? enemy.units : 1),
        remainingHp: this.hpById[id],
        killed: false,
        unitsKilled: 0,
        unitsRemaining: enemy.units,
        recordRemoved: false
      };
    }

    const index = this.indexById[id];
    const unitsBefore = this.unitsByIndex[index];
    const unitsKilled = packetWide ? unitsBefore : 1;
    const bond = null; // Control bonds never propagate damage or kills.
    if (!packetWide && unitsBefore > 1) {
      this.unitsByIndex[index] = unitsBefore - 1;
      this.activeUnitCount -= 1;
      if (this.slowUntilById[id] > this.tickNumber || this.stasisUntilById[id] > this.tickNumber) {
        this.slowedCount = Math.max(0, this.slowedCount - 1);
      }
      this.hpById[id] = this.maxHpById[id];
      this.reservedById[id] = 0;
      return {
        ...enemy,
        damage: applied,
        hpPopped: applied * (packetWide ? enemy.units : 1),
        remainingHp: this.hpById[id],
        killed: true,
        unitsKilled: 1,
        unitsRemaining: unitsBefore - 1,
        recordRemoved: false,
        unitKey: `${id}:${generation}:${unitsBefore}`,
        bondKill: this.resolveBondKill(bond)
      };
    }

    this.remove(id, generation);
    return {
      ...enemy,
      damage: applied,
        hpPopped: applied * (packetWide ? enemy.units : 1),
      remainingHp: 0,
      killed: true,
      unitsKilled,
      unitsRemaining: 0,
      recordRemoved: true,
      unitKey: `${id}:${generation}:${unitsBefore}`,
      bondKill: this.resolveBondKill(bond)
    };
  }

  kill(id, generation, { packetWide = true, unitCount = null } = {}) {
    const enemy = this.enemy(id, generation);
    if (!enemy) return null;
    const unitsKilled = unitCount === null ? (packetWide ? enemy.units : 1) : Math.min(enemy.units, Math.max(0, Math.floor(unitCount)));
    if (unitsKilled < 1) return null;
    if (unitsKilled < enemy.units) {
      const index = this.indexById[id];
      this.unitsByIndex[index] -= unitsKilled;
      this.activeUnitCount -= unitsKilled;
      if (this.slowUntilById[id] > this.tickNumber || this.stasisUntilById[id] > this.tickNumber) {
        this.slowedCount = Math.max(0, this.slowedCount - unitsKilled);
      }
      this.reservedById[id] = 0;
      this.hpById[id] = this.maxHpById[id];
      return { ...enemy, hpPopped: enemy.hp + (unitsKilled - 1) * enemy.maxHp, killed: true, unitsKilled, unitsRemaining: enemy.units - unitsKilled, recordRemoved: false };
    }
    this.remove(id, generation);
    return { ...enemy, hpPopped: enemy.hp + (unitsKilled - 1) * enemy.maxHp, killed: true, unitsKilled, unitsRemaining: 0, recordRemoved: true };
  }

  remove(id, generation) {
    if (id < 1 || id >= this.nextFreshId || this.generationById[id] !== generation) return false;
    const index = this.indexById[id];
    if (index < 0) return false;
    if (this.bondPartnerById[id]) this.clearBond(id);
    const removedUnits = this.unitsByIndex[index];
    const lastIndex = this.count - 1;
    if (index !== lastIndex) {
      const sourceOffset = lastIndex * STATE_STRIDE;
      const targetOffset = index * STATE_STRIDE;
      this.state[targetOffset + X] = this.state[sourceOffset + X];
      this.state[targetOffset + Y] = this.state[sourceOffset + Y];
      this.state[targetOffset + VX] = this.state[sourceOffset + VX];
      this.state[targetOffset + VY] = this.state[sourceOffset + VY];
      const movedId = this.idByIndex[lastIndex];
      this.idByIndex[index] = movedId;
      this.indexById[movedId] = index;
      this.statusByIndex[index] = this.statusByIndex[lastIndex];
      this.unitsByIndex[index] = this.unitsByIndex[lastIndex];
    }
    this.count = lastIndex;
    this.activeUnitCount = Math.max(0, this.activeUnitCount - removedUnits);
    this.idByIndex[lastIndex] = 0;
    this.statusByIndex[lastIndex] = STATUS_MARKER.none;
    this.unitsByIndex[lastIndex] = 0;
    this.indexById[id] = -1;
    this.reservedById[id] = 0;
    this.hpById[id] = 0;
    this.maxHpById[id] = 0;
    if (this.slowUntilById[id] > this.tickNumber || this.stasisUntilById[id] > this.tickNumber) {
      this.slowedCount = Math.max(0, this.slowedCount - removedUnits);
    }
    this.slowUntilById[id] = 0;
    this.slowFactorById[id] = 1;
    this.stasisUntilById[id] = 0;
    this.recallDueById[id] = 0;
    for (const name of CONTROL_ID_NAMES) this[name][id] = 0;
    this.recallXById[id] = 0;
    this.recallYById[id] = 0;
    this.statusCodeById[id] = STATUS_MARKER.none;
    this.obstacleAreaById[id] = 0;
    this.obstacleSideById[id] = 0;
    this.freeIds[this.freeCount++] = id;
    return true;
  }

  updateChecksum() {
    let checksum = 2166136261;
    for (const value of [
      this.tickNumber,
      this.count,
      this.activeUnitCount,
      this.seed,
      this.randomState,
      this.nextFreshId,
      this.freeCount,
      this.spawnSourceCursor,
      this.spawnedTotal,
      Math.round(this.spawnAccumulator * 1000000),
      Math.round(this.spawnHpAccumulator * 1000000),
      this.spawnMixCursor,
      Math.round(this.spawnMixFraction * 1000000),
      Math.round(this.surgeAccumulator * 1000000)
    ]) {
      checksum ^= value;
      checksum = Math.imul(checksum, 16777619);
    }
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * STATE_STRIDE;
      const id = this.idByIndex[index];
      for (const value of [
        id,
        this.generationById[id],
        Math.round(this.state[offset + X] * 16),
        Math.round(this.state[offset + Y] * 16),
        Math.round(this.state[offset + VX] * 16),
        Math.round(this.state[offset + VY] * 16),
        this.unitsByIndex[index],
        Math.round(this.hpById[id] * 1000),
        Math.floor(this.hpById[id] / 4294967296),
        this.maxHpById[id],
        this.reservedById[id],
        this.slowUntilById[id],
        Math.round(this.slowFactorById[id] * 1000),
        this.stasisUntilById[id],
        this.recallDueById[id],
        Math.round(this.recallXById[id] * 16),
        Math.round(this.recallYById[id] * 16),
        this.statusCodeById[id],
        this.obstacleAreaById[id],
        this.obstacleSideById[id]
      ]) {
        checksum ^= value;
        checksum = Math.imul(checksum, 16777619);
      }
      for (const name of CONTROL_ID_NAMES) {
        checksum = Math.imul(checksum ^ this[name][id], 16777619);
      }
    }
    for (let index = 0; index < this.freeCount; index += 1) {
      checksum ^= this.freeIds[index];
      checksum = Math.imul(checksum, 16777619);
    }
    for (const source of this.bondSourceIds) {
      for (let character = 0; character < source.length; character += 1) {
        checksum = Math.imul(checksum ^ source.charCodeAt(character), 16777619);
      }
      checksum = Math.imul(checksum ^ 0xff, 16777619);
    }
    this.lastChecksum = (checksum >>> 0).toString(16).padStart(8, '0');
    return this.lastChecksum;
  }

  exportCorrection() {
    const identityLength = this.nextFreshId;
    return {
      tick: this.tickNumber,
      seed: this.seed,
      capacity: this.capacity,
      count: this.count,
      activeUnitCount: this.activeUnitCount,
      randomState: this.randomState,
      nextFreshId: this.nextFreshId,
      freeCount: this.freeCount,
      spawnAccumulator: this.spawnAccumulator,
      spawnHpAccumulator: this.spawnHpAccumulator,
      spawnMixCursor: this.spawnMixCursor,
      spawnMixFraction: this.spawnMixFraction,
      surgeAccumulator: this.surgeAccumulator,
      spawnSourceCursor: this.spawnSourceCursor,
      spawnedTotal: this.spawnedTotal,
      state: this.state.slice(0, this.count * STATE_STRIDE),
      idByIndex: this.idByIndex.slice(0, this.count),
      unitsByIndex: this.unitsByIndex.slice(0, this.count),
      generationById: this.generationById.slice(0, identityLength),
      reservedById: this.reservedById.slice(0, identityLength),
      hpById: this.hpById.slice(0, identityLength),
      maxHpById: this.maxHpById.slice(0, identityLength),
      slowUntilById: this.slowUntilById.slice(0, identityLength),
      slowFactorById: this.slowFactorById.slice(0, identityLength),
      stasisUntilById: this.stasisUntilById.slice(0, identityLength),
      recallDueById: this.recallDueById.slice(0, identityLength),
      ...Object.fromEntries(CONTROL_ID_NAMES.map((name) => [name, this[name].slice(0, identityLength)])),
      bondSourceIds: [...this.bondSourceIds],
      recallXById: this.recallXById.slice(0, identityLength),
      recallYById: this.recallYById.slice(0, identityLength),
      statusCodeById: this.statusCodeById.slice(0, identityLength),
      obstacleAreaById: this.obstacleAreaById.slice(0, identityLength),
      obstacleSideById: this.obstacleSideById.slice(0, identityLength),
      freeIds: this.freeIds.slice(0, this.freeCount)
    };
  }

  applyCorrection(correction) {
    if (!correction || !Number.isSafeInteger(correction.count) || correction.count < 0) throw new Error('swarm correction count is invalid');
    if (!Number.isSafeInteger(correction.nextFreshId) || correction.nextFreshId < 1) throw new Error('swarm correction identity range is invalid');
    if (correction.seed !== undefined && (!Number.isSafeInteger(correction.seed) || correction.seed < 0 || correction.seed > 0xffffffff)) {
      throw new Error('swarm correction seed is invalid');
    }
    if (correction.state.length !== correction.count * STATE_STRIDE || correction.idByIndex.length !== correction.count) {
      throw new Error('swarm correction payload length is invalid');
    }
    if (correction.unitsByIndex && correction.unitsByIndex.length !== correction.count) {
      throw new Error('swarm correction packet table is invalid');
    }
    const identityLength = correction.nextFreshId;
    for (const table of ['generationById', 'reservedById', 'hpById', 'maxHpById', 'slowUntilById', 'slowFactorById', 'statusCodeById']) {
      if (correction[table].length !== identityLength) throw new Error(`swarm correction ${table} is invalid`);
    }
    for (const table of ['stasisUntilById', 'recallDueById', 'recallCooldownUntilById', 'recallXById', 'recallYById']) {
      if (correction[table] && correction[table].length !== identityLength) throw new Error(`swarm correction ${table} is invalid`);
    }
    for (const name of CONTROL_ID_NAMES) {
      if (correction[name] && correction[name].length !== identityLength) throw new Error(`swarm correction ${name} is invalid`);
    }
    const bondSources = correction.bondSourceIds || [''];
    if (!Array.isArray(bondSources) || bondSources[0] !== ''
      || bondSources.some((source, index) => typeof source !== 'string' || (index > 0 && !source))
      || new Set(bondSources).size !== bondSources.length) throw new Error('swarm correction bond sources are invalid');
    for (const table of ['obstacleAreaById', 'obstacleSideById']) {
      if (correction[table] && correction[table].length !== identityLength) throw new Error(`swarm correction ${table} is invalid`);
    }
    if (correction.freeIds.length !== correction.freeCount || correction.freeCount + correction.count !== correction.nextFreshId - 1) {
      throw new Error('swarm correction free-id table is invalid');
    }

    this.ensureCapacity(Math.max(correction.capacity || 0, correction.count, correction.nextFreshId - 1));
    this.count = correction.count;
    this.tickNumber = correction.tick;
    if (Number.isFinite(correction.seed)) this.seed = correction.seed >>> 0;
    this.randomState = correction.randomState >>> 0;
    this.nextFreshId = correction.nextFreshId;
    this.freeCount = correction.freeCount;
    this.spawnAccumulator = correction.spawnAccumulator;
    this.spawnHpAccumulator = correction.spawnHpAccumulator || 0;
    this.spawnMixCursor = correction.spawnMixCursor || 0;
    this.spawnMixFraction = correction.spawnMixFraction || 0;
    this.surgeAccumulator = correction.surgeAccumulator || 0;
    this.spawnSourceCursor = correction.spawnSourceCursor;
    this.spawnedTotal = correction.spawnedTotal;
    this.state.fill(0);
    this.state.set(correction.state);
    this.idByIndex.fill(0);
    this.idByIndex.set(correction.idByIndex);
    this.unitsByIndex.fill(0);
    if (correction.unitsByIndex) this.unitsByIndex.set(correction.unitsByIndex);
    else this.unitsByIndex.fill(1, 0, this.count);
    this.activeUnitCount = 0;
    this.indexById.fill(-1);
    this.generationById.fill(0);
    this.generationById.set(correction.generationById);
    this.reservedById.fill(0);
    this.reservedById.set(correction.reservedById);
    this.hpById.fill(0);
    this.hpById.set(correction.hpById);
    this.maxHpById.fill(0);
    this.maxHpById.set(correction.maxHpById);
    this.slowUntilById.fill(0);
    this.slowUntilById.set(correction.slowUntilById);
    this.slowFactorById.fill(1);
    this.slowFactorById.set(correction.slowFactorById);
    this.stasisUntilById.fill(0);
    if (correction.stasisUntilById) this.stasisUntilById.set(correction.stasisUntilById);
    this.recallDueById.fill(0);
    if (correction.recallDueById) this.recallDueById.set(correction.recallDueById);
    for (const name of CONTROL_ID_NAMES) {
      this[name].fill(0);
      if (correction[name]) this[name].set(correction[name]);
    }
    // Old saves retain spent recalls instead of quietly rearming every enemy.
    if (!correction.recallUsedById) {
      for (let id = 1; id < identityLength; id += 1) {
        this.recallUsedById[id] = correction.recallCooldownUntilById?.[id] > 0 || this.recallDueById[id] > 0 ? 1 : 0;
      }
    }
    this.bondSourceIds = [...bondSources];
    this.bondSourceIndex = new Map(this.bondSourceIds.slice(1).map((source, index) => [source, index + 1]));
    this.recallXById.fill(0);
    if (correction.recallXById) this.recallXById.set(correction.recallXById);
    this.recallYById.fill(0);
    if (correction.recallYById) this.recallYById.set(correction.recallYById);
    this.statusCodeById.fill(0);
    this.statusCodeById.set(correction.statusCodeById);
    this.obstacleAreaById.fill(0);
    if (correction.obstacleAreaById) this.obstacleAreaById.set(correction.obstacleAreaById);
    this.obstacleSideById.fill(0);
    if (correction.obstacleSideById) this.obstacleSideById.set(correction.obstacleSideById);
    this.speedById.fill(0);
    for (let id = 1; id < identityLength; id += 1) this.speedById[id] = 50 + (hash32(id) & 15);
    this.freeIds.fill(0);
    this.freeIds.set(correction.freeIds);
    this.statusByIndex.fill(0);
    for (let index = 0; index < this.count; index += 1) {
      const id = this.idByIndex[index];
      if (id < 1 || id >= this.nextFreshId || this.indexById[id] !== -1) throw new Error('swarm correction contains duplicate or invalid ids');
      const obstacleArea = this.obstacleAreaById[id];
      const obstacleSide = this.obstacleSideById[id];
      if (obstacleArea > this.defenseAreas.length || obstacleSide < -1 || obstacleSide > 1 || (obstacleArea === 0) !== (obstacleSide === 0)) {
        throw new Error('swarm correction contains invalid obstacle routing state');
      }
      this.indexById[id] = index;
      this.statusByIndex[index] = this.statusCodeById[id];
      const units = this.unitsByIndex[index];
      if (!Number.isSafeInteger(units) || units < 1) throw new Error('swarm correction contains invalid packet units');
      this.activeUnitCount += units;
    }
    if (correction.activeUnitCount !== undefined && correction.activeUnitCount !== this.activeUnitCount) {
      throw new Error('swarm correction active population is invalid');
    }
    for (let index = 0; index < this.count; index += 1) {
      const id = this.idByIndex[index];
      const partner = this.bondPartnerById[id];
      if (this.recallUsedById[id] > 1) throw new Error('swarm correction recall state is invalid');
      if (!partner) {
        if (BOND_TABLES.some((name) => this[name][id] !== 0)) throw new Error('swarm correction contains an orphaned bond');
        continue;
      }
      if (partner === id || partner >= identityLength || this.indexById[partner] < 0
        || this.bondPartnerById[partner] !== id
        || this.bondGenerationById[id] !== this.generationById[partner]
        || this.bondGenerationById[partner] !== this.generationById[id]
        || this.bondUntilById[id] !== this.bondUntilById[partner]
        || this.bondSourceById[id] !== this.bondSourceById[partner]
        || this.bondSourceById[id] < 1 || this.bondSourceById[id] >= this.bondSourceIds.length
        || !Number.isSafeInteger(this.bondUnitsById[id]) || this.bondUnitsById[id] < 1
        || this.bondUnitsById[id] !== this.bondUnitsById[partner]
        || this.bondUnitsById[id] > this.unitsByIndex[index]) {
        throw new Error('swarm correction contains an invalid bond pair');
      }
    }
    this.rebuildSpatialIndex();
    this.slowedCount = this.countSlowed();
    this.updateChecksum();
  }

  presentation(alpha = 0) {
    return {
      tick: this.tickNumber,
      alpha,
      count: this.count,
      activeUnitCount: this.activeUnitCount,
      capacity: this.capacity,
      idByIndex: this.idByIndex,
      indexById: this.indexById,
      bondPartnerById: this.bondPartnerById,
      bondUntilById: this.bondUntilById,
      bondSourceById: this.bondSourceById,
      bondSourceIds: this.bondSourceIds,
      state: this.state,
      hpById: this.hpById,
      status: this.statusByIndex,
      units: this.unitsByIndex,
      checksum: this.lastChecksum
    };
  }
}
