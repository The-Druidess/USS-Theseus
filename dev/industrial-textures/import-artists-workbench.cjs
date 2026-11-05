'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { fit } = require('../../frontend/app/propremaster.js');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

(async () => {
  const [extracted, archive, propId = 'pixelrig'] = process.argv.slice(2);
  if (!extracted || !archive) throw Error('Usage: node dev/industrial-textures/import-artists-workbench.cjs <extracted-directory> <original-zip> [pixelrig|bench|console|rack|rackV|laptop]');
  const profiles = {
    pixelrig: { folder: 'Artist_s_Workbench', destination: 'artist-workbench-source', group: 'utility' },
    bench: { folder: 'Workbench', destination: 'bench-workbench-source', group: 'command' },
    console: { folder: 'console', destination: 'computer-console-v2-source', archive: 'computer_console.zip', group: 'workstation' },
    rack: { folder: 'Server_rack_cube', destination: 'server-rack-cube-source', group: 'capability' },
    rackV: { folder: 'Server_rack_tall', destination: 'server-rack-tall-source', group: 'storage' },
    laptop: { folder: 'laptop', destination: 'laptop-source', group: 'workstation', spec: {
      footprint: { w: 1, h: 1 }, bounds: { x: 1, y: 1, width: 10, height: 11 },
      mode: 'approved', exposure: 1, screenPower: 'occupied', effects: false
    } }
  };
  const profile = Object.hasOwn(profiles, propId) && profiles[propId];
  if (!profile) throw Error('Unknown prop import profile: ' + propId);
  const destination = 'docs/station-remaster/projection-correction/' + profile.destination;
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(extracted, profile.folder, 'rotations'), destination + '/rotations', { recursive: true });
  fs.copyFileSync(path.join(extracted, 'metadata.json'), destination + '/metadata.json');
  fs.copyFileSync(archive, destination + '/' + (profile.archive || profile.folder + '.zip'));

  const source = destination + '/rotations/south.png';
  const sourceBytes = fs.readFileSync(source);
  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let row = 0; row < info.height; row++) for (let column = 0; column < info.width; column++) {
    if (!data[(row * info.width + column) * 4 + 3]) continue;
    left = Math.min(left, column); top = Math.min(top, row);
    right = Math.max(right, column); bottom = Math.max(bottom, row);
  }
  if (right < left) throw Error('Reference image is empty');
  const sourceCrop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const pixelScale = 6;
  const sourceWidth = sourceCrop.width * pixelScale, sourceHeight = sourceCrop.height * pixelScale;
  const outputBytes = await sharp(sourceBytes).extract(sourceCrop)
    .resize(sourceWidth, sourceHeight, { kernel: sharp.kernel.nearest }).png().toBuffer();
  const outputSha256 = hash(outputBytes);
  const image = propId + '-s-' + outputSha256.slice(0, 12) + '.png';
  const baseline = profile.spec || json('frontend/assets/industrial/projection-correction/manifest.json').props[propId].views.s;
  const spec = { ...baseline, image, sourceWidth, sourceHeight, contact: { x: .5, y: 1 } };
  for (const root of ['frontend/assets/industrial', 'website/app/assets/industrial']) {
    for (const pack of ['projection-correction', 'approved-sheet']) {
      const directory = root + '/' + pack;
      fs.writeFileSync(directory + '/' + image, outputBytes);
      const manifest = json(directory + '/manifest.json');
      if (!manifest.props[propId]) manifest.props[propId] = { views: {} };
      manifest.props[propId].views.s = spec;
      save(directory + '/manifest.json', manifest);
    }
  }
  const output = 'frontend/assets/industrial/projection-correction/' + image;
  const raw = await sharp(outputBytes).ensureAlpha().raw().toBuffer();
  const alphaCounts = { transparent: 0, partial: 0, opaque: 0 };
  for (let offset = 3; offset < raw.length; offset += 4) {
    const alpha = raw[offset];
    alphaCounts[alpha === 0 ? 'transparent' : alpha === 255 ? 'opaque' : 'partial']++;
  }
  const receiptPath = 'docs/station-remaster/projection-correction/exports.json';
  const receipt = json(receiptPath);
  const record = {
    id: propId, view: 's', image: output, sourceWidth, sourceHeight,
    bounds: spec.bounds, footprint: spec.footprint, contact: spec.contact,
    fit: fit(spec.bounds, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, spec.contact, sourceHeight),
    source, sourceSha256: hash(sourceBytes), pixelScale, sourceCrop, outputSha256,
    alphaBounds: { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, alphaCounts,
    liveAccepted: false, group: profile.group, output, retained: alphaCounts.partial + alphaCounts.opaque
  };
  const index = receipt.records.findIndex(entry => entry.id === propId && entry.view === 's');
  if (index < 0) receipt.records.push(record);
  else receipt.records[index] = record;
  save(receiptPath, receipt);
  const coveragePath = 'docs/station-remaster/projection-correction/coverage.json';
  const coverage = json(coveragePath);
  coverage.totalProps = Object.keys(json('frontend/assets/industrial/projection-correction/manifest.json').props).length;
  coverage.revisedViewCount = receipt.records.length;
  coverage.revisedProps = [...new Set(receipt.records.map(entry => entry.id))].sort();
  save(coveragePath, coverage);
  console.log({ image, sourceCrop, footprint: spec.footprint, bounds: spec.bounds, archived: destination });
})().catch(error => { console.error(error); process.exitCode = 1; });