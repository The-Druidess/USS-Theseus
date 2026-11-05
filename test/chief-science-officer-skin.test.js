'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');
const website = path.join(root, 'website', 'app');

function readSkin(file) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nglobalThis.catalog = DATA;', context);
  return context.catalog.SKINS.chief_science_officer;
}

const skin = readSkin(path.join(frontend, 'app', 'data-shim.js'));
const websiteSkin = readSkin(path.join(website, 'app', 'data-shim.js'));
assert.deepEqual(JSON.parse(JSON.stringify(skin)), JSON.parse(JSON.stringify(websiteSkin)));
assert.equal(skin.name, 'Chief Science Officer');
assert.equal(skin.set, 'theseus_bridge_science_v2');
assert.equal(skin.scale, 19 / 81);
assert.equal(skin.sourceStandingHeight, 81);
assert.equal(skin.collection, 'star-trek');

const frontendManifestPath = path.join(frontend, 'assets', 'sprites', 'manifest.json');
const websiteManifestPath = path.join(website, 'assets', 'sprites', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(frontendManifestPath, 'utf8')).sprites;
const websiteManifest = JSON.parse(fs.readFileSync(websiteManifestPath, 'utf8')).sprites;
const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const templateDir = path.join(frontend, 'assets', 'sprites', 'approved_tom_paris');
const uniqueFrames = new Set();
const visorLenses = {
  south: { y: 46, stripes: [66, 68, 70, 72, 74, 76] },
  'south-east': { y: 46, stripes: [69, 71, 73, 75, 77, 79] },
  east: { y: 46, stripes: [74, 76, 78] },
  west: { y: 46, stripes: [63, 65, 67, 69] },
  'south-west': { y: 46, stripes: [63, 65, 67, 69, 71, 73] }
};
const sleeveRegions = {
  south: [[55, 64], [79, 88]],
  'south-east': [[57, 70], [78, 88]],
  east: [[63, 70], [80, 84]],
  'north-east': [[55, 67], [79, 88]],
  north: [[54, 65], [79, 89]],
  'north-west': [[54, 66], [78, 89]],
  west: [[62, 69], [78, 85]],
  'south-west': [[54, 66], [78, 89]]
};
const messySleeveColors = new Set(['61,41,47', '18,16,18']);
const handSkinTones = new Map([
  ['239,182,146', '152,104,80'],
  ['230,170,128', '152,104,80'],
  ['219,151,106', '152,96,72'],
  ['201,141,102', '128,80,56'],
  ['181,116,88', '120,72,48'],
  ['148,88,63', '96,56,32']
]);
const wristDirections = new Set(['south', 'south-east', 'south-west']);
const strayPantsPixels = {
  east: [
    [65, 80], [65, 81], [68, 81], [69, 81],
    [66, 84], [68, 84], [74, 82], [74, 83], [74, 84], [74, 85],
    [73, 81], [74, 81], [75, 82], [75, 83], [75, 84], [75, 85],
    [69, 86], [71, 86], [73, 86], [74, 86], [70, 87], [71, 87], [72, 87], [73, 87]
  ],
  'south-east': [[73, 84]],
  'south-west': [[71, 85]]
};
const pantsRegions = {
  south: { left: 64, right: 80, top: 80, bottom: 105 },
  'south-east': { left: 68, right: 81, top: 85, bottom: 107 },
  east: { left: 69, right: 77, top: 88, bottom: 101 },
  'north-east': { left: 68, right: 82, top: 85, bottom: 105 },
  north: { left: 63, right: 81, top: 83, bottom: 99 },
  'north-west': { left: 64, right: 79, top: 85, bottom: 101 },
  west: { left: 69, right: 77, top: 88, bottom: 101 },
  'south-west': { left: 64, right: 80, top: 86, bottom: 105 }
};

function alphaBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return [left, top, right, bottom];
}

