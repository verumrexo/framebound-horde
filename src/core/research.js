// One global upgrade tree; any owned arsenal can unlock every branch.
export const RESEARCH_NODES = Object.freeze([
  {
    "id": 1,
    "label": "reinforced ammunition",
    "description": "+20% primary weapon damage",
    "parent": null,
    "tier": 1,
    "cost": 10000
  },
  {
    "id": 2,
    "label": "cycling assembly",
    "description": "+15% normal firing cadence",
    "parent": null,
    "tier": 1,
    "cost": 10000
  },
  {
    "id": 3,
    "label": "fire-control array",
    "description": "+10% weapon targeting range; does not enlarge blasts or beams",
    "parent": null,
    "tier": 1,
    "cost": 10000
  },
  {
    "id": 4,
    "label": "armor penetration",
    "description": "+30% base damage against enemies above half health; no extra victim count",
    "parent": 1,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 5,
    "label": "finishing rounds",
    "description": "+30% base damage against enemies at or below half health; complementary to penetration, not multiplicative",
    "parent": 1,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 6,
    "label": "coordinated fire",
    "description": "hits by three distinct towers within one second expose an enemy for one +50% base-damage primary hit; then a cooldown",
    "parent": 1,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 7,
    "label": "reserve magazine",
    "description": "idle weapon towers store one normal firing cycle, released on reacquiring a target",
    "parent": 2,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 8,
    "label": "target handoff",
    "description": "when a projectile loses its target, it can search a wider local area; travel lifetime is never extended",
    "parent": 2,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 9,
    "label": "controlled burst",
    "description": "every fifth normal firing cycle releases one additional primary-shaped attack at 25% damage",
    "parent": 2,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 10,
    "label": "close defense",
    "description": "+25% base damage against enemies in the inner third of weapon range",
    "parent": 3,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 11,
    "label": "long sight",
    "description": "+25% base damage against enemies in the outer third of weapon range",
    "parent": 3,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 12,
    "label": "suppression rounds",
    "description": "primary hits apply a brief 10% slow; strongest slow wins",
    "parent": 3,
    "tier": 2,
    "cost": 100000
  },
  {
    "id": 13,
    "label": "through-shot",
    "description": "a non-explosive physical projectile continues into one additional enemy with 50% damage",
    "parent": 4,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 14,
    "label": "shell breaker",
    "description": "every fourth primary hit from the same tower against the same surviving enemy ignores the above-half-health condition for a +100% base-damage bonus",
    "parent": 4,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 15,
    "label": "narrow bore",
    "description": "laser beams become 25% narrower but gain +75% base damage; trades coverage for layer removal",
    "parent": 4,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 16,
    "label": "execution order",
    "description": "targeting option prefers the lowest remaining-hp enemy that the next primary hit can kill",
    "parent": 5,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 17,
    "label": "overkill transfer",
    "description": "up to 25% of wasted damage from one primary kill transfers to one nearby enemy; cannot repeat",
    "parent": 5,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 18,
    "label": "final impact",
    "description": "primary kills by physical bullets emit a tiny secondary blast at 20% damage; at most one blast per normal firing cycle",
    "parent": 5,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 19,
    "label": "shared lock",
    "description": "connected towers can share targeting information about exposed enemies, without gaining range or attacks",
    "parent": 6,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 20,
    "label": "prolonged exposure",
    "description": "the exposure mark lasts longer, retaining its one-hit consumption rule",
    "parent": 6,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 21,
    "label": "synchronized strike",
    "description": "exposure instead permits the next three distinct contributing towers to receive +20% base damage each; the original single-hit bonus is replaced",
    "parent": 6,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 22,
    "label": "deep magazine",
    "description": "increases stored normal cycles from one to three",
    "parent": 7,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 23,
    "label": "emergency discharge",
    "description": "stored cycles are released faster when a target enters the base danger zone; does not create ammunition",
    "parent": 7,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 24,
    "label": "charged opening",
    "description": "the first stored attack against a new engagement gains +75% base damage after five idle seconds",
    "parent": 7,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 25,
    "label": "ricochet",
    "description": "a non-explosive physical projectile that kills its target redirects once with 25% damage; shares its one secondary-contact budget with through-shot",
    "parent": 8,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 26,
    "label": "predictive aim",
    "description": "automatic rocket impact selection accounts for target velocity and flight time; manual aim remains authoritative",
    "parent": 8,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 27,
    "label": "anti-overkill routing",
    "description": "targeting distributes reserved damage across enemies before assigning additional attacks to an already-covered target",
    "parent": 8,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 28,
    "label": "double shot",
    "description": "the additional attack occurs every second normal cycle instead of every fifth; remains at 25% damage, not a second full-strength volley",
    "parent": 9,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 29,
    "label": "split assignment",
    "description": "the additional attack selects a separate enemy group; no extra damage or extra attack count",
    "parent": 9,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 30,
    "label": "delayed echo",
    "description": "the additional attack is delayed by 0.6 seconds and gains damage from 25% to 40%, trading immediate defense for efficiency",
    "parent": 9,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 31,
    "label": "point-blank shells",
    "description": "primary rocket hits gain +50% base damage against enemies in the inner quarter of their blast; blast size does not grow",
    "parent": 10,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 32,
    "label": "emergency cycle",
    "description": "towers attacking within the base danger zone receive +15% base cadence; does not stack per enemy",
    "parent": 10,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 33,
    "label": "repulsor strike",
    "description": "every fifth close-range primary hit causes one small outward displacement; shared enemy cooldown prevents pinball",
    "parent": 10,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 34,
    "label": "rangefinder",
    "description": "after tracking the same target for two seconds, gain +50% base damage against it until the target changes",
    "parent": 11,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 35,
    "label": "flight stabilizer",
    "description": "physical projectile speed +40%, improving time-to-impact without changing cadence or damage",
    "parent": 11,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 36,
    "label": "watch perimeter",
    "description": "connected networks reveal high-hp incoming groups and offer highest-hp targeting; no hidden range bonus",
    "parent": 11,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 37,
    "label": "chilling rounds",
    "description": "increases the research slow from 10% to 20%; replaces rather than stacks with the earlier slow",
    "parent": 12,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 38,
    "label": "brittle targets",
    "description": "+20% base damage against enemies currently frozen by a control tower; adds no freezes",
    "parent": 12,
    "tier": 3,
    "cost": 1000000
  },
  {
    "id": 39,
    "label": "lingering suppression",
    "description": "doubles the duration of the research slow; does not extend stasis, recall, bond or other control effects",
    "parent": 12,
    "tier": 3,
    "cost": 1000000
  }
].map(Object.freeze));
export const researchNode = (id) => RESEARCH_NODES.find((node) => node.id === id);
export const freshResearch = () => ({ unlocked: [], reactor: {}, combat: {}, pending: [], finalImpactCycles: {} });
export const hasResearch = (state, id) => Boolean(state.research?.unlocked.includes(id));
export const reactorRank = (state, id) => state.research?.reactor?.[id] || 0;
export const arsenalChoices = (state) => RESEARCH_NODES.filter((node) => !hasResearch(state, node.id) && (node.parent === null || hasResearch(state, node.parent)));

