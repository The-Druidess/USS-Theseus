'use strict';
const assert = require('node:assert/strict');
const { makeStrictFinance, POLICY, periodKeys, calendarTotals, validateConfig, CODE } = require('../sidecar/strict-finance.js');
const { makeRegistry, attachFinancialGuard } = require('../sidecar/tools/registry.js');
const { classifyApiError } = require('../sidecar/providers/errorClass.js');

const config = { ...POLICY, version: 1, enabled: true, mode: 'local-only', localModels: ['qwen3.5:4b'] };
const make = (read = () => config) => makeStrictFinance({ read, onError() {} });
const guard = make();
const denied = fn => assert.throws(fn, error => error.code === CODE);
const policyError = Object.assign(new Error('Strict finance: blocked'), { code: CODE });
const classification = classifyApiError(policyError);
assert.equal(classification.reason, CODE);
assert.equal(classification.retryable, false);
assert.equal(classification.shouldFallback, false);
assert.equal(classification.shouldRotateCredential, false);
assert.equal(guard.enabled(), true);
guard.assertProvider('ollama', 'http://127.0.0.1:11434/v1', { model: 'qwen3.5:4b' });
for (const provider of ['openrouter', 'anthropic', 'starnet', 'codex', 'claude-cli', 'custom']) {
  denied(() => guard.assertProvider(provider, '', { model: 'qwen3.5:4b' }));
}
for (const base of ['http://127.0.0.1:8787', 'https://cloud.example', 'http://127.0.0.1:11434@cloud.example']) {
  denied(() => guard.assertProvider('ollama', base, { model: 'qwen3.5:4b' }));
}
denied(() => guard.assertProvider('ollama', '', { model: 'qwen3:cloud' }));
denied(() => guard.assertProvider('ollama', '', { model: 'unapproved:latest' }));
denied(() => guard.assertProcess());
denied(() => guard.assertTool({ name: 'station.status', args: {} }, { provenance: 'connector' }));
const slackSendGuard = makeStrictFinance({
  read: () => config, onError() {},
  slackAuthorized: () => true,
  isSlackTarget: target => target === 'slack-chat'
});
slackSendGuard.assertTool({ name: 'channel.send', args: { target: 'slack-chat' } }, { provenance: 'host' });
denied(() => slackSendGuard.assertTool({ name: 'channel.send', args: { target: 'discord-chat' } }, { provenance: 'host' }));
denied(() => slackSendGuard.assertTool({ name: 'channel.send', args: { target: 'slack-chat' } }, { provenance: 'connector' }));
denied(() => guard.assertTool({ name: 'channel.send', args: { target: 'slack-chat' } }, { provenance: 'host' }));
const unapprovedSlack = makeStrictFinance({ read: () => config, onError() {}, isSlackTarget: () => true, slackAuthorized: () => false });
denied(() => unapprovedSlack.assertTool({ name: 'channel.send', args: { target: 'slack-chat' } }, { provenance: 'host' }));
const brokenSlackTarget = makeStrictFinance({ read: () => config, onError() {}, isSlackTarget: () => { throw new Error('unavailable'); }, slackAuthorized: () => true });
denied(() => brokenSlackTarget.assertTool({ name: 'channel.send', args: { target: 'slack-chat' } }, { provenance: 'host' }));
assert.throws(() => validateConfig({ ...config, localModels: ['qwen3:cloud'] }), /Invalid/);
assert.throws(() => validateConfig({ ...config, day: 0 }), /Invalid/);
assert.throws(() => validateConfig({ ...config, enabled: false }), /Invalid/);
const corrupt = make(() => { throw new Error('bad policy'); });
assert.equal(corrupt.enabled(), true);
denied(() => corrupt.assertProvider('ollama', '', { model: 'qwen3.5:4b' }));
for (const invalid of [null, false, {}, { ...config, enabled: false }]) {
  const invalidGuard = make(() => invalid);
  assert.equal(invalidGuard.enabled(), true, 'an existing but invalid policy is not an opt-out');
  denied(() => invalidGuard.assertProvider('ollama', '', { model: 'qwen3.5:4b' }));
}
const off = make(() => undefined);
assert.equal(off.enabled(), false);
off.assertProvider('anthropic', '', {});
off.assertProcess();
assert.equal(off.routeRefusal('POST', '/api/plugins/run'), null);
for (const url of ['/api/tts', '/api/realtime/session', '/api/plugins/run', '/api/connectors/call', '/api/budget/resume',
  '/api/local-voice/warm', '/api/desktop/input', '/api/browser/view/click', '/api/hooks/allow']) {
  assert.match(guard.routeRefusal('POST', url), /Strict finance/);
}
assert.match(guard.routeRefusal('POST', '/api/connectors'), /Strict finance/,
  'adding PixelLab must not bypass financial admission during connector initialization');
