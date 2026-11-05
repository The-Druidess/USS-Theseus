'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sharp = require('sharp');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const profiles = [
  ['chief_of_security', 'Chief_of_Security'],
  ['chief_medical_officer', 'Chief_Medical_Officer'],
  ['first_officer', 'First_Officer'],
  ['chief_science_officer', 'Chief_Science_Officer']
];
const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
function catalog(root) {
  const context = {};
  vm.runInNewContext(fs.readFileSync(root + '/app/data-shim.js', 'utf8') + ';this.skins=DATA.SKINS;', context);
  return JSON.parse(JSON.stringify(context.skins));
}
(async () => {
  const skins = catalog('frontend');
  assert.deepEqual(skins, catalog('website/app'));
  const manifest = JSON.parse(fs.readFileSync('frontend/assets/sprites/manifest.json')).sprites;
  const website = JSON.parse(fs.readFileSync('website/app/assets/sprites/manifest.json')).sprites;
  const records = JSON.parse(fs.readFileSync('docs/character-remaster/bridge-officers/exports.json')).records;
  assert.equal(records.length, 283);
  for (const [id, archive] of profiles) {
    const skin = skins[id];
    assert(skin.set.startsWith('theseus_bridge_'));
    assert(Math.abs(skin.scale * skin.sourceStandingHeight - 19) < 1e-10, id + ' floor scale');
    const zip = fs.readFileSync('docs/character-remaster/bridge-officers/' + id + '/' + archive + '.zip');
    const sourceHash = hash(zip);
    for (const direction of directions) for (const [state, count] of [['rot', 1], ['walk', 6], ['sit', 1]]) {
      const key = skin.set + '.' + state + '.' + direction;
      assert.equal(manifest[key].length, count, key);
      assert.deepEqual(manifest[key], website[key], key + ' website parity');
    }
    if (id !== 'chief_of_security') assert.equal(manifest[skin.set + '.type.south'].length, 9);
    const south = fs.readFileSync('frontend/assets/sprites/' + manifest[skin.set + '.rot.south'][0]);
    const { data, info } = await sharp(south).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let top = info.height, bottom = -1;
    for (let row = 0; row < info.height; row++) for (let column = 0; column < info.width; column++) {
      if (data[(row * info.width + column) * 4 + 3] <= 16) continue;
      top = Math.min(top, row); bottom = Math.max(bottom, row);
    }
    assert.equal(bottom - top + 1, skin.sourceStandingHeight, id + ' measured standing height');
    for (const record of records.filter(record => record.skin === id)) {
      const bytes = fs.readFileSync(record.output);
      assert.equal(hash(bytes), record.sha256, record.output);
      assert.equal(hash(fs.readFileSync(record.source)), record.sha256, record.source);
      assert.equal(record.archiveSha256, sourceHash);
      assert(bytes.equals(fs.readFileSync(record.output.replace('frontend/', 'website/app/'))));
      assert.equal(record.width, 144); assert.equal(record.height, 144);
      assert.equal(manifest[record.set + '.' + record.track][record.index], record.output.replace('frontend/assets/sprites/', ''));
    }
  }
  assert.equal(skins.blank.set, 'approved_android');
  assert.equal(skins.xenomorph.set, 'approved_xenomorph');
  console.log('PASS: four Bridge officer skins, 283 exact source frames, eight-way idle/walk/seated tracks, supplied work animations, floor scale and website parity');
})().catch(error => { console.error(error); process.exitCode = 1; });