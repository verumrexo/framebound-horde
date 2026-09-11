import { insideSweptBeam } from './sweep-collision.js';
import { damageFixed, damageResearchBonus } from './research-combat.js';
import { AUTHORITY_TICK_RATE, cloneSerializable } from './protocol.js';

const MAX_TRIGGER_EVENTS_PER_TICK = 4096;
const MAX_TRIGGER_DEPTH = 32;

function maximumVictims(geometry) {
  return geometry.maxVictims === 'unlimited' ? Infinity : geometry.maxVictims;
}

function takeVictims(candidates, geometry) {
  return candidates.slice(0, maximumVictims(geometry));
}

function damagePerVictim(attack) {
  return attack.effects
    .filter((effect) => effect.type === 'damage')
    .reduce((total, effect) => total + damageFixed(effect.amount || 0), 0);
}

function selectChain(swarm, contact, geometry, excludedIds) {
  const victims = [];
  const localExcluded = new Set(excludedIds || []);
  let current = contact;
  const limit = maximumVictims(geometry);
  while (current && victims.length < limit) {
    victims.push(current);
    localExcluded.add(current.id);
    current = swarm.enemiesInCircle(current.x, current.y, geometry.jumpRadius || 80, localExcluded)[0] || null;
  }
  return victims;
}

export function createAttackSnapshot(definition, tower, stats = {}) {
  const attack = cloneSerializable(definition.attack);
  attack.range = stats.range ?? definition.range;
  attack.cadencePerSecond = stats.cadencePerSecond ?? attack.cadencePerSecond;
  attack.sourceTowerId = tower.id;
  attack.sourceFormId = definition.id;
  attack.sourceAreaId = tower.areaId || null;
  attack.sourceX = tower.x;
  attack.sourceY = tower.y;
  attack.forceDirection = tower.forceDirection
    ? { x: tower.forceDirection.x, y: tower.forceDirection.y }
    : null;
  attack.ownerId = tower.ownerId;
  attack.rewardPerKill = definition.killReward || 0;
  attack.createdTick = stats.createdTick || 0;
  return attack;
}

export function selectAttackVictims(swarm, attack, contact, excludedIds = null) {
  const geometry = attack.geometry;
  if (geometry.type === 'single') return contact ? [contact] : [];
  if (geometry.type === 'circle') {
    return takeVictims(swarm.enemiesInCircle(contact.x, contact.y, geometry.radius, excludedIds), geometry);
  }
  if (geometry.type === 'line') {
    if (Number.isFinite(geometry.sweepFromAngle) && Number.isFinite(geometry.sweepToAngle)) {
      const range = Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1);
      return takeVictims(swarm.enemiesInCircle(geometry.x1, geometry.y1, range + geometry.width * .5, excludedIds)
        .filter((enemy) => insideSweptBeam(enemy.x - geometry.x1, enemy.y - geometry.y1,
          range, geometry.width, geometry.sweepFromAngle, geometry.sweepToAngle)), geometry);
    }
    return takeVictims(
      swarm.enemiesAlongSegment(geometry.x1, geometry.y1, geometry.x2, geometry.y2, geometry.width * 0.5, excludedIds),
      geometry
    );
  }
  if (geometry.type === 'chain') return selectChain(swarm, contact, geometry, excludedIds);
  throw new Error(`unsupported hit geometry: ${geometry.type}`);
}

export function planAttackImpact(swarm, attack, contact, pendingKilledIds, pendingDamageByEnemy) {
  const victims = selectAttackVictims(swarm, attack, contact, pendingKilledIds)
    .filter((victim) => !pendingKilledIds.has(victim.id));
  const damage = damagePerVictim(attack);
  if (damage > 0) {
    for (const victim of victims) {
      const packetWide = attack.geometry.packetMode === 'all';
      const effectiveDamage = victim.units > 1 && !packetWide ? Math.min(damage, victim.maxHp) : damage;
      const pendingDamage = (pendingDamageByEnemy.get(victim.id) || 0) + effectiveDamage;
      pendingDamageByEnemy.set(victim.id, pendingDamage);
      const remainingPacketHealth = packetWide ? victim.hp : victim.hp + (victim.units - 1) * victim.maxHp;
      if (pendingDamage >= remainingPacketHealth) pendingKilledIds.add(victim.id);
    }
  }
  return { attack, contact, victims };
}

function selectTriggerTargets(swarm, selector, origin, excludedIds = null) {
  if (selector.type === 'nearest') {
    return swarm.enemiesInCircle(origin.x, origin.y, selector.radius, excludedIds).slice(0, selector.count);
  }
  if (selector.type === 'circle') {
    const geometry = { type: 'circle', radius: selector.radius, maxVictims: selector.maxVictims || 'unlimited' };
    return takeVictims(swarm.enemiesInCircle(origin.x, origin.y, selector.radius, excludedIds), geometry);
  }
  if (selector.type === 'origin') return [];
  if (selector.type === 'victims') return origin.victims || [];
  return [];
}

