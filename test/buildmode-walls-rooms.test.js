/* Wall enclosures create editable rooms without replacing existing room identities. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');

const station = WM.create();
const parent = station.addRoom({ kind: 'hab', name: 'Existing', rect: { x1: 100, y1: 100, x2: 114, y2: 114 } }).id;
const scope = [parent];
const line = (x1, y1, x2, y2) => WM.tileLine({ tx: x1, ty: y1 }, { tx: x2, ty: y2 });
const place = (x1, y1, x2, y2) => station.placeWalls(line(x1, y1, x2, y2), scope);
A.ok(station.paintTiles(parent, [[104, 104], [100, 100]], 'cobalt').ok, 'fixture: paint inside and outside');
const prop = station.addProp({ t: 'plant', x: 104, y: 104, w: 1, h: 1 }).id;

A.ok(place(102, 102, 108, 102).ok, 'first wall is placed');
A.ok(place(108, 102, 108, 108).ok, 'second wall reuses the corner');
A.ok(place(108, 108, 102, 108).ok, 'third wall reuses the corner');
A.eq(station.roomAt(104, 104), parent, 'an open enclosure does not create a room');
const closed = place(102, 108, 102, 102);
A.ok(closed.ok && closed.rooms.length === 1, 'closing the shared corners creates a room');
const room = closed.rooms[0];
A.eq(station.roomAt(104, 104), room, 'enclosed floor belongs to the new room');
A.eq(station.roomAt(100, 100), parent, 'existing room keeps its identity');
A.eq(station.propById(prop).id, prop, 'furniture remains in place');
A.eq(station.roomById(room).floorPaint['104,104'], 'cobalt', 'enclosed paint remains on its tile');
A.eq(station.roomById(parent).floorPaint['100,100'], 'cobalt', 'original room retains its paint');
scope.push(room);
A.ok(place(108, 102, 113, 102).ok, 'another room starts on the shared wall');
A.ok(place(113, 102, 113, 108).ok, 'another room extends the shared wall');
const adjacent = place(113, 108, 108, 108);
A.ok(adjacent.ok && adjacent.rooms.length === 1, 'a neighboring enclosure shares the existing wall');
A.ok(station.roomAt(110, 105) !== room, 'shared-wall rooms are distinct');
A.eq(station.props().filter(p => p.t === 'structural_wall' && p.x === 108 && p.y === 105).length, 1, 'shared wall is one panel');
scope.push(adjacent.rooms[0]);
const oldRect = { ...station.roomById(room).rects[0] };
const grown = { ...oldRect, x2: oldRect.x2 + 1 };
const sharedPanel = station.propAt(108, 105);
const resize = station.resizeSharedRoom(room, grown, scope);
A.ok(resize.ok && resize.handled, 'resizing moves the shared wall');
A.eq(station.roomAt(108, 105), room, 'the enlarged room gains the former boundary tile');
A.eq(station.roomAt(110, 105), adjacent.rooms[0], 'neighbor keeps its identity');
A.eq(station.propById(sharedPanel).x, 109, 'shared wall panel moves with the boundary');
A.ok(station.undo().ok, 'shared resize can be undone');
A.eq(station.propById(sharedPanel).x, 108, 'undo restores the shared wall');
const obstructedResize = WM.deserialize(station.serialize());
obstructedResize.addProp({ t: 'plant', x: 109, y: 105, w: 1, h: 1 });
const beforeResize = JSON.stringify(obstructedResize.serialize());
A.ok(!obstructedResize.resizeSharedRoom(room, grown, scope).ok, 'objects block moving a shared wall');
A.eq(JSON.stringify(obstructedResize.serialize()), beforeResize, 'a refused shared resize changes nothing');
A.ok(station.redo().ok, 'shared resize can be redone');
A.ok(station.resizeSharedRoom(room, oldRect, scope).ok, 'shared room can shrink again');
A.eq(station.propById(sharedPanel).x, 108, 'shrinking moves the shared wall back');
A.eq(station.roomAt(109, 105), adjacent.rooms[0], 'shrinking returns floor to the neighboring room');
A.eq(station.rooms().reduce((sum, r) => sum + r.rects.reduce((n, r) => n + (r.x2-r.x1+1)*(r.y2-r.y1+1), 0), 0),
  WM.deserialize(JSON.parse(beforeResize)).rooms().reduce((sum, r) => sum + r.rects.reduce((n, r) => n + (r.x2-r.x1+1)*(r.y2-r.y1+1), 0), 0),
  'resizing preserves total deck area');
A.ok(station.renameRoom(room, 'New room').ok, 'new room can be renamed');
A.ok(station.setRoomKind(room, 'lab').ok, 'new room can be changed with room controls');
const wall = station.propAt(102, 105);
A.ok(station.removeProp(wall).ok, 'a wall can be deleted to make an opening');
A.eq(station.roomAt(104, 104), room, 'deleting a wall keeps rooms separate');
const openSide = WM.deserialize(station.serialize());
for (let y = 103; y <= 107; y++) {
  const id = openSide.propAt(102, y);
  if (id) A.ok(openSide.removeProp(id).ok, 'remaining boundary panel can be removed');
}
const roomBeforeOpenResize = openSide.roomById(room).rects[0];
const openResize = openSide.resizeSharedRoom(room, { ...roomBeforeOpenResize, x1: roomBeforeOpenResize.x1 + 1 }, scope);
A.ok(openResize.ok && openResize.handled, 'an open room boundary still adjusts the neighboring room');
A.ok(!!openSide.roomAt(103, 105), 'resizing an open boundary does not remove hull floor');
const restored = WM.deserialize(station.serialize());
A.eq(restored.roomAt(104, 104), room, 'room survives serialization');
A.eq(restored.roomById(room).name, 'New room', 'room edits survive serialization');
A.ok(!restored.propById(wall), 'deleted wall stays deleted');

const split = WM.create();
const original = split.addRoom({ kind: 'hab', name: 'Deck', rect: { x1: 100, y1: 100, x2: 110, y2: 110 } }).id;
const result = split.placeWalls(line(105, 100, 105, 110), [original]);
A.ok(result.ok && result.rooms.length === 1, 'a wall joining hull edges divides a room');
const newId = result.rooms[0];
A.ok(split.roomAt(102, 105) !== split.roomAt(108, 105), 'both sides are separately selectable');
A.ok(split.undo().ok, 'wall and room creation undo together');
A.eq(split.roomAt(102, 105), original, 'undo restores original floor');
A.ok(!split.roomById(newId), 'undo removes the generated room');
A.ok(split.redo().ok, 'wall and room creation redo together');
A.ok(!!split.roomById(newId), 'redo restores the generated room');

const blocked = WM.create();
const blockedRoom = blocked.addRoom({ kind: 'hab', rect: { x1: 100, y1: 100, x2: 110, y2: 110 } }).id;
blocked.addProp({ t: 'plant', x: 105, y: 105, w: 1, h: 1 });
const before = JSON.stringify(blocked.serialize());
A.ok(!blocked.placeWalls(line(105, 100, 105, 110), [blockedRoom]).ok, 'a wall cannot overwrite furniture');
A.eq(JSON.stringify(blocked.serialize()), before, 'failed wall placement leaves the layout unchanged');
A.ok(!blocked.placeWalls(line(105, 100, 105, 110), []).ok, 'walls cannot be placed outside the active hull');

const drawn = WM.create();
const deck = drawn.addRoom({ kind: 'hab', name: 'Deck', rect: { x1: 100, y1: 100, x2: 114, y2: 114 } }).id;
const drawnScope = [deck];
const wallIds = [];
for (let y = 102; y <= 108; y++) wallIds.push(drawn.addProp({ t: 'structural_wall', x: 105, y, w: 1, h: 1 }).id);
for (const y of [102, 108]) drawn.addProp({ t: 'structural_wall', x: 104, y, w: 1, h: 1 });
const furniture = drawn.addProp({ t: 'plant', x: 103, y: 105, w: 1, h: 1 }).id;
const rect = { x1: 101, y1: 102, x2: 105, y2: 108 };
A.ok(drawn.canDrawRoomOnDeck(rect, 'hab', drawnScope).ok, 'drawing on existing deck accepts a shared wall');
const drawResult = drawn.drawRoomOnDeck({ rect, kind: 'hab' }, drawnScope);
A.ok(drawResult.ok && drawResult.id !== deck, 'drawing on deck creates a separate room');
const drawnRoom = drawResult.id;
drawnScope.push(drawnRoom);
A.eq(drawn.roomAt(103, 105), drawnRoom, 'drawn floor belongs to the new room');
A.eq(drawn.roomAt(106, 105), deck, 'surrounding room retains its identity');
A.ok(wallIds.every(id => drawn.propById(id)), 'existing shared wall panels are preserved');
A.ok(!!drawn.propById(furniture), 'existing furniture remains in place');
const panel = drawn.propAt(105, 105);
const growDrawn = drawn.resizeSharedRoom(drawnRoom, { ...rect, x2: 106 }, drawnScope);
A.ok(growDrawn.ok && growDrawn.handled, 'a room drawn over a wall can resize its shared boundary');
A.eq(drawn.propById(panel).x, 106, 'the boundary panel moves with the room');
A.ok(!!drawn.propAt(105, 102) && !!drawn.propAt(106, 102), 'resizing keeps the connecting wall joined');
A.ok(drawn.undo().ok && drawn.propById(panel).x === 105, 'undo restores a drawn room resize');
A.ok(drawn.undo().ok && !drawn.roomById(drawnRoom), 'undo restores the original room and wall');
A.ok(wallIds.every(id => drawn.propById(id)), 'undo preserves shared walls');
A.ok(drawn.redo().ok && !!drawn.roomById(drawnRoom), 'redo restores the drawn room');
const parallel = WM.deserialize(drawn.serialize());
const outerPanel = parallel.addProp({ t: 'structural_wall', x: 106, y: 105, w: 1, h: 1 }).id;
A.ok(parallel.resizeSharedRoom(drawnRoom, { ...rect, x2: 106 }, drawnScope).ok, 'adjacent wall panels do not block a shared resize');
A.eq(parallel.propById(panel).x, 106, 'inner wall moves at a shared boundary');
A.eq(parallel.propById(outerPanel).x, 107, 'adjacent wall also moves with the boundary');
A.ok(parallel.resizeSharedRoom(drawnRoom, rect, drawnScope).ok, 'an internal boundary can shrink again');
A.eq(parallel.propById(panel).x, 105, 'shrinking restores the inner boundary');
const reuse = WM.deserialize(drawn.serialize());
const existingWall = reuse.addProp({ t: 'structural_wall', x: 107, y: 105, w: 1, h: 1 }).id;
A.ok(reuse.resizeSharedRoom(drawnRoom, { ...rect, x2: 107 }, drawnScope).ok, 'a resize can reuse a wall at its destination');
A.ok(!!reuse.propById(existingWall), 'the destination wall stays in place');
A.eq(reuse.props().filter(p => p.t === 'structural_wall' && p.x === 107 && p.y === 105).length, 1, 'reused walls do not overlap');
const crossing = WM.create();
const crossingDeck = crossing.addRoom({ kind: 'hab', rect: { x1: 100, y1: 100, x2: 110, y2: 110 } }).id;
crossing.addProp({ t: 'plant', x: 104, y: 104, w: 2, h: 1 });
const crossingBefore = JSON.stringify(crossing.serialize());
A.ok(!crossing.drawRoomOnDeck({ kind: 'hab', rect: { x1: 101, y1: 101, x2: 104, y2: 107 } }, [crossingDeck]).ok,
  'a room boundary cannot split a furniture footprint');
A.eq(JSON.stringify(crossing.serialize()), crossingBefore, 'a refused room drawing is atomic');
A.ok(!crossing.drawRoomOnDeck({ kind: 'hab', rect: { x1: 108, y1: 108, x2: 113, y2: 113 } }, [crossingDeck]).ok,
  'a room cannot partly replace existing deck and partly leave it');

const sections = WM.deserialize(drawn.serialize());
const corner = sections.drawRoomOnDeck({ kind: 'hab', rect: { x1: 101, y1: 102, x2: 103, y2: 104 } }, drawnScope);
A.ok(corner.ok && sections.roomById(drawnRoom).rects.length > 1, 'fixture creates a multi-section room');
const sectionScope = drawnScope.concat(corner.id);
const partIndex = sections.roomById(drawnRoom).rects.findIndex(r => r.y1 === 105);
const part = sections.roomById(drawnRoom).rects[partIndex];
const edge = { index: partIndex, edge: 'x2', from: part.y1, to: part.y2 };
const sectionBefore = JSON.stringify(sections.serialize());
const sectionResize = sections.resizeSharedRoom(drawnRoom, { ...part, x2: part.x2 + 1 }, sectionScope, edge);
A.ok(sectionResize.ok && sectionResize.handled, 'a multi-section room can grow along an exposed shared edge');
A.eq(sections.roomAt(106, 106), drawnRoom, 'the selected section gains floor from its neighbor');
A.eq(sections.roomAt(104, 103), drawnRoom, 'other sections retain their floor');
A.eq(sections.roomAt(102, 103), corner.id, 'neighboring room retains its identity');
A.ok(sections.undo().ok, 'a section resize can be undone');
A.eq(JSON.stringify(sections.serialize()), sectionBefore, 'undo restores all sections and walls');
const internal = { index: partIndex, edge: 'y1', from: 104, to: 105 };
A.ok(!sections.resizeSharedRoom(drawnRoom, { ...part, x1: 104, y1: part.y1 - 1 }, sectionScope, internal).ok,
  'an internal seam between sections cannot be resized');

const thin = WM.create();
const thinDeck = thin.addRoom({ kind: 'hab', rect: { x1: 100, y1: 100, x2: 114, y2: 114 } }).id;
const thinRoom = thin.drawRoomOnDeck({ kind: 'hab', rect: { x1: 101, y1: 101, x2: 110, y2: 105 } }, [thinDeck]).id;
const thinCorner = thin.drawRoomOnDeck({ kind: 'hab', rect: { x1: 101, y1: 101, x2: 103, y2: 104 } }, [thinDeck, thinRoom]).id;
for (let x = 104; x <= 110; x++) thin.addProp({ t: 'structural_wall', x, y: 105, w: 1, h: 1 });
const thinIndex = thin.roomById(thinRoom).rects.findIndex(r => r.y1 === 105);
const thinPart = thin.roomById(thinRoom).rects[thinIndex];
const thinEdge = { index: thinIndex, edge: 'y2', from: 104, to: 110 };
const thinBefore = JSON.stringify(thin.serialize());
const shrunk = thin.resizeSharedRoom(thinRoom, { ...thinPart, x1: 104, y2: 104 }, [thinDeck, thinRoom, thinCorner], thinEdge);
A.ok(shrunk.ok && shrunk.handled, 'a one-tile section can shrink into the rest of the room');
A.eq(thin.roomAt(106, 105), thinDeck, 'shrinking returns the former section to its neighbor');
A.eq(thin.roomAt(106, 104), thinRoom, 'the remaining room stays intact');
A.ok(!!thin.propAt(106, 104), 'the shared wall moves to the new boundary');
A.ok(thin.undo().ok && JSON.stringify(thin.serialize()) === thinBefore, 'undo restores the thin section and wall');

const extension = WM.create();
const extensionRoom = extension.addRoom({ kind: 'hab', name: 'Foyer', rect: { x1: 100, y1: 100, x2: 105, y2: 105 } }).id;
const extensionNeighbor = extension.addRoom({ kind: 'hab', rect: { x1: 110, y1: 97, x2: 115, y2: 105 } }).id;
const extensionBefore = JSON.stringify(extension.serialize());
const extensionRects = [{ x1: 100, y1: 97, x2: 105, y2: 99 }, { x1: 106, y1: 97, x2: 109, y2: 97 }];
const extended = extension.extendRoomFloor(extensionRoom, extensionRects);
A.ok(extended.ok && extended.tiles === 22, 'a room can extend across connected empty floor');
A.eq(extension.roomAt(109, 97), extensionRoom, 'the extension reaches the neighboring room');
A.eq(extension.roomAt(110, 97), extensionNeighbor, 'the neighboring room remains unchanged');
A.ok(extension.undo().ok && JSON.stringify(extension.serialize()) === extensionBefore, 'floor extension undoes in one step');
A.ok(extension.redo().ok && extension.roomAt(109, 97) === extensionRoom, 'floor extension can be redone');
const extensionAfter = JSON.stringify(extension.serialize());
A.ok(!extension.extendRoomFloor(extensionRoom, [{ x1: 109, y1: 97, x2: 110, y2: 97 }]).ok, 'an extension cannot overlap existing rooms');
A.ok(!extension.extendRoomFloor(extensionRoom, [{ x1: 120, y1: 100, x2: 120, y2: 100 }]).ok, 'an extension cannot create disconnected floor');
A.eq(JSON.stringify(extension.serialize()), extensionAfter, 'refused extensions leave the layout unchanged');

const rezoned = WM.create();
const zoneLeft = rezoned.addRoom({ kind: 'hab', name: 'Foyer', rect: { x1: 100, y1: 100, x2: 105, y2: 104 } }).id;
const zoneRight = rezoned.addRoom({ kind: 'hab', name: 'Side', rect: { x1: 106, y1: 100, x2: 108, y2: 104 } }).id;
rezoned.paintTiles(zoneRight, [[107, 102]], 'cobalt');
const zoneBefore = JSON.stringify(rezoned.serialize());
const zoneChanges = {
  [zoneLeft]: [{ x1: 100, y1: 100, x2: 108, y2: 103 }],
  [zoneRight]: []
};
const zoneAdd = [{ source: zoneLeft, kind: 'corridor', name: 'Walk', rects: [{ x1: 100, y1: 104, x2: 108, y2: 104 }] }];
const zoneResult = rezoned.rezoneRooms(zoneChanges, zoneAdd);
A.ok(zoneResult.ok && zoneResult.created.length === 1, 'rezoning merges a room and preserves leftover floor as a walkway');
A.eq(rezoned.roomAt(107, 102), zoneLeft, 'merged floor belongs to the existing foyer');
A.eq(rezoned.roomById(zoneLeft).floorPaint['107,102'], 'cobalt', 'paint stays on its tile after rezoning');
A.eq(rezoned.roomAt(107, 104), zoneResult.created[0], 'leftover floor belongs to the new walkway');
A.ok(!rezoned.roomById(zoneRight), 'the explicitly merged room is removed');
A.ok(rezoned.undo().ok && JSON.stringify(rezoned.serialize()) === zoneBefore, 'rezoning undoes as one edit');
const incomplete = rezoned.rezoneRooms({ [zoneLeft]: [{ x1: 100, y1: 100, x2: 104, y2: 104 }] }, []);
A.ok(!incomplete.ok && JSON.stringify(rezoned.serialize()) === zoneBefore, 'rezoning cannot discard floor');
rezoned.addProp({ t: 'plant', x: 104, y: 102, w: 2, h: 1 });
const cutBefore = JSON.stringify(rezoned.serialize());
A.ok(!rezoned.rezoneRooms({ [zoneLeft]: [{ x1: 100, y1: 100, x2: 104, y2: 104 }], [zoneRight]: [{ x1: 105, y1: 100, x2: 108, y2: 104 }] }, []).ok,
  'rezoning refuses a boundary through furniture');
A.eq(JSON.stringify(rezoned.serialize()), cutBefore, 'a refused rezone changes nothing');

A.report('buildmode-walls-rooms.test');
