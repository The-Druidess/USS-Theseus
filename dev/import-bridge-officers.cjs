'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const profiles = [
  { archive: 'Chief_of_Security', skin: 'chief_of_security', set: 'theseus_bridge_security_v1' },
  { archive: 'Chief_Medical_Officer', skin: 'chief_medical_officer', set: 'theseus_bridge_medical_v1' },
  { archive: 'First_Officer', skin: 'first_officer', set: 'theseus_bridge_first_v1' },
  { archive: 'Chief_Science_Officer', skin: 'chief_science_officer', set: 'theseus_bridge_science_v2' }
];
const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  const [extractedRoot, zipRoot] = process.argv.slice(2);
  if (!extractedRoot || !zipRoot) throw Error('Usage: node dev/import-bridge-officers.cjs <extracted-root> <zip-directory>');
  const manifests = new Map(['frontend', 'website/app'].map(root => [root,
    JSON.parse(fs.readFileSync(root + '/assets/sprites/manifest.json', 'utf8'))]));
  const archiveRoot = 'docs/character-remaster/bridge-officers';
  const records = [];
  for (const profile of profiles) {
    const extracted = path.join(extractedRoot, profile.archive);
    const sourceRoot = archiveRoot + '/' + profile.skin;
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.cpSync(extracted, sourceRoot, { recursive: true });
    const zipBytes = fs.readFileSync(path.join(zipRoot, profile.archive + '.zip'));
    fs.writeFileSync(sourceRoot + '/' + profile.archive + '.zip', zipBytes);
    const metadata = JSON.parse(fs.readFileSync(sourceRoot + '/metadata.json', 'utf8'));
    const idle = metadata.states.find(state => /^idle$/i.test(state.character.name));
    const seated = metadata.states.find(state => /^seated$/i.test(state.character.name));
    if (!idle || !seated) throw Error('Missing standing/seated source: ' + profile.skin);
    const walks = {};
    for (const [animation, tracks] of Object.entries(idle.frames.animations || {})) {
      if (/^walk/i.test(animation)) Object.assign(walks, tracks);
    }
    const typing = {};
    for (const tracks of Object.values(seated.frames.animations || {})) Object.assign(typing, tracks);
    const tracks = {};
    for (const direction of directions) {
      if (!idle.frames.rotations[direction] || !seated.frames.rotations[direction] || walks[direction]?.length !== 6) {
        throw Error('Incomplete source direction: ' + profile.skin + '/' + direction);
      }
      tracks['rot.' + direction] = [idle.frames.rotations[direction]];
      tracks['walk.' + direction] = walks[direction];
      tracks['sit.' + direction] = [seated.frames.rotations[direction]];
      if (typing[direction]?.length) tracks['type.' + direction] = typing[direction];
    }
    for (const manifest of manifests.values()) {
      for (const key of Object.keys(manifest.sprites)) if (key.startsWith(profile.set + '.')) delete manifest.sprites[key];
    }
    let standingHeight = 0;
    for (const [track, sources] of Object.entries(tracks)) {
      const outputPaths = [];
      for (const [index, sourcePath] of sources.entries()) {
        const source = sourceRoot + '/' + sourcePath;
        const bytes = fs.readFileSync(source), sha256 = hash(bytes);
        const relative = profile.set + '/' + track.replaceAll('.', '_') + '_' + index + '-' + sha256.slice(0, 12) + '.png';
        const image = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (image.info.width !== 144 || image.info.height !== 144) throw Error('Unexpected sprite canvas: ' + source);
        if (track === 'rot.south') {
          let top = image.info.height, bottom = -1;
          for (let row = 0; row < image.info.height; row++) for (let column = 0; column < image.info.width; column++) {
            if (image.data[(row * image.info.width + column) * 4 + 3] <= 16) continue;
            top = Math.min(top, row); bottom = Math.max(bottom, row);
          }
          standingHeight = bottom - top + 1;
        }
        for (const root of manifests.keys()) {
          const output = root + '/assets/sprites/' + relative;
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, bytes);
        }
        outputPaths.push(relative);
        records.push({ skin: profile.skin, set: profile.set, track, index, source, output: 'frontend/assets/sprites/' + relative,
          sha256, width: image.info.width, height: image.info.height, archiveSha256: hash(zipBytes) });
      }
      for (const manifest of manifests.values()) manifest.sprites[profile.set + '.' + track] = outputPaths;
    }
    console.log(profile.skin + ': ' + Object.keys(tracks).length + ' tracks, standing height ' + standingHeight + ', source ZIP and frames archived');
  }
  for (const [root, manifest] of manifests) fs.writeFileSync(root + '/assets/sprites/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(archiveRoot + '/exports.json', JSON.stringify({ version: 1, records }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });