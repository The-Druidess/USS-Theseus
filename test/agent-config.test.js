'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeStationTools } = require('../sidecar/tools/builtin/station.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');
const app = fs.readFileSync(require.resolve('../frontend/app/app.js'), 'utf8');
const commands = fs.readFileSync(require.resolve('../frontend/app/stationcommands.js'), 'utf8');
const extract = name => app.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'))[0];

function boot(failure) {
  const hero = { id: 'agent', role: 'orchestrator', docs: { identity: 'Lead', purpose: 'Coordinate', manual: 'Keep rules' } };
  const worker = { id: 'worker', role: 'specialist', docs: { identity: 'Worker', purpose: 'Old purpose', manual: 'Keep rules' } };
  const agents = new Map([[hero.id, hero], [worker.id, worker]]);
  let save, livePrompt, roster;
  const acks = [];
  const context = {
    agent: hero, agents, agentDocs: a => a.docs,
    baseIdentity: () => '', rosterClause: () => '', foundationClause: () => '', approvalClause: () => '',
    recomposeOrchestrators: () => {}, syncChannels: () => {},
    Chat: { setSystem: p => { livePrompt = p; } },
    pushRoster: () => { roster = worker.systemPrompt; },
    persist: () => { save = JSON.parse(JSON.stringify({ agent: hero, agents: [...agents.values()] })); },
    CloudSave: {
      flush: async () => failure !== 'save',
      pull: async () => failure === 'read' ? {} : save
    },
    fetch: async (url, init) => { acks.push(JSON.parse(init.body)); return { ok: true }; },
    document: { addEventListener: () => {} }, console, setTimeout, clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(extract('composeSystemPrompt') + '\n' + extract('applyAgentConfig'), context);
  context.App = {
    agents: () => [...agents.values()], applyConfig: context.applyAgentConfig,
    configSynced: async () => failure !== 'roster'
  };
  const S = vm.runInContext(commands + '\nStationCommands;', context);
  const tools = makeStationTools({ station: { request: async (verb, args) => {
    await S.run('request-' + acks.length, verb, args);
    return acks.at(-1);
  } } });
  return { tools, worker, hero, recover: () => { failure = null; }, state: () => ({ save, livePrompt, roster }) };
}

(async () => {
  const env = boot();
  const roster = JSON.parse((await env.tools.agentConfigTool.run()).content);
  assert.equal(roster.agents.length, 2);
  assert.ok(roster.agents.every(a => !a.docs), 'listing does not load every agent document into context');
  const read = JSON.parse((await env.tools.agentConfigTool.run({ agentId: 'worker' })).content);
  assert.equal(read.docs.purpose, 'Old purpose');
  assert.equal(read.docs.context, '');
  assert.match((await env.tools.agentConfigTool.run({ agentId: 'missing' })).content, /^REFUSED:/);
  const edit = { agentId: 'worker', field: 'purpose', previousText: 'Old purpose', text: 'Review drafts' };
  const result = await env.tools.agentConfigureTool.run(edit);
  assert.equal(JSON.parse(result.content).durable, true);
  assert.equal(env.worker.docs.purpose, 'Review drafts');
  assert.equal(env.hero.docs.purpose, 'Coordinate');
  assert.equal(env.worker.docs.manual, 'Keep rules');
  assert.equal(env.state().livePrompt, undefined, 'editing a bystander must not retarget the focused chat');
  assert.match(env.state().roster, /Review drafts/);
  assert.match(env.state().roster, /Keep rules/);
  assert.equal(env.state().save.agents.find(a => a.id === 'worker').docs.purpose, 'Review drafts');
  assert.equal(JSON.parse((await env.tools.agentConfigureTool.run(edit)).content).durable, true, 'retry is idempotent');
  for (const args of [
    { ...edit, text: 'Overwrite newer edit' },
    { ...edit, agentId: 'unknown' },
    { ...edit, field: 'executionProfile', text: 'this-computer' },
    { ...edit, previousText: undefined },
    { ...edit, field: 'manual', text: 'x'.repeat(20001) }
  ]) assert.match((await env.tools.agentConfigureTool.run(args)).content, /^REFUSED:/);
  assert.equal(env.worker.docs.purpose, 'Review drafts');
  assert.equal(env.hero.docs.purpose, 'Coordinate');
  assert.equal(JSON.parse((await env.tools.agentConfigureTool.run({ ...edit, previousText: 'Review drafts', text: '' })).content).text, '');
  for (const failure of ['save', 'read', 'roster']) {
    const broken = boot(failure);
    assert.match((await broken.tools.agentConfigureTool.run(edit)).content, /^REFUSED:/, failure + ' cannot report success');
    broken.recover();
    assert.equal(JSON.parse((await broken.tools.agentConfigureTool.run(edit)).content).durable, true, 'retry confirms the same edit after recovery');
  }
  assert.match((await makeStationTools({}).agentConfigureTool.run(edit)).content, /^REFUSED:/);
  assert.equal(env.tools.agentConfigureTool.requiresConsent, true);
  assert.equal(env.tools.agentConfigureTool.capability, 'orchestrator');
  assert.equal(env.tools.agentConfigureTool.schema.properties.text.maxLength, undefined, 'Purpose is not capped by the tool schema');
  const longEnv = boot();
  const directive = 'BEGIN PURPOSE\n' + 'Preserve every directive line for this agent.\n'.repeat(3000) + 'END PURPOSE';
  assert(directive.length > 100000);
  const longEdit = { agentId: 'worker', field: 'purpose', previousText: 'Old purpose', text: directive };
  assert.equal(JSON.parse((await longEnv.tools.agentConfigureTool.run(longEdit)).content).durable, true);
  assert.equal(longEnv.worker.docs.purpose, directive, 'full directive reaches the selected agent');
  assert.equal(longEnv.worker.purpose, directive, 'purpose mirror is not truncated');
  assert(longEnv.worker.systemPrompt.includes(directive), 'full directive is composed into the agent prompt');
  assert.equal(longEnv.state().save.agents.find(agent => agent.id === 'worker').docs.purpose, directive, 'full directive survives durable serialization/read-back');
  assert.equal(JSON.parse((await longEnv.tools.agentConfigTool.run({ agentId: 'worker' })).content).docs.purpose, directive, 'team.config returns the complete directive');
  assert.equal(longEnv.hero.docs.purpose, 'Coordinate', 'long directives never overwrite another agent');
  let summoned;
  const orchestration = makeOrchestrationTools({});
  await orchestration.summonTool.run({ name: 'Purpose probe', purpose: directive }, {
    summon: async spec => { summoned = spec; return { agentId: 'purpose-probe' }; }
  });
  assert.equal(summoned.purpose, directive, 'custom-agent creation preserves the complete Purpose directive');
  const heroDirective = 'ORCHESTRATOR\n' + directive;
  assert.equal(JSON.parse((await longEnv.tools.agentConfigureTool.run({ agentId: 'agent', field: 'purpose', previousText: 'Coordinate', text: heroDirective })).content).durable, true);
  assert.equal(longEnv.hero.docs.purpose, heroDirective, 'orchestrators accept the same full-length Purpose documents');
  assert(longEnv.hero.systemPrompt.includes(heroDirective));
  assert.equal(longEnv.worker.docs.purpose, directive, 'orchestrator edits preserve specialist directives');
  const backend = fs.readFileSync(require.resolve('../sidecar/index.js'), 'utf8');
  const normalizeRoster = backend.match(/function replaceAgentRoster\([^]*?\n\}/)[0];
  const rosterContext = { agentRoster: new Map(), agentRosterRaw: new Map(), normalizeProviderId: value => value,
    executionProfiles: { normalizeId: value => value }, process: { env: {} } };
  vm.createContext(rosterContext);
  vm.runInContext(normalizeRoster, rosterContext);
  rosterContext.replaceAgentRoster([{ agentId: 'worker', system: longEnv.worker.systemPrompt }, { agentId: 'agent', system: longEnv.hero.systemPrompt }]);
  assert(rosterContext.agentRoster.get('worker').system.includes(directive), 'delegated specialist roster retains the full Purpose');
  assert(rosterContext.agentRoster.get('agent').system.includes(heroDirective), 'backend orchestrator roster retains the full Purpose');
  const ui = fs.readFileSync(require.resolve('../frontend/app/stationui.js'), 'utf8');
  const editor = ui.match(/  function fileCard\([^]*?\n  \}/)[0];
  assert.doesNotMatch(editor, /\bmaxlength\b|\bmaxLength\b/, 'Purpose editor has no character cap');
  const registered = [];
  env.tools.register({ register: t => registered.push(t.name) });
  assert.ok(registered.includes('team.config') && registered.includes('team.configure'));
  const registry = fs.readFileSync(require.resolve('../sidecar/capability/registry.js'), 'utf8');
  for (const name of ['team.config', 'team.configure']) assert.ok(registry.includes("tool: '" + name + "'"));
  console.log('agent-config.test: OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
