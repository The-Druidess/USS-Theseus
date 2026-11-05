'use strict';
/* node test/desk-one-per-agent.test.js — ONE DESK PER AGENT, whoever gives it (audit, 2026-10-08).

   world.js seats an agent at the FIRST workstation bound to it (deskPropFor). The BUILD MODE chips (build.js assignDesk)
   already took the agent off its other workstation in the same transaction, but the overseer's station-control 'agent'
   op (stationbuilder.js) was a bare assignPropAgent: the agent ended up double-bound, kept walking to its OLD desk, and the
   tool reported success. Both now bind through the station's own assignDesk (worldmodel.js) — one rule, one UNDO.
   Run against the REAL world model, station builder and build.js assignDesk (lifted). */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const M = require('../frontend/app/worldmodel.js'), P = require('../frontend/app/pipeline.js'), W = require('../frontend/app/workflowline.js');
const SB = require('../frontend/app/stationbuilder.js'), T = require('../frontend/app/stationtemplates.js'), Sprites = require('../frontend/app/propsprites.js');

M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
const crew = [{ id: 'agent', name: 'NOVA' }, { id: 'rex', name: 'REX' }];
const E = { WorldModel: M, Pipeline: P, WorkflowLine: W, crew, heroId: 'agent', StationTemplates: T, PropSprites: Sprites,
  EquipmentHelp: require('../frontend/app/equipmenthelp.js'), RoomStyles: require('../frontend/app/roomstyles.js'),
  LineLayout: require('../frontend/app/linelayout.js'), LineEdit: require('../frontend/app/lineedit.js') };
const snap = st => JSON.stringify(st.serialize());
const isDesk = (st, p) => st.capForProp(p.t) === 'computer';
const desksOf = (st, aid) => st.propsByAgent(aid).filter(p => isDesk(st, p)).map(p => p.id);
// world.js deskPropFor: the FIRST workstation bound to the agent is where it sits
const seatOf = (st, aid) => { const p = st.props().find(q => q.agentId === aid && isDesk(st, q)); return p ? p.id : null; };
{
  const source = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
  const declaration = source.match(/const catalog = [^\r\n]+/)[0];
  const visible = new Function('PropSprites', declaration + ';return catalog();')(Sprites);
  A.eq(visible.filter(item => item.cat === 'workstation' && item.seat).map(item => item.id),
    ['console', 'laptop', 'pixelrig', 'bench'], 'picker offers active workstation designs including Laptop');
  const starter = M.starterDoc();
  A.eq(starter.props.filter(prop => M.capForProp(prop.t) === 'computer').map(prop => prop.t), ['console'], 'fresh stations start with Console');
  const fresh = M.create(M.defaultDoc());
  const seeded = fresh.ensureWorkstation('agent');
  A.ok(seeded.ok && fresh.propById(seeded.id).t === 'console', 'new agents receive Console instead of a retired Desk');
  for (const type of ['desk', 'desk2', 'consoleL']) {
    const legacy = M.starterDoc();
    const workstation = legacy.props.find(prop => M.capForProp(prop.t) === 'computer');
    workstation.t = type; workstation.agentId = 'agent'; workstation.w = type === 'consoleL' ? 3 : 2;
    workstation.label = 'My workstation'; workstation.brief = 'Keep the standing instructions'; workstation.role = 'Reviewer';
    const restored = M.deserialize(legacy);
    const existing = restored.ensureWorkstation('agent');
    const replacement = restored.propById(existing.id);
    A.ok(existing.ok && existing.id === workstation.id && replacement.t === 'console',
      type + ' upgrades in place without losing its agent assignment');
    A.eq([replacement.x,replacement.y,replacement.w,replacement.h],[workstation.x,workstation.y,2,1],type+' replacement never enlarges the floor footprint');
    for (const key of ['agentId','label','brief','role']) A.eq(replacement[key],workstation[key],type+' preserves '+key);
    A.eq(M.deserialize(restored.serialize()).serialize(),restored.serialize(),type+' migration is idempotent');
  }
}
{
  const st = M.create(M.starterDoc());
  const old = st.ensureWorkstation('agent');
  A.eq(st.canPlaceProp('laptop',6,5,1,1).error,'NEEDS_SURFACE','Laptop requires a table or desk');
  const table = st.addProp({t:'furniture_desk',x:6,y:5,w:2,h:1,block:true});
  const laptop = st.addProp({t:'laptop',x:6,y:5,w:1,h:1,block:false});
  A.ok(table.ok&&laptop.ok,'Laptop places on furniture Desk');
  A.eq(st.mountOf(st.propById(laptop.id)),'surface','Laptop resolves its tabletop mount');
  A.eq(M.capForProp('laptop'),'computer','Laptop supplies the same compute capability as Console');
  A.ok(st.assignDesk(laptop.id,'agent').ok,'Laptop uses the workstation assignment rule');
  A.ok(!st.propById(old.id).agentId,'assigning Laptop releases the agent\'s other workstation');
  A.eq(st.ensureWorkstation('agent').id,laptop.id,'Laptop satisfies the agent\'s workstation requirement');
  const restored = M.deserialize(st.serialize());
  A.eq(restored.propById(laptop.id).agentId,'agent','Laptop assignment survives reload');
  A.eq(restored.mountOf(restored.propById(laptop.id)),'surface','Laptop tabletop placement survives reload');
  A.ok(restored.ensureWorkstation('rex').ok,'another agent has its own workstation');
  const plan=SB.planEdit(restored.serialize(),{refit:[{op:'agent',prop:laptop.id,agent:'rex'}]},E);
  A.ok(plan.ok&&SB.apply(restored,plan.plan,E).ok,'agent builder can assign a tabletop Laptop');
  A.eq(desksOf(restored,'rex'),[laptop.id],'agent-builder Laptop assignment releases the previous workstation');
}
// a station where REX already sits at its desk, plus a free desk in a new room (the one it is about to be given)
function station() {
  const st = M.create(M.starterDoc());
  st.ensureWorkstation('agent'); st.ensureWorkstation('rex');
  const r = SB.planEdit(st.serialize(), { refit: [{ op: 'hall', x: 18, y: 4, w: 6, h: 3 }, { op: 'room', name: 'Den', kind: 'hab', x: 24, y: 0, w: 18, h: 11 }, { op: 'place', t: 'console', x: 34, y: 1 }] }, E);
  A.ok(r.ok && SB.apply(st, r.plan, E).ok, 'fixture: a room with a free desk (' + (r.error || 'ok') + ')');
  const free = st.props().find(p => p.t === 'console' && p.x === 34 && p.y === 1);
  const old = desksOf(st, 'rex')[0];
  A.ok(free && !free.agentId && old && old !== free.id, 'fixture: REX has its own desk and the Den desk is free');
  return { st, free: free.id, old };
}

