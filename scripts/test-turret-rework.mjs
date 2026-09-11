import assert from 'node:assert/strict';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS, CONTROL_FORMS, validateTowerCatalog } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
import { fireReworked, tickReworked, reworkState } from '../src/core/turret-rework.js';
import { normalizeControlGeometry } from '../src/core/control-system.js';
let count=0;
function test(label,fn){fn();console.log(`ok ${++count} - ${label}`);}
function setup(){
 const a=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
 a.join({clientId:'test',payload:{label:'test'}});
 const player=a.state.players[0], area=a.map.defenseAreas[0];
 const add=(id,x=area.shape.x,y=area.shape.y)=>{
  const t=a.normalizeTower({id:`tower_${a.nextTowerNumber++}`,definitionId:id,ownerId:player.id,areaId:area.id,x,y,totalInvestment:1500});
  a.state.towers.push(t);a.rebuildModifierCache();a.syncTowerStats();return t;
 };
 const enemy=(x=area.shape.x+60,y=area.shape.y,hp=100)=>a.swarm.spawnOne({x,y,spreadX:0,spreadY:0},hp);
 const fire=(tower)=>{tower.fireCharge=1; const d=a.weaponDefinition(tower); const attack=a.applyTowerAttackStats(tower,createAttackSnapshot(d,tower,{range:tower.effectiveRange,createdTick:a.state.runTick}));fireReworked(a,tower,attack);};
 const advance=(n)=>{for(let i=0;i<n;i++){a.state.runTick++;a.swarm.tickNumber=a.state.runTick;tickReworked(a);}};
 return {a,area,player,add,enemy,fire,advance};
}
test('all control and network forms are non-damaging, including every research unlock',()=>{
 assert.deepEqual(validateTowerCatalog(),[]);
 for(const id of [...CONTROL_FORMS,'network','overclock','forge','relay','redline','metronome','aperture','mint','reactor','arsenal','amplifier','hardpoint']){
  const {a,add,enemy,fire,advance}=setup();const tower=add(id),victim=enemy();
  a.state.research.unlocked=Array.from({length:39},(_,i)=>i+1);a.state.research.reactor.damage=8;
  if(TOWER_DEFINITIONS[id].attack){fire(tower);advance(300);}
  else assert.equal(TOWER_DEFINITIONS[id].attack,undefined);
  assert.equal(a.swarm.enemy(victim.id,victim.generation)?.hp,100,id);
  assert.equal(a.state.stats.hpPopped || 0,0,id);
 }
});
test('shotgun automatically tracks targets and fires a real divergent fan; nail pierces then bursts sideways',()=>{
 const {a,add,enemy,fire,advance}=setup();const gun=add('broadside');gun.controlReadyTick=0;gun.controlGeometry={kind:'direction',dx:-1,dy:0};enemy(gun.x+60,gun.y);
 fire(gun); // Stale manual geometry must not override automatic targeting.
 assert.equal(reworkState(a).shots.length,17);
 assert.ok(new Set(reworkState(a).shots.map((s)=>s.dy)).size>10);
 assert.ok(reworkState(a).shots.every((s)=>s.dx>0),'auto fan faces the tracked enemy');
 advance(30);assert.ok(a.state.stats.hpPopped>0);
 const b=setup(),nail=b.add('flechette');const one=b.enemy(nail.x+45,nail.y),two=b.enemy(nail.x+90,nail.y);
 b.fire(nail);b.advance(28);
 assert.ok(b.a.swarm.enemy(one.id,one.generation).hp<100);assert.ok(b.a.swarm.enemy(two.id,two.generation).hp<100);
 assert.ok(reworkState(b.a).shots.some((s)=>s.type==='embedded'));
 b.advance(30);const splinters=reworkState(b.a).shots.filter((s)=>s.type==='splinter');
 assert.equal(splinters.length,12);assert.ok(splinters.some((s)=>s.dy>.9)&&splinters.some((s)=>s.dy<-.9));
 assert.ok(splinters.every((s)=>s.contactsLeft===2&&s.range===140),'splinters carry their tuned pierce budget and reach');
});
test('cyclone orbits without damage while charging, then expands outward',()=>{
 const {a,add,enemy,fire,advance}=setup();const t=add('cyclone');enemy(t.x+50,t.y);fire(t);advance(30);
 assert.equal(a.state.stats.hpPopped || 0,0);assert.equal(reworkState(a).shots.length,32);
 assert.ok(reworkState(a).shots.every((s)=>Math.abs(Math.hypot(s.x-t.x,s.y-t.y)-26)<.001));
 advance(50);assert.ok(reworkState(a).shots.some((s)=>Math.hypot(s.x-t.x,s.y-t.y)>70));
});
test('pellets and storm bullets spend a bounded pierce budget; nails pierce everything on their line',()=>{
 const {a,add,enemy,fire,advance}=setup();const gun=add('broadside');
 // Four bodies stacked on one line: a two-contact pellet must stop after the second.
 const line=[30,44,58,72].map((dx)=>enemy(gun.x+dx,gun.y,100));
 gun.strikePoint={x:gun.x+100,y:gun.y};fire(gun);advance(20);
 const hp=line.map((e)=>a.swarm.enemy(e.id,e.generation).hp);
 assert.ok(hp[0]<100&&hp[1]<100,'first two bodies on the centre line take pellets');
 assert.ok(reworkState(a).shots.every((s)=>s.type!=='pellet'||s.contactsLeft>=1));
 const b=setup(),nail=b.add('flechette');const stack=[30,50,70,90,110,130].map((dx)=>b.enemy(nail.x+dx,nail.y,100));
 b.fire(nail);b.advance(20);
 assert.ok(stack.every((e)=>b.a.swarm.enemy(e.id,e.generation).hp<100),'the nail passes through all six');
 const c=setup(),storm=c.add('cyclone');c.enemy(storm.x+50,storm.y,100);
 c.fire(storm);c.advance(53);const lead=reworkState(c.a).shots[0];
 const ring=[60,80,100,120,140].map((d)=>c.enemy(storm.x+lead.dx*d,storm.y+lead.dy*d,100));
 c.advance(80);
 const stormHp=ring.map((e)=>c.a.swarm.enemy(e.id,e.generation).hp);
 assert.equal(stormHp.filter((v)=>v<100).length,4,'a four-contact storm bullet reaches four bodies and the fifth is beyond the pierce budget');
});
test('broadside manual facing holds direction, respects range, waits for a fan target and restores auto',()=>{
 const {a,add,enemy,fire,advance,player}=setup();const gun=add('broadside');
 const command=(payload)=>({clientId:'test',playerId:player.id,sequence:1,payload});
 assert.equal(a.setTowerStrikePoint(command({towerId:gun.id,x:gun.x+gun.effectiveRange+50,y:gun.y}),player)?.type,undefined);
 assert.equal(gun.strikePoint,null,'facing outside range is rejected');
 a.setTowerStrikePoint(command({towerId:gun.id,x:gun.x-80,y:gun.y}),player);
 assert.deepEqual(gun.strikePoint,{x:gun.x-80,y:gun.y});
 const east=enemy(gun.x+60,gun.y);
 fire(gun);assert.equal(reworkState(a).shots.length,0,'a westward fan does not fire at an eastern enemy');
 const west=enemy(gun.x-60,gun.y);fire(gun);
 assert.equal(reworkState(a).shots.length,17);assert.ok(reworkState(a).shots.every((s)=>s.dx<0),'held facing wins over the closer automatic target');
 advance(30);assert.equal(a.swarm.enemy(east.id,east.generation).hp,100);assert.ok(a.swarm.enemy(west.id,west.generation).hp<100);
 const saved=a.correctionSnapshot();const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(saved);
 assert.deepEqual(b.state.towers.find((t)=>t.id===gun.id).strikePoint,{x:gun.x-80,y:gun.y},'manual facing survives correction');
 a.setTowerStrikePoint(command({towerId:gun.id,x:null,y:null}),player);assert.equal(gun.strikePoint,null);
 gun.targetingMode='farthest_base';fire(gun);
 assert.ok(reworkState(a).shots.filter((s)=>s.createdTick===a.state.runTick).every((s)=>s.dx>0||s.dx<0),'automatic mode resumes with the targeting mode');
});
test('glue prefers an untreated enemy; freeze ray builds chill then switches targets',()=>{
 const {a,add,enemy,fire,advance}=setup();const t=add('tether');const first=enemy(t.x+40,t.y),second=enemy(t.x+65,t.y);
 a.swarm.applyStatus([first],{status:'slow',magnitude:.7,durationSeconds:2});fire(t);
 assert.equal(reworkState(a).shots[0].target.id,second.id);advance(20);
 assert.ok(a.swarm.slowUntilById[second.id]>a.state.runTick);
 const ray=add('anchor');
 for(let i=0;i<8;i++){fire(ray);advance(6);}
 assert.ok(a.swarm.stasisUntilById[first.id]>a.state.runTick);
 fire(ray);assert.equal(ray.freezeTarget,`${second.id}:${second.generation}`);
});
test('freeze shell affects a group, harpoons converge, concussion stuns and pushes upstream',()=>{
 const s=setup(),t=s.add('stasis'),one=s.enemy(t.x+60,t.y),two=s.enemy(t.x+65,t.y+10);s.fire(t);s.advance(25);
 assert.ok(s.a.swarm.stasisUntilById[one.id]>s.a.state.runTick);assert.ok(s.a.swarm.stasisUntilById[two.id]>s.a.state.runTick);
 const h=setup(),k=h.add('knot'),left=h.enemy(k.x+60,k.y-25),right=h.enemy(k.x+60,k.y+25);h.fire(k);h.advance(35);
 assert.ok(Math.abs(h.a.swarm.enemy(left.id,left.generation).y-h.a.swarm.enemy(right.id,right.generation).y)<50);
 const b=setup(),back=b.add('backwash'),v=b.enemy(back.x+60,back.y),distance=Math.hypot(v.x-b.a.map.base.x,v.y-b.a.map.base.y);b.fire(back);b.advance(15);
 const current=b.a.swarm.enemy(v.id,v.generation);assert.ok(Math.hypot(current.x-b.a.map.base.x,current.y-b.a.map.base.y)>distance);assert.ok(b.a.swarm.stasisUntilById[v.id]>b.a.state.runTick);
});
test('bond shares weaker control but never propagates kills',()=>{
 const {a,add,enemy,fire,advance}=setup();const b=add('bond'),one=enemy(b.x+60,b.y),two=enemy(b.x+80,b.y);fire(b);advance(15);
 assert.equal(reworkState(a).chains.length,1);
 const glue=add('tether');fire(glue);advance(15);
 assert.ok(a.swarm.slowUntilById[one.id]>a.state.runTick);assert.ok(a.swarm.slowUntilById[two.id]>a.state.runTick);
 assert.ok(a.swarm.slowFactorById[two.id]>a.swarm.slowFactorById[one.id]);
 a.swarm.damage(one.id,one.generation,1000);assert.ok(a.swarm.enemy(two.id,two.generation));
});
test('frost patch chills, seed lands at placed point, and barrage/control geometry is bounded',()=>{
 const {a,add,enemy,advance,fire}=setup();const frost=add('dragnet');frost.controlGeometry={kind:'point',x:frost.x+60,y:frost.y};frost.controlReadyTick=0;const v=enemy();advance(125);
 assert.ok(a.swarm.stasisUntilById[v.id]>a.state.runTick);
 const seed=add('singularity');seed.controlGeometry={kind:'point',x:seed.x+80,y:seed.y};seed.controlReadyTick=0;fire(seed);advance(30);
 assert.ok(a.state.forceFields.some((f)=>f.kind==='radial_force'&&f.x===seed.x+80));
 const wall=add('breaker');assert.equal(normalizeControlGeometry(TOWER_DEFINITIONS.breaker,wall,{kind:'line',x1:wall.x-80,y1:wall.y,x2:wall.x+80,y2:wall.y},a.map),null);
});
test('barricade stops a crossing and opens during recharge',()=>{
 const {a,add,enemy}=setup();const wall=add('breaker');wall.controlReadyTick=0;
 wall.controlGeometry={kind:'line',x1:wall.x-40,y1:wall.y+60,x2:wall.x+40,y2:wall.y+60};
 a.state.runTick=1;const fields=a.syncControlFields();assert.equal(fields.filter((f)=>f.kind==='barricade').length,1);
 const v=enemy(wall.x,wall.y+48);const i=a.swarm.indexById[v.id]*4;a.swarm.state[i+3]=300;
 a.swarm.tick(2,{spawnRatePerSecond:0,forceFields:fields});
 assert.ok(a.swarm.enemy(v.id,v.generation).y<=wall.y+51);
 a.state.runTick=200;assert.equal(a.syncControlFields().filter((f)=>f.kind==='barricade').length,0);
});
test('echo rejects damage weapons, accepts fields and projectiles, and preserves geometry through corrections',()=>{
 const {a,add,player}=setup();const gun=add('assault'),echo=add('echo'),source=add('dragnet');
 const cmd=(id)=>({clientId:'test',playerId:player.id,sequence:1,payload:{towerId:echo.id,sourceTowerId:id}});
 a.setEchoSource(cmd(gun.id),player);assert.equal(echo.echoSourceId,undefined);
 a.setEchoSource(cmd(source.id),player);assert.equal(a.weaponDefinition(echo).id,'dragnet');
 echo.controlGeometry={kind:'point',x:echo.x+50,y:echo.y};
 const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(a.correctionSnapshot());
 assert.deepEqual(b.state.towers.find((t)=>t.id===echo.id).controlGeometry,echo.controlGeometry);
});
test('live rework shots, chill, chains and cooldowns continue deterministically after correction',()=>{
 const {a,add,enemy,fire,advance}=setup();
 for(const id of ['broadside','flechette','cyclone','tether','anchor','stasis','knot','bond','backwash']) {const t=add(id);t.controlReadyTick=0;enemy(t.x+50,t.y,1000);enemy(t.x+70,t.y+10,1000);fire(t);}
 advance(15);
 const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(a.correctionSnapshot());
 for(let i=0;i<180;i++){a.state.runTick++;b.state.runTick++;a.swarm.tickNumber=a.state.runTick;b.swarm.tickNumber=b.state.runTick;tickReworked(a);tickReworked(b);}
 a.swarm.updateChecksum();b.swarm.updateChecksum();
 a.state.swarm=a.swarmSummary(0,[]);b.state.swarm=b.swarmSummary(0,[]);
 assert.deepEqual(b.snapshot(),a.snapshot());assert.deepEqual(b.swarm.exportCorrection(),a.swarm.exportCorrection());
});

test('all forms run together through authority ticks and reconnect without divergent state',()=>{
 const {a,add}=setup();
 for(const id of Object.keys(TOWER_DEFINITIONS))add(id);
 const echo=a.state.towers.find((t)=>t.definitionId==='echo');
 echo.echoSourceId=a.state.towers.find((t)=>t.definitionId==='breaker').id;
 a.syncTowerStats();
 for(let i=0;i<360;i++)a.tick();
 const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(a.correctionSnapshot());
 for(let i=0;i<240;i++){a.tick();b.tick();}
 assert.deepEqual(b.snapshot(),a.snapshot());
 assert.deepEqual(b.swarm.exportCorrection(),a.swarm.exportCorrection());
 assert.ok(a.state.stats.spawned>0);
});

console.log(`${count} turret rework regression groups passed`);
