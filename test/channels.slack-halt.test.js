'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeSlackHalt } = require('../sidecar/channels/slack-halt.js');

const files = new Map(), file = path.join('workspace', 'slack.halt.json');
const fs = {
  readFileSync(name) {
    if (!files.has(name)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return files.get(name);
  }
};
let failWrite = false;
const writeDurable = (_, name, value) => {
  if (failWrite) throw new Error('disk unavailable');
  files.set(name, value);
};
const errors = [];
const create = initiallyHalted => makeSlackHalt({
  fs, path, workspace: 'workspace', writeDurable, initiallyHalted, onError: e => errors.push(e.message)
});

let gate = create(false);
assert.equal(gate.halted(), false);
gate.halt();
assert.equal(create(false).halted(), true, 'halt survives restart');
assert.equal(create(true).halted(), true, 'legacy halted state also blocks Slack');
failWrite = true;
assert.throws(() => gate.resume(), /disk unavailable/);
assert.equal(gate.halted(), true, 'failed resume cannot release the live gate');
failWrite = false;
gate.resume();
assert.equal(create(false).halted(), false, 'explicitly persisted resume survives restart');
assert.equal(create(true).halted(), true, 'another active halt overrides a previously resumed Slack gate');
failWrite = true;
assert.throws(() => gate.halt(), /disk unavailable/);
assert.equal(gate.halted(), true, 'failed halt persistence still blocks this process');
failWrite = false;
files.set(file, '{corrupt');
gate = create(false);
assert.equal(gate.halted(), true, 'corrupt state fails closed');
assert.ok(errors.length, 'corrupt state is reported');
gate.resume();
assert.equal(create(false).halted(), false, 'explicit resume can repair a corrupt state');
console.log('PASS Slack halt: persistence, failure, legacy halt and explicit resume');
