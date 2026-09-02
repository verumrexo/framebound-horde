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

const POSITION = Object.freeze({ x: 0, y: 238 });
const ASSAULT_FAMILY = Object.freeze([
  'frame',
  'assault',
  'barrage',
  'broadside',
  'flechette',
  'cyclone',
  'rocket',
  'warhead',
  'cluster',
  'salvo',
  'laser',
  'cutter',
  'prism',
  'sweeper'
]);

const SCENARIOS = Object.freeze({
  early: Object.freeze({
    id: 'early',
    label: 'early // one front',
    spawnRate: 50,
    sources: Object.freeze(['test_top']),
    leadSeconds: 12,
    measureSeconds: 20,
    drainSeconds: 30,
    spawnBudget: 1600
  }),
  mid: Object.freeze({
    id: 'mid',
    label: 'mid // three fronts',
    spawnRate: 400,
    sources: Object.freeze(['test_top', 'test_split_left', 'test_split_right']),
    leadSeconds: 10,
    measureSeconds: 12,
    drainSeconds: 30,
    spawnBudget: 8800
  }),
  late: Object.freeze({
    id: 'late',
    label: 'late // five fronts',
    spawnRate: 1000,
    sources: Object.freeze(['test_top', 'test_left', 'test_right', 'test_split_left', 'test_split_right']),
    leadSeconds: 8,
    measureSeconds: 10,
    drainSeconds: 30,
    spawnBudget: 18000
  })
});

const DEFAULT_OPTIONS = Object.freeze({
  forms: ASSAULT_FAMILY,
  scenarios: Object.keys(SCENARIOS),
  targetingMode: 'closest',
  runs: 1,
  workers: Math.max(1, Math.min(4, cpus().length)),
  format: 'table',
  quiet: false
});

function commaList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function boundedInteger(value, label, minimum, maximum) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    ...DEFAULT_OPTIONS,
    forms: [...DEFAULT_OPTIONS.forms],
    scenarios: [...DEFAULT_OPTIONS.scenarios]
  };
  for (const argument of argv) {
    if (argument === '--json') options.format = 'json';
    else if (argument === '--csv') options.format = 'csv';
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--forms=')) {
      const forms = commaList(argument.slice('--forms='.length));
      options.forms = forms.length === 1 && forms[0] === 'all'
        ? Object.keys(TOWER_DEFINITIONS)
        : forms.length === 1 && forms[0] === 'assault'
          ? [...ASSAULT_FAMILY]
          : forms;
    } else if (argument.startsWith('--scenarios=')) {
      options.scenarios = commaList(argument.slice('--scenarios='.length));
    } else if (argument.startsWith('--target=')) {
      options.targetingMode = argument.slice('--target='.length);
    } else if (argument.startsWith('--runs=')) {
      options.runs = boundedInteger(argument.slice('--runs='.length), 'runs', 1, 20);
    } else if (argument.startsWith('--workers=')) {
      options.workers = boundedInteger(argument.slice('--workers='.length), 'workers', 1, 16);
    } else {
      throw new Error(`unknown option ${argument}`);
    }
  }
  if (!options.forms.length) throw new Error('at least one tower form is required');
  if (!options.scenarios.length) throw new Error('at least one scenario is required');
  return options;
}

function printHelp() {
  process.stdout.write([
    'framebound horde gameplay balance profile',
    '',
    'usage // npm run balance:gameplay -- [options]',
    '',
    '--forms=assault             assault family (default), all, or comma-separated ids',
    '--scenarios=early,mid,late  naturally arriving gameplay profiles',
    '--target=closest            player targeting mode',
    '--runs=1                    deterministic seeds to average',
    '--workers=4                 parallel simulation workers',
    '--json                      machine-readable full report',
    '--csv                       spreadsheet-friendly metrics',
    '--quiet                     hide progress messages',
    '',
    'the old balance:kps command remains an isolated saturation stress test.',
    ''
  ].join('\n'));
}

