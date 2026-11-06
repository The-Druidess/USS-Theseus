'use strict';
const fs=require('node:fs'),path=require('node:path');
const A=require('./_assert'),WM=require('../frontend/app/worldmodel'),PS=require('../frontend/app/propsprites'),Anchor=require('../frontend/app/propanchor');
global.WorldModel=WM;global.PropSprites=PS;
const Refit=require('../frontend/app/theseus-refit');
WM.setPropRules(PS.ruleFor);
const initial=WM.defaultDoc();
initial.rooms[initial.meta.spawnRoomId].rects=[{x1:0,y1:0,x2:38,y2:20}];
const original=WM.create(initial);
for(const [i,aid] of Object.values(Refit.roles).entries()) A.ok(original.addProp({t:'console',x:i*3,y:5,w:2,h:1,agentId:aid}).ok,'original officer workstation places');
const captain=original.addProp({t:'simple_red_cushion_chair',x:18,y:9,w:1,h:1});
A.ok(original.setCommanderSeat({propId:captain.id,skin:'q_judge'}).ok,'original Q binding places');
for(const [t,x,w,h] of [['war_intelcab',1,1,2],['gigs_servercart',4,1,1],['comms_dish',7,2,2],['bench',11,4,1]]) A.ok(original.addProp({t,x,y:12,w,h}).ok,'original tool equipment places');
const factory=original.addRoom({name:'FACTORY',kind:'factory',rect:{x1:-22,y1:0,x2:-3,y2:15}});
A.ok(factory.ok,'factory places');
for(const [i,aid] of Object.values(Refit.roles).entries()) A.ok(original.addProp({t:'bay',x:-20+(i%5)*3,y:8+Math.floor(i/5)*2,w:2,h:1,agentId:aid}).ok,'officer remote dock places');
for(const [i,aid] of ['researcher-2','writer','reviewer'].entries()) A.ok(original.addProp({t:'console',x:-20+i*4,y:2,w:2,h:1,agentId:aid}).ok,'factory workstation places');
for(const [i,aid] of ['researcher-2','writer','reviewer'].entries()) A.ok(original.addProp({t:'bay',x:-20+i*4,y:5,w:2,h:1,agentId:aid}).ok,'factory dock places');
const source=original.serialize(),before=JSON.stringify(source);
const result=Refit.build(source);
A.eq(JSON.stringify(source),before,'refit generator never mutates the source');
const model=WM.deserialize(result);
const b=model.roomById(result.meta.spawnRoomId);
const h=result.meta.hulls.bridge;
const geo=model.projectGeometry();
let hullTiles=0,bridgeTiles=0;
for(let y=0;y<geo.ROWS;y++) for(let x=0;x<geo.COLS;x++) {
  const wx=x+geo.origin.tx, wy=y+geo.origin.ty;
  if(Math.hypot(wx+.5-h.circle.x,wy+.5-h.circle.y)>h.circle.r) continue;
  hullTiles++;
  if(geo.zoneGrid[geo.idx(x,y)]===b.id) bridgeTiles++;
  A.ok(geo.zoneGrid[geo.idx(x,y)]!==null,'hull interior has floor at '+wx+','+wy);
}
const ratio=bridgeTiles/hullTiles;
A.ok(ratio>=.25&&ratio<=.37,'Bridge is approximately one third of the round upper hull');
A.eq(Object.values(result.rooms).filter(r=>r.kind!=='corridor'&&!result.meta.hulls.promenade.roomIds.includes(r.id)).length,6,'upper hull has five rooms and a transporter hub');
A.eq(result.meta.hulls.bridge.roomIds.map(id=>result.rooms[id].kind).filter(kind=>kind==='corridor').length,0,'bridge hull has no hallway rooms');
const hub=Object.values(result.rooms).find(r=>r.name==='TRANSPORTER HUB');
const touches=(a,b)=>(a.x2+1===b.x1||b.x2+1===a.x1)&&a.y1<=b.y2&&a.y2>=b.y1
  ||(a.y2+1===b.y1||b.y2+1===a.y1)&&a.x1<=b.x2&&a.x2>=b.x1;
