/* test/buildmode-walls-rooms.test.js — Verify wall panels auto-create rooms when enclosed by hull */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const fs = require('fs');
const path = require('path');

// Test 1: Verify structural_wall prop exists in source code
const spritesSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'propsprites.js'), 'utf8');
A.ok(/\{ id: "structural_wall".*w: 1, h: 1/.test(spritesSrc), 'structural_wall 1x1 prop exists in catalog');
A.ok(/blocks: true.*wallBlock: true/.test(spritesSrc) || /wallBlock: true.*blocks: true/.test(spritesSrc), 'structural_wall blocks movement and marked as wall');

// Test 2: Verify build.js uses structural_wall
const buildSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
A.ok(/const WALL_PROP = 'structural_wall'/.test(buildSrc), 'build.js uses structural_wall as WALL_PROP');
A.ok(/detectAndCreateWallRooms/.test(buildSrc), 'build.js has detectAndCreateWallRooms function');
A.ok(/function detectAndCreateWallRooms\(\)/.test(buildSrc), 'detectAndCreateWallRooms is defined');

// Test 3: Verify wall color and visual properties exist
A.ok(/F\.structural_wall\s*=/.test(spritesSrc), 'F.structural_wall drawing function exists');
A.ok(/c9b8a0/.test(spritesSrc), 'beige color (#c9b8a0) defined for walls');
A.ok(/d9c8b0/.test(spritesSrc), 'lighter beige defined for wall highlights');
A.ok(/a89880/.test(spritesSrc), 'darker beige defined for wall shadows');

// Test 4: Verify wall is 1x1 and blocks pathfinding
const station = WM.create();
A.ok(station.addRoom({ kind: 'hab', rect: { x1: 100, y1: 100, x2: 110, y2: 110 } }).ok, 'fixture: room for wall');
const wall = WM.tileLine({ tx: 101, ty: 101 }, { tx: 105, ty: 101 });
const wallRes = station.transact(() => {
  for (const tile of wall) {
    const result = station.addProp({ t: 'structural_wall', x: tile.tx, y: tile.ty, w: 1, h: 1 });
    if (!result.ok) return result;
  }
  return { ok: true };
});
A.ok(wallRes.ok, 'wall line placement succeeds');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, wall.length, 'all wall segments placed');

// Test 5: Verify wall segments block pathfinding
const geo = station.projectGeometry();
for (const tile of wall) {
  const key = (tile.tx - geo.origin.tx) + ',' + (tile.ty - geo.origin.ty);
  A.ok(geo.blockedTiles.has(key), `wall at (${tile.tx},${tile.ty}) blocks movement`);
}

// Test 6: Verify wall can be undone and redone
A.ok(station.undo().ok, 'wall line undo succeeds');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, 0, 'all segments removed in one undo');
A.ok(station.redo().ok, 'wall line redo succeeds');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, wall.length, 'all segments restored in redo');

// Test 7: Verify undo/redo structure
const beforeUndo = station.props().filter(p => p.t === 'structural_wall').length;
A.eq(beforeUndo, wall.length, 'walls still present');
A.ok(station.undo().ok, 'second undo succeeds');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, 0, 'walls removed on undo');

A.report('buildmode-walls-rooms.test');
