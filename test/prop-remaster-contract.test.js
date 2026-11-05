'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),A=require('./_assert');
const source=fs.readFileSync(path.join(__dirname,'../frontend/app/propremaster.js'),'utf8');
A.ok(/fetch\(ROOT\+'manifest\.json',\{cache:'no-store'\}\)/.test(source),'runtime manifests must revalidate so replaced sprite filenames are picked up on reload');
const bare={module:{exports:{}}};vm.runInNewContext(source,bare);const pack=bare.module.exports;
const good={image:'console.png',sourceWidth:1024,sourceHeight:512,footprint:{w:2,h:1},
 bounds:{x:-1,y:-10,width:26,height:22},mode:'static'};
A.ok(pack.validate(good),'static views declare physical bounds separately from source dimensions');
for(const patch of [{image:'../escape.png'},{image:'https://example.com/a.png'},{image:'a.svg'},
 {sourceWidth:0},{sourceHeight:5000},{bounds:{x:0,y:0,width:Infinity,height:2}},
 {footprint:{w:1.5,h:1}},{mode:'native'},{nativeLayers:[{polygon:[[0,0],[1,1],[NaN,2]]}]},
 {nativeMask:'../mask.png'},{nativeFallbackWhen:['work']}])
 A.eq(pack.validate({...good,...patch}),false,'invalid assets/layers retain native view '+JSON.stringify(patch));
A.ok(pack.validate({...good,mode:'native',nativeLayers:[{polygon:[[1,1],[2,1],[2,2],[1,2]]}]}),'authored native layer polygon accepted');
A.ok(pack.validate({...good,mode:'native',nativeMask:'console-native.png'}),'offline alpha layer accepted');
A.ok(pack.validate({...good,mode:'screen'}),'fully authored screen has no old sprite mask');
A.ok(pack.validate({...good,mode:'scanner',motion:{region:[[.1,.2],[.3,.2],[.3,.4],[.1,.4]]}}),'optical motion region uses source coordinates');
A.eq(pack.validate({...good,mode:'water',motion:{region:[[.1,.2],[.3,.2],[.3,.4]],bubbleLanes:[{x:.9,y:.2,width:.3,height:.2}]}}),false,'water cannot animate outside source bounds');
A.eq(pack.validate({...good,mode:'scanner'}),false,'animated art needs an authored region');
const fit=pack.fit(good.bounds,{width:100,height:200});
A.eq(fit.width/fit.height,.5,'uniform aspect, no squash');
A.eq(fit.x+fit.width/2,12,'center follows original bounds');
A.eq(fit.y+fit.height,12,'feet follow original ground edge');
for (const contact of [{x:0,y:0},{x:1,y:1},{x:.35,y:.75}])
 A.ok(pack.validate({...good,contact}),'export-normalized contact accepts finite inclusive endpoints '+JSON.stringify(contact));
for (const contact of [{x:-.01,y:.5},{x:.5,y:1.01},{x:NaN,y:.5},{x:.5,y:Infinity},
 {x:'0.5',y:.5},{x:.5},{y:.5},{},[.5,.5],false])
 A.eq(pack.validate({...good,contact}),false,'invalid contact cannot enter the authored pack '+JSON.stringify(contact));
A.ok(pack.validate({...good,contact:null}),'null contact keeps legacy optional-anchor behavior');
const contactCrop={x:20,y:40,width:60,height:120},contactBounds={x:-2,y:-8,width:24,height:20};
const anchored=pack.fit(contactBounds,contactCrop,{x:.35,y:.7},200);
A.eq(anchored.width/anchored.height,.5,'contact fitting keeps the source aspect ratio');
A.ok(Math.abs(anchored.y+(140-40)/120*anchored.height-12)<1e-10,'full-image normalized contact, through crop offset, meets ground');
A.ok(anchored.y+anchored.height>12,'source below contact remains drawable rather than being cropped at the feet');
A.eq(anchored.x+anchored.width/2,10,'contact fitting preserves horizontal centering');
A.eq(pack.fit(contactBounds,contactCrop,null,200),pack.fit(contactBounds,contactCrop),'null contact preserves exact legacy fit');
A.eq(pack.enabled('console'),false,'headless/missing manifest defaults to native');
const no=()=>{},calls=[],rects=[];
const painter=new Proxy({globalAlpha:1,fillRect:(...args)=>rects.push(args),
 createLinearGradient:()=>({addColorStop:no}),measureText:()=>({width:0})},
 {get:(o,k)=>k in o?o[k]:no});