for(const room of Object.values(result.rooms).filter(r=>r.id!==hub.id&&!result.meta.hulls.promenade.roomIds.includes(r.id))) {
  A.ok(room.rects.some(a=>hub.rects.some(b=>touches(a,b))),'bridge-hull entry is flush with transporter hub: '+room.name);
}
A.eq(result.rooms[factory.id],source.rooms[factory.id],'factory room is preserved on Promenade');
for(const p of source.props.filter(p=>original.roomAt(p.x,p.y)===factory.id)) A.eq(model.propById(p.id),p,'factory props and assignments keep IDs and geometry');
A.eq(result.meta.createdAt,source.meta.createdAt,'station save identity is preserved');
A.eq(result.meta.commander,source.meta.commander,'Q keeps his commander identity and chair binding ID');
A.eq(model.propById(captain.id).t,'captain_seat','center binding uses captain seat artwork without normalizing it away');
for(const aid of Object.values(Refit.roles)) {
  const old=source.props.find(p=>p.agentId===aid);
  const p=model.propById(old.id);
  A.eq(p.agentId,aid,'officer workstation identity and assignment survive');
  A.eq(model.bayObjects(aid).sort(),original.bayObjects(aid).sort(),'room tool grants are preserved for '+aid);
  A.ok(model.bayObjects(aid).includes('computer'),'assigned officer retains compute access');
  A.ok(model.ensureWorkstation(aid).existing,'seeder recognizes the new assigned work position');
}
const treasury=Object.values(result.rooms).find(r=>r.name==='TREASURY');
A.ok(model.props().some(p=>p.t==='equipment_safe'&&model.roomAt(p.x,p.y)===treasury.id),'bank safe is in treasury');
A.ok(model.props().some(p=>p.t==='equipment_atm'&&model.roomAt(p.x,p.y)===treasury.id),'ATM is in treasury');
for(const p of model.props().filter(p=>p.t==='desktop_inbox_outbox'||p.t==='laptop')) A.eq(model.mountOf(p),'surface','all laptops and trays are mounted on desks');
const transporter=model.props().find(p=>p.t==='transporter_pad');
A.eq([transporter.x+1.5,transporter.y+1.5],[h.circle.x+.5,h.circle.y+.5],'transporter is centered to within half a tile');
const local=p=>geo.props.find(q=>q.id===p.id);
const worldSource=fs.readFileSync(path.join(__dirname,'../frontend/app/world.js'),'utf8');
const mayTouch=Function('station','roomOfLocalTile','isOwnableProp',A.fnBody(worldSource,'function mayTouchProp(')+';return mayTouchProp;')
  (model,(x,y)=>model.roomAt(x+geo.origin.tx,y+geo.origin.ty),t=>WM.capForProp(t)==='computer');
