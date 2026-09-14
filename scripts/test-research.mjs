import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { RESEARCH_NODES, REACTOR_CATEGORIES, reactorQuote, reactorBatchQuote, arsenalChoices, researchNode } from '../src/core/research.js';
import { secondaryAttack, damageResearchBonus, enemyKey } from '../src/core/research-combat.js';
import { purchaseCost } from '../src/core/network-descendants.js';
let tests=0;
function test(label,fn){fn();console.log(`ok ${++tests} - ${label}`);}
function setup(ids=[]) {
  const a=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  a.join({clientId:'test',payload:{label:'test'}});
  const player=a.state.players[0], area=a.map.defenseAreas[0];
  a.state.teamEconomy.credits=1e15;
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
  const before=a.state.teamEconomy.credits;
  const station=tower('arsenal');
  for(const node of RESEARCH_NODES) a.purchaseResearch(command({towerId:station.id,researchId:node.id,expectedCost:node.cost}),player);
  assert.equal(arsenalChoices(a.state).length,0);
  assert.equal(new Set(a.state.research.unlocked).size,39);
  assert.equal(before-a.state.teamEconomy.credits,279_300_000);
});

test('races, wrong branches, wrong owners and insufficient funds do not spend money',()=>{
  const {a,player,command,tower}=setup();const one=tower('arsenal'),two=tower('arsenal');
  a.purchaseResearch(command({towerId:one.id,researchId:1,expectedCost:100e3}),player);
  const before=a.state.teamEconomy.credits;
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:100e3}),player);
  a.purchaseResearch(command({towerId:one.id,researchId:7,expectedCost:1e6}),player);
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:0}),{id:'stranger'});
  assert.equal(a.state.teamEconomy.credits,before);
  assert.deepEqual(two.researchPath,[]);
  a.purchaseResearch(command({towerId:two.id,researchId:1,expectedCost:0}),player);
  assert.deepEqual(two.researchPath,[]);
  a.state.teamEconomy.credits=0;
  a.purchaseResearch(command({towerId:one.id,researchId:4,expectedCost:1e6}),player);
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
    const after=a.state.teamEconomy.credits;
    a.purchaseReactor(command({towerId:station.id,categoryId:category.id,expectedRank:0,expectedCost:quote.cost}),player);
    assert.equal(a.state.teamEconomy.credits,after);
    if(category.maxRank!==null){a.state.research.reactor[category.id]=category.maxRank;assert.equal(reactorQuote(a.state,category.id),null);}
  }
  assert.equal(purchaseCost(a.state,station.areaId,100),50);
  assert.equal(a.state.base.lives,105);
  const before=a.state.teamEconomy.credits;
  a.sellTower(command({towerId:station.id}),player);
  assert.equal(a.state.teamEconomy.credits-before,750);
  assert.equal(a.state.research.reactor.damage,1);
  const next=tower('reactor');assert.equal(reactorQuote(a.state,'damage').cost,120_000);
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

test('reactor batches match sequential prices, effects, healing and contribution accounting',()=>{
  for (const category of REACTOR_CATEGORIES) {
    const bulk = setup(), single = setup();
    const bulkStation = bulk.tower('reactor'), singleStation = single.tower('reactor');
    const rank = category.maxRank === null ? 7 : category.maxRank - 3;
    for (const run of [bulk, single]) {
      run.a.state.research.reactor[category.id] = rank;
      run.a.state.base.lives = 10;
    }
    const quote = reactorBatchQuote(bulk.a.state, category.id, 5);
    assert.equal(quote.count, category.maxRank === null ? 5 : 3);
    bulk.a.purchaseReactor(bulk.command({ towerId: bulkStation.id, categoryId: category.id, count: quote.count, expectedRank: rank, expectedCost: quote.cost }), bulk.player);
    for (let i = 0; i < quote.count; i++) {
      const next = reactorQuote(single.a.state, category.id);
      single.a.purchaseReactor(single.command({ towerId: singleStation.id, categoryId: category.id, expectedRank: next.rank, expectedCost: next.cost }), single.player);
    }
    assert.deepEqual(bulk.a.state.research.reactor, single.a.state.research.reactor, category.id);
    assert.deepEqual(bulk.a.state.teamEconomy, single.a.state.teamEconomy, category.id);
    assert.deepEqual(bulk.a.state.base, single.a.state.base, category.id);
    assert.deepEqual(bulk.a.state.contributionByPlayer, single.a.state.contributionByPlayer, category.id);
    assert.equal(bulk.a.events.filter(event => event.type === 'reactor.purchased').length, 1);
  }
});

