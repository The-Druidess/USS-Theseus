'use strict';
const TheseusRefit = (() => {
  const roles = { captain: 'agent', helm: 'bridge-helm', operations: 'foreman', first: 'chief', ambassador: 'researcher', engineer: 'engineer', security: 'bridge-tactical', comms: 'bridge-comms', science: 'bridge-science', medical: 'bridge-medical', banker: 'portal-treasurer' };
  const clone = value => JSON.parse(JSON.stringify(value));
  function build(source, assignments = roles) {
    if (!source || source.schema !== 'starnet.station') throw new Error('A saved station is required');
    const replacing = !!source.meta.theseusRefit;
    if (replacing && !Array.isArray(source.meta.hulls?.bridge?.roomIds)) throw new Error('The installed Theseus Bridge layout is invalid');
    const previous = WorldModel.deserialize(clone(source));
    const oldBridge = source.meta.spawnRoomId;
    const oldRoom = source.rooms[oldBridge];
    if (!oldRoom) throw new Error('The current Bridge room is missing');
    const oldHullIds = new Set(replacing ? source.meta.hulls.bridge.roomIds : [oldBridge]);
    if (!oldHullIds.has(oldBridge)) throw new Error('The current Bridge room is missing from the upper hull');
    const doc = clone(source);
    const oldProps = source.props.filter(p => oldHullIds.has(previous.roomAt(p.x, p.y)));
    const owners = new Set(Object.values(assignments));
    for (const aid of owners) {
      if (!oldProps.some(p => p.agentId === aid && WorldModel.capForProp(p.t) === 'computer')) throw new Error('Missing assigned Bridge workstation for ' + aid);
    }
    doc.order = doc.order.filter(id => !oldHullIds.has(id));
    for (const id of oldHullIds) delete doc.rooms[id];
    doc.props = doc.props.filter(p => !oldProps.some(q => q.id === p.id));
    const promenadeRoomIds = doc.order.slice();
    const retainedRects = doc.order.flatMap(id => doc.rooms[id].rects);
    if (!retainedRects.length) throw new Error('The factory layout to preserve on Promenade is missing');
    const promenade = {
      x1: Math.min(...retainedRects.map(r => r.x1)), y1: Math.min(...retainedRects.map(r => r.y1)),
      x2: Math.max(...retainedRects.map(r => r.x2)), y2: Math.max(...retainedRects.map(r => r.y2))
    };
    // Decks occupy disjoint world coordinates in the one execution document.
    // Camera navigation never swaps models or interrupts the factory's routing.
    const left = promenade.x2 + 12, cx = left + 28, cy = 30, radius = 28;
    const x = n => left + n;
    const nid = prefix => prefix + doc._nid++;
    const rooms = {};
    function room(key, name, kind, rects, wallMat = 'cruiser') {
      const id = key === 'bridge' ? oldBridge : nid('r');
      rooms[key] = id;
      doc.rooms[id] = { id, name, kind, rects, floorStyle: 'burgundy', floorMat: 'carpet', wallMat, wallStyle: 'ash', hullStyle: 'ash', hullMat: 'monocoque', tier: 0, floorPaint: {} };
      doc.order.push(id);
      return id;
    }
    const rect = (x1,y1,x2,y2) => ({x1:x(x1),y1,x2:x(x2),y2});
    room('bridge', 'THE BRIDGE', 'bridge', [rect(0,0,55,19)], 'viewport');
    room('office', "CAPTAIN'S OFFICE", 'hab', [rect(0,20,11,40)]);
    room('science', 'SCIENCE LAB', 'lab', [rect(0,41,27,57)]);
    room('medical', 'MEDICAL BAY', 'lab', [rect(44,20,55,40)]);
    room('treasury', 'TREASURY', 'hab', [rect(28,41,55,57)]);
    room('deck', 'TRANSPORTER HUB', 'hab', [rect(12,20,43,40)]);
    for(const [key,side] of Object.entries({bridge:'south',office:'east',science:'north',medical:'west',treasury:'north'})) doc.rooms[rooms[key]].doorSide=side;
    const model = WorldModel.deserialize(doc);
    const preservedIds = new Map();
    function place(t, dx, y, extra = {}, oldId) {
      const spec = PropSprites.spec(t);
      if (!spec) throw new Error('Missing prop artwork: ' + t);
      const result = model.addProp({t,x:x(dx),y,w:spec.w,h:spec.h,block:spec.blocks,...extra});
      if (!result.ok) throw new Error('Cannot place '+t+' at '+dx+','+y+': '+result.error);
      const p = model.propById(result.id);
      if (oldId) preservedIds.set(p.id, oldId);
      if (extra.label) p.label = extra.label;
      return p;
    }
    function assigned(role,t,dx,y,extra={}) {
      const aid = assignments[role], old = oldProps.find(p => p.agentId === aid && WorldModel.capForProp(p.t) === 'computer');
      return place(t,dx,y,{agentId:aid,...extra},old.id);
    }
    assigned('helm','console',23,9);
    assigned('operations','console',31,9);
    const oldCaptain = source.meta.commander && oldProps.find(p => p.id === source.meta.commander.propId);
    if (!oldCaptain) throw new Error('Current commander seat is missing');
    const captain = place('captain_seat',28,14,{r:2},oldCaptain.id);
    const bound = model.setCommanderSeat({propId:captain.id,skin:source.meta.commander.skin});
    if (!bound.ok) throw new Error('Cannot bind captain seat: '+bound.error);
    assigned('ambassador','bridge_officer_chair',25,14,{r:2});
    assigned('first','bridge_officer_chair',31,14,{r:2});
    assigned('engineer','trio_console_left',25,16);
    assigned('security','trio_console_center',27,16);
    assigned('comms','trio_console_right',29,16);
    place('bench',20,12,{label:'AFT TERMINAL / PORT',shared:true});
    place('bench',32,12,{label:'AFT TERMINAL / STARBOARD',shared:true});
    place('transporter_pad',27,29);
    function desk(role,dx,y,assignedLaptop=true) {
      place('furniture_desk',dx,y,{w:4,h:1});
      if(assignedLaptop) assigned(role,'laptop',dx,y);
      else place('laptop',dx,y,{shared:true});
      place('desktop_inbox_outbox',dx+3,y);
    }
    desk('captain',8,28);
    desk('science',17,43,false);
    assigned('science','scientist_lab',20,46);
    place('simple_red_cushion_chair',18,44,{r:2,block:false});
    desk('medical',48,28);
    for(const dx of [45,48,51]) place('repair_bed',dx,31);
    desk('banker',35,43);
    place('simple_red_cushion_chair',35,42,{block:false});
    place('simple_red_cushion_chair',38,42,{block:false});
    place('equipment_safe',34,45);
    place('equipment_atm',39,48);
    // Room-scoped capability equipment follows officers to their new rooms.
    // It does not change toolset switches, provider credentials or consent.
    const grants = oldProps.filter(p => WorldModel.capabilitiesForProp(p.t).some(cap => cap !== 'computer'));
    for(const key of ['bridge','office','science','medical','treasury']) {
      for(const original of grants) {
        const caps = WorldModel.capabilitiesForProp(original.t).filter(cap => cap !== 'computer');
        if(caps.every(cap => model.props().some(p => model.roomAt(p.x,p.y) === rooms[key] && WorldModel.capabilitiesForProp(p.t).includes(cap)))) continue;
        const spec = PropSprites.spec(original.t);
        let spot = null;
        for(const r of model.roomById(rooms[key]).rects) {
          for(let y=r.y1+1;y<=r.y2-spec.h+1&&!spot;y++) for(let tx=r.x1+1;tx<=r.x2-spec.w&&!spot;tx++) {
            if(model.canPlaceProp(original.t,tx,y,spec.w,spec.h).ok && model.canPlaceProp('simple_red_cushion_chair',tx,y+spec.h,1,1).ok) spot={tx,y};
          }
          if(spot) break;
        }
        if(!spot) throw new Error('No space for preserved '+original.t+' in '+key);
        const p = place(original.t,spot.tx-left,spot.y);
        for(const field of ['connectorId','pluginId']) if(original[field]) p[field]=original[field];
      }
    }
    const result = model.serialize();
    for (const p of result.props) if (preservedIds.has(p.id)) p.id = preservedIds.get(p.id);
    result.meta.commander.propId = oldCaptain.id;
    result.meta.name = 'USS THESEUS';
    result.meta.spawnRoomId = rooms.bridge;
    result.meta.trunkRoomId = rooms.bridge;
    result.meta.theseusRefit = 1;
    result.meta.hulls = {
      bridge: { x1:left-2,y1:-3,x2:left+58,y2:59,circle:{x:cx,y:cy,r:radius},roomIds:Object.values(rooms) },
      promenade: { ...promenade,roomIds:promenadeRoomIds }
    };
    for(const aid of owners) {
      const before = previous.bayObjects(aid).map(o=>typeof o==='string'?o:JSON.stringify(o)).sort();
      const after = model.bayObjects(aid).map(o=>typeof o==='string'?o:JSON.stringify(o)).sort();
      if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Refit changes room capabilities for '+aid);
    }
    return result;
  }
  return { build, roles };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TheseusRefit;