denied(() => guard.assertTool({ name: 'mcp.pixellab.create_character', args: {} }, { provenance: 'connector' }));
for (const url of ['/api/run', '/api/cancel', '/api/station/ack', '/api/save', '/api/budget/caps', '/api/halt']) {
  assert.equal(guard.routeRefusal('POST', url), null);
}
for (const url of ['/api/lifecycle/quit', '/api/subagents/interrupt']) {
  assert.equal(guard.routeRefusal('POST', url), null);
  assert.equal(corrupt.routeRefusal('POST', url), null, 'shutdown remains available with a corrupt finance policy');
}
for (const name of ['team.interrupt', 'terminal.interrupt', 'terminal.stop', 'shell.bg.kill']) {
  guard.assertTool({ name }, { provenance: 'host' });
  corrupt.assertTool({ name }, { provenance: 'host' });
  denied(() => guard.assertTool({ name }, { provenance: 'connector' }));
}
for (const args of [
  { action: 'channel.disconnect', args: { channel: 'slack' } },
  { setting: 'channel.disconnect', channel: 'slack', forget: false },
  { action: 'scheduler.set', args: '{"on":false}' },
  { action: 'estop.engage' },
  { action: 'spotify.disconnect' },
]) {
  guard.assertTool({ name: 'station.control', args }, { provenance: 'host' });
  corrupt.assertTool({ name: 'station.control', args }, { provenance: 'host' });
}
for (const args of [
  { action: 'channel.disconnect', args: { channel: 'slack', forget: true } },
  { action: 'channel.disconnect', channel: 'slack', forget: 'on' },
  { action: 'scheduler.set', args: { on: true } },
]) denied(() => guard.assertTool({ name: 'station.control', args }, { provenance: 'host' }));
for (const [name, action] of [['loop.manage', 'pause'], ['loop.manage', 'stop'], ['routine.manage', 'pause']]) {
  guard.assertTool({ name, args: { action } }, { provenance: 'host' });
  corrupt.assertTool({ name, args: { action } }, { provenance: 'host' });
  denied(() => guard.assertTool({ name, args: { action: 'resume' } }, { provenance: 'host' }));
}
assert.equal(guard.routeRefusal('POST', '/api/loops/control'), null);
for (const action of ['pause', 'stop']) {
  guard.assertLoopStop({ action });
  corrupt.assertLoopStop({ action });
}
for (const action of ['resume', 'unhalt', '', null]) denied(() => guard.assertLoopStop({ action }));
for (const g of [guard, corrupt]) {
  g.assertCronDisarm({ enabled: false });
  g.assertRoutinePause({ id: 'one', patch: { enabled: false } });
  g.assertChannelDisconnect({});
  g.assertRemoteStop({ on: false });
  denied(() => g.assertCronDisarm({ enabled: true }));
  denied(() => g.assertRoutinePause({ id: 'one', patch: { enabled: true } }));
  denied(() => g.assertRoutinePause({ id: 'one', patch: { enabled: false, prompt: 'change' } }));
  denied(() => g.assertChannelDisconnect({ purge: true }));
  denied(() => g.assertRemoteStop({ on: true }));
  assert.equal(g.routeRefusal('POST', '/api/connectors/oauth/cancel'), null);
  assert.equal(g.routeRefusal('POST', '/api/auth/claude-cli/cancel'), null);
  for (const url of ['/api/spotify/disconnect', '/api/browser/view/close', '/api/routing/steptest/test-id/stop']) {
    assert.equal(g.routeRefusal('POST', url), null);
  }
  assert.match(g.routeRefusal('POST', '/api/routing/steptest/test-id/continue'), /Strict finance/);
  for (const channel of ['telegram', 'discord', 'slack', 'matrix', 'signal']) {
    assert.equal(g.routeRefusal('POST', '/api/channels/' + channel + '/disconnect'), null);
    assert.match(g.routeRefusal('POST', '/api/channels/' + channel + '/connect'), /Strict finance/);
  }
  assert.equal(g.routeRefusal('POST', '/api/channels/telegram/bots/123/disconnect'), null);
}
assert.equal(guard.routeRefusal('GET', '/api/budget/status'), null);
assert.equal(guard.routeRefusal('GET', '/api/spotify/status'), null, 'local token-presence status does not refresh or contact Spotify');
assert.equal(guard.routeRefusal('POST', '/api/activity'), null, 'watching the station must still count as human presence');
assert.equal(guard.routeRefusal('POST', '/api/autonomy/posture'), null, 'the handler checks the stand-down body');
const posture = { v: 1, initiative: 'leash', reach: 'sandbox', leashPerDay: 3 };
const wait = { posture: { ...posture, initiative: 'wait' }, resumeHalt: false };
guard.assertAutonomyStandDown(wait, posture, true);
guard.assertAutonomyStandDown({ posture: { ...wait.posture, reach: 'observe', leashPerDay: 2 } }, posture, true);
guard.assertAutonomyStandDown({ ...wait, resumeHalt: true }, posture, false);
for (const body of [
  { ...wait, resumeHalt: true },
  { posture: { ...posture, initiative: 'free' } },
  { posture: { ...wait.posture, reach: 'reach' } },
  { posture: { ...wait.posture, leashPerDay: 4 } },
  { posture: { ...wait.posture, reach: 'bogus' } },
  { ...wait, beliefs: {} }, { posture: { initiative: 'wait' } }, { ...wait, resumeHalt: 'false' }
]) denied(() => guard.assertAutonomyStandDown(body, posture, true));
corrupt.assertAutonomyStandDown(wait, posture, true);
off.assertAutonomyStandDown({}, posture, true);
assert.equal(guard.routeRefusal('POST', '/api/quests/mint'), null, 'local quest creation is admitted');
assert.equal(guard.routeRefusal('POST', '/api/quests/notes'), null, 'local quest notes are admitted');
assert.equal(guard.routeRefusal('POST', '/api/finance/directive'), null, 'explicit local finance directive activation is admitted');
assert.match(guard.routeRefusal('PUT', '/api/quests/notes'), /Strict finance/);
assert.match(corrupt.routeRefusal('POST', '/api/quests/notes'), /policy storage/);
assert.match(guard.routeRefusal('PUT', '/api/quests/mint'), /Strict finance/);
assert.match(guard.routeRefusal('POST', '/api/quests/update'), /Strict finance/);
assert.match(corrupt.routeRefusal('POST', '/api/quests/mint'), /policy storage/);
assert.match(corrupt.routeRefusal('POST', '/api/finance/directive'), /policy storage/);
const noAudit = makeStrictFinance({ read: () => config, onError() {}, audit: { record: () => false } });
assert.throws(() => noAudit.assertSlackReviewAction('retry-reply'), /audit storage/, 'Slack review decisions fail closed when audit is unavailable');
for (const url of ['/api/lifecycle/quit', '/api/subagents/interrupt', '/api/loops/control', '/api/cron/arm']) {
  assert.equal(noAudit.routeRefusal('POST', url), null);
}
noAudit.assertLoopStop({ action: 'stop' });
noAudit.assertCronDisarm({ enabled: false });
noAudit.assertRoutinePause({ patch: { enabled: false } });
noAudit.assertChannelDisconnect({});
noAudit.assertRemoteStop({ on: false });
noAudit.assertTool({ name: 'terminal.stop' }, { provenance: 'host' });
assert.match(noAudit.routeRefusal('POST', '/api/quests/mint'), /audit storage/);
assert.match(noAudit.routeRefusal('POST', '/api/quests/notes'), /audit storage/);
assert.match(noAudit.routeRefusal('POST', '/api/finance/directive'), /audit storage/);
denied(() => guard.assertTool({ name: 'quest.update', args: {} }, { provenance: 'host' }));
assert.doesNotThrow(() => guard.assertTool({ name: 'quest.update', args: { op: 'read', id: 'q:1' } }, { provenance: 'host' }));
for (const op of ['mint', 'start', 'progress', 'attest_complete']) {
  assert.doesNotThrow(() => guard.assertTool({ name: 'quest.update', args: { op } }, { provenance: 'host' }));
  denied(() => guard.assertTool({ name: 'quest.update', args: { op } }, { provenance: 'connector' }));
  denied(() => corrupt.assertTool({ name: 'quest.update', args: { op } }, { provenance: 'host' }));
  denied(() => noAudit.assertTool({ name: 'quest.update', args: { op } }, { provenance: 'host' }));
}
denied(() => guard.assertTool({ name: 'quest.update', args: { op: 'confirm' } }, { provenance: 'host' }));
denied(() => guard.assertTool({ name: 'quest.update', args: { op: 'read' } }, { provenance: 'connector' }));
denied(() => noAudit.assertTool({ name: 'quest.update', args: { op: 'read' } }, { provenance: 'host' }));
assert.match(guard.routeRefusal('GET', '/plugins/example'), /Strict finance/);
assert.match(guard.routeRefusal('GET', '/api/browser/view'), /Strict finance/);