function validateOptions(options) {
  const errors = validateTowerCatalog();
  if (errors.length) throw new Error(`tower catalog is invalid: ${errors.join('; ')}`);
  for (const formId of options.forms) {
    const definition = TOWER_DEFINITIONS[formId];
    if (!definition) throw new Error(`unknown tower form ${formId}`);
    if (!definition.targetingModes?.includes(options.targetingMode)) {
      throw new Error(`${formId} does not support targeting mode ${options.targetingMode}`);
    }
  }
  for (const scenarioId of options.scenarios) {
    if (!SCENARIOS[scenarioId]) throw new Error(`unknown gameplay scenario ${scenarioId}`);
  }
  const map = getMapDefinition(TEST_FIELD_SESSION_CONFIG.mapId);
  const sourceIds = new Set(map.spawnSources.map((source) => source.id));
  for (const scenarioId of options.scenarios) {
    for (const sourceId of SCENARIOS[scenarioId].sources) {
      if (!sourceIds.has(sourceId)) throw new Error(`${scenarioId} uses unknown source ${sourceId}`);
    }
  }
  const areaId = findDefenseAreaAt(map, POSITION.x, POSITION.y);
  if (!areaId) throw new Error('gameplay benchmark tower position is outside the test nebula');
  return areaId;
}

function scenarioSeed(scenarioId, runIndex) {
  const scenarioIndex = Object.keys(SCENARIOS).indexOf(scenarioId) + 1;
  return (TEST_FIELD_SESSION_CONFIG.seed
    + Math.imul(scenarioIndex, 0x85ebca6b)
    + Math.imul(runIndex, 0x9e3779b1)) >>> 0;
}

function towerRecord(formId, areaId, targetingMode) {
  const quote = towerBuildQuote(TOWER_DEFINITIONS, formId);
  return {
    id: 'tower_1',
    ownerId: 'benchmark',
    definitionId: formId,
    x: POSITION.x,
    y: POSITION.y,
    areaId,
    targetingMode,
    totalInvestment: quote.cost,
    fireCharge: 0,
    formHistory: quote.path,
    kills: 0,
    lastKillTick: 0,
    supportTriggers: 0,
    bonusCredits: 0
  };
}

function authorityFor(job, areaId) {
  const scenario = SCENARIOS[job.scenarioId];
  const towers = job.formId ? [towerRecord(job.formId, areaId, job.targetingMode)] : [];
  const authority = new EmbeddedAuthority({
    ...TEST_FIELD_SESSION_CONFIG,
    sessionId: `gameplay_${job.scenarioId}_${job.formId || 'control'}_${job.runIndex}`,
    seed: scenarioSeed(job.scenarioId, job.runIndex),
    startingLives: 1000000000,
    towers,
    test: {
      ...TEST_FIELD_SESSION_CONFIG.test,
      spawnRatePerSecond: scenario.spawnRate,
      enemyHp: 1,
      invincibleBase: true,
      paused: false,
      timeScale: 1,
      activeSpawnSourceIds: [...scenario.sources],
      spawnSourceOverrides: {}
    }
  });
  authority.events.length = 0;
  authority.emit = () => null;
  return authority;
}

function runTicks(authority, seconds, onTick = null) {
  const ticks = Math.round(seconds * AUTHORITY_TICK_RATE);
  for (let tick = 0; tick < ticks; tick += 1) {
    authority.tick();
    if (onTick) onTick(authority);
  }
}

function stateCounters(authority) {
  return {
    kills: authority.state.stats.kills,
    breaches: authority.state.stats.breaches,
    spawned: authority.state.stats.spawned,
    shotsFired: authority.state.stats.shotsFired,
    shotsResolved: authority.state.stats.shotsResolved,
    active: authority.swarm.activeUnitCount,
    records: authority.swarm.count
  };
}

