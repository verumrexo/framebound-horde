// Prints the late-game balance curves: threat budget, mean hp, cumulative reward,
// reactor damage price line, escalated placement prices and the surge schedule for a seed.
// Regenerate after any change to progression.js, research.js or network-descendants.js.
import { getMapDefinition } from '../src/core/world-config.js';
import { spawnProfileAt, surgeRiftIds, surgeStartSeconds, surgeHpMultiplier, SURGE_PERIOD_SECONDS, SURGE_ACTIVE_SECONDS, SURGE_EXTRA_BODY_FRACTION } from '../src/core/progression.js';
import { REACTOR_CATEGORIES, reactorQuote } from '../src/core/research.js';
import { FREE_PLACEMENTS, PLACEMENT_ESCALATOR } from '../src/core/network-descendants.js';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const mapId = args.map || 'map_01';
const seed = Number(args.seed ?? 7) >>> 0;
const map = getMapDefinition(mapId, seed);
const format = (value) => value >= 1e9 ? `${(value / 1e9).toFixed(2)}b` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}m` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : value.toFixed(value < 10 ? 2 : 0);

console.log(`# ${map.label} // seed ${seed}`);
console.log('\n## threat budget (base stream only, 100% kill, no mint)\n');
console.log('| min | hp/s | bodies/s | mean hp | cumulative credits | rifts live |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
let cumulative = 0;
for (let second = 0; second <= 90 * 60; second += 1) {
  const profile = spawnProfileAt(map, second * 60);
  if (second > 0) cumulative += profile.hpPerSecond;
  const minute = second / 60;
  if (Number.isInteger(minute) && [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90].includes(minute)) {
    const rifts = map.spawnSources.filter((source) => source.unlockSeconds <= second).length;
    console.log(`| ${minute} | ${format(profile.hpPerSecond)} | ${profile.rate.toFixed(1)} | ${profile.meanHp.toFixed(1)} | ${format(cumulative)} | ${rifts} |`);
  }
}

console.log('\n## reactor damage line (x1.10 damage per rank)\n');
console.log('| rank | damage | rank price | cumulative |');
console.log('| ---: | ---: | ---: | ---: |');
let spend = 0;
for (let rank = 0; rank <= 60; rank += 1) {
  const quote = reactorQuote({ research: { reactor: { damage: rank } } }, 'damage');
  if ([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60].includes(rank)) console.log(`| ${rank} | x${(1.1 ** rank).toFixed(1)} | ${format(quote.cost)} | ${format(spend)} |`);
  spend += quote.cost;
}
console.log('\nother categories:');
for (const category of REACTOR_CATEGORIES) {
  if (category.id === 'damage') continue;
  let total = 0;
  for (let rank = 0; rank < category.maxRank; rank += 1) total += Math.ceil(category.firstCost * category.growth ** rank - 1e-8);
  console.log(`- ${category.label}: ${category.maxRank} ranks, ${format(total)} to cap`);
}

console.log(`\n## placement prices (first ${FREE_PLACEMENTS} at catalog price, then x${PLACEMENT_ESCALATOR} each)\n`);
console.log('| placement | frame | finished tower |');
console.log('| ---: | ---: | ---: |');
for (const number of [30, 31, 40, 50, 60, 80, 100, 120, 150]) {
  const factor = PLACEMENT_ESCALATOR ** Math.max(0, number - FREE_PLACEMENTS);
  console.log(`| ${number} | ${format(Math.ceil(100 * factor))} | ${format(Math.ceil(1500 * factor))} |`);
}

console.log('\n## surge schedule\n');
const start = surgeStartSeconds(map);
console.log(`first surge at ${(start / 60).toFixed(1)} min, every ${SURGE_PERIOD_SECONDS / 60} min for ${SURGE_ACTIVE_SECONDS}s; extra stream ${SURGE_EXTRA_BODY_FRACTION * 100}% of the body cap\n`);
console.log('| surge | minute | hot rifts | hp multiplier | extra hp/s |');
console.log('| ---: | ---: | --- | ---: | ---: |');
for (let index = 0; index < 10; index += 1) {
  const at = start + index * SURGE_PERIOD_SECONDS;
  const profile = spawnProfileAt(map, at * 60);
  console.log(`| ${index} | ${(at / 60).toFixed(1)} | ${surgeRiftIds(map, seed, index).join(', ')} | x${surgeHpMultiplier(index)} | ${format(profile.bodyCap * SURGE_EXTRA_BODY_FRACTION * profile.meanHp * surgeHpMultiplier(index))} (+${Math.round(SURGE_EXTRA_BODY_FRACTION * surgeHpMultiplier(index) * 100)}%) |`);
}
