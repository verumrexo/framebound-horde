import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { fireReworked,tickReworked } from '../src/core/turret-rework.js';
import { RESEARCH_NODES, REACTOR_CATEGORIES, reactorQuote } from '../src/core/research.js';
import { getMapDefinition,playableMaps,relayEligibleAreaIds } from '../src/core/world-config.js';
import { COMMAND } from '../src/core/protocol.js';
function setup(){
 const a=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);a.join({clientId:'test',payload:{label:'test'}});
 const player=a.state.players[0],area=a.map.defenseAreas[0];
 const tower=(id)=>{const t=a.normalizeTower({id:`tower_${a.nextTowerNumber++}`,definitionId:id,ownerId:player.id,areaId:area.id,x:area.shape.x,y:area.shape.y});a.state.towers.push(t);a.rebuildModifierCache();a.syncTowerStats();return t;};
 const command=(payload)=>({clientId:'test',playerId:player.id,sequence:1,payload});
 const attack=(t)=>a.applyTowerAttackStats(t,createAttackSnapshot(TOWER_DEFINITIONS[t.definitionId],t,{range:t.effectiveRange}));
 return {a,tower,player,command,attack};
}
{
 const {a,tower,attack}=setup(),t=tower('backwash');
 const enemy=a.swarm.spawnOne({x:t.x,y:t.y+160,spreadX:0,spreadY:0},100);
 t.fireCharge=1;fireReworked(a,t,attack(t));
 let beyond=false,hit=false;
 for(let tick=1;tick<180;tick++){
  a.state.runTick=tick;a.swarm.tickNumber=tick;
  const i=a.swarm.indexById[enemy.id]*4;a.swarm.state[i+1]+=180/60;a.swarm.rebuildSpatialIndex();
  tickReworked(a);
  if(a.state.turretRework.shots.some((s)=>s.distance>t.effectiveRange))beyond=true;
  if(a.swarm.stasisUntilById[enemy.id]>tick){hit=true;break;}
 }
 assert.ok(beyond&&hit,'backwash catches a fleeing target outside acquisition range');
 assert.equal(a.swarm.enemy(enemy.id,enemy.generation).hp,100);
}
{
 const {a,tower,player,command}=setup(),station=tower('arsenal');
 for(const node of RESEARCH_NODES)a.purchaseResearch(command({towerId:station.id,researchId:node.id,expectedCost:node.cost}),player);
 assert.equal(a.state.research.unlocked.length,39,'one arsenal unlocks every branch');
 const wallet=a.state.teamEconomy.credits;
 a.purchaseResearch(command({towerId:station.id,researchId:1,expectedCost:10000}),player);
 assert.equal(a.state.teamEconomy.credits,wallet);
 for(const category of REACTOR_CATEGORIES){
  const first=10000, growth=category.id==='damage'?1.2:1.25;
  a.state.research.reactor[category.id]=0;assert.equal(reactorQuote(a.state,category.id).cost,first);
  a.state.research.reactor[category.id]=1;assert.equal(reactorQuote(a.state,category.id).cost,Math.ceil(first*growth-1e-8));
  a.state.research.reactor[category.id]=2;assert.equal(reactorQuote(a.state,category.id).cost,Math.ceil(first*growth**2-1e-8));
 }
}
for(const id of ['laser','cutter','prism','sweeper']){
 const {a,tower,player,command,attack}=setup(),t=tower(id);
 a.setTowerStrikePoint(command({towerId:t.id,x:t.x+100,y:t.y}),player);
 assert.ok(t.strikePoint,id);
 t.fireCharge=1;
 if(id==='sweeper'){
  a.firePersistent(t,attack(t));const f=a.state.attackFields[0];
  assert.ok(Math.abs(f.baseAngle+f.sweepDirection*f.sweepRadians*.5)<1e-9,'manual sweep centered on direction');
 }else{
  const plans=[];a.resolvePlans=(p)=>plans.push(...p);a.fireHitscan(t,attack(t));
  assert.equal(plans.length,id==='prism'?3:1);
  for(const p of plans)assert.ok(p.attack.geometry.x2>t.x,'manual beams point right');
 }
 a.setTowerStrikePoint(command({towerId:t.id,x:null,y:null}),player);assert.equal(t.strikePoint,null);
}
{
 const a=new EmbeddedAuthority({...PROTOTYPE_SESSION_CONFIG,seed:123,mapId:'map_05'});
 const first=a.seed,original=a.map.spawnSources;
 a.resetFreshRun('map_05');assert.notEqual(a.seed,first);assert.equal(a.state.seed,a.seed);assert.notDeepEqual(a.map.spawnSources,original);
 assert.deepEqual(a.map.spawnSources,getMapDefinition('map_05',a.seed).spawnSources);
 a.state.phase='running';
 const b=new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG);b.applyCorrectionSnapshot(a.correctionSnapshot());
 assert.deepEqual(b.map.spawnSources,a.map.spawnSources,'host seeded positions survive correction');
 for(let i=0;i<60;i++){a.tick();b.tick();}
 assert.ok(a.state.stats.spawned>0);
 const {lastEventId: ignoredA,...left}=a.snapshot(),{lastEventId: ignoredB,...right}=b.snapshot();assert.deepEqual(left,right);
 assert.equal(playableMaps().length,7);
 const corridor=getMapDefinition('map_04');assert.deepEqual(corridor.walls,['top','bottom']);assert.equal(corridor.flow,'west');
 assert.ok(corridor.spawnSources.every((s)=>s.x>=2500&&s.x+s.spreadX<=corridor.bounds.right&&Math.abs(s.y)+s.spreadY<corridor.bounds.bottom),'corridor rifts open at the eastern end');
 assert.ok(corridor.base.x<=-1100&&corridor.bounds.right-corridor.bounds.left>=4000,'corridor is long with the base at the western end');
 assert.equal(corridor.defenseAreas.filter((area)=>area.shape.y===0).length,5,'centre-line chain keeps the rows linkable');
 assert.equal(relayEligibleAreaIds(corridor).length,corridor.defenseAreas.length,'every corridor nebula is relay-linkable');
 // Randomised rifts: a per-run option on any map, deterministic per seed, always on an open edge.
 for(const id of ['map_01','map_04','map_07']){
  const authored=getMapDefinition(id),shuffled=getMapDefinition(id,11,{randomRifts:true});
  assert.equal(authored.randomizedRifts,undefined);assert.ok(shuffled.randomizedRifts);assert.equal(shuffled.layoutSeed,11);
  assert.deepEqual(getMapDefinition(id,11,{randomRifts:true}).spawnSources,shuffled.spawnSources,'seeded layouts are deterministic');
  assert.notDeepEqual(getMapDefinition(id,12,{randomRifts:true}).spawnSources.map((s)=>[s.x,s.y]),shuffled.spawnSources.map((s)=>[s.x,s.y]));
  assert.deepEqual(shuffled.spawnSources.map((s)=>s.id),authored.spawnSources.map((s)=>s.id),'rift identities survive');
  assert.deepEqual([...shuffled.spawnSources.map((s)=>s.unlockSeconds)].sort((a,b)=>a-b),[...authored.spawnSources.map((s)=>s.unlockSeconds)].sort((a,b)=>a-b),'unlock schedule is permuted, not changed');
  for(const s of shuffled.spawnSources){
   assert.ok(s.x>=authored.bounds.left&&s.x<=authored.bounds.right&&s.y>=authored.bounds.top&&s.y<=authored.bounds.bottom);
   if(id==='map_04')assert.ok(s.x>=2500,'corridor rifts stay on the open eastern edge');
   if(id==='map_01')assert.ok(s.y<=authored.bounds.bottom-300,'flow maps never spawn on the southern wall');
  }
 }
 assert.ok(getMapDefinition('map_04',3,{randomRifts:true}).spawnSources.some((s,i)=>s.unlockSeconds!==getMapDefinition('map_04').spawnSources[i].unlockSeconds)
  || getMapDefinition('map_04',4,{randomRifts:true}).spawnSources.some((s,i)=>s.unlockSeconds!==getMapDefinition('map_04').spawnSources[i].unlockSeconds),'unlock order shuffles');
 {
  const host=new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG);host.join({clientId:'h',payload:{label:'host'}});
  const hp=host.state.players[0];host.state.phase='running';
  host.applyCommand({clientId:'h',playerId:hp.id,sequence:1,type:COMMAND.SESSION_RESTART,payload:{mapId:'map_01',pace:1,randomRifts:true}});
  assert.equal(host.state.randomRifts,true);assert.ok(host.map.randomizedRifts);assert.equal(host.map.layoutSeed,host.state.seed);
  const replica=new EmbeddedAuthority(PROTOTYPE_SESSION_CONFIG);replica.applyCorrectionSnapshot(host.correctionSnapshot());
  assert.deepEqual(replica.map.spawnSources,host.map.spawnSources,'shuffled layout survives correction');
  host.applyCommand({clientId:'h',playerId:hp.id,sequence:2,type:COMMAND.SESSION_RESTART,payload:{}});
  assert.equal(host.state.randomRifts,true,'retry keeps the run option');
  host.applyCommand({clientId:'h',playerId:hp.id,sequence:3,type:COMMAND.SESSION_RESTART,payload:{mapId:'map_01',pace:1,randomRifts:false}});
  assert.equal(host.state.randomRifts,false);assert.equal(host.map.randomizedRifts,undefined);
 }
 const walled=getMapDefinition('map_06');assert.ok(walled.sideWalls);
 assert.deepEqual(walled.defenseAreas,getMapDefinition('map_01').defenseAreas);
 assert.ok(walled.spawnSources.length>0);
 assert.ok(walled.spawnSources.every((s)=>s.y+s.spreadY<-1050
   && s.x-s.spreadX>walled.bounds.left && s.x+s.spreadX<walled.bounds.right),
 'every rift, including late unlocks, stays north and between the walls');
}
console.log('gameplay options: fleeing backwash, full arsenal, reactor prices, four laser aims/reset, maps and seeded correction passed');
