'use strict';
const assert = require('node:assert/strict');
const M = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/propsprites.js');
const Help = require('../frontend/app/equipmenthelp.js');
M.setPropRules(P.ruleFor);
assert.equal(M.capForProp('bench'), 'computer');
assert.deepEqual(M.capabilitiesForProp('bench'), ['computer', 'workbench']);
assert.equal(M.grantLabelForProp('bench'), 'COMPUTE + TERMINAL');
assert(P.spec('workbench').retired);
assert(P.STARTER.includes('bench') && !P.STARTER.includes('workbench'));
{
  const state = M.create(M.starterDoc());
  const bench = state.props().find(prop => prop.t === 'bench');
  const bay = state.addProp({ t: 'bay', x: 11, y: 5, w: 2, h: 2, agentId: 'agent' });
  assert(bay.ok && state.assignDesk(bench.id, 'agent').ok);
  const caps = state.bayObjects('agent', bay.id);
  assert(caps.includes('computer') && caps.includes('workbench'));
  assert.equal(caps.filter(cap => cap === 'workbench').length, 1);
  const second = state.addProp({ t: 'bay', x: 11, y: 8, w: 2, h: 2, agentId: 'other' });
  assert(second.ok);
  const otherCaps = state.bayObjects('other', second.id);
  assert(!otherCaps.includes('computer'), 'another agent cannot borrow the assigned Bench compute slot');
  assert(otherCaps.includes('workbench'), 'Terminal remains shared room equipment as before');
  const room = state.addRoom({ kind: 'lab', rect: { x1: 24, y1: 0, x2: 40, y2: 10 } });
  const remoteBay = state.addProp({ t: 'bay', x: 26, y: 3, w: 2, h: 2, agentId: 'remote' });
  assert(room.ok && remoteBay.ok);
  assert(!state.bayObjects('remote', remoteBay.id).includes('workbench'), 'Bench Terminal never leaks to another capability room');
  const facts = Help.inspect(state, 'agent', 'bench');
  assert(facts.placed.includes('workbench') && facts.purpose.includes('Terminal'));
}
{
  const doc = M.starterDoc();
  const original = doc.props.find(prop => prop.t === 'bench');
  Object.assign(original, { t: 'workbench', x: 3, y: 1, w: 2, h: 1, agentId: 'agent', label: 'Keep', brief: 'Keep instructions' });
  doc.props.push({ id: 'blocker', t: 'crate', x: 5, y: 1, w: 1, h: 1 });
  const state = M.deserialize(doc), replacement = state.propById(original.id);
  assert.equal(replacement.t, 'bench');
  assert.deepEqual([replacement.w, replacement.h], [4, 1]);
  for (const key of ['id', 'agentId', 'label', 'brief']) assert.equal(replacement[key], original[key]);
  assert.equal(state.roomAt(replacement.x, replacement.y), state.roomAt(original.x, original.y));
  assert(state.canPlaceProp('bench', replacement.x, replacement.y, 4, 1, replacement.id).ok);
  assert.deepEqual(M.deserialize(state.serialize()).serialize(), state.serialize());
}
{
  const doc = M.defaultDoc();
  doc.rooms[doc.order[0]].rects = [{ x1: 0, y1: 0, x2: 2, y2: 0 }];
  doc.props = [{ id: 'legacy', t: 'workbench', x: 0, y: 0, w: 2, h: 1, agentId: 'agent' }];
  const state = M.deserialize(doc);
  assert.equal(state.propById('legacy').t, 'workbench', 'a room too narrow for Bench never loses its existing terminal');
}
console.log('PASS: combined Bench grants, dedicated compute, room-scoped Terminal, retired picker, safe relocation, no-space preservation, and reload stability');