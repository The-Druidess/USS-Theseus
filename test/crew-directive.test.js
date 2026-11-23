'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeCrewDirectiveTool, DIRECTIVE_LANGUAGE } = require('../sidecar/tools/builtin/crew-directive.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');

global.localStorage = { getItem: () => null, setItem: () => {} };
const Q = require('../frontend/app/qterminal.js');
assert.equal(Q.hydrate({
  roleDirectives: { commander: 'Old commander directive.' },
  titles: { 'role:commander': 'R-01 Commander' },
  drafts: { 'role:commander': { title: 'R-02 Draft', text: 'Pending text.', savedAt: 123 } }
}), true);
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
const migration = source.match(/function migrateAgentDirective\(a\) \{[\s\S]*?\n  \}/);
assert.ok(migration);
const migrate = new Function('QTerminalStore', migration[0] + '; return migrateAgentDirective;')(Q);
const commander = { id: 'agent', name: 'COMMANDER', purpose: 'Keep this purpose.\n\n## Commander Directive\nOld commander directive.',
  docs: { manual: 'Existing manual.', purpose: 'Keep this purpose.\n\n## Commander Directive\nOld commander directive.' } };
migrate(commander);
assert.equal(commander.docs.directive, 'TITLE: R-01 Commander\nOld commander directive.');
assert.equal(commander.docs.directiveDraft, 'TITLE: R-02 Draft\nPending text.');
assert.equal(commander.docs.manual, 'Existing manual.');
assert.equal(commander.docs.purpose, 'Keep this purpose.');
assert.equal(commander.purpose, 'Keep this purpose.');
commander.docs.directive = 'Edited individual directive.';
commander.docs.directiveDraft = '';
migrate(commander);
assert.equal(commander.docs.directive, 'Edited individual directive.');
assert.equal(commander.docs.directiveDraft, '');
const edited = { id: 'agent', name: 'COMMANDER', docs: { directive: 'Already edited.', purpose: 'Keep Old commander directive.' } };
migrate(edited);
assert.equal(edited.docs.purpose, 'Keep Old commander directive.', 'migration must not remove content after an individual directive was edited');
const firstOfficer = { id: 'chief', name: 'FIRST OFFICER', docs: {} };
migrate(firstOfficer);
assert.match(firstOfficer.docs.directive, /FIRST OFFICER \(NUMBER TWO\)/);
assert.match(Q.promptClause(commander), /PD = Prime Directive; SD = Security Directive; OD = Operating Directive; F = Finance/);
assert.ok(Q.promptClause(commander).includes(DIRECTIVE_LANGUAGE));
assert.doesNotMatch(Q.promptClause(commander), /Old commander directive/);

async function main() {
  const roster = new Map([
    ['agent', { name: 'Commander', directive: 'Commander directive', directiveManual: 'Commander manual' }],
    ['worker', { name: 'Worker', directive: 'Worker directive', directiveManual: 'Worker manual', directiveDraft: 'not active' }],
    ['old', { name: 'Unsynced' }]
  ]);
  const registry = makeRegistry();
  makeCrewDirectiveTool({ roster }).register(registry);
  const station = { agents: { worker: { room: 'room' } }, rooms: { room: { objects: [{ objectType: 'computer' }] } } };
  assert.ok(resolveTools('worker', station).tools.includes('crew.directive'));
  const request = async (agentId, target) => registry.dispatch(
    { id: 'call', name: 'crew.directive', args: { agentId: target } },
    { agentId, canUse: () => ({ ok: true }) }
  );
  const list = await registry.dispatch({ id: 'list', name: 'crew.directive', args: {} }, { agentId: 'worker', canUse: () => ({ ok: true }) });
  assert.deepEqual(JSON.parse(list.content).agents.map(a => a.agentId), ['agent', 'worker', 'old']);
  const response = await request('worker', 'agent');
  assert.equal(response.isError, false);
  assert.deepEqual(JSON.parse(response.content), {
    agentId: 'agent', name: 'Commander', directive: 'Commander directive', operatingManual: 'Commander manual'
  });
  const reverse = await request('agent', 'worker');
  assert.equal(reverse.isError, false);
  assert.doesNotMatch(reverse.content, /not active/);
  assert.match((await request('worker', 'old')).content, /not yet synced/);
  assert.equal((await request('worker', 'missing')).isError, true);
  assert.equal((await request('missing', 'worker')).isError, true);
  roster.get('worker').directive = 'Updated';
  assert.equal(JSON.parse((await request('agent', 'worker')).content).directive, 'Updated');
  console.log('crew directive migration and read-only requests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
