'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeCrewDispatchPrototype } = require('../sidecar/crew-dispatch-prototype.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-dispatch-prototype-'));
const file = path.join(dir, 'queue.json');
const roster = new Set(['bridge-comms', 'tactical', 'ops']);
const approval = {};
const create = () => makeCrewDispatchPrototype({
  fs, path, file, roster,
  authorize: (authority, batch) => authority === approval && batch.sender === 'bridge-comms'
});
const report = { requestId: 'report-1', sender: 'bridge-comms', recipients: ['tactical', 'ops'], message: 'Update' };

try {
  const queue = create();
  const stale = create();
  assert.equal(queue.status().paused, true);
  assert.equal(queue.resume, undefined);
  assert.equal(queue.run, undefined);
  assert.throws(() => queue.stage(report, {}), /authorization/);
  assert.throws(() => queue.stage({ ...report, sender: 'tactical' }, approval), /Invalid/);
  assert.throws(() => queue.stage({ ...report, recipients: ['unknown'] }, approval), /Invalid/);
  assert.equal(queue.stage(report, approval).batches.length, 1);
  assert.throws(() => stale.stage({ ...report, requestId: 'stale' }, approval), /locked/);
  assert.equal(queue.stage(report, approval).batches.length, 1);
  assert.throws(() => queue.stage({ ...report, message: 'Different' }, approval), /different report/);
  assert.throws(() => queue.stage({ ...report, requestId: 'report-2' }, approval), /already staged/);
  assert.deepEqual(create().status().batches, [report]);
  queue.stage({ ...report, requestId: 'report-2', message: 'Other' }, approval);
  fs.writeFileSync(file, '{corrupt');
  const recovered = create();
  assert.match(recovered.status().storageFault, /stale/);
  assert.throws(() => recovered.stage({ ...report, requestId: 'report-3' }, approval), /locked/);
  assert.equal(recovered.status().paused, true);
  fs.writeFileSync(file, JSON.stringify({ version: 1, value: { batches: [{ requestId: 'bad' }] } }));
  assert.throws(create, /storage unavailable: invalid/);

  const blockedFile = path.join(dir, 'blocked');
  const failingFs = { ...fs, renameSync() { throw new Error('injected write failure'); } };
  const blocked = makeCrewDispatchPrototype({ fs: failingFs, path, file: blockedFile, roster, authorize: () => true });
  assert.throws(() => blocked.stage(report, approval));
  assert.match(blocked.status().storageFault, /could not be confirmed/);
  assert.throws(() => blocked.stage(report, approval), /locked/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('crew-dispatch prototype tests passed');
