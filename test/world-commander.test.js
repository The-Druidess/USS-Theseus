'use strict';
const fs = require('fs'), path = require('path'), A = require('./_assert');
const WM = require('../frontend/app/worldmodel');
const PA = require('../frontend/app/propanchor');
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'world.js'), 'utf8');
const st = WM.create();
const chair = st.addProp({ t: 'chair', x: 4, y: 4, w: 1, h: 1 });
A.ok(chair.ok, 'fixture chair placed');
A.ok(!st.setCommanderSeat({ propId: 'missing', skin: 'blank' }).ok, 'missing seat refused');
A.ok(!st.setCommanderSeat({ propId: chair.id, skin: '' }).ok, 'empty skin refused');
A.ok(st.setCommanderSeat({ propId: chair.id, skin: 'blank' }).ok, 'Commander binding admitted');
const saved = st.serialize();
A.eq(saved.meta.commander, { propId: chair.id, skin: 'blank' }, 'binding survives serialization');
const seats = new Set(), warnings = [];
const runtime = Function('station', 'DATA', 'PropAnchor', 'occupiedSeats', 'console', `
let commander = null, geo;
const T = 12, SEAT_LIFT = { simple_red_cushion_chair: 2 };
const makeCrewBody = (id, name, color, px, py, skin) => ({ id, name, color, px, py, skin, working: false });
${A.fnBody(src, 'function syncCommander(')}
return g => { geo = g; syncCommander(); return commander; };
`)(st, { SKINS: { blank: {}, robot: {} } }, PA, seats, { warn: (...args) => warnings.push(args) });
const geo = () => st.projectGeometry();
let b = runtime(geo());
A.eq([b.name, b.agentId, b.seated, b.sitting, b.working], ['COMMANDER', null, true, true, false], 'human is seated, never an AI worker');
A.eq(b.seatType, 'simple_red_cushion_chair', 'Commander uses the standardized chair');
A.eq([b.seatPx, b.seatPy, b.seatLift], [(geo().props.find(p => p.id === chair.id).x + 0.5) * 12, (geo().props.find(p => p.id === chair.id).y + 1) * 12 - 1, 2], 'uses real chair anchor and seat lift');
A.ok(seats.has(chair.id + ':0'), 'seat reserved against idle AI occupancy');
A.ok(st.moveProp(chair.id, 2, 0).ok, 'chair moves');
const oldX = b.seatPx;
b = runtime(geo());
A.eq(b.seatPx - oldX, 24, 'Commander follows chair without origin drift');
A.ok(st.rotateProp(chair.id, 1).ok, 'chair rotates');
A.eq(runtime(geo()).dir, 'west', 'Commander follows chair facing');
A.ok(st.setCommanderSeat({ propId: chair.id, skin: 'robot' }).ok, 'replacement skin accepted');
A.eq(runtime(geo()).skin, 'robot', 'skin change reaches body');
st.setCommanderSeat({ propId: chair.id, skin: 'not-a-skin' });
A.eq(runtime(geo()), null, 'unknown catalog skin cannot render');
A.eq(warnings.length, 1, 'unknown skin reported explicitly');
st.setCommanderSeat({ propId: chair.id, skin: 'blank' });
runtime(geo());
st.removeProp(chair.id);
A.eq(runtime(geo()), null, 'deleted chair hides Commander');
A.eq(seats.size, 0, 'deleted chair releases reservation');
st.undo();
A.ok(runtime(geo()), 'undo restores seated Commander');
st.setCommanderSeat(null);
A.eq(runtime(geo()), null, 'explicit removal clears figure');
A.eq(seats.size, 0, 'explicit removal releases seat');
const restored = WM.create(saved);
A.eq(restored.serialize().meta.commander, saved.meta.commander, 'reload retains binding');
A.ok(!A.fnBody(src, 'function syncCommander(').includes('crew.push'), 'Commander excluded from AI crew engine');
A.ok(src.includes('if (crewInScene && commander) items.push(bodyItem(commander, commander.seatPy))'), 'human uses normal depth-sorted body rendering');
const images = [], draws = [];
const q = { skin: 'q_judge', seated: true, sitting: true, dir: 'south', seatPx: 40, seatPy: 50 };
const throne = Function('commander', 'Image', 'console', 'ctx', `
const commanderThroneImages = new Map();
${A.fnBody(src, 'function commanderThroneImage(')}
${A.fnBody(src, 'function drawCommanderThrone(')}
return { image: commanderThroneImage, draw: drawCommanderThrone };
`)(q, function () { images.push(this); }, { warn: (...args) => warnings.push(args) },
  { save() {}, restore() {}, drawImage: (...args) => draws.push(args) });
A.eq(throne.image({ ...q }), null, 'throne excluded from other Q bodies');
A.eq(throne.image(q), null, 'unloaded throne retains normal renderer');
A.eq(images.length, 1, 'one image requested');
images[0].complete = true; images[0].naturalWidth = images[0].naturalHeight = 176;
A.eq(throne.image(q), images[0], 'ready approved image used');
throne.draw(q);
A.eq(q._pose, 'approved_q_throne.sit.south', 'live pose records exclusive throne');
A.eq(draws[0].slice(1), [40 - 88 / 6, 50 - 137 / 6, 176 / 6, 176 / 6], 'approved scale and platform floor anchor');
q.skin = 'blank';
A.eq(throne.image(q), null, 'changing skin restores native chair and body');
q.skin = 'q_judge'; q.sitting = false;
A.eq(throne.image(q), null, 'standing Q never draws a throne');
q.sitting = true;
for (const direction of ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']) {
  q.dir = direction;
  throne.image(q);
  const image = images.at(-1);
  image.complete = true; image.naturalWidth = image.naturalHeight = 176;
  A.ok(throne.image(q).src.endsWith('seated-' + direction + '.png'), 'matched throne rotation ' + direction);
  const relative = path.join('assets', 'sprites', 'approved_q_throne', 'seated-' + direction + '.png');
  const png = fs.readFileSync(path.join(__dirname, '..', 'frontend', relative));
  A.eq([png.readUInt32BE(16), png.readUInt32BE(20)], [176, 176], 'approved canvas ' + direction);
  A.ok(png.equals(fs.readFileSync(path.join(__dirname, '..', 'website', 'app', relative))), 'website throne parity ' + direction);
}
for (const seatType of ['chair', 'simple_red_cushion_chair', 'red_captains_chair']) {
  A.ok(throne.image(Object.assign(q, { seatType })), 'Q always uses his specific throne regardless of the underlying seat type');
}
A.ok(src.includes('commander.usingProp === p.id && commanderThroneImage(commander)) continue'), 'native base and foreground skipped only for ready Q throne');
A.ok(src.includes(': commanderThroneImage(b) ? { y: fallbackY, draw: () => drawCommanderThrone(b) }'), 'exclusive composite shares body depth ordering');
for (const file of ['data-shim.js', 'propsprites.js']) {
  A.ok(!fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', file), 'utf8').includes('approved_q_throne'), 'throne absent from catalog surface ' + file);
}
A.report('world-commander');
