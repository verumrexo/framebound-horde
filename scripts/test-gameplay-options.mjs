import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { fireReworked,tickReworked } from '../src/core/turret-rework.js';
import { RESEARCH_NODES, REACTOR_CATEGORIES, reactorQuote } from '../src/core/research.js';
import { getMapDefinition,playableMaps } from '../src/core/world-config.js';
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
 const wallet=a.state.economyByPlayer[player.id].credits;
 a.purchaseResearch(command({towerId:station.id,researchId:1,expectedCost:100000}),player);
 assert.equal(a.state.economyByPlayer[player.id].credits,wallet);
 for(const category of REACTOR_CATEGORIES){
  a.state.research.reactor[category.id]=0;assert.equal(reactorQuote(a.state,category.id).cost,10000);
  a.state.research.reactor[category.id]=1;assert.equal(reactorQuote(a.state,category.id).cost,12500);
  a.state.research.reactor[category.id]=2;assert.equal(reactorQuote(a.state,category.id).cost,15625);
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
 const corridor=getMapDefinition('map_04');assert.ok(corridor.sideWalls);assert.ok(corridor.spawnSources.every((s)=>s.y<-900));
 assert.equal(corridor.defenseAreas.filter((area)=>area.shape.x===0).length,2);
 const walled=getMapDefinition('map_06');assert.ok(walled.sideWalls);
 assert.deepEqual(walled.defenseAreas,getMapDefinition('map_01').defenseAreas);
 assert.ok(walled.spawnSources.length>0);
 assert.ok(walled.spawnSources.every((s)=>s.y+s.spreadY<-1050
   && s.x-s.spreadX>walled.bounds.left && s.x+s.spreadX<walled.bounds.right),
 'every rift, including late unlocks, stays north and between the walls');
}
console.log('gameplay options: fleeing backwash, full arsenal, reactor prices, four laser aims/reset, maps and seeded correction passed');
