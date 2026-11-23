'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeCrewMessageTool } = require('../sidecar/tools/builtin/crew-message.js');
const { makeCrewDispatchQueue } = require('../sidecar/crew-dispatch-queue.js');
const { makeRegistry, attachFinancialGuard } = require('../sidecar/tools/registry.js');
const { makeStrictFinance, POLICY } = require('../sidecar/strict-finance.js');

async function main() {
  const roster = new Set(['comms', 'ops']);
  const staged = [];
  const queue = { stage(batch, authority) {
    assert.equal(batch.sender, authority.agentId);
    staged.push(batch);
  } };
  const registry = makeRegistry();
  makeCrewMessageTool({ queue, roster, newId: () => 'request-1' }).register(registry);
  const call = { id: 'tool-call', name: 'crew.message',
    args: { recipient: 'comms', message: 'Status?', sender: 'comms' } };
  const base = { agentId: 'ops', canUse: () => ({ ok: true }) };
  let result = await registry.dispatch(call, { ...base, consent: async () => ({ allow: false }) });
  assert.equal(result.isError, true);
  assert.equal(staged.length, 0);
  result = await registry.dispatch(call, base);
  assert.equal(result.isError, true);
  assert.match(result.content, /consent broker unavailable/);
  result = await registry.dispatch(call, { ...base, agentId: 'unknown', consent: async () => ({ allow: true }) });
  assert.equal(result.isError, true);
  assert.equal(staged.length, 0);
  result = await registry.dispatch(call, { ...base, consent: async () => ({ allow: true }) });
  assert.equal(result.isError, false);
  assert.match(result.content, /queued.*not yet confirmed/i);
  assert.deepEqual(staged, [{ requestId: 'request-1', sender: 'ops', recipients: ['comms'], message: 'Status?' }]);
  result = await registry.dispatch(call, { ...base, consent: async () => ({ allow: true }),
    canUse: () => ({ ok: false, reason: 'not granted' }) });
  assert.equal(result.isError, true);
  assert.equal(staged.length, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-message-tool-'));
  try {
    let deliveryCalls = 0;
    const liveQueue = makeCrewDispatchQueue({ fs, path, file: path.join(dir, 'queue.json'), roster,
      authorizeStage: (authority, batch) => authority.agentId === batch.sender,
      authorizeDelivery: async () => false,
      authorizeResume: () => false,
      deliver: async () => { deliveryCalls++; },
      verifyReceipt: async () => false, halted: () => false, newId: () => 'run-1' });
    const liveRegistry = makeRegistry();
    makeCrewMessageTool({ queue: liveQueue, roster, newId: () => 'request-2' }).register(liveRegistry);
    const ctx = { ...base, consent: async () => ({ allow: true }) };
    const finance = makeStrictFinance({ read: () => ({ ...POLICY, version: 1, enabled: true,
      mode: 'local-only', localModels: ['qwen3.5:4b'] }), onError() {} });
    attachFinancialGuard((c, tool) => finance.assertTool(c, tool));
    try {
      result = await liveRegistry.dispatch(call, ctx);
      assert.equal(result.isError, true);
      assert.match(result.content, /Strict finance/);
      assert.equal(liveQueue.status().batches.length, 0);
    } finally { attachFinancialGuard(null); }
    for (const recipient of ['unknown', 'ops']) {
      result = await liveRegistry.dispatch({ ...call, args: { recipient, message: 'Status?' } }, ctx);
      assert.equal(result.isError, true);
      assert.equal(liveQueue.status().batches.length, 0);
    }
    result = await liveRegistry.dispatch(call, ctx);
    assert.equal(result.isError, false);
    assert.equal(liveQueue.status().batches[0].sender, 'ops');
    assert.equal(liveQueue.status().batches[0].recipients[0].state, 'pending');
    assert.equal(deliveryCalls, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('crew-message tool tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
