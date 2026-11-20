'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), sharp = require('sharp');
const source = process.argv[2];
if (!source) throw new Error('Expected extracted bridge artwork directory');
async function main() {
  const roots = ['projection-correction', 'approved-sheet'].map(set => path.join('frontend', 'assets', 'industrial', set));
  const manifests = roots.map(root => JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))));
  const geometryPath = path.join(roots[0], 'runtime-geometry.json');
  const geometry = JSON.parse(fs.readFileSync(geometryPath));
  async function install(id, face, bytes, footprint, bounds, section = false) {
    const {data,info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let x1=info.width,y1=info.height,x2=-1,y2=-1;
    for(let i=3;i<data.length;i+=4) if(data[i]) {
      const p=(i-3)/4,x=p%info.width,y=Math.floor(p/info.width);
      x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x);y2=Math.max(y2,y);
    }
    if(x2<x1) throw new Error('Empty view '+id+':'+face);
    if(section) bounds={x:x1/3,y:-20+y1/3,width:(x2-x1+1)/3,height:(y2-y1+1)/3};
    const hash=crypto.createHash('sha256').update(bytes).digest('hex'),image=id+'-'+face+'-'+hash.slice(0,12)+'.png';
    const view={image,sourceWidth:info.width,sourceHeight:info.height,footprint,bounds,mode:'approved',exposure:1,contact:{x:.5,y:(y2+1)/info.height},effects:false};
    geometry.views[id+':'+face]={image,width:info.width,height:info.height,sha256:hash,crop:{x:x1,y:y1,width:x2-x1+1,height:y2-y1+1}};
    roots.forEach((root,i)=>{fs.writeFileSync(path.join(root,image),bytes);const prop=manifests[i].props[id]||(manifests[i].props[id]={views:{}});prop.views[face]=view;});
  }
  for(const [face,name] of Object.entries({s:'south',w:'west',n:'north',e:'east'})) {
    const consoleBytes=fs.readFileSync(path.join(source,'trio_console','trio_console','rotations',name+'.png'));
    await install('bridge_consolebank',face,consoleBytes,{w:6,h:1},{x:0,y:-20,width:72,height:32});
    // All sections share one opaque bounds frame and floor line, so assembling
    // them reproduces the complete console rather than fitting each crop anew.
    const plate=await sharp(consoleBytes).trim().resize(216,96,{fit:'fill',kernel:'nearest'}).png().toBuffer();
    for(const [i,id] of ['trio_console_left','trio_console_center','trio_console_right'].entries()) {
      const bytes=await sharp(plate).extract({left:i*72,top:0,width:72,height:96}).png().toBuffer();
      await install(id,face,bytes,{w:2,h:1},{x:0,y:-20,width:24,height:32},true);
    }
    const pad=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108"><circle cx="54" cy="54" r="46" fill="#253e4c" stroke="#77dcea" stroke-width="4"/><circle cx="54" cy="54" r="38" fill="#344951" stroke="#a4edf3" stroke-width="1"/><circle cx="54" cy="54" r="9" fill="#456b77"/><path d="M54 18V30M54 78V90M18 54H30M78 54H90" stroke="#a4edf3" stroke-width="3"/></svg>')).png().toBuffer();
    await install('transporter_pad','s',pad,{w:3,h:3},{x:0,y:0,width:36,height:36});
    const structurePath=path.join('dev','industrial-textures','prop-structure-manifest.json');
    const structure=JSON.parse(fs.readFileSync(structurePath));
    structure.props.bridge_consolebank={
      label:'TRIO CONSOLE',family:'screens',description:'Replacement trio console artwork; assign its three standing workstation sections separately.',flat:false,
      views:Object.fromEntries(Object.entries(manifests[0].props.bridge_consolebank.views).map(([face,v])=>[face,{key:'bridge_consolebank'+(face==='s'?'':':'+face),r:['s','w','n','e'].indexOf(face),image:v.image,footprint:v.footprint,bounds:v.bounds}]))
    };
    fs.writeFileSync(structurePath,JSON.stringify(structure,null,2)+'\n');
    const lab=fs.readFileSync(path.join(source,'Scientist_lab','Scientist_lab','rotations',name+'.png'));
    await install('scientist_lab',face,lab,{w:3,h:2},{x:0,y:-12,width:36,height:36});
    for(const [id,original] of [['bridge_officer_chair','simple_red_cushion_chair'],['captain_seat','red_captains_chair']]) {
      const old=manifests[0].props[original].views[face];
      if(!old) throw new Error('Missing chair source '+original+':'+face);
      await install(id,face,fs.readFileSync(path.join(roots[0],old.image)),{w:1,h:1},old.bounds);
    }
  }
  roots.forEach((root,i)=>fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifests[i],null,2)+'\n'));
  fs.writeFileSync(geometryPath,JSON.stringify(geometry,null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
