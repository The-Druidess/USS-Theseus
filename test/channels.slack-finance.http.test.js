'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { enable } = require('../scripts/enable-strict-finance.cjs');

(async () => {
  const host = SidecarFixture.create({
    entry: path.resolve(__dirname, 'helpers', 'slack-finance-host.cjs'),
    env: { STARNET_LIVE_PRICES: '0', STARNET_AUX_BUDGET: '0' }
  });
  const callsFile = path.join(host.workspace, 'slack-test-calls.jsonl');
  const calls = () => fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const connect = () => host.json('POST', '/api/channels/slack/connect', {
    token: 'xoxb-fake xapp-fake', provider: 'ollama', model: 'qwen3.5:4b'
  });
  try {
    enable(host.workspace, ['qwen3.5:4b']);
    await host.start();
    assert.equal((await connect()).status, 423);
    assert.deepEqual(calls(), []);
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: true, confirm: true })).status, 200);
    assert.equal((await host.json('GET', '/api/finance/strict')).body.slackException, true);
    assert.equal((await connect()).status, 200);
    for (let i = 0; i < 80 && !calls().some(call => call.socket); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(calls().some(call => call.url === 'https://slack.com/api/apps.connections.open' && call.redirect === 'manual'));
    assert.ok(calls().some(call => call.socket === 'wss-primary.slack.com'));
    assert.equal((await host.json('POST', '/api/halt', {})).status, 200);
    assert.equal((await connect()).status, 409);
    await host.restart();
    assert.equal((await connect()).status, 409, 'restart retains the E-STOP gate');
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: false, confirm: true })).status, 200);
    assert.equal((await host.json('GET', '/api/finance/strict')).body.slackException, false);
    fs.writeFileSync(path.join(host.workspace, 'slack-finance-authorization.json'), '{invalid');
    assert.equal((await connect()).status, 423, 'corrupt authorization cannot admit a connection');
    assert.ok((await host.json('GET', '/api/channels/status')).body.slack.financeAuthorizationError);
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: false, confirm: true })).status, 200,
      'revocation remains available with a damaged authorization');
    console.log('PASS Slack finance: scoped fake transport, persisted authorization and E-STOP');
  } finally { await host.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
