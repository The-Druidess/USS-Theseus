'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({});
vm.runInContext(read('frontend/app/data-shim.js') + '\nglobalThis.catalog = DATA;', context);
const data = context.catalog;
const skin = data.SKINS.tom_paris;
assert.equal(skin.name, 'Tom Paris');
assert.equal(skin.collection, 'star-trek');
assert.equal(skin.scale, 0.25);
assert.equal(skin.sourceStandingHeight, 76);
assert.equal(data.DEFAULT_SKIN, 'blank');
assert.equal(data.skinIds()[0], 'tom_paris');
assert.equal(data.skinIds()[1], 'jean_luc_picard');
const picard = data.SKINS.jean_luc_picard;
assert.equal(picard.name, 'Jean-Luc Picard (Dixon Hill)');
assert.equal(picard.set, 'approved_jean_luc_picard');
assert.equal(picard.collection, 'star-trek');
assert.equal(picard.scale, 0.25);
assert.equal(picard.sourceStandingHeight, 76);
const scotty = data.SKINS.montgomery_scott;
assert.equal(scotty.name, 'Montgomery Scott (Scotty)');
assert.equal(scotty.set, 'approved_montgomery_scott');
assert.equal(scotty.collection, 'star-trek');
assert.equal(scotty.scale, 0.25);
assert.equal(scotty.sourceStandingHeight, 76);
const seven = data.SKINS.seven_of_nine;
assert.equal(seven.name, 'Seven of Nine');
assert.equal(seven.set, 'approved_seven_of_nine');
assert.equal(seven.collection, 'star-trek');
assert.equal(seven.scale, 0.25);
assert.equal(seven.sourceStandingHeight, 76);
assert.equal(data.skinIds().filter(id => id === 'minionchar').length, 0);
assert.equal(new Set(data.skinIds()).size, Object.keys(data.SKINS).length);
data.SKINS.future_trek = { name: 'Future crew', collection: 'star-trek' };
const trekIds = ['tom_paris', 'jean_luc_picard', 'q_judge', 'montgomery_scott', 'seven_of_nine', 'chief_science_officer', 'quark', 'chief_of_security', 'chief_medical_officer', 'first_officer', 'future_trek'];
assert.deepEqual(Array.from(data.skinIds().slice(0, trekIds.length)), trekIds);
assert.equal(data.skinIds()[trekIds.length], 'blank');
delete data.SKINS.future_trek;
for (const file of ['app.js','stationui.js','marketplace.js']) {
  assert.match(read('frontend/app/'+file), /DATA\.skinIds\(\)/, file+' uses shared picker ordering');
}
for (const file of ['app/data-shim.js','app/app.js','app/stationui.js','app/marketplace.js','assets/sprites/manifest.json']) {
  assert.equal(read('frontend/'+file), read('website/app/'+file), file+' website parity');
}
const sprites = JSON.parse(read('frontend/assets/sprites/manifest.json')).sprites;
function expectedTracks(skin) {
const expected = {};
if (skin === data.SKINS.q_judge) {
  assert.equal(skin.set, 'approved_q_judge');
  assert.equal(skin.collection, 'star-trek');
  assert.equal(skin.scale, 0.25);
  assert.equal(skin.sourceStandingHeight, 76);
  for (const dir of ['south','south-east','east','north-east','north','north-west','west','south-west']) {
    expected[skin.set+'.rot.'+dir] = 1;
    expected[skin.set+'.sit.'+dir] = 1;
  }
  assert.deepEqual(Object.keys(sprites).filter(key=>key.startsWith(skin.set+'.')).sort(), Object.keys(expected).sort());
  return expected;
}
for (const dir of ['south','south-east','east','north-east','north','north-west','west','south-west']) {
  expected[skin.set+'.rot.'+dir] = 1;
  expected[skin.set+'.walk.'+dir] = 6;
}
for (const dir of ['south','east','north','west']) expected[skin.set+'.sit.'+dir] = 1;
expected[skin.set+'.type.north'] = 4;
const tracks = Object.keys(sprites).filter(key => key.startsWith(skin.set+'.'));
assert.deepEqual(tracks.sort(), Object.keys(expected).sort());
assert.equal(tracks.reduce((n,key) => n+sprites[key].length,0), 64);
return expected;
}

(async () => {
  for (const approvedSkin of [skin, picard, scotty, seven, data.SKINS.q_judge]) {
  for (const [track,count] of Object.entries(expectedTracks(approvedSkin))) {
    assert.ok(Array.isArray(sprites[track]));
    assert.equal(sprites[track].length,count,track);
    const unique = new Set();
    for (const file of sprites[track]) {
      const bytes = fs.readFileSync(path.join(root,'frontend/assets/sprites',file));
      assert.ok(bytes.equals(fs.readFileSync(path.join(root,'website/app/assets/sprites',file))),file+' website parity');
      const {data:pixels,info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      unique.add(pixels.toString('base64'));
      assert.equal(info.width,144,file);
      assert.equal(info.height,144,file);
      let visible=0,transparent=0;
      for(let i=3;i<pixels.length;i+=4) {
        if(pixels[i]>16) visible++;
        if(pixels[i]===0) transparent++;
      }
      assert.ok(visible>500 && transparent>18000,file+' transparent full body');
    }
    assert.equal(unique.size,count,track+' distinct generated animation frames');
  }
  }
  console.log('Star Trek skins: Paris/Picard/Scotty/Seven full sets and Q standing/seated references passed, with catalog ordering and website parity');
})().catch(error => {console.error(error);process.exitCode=1;});
