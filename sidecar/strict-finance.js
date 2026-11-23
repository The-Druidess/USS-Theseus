/* Strict admission currently has one proven quote: local Ollama inference costs $0.
   No positive-cost adapter is admitted until it supplies a guaranteed charge bound. */
'use strict';

const POLICY = Object.freeze({ day: 50, week: 500, month: 1000, timezone: 'America/Phoenix' });
const CODE = 'strict_finance_blocked';
const READ_TOOLS = new Set([
  'tool.search', 'station.inspect', 'station.status', 'station.layout', 'station.map',
  'station.settings', 'session.list', 'session.peek', 'team.subagents', 'team.config',
  'loop.list', 'notebook.read', 'fs.list',
  'treasury.status',
  'crew.directive',
]);
const LOCAL_QUEST_OPS = new Set(['read', 'start', 'progress', 'attest_complete', 'mint']);
const LOCAL_POST_ROUTES = new Set([
  '/api/run', '/api/cancel', '/api/run/steer', '/api/station/ack', '/api/session',
  '/api/consent', '/api/consent/ack', '/api/consent/answer', '/api/save', '/api/save/recovery-ack',
  '/api/roster', '/api/routing', '/api/routing/sample/stop', '/api/budget/caps', '/api/budget/settle',
  '/api/halt', '/api/halt/resume', '/api/activity',
  '/api/memory/turnin', '/api/memory/pin', '/api/memory/edit', '/api/memory/forget',
  '/api/memory/declined/restore', '/api/memory/reset',
]);
function refusal(detail) {
  const error = new Error('Strict finance: ' + detail + ' No action was authorized.');
  error.code = CODE;
  return error;
}
function validateConfig(value) {
  if (!value || value.version !== 1 || value.enabled !== true || value.mode !== 'local-only'
      || value.timezone !== POLICY.timezone || value.day !== POLICY.day || value.week !== POLICY.week
      || value.month !== POLICY.month || !Array.isArray(value.localModels) || !value.localModels.length
      || value.localModels.some(m => typeof m !== 'string' || !/^[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+$/.test(m)
        || /cloud/i.test(m)) || new Set(value.localModels).size !== value.localModels.length) {
    throw new Error('Invalid strict finance policy; paid and unverified work remains blocked.');
  }
  return Object.freeze({ ...POLICY, version: 1, enabled: true, mode: 'local-only', localModels: Object.freeze(value.localModels.slice()) });
}
function periodKeys(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: POLICY.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ts);
  const get = key => parts.find(p => p.type === key).value;
  const year = get('year'), month = get('month'), day = get('day');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return { day: year + '-' + month + '-' + day, week: date.toISOString().slice(0, 10), month: year + '-' + month };
}
function calendarTotals(rows, now) {
  if (!Array.isArray(rows)) throw new Error('Invalid finance ledger');
  const keys = periodKeys(now), usd = { day: 0, week: 0, month: 0 };
  for (const row of rows) {
    if (!row || !Number.isFinite(row.ts) || row.ts <= 0 || !Number.isFinite(row.usd) || row.usd < 0) {
      throw new Error('Invalid finance ledger entry');
    }
    if (row.ts > now) throw new Error('Future-dated spending needs reconciliation');
    if (row.unmetered) continue;
    const at = periodKeys(row.ts);
    for (const scope of ['day', 'week', 'month']) if (keys[scope] === at[scope]) usd[scope] += row.usd;
  }
  return { keys, usd };
}
function makeStrictFinance(opts) {
  let config = null, issue = null;
  try {
    const raw = opts.read();
    if (raw !== undefined) config = validateConfig(raw);
  } catch (error) {
    issue = error.message;
    config = { ...POLICY, enabled: true, mode: 'local-only', localModels: [] };
    opts.onError(error);
  }
  const enabled = () => !!config;
  function audit(decision, surface, operation) {
    return opts.audit ? opts.audit.record(decision, surface, operation) : true;
  }
  function allow(surface, operation) {
    if (!audit('allowed', surface, operation)) throw refusal('financial audit storage is unavailable; execution remains blocked.');
  }
  function deny(detail, surface = 'admission', operation = 'unverified operation') {
    audit('blocked', surface, operation);
    throw refusal(detail);
  }
  function localEndpoint(value) {
    let url;
    try { url = new URL(value); } catch (_) { return false; }
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.port === '11434' && !url.username && !url.password;
  }
  function assertProvider(provider, baseUrl, request) {
    if (!enabled()) return;
    if (issue) deny('policy storage is unavailable or invalid.');
    if (provider !== 'ollama' || (baseUrl && !localEndpoint(baseUrl))) deny('only the approved local Ollama endpoint has a verified $0 maximum charge.', 'provider', String(provider));
    if (!request || !config.localModels.includes(request.model)) deny('model is not an approved installed local model; remote/cloud models have no guaranteed charge bound.', 'provider', String(provider));
    allow('provider', provider + ':' + request.model);
  }
  function assertTool(call, tool) {
    if (!enabled()) return;
    if (tool.provenance === 'host' && call.name === 'quest.update' && LOCAL_QUEST_OPS.has(call.args?.op)) {
      if (issue && call.args.op !== 'read') deny('policy storage is unavailable or invalid.', 'tool', call.name);
      allow('tool', 'quest.update:' + call.args.op);
      return;
    }
    if (tool.provenance === 'host' && READ_TOOLS.has(call.name)) {
      // Telemetry must stay readable even when the audit store itself needs repair.
      if (call.name !== 'treasury.status') allow('tool', call.name);
      return;
    }
    if (tool.provenance === 'host' && call.name === 'station.control' && call.args?.action === 'estop.engage') return;
    if (tool.provenance === 'host' && call.name === 'team.interrupt') return;
    deny('tool "' + call.name + '" has no verified zero-cost execution path. ASK/Full Power cannot override this gate.', 'tool', call.name);
  }
  function assertProcess() {
    if (enabled()) deny('subprocess execution is blocked because its possible charges are unbounded.', 'process', 'subprocess');
  }
  function routeRefusal(method, address) {
    if (!enabled()) return null;
    const url = new URL(address, 'http://localhost');
    if (method === 'GET' && url.pathname === '/api/spotify/status') return null;
    const blockedPrefix = /^\/(?:api\/(?:browser|computer|desktop|cua|plugins?|local-voice|tts|stt|realtime|credits|spotify|connectors\/oauth)|plugins|workshop-run)(?:\/|$)/;
    if (blockedPrefix.test(url.pathname)) {
      audit('blocked', 'route', method + ' ' + url.pathname.match(blockedPrefix)[0]);
      return refusal('this service is suspended in local-only mode.').message;
    }
    if (method === 'POST' && ['/api/quests/mint', '/api/quests/notes'].includes(url.pathname)) {
      if (issue) return refusal('policy storage is unavailable or invalid.').message;
      try { allow('route', method + ' ' + url.pathname); }
      catch (error) { return error.message; }
      return null;
    }
    if (url.pathname.startsWith('/api/') && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
        && !LOCAL_POST_ROUTES.has(url.pathname)) {
      audit('blocked', 'route', method + ' /api/[unapproved]');
      return refusal('this command is not an approved local-only operation.').message;
    }
    return null;
  }
  async function fetchGuard(fetchImpl, input, init) {
    if (!enabled()) return fetchImpl(input, init);
    if (issue) deny('policy storage is unavailable or invalid.');
    const address = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!localEndpoint(address)) deny('outbound network access is not a verified zero-cost local operation.');
    const url = new URL(address);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const read = method === 'GET' && ['/api/tags', '/api/ps', '/api/version', '/v1/models'].includes(url.pathname);
    const inference = method === 'POST' && ['/api/chat', '/api/generate', '/v1/chat/completions', '/api/show'].includes(url.pathname);
    if (!read && !inference) deny('this local endpoint is not approved for strict finance.');
    if (inference) {
      let body;
      try { body = JSON.parse(init?.body); } catch (_) { deny('inference request must contain an inspectable model.'); }
      assertProvider('ollama', address, { model: body.model || body.name });
    }
    allow('network', method + ' ' + url.pathname);
    // Do not follow a redirect out of the local, verified boundary.
    const response = await fetchImpl(input, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) deny('redirects are not permitted for local-only inference.');
    return response;
  }
  function status(ledger, now) {
    const result = {
      enabled: enabled(), mode: enabled() ? 'local-only' : 'off',
      policy: { ...POLICY }, localModels: config ? config.localModels.slice() : [],
      positiveCostAdapters: 0, paidAdmission: enabled() ? 'blocked-no-guaranteed-maximum' : 'legacy-governor-only',
      reservations: { usd: enabled() ? 0 : null, explanation: enabled()
        ? 'No positive-cost operation is admitted; verified local inference requires $0.'
        : 'Strict finance is not enabled; no strict reservations are maintained.' },
      error: issue, accountingKnown: false, periods: null,
      enforcement: { state: enabled() ? (issue ? 'LOCKED' : 'GUARDING') : 'DISABLED',
        mechanism: 'Synchronous pre-dispatch interception, not an AI monitoring loop.',
        independentOfAdviser: true, audit: opts.audit ? opts.audit.snapshot() : null },
      coverage: 'Starnet runtime only. Existing subscriptions, manual purchases and other applications are outside this gate.',
    };
    if (enabled() && result.enforcement.audit && !result.enforcement.audit.durable) result.enforcement.state = 'DEGRADED';
    try {
      const health = ledger.health();
      if (!health.complete || !health.durable) throw new Error('Spend accounting is incomplete or not durable.');
      const totals = calendarTotals(ledger.all(), now);
      result.periods = Object.fromEntries(['day', 'week', 'month'].map(scope => [scope, {
        period: totals.keys[scope], cap: POLICY[scope], spent: totals.usd[scope],
        remaining: Math.max(0, POLICY[scope] - totals.usd[scope]),
        reached: totals.usd[scope] >= POLICY[scope],
      }]));
      result.accountingKnown = true;
    } catch (error) {
      result.accountingError = error.message;
    }
    return result;
  }
  return { enabled, assertProvider, assertTool, assertProcess, routeRefusal, fetch: fetchGuard, status };
}
module.exports = { POLICY, CODE, validateConfig, periodKeys, calendarTotals, makeStrictFinance };
