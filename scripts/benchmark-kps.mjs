import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { AUTHORITY_TICK_RATE } from '../src/core/protocol.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import {
  TOWER_DEFINITIONS,
  towerBuildQuote,
  validateTowerCatalog
} from '../src/core/tower-catalog.js';
import { findDefenseAreaAt, getMapDefinition } from '../src/core/world-config.js';

const DEFAULT_RATES = Object.freeze([10, 100, 1000, 10000]);
const DEFAULT_POSITION = Object.freeze({ x: 0, y: 238 });
const DEFAULT_OPTIONS = Object.freeze({
  rates: DEFAULT_RATES,
  forms: Object.keys(TOWER_DEFINITIONS),
  sources: ['test_top'],
  enemyHp: 1,
  targetingMode: 'closest',
  warmupSeconds: 15,
  settleSeconds: 4,
  measureSeconds: 12,
  settleExplicit: false,
  measureExplicit: false,
  runs: 1,
  workers: Math.max(1, Math.min(4, cpus().length)),
  format: 'table',
  quiet: false
});

function fail(message) {
  process.stderr.write(`balance benchmark failed // ${message}\n`);
  process.exitCode = 1;
  return null;
}

function commaList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function finiteNumber(value, label, { minimum = 0, maximum = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    ...DEFAULT_OPTIONS,
    rates: [...DEFAULT_OPTIONS.rates],
    forms: [...DEFAULT_OPTIONS.forms],
    sources: [...DEFAULT_OPTIONS.sources]
  };
  for (const argument of argv) {
    if (argument === '--json') options.format = 'json';
    else if (argument === '--csv') options.format = 'csv';
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--hp=')) {
      options.enemyHp = Math.round(finiteNumber(argument.slice('--hp='.length), 'enemy hp', { minimum: 1, maximum: 1000000 }));
    } else if (argument.startsWith('--rates=')) {
      options.rates = commaList(argument.slice('--rates='.length)).map((rate) => finiteNumber(rate, 'spawn rate', { minimum: 0, maximum: 100000 }));
    } else if (argument.startsWith('--forms=')) {
      const forms = commaList(argument.slice('--forms='.length));
      options.forms = forms.length === 1 && forms[0] === 'all' ? Object.keys(TOWER_DEFINITIONS) : forms;
    } else if (argument.startsWith('--sources=')) {
      options.sources = commaList(argument.slice('--sources='.length)).map((source) => source.startsWith('test_') ? source : `test_${source}`);
    } else if (argument.startsWith('--target=')) {
      options.targetingMode = argument.slice('--target='.length);
    } else if (argument.startsWith('--warmup=')) {
      options.warmupSeconds = finiteNumber(argument.slice('--warmup='.length), 'warmup seconds', { maximum: 300 });
    } else if (argument.startsWith('--settle=')) {
      options.settleSeconds = finiteNumber(argument.slice('--settle='.length), 'settle seconds', { maximum: 300 });
      options.settleExplicit = true;
    } else if (argument.startsWith('--measure=')) {
      options.measureSeconds = finiteNumber(argument.slice('--measure='.length), 'measurement seconds', { minimum: 1, maximum: 600 });
      options.measureExplicit = true;
    } else if (argument.startsWith('--runs=')) {
      options.runs = Math.round(finiteNumber(argument.slice('--runs='.length), 'runs', { minimum: 1, maximum: 20 }));
    } else if (argument.startsWith('--workers=')) {
      options.workers = Math.round(finiteNumber(argument.slice('--workers='.length), 'workers', { minimum: 1, maximum: 16 }));
    } else {
      throw new Error(`unknown option ${argument}`);
    }
  }
  if (!options.rates.length) throw new Error('at least one spawn rate is required');
  if (!options.forms.length) throw new Error('at least one tower form is required');
  if (!options.sources.length) throw new Error('at least one spawn source is required');
  return options;
}

function printHelp() {
  process.stdout.write([
    'framebound horde practical kps benchmark',
    '',
    'usage // npm run balance:kps -- [options]',
    '',
    '--rates=10,100,1000,10000   total enemies spawned per second',
    '--hp=1                      hp per enemy; above 1 the table reports hp removed per second',
    '--forms=all                  comma-separated tower form ids',
    '--sources=top                test source ids, with or without test_ prefix',
    '--target=closest             player targeting mode',
    '--warmup=15                  enemy-only stocking time in seconds',
    '--settle=4                   override tower stabilization time',
    '--measure=12                 override measured simulation time',
    '--runs=1                     deterministic seeds to average',
    '--workers=4                  parallel simulation workers',
    '--json                       machine-readable full report',
    '--csv                        spreadsheet-friendly kps table',
    '--quiet                      hide progress messages',
    '',
    'default sparse timing // 15s settle + 30s measured at 10/s; 4s + 12s otherwise',
    ''
  ].join('\n'));
}