function installForceField(forceFields, field) {
  if (field.fieldSlot) {
    for (let index = forceFields.length - 1; index >= 0; index -= 1) {
      const existing = forceFields[index];
      if (existing.sourceTowerId === field.sourceTowerId && existing.fieldSlot === field.fieldSlot) forceFields.splice(index, 1);
    }
  }
  forceFields.push(field);
}

function normalizedDirection(x, y, fallbackX = 1, fallbackY = 0) {
  const length = Math.hypot(x, y);
  if (length > 0.0001) return { x: x / length, y: y / length };
  const fallbackLength = Math.hypot(fallbackX, fallbackY) || 1;
  return { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength };
}

function resolveEffectDirection(swarm, effect, context) {
  if (effect.direction === 'away_from_base') {
    return normalizedDirection(context.origin.x - swarm.base.x, context.origin.y - swarm.base.y);
  }
  if (effect.direction === 'toward_base') {
    return normalizedDirection(swarm.base.x - context.origin.x, swarm.base.y - context.origin.y);
  }
  if (effect.direction === 'tower_vector') {
    const selected = context.attack.forceDirection;
    if (Number.isFinite(selected?.x) && Number.isFinite(selected?.y)) {
      return normalizedDirection(selected.x, selected.y);
    }
    const flowX = swarm.base.x - (context.attack.sourceX ?? context.origin.x);
    const flowY = swarm.base.y - (context.attack.sourceY ?? context.origin.y);
    return normalizedDirection(-flowY, flowX);
  }
  return normalizedDirection(effect.directionX || 0, effect.directionY || 0);
}

function createForceField(effect, context, kind, radius = effect.radius) {
  return {
    id: `field_${context.nextFieldNumber()}`,
    kind,
    ownerId: context.attack.ownerId,
    sourceTowerId: context.attack.sourceTowerId,
    sourceFormId: context.attack.sourceFormId,
    x: context.origin.x,
    y: context.origin.y,
    radius,
    fieldSlot: effect.fieldSlot || null,
    createdTick: context.tick,
    expiresTick: context.tick + Math.max(1, Math.round(effect.durationSeconds * AUTHORITY_TICK_RATE))
  };
}

