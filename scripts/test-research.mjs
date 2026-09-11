import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { RESEARCH_NODES, REACTOR_CATEGORIES, reactorQuote, arsenalChoices, researchNode } from '../src/core/research.js';
import { secondaryAttack, damageResearchBonus, enemyKey } from '../src/core/research-combat.js';
import { purchaseCost } from '../src/core/network-descendants.js';
let tests=0;
function test(label,fn){fn();console.log(`ok ${++tests} - ${label}`);}
function setup(ids=[]) {
  const a=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  a.join({clientId:'test',payload:{label:'test'}});
  const player=a.state.players[0], area=a.map.defenseAreas[0];
  a.state.economyByPlayer[player.id].credits=1e15;
  a.state.research.unlocked=[...ids];
  const command=(payload)=>({clientId:'test',playerId:player.id,sequence:1,payload});
  function tower(id='frame') {
    const t=a.normalizeTower({id:`tower_${a.nextTowerNumber++}`,definitionId:id,ownerId:player.id,x:area.shape.x,y:area.shape.y,areaId:area.id,totalInvestment:1500});
    a.state.towers.push(t);a.rebuildModifierCache();a.syncTowerStats();return t;
  }
  function enemy(hp=100,dx=60,dy=0){return a.swarm.spawnOne({x:area.shape.x+dx,y:area.shape.y+dy,spreadX:0,spreadY:0},hp);}
  function attack(t,definition=TOWER_DEFINITIONS[t.definitionId]) {
    return a.applyTowerAttackStats(t,createAttackSnapshot(definition,t,{range:t.effectiveRange,createdTick:a.state.runTick}));
  }
  function hit(t,e,atk=attack(t)) {
    const current=a.swarm.enemy(e.id,e.generation);
    return a.resolvePlans([{attack:atk,contact:current,victims:[current]}]).results[0];
  }
  return {a,player,area,command,tower,enemy,attack,hit};
}

test('39 unique nodes form exactly 3/9/27 paths, and all can be purchased',()=>{
  assert.equal(RESEARCH_NODES.length,39);
  assert.deepEqual([1,2,3].map(t=>RESEARCH_NODES.filter(n=>n.tier===t).length),[3,9,27]);
  const {a,player,command,tower}=setup();
  const before=a.state.economyByPlayer[player.id].credits;
  const station=tower('arsenal');
  for(const node of RESEARCH_NODES) a.purchaseResearch(command({towerId:station.id,researchId:node.id,expectedCost:node.cost}),player);
  assert.equal(arsenalChoices(a.state).length,0);
  assert.equal(new Set(a.state.research.unlocked).size,39);
  assert.equal(before-a.state.economyByPlayer[player.id].credits,27_930_000);
});

test('races, wrong branches, wrong owners and insufficient funds do not spend money',()=>{
  const {a,player,command,tower}=setup();const one=tower('arsenal'),two=tower('arsenal');
  a.purchaseResearch(command({towerId:one.id,researchId:1,expectedCost:10e3}),player);
  const before=a.state.economyByPlayer[player.id].credits;
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:10e3}),player);
  a.purchaseResearch(command({towerId:one.id,researchId:7,expectedCost:100e3}),player);
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:0}),{id:'stranger'});
  assert.equal(a.state.economyByPlayer[player.id].credits,before);
  assert.deepEqual(two.researchPath,[]);
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:0}),player);
  assert.deepEqual(two.researchPath,[]);
  a.state.economyByPlayer[player.id].credits=0;
  a.purchaseResearch(command({towerId:one.id,researchId:4,expectedCost:100e3}),player);
  assert.deepEqual(one.researchPath,[]);
  assert.deepEqual(a.state.research.unlocked,[1]);
});

test('all 12 reactor categories enforce global prices, caps and nonrefundable purchases',()=>{
  assert.equal(REACTOR_CATEGORIES.length,12);
  const {a,player,command,tower}=setup();const station=tower('reactor');
  for(const category of REACTOR_CATEGORIES){
    const quote=reactorQuote(a.state,category.id);
    a.purchaseReactor(command({towerId:station.id,categoryId:category.id,expectedRank:0,expectedCost:quote.cost}),player);
    assert.equal(a.state.research.reactor[category.id],1);
    const after=a.state.economyByPlayer[player.id].credits;
    a.purchaseReactor(command({towerId:station.id,categoryId:category.id,expectedRank:0,expectedCost:quote.cost}),player);
    assert.equal(a.state.economyByPlayer[player.id].credits,after);
    if(category.maxRank!==null){a.state.research.reactor[category.id]=category.maxRank;assert.equal(reactorQuote(a.state,category.id),null);}
  }
  assert.equal(purchaseCost(a.state,station.areaId,100),50);
  assert.equal(a.state.base.lives,105);
  const before=a.state.economyByPlayer[player.id].credits;
  a.sellTower(command({towerId:station.id}),player);
  assert.equal(a.state.economyByPlayer[player.id].credits-before,750);
  assert.equal(a.state.research.reactor.damage,1);
  const next=tower('reactor');assert.equal(reactorQuote(a.state,'damage').cost,11000);
  assert.equal(next.totalInvestment,1500);
});