function validateOptions(options) {
  const catalogErrors = validateTowerCatalog();
  if (catalogErrors.length) throw new Error(`tower catalog is invalid: ${catalogErrors.join('; ')}`);
  for (const formId of options.forms) {
    const definition = TOWER_DEFINITIONS[formId];
    if (!definition) throw new Error(`unknown tower form ${formId}`);
    if (!definition.targetingModes?.includes(options.targetingMode)) {
      throw new Error(`${formId} does not support targeting mode ${options.targetingMode}`);
    }
  }
  const map = getMapDefinition(TEST_FIELD_SESSION_CONFIG.mapId);
  const validSources = new Set(map.spawnSources.map((source) => source.id));
  for (const sourceId of options.sources) {
    if (!validSources.has(sourceId)) throw new Error(`unknown test spawn source ${sourceId}`);
  }
  const areaId = findDefenseAreaAt(map, DEFAULT_POSITION.x, DEFAULT_POSITION.y);
  if (!areaId) throw new Error('benchmark tower position is outside the test nebula');
  return { map, areaId };
}

function benchmarkSeed(runIndex) {
  return (TEST_FIELD_SESSION_CONFIG.seed + Math.imul(runIndex, 0x9e3779b1)) >>> 0;
}

function scenarioConfig({ rate, runIndex, sources, enemyHp = 1 }) {
  return {
    ...TEST_FIELD_SESSION_CONFIG,
    sessionId: `balance_${rate}_${runIndex}`,
    seed: benchmarkSeed(runIndex),
    towers: [],
    test: {
      ...TEST_FIELD_SESSION_CONFIG.test,
      spawnRatePerSecond: rate,
      enemyHp,
      invincibleBase: true,
      paused: false,
      timeScale: 1,
      activeSpawnSourceIds: [...sources],
      spawnSourceOverrides: {}
    }
  };
}

function disablePresentationEvents(authority) {
  authority.events.length = 0;
  authority.emit = () => null;
}

function runTicks(authority, seconds) {
  const ticks = Math.round(seconds * AUTHORITY_TICK_RATE);
  for (let tick = 0; tick < ticks; tick += 1) authority.tick();
}

function scenarioTiming(rate, options) {
  return {
    warmupSeconds: options.warmupSeconds,
    settleSeconds: options.settleExplicit
      ? options.settleSeconds
      : rate <= 10 ? Math.max(15, options.settleSeconds) : options.settleSeconds,
    measureSeconds: options.measureExplicit
      ? options.measureSeconds
      : rate <= 10 ? Math.max(30, options.measureSeconds) : options.measureSeconds
  };
}

function warmScenario(rate, runIndex, options) {
  const authority = new EmbeddedAuthority(scenarioConfig({ rate, runIndex, sources: options.sources, enemyHp: options.enemyHp }));
  disablePresentationEvents(authority);
  runTicks(authority, options.warmupSeconds);
  return authority.correctionSnapshot();
}

function benchmarkTowerRecord(formId, areaId) {
  const quote = towerBuildQuote(TOWER_DEFINITIONS, formId);
  return {
    id: 'tower_1',
    ownerId: 'benchmark',
    definitionId: formId,
    x: DEFAULT_POSITION.x,
    y: DEFAULT_POSITION.y,
    areaId,
    targetingMode: 'closest',
    totalInvestment: quote.cost,
    fireCharge: 0,
    formHistory: quote.path,
    kills: 0,
    lastKillTick: 0,
    supportTriggers: 0,
    bonusCredits: 0
  };
}

function correctionWithTower(warmCorrection, formId, areaId, targetingMode) {
  const tower = { ...benchmarkTowerRecord(formId, areaId), targetingMode };
  return {
    ...warmCorrection,
    authority: {
      ...warmCorrection.authority,
      nextTowerNumber: 2,
      nextProjectileNumber: 1,
      nextFieldNumber: 1,
      nextAttackFieldNumber: 1
    },
    state: {
      ...warmCorrection.state,
      towers: [tower],
      projectiles: [],
      attackFields: [],
      forceFields: [],
      supportCounters: {}
    }
  };
}