test('unaffordable, stale, malformed and over-cap batches never buy partial ranks',()=>{
  const { a, player, command, tower } = setup();
  const station = tower('reactor');
  const quote = reactorBatchQuote(a.state, 'damage', 5);
  const payload = { towerId: station.id, categoryId: 'damage', count: 5, expectedRank: 0, expectedCost: quote.cost };
  a.state.teamEconomy.credits = quote.cost - 1;
  const before = structuredClone(a.state.teamEconomy);
  a.purchaseReactor(command(payload), player);
  assert.deepEqual(a.state.teamEconomy, before);
  assert.deepEqual(a.state.research.reactor, {});
  a.state.teamEconomy.credits = 1e12;
  for (const count of [null, 0, -1, 1.5, 6, '5', Infinity, NaN]) {
    assert.equal(reactorBatchQuote(a.state, 'damage', count), null);
    a.purchaseReactor(command({ ...payload, count }), player);
    assert.equal(a.state.teamEconomy.totalSpent, 0);
  }
  a.join({ clientId: 'teammate', payload: { label: 'teammate' } });
  const teammate = a.state.players.at(-1);
  a.purchaseReactor(command(payload), teammate);
  const after = structuredClone(a.state.teamEconomy);
  a.purchaseReactor(command(payload), player);
  assert.deepEqual(a.state.teamEconomy, after, 'second player uses a stale batch quote');
  assert.equal(a.state.research.reactor.damage, 5);
  assert.equal(a.state.contributionByPlayer[teammate.id].creditsSpent, quote.cost);
  assert.equal(a.state.contributionByPlayer[player.id].creditsSpent, 0);
  a.state.research.reactor.lives = 19;
  const capped = reactorBatchQuote(a.state, 'lives', 5);
  assert.equal(capped.count, 1);
  a.purchaseReactor(command({ towerId: station.id, categoryId: 'lives', count: 5, expectedRank: 19, expectedCost: capped.cost }), player);
  assert.equal(a.state.research.reactor.lives, 19, 'authority requires the exact quoted count');
  assert.deepEqual(a.state.teamEconomy, after);
  const unsafeRank = Array.from({ length: 200 }, (_, i) => i).find(rank => {
    a.state.research.reactor.damage = rank;
    return reactorQuote(a.state, 'damage') && !reactorBatchQuote(a.state, 'damage', 5);
  });
  assert.ok(unsafeRank > 0, 'reject an unsafe sum even while one rank is still safely priced');
});

test('tracked damage survives corrections, migrates honestly, and resets with test counters',()=>{
  const { a, tower, enemy, hit, command, player } = setup([1]);
  const t = tower(), e = enemy(2);
  a.state.runTick = 60;
  hit(t, e);
  assert.equal(t.hpPopped, 1.2);
  assert.equal(t.kills, 0, 'nonlethal hits count toward tower output');
  assert.equal(t.lastDamageTick, 60);
  hit(t, e);
  assert.equal(t.hpPopped, 2, 'overkill is excluded');
  assert.equal(t.kills, 1);
  a.evolveTower(command({ towerId: t.id, definitionId: 'assault' }), player);
  assert.equal(t.hpPopped, 2, 'replacement preserves tracked lifetime output');
  const correction = a.correctionSnapshot();
  const restored = new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
  restored.applyCorrectionSnapshot(correction);
  assert.equal(restored.state.towers[0].hpPopped, 2);
  assert.equal(restored.state.towers[0].lastDamageTick, 60);
  correction.protocolVersion = 23;
  delete correction.state.towers[0].hpPopped;
  delete correction.state.towers[0].lastDamageTick;
  restored.applyCorrectionSnapshot(correction);
  assert.equal(restored.state.towers[0].hpPopped, 0, 'old kills cannot reconstruct damage');
  a.clearTestField(command({ resetCounters: true }));
  assert.equal(t.hpPopped, 0);
  assert.equal(t.lastDamageTick, 0);
});