let mode=true,still=false;
const window={addEventListener:no,matchMedia:()=>({matches:still})};
const document={addEventListener:no,documentElement:{style:{setProperty:no}},createElement:()=>({getContext:()=>null})};
const U=new Function('window','document',fs.readFileSync(path.join(__dirname,'../frontend/js/util.js'),'utf8')+';return U;')(window,document);
const textures={isRemaster:()=>mode,enabled:()=>mode,ready:Promise.resolve(),workstation:()=>true,chair:()=>true,furniture:()=>true,crate:()=>true};
const remaster={ready:Promise.resolve(),revision:()=>0,enabled:()=>mode,
 draw(ctx,id,view,x,y,w,h,state,native){if(!mode)return false;calls.push({id,view,x,y,w,h,state,native});return true;}};
function load(extra){
 const env={module:{exports:{}},U,window,document,IndustrialTextures:textures,...extra};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/propsprites.js'),'utf8'),env);return env.module.exports;
}
const original=load({}),ps=load({PropRemaster:remaster});ps.setCtx(painter);ps.setNow(1000);
calls.length=0;
ps.draw({t:'plugin_terminal',x:0,y:0,w:1,h:2},false);
A.eq(calls.map(call=>call.id),['plugin_terminal'],'plugin terminal uses its own artwork without replacing the Bridge pylon');
for(const work of [false,true])A.eq(
 ps.lightOf({t:'bridge_dispatch_pylon',x:0,y:0,w:1,h:2},work,true,{}),
 ps.lightOf({t:'plugin_terminal',x:0,y:0,w:1,h:2},work,true,{}),
 'shared pylon skin does not retain a different legacy light spill');
for(const id of ['red_cushion_chair','red_captains_chair','simple_red_cushion_chair']){
 const chair=ps.spec(id);
 A.eq({w:chair.w,h:chair.h,use:chair.use},{w:1,h:1,use:{kind:'seat',sit:true,approach:'auto'}},id+' is a single-tile seat');
 A.eq(ps.facings(id),[0,1,2,3],id+' offers all four authored views');
 for(const [rotation,view] of ['s','w','n','e'].entries()){
  calls.length=0;ps.draw({t:id,x:0,y:0,w:1,h:1,r:rotation},false);
  A.eq(calls.map(call=>({id:call.id,view:call.view})),[{id,view}],id+' routes facing '+view+' to its own art');
 }
}
const furnitureDesk=ps.spec('furniture_desk');
A.eq({label:furnitureDesk.label,tier:furnitureDesk.tier,w:furnitureDesk.w,h:furnitureDesk.h,surface:furnitureDesk.surface},
 {label:'DESK',tier:'cosmetic',w:2,h:1,surface:true},'Desk is separate cosmetic surface furniture');