(async () => {
  for (const [index, direction] of directions.entries()) {
    const track = `theseus_science_officer.rot.${direction}`;
    const relativePath = `theseus_science_officer/rot_${direction}.png`;
    assert.deepEqual(manifest[track], [relativePath]);
    assert.deepEqual(websiteManifest[track], [relativePath]);

    const file = path.join(frontend, 'assets', 'sprites', relativePath);
    const websiteFile = path.join(website, 'assets', 'sprites', relativePath);
    const templateFile = path.join(templateDir, `rot_${direction}.png`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.equals(fs.readFileSync(websiteFile)), `${relativePath} website parity`);

    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const template = await sharp(templateFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (wristDirections.has(direction)) {
      const handMask = new Uint8Array(info.width * info.height);
      for (let y = 77; y <= 85; y++) {
        for (let x = 54; x <= 90; x++) {
          const offset = (y * info.width + x) * 4;
          const templateColor = `${template.data[offset]},${template.data[offset + 1]},${template.data[offset + 2]}`;
          const expectedColor = handSkinTones.get(templateColor);
          if (!expectedColor) continue;
          handMask[y * info.width + x] = 1;
          assert.equal(
            `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
            expectedColor,
            `${relativePath} matches the face palette on exposed hands`
          );
        }
      }
      for (let y = 76; y <= 86; y++) {
        for (let x = 53; x <= 91; x++) {
          const offset = (y * info.width + x) * 4;
          const templateColor = `${template.data[offset]},${template.data[offset + 1]},${template.data[offset + 2]}`;
          if (!['60,60,60', '36,36,36'].includes(templateColor)) continue;
          const adjacentToHand = [-1, 0, 1].some(dy => [-1, 0, 1].some(
            dx => handMask[(y + dy) * info.width + x + dx]
          ));
          if (!adjacentToHand) continue;
          assert.equal(
            `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
            '30,30,30',
            `${relativePath} keeps a clean dark wrist edge`
          );
        }
      }
    }
    const headColors = new Set();
    for (let y = 35; y <= 42; y++) {
      for (let x = 58; x <= 85; x++) {
        const offset = (y * info.width + x) * 4;
        if (data[offset + 3] > 16) {
          headColors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
        }
      }
    }
    for (const color of ['25,20,18', '48,33,25', '61,41,30']) {
      assert.ok(headColors.has(color), `${relativePath} has tight, textured dark curls`);
    }
    const visor = visorLenses[direction];
    if (visor) {
      for (const x of visor.stripes) {
        for (let y = visor.y; y <= visor.y + 1; y++) {
          const offset = (y * info.width + x) * 4;
          const expected = y === visor.y ? '192,128,45' : '184,124,43';
          assert.equal(
            `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
            expected,
            `${relativePath} has a vertical gold visor lens`
          );
        }
      }
      if (!visor) {
        for (let y = 44; y <= 48; y++) {
          for (let x = 60; x <= 83; x++) {
            const offset = (y * info.width + x) * 4;
            assert.ok(
              !['94,116,128', '196,207,214'].includes(
                `${data[offset]},${data[offset + 1]},${data[offset + 2]}`
              ),
              `${relativePath} does not show a visor across the back of the head`
            );
          }
        }
      }
    }
    const pants = pantsRegions[direction];
    for (let y = pants.top; y <= pants.bottom; y++) {
      for (let x = pants.left; x <= pants.right; x++) {
        const offset = (y * info.width + x) * 4;
        if (data[offset + 3] === 0) continue;
        assert.ok(
          Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 45,
          `${relativePath} pants and boots stay black`
        );
      }
    }
    if (direction === 'south') {
      const offset = (87 * info.width + 63) * 4;
      assert.equal(
        `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
        '0,0,0',
        `${relativePath} keeps the outer trouser edge black`
      );
    }
    for (const [x, y] of strayPantsPixels[direction] || []) {
      const offset = (y * info.width + x) * 4;
      assert.equal(
        `${data[offset]},${data[offset + 1]},${data[offset + 2]}`,
        '0,0,0',
        `${relativePath} keeps the trouser detail at ${x},${y} black`
      );
    }
    let goldSleevePixels = 0;
    for (let y = 66; y <= 78; y++) {
      for (let x = 54; x < 90; x++) {
        const offset = (y * info.width + x) * 4;
        if (data[offset + 3] > 0 && data[offset] > data[offset + 1] && data[offset + 1] > data[offset + 2]) {
          goldSleevePixels++;
        }
      }
    }
    assert.ok(goldSleevePixels > 0, `${relativePath} retains the gold shirt and sleeves`);
    for (let y = 66; y <= 77; y++) {
      for (const [left, right] of sleeveRegions[direction]) {
        for (let x = left; x <= right; x++) {
          const offset = (y * info.width + x) * 4;
          const color = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
          if (['south-east', 'south-west'].includes(direction)) {
            assert.ok(
              !messySleeveColors.has(color),
              `${relativePath} has clean sleeve outline colors`
            );
          }
          if (data[offset + 3] === 0 || !['184,124,43', '132,88,31', '192,128,45', '113,76,29'].includes(color)) {
            continue;
          }
        }
      }
    }
    const paleSkin = new Set(['239,182,146', '230,170,128', '219,151,106', '201,141,102']);
    const uniformGold = new Set(['184,124,43', '132,88,31', '192,128,45', '113,76,29']);
    for (const [top, bottom] of [[35, 54], [72, 86]]) {
      for (let y = top; y <= bottom; y++) {
        for (let x = 54; x < 90; x++) {
          const offset = (y * info.width + x) * 4;
          assert.ok(
            !paleSkin.has(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`),
            `${relativePath} keeps exposed skin consistently dark`
          );
        }
      }
    }
    for (let y = 56; y <= 65; y++) {
      for (let x = 54; x < 90; x++) {
        const offset = (y * info.width + x) * 4;
        if (data[offset + 3] === 0) continue;
        assert.ok(
          !uniformGold.has(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`),
          `${relativePath} keeps the shoulder and upper chest black`
        );
      }
    }
    assert.equal(info.width, 144, relativePath);
    assert.equal(info.height, 144, relativePath);
    assert.equal(template.info.width, info.width, `${relativePath} template width`);
    assert.equal(template.info.height, info.height, `${relativePath} template height`);

    let top = info.height;
    let bottom = -1;
    let left = info.width;
    let right = -1;
    let visible = 0;
    let transparent = 0;
    let opaqueColors = new Set();
    let templateColors = new Set();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * 4;
        const alpha = data[offset + 3];
        const templateOffset = (y * template.info.width + x) * 4;
        const templateAlpha = template.data[templateOffset + 3];
        assert.ok(alpha === 0 || alpha === 255, `${relativePath} has crisp, non-antialiased edges`);
        assert.equal(alpha, templateAlpha, `${relativePath} preserves the approved frame silhouette`);
        if (alpha > 16) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
          visible++;
          opaqueColors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
          templateColors.add(`${template.data[templateOffset]},${template.data[templateOffset + 1]},${template.data[templateOffset + 2]}`);
        }
        if (alpha === 0) transparent++;
      }
    }
    assert.deepEqual(
      [left, top, right, bottom],
      alphaBounds(template.data, template.info.width, template.info.height),
      `${relativePath} matches the approved sprite bounds`
    );
    assert.ok(opaqueColors.size <= templateColors.size + 16, `${relativePath} stays close to the approved palette size`);
    assert.ok(visible > 500, `${relativePath} contains visible art`);
    assert.ok(transparent > 18000, `${relativePath} preserves transparent padding`);
    uniqueFrames.add(Buffer.from(data).toString('base64'));
  }

  const animationTracks = [
    ...directions.map(direction => [`theseus_science_officer.walk.${direction}`, 6]),
    ...['south', 'east', 'north', 'west'].map(direction => [`theseus_science_officer.sit.${direction}`, 1]),
    ['theseus_science_officer.type.north', 4]
  ];
  const bodyGold = new Set(['184,124,43', '132,88,31', '113,76,29']);
  const originalWarmUniform = new Set([
    '117,23,50', '54,6,19', '95,6,35', '73,11,35', '61,41,47',
    '80,9,31', '108,67,32', '79,39,17', '58,28,35'
  ]);
  for (const [track, frameCount] of animationTracks) {
    const frames = manifest[track];
    assert.equal(frames?.length, frameCount, `${track} frame count`);
    assert.deepEqual(websiteManifest[track], frames, `${track} website manifest parity`);
    for (const relativePath of frames) {
      const file = path.join(frontend, 'assets', 'sprites', relativePath);
      const websiteFile = path.join(website, 'assets', 'sprites', relativePath);
      const sourceFile = path.join(templateDir, path.basename(relativePath));
      const headFile = path.join(
        frontend,
        'assets',
        'sprites',
        'theseus_science_officer',
        `rot_${track.endsWith('.type.north') ? 'north' : track.split('.').at(-1)}.png`
      );
      const bytes = fs.readFileSync(file);
      assert.ok(bytes.equals(fs.readFileSync(websiteFile)), `${relativePath} website parity`);
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const source = await sharp(sourceFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const head = await sharp(headFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 144, `${relativePath} width`);
      assert.equal(info.height, 144, `${relativePath} height`);
      assert.equal(source.info.width, info.width, `${relativePath} source width`);
      assert.equal(source.info.height, info.height, `${relativePath} source height`);
      let goldPixels = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const offset = (y * info.width + x) * 4;
          const sourceAlpha = source.data[offset + 3];
          const alpha = data[offset + 3];
          assert.ok(alpha === 0 || alpha === 255, `${relativePath} has crisp alpha`);
          if (x >= 54 && x <= 89 && y >= 34 && y <= 53) {
            assert.ok(
              data.subarray(offset, offset + 4).equals(head.data.subarray(offset, offset + 4)),
              `${relativePath} retains its directional science officer head`
            );
          } else {
            assert.equal(alpha, sourceAlpha, `${relativePath} preserves its animation silhouette`);
          }
          if (alpha === 0) continue;
          const color = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
          if (y >= 79) {
            assert.ok(!bodyGold.has(color), `${relativePath} has black pants and boots`);
          }
          if (y >= 64 && y <= 78 && bodyGold.has(color)) goldPixels++;
          if (y >= 54 && y <= 78) {
            assert.ok(!originalWarmUniform.has(color), `${relativePath} has no un recolored uniform pixels`);
          }
        }
      }
      assert.ok(goldPixels > 0, `${relativePath} retains gold jacket or sleeve pixels`);
    }
  }

  assert.equal(uniqueFrames.size, directions.length, 'all eight rotations are distinct');
  console.log('Chief Science Officer: eight rotations and all 56 animation frames passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
