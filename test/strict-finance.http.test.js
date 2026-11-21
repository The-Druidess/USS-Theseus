'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { enable } = require('../scripts/enable-strict-finance.cjs');

(async () => {
  let paidCalls = 0;
  const paid = http.createServer((_req, res) => { paidCalls++; res.end('{}'); });
  await new Promise(resolve => paid.listen(0, '127.0.0.1', resolve));
  const paidBase = 'http://127.0.0.1:' + paid.address().port + '/v1';
  const f = SidecarFixture.create({
    entry: path.resolve(__dirname, 'helpers', 'strict-finance-host.cjs'),
    env: { STARNET_LIVE_PRICES: '0', STARNET_AUX_BUDGET: '0', STARNET_DEFAULT_MODEL: 'qwen3.5:4b',
      STARNET_DEFAULT_PROVIDER: 'ollama', STARNET_OLLAMA_BASE: 'http://127.0.0.1:11434/v1' },
  });
  const policyFile = path.join(f.workspace, 'strict-finance.json');
  const callsFile = path.join(f.workspace, 'inference-calls.jsonl');
  const calls = () => fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const run = body => f.json('POST', '/api/run', {
    agentId: 'finance-test', isTask: false, approval: 'full', provider: 'ollama',
    model: 'qwen3.5:4b', baseUrl: 'http://127.0.0.1:11434/v1',
    messages: [{ role: 'user', content: 'Say one short sentence. No tools.' }], ...body,
  }, { signal: AbortSignal.timeout(20000) });
  try {
    enable(f.workspace, ['qwen3.5:4b']);
    await f.start();
    const status = await f.json('GET', '/api/finance/strict');
    assert.equal(status.status, 200);
    assert.equal(status.body.enabled, true);
    assert.equal(status.body.mode, 'local-only');
    assert.deepEqual(status.body.policy, { day: 50, week: 500, month: 1000, timezone: 'America/Phoenix' });
    assert.equal(status.body.positiveCostAdapters, 0);
    assert.equal(status.body.enforcement.state, 'GUARDING');
    assert.equal(status.body.enforcement.audit.durable, true);
    assert.equal((await f.json('GET', '/api/spotify/status')).status, 200);
    assert.equal((await f.json('POST', '/api/activity', {})).status, 200);
    const mission = await f.json('POST', '/api/quests/mint', {
      title: 'Security follow-up', desc: 'Review Q authentication.', agentId: 'security',
      kind: 'user', createdBy: 'Q', urgency: 'yellow', contract: { type: 'attest', key: '' }
    });
    assert.equal(mission.status, 200);
    assert.equal(mission.body.ok, true);
    let quests = (await f.json('GET', '/api/quests')).body.quests;
    assert.equal(quests.find(q => q.id === mission.body.id).urgency, 'yellow');
    const treasury = await f.json('POST', '/api/quests/mint', {
      title: 'Treasury follow-up', agentId: 'treasurer', kind: 'user',
      createdBy: 'Q', urgency: 'red', contract: { type: 'attest', key: '' }
    });
    assert.equal(treasury.status, 200);
    assert.equal(treasury.body.ok, true);
    assert.equal((await f.json('POST', '/api/quests/update', { id: mission.body.id, op: 'attest' })).status, 423);
    assert.equal(calls().length, 0, 'creating a mission does not start inference');
    assert.throws(() => enable(f.workspace, ['other:latest']), /ownership is busy/, 'cannot activate/change policy under a live sidecar');
    assert.match((await run({})).text, /Local finance check complete/);
    const before = calls().length;
    assert(before > 0, 'approved local inference actually reached its adapter');
    for (const body of [
      { provider: 'openrouter', model: 'paid/test', key: 'fixture-key', baseUrl: paidBase },
      { provider: 'ollama', model: 'remote:cloud' },
      { provider: 'ollama', model: 'other:latest' },
      { provider: 'ollama', baseUrl: paidBase },
    ]) assert.match((await run(body)).text, /Strict finance/, JSON.stringify(body));
    assert.equal(paidCalls, 0, 'primary/cloud/custom-base runs never reached the upstream');
    assert.equal(calls().length, before, 'unapproved local model did not reach Ollama');
    for (const route of ['/api/tts', '/api/plugins', '/api/browser/view/click', '/api/connectors/test/connect', '/api/budget/resume']) {
      const denied = await f.json('POST', route, {});
      assert.equal(denied.status, 423, route);
      assert.equal(denied.body.code, 'strict_finance_blocked');
    }
    await f.json('POST', '/api/budget/caps', { perRun: 0, perAgent: 0, perDay: 0, global: 0 });
    assert.match((await run({ provider: 'openrouter', model: 'paid/test', key: 'fixture-key', baseUrl: paidBase })).text, /Strict finance/);
    assert.equal(paidCalls, 0, 'zero/unlimited legacy caps cannot bypass strict finance');
    const budget = (await f.json('GET', '/api/budget/status')).body;
    assert.equal(budget.strictFinance.enabled, true);
    assert.equal(budget.strictFinance.reservations.usd, 0);
    const recorded = budget.strictFinance.enforcement.audit;
    assert(recorded.counts.allowed > 0 && recorded.counts.blocked > 0, 'actual admissions and refusals reach the durable audit');
    await f.restart();
    const restarted = (await f.json('GET', '/api/finance/strict')).body;
    quests = (await f.json('GET', '/api/quests')).body.quests;
    assert.equal(quests.find(q => q.id === mission.body.id).urgency, 'yellow', 'mission and urgency survive restart');
    assert.equal(quests.find(q => q.id === treasury.body.id).urgency, 'red', 'red urgency survives restart');
    assert.equal(restarted.enabled, true, 'policy survives restart');
    assert(restarted.enforcement.audit.counts.allowed >= recorded.counts.allowed);
    assert(restarted.enforcement.audit.counts.blocked >= recorded.counts.blocked, 'restart cannot erase blocked decisions');
    await f.stop();
    fs.writeFileSync(policyFile, '{corrupt');
    await f.start();
    const broken = (await f.json('GET', '/api/finance/strict')).body;
    assert.equal(broken.enabled, true);
    assert(broken.error);
    assert.deepEqual(broken.localModels, []);
    assert.match((await run({})).text, /Strict finance/);
    assert.equal(paidCalls, 0, 'invalid policy never fails open');
    await f.stop();
    fs.writeFileSync(policyFile, 'null');
    await f.start();
    assert.equal((await f.json('GET', '/api/finance/strict')).body.enabled, true, 'JSON null is invalid, not an absent policy');
    console.log('strict-finance HTTP: durable activation, local COMMS, cloud/custom model refusal, API locks, legacy-cap independence and fail-closed restart PASS');
  } finally {
    await f.dispose();
    await new Promise(resolve => paid.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
