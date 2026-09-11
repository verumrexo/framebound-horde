import { hasResearch, reactorRank, reactorDamageFactor } from './research.js';
import { cloneSerializable } from './protocol.js';

export const damageFixed = (value) => Math.max(0, Math.round(value * 1000) / 1000);
export const enemyKey = (enemy) => `${enemy.id}:${enemy.generation}`;
export const physicalBullet = (attack) => attack.delivery.type === 'projectile' && attack.geometry.type === 'single';

export function decorateResearchAttack(state, tower, attack) {
  const ids = attack.supportOnly ? [] : [...(state.research?.unlocked || [])];
  const has = (id) => ids.includes(id);
  // Reactor damage ranks stack additively (+10% each) to form the baseline that
  // arsenal percentages are measured against; nothing here compounds.
  const factor = reactorDamageFactor(state);
  let baseDamage = 0;
  for (const effect of attack.effects || []) {
    if (effect.type !== 'damage') continue;
    effect.amount = damageFixed(effect.amount * factor);
    baseDamage += effect.amount;
  }
  const laser = attack.geometry.type === 'line';
  const bonus = (has(1) ? .2 : 0) + (laser && has(15) ? .75 : 0) + (tower.researchCharged ? .75 : 0);
  for (const effect of attack.effects || []) if (effect.type === 'damage') effect.amount = damageFixed(effect.amount * (1 + bonus));
  if (laser && has(15)) attack.geometry.width *= .75;
  const sustain = 1 + reactorRank(state, 'sustain') * .02;
  for (const effects of [attack.effects, ...(attack.triggers || []).map((trigger) => trigger.effects)]) {
    for (const effect of effects || []) if ((effect.type === 'status' && effect.status === 'slow') || effect.type === 'slow_field') effect.durationSeconds *= sustain;
  }
  if (has(12)) attack.effects.push({ type: 'status', status: 'slow', magnitude: has(37) ? .2 : .1,
    durationSeconds: (has(39) ? 2 : 1) * sustain });
  attack.research = { ids, baseDamage, cycle: `${tower.id}:${state.runTick}:${(tower.researchCycle || 0) + 1}`,
    trackingKey: tower.researchTrackingKey || null, trackingSince: tower.researchTrackingSince ?? state.runTick,
    guidance: 1 + reactorRank(state, 'guidance') * .02 };
  return attack;
}

export function secondaryAttack(attack, fraction) {
  const result = cloneSerializable(attack);
  const amount = damageFixed((attack.effects || []).filter((effect) => effect.type === 'damage').reduce((sum,effect) => sum + effect.amount, 0) * fraction);
  result.effects = [{ type: 'damage', amount }];
  result.triggers = [];
  result.impactFollowUps = [];
  result.research = { ...attack.research, secondary: true };
  return result;
}