function applyNonDamageEffects(swarm, victims, effects, result, context) {
  for (const effect of effects) {
    if (effect.type === 'status') {
      const affected = swarm.applyStatus(victims, effect);
      result.controlTargets.push(...affected);
      continue;
    }
    if (effect.type === 'position_recall') {
      const affected = swarm.scheduleRecall(victims, effect);
      result.controlTargets.push(...affected);
      continue;
    }
    if (effect.type === 'radial_force_field') {
      const field = {
        ...createForceField(effect, context, 'radial_force'),
        strength: effect.strength,
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
      continue;
    }
    if (effect.type === 'directional_force_field') {
      const direction = resolveEffectDirection(swarm, effect, context);
      const field = {
        ...createForceField(effect, context, 'directional_force'),
        directionX: direction.x,
        directionY: direction.y,
        strength: effect.strength,
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
      continue;
    }
    if (effect.type === 'slow_field') {
      const field = {
        ...createForceField(effect, context, 'slow_field'),
        speedFactor: Math.max(0.05, Math.min(1, 1 - effect.magnitude))
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
      continue;
    }
    if (effect.type === 'vortex_force_field') {
      const sourceText = String(context.attack.sourceTowerId || '0');
      const spin = sourceText.charCodeAt(sourceText.length - 1) % 2 === 0 ? -1 : 1;
      const field = {
        ...createForceField(effect, context, 'vortex_force'),
        radialStrength: effect.radialStrength,
        tangentialStrength: effect.tangentialStrength,
        spin
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
      continue;
    }
    if (effect.type === 'pinch_force_field') {
      const axis = resolveEffectDirection(swarm, effect, context);
      const field = {
        ...createForceField(effect, context, 'pinch_force'),
        axisX: axis.x,
        axisY: axis.y,
        strength: effect.strength
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
      continue;
    }
    if (effect.type === 'force_wall') {
      const push = resolveEffectDirection(swarm, effect, context);
      const halfLength = Math.max(1, effect.halfLength);
      const thickness = Math.max(1, effect.thickness);
      const field = {
        ...createForceField(effect, context, 'force_wall', Math.hypot(halfLength, thickness)),
        pushX: push.x,
        pushY: push.y,
        wallAxisX: -push.y,
        wallAxisY: push.x,
        halfLength,
        thickness,
        strength: effect.strength
      };
      installForceField(context.forceFields, field);
      result.createdFields.push(field);
    }
  }
}

export function resolveAttackPlans(swarm, plans, {
  tick,
  forceFields,
  nextFieldNumber = () => 0,
  research = null,
  sourceKillCounts = new Map()
}) {
  const results = [];
  const bondKills = [];
  const triggerQueue = [];
  const killOrdinalBySource = new Map(sourceKillCounts);
  const enqueueKillTriggers = (attack, origin, depth, lineage) => {
    const sourceTowerId = attack.sourceTowerId;
    const ordinal = (killOrdinalBySource.get(sourceTowerId) || 0) + 1;
    killOrdinalBySource.set(sourceTowerId, ordinal);
    for (const trigger of attack.triggers || []) {
      if (trigger.event !== 'kill') continue;
      const everyNthKill = Math.max(1, Math.round(trigger.everyNthKill || 1));
      if (ordinal % everyNthKill !== 0) continue;
      triggerQueue.push({ trigger, attack, origin, depth, lineage });
    }
  };

  for (const plan of plans) {
    const result = {
      attack: plan.attack,
      contact: plan.contact,
      hits: [],
      kills: [],
      controlTargets: [],
      createdFields: []
    };
    const directEffects = plan.attack.effects || [];
    const packetWide = plan.attack.geometry.packetMode === 'all';
    const nonDamageEffects = directEffects.filter((effect) => effect.type !== 'damage');
    for (const victim of plan.victims) {
      const currentVictim = swarm.enemy(victim.id, victim.generation);
      if (!currentVictim) continue;
      let hit = null;
      let hpPopped = 0;
      let overkill = 0;
      let bonus = research ? damageResearchBonus(research, swarm, plan.attack, currentVictim, plan.contact, tick) : 0;
      for (const effect of directEffects) {
        if (effect.type !== 'damage') continue;
        const amount = damageFixed(effect.amount + bonus);
        bonus = 0;
        const live = swarm.enemy(victim.id, victim.generation);
        if (live) overkill += Math.max(0, amount - live.hp);
        hit = swarm.damage(victim.id, victim.generation, amount, { packetWide });
        hpPopped += hit?.hpPopped || 0;
        if (!hit || hit.killed) break;
      }
      if (!hit && !directEffects.some((effect) => effect.type === 'damage')) hit = swarm.enemy(victim.id, victim.generation);
      if (!hit) continue;
      if (hit.bondKill) bondKills.push(hit.bondKill);
      hit.hpPopped = damageFixed(hpPopped);
      hit.overkill = damageFixed(overkill);
      result.hits.push(hit);
      if (hit.killed) {
        result.kills.push(hit);
        for (let unit = 0; unit < hit.unitsKilled; unit += 1) enqueueKillTriggers(plan.attack, hit, 0, []);
      }
      const survivingTarget = hit.recordRemoved ? null : swarm.enemy(victim.id, victim.generation);
      if (survivingTarget && nonDamageEffects.length) {
        applyNonDamageEffects(swarm, [survivingTarget], nonDamageEffects, result, {
          attack: plan.attack,
          origin: survivingTarget,
          tick,
          forceFields,
          nextFieldNumber
        });
      }
    }
    results.push(result);
  }

  swarm.rebuildSpatialIndex();
  let processedTriggers = 0;
  while (triggerQueue.length && processedTriggers < MAX_TRIGGER_EVENTS_PER_TICK) {
    const queued = triggerQueue.shift();
    processedTriggers += 1;
    if (queued.depth >= MAX_TRIGGER_DEPTH || queued.lineage.includes(queued.trigger.id)) continue;
    const result = results.find((candidate) => candidate.attack === queued.attack) || results[0];
    if (!result) break;
    const targets = selectTriggerTargets(swarm, queued.trigger.selector, queued.origin);
    const lineage = [...queued.lineage, queued.trigger.id];

    for (const effect of queued.trigger.effects || []) {
      if (effect.type === 'damage') {
        for (const target of targets) {
          const hit = swarm.damage(target.id, target.generation, effect.amount);
          if (!hit) continue;
          if (hit.bondKill) bondKills.push(hit.bondKill);
          result.hits.push(hit);
          if (!hit.killed) continue;
          result.kills.push(hit);
          for (let unit = 0; unit < hit.unitsKilled; unit += 1) {
            enqueueKillTriggers(queued.attack, hit, queued.depth + 1, lineage);
          }
        }
        swarm.rebuildSpatialIndex();
      } else {
        applyNonDamageEffects(swarm, targets, [effect], result, {
          attack: queued.attack,
          origin: queued.origin,
          tick,
          forceFields,
          nextFieldNumber
        });
      }
    }
  }

  return { results, bondKills, processedTriggers, triggerOverflow: triggerQueue.length > 0 };
}
