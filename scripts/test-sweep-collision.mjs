import assert from 'node:assert/strict';
import { insideSweptBeam } from '../src/core/sweep-collision.js';
import { EmbeddedAuthority } from '../src/core/embedded-session.js';
import { TEST_FIELD_SESSION_CONFIG } from '../src/core/session-config.js';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { createAttackSnapshot } from '../src/core/effect-system.js';
const radians = (degrees) => degrees * Math.PI / 180;
const point = (radius, angle) => ({ x: Math.cos(angle)*radius, y: Math.sin(angle)*radius });
for (const direction of [-1,1]) {
  const end=direction*radians(100/12), between=point(280,end/2);
  assert.equal(insideSweptBeam(between.x,between.y,300,12,0,0),false);
  assert.equal(insideSweptBeam(between.x,between.y,300,12,end,end),false);
  assert.equal(insideSweptBeam(between.x,between.y,300,12,0,end),true,'between-pulse gap is covered');
  const future=point(280,end*2),outside=point(310,end/2);
  assert.equal(insideSweptBeam(future.x,future.y,300,12,0,end),false,'unswept arc is not hit');
  assert.equal(insideSweptBeam(outside.x,outside.y,300,12,0,end),false,'range is bounded');
}
const seam=point(280,Math.PI);
assert.equal(insideSweptBeam(seam.x,seam.y,300,12,radians(179),radians(183)),true,'angle seam');
assert.equal(insideSweptBeam(303,0,300,12,0,0),true,'rounded endcap');
assert.equal(insideSweptBeam(307,0,300,12,0,0),false);

function setup(direction=1) {
 const a=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);
 a.join({clientId:'test',payload:{label:'test'}});
 const area=a.map.defenseAreas[0],owner=a.state.players[0];
 const tower=a.normalizeTower({id:'sweep_test',definitionId:'sweeper',ownerId:owner.id,areaId:area.id,x:area.shape.x,y:area.shape.y});
 a.state.towers.push(tower);a.rebuildModifierCache();a.syncTowerStats();
 const spawn=(angle,hp=1)=>{
  const p=point(280,angle);
  return a.swarm.spawnOne({x:tower.x+p.x,y:tower.y+p.y,spreadX:0,spreadY:0},hp);
 };
 spawn(0,100);
 tower.fireCharge=1;
 a.firePersistent(tower,createAttackSnapshot(TOWER_DEFINITIONS.sweeper,tower,{range:300}));
 const field=a.state.attackFields[0];field.baseAngle=0;field.sweepDirection=direction;
 return {a,field,spawn};
}
for(const direction of [-1,1]) {
 const {a,spawn}=setup(direction);
 const victims=[];
 for(let i=0;i<12;i++) victims.push(spawn(direction*radians((i+.5)*100/12)));
 const survivor=spawn(direction*radians(115));
 for(let tick=0;tick<=36;tick++){a.state.runTick=tick;a.tickAttackFields();}
 assert.ok(victims.every((v)=>!a.swarm.enemy(v.id,v.generation)),'all twelve formerly missed gaps get hit');
 assert.ok(a.swarm.enemy(survivor.id,survivor.generation),'outside the sweep survives');
}
const {a,field,spawn}=setup();
const durable=spawn(radians(100/24),10);
a.tickAttackFields();a.state.runTick=3;a.tickAttackFields();
assert.equal(a.swarm.enemy(durable.id,durable.generation).hp,9,'one hit per pulse, not one per geometry sample');
const b=new EmbeddedAuthority(TEST_FIELD_SESSION_CONFIG);b.applyCorrectionSnapshot(a.correctionSnapshot());
for(let tick=4;tick<=36;tick++){a.state.runTick=tick;b.state.runTick=tick;a.tickAttackFields();b.tickAttackFields();}
assert.deepEqual(b.state.attackFields,a.state.attackFields);
assert.deepEqual(b.swarm.exportCorrection(),a.swarm.exportCorrection());
assert.equal(a.swarm.enemy(durable.id,durable.generation).hp,9,'old parts of the fan are not repeatedly hit');
const tail=setup();tail.field.durationTicks=35;tail.field.expiresTick=36;
const last=tail.spawn(radians(99.5));
for(let tick=0;tick<=35;tick++){tail.a.state.runTick=tick;tail.a.tickAttackFields();}
assert.equal(tail.a.swarm.enemy(last.id,last.generation),null,'partial final interval is covered');
console.log('sweep collision: twelve inter-pulse gaps, both directions, angle seam, range, final interval, damage count and correction passed');
