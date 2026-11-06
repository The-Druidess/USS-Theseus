'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const A = require('./_assert'), WM = require('../frontend/app/worldmodel'), PS = require('../frontend/app/propsprites');
const fx = require('../frontend/app/projection-prop-effects');
const catalog = require('../frontend/app/prop-catalog-data');
const geometry = require('../frontend/assets/industrial/projection-correction/runtime-geometry.json');
const remaster = require('../frontend/app/propremaster');
const help = require('../frontend/app/equipmenthelp');
const items = [
  { id: 'equipment_atm', label: 'ATM', w: 2, h: 1, x: 3, y: 4, floor: 12 },
  { id: 'equipment_safe', label: 'SAFE', w: 1, h: 1, x: 7, y: 4, floor: 12 },
  { id: 'desktop_inbox_outbox', label: 'TRAY', w: 1, h: 1, x: 10, y: 4, floor: 12 }
];
WM.setPropRules(PS.ruleFor);
const station = WM.create();
A.ok(!station.props().some(prop => items.some(item => item.id === prop.t)), 'equipment is not automatically placed');
A.ok(station.addProp({ t: 'longtable', x: 10, y: 4, w: 3, h: 1 }).ok, 'tray support table places');
A.eq(station.canPlaceProp('desktop_inbox_outbox', 14, 4, 1, 1).error, 'NEEDS_SURFACE', 'desktop tray requires a table');
for (const item of items) {
  const spec = PS.spec(item.id);
  A.eq(spec.label, item.label, 'picker uses the requested short name');
  A.eq(help.kind(spec, WM.capForProp(item.id)), 'equipment', item.id + ' appears in the Equipment selection area');
  A.eq(help.label(spec, WM.capForProp(item.id)), 'PENDING EQUIPMENT · FUNCTION UNASSIGNED', 'picker does not claim unimplemented functionality');
  A.eq([spec.w, spec.h, spec.tier, spec.animated], [item.w, item.h, 'cosmetic', false], item.id + ' has the agreed footprint and no behavior');
  A.ok(!spec.use && !spec.seat && !spec.surface, item.id + ' has no interaction, seat, or surface-host role');
  A.ok(!WM.capForProp(item.id) && !WM.grantLabelForProp(item.id), item.id + ' grants no capabilities');
  A.eq(PS.facings(item.id), [0, 1, 2, 3], item.id + ' offers four directional views');
  A.eq(PS.ruleFor(item.id).mount, item.id === 'desktop_inbox_outbox' ? 'surface' : null, 'only the desktop tray is table-mounted');
  if (item.id !== 'desktop_inbox_outbox') {
    A.ok(spec.blocks, 'floor equipment blocks its footprint');
    A.eq(station.canPlaceProp(item.id, 10, 4, item.w, item.h).error, 'OVERLAP', 'floor equipment cannot mount on tables');
  }
  const result = station.addProp({ t: item.id, x: item.x, y: item.y, w: item.w, h: item.h, r: 3, block: spec.blocks });
  A.ok(result.ok, item.id + ' places using normal model rules');
  const placed = station.propById(result.id);
  A.ok(station.undo().ok, 'equipment placement can be undone');
  A.ok(!station.propById(result.id), 'undo removes equipment');
  A.ok(station.redo().ok, 'equipment placement can be redone');
  A.eq(station.propById(result.id), placed, 'redo preserves equipment placement exactly');
  const restored = WM.deserialize(station.serialize());
  A.eq(restored.propById(result.id), station.propById(result.id), item.id + ' preserves its identity and rotation on reload');
  for (const [r, face] of ['s', 'w', 'n', 'e'].entries()) {
    A.eq(PS.footprintAt(item.id, r), { w: item.w, h: item.h }, 'directional views preserve the reserved footprint');
    const row = catalog.views.find(row => row.key === item.id + ':' + face);
    A.ok(row && row.r === r && row.requiredMount === (item.id === 'desktop_inbox_outbox' ? 'surface' : null), 'catalog includes correctly mapped view');
    A.eq(row.label, item.label, 'generated catalog uses the same short name');
    const measured = geometry.views[item.id + ':' + face];
    for (const set of ['approved-sheet', 'projection-correction']) {
      const manifest = require('../frontend/assets/industrial/' + set + '/manifest.json');
      const view = manifest.props[item.id].views[face];
      A.ok(remaster.validate(view), 'equipment art meets runtime manifest validation');
      A.eq([view.image, view.sourceWidth, view.sourceHeight], [measured.image, measured.width, measured.height], 'runtime geometry and source dimensions agree');
      const bytes = fs.readFileSync(path.join(__dirname, '../frontend/assets/industrial', set, view.image));
      A.eq(crypto.createHash('sha256').update(bytes).digest('hex'), measured.sha256, 'source pixels match recorded hash');
      A.ok(bytes.equals(fs.readFileSync(path.join(__dirname, '../website/app/assets/industrial', set, view.image))), 'website uses identical artwork');
      const fit = remaster.fit(view.bounds, measured.crop, view.contact, view.sourceHeight);
      A.ok(Math.abs(fit.y + fit.height - item.floor) < 1e-9, 'transparent padding cannot float the equipment above its floor or tabletop');
    }
    const classification = fx.classify(item.id, face);
    A.eq(classification.classification, 'none', 'pending equipment has no invented activity');
    A.ok(classification.reason.includes('unassigned'), 'pending purpose is explicit');
  }
}
A.eq(WM.capForProp('safe'), 'cabinet', 'existing functional safe retains file capability');
A.eq(WM.capForProp('equipment_safe'), null, 'new safe remains separate from functional safe');
for (const id of ['intake', 'outbox']) {
  A.eq(help.kind(PS.spec(id), WM.capForProp(id)), 'equipment', 'existing workflow equipment keeps its shelf');
  A.eq(PS.spec(id).tier, 'functional', id + ' remains functional workflow equipment');
  A.eq([PS.spec(id).w, PS.spec(id).h], [2, 2], id + ' retains its original footprint');
}
A.eq(help.kind(PS.spec('safe'), WM.capForProp('safe')), 'abilities', 'functional safe stays in Abilities');
A.eq(help.kind(PS.spec('plant'), WM.capForProp('plant')), 'decoration', 'ordinary furniture stays in Furniture');
A.eq(help.kind({ pendingEquipment: true }, 'cabinet'), 'abilities', 'capability classification takes precedence over pending equipment');
A.eq(station.belts(), [], 'placing equipment creates no routing belts');
WM.setPropRules(null);
A.report('pending-equipment');