function measureJob(job, areaId) {
  const scenario = SCENARIOS[job.scenarioId];
  const authority = authorityFor(job, areaId);
  runTicks(authority, scenario.leadSeconds);
  const start = stateCounters(authority);
  let peakActive = start.active;
  let peakRecords = start.records;
  const wallStarted = performance.now();
  runTicks(authority, scenario.measureSeconds, (current) => {
    peakActive = Math.max(peakActive, current.swarm.activeUnitCount);
    peakRecords = Math.max(peakRecords, current.swarm.count);
  });
  const wallSeconds = (performance.now() - wallStarted) / 1000;
  const end = stateCounters(authority);
  const kills = end.kills - start.kills;
  const breaches = end.breaches - start.breaches;
  const spawned = end.spawned - start.spawned;
  const shotsFired = end.shotsFired - start.shotsFired;
  const shotsResolved = end.shotsResolved - start.shotsResolved;
  const definition = job.formId ? TOWER_DEFINITIONS[job.formId] : null;
  const quote = job.formId ? towerBuildQuote(TOWER_DEFINITIONS, job.formId) : null;
  const expectedShots = definition
    ? definition.attack.cadencePerSecond
      * scenario.measureSeconds
      * Math.max(1, definition.attack.volley?.count || 1)
    : 0;
  authority.state.test.spawnRatePerSecond = 0;
  runTicks(authority, scenario.drainSeconds);
  const resolved = stateCounters(authority);
  const finalResolved = resolved.kills + resolved.breaches;
  const finalKillPercent = resolved.spawned > 0 ? resolved.kills / resolved.spawned * 100 : 0;
  const finalBreachPercent = resolved.spawned > 0 ? resolved.breaches / resolved.spawned * 100 : 0;
  const finalUnresolvedPercent = resolved.spawned > 0 ? resolved.active / resolved.spawned * 100 : 0;
  return {
    scenarioId: job.scenarioId,
    formId: job.formId,
    run: job.runIndex + 1,
    cost: quote?.cost || 0,
    kills,
    kps: kills / scenario.measureSeconds,
    spawned,
    capturePercent: spawned > 0 ? kills / spawned * 100 : 0,
    breaches,
    breachRate: breaches / scenario.measureSeconds,
    breachPercent: spawned > 0 ? breaches / spawned * 100 : 0,
    shotsFired,
    shotsResolved,
    killsPerShot: shotsFired > 0 ? kills / shotsFired : 0,
    fireUtilizationPercent: expectedShots > 0 ? Math.min(100, shotsFired / expectedShots * 100) : 0,
    kpsPer100Credits: quote?.cost > 0 ? kills / scenario.measureSeconds / (quote.cost / 100) : 0,
    activeStart: start.active,
    activeEnd: end.active,
    peakActive,
    populationGrowthPerSecond: (end.active - start.active) / scenario.measureSeconds,
    recordsStart: start.records,
    recordsEnd: end.records,
    peakRecords,
    finalSpawned: resolved.spawned,
    finalKills: resolved.kills,
    finalBreaches: resolved.breaches,
    finalActive: resolved.active,
    finalResolvedPercent: resolved.spawned > 0 ? finalResolved / resolved.spawned * 100 : 0,
    finalKillPercent,
    finalBreachPercent,
    finalUnresolvedPercent,
    projectilesEnd: authority.state.projectiles.length,
    oldestProjectileAgeSeconds: authority.state.projectiles.reduce((oldest, projectile) => Math.max(
      oldest,
      (authority.state.runTick - (projectile.createdTick ?? projectile.attack?.createdTick ?? authority.state.runTick)) / AUTHORITY_TICK_RATE
    ), 0),
    wallSeconds,
    simulationToWallRatio: scenario.measureSeconds / Math.max(0.000001, wallSeconds)
  };
}

function requestWorker(worker, job, areaId) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    const onMessage = (reply) => {
      cleanup();
      if (reply?.error) reject(new Error(reply.error));
      else resolve(reply.value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage({ job, areaId });
  });
}