function measureTower(warmCorrection, formId, rate, runIndex, options, areaId) {
  const timing = scenarioTiming(rate, options);
  const authority = new EmbeddedAuthority(scenarioConfig({ rate, runIndex, sources: options.sources, enemyHp: options.enemyHp }));
  disablePresentationEvents(authority);
  authority.applyCorrectionSnapshot(correctionWithTower(warmCorrection, formId, areaId, options.targetingMode));
  runTicks(authority, timing.settleSeconds);

  const start = {
    kills: authority.state.stats.kills,
    hpPopped: authority.state.stats.hpPopped || 0,
    hits: authority.state.stats.hits,
    shotsFired: authority.state.stats.shotsFired,
    shotsResolved: authority.state.stats.shotsResolved,
    spawned: authority.state.stats.spawned,
    activeEnemies: authority.swarm.activeUnitCount,
    records: authority.swarm.count
  };
  const wallStarted = performance.now();
  runTicks(authority, timing.measureSeconds);
  const wallSeconds = (performance.now() - wallStarted) / 1000;
  const end = authority.state;
  const kills = end.stats.kills - start.kills;
  const shotsFired = end.stats.shotsFired - start.shotsFired;
  const shotsResolved = end.stats.shotsResolved - start.shotsResolved;
  const spawned = end.stats.spawned - start.spawned;
  return {
    formId,
    rate,
    run: runIndex + 1,
    kills,
    kps: kills / timing.measureSeconds,
    hpPerSecond: ((end.stats.hpPopped || 0) - start.hpPopped) / timing.measureSeconds,
    hits: end.stats.hits - start.hits,
    shotsFired,
    shotsResolved,
    killsPerShot: shotsFired > 0 ? kills / shotsFired : 0,
    spawned,
    capturePercent: spawned > 0 ? kills / spawned * 100 : 0,
    activeEnemiesStart: start.activeEnemies,
    activeEnemiesEnd: authority.swarm.activeUnitCount,
    recordsStart: start.records,
    recordsEnd: authority.swarm.count,
    projectilesEnd: end.projectiles.length,
    oldestProjectileAgeSeconds: end.projectiles.reduce((oldest, projectile) => Math.max(
      oldest,
      (end.runTick - (projectile.createdTick ?? projectile.attack?.createdTick ?? end.runTick)) / AUTHORITY_TICK_RATE
    ), 0),
    timing,
    wallSeconds,
    simulationToWallRatio: timing.measureSeconds / Math.max(0.000001, wallSeconds)
  };
}

