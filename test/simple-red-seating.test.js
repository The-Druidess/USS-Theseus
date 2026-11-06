'use strict';
const fs = require('fs'), path = require('path');
const { createHash } = require('node:crypto');
const A = require('./_assert'), WM = require('../frontend/app/worldmodel');
const replaced = ['chair', 'stool', 'dinerchair', 'podchair', 'red_cushion_chair', 'red_captains_chair', 'simple_red_cushion_chair'];
const retained = ['couch', 'booth', 'industrial_bench', 'recliner', 'recliner_r', 'console', 'bench'];
const doc = WM.defaultDoc(1);
doc.props = [...replaced, ...retained].map((t, index) => ({
  id: 'p' + (index + 2), t, x: index, y: 4, w: 1, h: 1, r: index % 4, m: 1
}));
doc.meta.commander = { propId: 'p2', skin: 'blank' };
const before = JSON.stringify(doc);
const loaded = WM.deserialize(doc);
const saved = loaded.serialize();
A.eq(JSON.stringify(doc), before, 'deserialization does not mutate the source save');
saved.props.forEach((p, index) => {
  A.eq(p.t, index < replaced.length ? WM.CHAIR_TYPE : retained[index - replaced.length], 'only individual seats are replaced: ' + doc.props[index].t);
  A.eq([p.id, p.x, p.y, p.w, p.h, p.r || 0, p.m], [doc.props[index].id, index, 4, 1, 1, index % 4, 1], 'placement and orientation are unchanged');
});
A.eq(saved.meta.commander, doc.meta.commander, 'Commander binding retained');
A.ok(loaded.setCommanderSeat(saved.meta.commander).ok, 'Commander can still use the migrated chair');
A.eq(WM.deserialize(saved).serialize(), saved, 'migration is idempotent');
for (const t of replaced) {
  const station = WM.create();
  const result = station.addProp({ t, x: 4, y: 4, w: 1, h: 1, r: 3, m: 1 });
  A.ok(result.ok, t + ' placement succeeds');
  const prop = station.props()[0];
  A.eq(prop.t, WM.CHAIR_TYPE, t + ' new placements use the simple red chair');
  A.eq([prop.r, prop.m], [3, 1], 'new placement keeps orientation');
  station.undo();
  A.eq(station.props(), [], 'undo removes the chair');
  station.redo();
  A.eq(station.props()[0].t, WM.CHAIR_TYPE, 'redo retains standardized chair');
}
const world = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const drawChair = A.fnBody(world, 'function drawSeatChair(');
const draws = [];
const wrapped = Function('PropSprites', 'F_chair', 'drawLitProp', `let ctx={}, now=0; ${drawChair}; return drawSeatChair;`)(
  { has: id => id === WM.CHAIR_TYPE, setCtx() {}, setNow() {} },
  () => { throw new Error('legacy chair should not render'); },
  prop => draws.push(prop)
);
for (const [face, rotation] of [['south', 0], ['west', 1], ['north', 2], ['east', 3]]) {
  wrapped(3, 4, 3.5, 4, face);
  const prop = draws.at(-1);
  A.eq([prop.t, prop.x, prop.y, prop.r], [WM.CHAIR_TYPE, 3.5, 4, rotation], 'workstation chair preserves ' + face + ' facing and centered seat anchor');
}
const sprites = fs.readFileSync(path.join(__dirname, '../frontend/app/propsprites.js'), 'utf8');
const clips = [], overlays = [];
const front = Function('surfaceLift', 'RAMP', 'TILE', 'ctx', 'draw',
  A.fnBody(sprites, 'function drawSeatFront(') + '; return drawSeatFront;')(
  () => 0, { steel: {} }, 12,
  { save() {}, restore() {}, beginPath() {}, rect: (...args) => clips.push(args), clip() {} },
  prop => overlays.push(prop)
);
for (let r = 0; r < 4; r++) {
  const prop = { t: WM.CHAIR_TYPE, x: 4, y: 5, w: 1, h: 1, r, m: 1 };
  front(prop);
  A.eq(clips.at(-1), [48, 66, 12, 3], 'seat foreground is clipped to the near rim');
  A.eq(overlays.at(-1), prop, 'seat foreground reuses the same artwork, facing, and mirror');
}
for (const set of ['approved-sheet', 'projection-correction']) {
  const manifest = require('../frontend/assets/industrial/' + set + '/manifest.json');
  const geometry = require('../frontend/assets/industrial/projection-correction/runtime-geometry.json');
  const remaster = require('../frontend/app/propremaster');
  const expectedHashes = {
    s: '683d2197cf7c38a2f7dd49fea75fb99b959244b63b6c1799d643d3f9c9edba86',
    w: '386682241ce785be71e4bba03f3d6b9b8fd060dc178a547bca382a8bc5be31cf',
    n: '115d7606cf6cdb64d2684a3dafcd21b2bc840dbef8f9187ed8d3c4eb387b7e17',
    e: '621884f98de1980c2e27dd5b3fdef54db5774f7b7e5867a4633c90ea202017cf'
  };
  for (const facing of ['s', 'w', 'n', 'e']) {
    const view = manifest.props[WM.CHAIR_TYPE].views[facing];
    A.eq(view.footprint, { w: 1, h: 1 }, set + ' chair has matching ' + facing + ' footprint');
    const png = fs.readFileSync(path.join(__dirname, '../frontend/assets/industrial', set, view.image));
    const measured = geometry.views[WM.CHAIR_TYPE + ':' + facing];
    A.eq(createHash('sha256').update(png).digest('hex'), expectedHashes[facing], set + ' uses the exact replacement ' + facing + ' view');
    A.eq([png.readUInt32BE(16), png.readUInt32BE(20), view.sourceWidth, view.sourceHeight], [96, 96, 96, 96], 'replacement dimensions match the manifest');
    A.eq([measured.image, measured.sha256], [view.image, expectedHashes[facing]], 'measured geometry matches the replacement view');
    const fitted = remaster.fit(view.bounds, measured.crop, view.contact, view.sourceHeight);
    A.ok(Math.abs(fitted.y + fitted.height - 12) < 1e-9, facing + ' visible chair base lands exactly on the floor line');
    A.ok(png.equals(fs.readFileSync(path.join(__dirname, '../website/app/assets/industrial', set, view.image))), 'website ships the same directional asset');
  }
}
A.report('simple-red-seating');