async function runJobs(jobs, workerCount, areaId, onStart) {
  const workers = Array.from({ length: workerCount }, () => new Worker(new URL(import.meta.url)));
  const results = [];
  let cursor = 0;
  try {
    await Promise.all(workers.map(async (worker) => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        onStart(job);
        results.push(await requestWorker(worker, job, areaId));
      }
    }));
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  return results;
}

function average(samples, key) {
  return samples.reduce((total, sample) => total + sample[key], 0) / samples.length;
}

function aggregate(samples, options) {
  return options.scenarios.map((scenarioId) => {
    const scenario = SCENARIOS[scenarioId];
    const controlSamples = samples.filter((sample) => sample.scenarioId === scenarioId && sample.formId === null);
    const control = {
      breachRate: average(controlSamples, 'breachRate'),
      breachPercent: average(controlSamples, 'breachPercent'),
      populationGrowthPerSecond: average(controlSamples, 'populationGrowthPerSecond'),
      activeStart: average(controlSamples, 'activeStart'),
      activeEnd: average(controlSamples, 'activeEnd'),
      peakActive: Math.max(...controlSamples.map((sample) => sample.peakActive)),
      finalKillPercent: average(controlSamples, 'finalKillPercent'),
      finalBreachPercent: average(controlSamples, 'finalBreachPercent'),
      finalUnresolvedPercent: average(controlSamples, 'finalUnresolvedPercent'),
      samples: controlSamples
    };
    const towers = options.forms.map((formId) => {
      const towerSamples = samples.filter((sample) => sample.scenarioId === scenarioId && sample.formId === formId);
      const quote = towerBuildQuote(TOWER_DEFINITIONS, formId);
      const metrics = {
        kps: average(towerSamples, 'kps'),
        capturePercent: average(towerSamples, 'capturePercent'),
        breachRate: average(towerSamples, 'breachRate'),
        breachPercent: average(towerSamples, 'breachPercent'),
        finalKillPercent: average(towerSamples, 'finalKillPercent'),
        finalBreachPercent: average(towerSamples, 'finalBreachPercent'),
        finalUnresolvedPercent: average(towerSamples, 'finalUnresolvedPercent'),
        breachPreventionPercentagePoints: control.finalBreachPercent - average(towerSamples, 'finalBreachPercent'),
        fireUtilizationPercent: average(towerSamples, 'fireUtilizationPercent'),
        killsPerShot: average(towerSamples, 'killsPerShot'),
        kpsPer100Credits: average(towerSamples, 'kpsPer100Credits'),
        populationGrowthPerSecond: average(towerSamples, 'populationGrowthPerSecond'),
        activeStart: average(towerSamples, 'activeStart'),
        activeEnd: average(towerSamples, 'activeEnd'),
        peakActive: Math.max(...towerSamples.map((sample) => sample.peakActive)),
        projectilesEnd: average(towerSamples, 'projectilesEnd'),
        oldestProjectileAgeSeconds: Math.max(...towerSamples.map((sample) => sample.oldestProjectileAgeSeconds)),
        simulationToWallRatio: average(towerSamples, 'simulationToWallRatio'),
        samples: towerSamples
      };
      return { formId, cost: quote.cost, path: quote.path, metrics };
    });
    return { ...scenario, control, towers };
  });
}

