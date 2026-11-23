'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeCrewDispatchQueue } = require('../sidecar/crew-dispatch-queue.js');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-dispatch-queue-'));
  const roster = new Set(['comms', 'ops', 'tactical']);
  const approval = {};
  const request = { requestId: 'message-1', sender: 'ops', recipients: ['comms', 'tactical'], message: 'Status?' };
  let serial = 0, stopped = false;
  const options = file => ({
    fs, path, file: path.join(dir, file), roster,
    authorizeStage: (authority, batch) => authority === approval && batch.sender === 'ops',
    authorizeDelivery: async () => true,
    authorizeResume: authority => authority === approval,
    deliver: async ({ runId }) => ({ id: 'receipt-' + runId, state: 'responded' }),
    verifyReceipt: async ({ runId }, receipt) => receipt.id === 'receipt-' + runId,
    halted: () => stopped, newId: () => 'run-' + (++serial)
  });
  try {
    {
      const opts = options('sequential.json');
      const calls = [];
      let release;
      opts.deliver = async (item, signal) => {
        calls.push(item.recipient);
        if (calls.length === 1) await new Promise(resolve => { release = resolve; });
        assert.equal(signal.aborted, false);
        return { id: 'receipt-' + item.runId, state: item.recipient === 'comms' ? 'acknowledged' : 'responded' };
      };
      const queue = makeCrewDispatchQueue(opts);
      assert.throws(() => queue.stage(request, {}), /authorization/);
      assert.throws(() => queue.stage({ ...request, recipients: ['unknown'] }, approval), /Invalid/);
      queue.stage(request, approval);
      const running = queue.run();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, ['comms']);
      assert.equal(queue.status().batches[0].recipients[0].state, 'running');
      await assert.rejects(queue.run(), /already running/);
      release();
      const result = await running;
      assert.equal(result.busy, false);
      assert.deepEqual(calls, ['comms', 'tactical']);
      assert.deepEqual(result.batches[0].recipients.map(r => r.state), ['acknowledged', 'responded']);
      assert.deepEqual(makeCrewDispatchQueue(opts).status().batches, result.batches);
      assert.equal(queue.stage(request, approval).batches.length, 1);
      assert.throws(() => queue.stage({ ...request, message: 'Different' }, approval), /different message/);
      assert.throws(() => queue.stage({ ...request, requestId: 'message-2' }, approval), /matching message/);
    }
    {
      const opts = options('authorization.json');
      let permitted = false, delivered = 0;
      opts.authorizeDelivery = async () => permitted;
      opts.deliver = async ({ runId }) => { delivered++; return { id: 'receipt-' + runId, state: 'responded' }; };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      await assert.rejects(queue.run(), /authorization or provider/);
      assert.equal(delivered, 0);
      assert.equal(queue.status().batches[0].recipients[0].state, 'pending');
      const recovered = makeCrewDispatchQueue(opts);
      await assert.rejects(recovered.run(), /authorization or provider/);
      assert.equal(delivered, 0, 'restart alone does not reauthorize delivery');
      permitted = true;
      await recovered.run();
      assert.equal(delivered, 2, 'proven pending recipients run after authorization is rechecked');
    }
    {
      const opts = options('receipt.json');
      opts.verifyReceipt = async () => false;
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      await assert.rejects(queue.run(), /receipt could not be verified/);
      assert.equal(queue.status().batches[0].recipients[0].state, 'uncertain');
      assert.equal(queue.status().batches[0].recipients[1].state, 'pending');
      await assert.rejects(queue.run(), /uncertain/);
      assert.equal(makeCrewDispatchQueue(opts).status().batches[0].recipients[0].state, 'uncertain');
    }
    {
      const opts = options('receipt-reuse.json');
      opts.deliver = async () => ({ id: 'same-receipt', state: 'acknowledged' });
      opts.verifyReceipt = async () => true;
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      await assert.rejects(queue.run(), /receipt could not be verified/);
      assert.deepEqual(queue.status().batches[0].recipients.map(r => r.state), ['acknowledged', 'uncertain']);
    }
    {
      const opts = options('stop-during-receipt.json');
      let entered, finish;
      const verifying = new Promise(resolve => { entered = resolve; });
      opts.verifyReceipt = async () => {
        entered();
        await new Promise(resolve => { finish = resolve; });
        return true;
      };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      const running = queue.run();
      await verifying;
      stopped = true;
      queue.stop();
      finish();
      await running;
      assert.equal(queue.status().batches[0].recipients[0].state, 'uncertain');
      stopped = false;
    }
    {
      const opts = options('estop.json');
      let started;
      const began = new Promise(resolve => { started = resolve; });
      opts.deliver = async (item, signal) => {
        started();
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        return { id: 'receipt-' + item.runId, state: 'acknowledged' };
      };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      const running = queue.run();
      await began;
      stopped = true;
      queue.stop();
      await running;
      const recipients = queue.status().batches[0].recipients;
      assert.deepEqual(recipients.map(r => r.state), ['uncertain', 'pending']);
      await assert.rejects(queue.run(), /halted/);
      assert.throws(() => queue.stage({ ...request, requestId: 'other' }, approval), /halted/);
      stopped = false;
      await assert.rejects(queue.run(), /halted/);
      assert.throws(() => queue.resume({}), /authorization/);
      queue.resume(approval);
      await assert.rejects(queue.run(), /uncertain/);
    }
    {
      const opts = options('preflight-stop.json');
      let entered, finish;
      const began = new Promise(resolve => { entered = resolve; });
      opts.authorizeDelivery = async (item, signal) => {
        entered(signal);
        await new Promise(resolve => { finish = resolve; });
        return true;
      };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      const running = queue.run();
      const signal = await began;
      stopped = true;
      queue.stop();
      assert.equal(signal.aborted, true);
      finish();
      await running;
      assert.equal(queue.status().batches[0].recipients[0].state, 'pending');
      stopped = false;
      assert.equal(queue.status().halted, true);
    }
    {
      const opts = options('restart.json');
      fs.writeFileSync(opts.file, JSON.stringify({ version: 1, value: { batches: [{
        requestId: 'message-1', sender: 'ops', message: 'Status?', recipients: [
          { agentId: 'comms', state: 'running', runId: 'old-run' }, { agentId: 'tactical', state: 'pending' }
        ]
      }] } }));
      const queue = makeCrewDispatchQueue(opts);
      assert.equal(queue.status().batches[0].recipients[0].state, 'uncertain');
      await assert.rejects(queue.run(), /uncertain/);
      assert.equal(makeCrewDispatchQueue(opts).status().batches[0].recipients[0].state, 'uncertain');
    }
    {
      const opts = options('stale.json');
      const first = makeCrewDispatchQueue(opts), stale = makeCrewDispatchQueue(opts);
      first.stage(request, approval);
      assert.throws(() => stale.stage({ ...request, requestId: 'other' }, approval), /locked/);
      first.stage({ ...request, requestId: 'other', message: 'Another' }, approval);
      fs.writeFileSync(opts.file, '{corrupt');
      const recovered = makeCrewDispatchQueue(opts);
      assert.match(recovered.status().storageFault, /stale/);
      await assert.rejects(recovered.run(), /locked/);
    }
    {
      const opts = options('write-failure.json');
      let fail = false, delivered = 0;
      opts.fs = { ...fs, renameSync(...args) { if (fail) throw new Error('injected write failure'); return fs.renameSync(...args); } };
      opts.deliver = async () => { delivered++; };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      fail = true;
      await assert.rejects(queue.run(), /injected write failure/);
      assert.equal(delivered, 0, 'unconfirmed start must never reach the runner');
      assert.match(queue.status().storageFault, /could not be confirmed/);
    }
    {
      const opts = options('receipt-write-failure.json');
      let fail = false, delivered = 0;
      opts.fs = { ...fs, renameSync(...args) { if (fail) throw new Error('injected receipt write failure'); return fs.renameSync(...args); } };
      opts.deliver = async ({ runId }) => {
        delivered++;
        fail = true;
        return { id: 'receipt-' + runId, state: 'responded' };
      };
      const queue = makeCrewDispatchQueue(opts);
      queue.stage(request, approval);
      await assert.rejects(queue.run(), /receipt write failure/);
      assert.equal(delivered, 1);
      assert.match(queue.status().storageFault, /could not be confirmed/);
      fail = false;
      const recovered = makeCrewDispatchQueue(opts);
      assert.deepEqual(recovered.status().batches[0].recipients.map(r => r.state), ['uncertain', 'pending']);
      await assert.rejects(recovered.run(), /uncertain/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('crew-dispatch queue tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