A.ok(!require('../frontend/app/worldmodel.js').capForProp('furniture_desk'),'furniture Desk grants no workstation capability');
A.ok(ps.spec('desk').retired&&ps.spec('desk').seat,'retired workstation Desk retains its saved identity');
A.eq(ps.facings('furniture_desk'),[0,1,2,3],'furniture Desk offers all four authored views');
for(const [rotation,view] of ['s','w','n','e'].entries()){
 const box=ps.footprintAt('furniture_desk',rotation);
 A.eq(box,rotation%2?{w:1,h:2}:{w:2,h:1},'furniture Desk reserves its rotated tabletop plan');
 calls.length=0;ps.draw({t:'furniture_desk',x:0,y:0,w:box.w,h:box.h,r:rotation},false);
 A.eq(calls.map(call=>({id:call.id,view:call.view})),[{id:'furniture_desk',view}],'furniture Desk routes its own '+view+' artwork');
}
for(const c of ps.CATALOG){
 A.eq(ps.footprintAt(c.id,0),original.footprintAt(c.id,0),'footprint preserved '+c.id);
 A.eq(ps.facings(c.id),original.facings(c.id),'only original authored facings '+c.id);
 A.eq(ps.canMirror(c.id),original.canMirror(c.id),'mirror restrictions preserved '+c.id);
 A.eq(ps.hasOver(c.id),original.hasOver(c.id),'body occlusion contract preserved '+c.id);
}
for(const id of ['crate','desk','desk2','chair','bridge_consolebank','bridge_tacticaltable','bridge_equipmentbay','bridge_deckperimeter']){
 const c=ps.spec(id);if(!c)continue;calls.length=0;
 ps.draw({t:id,x:0,y:0,w:c.w,h:c.h},false);
 A.eq(calls.length,1,'complete approved sheet overrides earlier raster '+id);
}
function draw(t,work=false,record={},live={}){
 calls.length=0;const c=ps.spec(t);ps.draw({t,x:3,y:4,w:c.w,h:c.h,id:'one',...record},work,live);return calls.at(-1);
}
A.eq(draw('console',false).state.work,false,'idle native screen remains idle');
A.eq(draw('console',true,{}, {heat:.6,prog:.4}).state.work,true,'real work reaches native screen');
A.eq(draw('console',true,{}, {heat:.6,prog:.4}).state.prog,.4,'real fraction survives casing replacement');
ps.setConnectorState('c','online',12);
A.eq(draw('connector_portal',false,{connectorId:'c'}).state.state,'online','connector state from live public map');
A.eq(draw('connector_portal').state.bound,false,'unbound socket cannot inherit another connection');
ps.pulseConnector('c');
A.ok(draw('connector_portal',false,{connectorId:'c'}).state.fired>0,'real connector tool pulse retained');
ps.setConnectorState('c','error',12);
A.eq(draw('connector_portal',false,{connectorId:'c'}).state.state,'error','error does not turn into online');
ps.pulseWorkbench(false,'one');
A.eq(draw('workbench').state.bad,true,'failed verify stays red');
A.ok(draw('workbench').state.fired>0,'actual workbench pulse retained');
A.eq(draw('workbench',false,{id:'two'}).state.fired,0,'pulse does not leak to another bench');
ps.setOutboxCrates(6);A.eq(draw('outbox').state.crates,6,'ledger count preserved');
ps.setMissionPins(4,true,true,3);
const pins=draw('missionboard').state;A.eq([pins.pins,pins.hot,pins.jam,pins.proposals],[4,true,true,3],'quest facts preserved');
ps.setTrophyCount(7);ps.setJourneyStage(9);
A.eq([draw('trophycase').state.trophies,draw('trophycase').state.journeyStage],[7,9],'earned facts preserved');
A.eq(draw('airlock',false,{door:'jammed'}).state.door,'jammed','native iris gets actual door state');
A.eq(draw('bunk',false,{sleeper:true}).state.sleeper,true,'native bed leaves space for sleeper');
ps.setSpotifyConnected(false);A.eq(draw('jukebox').state.live,false,'unbound music is not animated as connected');
ps.setSpotifyConnected(true);A.eq(draw('jukebox').state.live,true,'connected music retained');
const a=draw('console');A.eq([a.x,a.y,a.w,a.h],[36,48,24,12],'native local geometry unchanged');
A.eq(a.state.now,1000,'new authored animations receive renderer clock');
A.eq(draw('console',true,{}, {occupied:false}).state.occupied,false,'backend work cannot power an empty seat');
A.eq(draw('console',false,{}, {occupied:true,still:true}).state.still,true,'new art receives reduced-motion state');
A.eq(draw('console',false,{mount:'surface'}).y,40,'mount rises once by eight world pixels');
A.eq(draw('filter',true).state.scanning,false,'agent activity cannot imply a passing transport item');
A.eq(draw('filter',false,{}, {scanning:true}).state.scanning,true,'explicit transport occupancy reaches the new optical reader');
still=true;A.eq(draw('tank').state.still,true,'system reduced-motion preference reaches authored water');still=false;
// A real native callback receives frozen time under reduced motion. It must restore
// ctx/time even though its selected function still reads the shared native closure.
function pixels(at,reduced){
 ps.setNow(at);still=reduced;const call=draw('console');rects.length=0;call.native(painter);return JSON.stringify(rects);
}
A.eq(pixels(100,true),pixels(1100,true),'native decorative movement freezes under reduced motion');
still=false;
mode=false;calls.length=0;rects.length=0;draw('console',true);
A.eq(calls.length,0,'classic bypasses replacement');
A.ok(rects.length>5,'classic actually paints its old prop');
A.ok(!source.slice(source.indexOf('  function draw('),source.indexOf('  const ready=')).includes('getImageData'),'frame compositor has no GPU readback');
// Exercise the real asynchronous loader: a one-alpha fringe below the declared feet
// must survive cropping AND frame allocation, while legacy packs still bottom-align.
async function contactFrameRegression(){
 const rgba=new Uint8ClampedArray(10*12*4),croppedPixels=[];
 for(let y=2;y<=10;y++)for(let x=2;x<=7;x++)rgba[(y*10+x)*4+3]=y<9?255:1;
 const cv=()=>{
  const canvas={width:0,height:0};
  const g={drawImage(){},getImageData:()=>({data:rgba}),
   createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
   putImageData:im=>croppedPixels.push(new Uint8ClampedArray(im.data)),
   scale(){},translate(){}};
  canvas.getContext=()=>g;return canvas;
 };
 class SourceImage{constructor(){this.width=10;this.height=12;}set src(_){Promise.resolve().then(()=>this.onload());}}
 const view={image:'sample.png',sourceWidth:10,sourceHeight:12,footprint:{w:1,h:1},
  bounds:{x:0,y:-6,width:12,height:18},mode:'static'};
 const env={module:{exports:{}},document:{createElement:cv},Image:SourceImage,
  IndustrialTextures:{isRemaster:()=>true},
  fetch:async()=>({ok:true,json:async()=>({version:1,props:{
   contact_sample:{views:{s:{...view,contact:{x:.5,y:.75}}}},legacy_sample:{views:{s:view}}
  }})})};
 vm.runInNewContext(source,env);const loaded=env.module.exports;await loaded.ready;
 A.eq(loaded.status().failures,[],'contact and legacy alpha-fringe fixtures load through real preparation');
 const geo=loaded.viewGeometry('contact_sample');
 A.eq(geo.crop,{x:2,y:2,width:6,height:9},'alpha crop retains faint fringe and removes fully transparent outside padding');
 A.eq(geo.box,{x:0,y:-2,width:12,height:18},'declared feet at source y9 land at world y12 without compressing source');
 A.eq(croppedPixels[0][(8*6+5)*4+3],1,'one-alpha fringe survives source crop unchanged');
 const output=[];
 const target={save(){},restore(){},drawImage:(image,...dest)=>output.push({dest,size:[image.width,image.height]})};
 A.ok(loaded.draw(target,'contact_sample','s',0,0,12,12,{}),'contact sample draws through public renderer');
 A.eq(output.pop(),{dest:[0,-6,12,22],size:[48,88]},'cached frame extends to y16 so fringe below y12 contact is not clipped');
 A.eq(loaded.viewGeometry('legacy_sample').box,{x:0,y:-6,width:12,height:18},'absent contact keeps exact old bottom-aligned image');
 loaded.draw(target,'legacy_sample','s',0,0,12,12,{});
 A.eq(output.pop(),{dest:[0,-6,12,18],size:[48,72]},'legacy frame allocation is unchanged');
}
contactFrameRegression().then(()=>A.report('prop-remaster-contract')).catch(error=>{console.error(error);process.exitCode=1;});
