'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const extracted = process.argv[2];
if (!extracted) throw new Error('Usage: node dev/industrial-textures/import-pending-equipment.cjs <extracted-root>');
const items = [
  { id: 'equipment_atm', folder: 'ATM', footprint: { w: 2, h: 1 }, bounds: { x: 0, y: -18, width: 24, height: 30 } },
  { id: 'equipment_safe', folder: 'safe', footprint: { w: 1, h: 1 }, bounds: { x: 0, y: -6, width: 12, height: 18 } },
  { id: 'desktop_inbox_outbox', folder: 'Inbox_Outbox_Bin_for_Destop', footprint: { w: 1, h: 1 }, bounds: { x: 0, y: 4, width: 12, height: 8 } }
];
async function main() {
  const roots = ['projection-correction', 'approved-sheet'].map(pack => path.join('frontend', 'assets', 'industrial', pack));
  const manifests = roots.map(root => JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')));
  const geometryFile = path.join(roots[0], 'runtime-geometry.json');
  const geometry = JSON.parse(fs.readFileSync(geometryFile, 'utf8'));
  for (const item of items) {
    const views = {};
    for (const [face, direction] of Object.entries({ s: 'south', w: 'west', n: 'north', e: 'east' })) {
      const bytes = fs.readFileSync(path.join(extracted, item.folder, item.folder, 'rotations', direction + '.png'));
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let left = info.width, top = info.height, right = -1, bottom = -1;
      for (let i = 3; i < data.length; i += 4) if (data[i]) {
        const pixel = (i - 3) / 4, x = pixel % info.width, y = Math.floor(pixel / info.width);
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (right < left) throw new Error('Empty equipment view: ' + item.id + ':' + face);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      const image = item.id + '-' + face + '-' + hash.slice(0, 12) + '.png';
      views[face] = {
        image, sourceWidth: info.width, sourceHeight: info.height,
        footprint: item.footprint, bounds: item.bounds, mode: 'approved', exposure: 1,
        contact: { x: .5, y: (bottom + 1) / info.height }, effects: false
      };
      geometry.views[item.id + ':' + face] = {
        image, width: info.width, height: info.height, sha256: hash,
        crop: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
      };
      for (const root of roots) fs.writeFileSync(path.join(root, image), bytes);
    }
    for (const manifest of manifests) manifest.props[item.id] = { views };
    console.log(item.id + ': imported four cardinal views, original PNG bytes preserved');
  }
  for (let i = 0; i < roots.length; i++) fs.writeFileSync(path.join(roots[i], 'manifest.json'), JSON.stringify(manifests[i], null, 2) + '\n');
  fs.writeFileSync(geometryFile, JSON.stringify(geometry, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
