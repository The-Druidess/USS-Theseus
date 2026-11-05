'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const QTerminalStore = require('../frontend/app/qterminal.js');

const root = path.join(__dirname, '..');
const source = path.join(root, 'docs', 'character-remaster', 'quark-source');
const runtime = path.join(root, 'frontend', 'assets', 'sprites', 'theseus_quark_review');
const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const cardinal = ['south', 'east', 'north', 'west'];

async function main() {
  const catalogContext = {};
  const vm = require('node:vm');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend', 'app', 'data-shim.js'), 'utf8') +
    '\nglobalThis.result = { quark: DATA.SKINS.quark, ids: DATA.skinIds() };', catalogContext);
  const catalog = JSON.parse(JSON.stringify(catalogContext.result));
  assert.equal(catalog.quark.set, 'theseus_quark_review',
    'the existing Quark/Treasurer appearance uses the in-world review sprite');
  assert.ok(catalog.ids.includes('quark'), 'the existing Quark appearance remains available');
  assert.ok(!catalog.ids.includes('theseus_quark_review'),
    'the review sprite set is not exposed as a new appearance-picker choice');
  assert.ok(fs.existsSync(path.join(source, 'metadata.json')),
    'the supplied source export remains available for a later appearance option');

  const appSource = fs.readFileSync(path.join(root, 'frontend', 'app', 'app.js'), 'utf8');
  const helperSource = appSource.match(/function isTreasurerAgent\(a\) \{[\s\S]*?\n  \}/)[0];
  const restoreSource = appSource.match(/function rehydrateRoster\(savedAgents\) \{[\s\S]*?\n  \}/)[0];
  const isTreasurerAgent = new Function('QTerminalStore', helperSource + '\nreturn isTreasurerAgent;')(QTerminalStore);
  const agents = new Map();
  new Function('agents', 'agent', 'DATA', 'executionProfileOf', 'agentDocs', 'composeSystemPrompt',
    'registerAgent', 'isTreasurerAgent', restoreSource +
    '; rehydrateRoster(' + JSON.stringify([
      { id: 'quark-agent', name: 'QUARK', skin: 'blank' },
      { id: 'other-agent', name: 'WORF', skin: 'approved_worf' }
    ]) + ');')(
    agents, null, { DEFAULT_SKIN: 'blank' }, () => 'local', () => {}, () => '', () => {}, isTreasurerAgent);
  assert.equal(agents.get('quark-agent').skin, 'quark',
    'rehydration applies the preview to the actual Treasurer identity even if its saved skin was different');
  assert.equal(agents.get('other-agent').skin, 'approved_worf',
    'the preview does not change other crew members');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'assets', 'sprites', 'manifest.json'), 'utf8'));
  const tracks = Object.fromEntries(Object.entries(manifest.sprites)
    .filter(([key]) => key.startsWith('theseus_quark_review.')));
  assert.equal(Object.keys(tracks).length, 21, 'all expected standing, walking, seated and typing tracks are registered');
  assert.equal(Object.values(tracks).flat().length, 64, 'the runtime set contains 64 frames');
  for (const direction of directions) {
    assert.equal(tracks[`theseus_quark_review.rot.${direction}`].length, 1, `${direction} standing pose`);
    assert.equal(tracks[`theseus_quark_review.walk.${direction}`].length, 6, `${direction} walk cycle`);
  }
  for (const direction of cardinal) {
    assert.equal(tracks[`theseus_quark_review.sit.${direction}`].length, 1, `${direction} seated pose`);
  }
  assert.equal(tracks['theseus_quark_review.type.north'].length, 4, 'four typing frames');

  for (const files of Object.values(tracks)) {
    for (const file of files) {
      const sourceFile = path.join(root, 'frontend', 'assets', 'sprites', file);
      const mirroredFile = path.join(root, 'website', 'app', 'assets', 'sprites', file);
      const info = await sharp(sourceFile).metadata();
      assert.equal(info.width, 144, `${file} width`);
      assert.equal(info.height, 144, `${file} height`);
      assert.deepEqual(fs.readFileSync(sourceFile), fs.readFileSync(mirroredFile),
        `${file} is mirrored to the website app`);
    }
  }
  console.log('treasurer sprite preview: in-world Quark skin, complete mirrored runtime set, picker unchanged.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