test('old stations migrate in place; research and queued attacks survive correction',()=>{
  const {a,tower}=setup([1,4]); const old=tower('salvage'),old2=tower('foundry');
  assert.equal(old.definitionId,'reactor');assert.equal(old2.definitionId,'arsenal');
  assert.equal(old.totalInvestment,1500);assert.deepEqual(old2.researchPath,[]);
  a.state.research.reactor.damage=2;a.state.research.pending.push({tick:100,towerId:old.id,attack:{test:true}});
  const correction=a.correctionSnapshot();correction.protocolVersion=16;
  const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(correction);
  assert.deepEqual(b.state.research,a.state.research);
  a.resetFreshRun();assert.deepEqual(a.state.research.unlocked,[]);assert.deepEqual(a.state.research.reactor,{});
});

test('fractional damage pays whole hp without rounding every upgrade into another hit',()=>{
  const {a,tower,enemy,hit,player}=setup([1]);const t=tower(),e=enemy(2);
  const before=a.state.economyByPlayer[player.id].credits;
  const first=hit(t,e);assert.equal(first.hits[0].hpPopped,1.2);assert.equal(a.swarm.enemy(e.id,e.generation).hp,.8);
  assert.equal(a.state.economyByPlayer[player.id].credits-before,1);
  hit(t,e);assert.equal(a.state.economyByPlayer[player.id].credits-before,2);
});

test('root, conditional and reactor damage are additive around one reactor baseline',()=>{
  const {a,tower,enemy,hit}=setup([1,4,5,10,11]);a.state.research.reactor.damage=1;
  const t=tower(),e=enemy(100,20);
  assert.equal(hit(t,e).hits[0].hpPopped,2.625); // 1.5 * (1 + .2 + .3 + .25)
  a.swarm.hpById[e.id]=40;
  assert.equal(hit(t,e).hits[0].hpPopped,2.625); // finishing replaces penetration
});

test('narrow bore trades width for damage; suppression and sustain do not freeze',()=>{
  const {a,tower,enemy,hit,attack}=setup([1,12,15,37,39]);a.state.research.reactor.sustain=10;
  const t=tower('laser'),e=enemy(100);const atk=attack(t);
  assert.equal(atk.geometry.width,12);
  assert.equal(atk.effects[0].amount,1.95);
  const slow=atk.effects.find(effect=>effect.status==='slow');assert.equal(slow.magnitude,.2);assert.equal(slow.durationSeconds,2.4);
  hit(t,e,atk);assert.equal(a.swarm.stasisUntilById[e.id],0);assert.equal(a.swarm.slowUntilById[e.id],144);
});

test('shell breaker and repulsion are counted, bounded, and generation-scoped',()=>{
  const {a,tower,enemy,hit}=setup([14,33]);const t=tower(),e=enemy(100,20);
  for(let i=0;i<3;i++) assert.equal(hit(t,e).hits[0].hpPopped,1);
  assert.equal(hit(t,e).hits[0].hpPopped,2);
  const before=a.swarm.enemy(e.id,e.generation);hit(t,e);const after=a.swarm.enemy(e.id,e.generation);
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<=10.001);
  assert.ok(a.state.research.combat[enemyKey(e)].repulseUntil>0);
});

test('coordinated fire exposes once; prolonged/synchronized exposure is bounded',()=>{
  const {a,tower,enemy,hit}=setup([6,20]);a.state.runTick=10;
  const ts=[tower(),tower(),tower()],e=enemy(100);
  for(const t of ts) hit(t,e);
  const entry=a.state.research.combat[enemyKey(e)];assert.equal(entry.exposedUntil,250);
  assert.equal(hit(ts[0],e).hits[0].hpPopped,1.5);
  assert.equal(hit(ts[0],e).hits[0].hpPopped,1);
  a.state.research.unlocked.push(21);a.state.runTick=500;
  for(const t of ts) hit(t,e);
  for(const t of ts) assert.equal(hit(t,e).hits[0].hpPopped,1.2);
  assert.equal(hit(ts[0],e).hits[0].hpPopped,1);
});

test('secondary attacks cannot reapply conditional research or cascade on kill',()=>{
  const {a,tower,enemy,attack,hit}=setup([1,4,5,9,17,18,28]);const t=tower(),e=enemy(10);
  const secondary=secondaryAttack(attack(t),.25);
  assert.equal(secondary.effects[0].amount,.3);
  assert.equal(hit(t,e,secondary).hits[0].hpPopped,.3);
  assert.deepEqual(secondary.triggers,[]);assert.deepEqual(secondary.impactFollowUps,[]);
  assert.equal(a.state.research.pending.length,0);
});

test('overkill transfer and final impact use actual damage with a per-cycle limit',()=>{
  const {a,tower,enemy,attack,hit}=setup([17,18]);a.state.research.reactor.damage=2;
  const t=tower(),e=enemy(1),near=enemy(10,65);const atk=attack(t);
  hit(t,e,atk);
  assert.ok(a.swarm.enemy(near.id,near.generation).hp<10);
  assert.equal(Object.keys(a.state.research.finalImpactCycles).length,1);
  const e2=enemy(1,63);hit(t,e2,atk);
  assert.equal(Object.keys(a.state.research.finalImpactCycles).length,1);
});

test('magazines store finite cycles; charged opening consumes its bonus once',()=>{
  const {a,tower,enemy}=setup([7,22,24]);const t=tower();
  for(let i=1;i<=400;i++){a.state.runTick=i;a.fireTowers();}
  assert.equal(t.fireCharge,4);
  enemy(100);a.state.runTick=401;a.fireTowers();
  assert.equal(a.state.projectiles[0].attack.effects[0].amount,1.75);
  assert.equal(t.researchIdleSince,null);
  assert.ok(t.fireCharge<4);
});

test('controlled burst, double shot, delay and split assignment produce one marked attack',()=>{
  const {a,tower,enemy}=setup([9,28,29,30]);const t=tower();
  for(let i=0;i<30;i++) enemy(100,30+i*3);
  t.fireCharge=1;a.state.runTick=1;a.fireTowers();
  t.fireCharge=1;a.state.runTick=2;a.fireTowers();
  assert.equal(a.state.research.pending.length,1);
  const pending=a.state.research.pending[0];assert.equal(pending.tick,38);assert.equal(pending.attack.effects[0].amount,.4);
  assert.equal(pending.attack.research.secondary,true);assert.equal(pending.attack.research.split,true);assert.equal(pending.attack.volley.count,1);
  t.fireCharge=0;a.state.runTick=38;a.fireTowers();assert.equal(a.state.research.pending.length,0);
});

test('execution, highest-hp, shared-lock and reserved-damage targeting are available',()=>{
  const {a,tower,enemy,attack,command,player}=setup([16,19,27,36]);const t=tower(),low=enemy(1,60),high=enemy(100,30);
  a.setTowerTargeting(command({towerId:t.id,mode:'execution'}),player);
  assert.equal(a.researchTarget(t,attack(t)).id,low.id);
  a.setTowerTargeting(command({towerId:t.id,mode:'highest_hp'}),player);
  assert.equal(a.researchTarget(t,attack(t)).id,high.id);
  a.researchReservations=new Map([[enemyKey(high),100]]);
  assert.equal(a.researchTarget(t,attack(t)).id,low.id);
  a.researchReservations.clear();t.targetingMode='closest';
  a.state.research.combat[enemyKey(low)]={exposedUntil:100,contributors:{[t.id]:0}};
  assert.equal(a.researchTarget(t,attack(t)).id,low.id);
});

test('point-blank shells, frozen-target damage, rangefinder and flight speed activate',()=>{
  const {a,tower,enemy,attack,hit}=setup([31,34,35,38]);const t=tower('rocket'),e=enemy(100);
  t.researchTrackingKey=enemyKey(e);t.researchTrackingSince=0;a.state.runTick=120;
  a.swarm.stasisUntilById[e.id]=200;
  const atk=attack(t);assert.equal(atk.delivery.speed,364);
  assert.equal(hit(t,e,atk).hits[0].hpPopped,2.2);
});

test('physical continuations hit only one extra enemy and never chain',()=>{
  for (const ids of [[13],[13,25]]) {
    const {a,tower,enemy,attack}=setup(ids);const t=tower();
    const first=enemy(ids.includes(25)?1:100,30), second=enemy(100,60), third=enemy(100,90);
    t.fireCharge=1;a.fireProjectileVolley(t,attack(t));
    for(let tick=1;tick<80;tick++){a.state.runTick=tick;a.moveProjectiles();}
    assert.equal(a.swarm.enemy(second.id,second.generation).hp,ids.includes(25)?99.75:99.5);
    assert.equal(a.swarm.enemy(third.id,third.generation).hp,100);
    if(!ids.includes(25)) assert.equal(a.swarm.enemy(first.id,first.generation).hp,99);
    assert.equal(a.state.projectiles.length,0);
  }
});

console.log(`${tests} research integration groups passed`);
