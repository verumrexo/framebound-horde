import { AUTHORITY_TICK_RATE as RATE } from './protocol.js';
import { planAttackImpact } from './effect-system.js';

// Serializable, generation-qualified state: saves/reconnects preserve shots,
// charge rings, chill and chains without coupling them to packed swarm indices.
const key = (enemy) => `${enemy.id}:${enemy.generation}`;
export function reworkState(a) {
  return a.state.turretRework ||= { shots: [], chains: [], tugs: [], chill: {}, visuals: [] };
}
const enemies = (a, tower, radius = tower.effectiveRange) => a.swarm.enemiesInCircle(tower.x, tower.y, radius)
  .sort((x, y) => Math.hypot(x.x - tower.x, x.y - tower.y) - Math.hypot(y.x - tower.x, y.y - tower.y) || x.id - y.id);
function visual(a, type, data, ticks = 10) {
  reworkState(a).visuals.push({ type, ...data, expiresTick: a.state.runTick + ticks });
}
function status(a, targets, type, magnitude, seconds) {
  a.swarm.applyStatus(targets, { status: type, magnitude, durationSeconds: seconds,
    appliedTick: a.state.runTick, deferCount: true });
  a.state.stats.controlApplications += targets.length;
}
function shareChainControl(a) {
  const tick = a.state.runTick;
  for (const chain of reworkState(a).chains) {
    const seen = chain.seen ||= {};
    // Read the entire group before applying weaker copies. Copies are recorded
    // afterward, so inherited statuses never bounce back or amplify themselves.
    const changes = chain.members.map((m) => ({ ...m,
      slow: a.swarm.slowUntilById[m.id], factor: a.swarm.slowFactorById[m.id],
      freeze: a.swarm.stasisUntilById[m.id] }));
    for (const source of changes) {
      const previous = seen[key(source)] || {};
      const others = chain.members.filter((m) => m.id !== source.id);
      if (source.slow > tick && (source.slow > (previous.slow || 0) || source.factor < (previous.factor ?? 1))) {
        status(a, others, 'slow', (1-source.factor)*.5, (source.slow-tick)/RATE*.5);
      }
      if (source.freeze > tick && source.freeze > (previous.freeze || 0)) {
        status(a, others, 'stasis', 1, (source.freeze-tick)/RATE*.5);
      }
    }
    for (const m of chain.members) seen[key(m)] = {
      slow: a.swarm.slowUntilById[m.id], factor: a.swarm.slowFactorById[m.id], freeze: a.swarm.stasisUntilById[m.id]
    };
  }
}

