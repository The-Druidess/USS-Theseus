'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fnBody } = require('./_assert');
const WM = require('../frontend/app/worldmodel');
const PropAnchor = require('../frontend/app/propanchor');

const station = WM.create();
const add = opts => {
  const result = station.addProp(opts);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.id;
};
const terminal = add({ t: 'console', x: 4, y: 3, w: 2, h: 1 });
const chair = add({ t: 'chair', x: 5, y: 4, w: 1, h: 1 });
const officerTerminal = add({ t: 'console', x: 7, y: 3, w: 2, h: 1 });
const officerChair = add({ t: 'chair', x: 8, y: 4, w: 1, h: 1 });
assert.equal(station.assignDesk(officerTerminal, 'chief').ok, true);
assert.equal(station.assignPropAgent(officerChair, 'chief').ok, true);
assert.equal(station.setCommanderSeat({ propId: chair, skin: 'blank', standInAgentId: 'agent', consolePropId: officerTerminal }).ok, false,
  'an occupied console cannot become the captain interface');
assert.equal(station.setCommanderSeat({ propId: chair, skin: 'blank', standInAgentId: 'agent', consolePropId: 'missing' }).ok, false,
  'a missing console cannot become the captain interface');
const config = { propId: chair, skin: 'blank', standInAgentId: 'agent', consolePropId: terminal };
assert.equal(station.setCommanderSeat(config).ok, true);
assert.deepEqual(WM.create(station.serialize()).doc().meta.commander, config, 'captain assignment survives reload');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const source = name => fnBody(src, 'function ' + name + '(');
assert.ok(!source('stepCrewToSeat').includes('function stepAssignedSeat('),
  'the shared assigned-seat step is available to both the crew and captain engines');
const make = Function('station', 'PropAnchor', `
  let geo = station.projectGeometry(), commander = null, activity = 'idle', awaitPrompt = false;
  const T = 12, blocked = new Set(), occupiedSeats = new Set(), SEAT_LIFT = { simple_red_cushion_chair: 2 };
  const agent = { id: 'agent', agentId: 'agent', px: 0, py: 0, working: false };
  let presence = 'ONLINE', unattended = true, loaded = true;
  const StationUI = { qPresence: () => presence };
  const AutonomyStore = { status: () => ({ loaded }), summary: () => ({ actsUnattended: unattended }) };
  const DATA = { SKINS: { blank: {} } };
  const makeCrewBody = (id, name, color, px, py, skin) => ({ id, name, px, py, skin });
  const bodyForAgent = id => id === agent.id ? agent : null;
  const isWorkstationProp = t => station.capForProp(t) === 'computer';
  function seizeFromIdle(b) {
    if (b.seatKey) occupiedSeats.delete(b.seatKey);
    b.seatKey = null; b.seated = false; b.usingProp = null; b.goal = null;
  }
  function stepCrewToSeat(b, s) {
    const foot = seatFoot(s); b.px = foot.x; b.py = foot.y;
    b.sitting = true; b.target = null; b.state = 'idle';
  }
  ${source('seatFoot')}
  ${source('chairApproach')}
  ${source('stepAssignedSeat')}
  ${source('captainSeatMode')}
  let captainPost = { mode: null, key: null, agentId: null };
  ${source('clearCaptainPost')}
  ${source('syncCommander')}
  ${source('updateCaptainPost')}
  ${source('stepCaptainPost')}
  return {
    update: updateCaptainPost,
    step: () => stepCaptainPost(agent, 1, 0),
    setPresence: value => { presence = value; },
    setUnattended: value => { unattended = value; },
    setLoaded: value => { loaded = value; },
    setAwaiting: value => { awaitPrompt = value; },
    setActivity: value => { activity = value; },
    agent, occupiedSeats,
    commander: () => commander,
    mode: () => captainPost.mode,
    chairApproach, stepAssignedSeat,
    refreshGeometry: () => { geo = station.projectGeometry(); }
  };
`)(station, PropAnchor);