const beforeMidnight = Date.parse('2026-11-01T06:59:59.999Z');
const midnight = Date.parse('2026-11-01T07:00:00Z');
assert.deepEqual(periodKeys(beforeMidnight), { day: '2026-10-31', week: '2026-10-26', month: '2026-10' });
assert.deepEqual(periodKeys(midnight), { day: '2026-11-01', week: '2026-10-26', month: '2026-11' });
assert.equal(periodKeys(Date.parse('2026-11-02T06:59:59Z')).week, '2026-10-26');
assert.equal(periodKeys(Date.parse('2026-11-02T07:00:00Z')).week, '2026-11-02');
assert.equal(periodKeys(Date.parse('2027-01-01T07:00:00Z')).week, '2026-12-28');
const now = Date.parse('2026-11-01T08:00:00Z');
const rows = [
  { ts: beforeMidnight, usd: 450, agentId: 'a' },
  { ts: midnight, usd: 50, agentId: 'b' },
  { ts: midnight, usd: 999, unmetered: true },
];
assert.deepEqual(calendarTotals(rows, now).usd, { day: 50, week: 500, month: 50 });
const ledger = { health: () => ({ complete: true, durable: true }), all: () => rows };
let status = guard.status(ledger, now);
assert.equal(status.periods.day.reached, true);
assert.equal(status.periods.week.remaining, 0);
assert.equal(status.periods.month.remaining, 950);
assert.equal(status.positiveCostAdapters, 0);
assert.equal(status.reservations.usd, 0);
rows.push({ ts: midnight, usd: 950 });
status = guard.status(ledger, now);
assert.equal(status.periods.month.reached, true);
assert.equal(status.periods.month.remaining, 0);
const unknown = guard.status({ health: () => ({ complete: false, durable: true }) }, now);
assert.equal(unknown.accountingKnown, false);
assert.equal(unknown.periods, null);
assert.match(unknown.accountingError, /incomplete/);
assert.throws(() => calendarTotals([{ ts: midnight, usd: -1 }], now), /Invalid/);
assert.throws(() => calendarTotals([{ ts: now + 1, usd: 1 }], now), /Future/);