function chill(a, target, amount) {
  if (a.swarm.stasisUntilById[target.id] > a.state.runTick) return;
  const entry = reworkState(a).chill[key(target)] ||= { value: 0, tick: a.state.runTick };
  entry.value = Math.max(0, entry.value - Math.max(0, a.state.runTick - entry.tick - 8) / RATE * .35) + amount;
  entry.tick = a.state.runTick;
  status(a, [target], 'slow', .35, .25);
  if (entry.value >= 1) {
    entry.value = 0;
    status(a, [target], 'stasis', 1, 1.1);
  }
}
function shot(a, tower, attack, target, extra = {}) {
  const dx = target.x - tower.x, dy = target.y - tower.y, length = Math.hypot(dx, dy) || 1;
  const speed = extra.speed || attack.delivery.speed || 340;
  reworkState(a).shots.push({ type: attack.mechanic, x: tower.x, y: tower.y,
    originX: tower.x, originY: tower.y, dx: dx / length, dy: dy / length,
    target: { id: target.id, generation: target.generation, x: target.x, y: target.y },
    towerId: tower.id, attack, speed, distance: 0, range: attack.range,
    createdTick: a.state.runTick, expiresTick: a.state.runTick + Math.ceil((attack.range / speed + 4) * RATE),
    hitKeys: [], ...extra });
  a.state.stats.shotsFired++;
}
export function fireReworked(a, tower, attack) {
  if (!attack.mechanic) return false;
  if (a.state.runTick < (tower.controlReadyTick || 0)) return true;
  let candidates = enemies(a, tower);
  if (attack.mechanic === 'glue') candidates.sort((x,y) => Number(a.swarm.slowUntilById[x.id] > a.state.runTick) - Number(a.swarm.slowUntilById[y.id] > a.state.runTick));
  if (attack.mechanic === 'concussion') candidates.sort((x,y) => Math.hypot(x.x-a.map.base.x,x.y-a.map.base.y)-Math.hypot(y.x-a.map.base.x,y.y-a.map.base.y) || x.id-y.id);
  if (attack.mechanic === 'freeze_ray') {
    candidates = candidates.filter((e) => a.swarm.stasisUntilById[e.id] <= a.state.runTick);
    const previous = candidates.find((e) => key(e) === tower.freezeTarget);
    if (previous) candidates = [previous, ...candidates.filter((e) => e !== previous)];
  }
  if (!candidates.length) return true;
  const preferred = !attack.supportOnly ? a.researchTarget(tower, attack) : null;
  const target = preferred || candidates[0];
  const tuning = attack.rework || {};
  if (attack.mechanic === 'shotgun') {
    // Manual facing: the owner's strike point fixes the fan direction; otherwise the fan
    // follows the target chosen by the tower's targeting mode. Either way the volley only
    // fires when a live enemy sits inside the fan, so a held facing never wastes reloads.
    const aim = tower.strikePoint && Number.isFinite(tower.strikePoint.x) && Number.isFinite(tower.strikePoint.y)
      && (tower.strikePoint.x !== tower.x || tower.strikePoint.y !== tower.y) ? tower.strikePoint : target;
    const angle = Math.atan2(aim.y-tower.y, aim.x-tower.x);
    const fan = tuning.fanRadians || 1.3;
    if (!candidates.some((e) => Math.cos(Math.atan2(e.y-tower.y,e.x-tower.x)-angle) >= Math.cos(fan*.5))) return true;
    const count = attack.volley.count;
    for (let i = 0; i < count; i++) {
      const theta = angle + (i / Math.max(1,count-1) - .5) * fan;
      shot(a,tower,attack,{ x:tower.x+Math.cos(theta), y:tower.y+Math.sin(theta) }, { type:'pellet', dx:Math.cos(theta),dy:Math.sin(theta),speed:attack.delivery.speed,contactsLeft:tuning.contacts||1 });
    }
  } else if (attack.mechanic === 'orbit') {
    for (let i=0;i<attack.volley.count;i++) {
      const theta=i*Math.PI*2/attack.volley.count;
      shot(a,tower,attack,target,{type:'orbit',angle:theta,dx:Math.cos(theta),dy:Math.sin(theta),speed:attack.delivery.speed,releaseTick:a.state.runTick+(tuning.chargeTicks||60),orbitRadius:tuning.orbitRadius||24,contactsLeft:tuning.contacts||1});
    }
  } else if (attack.mechanic === 'freeze_ray') {
    tower.freezeTarget = key(target);
    chill(a,target,.13);
    visual(a,'ray',{x:tower.x,y:tower.y,x2:target.x,y2:target.y},8);
  } else if (attack.mechanic === 'harpoon') {
    if (candidates.length < 2) return true;
    const pair = candidates.slice(0,2);
    const midpoint = {x:(pair[0].x+pair[1].x)/2,y:(pair[0].y+pair[1].y)/2};
    for (const enemy of pair) shot(a,tower,attack,enemy,{midpoint});
  } else if (attack.mechanic === 'gravity_seed') {
    const point = tower.controlGeometry || target;
    shot(a,tower,attack,point,{speed:attack.delivery.speed,landing:true});
  } else shot(a,tower,attack,target,{speed:attack.delivery.speed,
    landing:attack.mechanic === 'freeze_shell'});
  tower.fireCharge -= 1;
  if (tower.controlStats) { tower.controlStats.activations++; tower.controlStats.lastActiveTick=a.state.runTick; }
  return true;
}
function damage(a, s, target) {
  const attack = { ...s.attack, geometry:{type:'single',maxVictims:1} };
  a.resolvePlans([planAttackImpact(a.swarm,attack,target,new Set(),new Map())]);
}
function impact(a,s,target) {
  const type=s.type;
  if (['pellet','orbit','nail','splinter'].includes(type)) { damage(a,s,target); return; }
  const at=target || s.target;
  if (type==='glue') status(a,[at],'slow',.7,2);
  if (type==='concussion') {
    status(a,[at],'stasis',1,.45);
    const i=a.swarm.indexById[at.id]*4, dx=at.x-a.map.base.x,dy=at.y-a.map.base.y,length=Math.hypot(dx,dy)||1;
    a.swarm.state[i]+=dx/length*24; a.swarm.state[i+1]+=dy/length*24;
    a.swarm.rebuildSpatialIndex();
  }
  if (type==='freeze_shell') {
    const radius=a.towerStat({id:s.towerId},'geometryRadius',64);
    status(a,a.swarm.enemiesInCircle(at.x,at.y,radius),'stasis',1,1.25);
    visual(a,'freeze',{x:at.x,y:at.y,radius},30);
  }
  if (type==='harpoon') reworkState(a).tugs.push({target:s.target,midpoint:s.midpoint,until:a.state.runTick+45});
  if (type==='chain') {
    const state=reworkState(a), occupied=new Set(state.chains.flatMap((c)=>c.members.map(key)));
    const members=a.swarm.enemiesInCircle(at.x,at.y,85).filter((e)=>!occupied.has(key(e))).slice(0,5).map((e)=>({id:e.id,generation:e.generation}));
    if(members.length>1) state.chains.push({members,until:a.state.runTick+180});
  }
  if (type==='gravity_seed') {
    const radius=a.towerStat({id:s.towerId},'controlRadius',108);
    a.state.forceFields.push({id:`seed_${a.nextFieldNumber++}`,kind:'radial_force',sourceTowerId:s.towerId,sourceFormId:'singularity',x:at.x,y:at.y,radius,strength:-1400,createdTick:a.state.runTick,expiresTick:a.state.runTick+60});
    a.state.forceFields.push({id:`seed_hold_${a.nextFieldNumber++}`,kind:'slow_field',sourceTowerId:s.towerId,sourceFormId:'singularity',x:at.x,y:at.y,radius:28,speedFactor:.05,createdTick:a.state.runTick,expiresTick:a.state.runTick+90});
    visual(a,'gravity',{x:at.x,y:at.y,radius},90);
  }
}
export function tickReworked(a) {
  const state=reworkState(a), tick=a.state.runTick;
  state.visuals=state.visuals.filter((v)=>v.expiresTick>tick);
  state.chains=state.chains.filter((c)=>c.until>tick).map((c)=>({...c,members:c.members.filter((m)=>a.swarm.enemy(m.id,m.generation))})).filter((c)=>c.members.length>1);
  for(const [id,entry] of Object.entries(state.chill)) if(tick-entry.tick>180) delete state.chill[id];
  for(const tower of a.state.towers) {
    const definition=a.weaponDefinition(tower);
    if(definition?.control?.type!=='frost_zone'||tick<(tower.controlReadyTick||0)) continue;
    const point=tower.controlGeometry;
    if(point) for(const enemy of a.swarm.enemiesInCircle(point.x,point.y,tower.effectiveControl?.radius||86)) chill(a,enemy,1/(RATE*2));
  }
  state.tugs=state.tugs.filter((t)=>t.until>tick&&a.swarm.enemy(t.target.id,t.target.generation));
  for(const tug of state.tugs) {
    const enemy=a.swarm.enemy(tug.target.id,tug.target.generation), i=a.swarm.indexById[enemy.id]*4;
    const dx=tug.midpoint.x-enemy.x,dy=tug.midpoint.y-enemy.y,l=Math.hypot(dx,dy)||1,step=Math.min(l,110/RATE);
    a.swarm.state[i]+=dx/l*step;a.swarm.state[i+1]+=dy/l*step;
    visual(a,'harpoon',{x:enemy.x,y:enemy.y,x2:tug.midpoint.x,y2:tug.midpoint.y},2);
  }
  if(state.tugs.length) a.swarm.rebuildSpatialIndex();
  const survivors=[];
  // New splinters are queued separately so they cannot advance on their birth tick.
  const spawned=[];
  for(const s of state.shots) {
    if(s.expiresTick<=tick) {a.state.stats.shotsResolved++;continue;}
    if(s.type==='embedded') {
      if(tick<s.burstTick){survivors.push(s);continue;}
      const tuning=s.attack.rework||{};
      const perSide=Math.max(1,Math.round((tuning.splinters||10)/2)), spread=tuning.splinterSpread||.13;
      for(const side of [-1,1]) for(let i=0;i<perSide;i++) {
        const angle=Math.atan2(s.dy,s.dx)+side*Math.PI/2+(i-(perSide-1)/2)*spread;
        spawned.push({...s,type:'splinter',dx:Math.cos(angle),dy:Math.sin(angle),speed:440*(s.attack.delivery.speed/550),distance:0,range:tuning.splinterRange||110,hitKeys:[],contactsLeft:tuning.splinterContacts||1,expiresTick:tick+60});
      }
      a.state.stats.shotsResolved++; a.state.stats.shotsFired+=perSide*2;
      continue;
    }
    if(s.type==='orbit' && tick<s.releaseTick) {
      const theta=s.angle+(tick-s.createdTick)*.05, orbitRadius=s.orbitRadius||24;
      s.x=s.originX+Math.cos(theta)*orbitRadius;s.y=s.originY+Math.sin(theta)*orbitRadius;
      s.dx=Math.cos(theta);s.dy=Math.sin(theta);survivors.push(s);continue;
    }
    const physical=['pellet','orbit','nail','splinter'].includes(s.type);
    const target=s.landing?s.target:a.swarm.enemy(s.target.id,s.target.generation);
    if(!physical&&!s.landing&&!target){a.state.stats.shotsResolved++;continue;}
    if(!physical&&target){const dx=target.x-s.x,dy=target.y-s.y,l=Math.hypot(dx,dy)||1;s.dx=dx/l;s.dy=dy/l;}
    const step=s.speed/RATE;
    const nx=s.x+s.dx*step,ny=s.y+s.dy*step;
    let done=false;
    if(physical){
      const hits=a.swarm.enemiesAlongSegment(s.x,s.y,nx,ny,4,new Set()).filter((e)=>!s.hitKeys.includes(key(e))).sort((x,y)=>Math.hypot(x.x-s.x,x.y-s.y)-Math.hypot(y.x-s.x,y.y-s.y)||x.id-y.id);
      // Nails pierce everything on their line; pellets, storm bullets and splinters carry
      // a bounded contact budget and stop once it is spent.
      for(const hit of hits){s.hitKeys.push(key(hit));impact(a,s,hit);if(s.type!=='nail'){s.contactsLeft=(s.contactsLeft||1)-1;if(s.contactsLeft<=0){done=true;break;}}}
    }else if(target&&Math.hypot(target.x-s.x,target.y-s.y)<=step+5){impact(a,s,target);done=true;}
    s.x=nx;s.y=ny;s.distance+=step;
    if(!done&&s.distance>=s.range && (physical || s.landing)){
      if(s.type==='nail'){const embed=s.attack.rework?.embedTicks||30;s.type='embedded';s.burstTick=tick+embed;s.expiresTick=tick+embed+60;survivors.push(s);continue;}
      done=true;
    }
    if(done)a.state.stats.shotsResolved++;else survivors.push(s);
  }
  state.shots=[...survivors,...spawned];
  shareChainControl(a);
  a.swarm.slowedCount = a.swarm.countSlowed();
}