function workerRequest(worker, message) {
  return new Promise((resolve, reject) => {
    const onMessage = (reply) => {
      cleanup();
      if (reply?.error) reject(new Error(reply.error));
      else resolve(reply?.value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage(message);
  });
}

function createWorkerPool(size) {
  const workers = Array.from({ length: size }, () => new Worker(new URL(import.meta.url)));
  return {
    size,
    async load(warmCorrection, rate, runIndex, options, areaId) {
      await Promise.all(workers.map((worker) => workerRequest(worker, {
        type: 'load',
        warmCorrection,
        rate,
        runIndex,
        options,
        areaId
      })));
    },
    async measure(formIds, onStart = () => {}) {
      const results = [];
      let cursor = 0;
      await Promise.all(workers.map(async (worker) => {
        while (cursor < formIds.length) {
          const formId = formIds[cursor++];
          onStart(formId);
          results.push(await workerRequest(worker, { type: 'measure', formId }));
        }
      }));
      return results;
    },
    async close() {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  };
}

function startWorker() {
  let context = null;
  parentPort.on('message', (message) => {
    try {
      if (message.type === 'load') {
        context = message;
        parentPort.postMessage({ value: true });
        return;
      }
      if (message.type !== 'measure' || !context) throw new Error('benchmark worker has no loaded scenario');
      parentPort.postMessage({
        value: measureTower(
          context.warmCorrection,
          message.formId,
          context.rate,
          context.runIndex,
          context.options,
          context.areaId
        )
      });
    } catch (error) {
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function aggregateMeasurements(measurements, options) {
  return options.forms.map((formId) => {
    const definition = TOWER_DEFINITIONS[formId];
    const quote = towerBuildQuote(TOWER_DEFINITIONS, formId);
    const rates = {};
    for (const rate of options.rates) {
      const samples = measurements.filter((sample) => sample.formId === formId && sample.rate === rate);
      const average = (key) => samples.reduce((total, sample) => total + sample[key], 0) / samples.length;
      rates[rate] = {
        kps: average('kps'),
        hpPerSecond: average('hpPerSecond'),
        minimumKps: Math.min(...samples.map((sample) => sample.kps)),
        maximumKps: Math.max(...samples.map((sample) => sample.kps)),
        killsPerShot: average('killsPerShot'),
        capturePercent: average('capturePercent'),
        activeEnemiesEnd: average('activeEnemiesEnd'),
        recordsEnd: average('recordsEnd'),
        projectilesEnd: average('projectilesEnd'),
        oldestProjectileAgeSeconds: Math.max(...samples.map((sample) => sample.oldestProjectileAgeSeconds)),
        simulationToWallRatio: average('simulationToWallRatio'),
        samples
      };
    }
    return {
      formId,
      role: definition.role,
      cost: quote.cost,
      path: quote.path,
      rates
    };
  });
}

function fixed(value) {
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function printTable(report) {
  const fat = (report.config.enemyHp || 1) !== 1;
  const headers = ['tower', 'cost', ...report.config.rates.map((rate) => `${rate}/s`)];
  const rows = report.towers.map((tower) => [
    tower.formId,
    String(tower.cost),
    ...report.config.rates.map((rate) => fixed(fat ? tower.rates[rate].hpPerSecond : tower.rates[rate].kps))
  ]);
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  process.stdout.write([
    (report.config.enemyHp || 1) !== 1 ? `hp removed per second // ${report.config.enemyHp} hp enemies // actual fixed-tick combat` : 'practical kps // actual fixed-tick combat',
    `scenario // test_field at ${report.config.position.x},${report.config.position.y} // ${report.config.targetingMode} // ${report.config.sources.join(',')}`,
    `timing // ${report.config.rates.map((rate) => {
      const timing = report.config.timingByRate[rate];
      return `${rate}/s=${timing.warmupSeconds}+${timing.settleSeconds}+${timing.measureSeconds}s`;
    }).join(' // ')} // ${report.config.runs} run(s)`,
    '',
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map(line),
    '',
    'note // this is a reproducible balance lane, not a universal map-wide promise. rerun after weapon or movement changes.',
    ''
  ].join('\n'));
}

function printCsv(report) {
  const headers = ['tower', 'cost', ...report.config.rates.map((rate) => `kps_${rate}`)];
  const rows = report.towers.map((tower) => [
    tower.formId,
    tower.cost,
    ...report.config.rates.map((rate) => tower.rates[rate].kps.toFixed(4))
  ]);
  process.stdout.write([headers, ...rows].map((row) => row.join(',')).join('\n') + '\n');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const { areaId } = validateOptions(options);
    const measurements = [];
    const started = performance.now();
    const workerCount = Math.min(options.workers, options.forms.length);
    const pool = createWorkerPool(workerCount);
    try {
      for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
        for (const rate of options.rates) {
          if (!options.quiet) process.stderr.write(`stocking ${rate}/s // run ${runIndex + 1}/${options.runs} // ${workerCount} workers\n`);
          const warmCorrection = warmScenario(rate, runIndex, options);
          await pool.load(warmCorrection, rate, runIndex, options, areaId);
          measurements.push(...await pool.measure(options.forms, (formId) => {
            if (!options.quiet) process.stderr.write(`  ${formId}\n`);
          }));
        }
      }
    } finally {
      await pool.close();
    }
    const timingByRate = Object.fromEntries(options.rates.map((rate) => [rate, scenarioTiming(rate, options)]));
    const report = {
      config: {
        rates: options.rates,
        enemyHp: options.enemyHp,
        forms: options.forms,
        sources: options.sources,
        targetingMode: options.targetingMode,
        warmupSeconds: options.warmupSeconds,
        settleSeconds: options.settleSeconds,
        measureSeconds: options.measureSeconds,
        timingByRate,
        runs: options.runs,
        workers: workerCount,
        position: DEFAULT_POSITION,
        authorityTickRate: AUTHORITY_TICK_RATE
      },
      wallSeconds: (performance.now() - started) / 1000,
      towers: aggregateMeasurements(measurements, options)
    };
    if (options.format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else if (options.format === 'csv') printCsv(report);
    else printTable(report);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (isMainThread) await main();
else startWorker();