function number(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

function printTable(report) {
  const sections = [
    'gameplay balance profile // naturally arriving horde',
    `tower position // test_field at ${POSITION.x},${POSITION.y} // ${report.config.targetingMode}`,
    ''
  ];
  for (const scenario of report.scenarios) {
    sections.push(
      `${scenario.label} // ${scenario.spawnRate}/s // ${scenario.sources.length} front(s) // ${scenario.leadSeconds}s lead + ${scenario.measureSeconds}s measured + ${scenario.drainSeconds}s drain // <=${scenario.spawnBudget} spawned`,
      `control // final leaks ${number(scenario.control.finalBreachPercent, 1)}% // unresolved ${number(scenario.control.finalUnresolvedPercent, 1)}% // measured active ${number(scenario.control.activeStart, 0)} -> ${number(scenario.control.activeEnd, 0)} // peak ${number(scenario.control.peakActive, 0)}`,
      markdownTable(
        ['tower', 'cost', 'kps', 'live kill%', 'fire%', 'final kill%', 'leak%', 'saved pp', 'growth/s', 'kps/100'],
        scenario.towers.map((tower) => [
          tower.formId,
          String(tower.cost),
          number(tower.metrics.kps, 1),
          number(tower.metrics.capturePercent, 1),
          number(tower.metrics.fireUtilizationPercent, 0),
          number(tower.metrics.finalKillPercent, 1),
          number(tower.metrics.finalBreachPercent, 1),
          number(tower.metrics.breachPreventionPercentagePoints, 1),
          number(tower.metrics.populationGrowthPerSecond, 1),
          number(tower.metrics.kpsPer100Credits, 2)
        ])
      ),
      ''
    );
  }
  sections.push('note // this profile reports evidence, not a composite balance score. placement, maps, targeting, support and mixed defenses still matter.', '');
  process.stdout.write(sections.join('\n'));
}

function printCsv(report) {
  const headers = [
    'scenario', 'tower', 'cost', 'kps', 'capture_percent', 'fire_utilization_percent',
    'final_kill_percent', 'final_breach_percent', 'final_unresolved_percent', 'breach_prevention_percentage_points', 'population_growth_per_second',
    'kps_per_100_credits', 'active_start', 'active_end', 'peak_active'
  ];
  const rows = [];
  for (const scenario of report.scenarios) {
    for (const tower of scenario.towers) {
      rows.push([
        scenario.id,
        tower.formId,
        tower.cost,
        tower.metrics.kps.toFixed(4),
        tower.metrics.capturePercent.toFixed(4),
        tower.metrics.fireUtilizationPercent.toFixed(4),
        tower.metrics.finalKillPercent.toFixed(4),
        tower.metrics.finalBreachPercent.toFixed(4),
        tower.metrics.finalUnresolvedPercent.toFixed(4),
        tower.metrics.breachPreventionPercentagePoints.toFixed(4),
        tower.metrics.populationGrowthPerSecond.toFixed(4),
        tower.metrics.kpsPer100Credits.toFixed(4),
        tower.metrics.activeStart.toFixed(2),
        tower.metrics.activeEnd.toFixed(2),
        tower.metrics.peakActive.toFixed(2)
      ]);
    }
  }
  process.stdout.write([headers, ...rows].map((row) => row.join(',')).join('\n') + '\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const areaId = validateOptions(options);
  const jobs = [];
  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    for (const scenarioId of options.scenarios) {
      jobs.push({ scenarioId, formId: null, runIndex, targetingMode: options.targetingMode });
      for (const formId of options.forms) jobs.push({ scenarioId, formId, runIndex, targetingMode: options.targetingMode });
    }
  }
  const workerCount = Math.min(options.workers, jobs.length);
  const started = performance.now();
  const samples = await runJobs(jobs, workerCount, areaId, (job) => {
    if (!options.quiet) process.stderr.write(`${job.scenarioId} // ${job.formId || 'control'} // run ${job.runIndex + 1}/${options.runs}\n`);
  });
  const report = {
    config: {
      forms: options.forms,
      scenarioIds: options.scenarios,
      targetingMode: options.targetingMode,
      runs: options.runs,
      workers: workerCount,
      position: POSITION,
      authorityTickRate: AUTHORITY_TICK_RATE
    },
    wallSeconds: (performance.now() - started) / 1000,
    scenarios: aggregate(samples, options)
  };
  if (options.format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (options.format === 'csv') printCsv(report);
  else printTable(report);
}

function startWorker() {
  parentPort.on('message', ({ job, areaId }) => {
    try {
      parentPort.postMessage({ value: measureJob(job, areaId) });
    } catch (error) {
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (isMainThread) {
  main().catch((error) => {
    process.stderr.write(`gameplay balance profile failed // ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  startWorker();
}