/* ---- 1. the station's own rule: worldmodel assignDesk ---- */
{
  const { st, free, old } = station(), before = snap(st);
  A.ok(typeof st.assignDesk === 'function', 'the station owns the one-desk-per-agent rule (station.assignDesk)');
  const r = st.assignDesk ? st.assignDesk(free, 'rex') : { ok: false };
  A.ok(r.ok, 'giving REX the Den desk succeeds');
  A.eq(desksOf(st, 'rex'), [free], 'REX holds exactly ONE workstation: the one it was given');
  A.eq(seatOf(st, 'rex'), free, 'so the desk REX walks to is the new one (deskPropFor = first bound workstation)');
  A.ok(!st.propById(old).agentId, 'its old desk is free again');
  A.eq(r.released, [old], 'the result names the desk it left, so a tool can say so');
  A.ok(st.undo().ok && snap(st) === before, 'ONE undo puts REX back at its old desk');
  // a bay is not a seat: binding REX to a bay never takes it off its desk
  let spot = null;
  for (let y = 4; y <= 9 && !spot; y++) for (let x = 26; x <= 39 && !spot; x++) if (st.canPlaceProp('bay', x, y, 2, 2).ok) spot = { x, y };
  const bay = spot ? st.addProp({ t: 'bay', x: spot.x, y: spot.y, w: 2, h: 2 }) : { ok: false };
  A.ok(bay.ok, 'fixture: a bay');
  A.ok(st.assignDesk && st.assignDesk(bay.id, 'rex').ok && desksOf(st, 'rex').length === 1 && st.propById(bay.id).agentId === 'rex', 'staffing a bay leaves REX\'s desk alone');
  // emptying a desk unbinds just that desk
  const mine = desksOf(st, 'rex')[0];
  A.ok(st.assignDesk && st.assignDesk(mine, '').ok && desksOf(st, 'rex').length === 0 && st.propById(bay.id).agentId === 'rex', 'NOBODY empties that desk and nothing else');
  // a refused binding changes nothing and leaves undo history as it was
  const s2 = snap(st), undoable = st.canUndo();
  A.ok(st.assignDesk && !st.assignDesk(free, 'NOT A VALID ID!').ok && snap(st) === s2 && st.canUndo() === undoable, 'a refused binding changes nothing');
  A.ok(st.assignDesk && !st.assignDesk('no-such-prop', 'rex').ok && snap(st) === s2, 'a missing desk changes nothing');
}

