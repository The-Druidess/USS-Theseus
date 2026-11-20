/* test/buildmode-walls.test.js — Walls draws a blocking one-tile line in one undoable edit. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');

const horizontal = WM.tileLine({ tx: 2, ty: 4 }, { tx: 6, ty: 4 });
A.eq(horizontal, [2, 3, 4, 5, 6].map(tx => ({ tx, ty: 4 })), 'horizontal wall includes both endpoints');
const diagonal = WM.tileLine({ tx: 0, ty: 0 }, { tx: 4, ty: 2 });
A.eq(diagonal.length, 5, 'diagonal wall is one tile thick');
A.eq(diagonal[0], { tx: 0, ty: 0 }, 'diagonal starts at its first point');
A.eq(diagonal[diagonal.length - 1], { tx: 4, ty: 2 }, 'diagonal ends at its last point');
for (let i = 1; i < diagonal.length; i++) {
  A.ok(Math.max(Math.abs(diagonal[i].tx - diagonal[i - 1].tx), Math.abs(diagonal[i].ty - diagonal[i - 1].ty)) === 1,
    'diagonal wall stays contiguous without duplicate tiles');
}

const station = WM.create();
A.ok(station.addRoom({ kind: 'hab', rect: { x1: 100, y1: 100, x2: 110, y2: 110 } }).ok, 'fixture: room for wall');
const before = station.props().length;
const wall = WM.tileLine({ tx: 101, ty: 101 }, { tx: 105, ty: 103 });
const placed = station.transact(() => {
  for (const tile of wall) {
    const result = station.addProp({ t: 'structural_wall', x: tile.tx, y: tile.ty, w: 1, h: 1 });
    if (!result.ok) return result;
  }
  return { ok: true, count: wall.length };
});
A.ok(placed.ok && placed.count === wall.length, 'wall segments place atomically');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, wall.length, 'each line tile is a blocking structural wall prop');
const geo = station.projectGeometry();
for (const tile of wall) {
  const key = (tile.tx - geo.origin.tx) + ',' + (tile.ty - geo.origin.ty);
  A.ok(geo.blockedTiles.has(key), 'wall segment blocks avatar walkability at ' + key);
}
A.ok(station.undo().ok, 'a wall line has one undo step');
A.eq(station.props().length, before, 'one undo removes the whole line');
A.ok(station.redo().ok, 'wall line can be redone');
A.eq(station.props().filter(p => p.t === 'structural_wall').length, wall.length, 'redo restores all segments');

const obstructed = WM.create();
A.ok(obstructed.addRoom({ kind: 'hab', rect: { x1: 200, y1: 200, x2: 210, y2: 210 } }).ok, 'fixture: room for collision check');
A.ok(obstructed.addProp({ t: 'industrial_locker', x: 203, y: 203, w: 1, h: 1 }).ok, 'fixture: obstacle on the line');
const blockedLine = WM.tileLine({ tx: 201, ty: 203 }, { tx: 205, ty: 203 });
A.ok(blockedLine.some(tile => !obstructed.canPlaceProp('structural_wall', tile.tx, tile.ty, 1, 1).ok),
  'an occupied tile blocks a wall line');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
A.ok(!!new vm.Script(source, { filename: 'build.js' }), 'Build Mode script parses');
A.ok(/\['rooms', 'Rooms', \['room','hall','wall'\]\]/.test(source), 'Rooms group contains room, hall, and wall');
A.ok((source.match(/\['wall',\s*'([^']+)'\]/) || [null, ''])[1].split(',').every(row => row.length === 12),
  'Walls toolbar icon is a 12-pixel grid');
A.ok(/WorldModel\.tileLine\(d\.start, d\.cur\)/.test(source), 'Walls uses WorldModel.tileLine along its start/end line');
A.ok(/function commitWall\(d, ev\)[\s\S]*?station\.transact\(\(\) => \{[\s\S]*?station\.addProp\(\{ t: 'structural_wall', x: tile\.tx, y: tile\.ty, w: 1, h: 1 \}\)/.test(source),
  'one drawn wall is placed in one transaction');
A.ok(/deselectTool\(\{ silent: true \}\);/.test(source),
  'one wall placement deselects the tool');
A.ok(/if \(tool === 'wall'\) \{\s*drag = \{ mode: 'wall', start: w, cur: w, moved: false \};/.test(source), 'Walls starts a drag at its first tile');
A.ok(/if \(drag\.mode === 'wall'\)[\s\S]*?const wallLine = WorldModel\.tileLine\(drag\.start, drag\.cur\)/.test(source), 'wall drag preview uses WorldModel.tileLine');

A.report('buildmode-walls.test');