async function main() {
  let slackAllowed = false;
  const slackGuard = makeStrictFinance({ read: () => config, onError() {}, slackAuthorized: () => slackAllowed });
  const slackCalls = [];
  const slackFetch = async (url, init) => { slackCalls.push({ url, init }); return { status: 200 }; };
  await assert.rejects(slackGuard.slackFetch(slackFetch, 'https://slack.com/api/apps.connections.open', { method: 'POST' }), error => error.code === CODE);
  slackAllowed = true;
  await slackGuard.slackFetch(slackFetch, 'https://slack.com/api/apps.connections.open', { method: 'POST' });
  await slackGuard.slackFetch(slackFetch, 'https://slack.com/api/chat.postMessage', { method: 'POST' });
  assert.equal(slackCalls.length, 2);
  assert.equal(slackCalls[0].init.redirect, 'manual');
  for (const url of ['https://slack.com.evil.test/api/chat.postMessage', 'https://slack.com/api/files.upload',
    'https://slack.com/api/chat.postMessage?other=1', 'http://slack.com/api/chat.postMessage']) {
    await assert.rejects(slackGuard.slackFetch(slackFetch, url, { method: 'POST' }), error => error.code === CODE);
  }
  await assert.rejects(slackGuard.slackFetch(slackFetch, 'https://slack.com/api/chat.postMessage', { method: 'GET' }));
  await assert.rejects(slackGuard.slackFetch(async () => ({ status: 302 }), 'https://slack.com/api/chat.postMessage', { method: 'POST' }));
  slackGuard.assertSlackSocket('wss://wss-primary.slack.com/link/?ticket=fake');
  for (const url of ['wss://slack.com.evil.test/', 'ws://wss-primary.slack.com/', 'wss://user@wss-primary.slack.com/']) {
    denied(() => slackGuard.assertSlackSocket(url));
  }
  denied(() => noAudit.assertSlackAuthorizationChange());
  slackAllowed = false;
  denied(() => slackGuard.assertSlackSocket('wss://wss-primary.slack.com/link/'));
  assert.equal(slackCalls.length, 2, 'invalid Slack requests never reach the network');
  guard.assertTool({ name: 'crew.directive' }, { provenance: 'host' });
  assert.throws(() => guard.assertTool({ name: 'crew.directive' }, { provenance: 'connector' }), /Strict finance/);
  let calls = 0;
  const fetchImpl = async (url, init) => { calls++; assert.equal(init.redirect, 'manual'); return { status: 200 }; };
  for (const address of ['https://api.anthropic.com/v1/messages', 'https://api.pixellab.ai/mcp',
    'https://api.pixellab.ai/v2/create-character-with-8-directions',
    'http://127.0.0.1:8189/mcp', 'http://127.0.0.1:11434/api/pull']) {
    await assert.rejects(guard.fetch(fetchImpl, address, { method: 'POST', body: '{"model":"qwen3.5:4b"}' }), error => error.code === CODE);
  }
  await assert.rejects(guard.fetch(fetchImpl, 'http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{"model":"remote:cloud"}' }));
  assert.equal(calls, 0, 'unknown-cost requests are refused before any network call');
  await guard.fetch(fetchImpl, 'http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{"model":"qwen3.5:4b"}' });
  await guard.fetch(fetchImpl, 'http://127.0.0.1:11434/api/tags');
  assert.equal(calls, 2);
  await assert.rejects(guard.fetch(async () => ({ status: 307 }), 'http://127.0.0.1:11434/api/tags'), /redirect/);
  await assert.rejects(corrupt.fetch(fetchImpl, 'http://127.0.0.1:11434/api/tags'), /policy storage/);
  let ran = 0, consents = 0, hooks = 0;
  const registry = makeRegistry();
  const register = (name, provenance = 'host') => registry.register({
    name, scope: 'read', capability: 'test', readOnly: true, requiresConsent: true,
    run: async () => { ran++; return 'done'; },
  }, { provenance });
  register('station.status');
  register('mcp.free', 'connector');
  register('shell.exec');
  register('station.control');
  attachFinancialGuard((call, tool) => guard.assertTool(call, tool));
  try {
    const ctx = { authorize: async () => ({ ok: true }), consent: async () => { consents++; return { allow: true }; },
      hooks: { invoke: async () => { hooks++; return {}; } } };
    for (const name of ['mcp.free', 'shell.exec', 'station.control']) {
      const out = await registry.dispatch({ id: name, name, args: {} }, ctx);
      assert.equal(out.isError, true);
      assert.match(out.content, /Strict finance/);
    }
    assert.equal(ran, 0);
    assert.equal(consents, 0, 'consent cannot override a financial refusal');
    assert.equal(hooks, 0, 'plugins cannot run ahead of the strict gate');
    assert.equal((await registry.dispatch({ id: 'read', name: 'station.status', args: {} }, ctx)).isError, false);
    assert.equal(ran, 1);
    assert.equal((await registry.dispatch({ id: 'stop', name: 'station.control', args: { action: 'estop.engage' } }, ctx)).isError, false);
    assert.equal(ran, 2, 'existing safety stop still passes its normal consent gate');
    const concurrent = await Promise.all(Array.from({ length: 30 }, () => guard.fetch(fetchImpl, 'https://paid.example/call').then(() => false, () => true)));
    assert(concurrent.every(Boolean));
    assert.equal(calls, 2, 'concurrent paid attempts cannot reserve or spend anything');
  } finally { attachFinancialGuard(null); }
  console.log('strict-finance: calendar boundaries, shared totals, fail-closed configuration, zero-cost admission, network/process/tool/route gates PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