/* ---- 2. the overseer's station-control 'agent' op binds through the same rule ---- */
{
  const { st, free, old } = station(), before = snap(st);
  const p = SB.planEdit(st.serialize(), { refit: [{ op: 'agent', prop: free, agent: 'rex' }] }, E);
  A.ok(p.ok, 'the op plans (' + (p.error || 'ok') + ')');
  const oldDesk = st.propById(old);
  A.ok(p.ok && /the console at \(34, 1\) is REX's/.test(p.plan.summary) && new RegExp('REX leaves its ' + oldDesk.t + ' at \\(' + oldDesk.x + ', ' + oldDesk.y + '\\)').test(p.plan.summary),
    'the plan says REX moves off its old desk, truthfully: ' + (p.ok ? p.plan.summary.slice(0, 220) : p.error));
  A.ok(p.ok && SB.apply(st, p.plan, E).ok, 'and it applies');
  A.eq(desksOf(st, 'rex'), [free], 'after the op REX holds exactly ONE workstation (never double-bound)');
  A.eq(seatOf(st, 'rex'), free, 'so REX walks to the desk the overseer gave it');
  A.ok(st.undo().ok && snap(st) === before, 'ONE undo restores the old seating');
  // the hero's desk is untouched by REX's move
  const nova = desksOf(st, 'agent');
  const q = SB.planEdit(st.serialize(), { refit: [{ op: 'agent', prop: free, agent: 'rex' }] }, E);
  A.ok(q.ok && SB.apply(st, q.plan, E).ok && JSON.stringify(desksOf(st, 'agent')) === JSON.stringify(nova), 'another agent\'s desk never moves');
  // a desk the agent already sits at says so without inventing a move
  const again = SB.planEdit(st.serialize(), { refit: [{ op: 'agent', prop: free, agent: 'rex' }] }, E);
  A.ok(again.ok && !/leaves its desk/.test(again.plan.summary), 'giving REX the desk it already has invents no move: ' + (again.ok ? again.plan.summary.slice(0, 160) : again.error));
}

