'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { fit } = require('../../frontend/app/propremaster.js');

const chairs = [
  { id: 'red_cushion_chair', archive: 'Red_Cushion_Chair' },
  { id: 'red_captains_chair', archive: 'Red_Captain_s_Chair' },
  { id: 'simple_red_cushion_chair', archive: 'Simple_Red_Cushion_Chair' }
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

(async () => {
  const [extracted, downloads, profile = 'chairs'] = process.argv.slice(2);
  if (!extracted || !downloads) throw Error('Usage: node dev/industrial-textures/import-red-chairs.cjs <extracted-root> <zip-directory> [chairs|desk]');
  const items = profile === 'chairs' ? chairs : profile === 'desk' ? [{
    id: 'furniture_desk', archive: 'Futuristic_desk', sourceRoot: extracted,
    destination: 'docs/station-remaster/projection-correction/futuristic-desk-source',
    footprint: { w: 2, h: 1 }, sideFootprint: { w: 1, h: 2 },
    bounds: { x: -1, y: -7, width: 26, height: 19 }, sideBounds: { x: -1, y: -5, width: 14, height: 29 }
  }] : null;
  if (!items) throw Error('Unknown furniture import profile: ' + profile);
  const receiptPath = 'docs/station-remaster/projection-correction/exports.json';
  const receipt = json(receiptPath);
  receipt.records = receipt.records.filter(record => !items.some(item => item.id === record.id));
  const manifests = new Map();
  for (const root of ['frontend/assets/industrial', 'website/app/assets/industrial']) {
    for (const pack of ['projection-correction', 'approved-sheet']) {
      const directory = root + '/' + pack;
      manifests.set(directory, json(directory + '/manifest.json'));
    }
  }
  for (const item of items) {
    const destination = item.destination || 'docs/station-remaster/projection-correction/furniture-red-chairs-source/' + item.id;
    const sourceRoot = item.sourceRoot || path.join(extracted, item.archive);
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(path.join(sourceRoot, item.archive, 'rotations'), destination + '/rotations', { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, 'metadata.json'), destination + '/metadata.json');
    fs.copyFileSync(path.join(downloads, item.archive + '.zip'), destination + '/' + item.archive + '.zip');
    const views = {};
    for (const [view, direction] of Object.entries({ s: 'south', w: 'west', n: 'north', e: 'east' })) {
      const source = destination + '/rotations/' + direction + '.png';
      const sourceBytes = fs.readFileSync(source);
      const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let left = info.width, top = info.height, right = -1, bottom = -1;
      for (let row = 0; row < info.height; row++) for (let column = 0; column < info.width; column++) {
        if (!data[(row * info.width + column) * 4 + 3]) continue;
        left = Math.min(left, column); top = Math.min(top, row);
        right = Math.max(right, column); bottom = Math.max(bottom, row);
      }
      if (right < left) throw Error('Empty reference: ' + source);
      const sourceCrop = { left, top, width: right - left + 1, height: bottom - top + 1 };
      const pixelScale = 6;
      const sourceWidth = sourceCrop.width * pixelScale, sourceHeight = sourceCrop.height * pixelScale;
      const outputBytes = await sharp(sourceBytes).extract(sourceCrop)
        .resize(sourceWidth, sourceHeight, { kernel: sharp.kernel.nearest }).png().toBuffer();
      const outputSha256 = hash(outputBytes);
      const image = item.id + '-' + view + '-' + outputSha256.slice(0, 12) + '.png';
      const side = view === 'w' || view === 'e';
      const spec = {
        image, sourceWidth, sourceHeight, footprint: (side && item.sideFootprint) || item.footprint || { w: 1, h: 1 },
        bounds: (side && item.sideBounds) || item.bounds || { x: 0, y: -5, width: 12, height: 17 }, mode: 'approved', exposure: 1,
        contact: { x: .5, y: 1 }, effects: false
      };
      views[view] = spec;
      for (const directory of manifests.keys()) fs.writeFileSync(directory + '/' + image, outputBytes);
      const raw = await sharp(outputBytes).ensureAlpha().raw().toBuffer();
      const alphaCounts = { transparent: 0, partial: 0, opaque: 0 };
      for (let offset = 3; offset < raw.length; offset += 4) {
        const alpha = raw[offset];
        alphaCounts[alpha === 0 ? 'transparent' : alpha === 255 ? 'opaque' : 'partial']++;
      }
      const output = 'frontend/assets/industrial/projection-correction/' + image;
      receipt.records.push({
        id: item.id, view, image: output, sourceWidth, sourceHeight,
        bounds: spec.bounds, footprint: spec.footprint, contact: spec.contact,
        fit: fit(spec.bounds, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, spec.contact, sourceHeight),
        source, sourceSha256: hash(sourceBytes), pixelScale, sourceCrop, outputSha256,
        alphaBounds: { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, alphaCounts,
        liveAccepted: false, group: 'furniture', output, retained: alphaCounts.partial + alphaCounts.opaque
      });
    }
    for (const manifest of manifests.values()) manifest.props[item.id] = { views };
    console.log(item.id + ': four views, source ZIP and eight rotations archived');
  }
  for (const [directory, manifest] of manifests) save(directory + '/manifest.json', manifest);
  save(receiptPath, receipt);
  const coveragePath = 'docs/station-remaster/projection-correction/coverage.json';
  const coverage = json(coveragePath);
  coverage.totalProps = Object.keys(manifests.values().next().value.props).length;
  coverage.revisedViewCount = receipt.records.length;
  coverage.revisedProps = [...new Set(receipt.records.map(record => record.id))].sort();
  save(coveragePath, coverage);
})().catch(error => { console.error(error); process.exitCode = 1; });