export const REACTOR_CATEGORIES = Object.freeze([
  ['damage', 'damage output', 'primary damage x1.5 per rank', null, 1.1],
  ['cadence', 'weapon cycling', '+2% base cadence per rank; cap +50%', 25],
  ['range', 'targeting range', '+2% base range per rank; cap +30%', 15],
  ['velocity', 'projectile velocity', '+5% base projectile speed; cap +100%', 20],
  ['blast', 'blast coverage', '+1% base blast radius; cap +15%', 15],
  ['beam', 'beam focus', '+1% base beam width; cap +15%', 15],
  ['recovery', 'control recovery', '+2% recharge; cap +30%; downtime preserved', 15],
  ['coverage', 'control coverage', '+1% control size; cap +15%; no longer gates', 15],
  ['construction', 'construction efficiency', '2% off remaining build price; cap 50%', 35],
  ['lives', 'base reserve', '+5 maximum lives; heals up to 5; cap +100', 20],
  ['guidance', 'projectile guidance', '+2% homing turn strength; cap +30%', 15],
  ['sustain', 'field sustain', '+2% ordinary slow duration; cap +20%', 10]
].map(([id,label,description,maxRank,growth=1.1]) => Object.freeze({id,label,description,maxRank,growth})));

export function reactorQuote(state, id) {
  const category = REACTOR_CATEGORIES.find((item) => item.id === id);
  if (!category) return null;
  const rank = reactorRank(state, id);
  if (category.maxRank !== null && rank >= category.maxRank) return null;
  const cost = Math.ceil(10_000 * category.growth ** rank - 1e-8);
  if (!Number.isSafeInteger(cost)) return null;
  return { ...category, rank, cost };
}

export function researchStat(state, stat, baseValue, tower, swarm) {
  let extra = 0;
  const has = (id) => hasResearch(state, id);
  const rank = (id) => reactorRank(state, id);
  if (stat === 'cadencePerSecond') {
    extra += (has(2) ? .15 : 0) + rank('cadence') * .02;
    if (has(32) && swarm && swarm.enemiesInCircle(tower.x, tower.y, tower.effectiveRange || 170)
      .some((enemy) => Math.hypot(enemy.x - swarm.base.x, enemy.y - swarm.base.y) <= 180)) extra += .15;
  }
  if (stat === 'range') extra += (has(3) ? .1 : 0) + rank('range') * .02;
  if (stat === 'projectileSpeed') extra += rank('velocity') * .05 + (has(35) ? .4 : 0);
  if (stat === 'geometryRadius') extra += rank('blast') * .01;
  if (stat === 'geometryWidth') extra += rank('beam') * .01;
  if (stat === 'controlRecharge') extra += rank('recovery') * .02;
  if (['controlRadius', 'controlWidth'].includes(stat)) extra += rank('coverage') * .01;
  return baseValue * extra;
}