export function damageResearchBonus(research, swarm, attack, victim, contact, tick) {
  if (attack.supportOnly || !attack.research || attack.research.secondary) return 0;
  const has = (id) => attack.research.ids.includes(id);
  const distance = Math.hypot(victim.x - attack.sourceX, victim.y - attack.sourceY);
  let bonus = 0;
  if (has(4) && victim.hp > victim.maxHp / 2) bonus += .3;
  if (has(5) && victim.hp <= victim.maxHp / 2) bonus += .3;
  if (has(10) && distance <= attack.range / 3) bonus += .25;
  if (has(11) && distance >= attack.range * 2 / 3) bonus += .25;
  if (has(31) && attack.geometry.type === 'circle' && attack.delivery.type === 'projectile'
      && Math.hypot(victim.x - contact.x, victim.y - contact.y) <= attack.geometry.radius / 4) bonus += .5;
  if (has(38) && swarm.stasisUntilById[victim.id] > tick) bonus += .2;
  if (has(34) && attack.research.trackingKey === enemyKey(victim) && tick - attack.research.trackingSince >= 120) bonus += .5;
  if (has(6) || has(14) || has(33)) {
    const key = enemyKey(victim);
    const entry = research.combat[key] ||= { contributors: {}, counts: {}, exposedUntil: 0, cooldown: 0, spent: [], repulseUntil: 0 };
    if (has(14) || has(33)) {
      entry.counts[attack.sourceTowerId] = (entry.counts[attack.sourceTowerId] || 0) + 1;
      if (has(14) && entry.counts[attack.sourceTowerId] % 4 === 0) bonus += 1;
    }
    if (has(6)) {
      for (const [id, time] of Object.entries(entry.contributors)) if (tick - time > 60) delete entry.contributors[id];
      entry.contributors[attack.sourceTowerId] = tick;
      let justExposed = false;
      if (entry.exposedUntil < tick && tick >= entry.cooldown && Object.keys(entry.contributors).length >= 3) {
        entry.exposedUntil = tick + (has(20) ? 240 : 120);
        entry.cooldown = entry.exposedUntil + 120;
        entry.eligible = Object.keys(entry.contributors).sort().slice(0, 3);
        entry.spent = [];
        justExposed = true;
      }
      if (!justExposed && entry.exposedUntil >= tick && entry.exposedUntil > 0) {
        if (has(21)) {
          if (entry.eligible.includes(attack.sourceTowerId) && !entry.spent.includes(attack.sourceTowerId)) {
            bonus += .2; entry.spent.push(attack.sourceTowerId);
            if (entry.spent.length === 3) entry.exposedUntil = 0;
          }
        } else { bonus += .5; entry.exposedUntil = 0; }
      }
    }
    if (has(33) && distance <= attack.range / 3 && entry.counts[attack.sourceTowerId] % 5 === 0 && entry.repulseUntil <= tick) {
      const index = swarm.indexById[victim.id];
      if (index >= 0) {
        const dx = victim.x - swarm.base.x, dy = victim.y - swarm.base.y, length = Math.hypot(dx,dy) || 1;
        swarm.state[index * 4] = Math.max(swarm.map.bounds.left + 2, Math.min(swarm.map.bounds.right - 2, victim.x + dx / length * 10));
        swarm.state[index * 4 + 1] = Math.max(swarm.map.bounds.top + 2, Math.min(swarm.map.bounds.bottom - 2, victim.y + dy / length * 10));
      }
      entry.repulseUntil = tick + 120;
    }
  }
  return damageFixed(attack.research.baseDamage * bonus);
}

export function researchSecondaryPlans(research, swarm, result, tick) {
  const attack = result.attack;
  if (!attack.research || attack.research.secondary) return [];
  const has = (id) => attack.research.ids.includes(id);
  const plans = [];
  for (const hit of result.hits) {
    if (!hit.killed) continue;
    if (has(17) && hit.overkill > 0) {
      const target = swarm.enemiesInCircle(hit.x, hit.y, 80)[0];
      if (target) {
        const transfer = secondaryAttack(attack, 0);
        transfer.geometry = { type: 'single', maxVictims: 1 };
        transfer.effects[0].amount = damageFixed(hit.overkill * .25);
        plans.push({ attack: transfer, contact: target, victims: [target] });
      }
    }
    if (has(18) && physicalBullet(attack) && !research.finalImpactCycles[attack.research.cycle]) {
      research.finalImpactCycles[attack.research.cycle] = tick;
      const blast = secondaryAttack(attack, .2);
      blast.geometry = { type: 'circle', radius: 24, maxVictims: 'unlimited', packetMode: 'all' };
      plans.push({ attack: blast, contact: hit, victims: swarm.enemiesInCircle(hit.x, hit.y, 24) });
    }
  }
  return plans;
}

export function pruneResearchCombat(research, swarm, tick) {
  if (tick % 60) return;
  for (const key of Object.keys(research.combat)) {
    const [id,generation] = key.split(':').map(Number);
    if (!swarm.enemy(id,generation)) delete research.combat[key];
  }
  for (const [key,time] of Object.entries(research.finalImpactCycles)) if (tick - time > 3600) delete research.finalImpactCycles[key];
}