/* ---- 3. BUILD MODE's WHO SITS HERE chips bind through the same rule (build.js assignDesk, lifted) ---- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
  const body = A.fnBody(build, 'function assignDesk(');
  A.ok(body.length > 30 && body.length < 1500, 'build.js assignDesk located (length guard)');
  const { st, free, old } = station(), before = snap(st);
  const assignDesk = new Function('station', 'WORKSTATION_TYPES', body + '\nreturn assignDesk;')(st, { desk: 1, desk2: 1, console: 1, consoleL: 1, pixelrig: 1, bench: 1 });
  A.ok(assignDesk(free, 'rex').ok, 'the chip assigns');
  A.eq(desksOf(st, 'rex'), [free], 'a chip leaves REX with exactly one workstation');
  A.ok(!st.propById(old).agentId, 'and frees the old one');
  A.ok(st.undo().ok && snap(st) === before, 'one UNDO for the chip too');
  A.ok(/station\.assignDesk\(/.test(body), 'the chip and the overseer share ONE rule (station.assignDesk), never two copies');
}

/* ---- 3b. PLACE ITS DESK (a desk dropped FOR an agent) lands through the same rule (build.js addOwnedDesk, lifted) ---- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
  const body = A.fnBody(build, 'function addOwnedDesk(');
  A.ok(body.length > 30 && body.length < 1500, 'build.js addOwnedDesk located (length guard)');
  A.ok(/const res = owner\s*\? addOwnedDesk\(placement, owner\)\s*: station\.addProp\(placement\);/.test(build), 'the floor click drops an owned desk through addOwnedDesk');
  A.ok(/station\.assignDesk\(/.test(body) && !/assignPropAgent/.test(body), 'PLACE ITS DESK binds through station.assignDesk — no third copy of the unbind loop');
  const { st, old } = station(), before = snap(st);
  let spot = null;
  for (let y = 2; y <= 9 && !spot; y++) for (let x = 26; x <= 39 && !spot; x++) if (st.canPlaceProp('desk', x, y, 2, 1).ok) spot = { x, y };
  A.ok(spot, 'fixture: a free spot for a new desk');
  const addOwnedDesk = new Function('station', body + '\nreturn addOwnedDesk;')(st);
  const res = addOwnedDesk({ t: 'desk', x: spot.x, y: spot.y, w: 2, h: 1, block: true, agentId: 'rex' }, 'rex');
  A.ok(res && res.ok && res.id && st.propById(res.id), 'the desk lands and the caller gets ITS id (landProps / the selection use it)');
  A.eq(desksOf(st, 'rex'), [res.id], 'REX holds exactly one workstation: the desk placed for it');
  A.eq(seatOf(st, 'rex'), res.id, 'so REX walks to the new desk');
  A.ok(!st.propById(old).agentId, 'and its old desk is free again');
  A.ok(st.undo().ok && snap(st) === before, 'ONE undo takes back the desk AND the move');
  const s2 = snap(st), undoable = st.canUndo();
  const blocked = addOwnedDesk({ t: 'desk', x: st.propById(old).x, y: st.propById(old).y, w: 2, h: 1, block: true, agentId: 'rex' }, 'rex');
  A.ok(blocked && !blocked.ok && snap(st) === s2 && st.canUndo() === undoable && st.propById(old).agentId === 'rex', 'a refused drop (on top of a desk) changes nothing — REX keeps its desk');
}

/* ---- 4. the COMMS "has nowhere to sit yet" line retires when the desk LANDS, not only when BUILD MODE closes ----
   app.js's station autosave watcher (the one coalesced hook every floor mutation passes) reconciles the derived prompt
   after the save, whoever placed the desk: a WHO SITS HERE chip, PLACE ITS DESK, or the overseer's station-control op. */
(async () => {
  const vm = require('vm');
  const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
  const start = app.indexOf('  let unsubscribeStationSave = null;'), end = app.indexOf('  /* ---------- connect screen', start);
  A.ok(start > 0 && end > start, 'the production autosave watcher is found in app.js');
  const { st, free } = station();
  const order = [];
  const c = vm.createContext({ console: { warn() {} }, queueMicrotask, localStorage: { getItem: () => null, setItem() {} },
    station: st, agent: { id: 'agent', name: 'NOVA' }, agents: new Map(), liveAgents: () => [], Harness: { totals: () => ({}) },
    Workstreams: { serialize: () => ({ workstreams: [] }) }, rosterPushFailed: false, CloudSave: { revision: () => 0, push: () => order.push('save') },
    StationUI: { flashSave() {}, notify() {} },
    // the real retireDeskPrompt asks the LIVE floor (App.needsWorkstation); here it records when it is asked
    Chat: { retireDeskPrompt: () => { order.push('retire:' + (desksOf(st, 'rex').length === 1 && seatOf(st, 'rex') === free)); return true; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'save.js'), 'utf8'), c);
  vm.runInContext(app.slice(start, end), c);
  vm.runInContext('watchStationSave()', c);
  A.ok(st.assignDesk(free, 'rex').ok, 'a desk lands for REX');
  await new Promise(r => queueMicrotask(r));
  A.eq(order, ['save', 'retire:true'], 'the floor change is saved, THEN the open "nowhere to sit" prompt is reconciled against the new floor');
  order.length = 0;
  A.ok(st.assignPropAgent(free, '').ok && st.assignPropAgent(free, 'rex').ok, 'a burst of two edits in one gesture');
  await new Promise(r => queueMicrotask(r));
  A.eq(order.filter(x => /^retire/.test(x)).length, 1, 'a burst reconciles once, like it saves once');
  A.report('desk-one-per-agent.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