make.update();
assert.ok(make.commander() && make.commander().seated, 'Q occupies the captain chair when online');
make.setPresence('AWAY');
make.update();
assert.equal(make.commander(), null, 'Q leaves when away');
assert.equal(make.step(), true);
assert.equal(make.agent.seated, true, 'the stand-in reaches and uses the actual chair');
assert.equal(make.agent.usingProp, chair);
assert.equal(make.agent.working, false, 'sitting alone does not claim an active task');
make.setActivity('task');
make.step();
assert.equal(make.agent.working, true, 'an actual task remains visible');
make.agent.goal = 'awaitwalk';
make.agent.target = { x: 1, y: 2 };
make.setAwaiting(true);
assert.equal(make.step(), false, 'approval waits take precedence over the post');
assert.equal(make.agent.seated, false);
assert.equal(make.agent.goal, 'awaitwalk', 'the approval walk is not interrupted');
assert.deepEqual(make.agent.target, { x: 1, y: 2 });
assert.ok(make.occupiedSeats.has(chair + ':0'), 'the captain chair remains reserved while waiting');
make.setAwaiting(false);
make.step();
make.agent.goal = 'awaitwalk';
make.agent.target = { x: 3, y: 4 };
make.setAwaiting(true);
make.setPresence('BUSY');
make.update();
assert.equal(make.agent.seated, false, 'the stand-in vacates before Q returns');
assert.ok(make.commander() && make.commander().seated);
assert.ok(make.occupiedSeats.has(chair + ':0'));
assert.equal(make.agent.goal, 'awaitwalk', 'Q returning does not cancel an in-flight approval walk');
assert.deepEqual(make.agent.target, { x: 3, y: 4 });
make.setAwaiting(false);
make.setPresence('AWAY');
make.setUnattended(false);
make.update();
assert.equal(make.mode(), 'empty', 'disabled autonomy leaves the chair empty');
assert.equal(make.step(), false);
assert.equal(make.commander(), null);
make.setUnattended(true);
make.setLoaded(false);
make.update();
assert.equal(make.mode(), 'empty', 'unconfirmed autonomy cannot place the stand-in');
make.setLoaded(true);
make.setPresence('OFFLINE');
make.update();
assert.equal(make.mode(), 'agent', 'offline Q is absent when unattended autonomy is confirmed');

const g = station.projectGeometry();
const realChair = g.props.find(p => p.id === officerChair);
const realSeat = make.chairApproach(realChair);
assert.ok(realSeat);
const deskSeat = Function('geo', 'station', 'PropAnchor', 'blocked', `
  ${source('chairApproach')}
  ${source('deskSeat')}
  return deskSeat;
`)(g, station, PropAnchor, new Set());
assert.equal(deskSeat(g.props.find(p => p.id === officerTerminal)).chair.id, officerChair,
  'an assigned workstation resolves the officer’s actual adjacent chair');
const officer = { id: 'chief', agentId: 'chief', px: 0, py: 0 };
make.stepAssignedSeat(officer, realSeat, 1, 0, false);
assert.equal(officer.usingProp, officerChair);
assert.equal(officer.seatPx, (realChair.x + 0.5) * 12);
assert.equal(officer.seatPy, (realChair.y + 1) * 12 - 1);
const rival = { id: 'other', px: 0, py: 0 };
make.stepAssignedSeat(rival, realSeat, 1, 0, false);
assert.notEqual(rival.seated, true, 'a claimed chair cannot be occupied twice');
make.step();
assert.equal(station.removeProp(terminal).ok, true);
make.refreshGeometry();
assert.equal(make.step(), false, 'removing the captain interface releases the stand-in');
assert.equal(make.agent.seated, false);
assert.ok(make.occupiedSeats.has(chair + ':0'), 'a missing console does not free the captain chair to other crew');
console.log('bridge-workstations: OK');
