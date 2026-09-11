// Full-run progression harness: scripted players on production maps, minute-by-minute
// telemetry, to check where the late game lands. Policies act every 30 authoritative
// seconds with what a competent player would do: finish damage towers where the horde
// actually is, keep an arsenal and a reactor, and split spending between escalated
// sockets and reactor ranks by marginal damage per credit.
//
//   node scripts/benchmark-progression.mjs --maps=map_01,map_07 --policies=greedy,settled,surge-blind --until=80
//
// Output: one CSV per job under --out (default docs/progression) plus a summary table.
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { AUTHORITY_TICK_RATE } from '../src/core/protocol.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS, towerBuildQuote } from '../src/core/tower-catalog.js';
import { defenseAreaField, getMapDefinition } from '../src/core/world-config.js';
import { towerPlacementClear } from '../src/core/placement.js';
import { purchaseCost } from '../src/core/network-descendants.js';
import { reactorQuote, RESEARCH_NODES, arsenalChoices } from '../src/core/research.js';
import { spawnProfileAt } from '../src/core/progression.js';

const DAMAGE_FORMS = ['sweeper', 'warhead', 'cutter', 'flechette', 'sweeper', 'salvo', 'cutter', 'cluster', 'prism', 'flechette'];
const ARSENAL_PRIORITY = [1, 2, 3, 4, 5, 10, 11, 12, 13, 18, 14, 28, 9, 7, 6, 21, 34, 31, 15, 16, 17, 19, 20, 22, 23, 24, 25, 26, 27, 29, 30, 32, 33, 35, 36, 37, 38, 39, 8];
const DEFAULTS = { maps: ['map_01'], policies: ['greedy', 'settled', 'surge-blind'], until: 80, seed: 7, out: 'docs/progression', workers: Math.max(1, Math.min(4, cpus().length)), quiet: false };

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (const argument of argv) {
    if (argument.startsWith('--maps=')) options.maps = argument.slice(7).split(',').filter(Boolean);
    else if (argument.startsWith('--policies=')) options.policies = argument.slice(11).split(',').filter(Boolean);
    else if (argument.startsWith('--until=')) options.until = Number(argument.slice(8));
    else if (argument.startsWith('--seed=')) options.seed = Number(argument.slice(7)) >>> 0;
    else if (argument.startsWith('--out=')) options.out = argument.slice(6);
    else if (argument.startsWith('--workers=')) options.workers = Number(argument.slice(10));
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--help') { console.log('see the header comment of scripts/benchmark-progression.mjs'); process.exit(0); }
  }
  return options;
}

function placementSpots(map) {
  const spots = [];
  for (const area of map.defenseAreas) {
    const reach = Math.max(area.shape.radiusX, area.shape.radiusY) * 1.4;
    for (let y = area.shape.y - reach; y <= area.shape.y + reach; y += 26) {
      for (let x = area.shape.x - reach; x <= area.shape.x + reach; x += 26) {
        if (defenseAreaField(area, x, y, -8) <= 0 && towerPlacementClear(spots, x, y)) spots.push({ x, y, areaId: area.id });
      }
    }
  }
  return spots;
}

