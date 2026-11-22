'use strict';
const fs=require('fs'),A=require('./_assert');
const src=fs.readFileSync(process.env.WORLD_TEST_SOURCE||'frontend/app/world.js','utf8');
const fn=n=>A.fnBody(src,'function '+n+'(');
const OPP={north:'south',south:'north',east:'west',west:'east'};
for(const name of ['tick','crewEngineStep']) {
 const who=name==='tick'?'agent':'self', source=fn(name);
 const block=A.fnBody(source,`if (${who}.target) {`);
 A.ok(block.length>500&&block.length<6500,name+' movement block is bounded');
 const build=Function('body','clear','pauseOnCorner',`
 let agent=body,self=body,activity='idle',fnow=1000;const OPP=${JSON.stringify(OPP)},CORNER_LOOK=2.5,SPEED=28;
 const U={irnd:()=>1200,chance:()=>true},crewBeatDamp=()=>1,armBeat=()=>{},curiositySay=()=>{};
 ${fn('maybeStrollBeat')}
 const canRoundCorner=()=>clear,shouldYieldToCargo=()=>false,nearestBox=()=>null;
 const nextWaypoint=()=>{const t=body.pathPts[body.pathIdx++];body.target={...t};if(pauseOnCorner)maybeStrollBeat()};
 const arrive=()=>{body.target=null;body.state='idle'},stepGait=(b,dx,dy,d,sp,last,dt)=>Math.min(d,sp*dt/1000);
 const gaitMove=(b,dx,dy,d,s)=>{b.px+=dx/d*s;b.py+=dy/d*s};
 return {step:(dt,now)=>{${block}},arm:maybeStrollBeat};`);
 let b={px:0,py:0,dir:'east',target:{x:1,y:0},pathPts:[{x:1,y:0},{x:30,y:0}],pathIdx:1,goal:null};
 let r=build(b,true,false);r.step(16,1000);A.ok(b.px>0,name+' advances through a reached waypoint in the same frame');
 b={px:0,py:0,dir:'east',target:{x:1,y:0},pathPts:[{x:1,y:0},{x:30,y:0}],pathIdx:1,goal:null};
 r=build(b,false,false);r.step(16,1000);A.eq(b.pathIdx,1,name+' cannot cut an obstructed corner');
 r.arm();const held=b.pauseDir;for(let n=0;n<30;n++)r.step(16,1000+n*16);
 A.eq(b.dir,'west',name+' look-back holds the opposite direction');A.eq(b.dir,held,name+' look-back remains latched');
 b={px:0,py:0,dir:'east',target:{x:1,y:0},pathPts:[{x:1,y:0},{x:30,y:0}],pathIdx:1,goal:null};
 r=build(b,true,true);r.step(16,1000);A.eq(b.px,0,name+' newly armed pause is respected at handoff');
 r.step(16,2300);A.ok(b.px>0,name+' resumes the committed route after the hold');
}
const seatFn=fn('stepCrewToSeat');
const seatStep=Function(`const CORNER_LOOK=2.5,seatFoot=s=>({x:30,y:0}),canRoundCorner=()=>true,stepTraffic=()=>false;
const crewNextWaypoint=b=>{b.target=b.pathPts[b.pathIdx++]},stepGait=(b,dx,dy,d,sp,last,dt)=>Math.min(d,sp*dt/1000);
 const gaitMove=(b,dx,dy,d,s)=>{b.px+=dx/d*s;b.py+=dy/d*s};
${seatFn};return stepCrewToSeat;`)();
const worker={px:0,py:0,target:{x:1,y:0},pathPts:[{x:1,y:0},{x:30,y:0}],pathIdx:1,pauseUntil:9999};seatStep(worker,{},16,1000);
A.ok(worker.px>0,'workstation route advances through waypoint without an idle frame or leisure pause');
const transit = Function('available','warnings',`
const geo={props:[{id:'a',t:'transporter_pad',x:2,y:2,w:3,h:3},{id:'b',t:'transporter_pad',x:12,y:2,w:3,h:3}],
 walkable:()=>available};
const blocked=new Set(),fnow=1000,footOf=(x,y)=>({x,y}),tileOf=(x,y)=>({x,y});
const movementBlockers=()=>blocked,console={warn:message=>warnings.push(message)};
${fn('advanceBodyWaypoint')}
return advanceBodyWaypoint;`);
const marker={x:13,y:3,transportFrom:'a',transportTo:'b'};
let traveler={px:3,py:3,pathPts:[marker,{x:15,y:3}],pathIdx:0};
transit(true,[])(traveler);
A.eq([traveler.px,traveler.py], [13,3], 'transporter moves an agent from source to arrival pad');
A.eq(traveler.target, {x:15,y:3}, 'the agent continues to its original destination');
const warnings=[];
traveler={px:3,py:3,pathPts:[marker],pathIdx:0};
transit(false,warnings)(traveler);
A.eq([traveler.px,traveler.py], [3,3], 'an occupied arrival leaves the agent at the source');
A.ok(!traveler.target && warnings.length === 1, 'failed transit clears the route and reports the failure');
traveler={px:4,py:3,pathPts:[marker],pathIdx:0};
transit(true,[])(traveler);
A.eq([traveler.px,traveler.py], [4,3], 'an agent not on the source pad cannot transport');
A.report('world-movement-continuity');