test('fractional damage pays whole hp without rounding every upgrade into another hit',()=>{
  const {a,tower,enemy,hit,player}=setup([1]);const t=tower(),e=enemy(2);
  const before=a.state.teamEconomy.credits;
  const first=hit(t,e);assert.equal(first.hits[0].hpPopped,1.2);assert.equal(a.swarm.enemy(e.id,e.generation).hp,.8);
  assert.equal(a.state.teamEconomy.credits-before,1);
  hit(t,e);assert.equal(a.state.teamEconomy.credits-before,2);
});

test('root, conditional and reactor damage are additive around one reactor baseline',()=>{
  const {a,tower,enemy,hit}=setup([1,4,5,10,11]);a.state.research.reactor.damage=1;
  const t=tower(),e=enemy(100,20);
  assert.equal(hit(t,e).hits[0].hpPopped,1.925); // (1 + .1) * (1 + .2 + .3 + .25)
  a.swarm.hpById[e.id]=40;
  assert.equal(hit(t,e).hits[0].hpPopped,1.925); // finishing replaces penetration
});

test('reactor damage ranks multiply by 1.10 each and compound; arsenal stays additive around that baseline',()=>{
  const {a,tower,enemy,hit,attack}=setup();const t=tower();
  a.state.research.reactor.damage=10;
  assert.equal(attack(t).effects[0].amount,2.594); // 1.1^10 quantised to 0.001 hp
  a.state.research.reactor.damage=25;
  assert.equal(attack(t).effects[0].amount,10.835);
  const e=enemy(100,20);assert.equal(hit(t,e).hits[0].hpPopped,10.835);
  a.state.research.unlocked=[1];a.state.research.reactor.damage=10;
  assert.equal(attack(t).effects[0].amount,3.113); // arsenal +20% measured against the rank-adjusted baseline (2.594 * 1.2)
});

test('arsenal tiers cost 100k / 1m / 10m; damage ranks cost 100k x1.20, every other category 10k x1.25',()=>{
  assert.deepEqual([1,2,3].map((tier)=>new Set(RESEARCH_NODES.filter((node)=>node.tier===tier).map((node)=>node.cost))),
    [new Set([100_000]),new Set([1_000_000]),new Set([10_000_000])]);
  const {a}=setup();
  for(const category of REACTOR_CATEGORIES){
    if(category.id==='damage') continue;
    a.state.research.reactor[category.id]=0;assert.equal(reactorQuote(a.state,category.id).cost,10_000,category.id);
    a.state.research.reactor[category.id]=1;assert.equal(reactorQuote(a.state,category.id).cost,12_500,category.id);
    a.state.research.reactor[category.id]=4;assert.equal(reactorQuote(a.state,category.id).cost,Math.ceil(10_000*1.25**4),category.id);
  }
  a.state.research.reactor={damage:0};assert.equal(reactorQuote(a.state,'damage').cost,100_000);
  a.state.research.reactor={damage:1};assert.equal(reactorQuote(a.state,'damage').cost,120_000);
  a.state.research.reactor={damage:20};assert.equal(reactorQuote(a.state,'damage').cost,Math.ceil(100_000*1.2**20));
  assert.equal(REACTOR_CATEGORIES.find((category)=>category.id==='damage').maxRank,null,'damage stays uncapped');
  a.state.research.reactor={damage:3};
  assert.equal(reactorQuote(a.state,'cadence').cost,10_000,'categories price independently');
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