const panels=model.props().filter(p=>p.shared&&p.t==='bench'&&p.label);
A.eq(panels.length,2,'two aft panels are explicitly shared');
for(const p of panels) {
  A.ok(mayTouch(Refit.roles.helm,geo.props.find(q=>q.id===p.id)),'bridge officers can approach a shared aft interface');
  A.ok(!mayTouch(Refit.roles.banker,geo.props.find(q=>q.id===p.id)),'shared interfaces stay within their room access scope');
}
const seat=Function('PropAnchor','geo','station','PropSprites','blocked','IndustrialTextures',`
${A.fnBody(worldSource,'function seatCx(')}
${A.fnBody(worldSource,'function seatCy(')}
${A.fnBody(worldSource,'function deskSeat(')}
return deskSeat;`)(Anchor,geo,model,PS,new Set(),{isRemaster:()=>true});
for(const p of model.props().filter(p=>p.agentId&&WM.capForProp(p.t)==='computer')) {
  const anchor=seat(local(p));
  A.ok(anchor,'assigned workstation has an approach');
  A.ok(geo.walkable(anchor.tx,anchor.ty),'officer approach is walkable');
  A.eq(anchor.sit!==false,PS.spec(p.t).workPose!=='standing','standing console sections never create seated poses');
  const room=model.roomById(model.roomAt(p.x,p.y));
  const index=geo.zoneGrid.findIndex((id,i)=>id===room.id&&geo.walkable(i%geo.COLS,Math.floor(i/geo.COLS)));
  const entry={x:index%geo.COLS,y:Math.floor(index/geo.COLS)};
  A.ok(geo.path(entry.x,entry.y,anchor.tx,anchor.ty),'assigned station is reachable from its room entrance: '+p.agentId);
  if(!result.meta.hulls.promenade.roomIds.includes(room.id)) {
    A.ok(geo.path(transporter.x+1-geo.origin.tx,transporter.y+1-geo.origin.ty,anchor.tx,anchor.ty),'transporter hub reaches '+p.agentId+' through an actual doorway');
  }
}
A.eq(model.props().filter(p=>PS.spec(p.t)?.workPose==='standing').length,3,'exactly three assigned standing console positions');
A.eq(model.props().filter(p=>p.t==='repair_bed').length,3,'medical beds are installed');
for(const t of ['repair_bed','transporter_pad']) A.ok(!PS.spec(t).use&&!WM.capForProp(t),'repair and transport remain visual-only');
const replacement=original.replaceLayout(result);
A.ok(replacement.ok,'atomic replacement accepts mounted laptops and trays: '+(replacement.error||replacement.code||''));
A.ok(original.undo().ok,'entire refit is one undo step');
A.eq(original.serialize(),source,'undo restores the previous hull and factory');
A.ok(original.redo().ok,'refit can be redone');
A.eq(WM.deserialize(original.serialize()).serialize(),original.serialize(),'new hull metadata, assignments and captain seat survive reload');
A.eq(model.projectGeometry().hullViews.bridge.circle.r,28*12,'renderer uses the same round hull dimensions as navigation');
const origin=geo.origin, left=h.circle.x-28;
A.ok(!geo.canStep(left+8-origin.tx,20-origin.ty,left+8-origin.tx,19-origin.ty),'bridge wall stays closed away from its entrance');
const chair=geo.props.find(p=>p.t==='bridge_officer_chair');
const chairPlacement=Function('agent','deskPropFor','deskSeat',`
let blocked,deskPropId,deskFace,desk,seat;
${A.fnBody(worldSource,'function placeDesk(')}
placeDesk(); return {blocked,seat};` )({id:chair.agentId},()=>chair,seat);
A.ok(!chairPlacement.blocked.has(chairPlacement.seat.tx+','+chairPlacement.seat.ty),'direct chair workstation does not block the hero from its own seat');
const pickedHulls=[];
const selectBodyHull=Function('geo','Hulls',A.fnBody(worldSource,'function selectBodyHull(')+';return selectBodyHull;')(geo,{active:'bridge',select:id=>pickedHulls.push(id)});
const factoryView=geo.hullViews.promenade;
selectBodyHull({px:factoryView.x+12,py:factoryView.y+12});
A.eq(pickedHulls,['promenade'],'COMMS focus reveals a body on the other live deck');
const factoryPlate=model.projectGeometry({up:30,skirt:40}).hullViews.promenade;
A.ok(factoryPlate.w>factoryView.w&&factoryPlate.h>factoryView.h,'Promenade framing includes the full height of the preserved hull walls and skirts');
const framing=Function('cache','geo','activeHull','cv','document','clampz','MINZ','MAXZ',`
let scale,panX,panY,fitW,fitH;
${A.fnBody(worldSource,'function fitCamera(')}
fitCamera();return {scale,panY};`)({},geo,'bridge',{width:1400,height:1000,getBoundingClientRect:()=>({top:0,height:1000})},{getElementById:()=>({getBoundingClientRect:()=>({bottom:100})})},(x,min,max)=>Math.min(max,Math.max(min,x)),.1,10);
A.ok(framing.panY+geo.hullViews.bridge.y*framing.scale>=112,'overview keeps the viewing window below the hull tabs');
const bakeSource=fs.readFileSync(path.join(__dirname,'../frontend/app/stationbake.js'),'utf8');
A.ok(bakeSource.includes('drawRoundHulls(b);'),'round hull is painted into both native and remastered detail plates');
const hullCommands=[];
const hullAssignments=[];
const hullContext=new Proxy({}, {get:(_,method)=>(...args)=>hullCommands.push([method,...args]),set:(_,key,value)=>{hullAssignments.push([key,value]);return true;}});
const paintHull=Function('G','T','VX','VY',A.fnBody(bakeSource,'function eraseRoundExterior(')+A.fnBody(bakeSource,'function drawRoundHulls(')+';return drawRoundHulls;')(geo,12,0,0);
paintHull(hullContext);
const cutout=hullCommands.findIndex(c=>c[0]==='rect');
A.eq(hullCommands.slice(cutout-1,cutout+4).map(c=>c[0]),['beginPath','rect','moveTo','arc','fill'],'circular cutout is an independent subpath, without a diagonal seam to the outer rectangle');
A.ok(bakeSource.includes("eraseRoundExterior(lightCv.getContext('2d'),h.circle,14)"),'old rectangular exterior lighting cannot reappear outside the round hull rim');
A.ok(hullAssignments.some(([key,value])=>key==='globalAlpha'&&value===1)&&hullAssignments.some(([key,value])=>key==='fillStyle'&&value==='#000'),'hull erasure is fully opaque despite translucent floor stencil or lighting state');
const rebuilt=Refit.build(result);
const rebuiltModel=WM.deserialize(rebuilt);
A.eq(rebuilt.meta.hulls.bridge.roomIds.map(id=>rebuilt.rooms[id].kind).filter(kind=>kind==='corridor').length,0,'rebuilding an installed refit keeps hallways out');
A.eq(rebuilt.meta.hulls.promenade.roomIds.map(id=>rebuilt.rooms[id].name).sort(),result.meta.hulls.promenade.roomIds.map(id=>result.rooms[id].name).sort(),'rebuilding preserves Promenade rooms');
A.eq(rebuiltModel.props().length,model.props().length,'rebuilding does not duplicate or drop station props');
WM.setPropRules(null);
A.report('theseus-refit');