function createRun(mapId, seed, policyId) {
  const authority = new EmbeddedAuthority({
    ...TEST_FIELD_SESSION_CONFIG, sessionId: `progression_${mapId}_${policyId}`, mode: 'game', test: null,
    mapId, seed, startingCredits: 300, startingLives: 100, towers: []
  });
  authority.events.length = 0;
  authority.emit = () => null;
  authority.join({ clientId: 'bench', payload: { label: 'bench' } });
  const player = authority.state.players[0];
  let sequence = 0;
  const command = (payload) => ({ clientId: 'bench', playerId: player.id, sequence: ++sequence, payload });
  return { authority, player, command, spots: placementSpots(authority.map), formCursor: 0, recentHp: 0, recentTicks: 0 };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const length2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Decaying traffic heat-map (100-unit cells) sampled every policy tick: the swarm a
// player sees flowing around the nebulae. Surge-blind policies only see the static
// rift lines.
const TRAFFIC_CELL = 100;
function sampleTraffic(run) {
  const swarm = run.authority.swarm;
  const traffic = run.traffic ||= new Map();
  for (const [key, value] of traffic) traffic.set(key, value * 0.7);
  for (let index = 0; index < swarm.count; index += 1) {
    const enemy = swarm.enemyAtIndex(index);
    const key = `${Math.floor(enemy.x / TRAFFIC_CELL)},${Math.floor(enemy.y / TRAFFIC_CELL)}`;
    traffic.set(key, (traffic.get(key) || 0) + enemy.hp * enemy.units);
  }
}

function trafficWithin(run, x, y, range) {
  const traffic = run.traffic;
  if (!traffic) return 0;
  let total = 0;
  const cells = Math.ceil(range / TRAFFIC_CELL);
  const cx = Math.floor(x / TRAFFIC_CELL), cy = Math.floor(y / TRAFFIC_CELL);
  for (let dx = -cells; dx <= cells; dx += 1) {
    for (let dy = -cells; dy <= cells; dy += 1) {
      const value = traffic.get(`${cx + dx},${cy + dy}`);
      if (!value) continue;
      const centreX = (cx + dx + 0.5) * TRAFFIC_CELL, centreY = (cy + dy + 0.5) * TRAFFIC_CELL;
      if (Math.hypot(centreX - x, centreY - y) <= range) total += value;
    }
  }
  return total;
}

// Spot value: traffic its form's range would actually see, minus what nearby towers
// already cover; a static rift-line prior; a small base-coverage bonus.
function pressureBySpot(run, live, range = 170) {
  const map = run.authority.map;
  const base = map.base;
  const seconds = run.authority.state.runTick / AUTHORITY_TICK_RATE;
  const surge = run.authority.state.swarm?.surge;
  const hot = new Set(live && surge && surge.phase !== 'idle' ? surge.riftIds : []);
  const rifts = map.spawnSources.filter((source) => source.unlockSeconds <= seconds).map((source) => ({ ...source, share: hot.has(source.id) ? 4 : 1 }));
  const towers = run.authority.state.towers;
  const scored = run.spots.map((spot) => {
    const traffic = live ? trafficWithin(run, spot.x, spot.y, range) : 0;
    let flow = 0;
    for (const rift of rifts) flow += rift.share * Math.exp(-distanceToSegment(spot.x, spot.y, rift.x, rift.y, base.x, base.y) / 160);
    const distance = Math.hypot(spot.x - base.x, spot.y - base.y);
    const coversBase = distance <= range - 30 ? 0.5 : 0;
    let crowding = 0;
    for (const tower of towers) {
      const overlap = Math.hypot(tower.x - spot.x, tower.y - spot.y);
      if (overlap < 140) crowding += 1 - overlap / 140;
    }
    return { spot, traffic, flow: flow / Math.max(1, rifts.length), coversBase, crowding };
  });
  const maxTraffic = Math.max(1, ...scored.map((entry) => entry.traffic));
  const maxFlow = Math.max(1e-9, ...scored.map((entry) => entry.flow));
  return scored.map((entry) => ({
    spot: entry.spot,
    score: (entry.traffic / maxTraffic * 4 + entry.flow / maxFlow * 1.5 + entry.coversBase) / (1 + entry.crowding * 0.8)
  }));
}

function bestSpot(run, live, range) {
  const taken = run.authority.state.towers;
  const candidates = pressureBySpot(run, live, range).filter(({ spot }) => towerPlacementClear(taken, spot.x, spot.y));
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.spot || null;
}

function station(run, definitionId) {
  return run.authority.state.towers.find((tower) => tower.definitionId === definitionId);
}

function place(run, definitionId, live) {
  // frames are placed for the long-range form they will become
  const finalForm = definitionId === 'frame' ? 'flechette' : definitionId;
  const spot = bestSpot(run, live, TOWER_DEFINITIONS[finalForm]?.range || 170);
  if (!spot) return false;
  const before = run.authority.state.towers.length;
  run.authority.placeTower(run.command({ definitionId, x: spot.x, y: spot.y }), run.player);
  if (process.env.PROGRESSION_TRACE) console.log(`  place ${definitionId} at ${spot.x},${spot.y} (${spot.areaId}) -> ${run.authority.state.towers.length > before ? 'ok' : 'rejected'} credits ${wallet(run).credits}`);
  return run.authority.state.towers.length > before;
}

function wallet(run) { return run.authority.state.teamEconomy; }

function buyReactor(run, categoryId) {
  const reactor = station(run, 'reactor');
  const quote = reactorQuote(run.authority.state, categoryId);
  if (!reactor || !quote || wallet(run).credits < quote.cost) return false;
  const rank = run.authority.state.research.reactor[categoryId] || 0;
  run.authority.purchaseReactor(run.command({ towerId: reactor.id, categoryId, expectedRank: quote.rank, expectedCost: quote.cost }), run.player);
  return (run.authority.state.research.reactor[categoryId] || 0) > rank;
}

function buyArsenal(run) {
  const arsenal = station(run, 'arsenal');
  if (!arsenal) return false;
  const available = arsenalChoices(run.authority.state);
  for (const id of ARSENAL_PRIORITY) {
    const node = available.find((choice) => choice.id === id);
    if (!node) continue;
    if (wallet(run).credits < node.cost) return false;
    const before = run.authority.state.research.unlocked.length;
    run.authority.purchaseResearch(run.command({ towerId: arsenal.id, researchId: node.id, expectedCost: node.cost }), run.player);
    return run.authority.state.research.unlocked.length > before;
  }
  return false;
}

function act(run, policyId, minute, telemetry) {
  const state = run.authority.state;
  const live = policyId !== 'surge-blind';
  const towerCap = policyId === 'settled' ? 40 : Infinity;
  const damageTowers = () => state.towers.filter((tower) => DAMAGE_FORMS.includes(tower.definitionId)).length;
  // opening: frames become finished damage towers as money allows
  if (minute < 20) {
    let guard = 0;
    // a competent opening rings the base with cheap frames first, then finishes them
    const wantedFrames = Math.min(8, 3 + Math.floor(minute));
    while (guard++ < 50) {
      const spent = wallet(run).credits;
      const weak = state.towers.find((tower) => ['frame', 'assault', 'barrage', 'rocket', 'laser'].includes(tower.definitionId));
      if (state.towers.length < wantedFrames) {
        if (wallet(run).credits < purchaseCost(state, null, 100, { placement: true }) || !place(run, 'frame', live)) break;
      } else if (weak) {
        const next = TOWER_DEFINITIONS[weak.definitionId].evolutionChoices;
        const slot = Number(weak.id.split('_').at(-1)) || 0;
        // sparse early streams reward reliable bullets and rockets; lasers only pay at density
        const pick = weak.definitionId === 'frame' ? 'assault' : weak.definitionId === 'assault' ? (slot % 3 === 2 ? 'rocket' : 'barrage')
          : weak.definitionId === 'barrage' ? 'flechette' : weak.definitionId === 'rocket' ? 'warhead' : 'sweeper';
        const cost = purchaseCost(state, weak.areaId, TOWER_DEFINITIONS[pick].evolutionCost);
        if (wallet(run).credits < cost || !next.includes(pick)) break;
        run.authority.evolveTower(run.command({ towerId: weak.id, definitionId: pick }), run.player);
      } else if (wallet(run).credits >= purchaseCost(state, null, 1500, { placement: true }) && state.towers.length < towerCap) {
        // everything is finished: add another finished tower where the horde is
        if (!place(run, ['flechette', 'warhead', 'flechette', 'sweeper'][run.formCursor++ % 4], live)) break;
      } else break;
      if (wallet(run).credits === spent) break;
    }
    return;
  }
  // stations first
  if (!station(run, 'arsenal') && wallet(run).credits >= purchaseCost(state, null, 1500, { placement: true })) place(run, 'arsenal', false);
  if (!station(run, 'reactor') && wallet(run).credits >= purchaseCost(state, null, 1500, { placement: true })) place(run, 'reactor', false);
  // arsenal: up to a fifth of lifetime earnings
  let guard = 0;
  while (guard++ < 10 && telemetry.arsenalSpent < wallet(run).totalEarned * 0.2) {
    const before = wallet(run).credits;
    if (!buyArsenal(run)) break;
    telemetry.arsenalSpent += before - wallet(run).credits;
  }
  // lives: cheap insurance once surges begin
  if (minute >= 30) while (guard++ < 30 && reactorQuote(state, 'lives') && reactorQuote(state, 'lives').cost < wallet(run).credits * 0.1) if (!buyReactor(run, 'lives')) break;
  // marginal comparison: escalated socket vs damage rank vs cadence rank
  const perTower = run.recentTicks > 0 ? (run.recentHp / run.recentTicks * AUTHORITY_TICK_RATE) / Math.max(1, damageTowers()) : 150;
  guard = 0;
  while (guard++ < 200) {
    const total = perTower * Math.max(1, damageTowers());
    const socket = purchaseCost(state, null, 1500, { placement: true });
    const damage = reactorQuote(state, 'damage');
    const cadence = reactorQuote(state, 'cadence');
    const options = [
      { kind: 'tower', cost: socket, gain: damageTowers() < towerCap ? perTower / socket : 0 },
      { kind: 'damage', cost: damage?.cost ?? Infinity, gain: damage ? total * 0.1 / damage.cost : 0 },
      { kind: 'cadence', cost: cadence?.cost ?? Infinity, gain: cadence ? total * 0.02 / cadence.cost : 0 }
    ].filter((option) => option.gain > 0).sort((a, b) => b.gain - a.gain);
    if (!options.length) break;
    const choice = options[0];
    if (wallet(run).credits < choice.cost) break;
    if (choice.kind === 'tower') {
      const form = DAMAGE_FORMS[run.formCursor++ % DAMAGE_FORMS.length];
      if (!place(run, form, live)) break;
    } else if (!buyReactor(run, choice.kind)) break;
  }
}

function runJob(job, report) {
  const run = createRun(job.mapId, job.seed, job.policyId);
  const { authority } = run;
  const telemetry = { arsenalSpent: 0 };
  const rows = [];
  const started = performance.now();
  let lastHp = 0;
  let lastBreaches = 0;
  let peakRecords = 0;
  const totalTicks = job.until * 60 * AUTHORITY_TICK_RATE;
  let firstLoss = null;
  let death = null;
  for (let tick = 1; tick <= totalTicks; tick += 1) {
    authority.tick();
    peakRecords = Math.max(peakRecords, authority.swarm.count);
    if (tick % (30 * AUTHORITY_TICK_RATE) === 0) {
      const minute = tick / 60 / AUTHORITY_TICK_RATE;
      run.recentHp = (authority.state.stats.hpPopped || 0) - lastHp;
      run.recentTicks = 30 * AUTHORITY_TICK_RATE;
      sampleTraffic(run);
      if (authority.state.phase === 'running') act(run, job.policyId, minute, telemetry);
    }
    if (tick % (60 * AUTHORITY_TICK_RATE) === 0) {
      const minute = tick / 60 / AUTHORITY_TICK_RATE;
      const state = authority.state;
      const hp = state.stats.hpPopped || 0;
      const profile = spawnProfileAt(authority.map, tick, AUTHORITY_TICK_RATE);
      const breaches = state.stats.breaches - lastBreaches;
      if (breaches > 0 && firstLoss === null) firstLoss = minute;
      const row = {
        minute, lives: state.base.lives, breaches, hpPerMinute: Math.round(hp - lastHp), threatPerMinute: Math.round(profile.hpPerSecond * 60),
        credits: Math.round(wallet(run).credits), earned: Math.round(wallet(run).totalEarned), towers: state.towers.length,
        damageRank: state.research.reactor.damage || 0, cadenceRank: state.research.reactor.cadence || 0, livesRank: state.research.reactor.lives || 0,
        arsenal: state.research.unlocked.length, active: authority.swarm.activeUnitCount, records: authority.swarm.count,
        meanHp: Number(profile.meanHp.toFixed(1)), surge: state.swarm.surge?.phase || 'idle', wallSeconds: Math.round((performance.now() - started) / 1000)
      };
      rows.push(row);
      report(row);
      if (process.env.PROGRESSION_TRACE) console.log('  towers', state.towers.map((tower) => `${tower.definitionId}@${Math.round(tower.x)},${Math.round(tower.y)}:${tower.kills || 0}`).join(' '));
      lastHp = hp;
      lastBreaches = state.stats.breaches;
    }
    if (authority.state.phase === 'defeated') { death = tick / 60 / AUTHORITY_TICK_RATE; break; }
  }
  return { ...job, rows, firstLoss, death: death === null ? null : Number(death.toFixed(1)), peakRecords, wallSeconds: Math.round((performance.now() - started) / 1000) };
}

if (!isMainThread) {
  const result = runJob(workerData, (row) => parentPort.postMessage({ progress: row, job: workerData }));
  parentPort.postMessage({ result });
} else {
  const options = parseArgs(process.argv.slice(2));
  const jobs = [];
  for (const mapId of options.maps) for (const policyId of options.policies) jobs.push({ mapId, policyId, seed: options.seed, until: options.until });
  mkdirSync(options.out, { recursive: true });
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(options.workers, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: job });
        worker.on('message', (message) => {
          if (message.progress && !options.quiet) {
            const r = message.progress;
            console.log(`${job.mapId}/${job.policyId} ${String(r.minute).padStart(3)}m lives ${r.lives} towers ${r.towers} dmg r${r.damageRank} ars ${r.arsenal} credits ${r.credits >= 1e6 ? (r.credits / 1e6).toFixed(2) + 'm' : (r.credits / 1e3).toFixed(1) + 'k'} kill/threat ${(r.hpPerMinute / Math.max(1, r.threatPerMinute)).toFixed(2)} active ${r.active} ${r.surge} (${r.wallSeconds}s)`);
          }
          if (message.result) resolve(message.result);
        });
        worker.on('error', reject);
      });
      results.push(result);
      const header = Object.keys(result.rows[0] || {}).join(',');
      writeFileSync(`${options.out}/${job.mapId}-${job.policyId}.csv`, [header, ...result.rows.map((row) => Object.values(row).join(','))].join('\n') + '\n');
    }
  }));
  console.log('\n| map | policy | first life loss | death | towers@30 | rank@45 | towers@60 | peak records | wall s |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of results) {
    const at = (minute) => result.rows.find((row) => row.minute === minute);
    console.log(`| ${result.mapId} | ${result.policyId} | ${result.firstLoss ?? '-'} | ${result.death ?? 'survived'} | ${at(30)?.towers ?? '-'} | ${at(45)?.damageRank ?? '-'} | ${at(60)?.towers ?? '-'} | ${result.peakRecords} | ${result.wallSeconds} |`);
  }
}
