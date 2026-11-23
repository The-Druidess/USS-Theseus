'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeFinanceAudit } = require('../sidecar/finance-audit.js');
const { makeStrictFinance, POLICY, CODE } = require('../sidecar/strict-finance.js');
const { makeTreasuryTool, treasuryContext } = require('../sidecar/tools/builtin/treasury.js');

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-finance-audit-'));
  const errors = [];
  const deps = { fs, path, workspace, now: () => 123456, onError: error => errors.push(error.message) };
  const config = { ...POLICY, version: 1, enabled: true, mode: 'local-only', localModels: ['qwen3.5:4b'] };
  const ledger = { health: () => ({ complete: true, durable: true }), all: () => [] };
  const make = audit => makeStrictFinance({ audit, read: () => config, onError: deps.onError });
  try {
    const audit = makeFinanceAudit(deps);
    const guard = make(audit);
    assert.equal(audit.snapshot().durable, true);
    guard.assertProvider('ollama', '', { model: 'qwen3.5:4b' });
    assert.throws(() => guard.assertProvider('claude-cli', '', {}), e => e.code === CODE);
    assert.throws(() => guard.assertTool({ name: 'paid.action', args: { secret: 'do-not-log' } }, { provenance: 'host' }), e => e.code === CODE);
    assert.match(guard.routeRefusal('POST', '/api/unapproved/do-not-log?key=do-not-log'), /Strict finance/);
    let snapshot = guard.status(ledger, 123456);
    assert.equal(snapshot.enforcement.state, 'GUARDING');
    assert.deepEqual(snapshot.enforcement.audit.counts, { allowed: 1, blocked: 3 });
    assert.doesNotMatch(JSON.stringify(snapshot.enforcement.audit), /do-not-log/);
    assert.equal(snapshot.enforcement.audit.recent[0].at, 123456);
    const reloaded = makeFinanceAudit(deps);
    assert.deepEqual(reloaded.snapshot(), audit.snapshot(), 'durable decisions survive restart');
    const exposed = audit.snapshot();
    exposed.counts.allowed = 999;
    exposed.recent[0].operation = 'mutated';
    assert.equal(audit.snapshot().counts.allowed, 1, 'returned snapshots do not mutate authoritative state');
    for (let i = 0; i < 105; i++) reloaded.record('allowed', 'tool', 'station.inspect');
    assert.equal(reloaded.snapshot().recent.length, 100);
    assert.equal(reloaded.snapshot().counts.allowed, 106, 'trimming records does not reset lifetime counters');
    assert.equal(reloaded.snapshot().recent.at(-1).sequence, 109);
    const context = treasuryContext(make(reloaded).status(ledger, 123456));
    assert.equal((context.match(/"sequence"/g) || []).length, 10, 'automatic context is bounded to ten recent events');
    assert.match(context, /not purchases/);
    assert.match(context, /refer financial approval and denial decisions to Q/);
    let tool;
    makeTreasuryTool({ status: () => guard.status(ledger, 123456) }).register({ register: value => { tool = value; } });
    assert.equal(tool.name, 'treasury.status');
    assert.equal(tool.scope, 'read');
    assert.equal(JSON.parse((await tool.run()).content).enforcement.state, 'GUARDING');
    const broken = makeFinanceAudit({ ...deps, fs: { ...fs, renameSync() { throw new Error('disk write failed'); } } });
    assert.equal(broken.record('allowed', 'provider', 'ollama'), false);
    const blocked = make(broken);
    assert.throws(() => blocked.assertProvider('ollama', '', { model: 'qwen3.5:4b' }), e => e.code === CODE);
    assert.equal(blocked.status(ledger, 123456).enforcement.state, 'DEGRADED');
    blocked.assertTool({ name: 'treasury.status' }, { provenance: 'host' });
    blocked.assertTool({ name: 'station.control', args: { action: 'estop.engage' } }, { provenance: 'host' });
    blocked.assertAutonomyStandDown({ posture: { initiative: 'wait', reach: 'observe', leashPerDay: 1 } },
      { initiative: 'leash', reach: 'sandbox', leashPerDay: 3 }, true);
    fs.writeFileSync(path.join(workspace, 'finance-audit.json'), '{broken');
    const corrupt = makeFinanceAudit(deps);
    assert.equal(corrupt.snapshot().durable, false);
    assert.equal(corrupt.record('allowed', 'provider', 'ollama'), false);
    assert.equal(fs.readFileSync(path.join(workspace, 'finance-audit.json'), 'utf8'), '{broken', 'bad audit is not silently overwritten');
    assert(errors.some(e => /disk write failed/.test(e)));
    console.log('finance-audit: durability, bounded retention, secret minimization, treasury context/tool, and fail-closed errors PASS');
  } finally {
    fs.rmSync(workspace, { recursive: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
