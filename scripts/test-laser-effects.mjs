import assert from 'node:assert/strict';
import { sweepPose, drawSweep, drawLaserPulse } from '../src/render/laser-effects.js';
import { drawTowerSprite } from '../src/render/tower-sprites.js';
const colors=Object.fromEntries(['black','cyan','mint','green','amber','red','dimMint','ink'].map((name,i)=>[name,[i/8,.5,.8,1]]));
const field={kind:'sweep_line',x:10,y:20,range:300,baseAngle:.2,sweepRadians:Math.PI*100/180,sweepDirection:1,createdTick:100,durationTicks:36,expiresTick:137,attack:{geometry:{width:12}}};
const early=sweepPose(field,103,0), middle=sweepPose(field,103,.5),late=sweepPose(field,104,0);
assert.ok(early.angle<middle.angle&&middle.angle<late.angle,'beam advances between damage pulses');
assert.deepEqual(sweepPose(field,110,0),sweepPose(structuredClone(field),110,0),'pause and reconnect use the same clock');
assert.equal(sweepPose(field,137,0),null,'no ghost beam after expiry');
assert.equal(sweepPose(field,99,0),null,'no premature beam');
assert.equal(sweepPose(field,136,.9).phase,1,'endpoint is clamped');
assert.ok(sweepPose({...field,sweepDirection:-1},110,.5).angle<field.baseAngle,'reverse sweeps move backward');
const project=(x,y)=>({x,y});
const signatures=new Set();
function recorder(){
 const calls=[];
 const shapes=Object.fromEntries(['line','rect','triangle'].map((name)=>[name,(...args)=>calls.push([name,...args])]));
 return {calls,shapes};
}
for(const formId of ['laser','cutter','prism']){
 const {calls,shapes}=recorder();
 assert.equal(drawLaserPulse(shapes,colors,project,2,{formId,age:.04,x1:0,y1:0,x2:100,y2:120,width:16,beamIndex:1}),true);
 signatures.add(JSON.stringify(calls));
 assert.equal(drawLaserPulse(shapes,colors,project,2,{formId,age:1}),false);
}
assert.equal(signatures.size,3,'each pulse family has a distinct draw path');
for(const scale of [.5,2,8])for(const direction of [-1,1])for(const alpha of [0,.5,.99]){
 const {calls,shapes}=recorder();drawSweep(shapes,colors,project,scale,{...field,sweepDirection:direction},110,alpha);
 assert.ok(calls.length>0);
 const numbers=calls.flat(Infinity).filter((v)=>typeof v==='number');assert.ok(numbers.every(Number.isFinite));
}
for(const sweepPhase of [null,0,.5,1]){
 const {calls,shapes}=recorder();drawTowerSprite(shapes,colors,{x:0,y:0},{definitionId:'sweeper'},null,{runTick:5,sweepPhase});
 for(const [,x,y,w,h] of calls){assert.ok([x,y,w,h].every(Number.isInteger));assert.ok(x>=-16&&y>=-16&&x+w<=17&&y+h<=17);}
}
console.log('laser visuals: sub-tick sweep motion, reverse direction, pause/reconnect, expiry, distinct beams and chassis bounds passed');
