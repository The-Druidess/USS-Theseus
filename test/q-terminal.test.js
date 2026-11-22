'use strict';
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const saved = new Map();
saved.set('starnet.q-terminal.v1', JSON.stringify({ directive: '' }));
global.localStorage = {
  getItem: key => saved.has(key) ? saved.get(key) : null,
  setItem: (key, value) => saved.set(key, value)
};
const Q = require('../frontend/app/qterminal.js');
assert.equal(Q.draftReadyAt({ savedAt: Date.parse('2026-11-21T06:59:59.999Z') }), Date.parse('2026-11-21T07:00:00Z'));
assert.equal(Q.draftReadyAt({ savedAt: Date.parse('2026-11-21T07:00:00Z') }), Date.parse('2026-11-22T07:00:00Z'));
assert.equal(Q.draftReadyAt({ savedAt: Date.parse('2026-06-21T06:00:00Z') }), Date.parse('2026-06-21T07:00:00Z'));
assert.equal(Q.draftReadyAt({ savedAt: 0 }), null);
assert.equal(Q.draftReadyAt({ savedAt: Number.MAX_VALUE }), null);
const qWindowSource = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/q.js'), 'utf8');
assert.ok(qWindowSource.includes('id="q-coordination-policy"') &&
  qWindowSource.includes('data-q-key="coordination"'),
  'Q has a dedicated editable coordination-policy control');
assert.ok(/Q\.saveDraft\(button\.dataset\.qKey, input\.value, text\.value, event\)/.test(qWindowSource),
  'Q interface saves through the trusted draft control');

{
  const windows = {};
  const sent = [{ id: 'm1', agentId: 'crew', kind: 'note', text: 'Question', status: 'replied', response: 'Answer', createdAt: 1 }];
  const fakeStore = Object.assign({}, Q, { messages: () => sent, commands: () => [] });
  const context = {
    StationUI: { h: { esc: String, present: [], notify() {} }, registerWindow: (id, title, build) => { windows[id] = build; } },
    QTerminalStore: fakeStore
  };
  vm.runInNewContext(qWindowSource, context);
  const directiveBody = { isConnected: true };
  const mailBody = { isConnected: true };
  windows.q(directiveBody);
  windows['q-mail'](mailBody);
  assert.match(directiveBody.innerHTML, /id="q-directive"/);
  assert.match(directiveBody.innerHTML, /ADD A NEW DIRECTIVE/);
  assert.match(directiveBody.innerHTML, /Automatic midnight handoff and activation are not available yet/);
  for (const key of ['prime', 'human', 'hierarchy', 'coordination']) {
    assert.ok(directiveBody.innerHTML.includes('data-q-title="' + key + '"'), key + ' has an editable title');
  }
  assert.doesNotMatch(directiveBody.innerHTML, /BRIDGE CREW ROLE DIRECTIVES|data-q-title="role:/);
  assert.doesNotMatch(directiveBody.innerHTML, /Q inbox|Q outbox|add-command/);
  assert.match(directiveBody.innerHTML, /not authenticated/);
  assert.match(mailBody.innerHTML, /Q inbox/);
  assert.match(mailBody.innerHTML, /Q outbox/);
  assert.match(mailBody.innerHTML, /Answer/);
  assert.doesNotMatch(mailBody.innerHTML, /id="q-directive"|save-hierarchy/);
  directiveBody.innerHTML = 'unsaved editor remains untouched';
  context.QTerminalView.refresh();
  assert.equal(directiveBody.innerHTML, 'unsaved editor remains untouched', 'incoming mail does not erase the directive editor');
  const input = { dataset: { qTitle: 'prime' }, value: 'A-01 New title' };
  const textarea = { value: 'Unpublished content' };
  const status = { textContent: '' };
  const heading = { textContent: '' };
  const section = { querySelector: selector => selector === 'h4' ? heading
    : selector === '[data-q-editor]' ? textarea : selector === '[data-q-draft-status]' ? status : input };
  const button = { dataset: { qAction: 'save-draft', qKey: 'prime' }, closest: () => section };
  fakeStore.saveDraft = (key, title, text) => ({ ok: key === 'prime', draft: { title, text } });
  directiveBody.onclick({ target: { closest: selector => selector === '[data-q-action]' ? button : null } });
  assert.equal(heading.textContent, 'A-01 New title');
  assert.match(status.textContent, /not available/);
  assert.equal(directiveBody.innerHTML, 'unsaved editor remains untouched', 'saving a draft does not discard other unsaved text');
}

const defaultDirective = Q.directive();
assert.match(defaultDirective, /The USS Theseus/);
assert.match(defaultDirective, /\$1,000,000,000/);
assert.match(defaultDirective, /Human authorization is required/);
assert.ok(defaultDirective.length <= 8000, 'the default fits the saved directive limit');
assert.match(Q.promptClause(), /PRIME DIRECTIVE — PROJECT-WIDE OPERATING RULES:[\s\S]*The USS Theseus/);
const defaultHierarchy = [
  'The Captain (Q; aka me) - Clearance Level 0',
  'The Commander – Clearance Level 1',
  'The First Officer – Clearance Level 2',
  'Chief Ops Officer – Clearance Level 3',
  'Chief Security Officer – Clearance Level 2',
  'Chief Comm Officer – Clearance Level 3',
  'Chief Med Officer – Clearance Level 3',
  'Chief Science Officer – Clearance Level 3',
  'Chief Helm Officer – Clearance Level 3',
  'Chief Engineer – Clearance Level 3',
  'The Ambassador – Clearance Level 3',
  'The Treasurer – Clearance Level 2'
].join('\n');
const coordinationEscalations = [
  'HIERARCHY COORDINATION AND ESCALATIONS',
  '- Any issue concerning Clearance Level 1 must be escalated to Clearance Level 0 (Q).',
  '- Treasury, security, and communications issues, including issues involving their officers or crew, must be reported directly to Q. Route each issue to its responsible officer as well. If the affected operation cannot be repaired within authorized scope, halt that specific operation and await human intervention.',
  '- Agents needing extensive troubleshooting, debugging, or repair must be directed to the Chief Medical Officer for diagnosis and repair coordination. Only an authorized agent with necessary access may perform repairs.',
  '- Communication repairs or training must be reported to the Chief Communications Officer.',
  '- Technical infrastructure, integrations, and system support issues must be reported to the Chief Engineer.',
  '- Workload, resources, dependencies, throughput, and operational-status issues must be reported to the Chief Ops Officer; escalate unassigned or unresolved matters to Q.',
  '- Finance, budget, expenditure, revenue, and financial-obligation issues must be reported to the Treasurer. These matters are highest priority and require utmost sensitivity, care, and dedication.',
  '- Security rules, access restrictions, authorization boundaries, or threats to ship systems, information, assets, and operational integrity must be reported to the Chief Security Officer. These matters are highest priority and require utmost sensitivity, care, and dedication; report them to Q directly as required above and never bypass restrictions to investigate or repair.'
];
const sharedEscalationText = coordinationEscalations.join('\n');
const defaultCoordinationPolicy = [
  'All crew must immediately escalate to higher authorities and suspend the affected operation when any of the following occurs:',
  '',
  '- Security or legal risk: An operation may violate applicable law(s), expose confidential information, compromise credentials, or bypass a security restriction.',
  '- Directive conflict: Two or more applicable directives conflict, or an instruction exceeds the issuing agent\'s authority. Report to chief ops officer.',
  '- Financial risk: A proposed transaction, expenditure, or commitment exceeds authorized limits, lacks required approval, or presents a material unassessed risk of financial loss. Report to the treasurer.',
  '- Critical failure: An operation causes data loss, damages a critical system, corrupts business records, or disrupts multiple factory rooms. Report to chief science officer.',
  '- Unverified critical information: A consequential decision depends on information that is missing, contradictory, or unverified. Report to the chief engineer officer.',
  '- Repeated failure: The same operation fails twice consecutively without an identified and corrected cause. Report to the chief comms officer.',
  '- Unauthorized action: An agent performs or attempts an action outside its assigned permissions or delegated authority. Report to the first officer.',
  '- Human authorization required: An operation requires explicit human approval that has not been obtained. Report to Q.'
].join('\n');
assert.strictEqual(Q.hierarchy(), defaultHierarchy);
assert.strictEqual(Q.coordinationPolicy(), defaultCoordinationPolicy,
  'Q starts with the Commander-provided crew coordination and escalation policy');
assert.deepStrictEqual(Q.authorityFor({ id: 'agent', name: 'COMMANDER' }), {
  level: 1, listed: true, role: 'The Commander', hierarchy: defaultHierarchy
});
const bridgeLevels = [
  ['Jean-Luc Picard', 1],
  ['First Officer', 2],
  ['Chief Security Officer', 2],
  ['Chief Ops Officer', 3],
  ['Chief Comm Officer', 3],
  ['Chief Med Officer', 3],
  ['Chief Science Officer', 3],
  ['Chief Helm Officer', 3],
  ['Chief Engineer', 3],
  ['The Ambassador', 3],
  ['The Treasurer', 2],
  ['Data (as Sherlock)', 2],
  ['Worf', 2],
  ['Quark', 2],
  ['Scotty', 3],
  ['Seven of Nine', 3],
  ['Deanna Troi', 3],
  ['Tom Paris', 3],
  ['Beverly Crusher', 3],
  ['Geordi LaForge', 3]
];
for (const [name, level] of bridgeLevels) {
  assert.strictEqual(Q.authorityFor({ id: name.toLowerCase().replace(/\W+/g, '-'), name }).level, level, name + ' has its assigned Bridge hierarchy level');
}
const assignments = [
  ['Scotty', 'Chief Engineer', 3],
  ['Seven of Nine', 'Chief Comm Officer', 3],
  ['Deanna Troi', 'The Ambassador', 3],
  ['Tom Paris', 'Chief Helm Officer', 3],
  ['Beverly Crusher', 'Chief Med Officer', 3],
  ['Data (as Sherlock)', 'The First Officer', 2],
  ['Geordi LaForge', 'Chief Science Officer', 3],
  ['Worf', 'Chief Security Officer', 2],
  ['Quark', 'The Treasurer', 2]
];
for (const [name, role, level] of assignments) {
  const authority = Q.authorityFor({ id: name.toLowerCase().replace(/\W+/g, '-'), name });
  assert.deepStrictEqual([authority.role, authority.level, authority.listed], [role, level, true], name + ' resolves to assigned Bridge role');
}
assert.strictEqual(Q.authorityFor({ id: 'bridge-commander', name: 'Jean-Luc Picard' }).listed, true, 'Jean-Luc resolves to the Commander role');
assert.strictEqual(Q.authorityFor({ id: 'human', name: 'The Captain (Q; aka me)' }).level, 0, 'Captain/Q alias resolves to Clearance Level 0');
assert.strictEqual(Q.parseHierarchy(defaultHierarchy).entries.length, 12, 'Q reference includes all eleven Bridge posts and the human Captain');
assert.strictEqual(Q.authorityFor({ id: 'chief', name: 'FIRST OFFICER' }).level, 2, 'Number Two remains compatible with the First Officer role');
assert.match(Q.roleDirective('Number Two'), /FIRST OFFICER \(NUMBER TWO\) — CLEARANCE LEVEL 2/);
assert.match(Q.roleDirective('First Officer'), /halt that specific operation and await human intervention/);
assert.ok(Q.roleDirective('First Officer').includes(sharedEscalationText),
  'the First Officer receives the same escalation reference as Q');
assert.strictEqual(Q.roleDirective('Chief Security Officer'), '',
  'Chief Security Officer instructions are not stored or managed as a Q role directive');
assert.strictEqual(Q.authorityFor({ id: 'bridge-tactical', name: 'TACTICAL OFFICER' }).level, 2);
assert.strictEqual(Q.authorityFor({ id: 'new-agent', name: 'New Agent' }).level, null, 'non-Bridge crew has no assigned hierarchy level');
assert.strictEqual(Q.authorityFor({ id: 'new-agent', name: 'New Agent' }).listed, false);
assert.strictEqual(Q.parseHierarchy(defaultHierarchy).ok, true);
assert.strictEqual(Q.parseHierarchy(defaultHierarchy.replace('The Captain (Q; aka me) - Clearance Level 0', 'The Commander – Clearance Level 0')).ok, false);
assert.strictEqual(Q.parseHierarchy(defaultHierarchy + '\nQ — Level 0').ok, false);
assert.strictEqual(Q.parseHierarchy(defaultHierarchy + '\nTactical Officer — Level 2').ok, false, 'role aliases cannot receive conflicting rank entries');
let promptRefreshes = 0;
global.App = { persist: () => true, refreshAgentPrompts: () => { promptRefreshes++; return true; } };
assert.strictEqual(Q.setDirective('Protect the crew and keep the station operational.').ok, true);
assert.strictEqual(Q.directive(), 'Protect the crew and keep the station operational.');
assert.strictEqual(promptRefreshes, 1, 'saving the Prime Directive refreshes current agent prompts');
assert.deepStrictEqual(Q.setDirective('   '), { ok: false, error: 'The Prime Directive cannot be empty.' });
assert.strictEqual(Q.directive(), 'Protect the crew and keep the station operational.', 'an empty update does not remove the saved directive');
assert.strictEqual(Q.setQDirective('A human operating commitment.').ok, false, 'programmatic calls cannot authorize Q directive changes');
assert.strictEqual(Q.qDirective(), '', 'rejected Q directive updates leave the store unchanged');
assert.strictEqual(Q.setHierarchy(defaultHierarchy).ok, false, 'programmatic calls cannot authorize hierarchy changes');
assert.strictEqual(Q.setHierarchy(defaultHierarchy, new Event('click')).ok, false, 'untrusted events cannot authorize hierarchy changes');
assert.strictEqual(Q.hierarchy(), defaultHierarchy, 'rejected hierarchy changes leave the roster intact');
assert.strictEqual(Q.setHierarchy('   ').ok, false, 'an empty hierarchy cannot erase the reference roster');
assert.strictEqual(promptRefreshes, 1, 'rejected hierarchy changes do not refresh agent prompts');
assert.strictEqual(Q.setRoleDirective('commander', 'A commander directive.').ok, false, 'programmatic calls cannot authorize role directives');
assert.strictEqual(Q.roleDirective('commander'), '', 'rejected role directive updates leave the store unchanged');
assert.match(Q.promptClause({ id: 'agent', name: 'COMMANDER' }), /YOUR ROSTER ASSIGNMENT: The Commander — Clearance Level 1 \(listed\)/);
assert.doesNotMatch(Q.promptClause({ id: 'chief', name: 'FIRST OFFICER' }), /YOUR ROLE-SPECIFIC DIRECTIVE/);
assert.match(Q.promptClause({ id: 'new-agent', name: 'New Agent' }), /YOUR ROSTER ASSIGNMENT: New Agent — unlisted \(below all listed roles; no assigned clearance level\)/);
assert.match(Q.promptClause(), /Only Q \(Clearance Level 0, the human Commander\) may alter the hierarchy/);
delete global.App;
assert.match(Q.promptClause(), /PRIME DIRECTIVE — PROJECT-WIDE OPERATING RULES:[\s\S]*Protect the crew and keep the station operational\./);
assert.match(Q.promptClause(), /BRIDGE CREW HIERARCHY ROSTER \(Q REFERENCE\):[\s\S]*Chief Security Officer – Clearance Level 2/);
assert.strictEqual(Q.saveCommand('', 'status report', 'All systems nominal.').ok, true);
assert.strictEqual(Q.saveCommand('', 'status report', 'Duplicate.').ok, false);
assert.strictEqual(Q.saveCommand('', 'Status report', 'Case-sensitive command.').ok, true);

const input = [
  'I finished the report.',
  'Q_MESSAGE: The inventory is ready.',
  'Q_QUESTION: Should I send it now?',
  'Q_COMMAND: status report',
  'Q_COMMAND: STATUS REPORT',
  'Q_DIRECTIVE_REQUEST',
  'Q_HUMAN_DIRECTIVE_REQUEST',
  'Q_HIERARCHY_REQUEST',
  'Q_COORDINATION_REQUEST'
].join('\n');
const captured = Q.capture(input, 'engineer', 'workstream-1', 'run-1');
assert.strictEqual(captured.text, 'I finished the report.\nQ has no saved human operating directive.\nQ · BRIDGE CREW HIERARCHY ROSTER:\n' + defaultHierarchy + '\nQ · CREW COORDINATION AND ESCALATION POLICY:\n' + defaultCoordinationPolicy);
assert.deepStrictEqual(captured.received.map(row => row.kind), ['message', 'question', 'command', 'command', 'directive']);
assert.strictEqual(captured.received[2].matchedResponse, 'All systems nominal.');
assert.strictEqual(captured.received[3].matchedResponse, '');
assert.strictEqual(Q.hierarchy(), defaultHierarchy, 'the read-only coordination response cannot change the roster');
assert.strictEqual(Q.setCoordinationPolicy('Changed without Q interface.').ok, false,
  'programmatic calls cannot change the coordination policy');
assert.deepStrictEqual(Q.setCoordinationPolicy('   '), { ok: false, error: 'Only Q, acting through its trusted coordination-policy control, may change this policy.' });
const NativeEvent = global.Event;
const NativeElement = global.Element;
global.Event = class TrustedQEvent { constructor(target) { this.isTrusted = true; this.target = target; } };
global.Element = class QControl { closest(selector) { return selector === '[data-q-action="save-coordination-policy"]'; } };
const editedPolicy = defaultCoordinationPolicy + '\n\nQ-approved update.';
assert.strictEqual(Q.setCoordinationPolicy(editedPolicy, new Event(new Element())).ok, true,
  'Q can change the coordination policy through its trusted editor');
assert.strictEqual(Q.coordinationPolicy(), editedPolicy);
assert.strictEqual(Q.setCoordinationPolicy('  ', new Event(new Element())).ok, false,
  'Q cannot accidentally save an empty escalation policy');
assert.deepStrictEqual(Q.setCoordinationPolicy('x'.repeat(6001), new Event(new Element())),
  { ok: false, error: 'The crew coordination and escalation policy must be 6000 characters or fewer.' },
  'an oversized edit is rejected instead of silently truncated');
global.Event = NativeEvent;
global.Element = NativeElement;
assert.strictEqual(Q.capture(input, 'engineer', 'workstream-1', 'run-1').received.length, 0, 'same run markers are idempotent');
assert.strictEqual(Q.stripMarkers('visible\nQ_MESSAGE: hidden\nQ_HIERARCHY_REQUEST\nmore visible'), 'visible\nmore visible');
assert.strictEqual(Q.stripMarkers('visible\nQ_ROLE_DIRECTIVE_REQUEST: Commander\nmore visible'), 'visible\nmore visible');
assert.strictEqual(Q.stripMarkers('visible\nQ_HUMAN_DIRECTIVE_REQUEST\nmore visible'), 'visible\nmore visible');
assert.strictEqual(Q.stripMarkers('visible\nQ_COORDINATION_REQUEST\nmore visible'), 'visible\nmore visible');
assert.match(Q.promptClause(), /Q_DIRECTIVE_REQUEST/);
assert.match(Q.promptClause(), /Q_HUMAN_DIRECTIVE_REQUEST/);
assert.match(Q.promptClause(), /Q_HIERARCHY_REQUEST/);
assert.match(Q.promptClause(), /Q_COORDINATION_REQUEST/);

const question = Q.messages().find(row => row.kind === 'question');
assert.ok(question);
assert.strictEqual(Q.markReplied(question.id, 'Send it now.').ok, true);
assert.strictEqual(Q.messages().find(row => row.id === question.id).status, 'replied');
assert.strictEqual(Q.messages().find(row => row.id === question.id).response, 'Send it now.');
const note = Q.messages().find(row => row.kind === 'message');
assert.strictEqual(Q.markReplied(note.id, 'Queued note.', 'queued').ok, true);
assert.strictEqual(Q.messages().find(row => row.id === note.id).status, 'queued');

delete require.cache[require.resolve('../frontend/app/qterminal.js')];
const reloaded = require('../frontend/app/qterminal.js');
assert.strictEqual(reloaded.directive(), 'Protect the crew and keep the station operational.');
assert.strictEqual(reloaded.coordinationPolicy(), editedPolicy,
  'Q’s saved coordination policy persists across module reloads');
assert.strictEqual(reloaded.capture('Q_COORDINATION_REQUEST', 'engineer', 'workstream-1', 'policy-read').text,
  'Q · CREW COORDINATION AND ESCALATION POLICY:\n' + editedPolicy,
  'agents receive the current edited policy through Q_COORDINATION_REQUEST');
assert.strictEqual(reloaded.messages().length, 5, 'inbox records persist across module reloads');
assert.strictEqual(reloaded.messages().find(row => row.id === note.id).status, 'queued');
assert.strictEqual(reloaded.commands().length, 2);
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'the hierarchy roster persists across module reloads');
const snapshot = reloaded.serialize();
assert.strictEqual(snapshot.commands.length, 2);
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', commands: [], messages: [] }), true);
assert.strictEqual(reloaded.directive(), 'Restored directive.');
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'older saved Q state receives the default hierarchy');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: defaultHierarchy.replace('The Captain (Q; aka me) - Clearance Level 0', 'The Commander – Clearance Level 0') }), true);
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'invalid persisted rosters are replaced with the valid default');
const legacyHierarchy = [
  'Q — Level 0',
  'The Commander — Level 1',
  'The First Officer — Level 2',
  'Chief Ops Officer — Level 3',
  'Chief Security Officer — Level 2',
  'Chief Comm Officer — Level 3',
  'Chief Med Officer — Level 3',
  'Chief Science Officer — Level 3',
  'Chief Helm Officer — Level 3',
  'Chief Engineer — Level 3',
  'The Ambassador — Level 3',
  'The Treasurer — Level 2'
].join('\n');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: legacyHierarchy }), true);
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'the shipped legacy roster migrates to the Commander-provided hierarchy');
const customLegacyLevel = defaultHierarchy.replace('The Commander – Clearance Level 1', 'The Commander – Level 1');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: customLegacyLevel }), true);
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'saved custom Level N entries normalize to Clearance Level N');
const previousTheseusHierarchy = [
  'Q — Level 0',
  'The Commander — Level 1',
  'Number Two — Level 2',
  'Chief Engineer — Level 3',
  'Comms Officer — Level 3',
  'Embassador — Level 3',
  'Helm Officer — Level 3',
  'Med Officer — Level 3',
  'Sci Officer — Level 3',
  'Tactical Officer — Level 2',
  'The Treasurer — Level 2'
].join('\n');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: previousTheseusHierarchy }), true);
assert.strictEqual(reloaded.hierarchy(), defaultHierarchy, 'the previously shipped Theseus default migrates to the current hierarchy');
const levelFourChiefOpsHierarchy = defaultHierarchy.replace('Chief Ops Officer – Clearance Level 3', 'Chief Ops Officer – Clearance Level 4');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: levelFourChiefOpsHierarchy }), true);
assert.strictEqual(reloaded.authorityFor({ id: 'chief-ops', name: 'Chief Ops Officer' }).level, 3,
  'an existing Chief Ops assignment at Level 4 is corrected to Level 3');
assert.ok(reloaded.hierarchy().includes('Chief Ops Officer – Clearance Level 3'), 'the corrected Chief Ops level is reflected in the roster');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: defaultHierarchy }), true);
const commanderDirective = 'Commander role directive fixture.';
assert.strictEqual(reloaded.hydrate({
  directive: 'Restored directive.',
  qDirective: 'Q will lead predictably and fairly.',
  hierarchy: defaultHierarchy,
  roleDirectives: { commander: commanderDirective }
}), true);
assert.strictEqual(reloaded.qDirective(), 'Q will lead predictably and fairly.');
assert.strictEqual(reloaded.roleDirective('The Commander'), commanderDirective);
assert.match(reloaded.promptClause(), /Q’S HUMAN OPERATING DIRECTIVE:[\s\S]*Q will lead predictably and fairly\./);
assert.doesNotMatch(reloaded.promptClause({ id: 'agent', name: 'COMMANDER' }), /Commander role directive fixture\./);
global.App = { agents: () => [{ id: 'agent', name: 'COMMANDER' }] };
const qDirectiveReply = reloaded.capture('Q_HUMAN_DIRECTIVE_REQUEST', 'agent', 'workstream-1', 'run-4');
assert.strictEqual(qDirectiveReply.text, 'Q · HUMAN OPERATING DIRECTIVE:\nQ will lead predictably and fairly.');
const roleReply = reloaded.capture('Q_ROLE_DIRECTIVE_REQUEST', 'agent', 'workstream-1', 'run-2');
assert.match(roleReply.text, /no longer served by Q.*crew\.directive/);
const otherRoleReply = reloaded.capture('Q_ROLE_DIRECTIVE_REQUEST: First Officer', 'agent', 'workstream-1', 'run-3');
assert.match(otherRoleReply.text, /no longer served by Q.*crew\.directive/);
assert.strictEqual(reloaded.hydrate({
  directive: 'Restored directive.',
  hierarchy: defaultHierarchy,
  roleDirectives: { 'first-officer': 'Commander-customized First Officer instruction.' }
}), true);
assert.ok(reloaded.roleDirective('First Officer').startsWith('Commander-customized First Officer instruction.'));
assert.ok(reloaded.roleDirective('First Officer').includes(sharedEscalationText),
  'custom First Officer instructions retain the shared mandatory escalation reference');
assert.strictEqual(reloaded.hydrate({ directive: 'Restored directive.', hierarchy: defaultHierarchy, roleDirectives: { 'OVERLORD': 'Old title should not be recognized.' } }), true);
assert.strictEqual(reloaded.roleDirective('commander'), '', 'role directives do not retain the retired Overlord title as an alias');
delete global.App;
assert.match(reloaded.promptClause(), /Restored directive\./, 'saved Prime Directive is available in every composed agent prompt');
assert.strictEqual(reloaded.messages().length, 0);

{
  assert.equal(reloaded.title('prime'), '', 'legacy state retains its original unnumbered heading');
  assert.equal(reloaded.setTitle('prime', 'A-01 Prime').ok, false, 'title changes require the Q control');
  const priorEvent = global.Event, priorElement = global.Element;
  global.Event = class TrustedTitleEvent { constructor(target) { this.isTrusted = true; this.target = target; } };
  global.Element = class TitleControl { closest(selector) { return selector === '[data-q-action="save-title"]'; } };
  const event = new Event(new Element());
  for (const invalid of ['', 'A-1 Name', 'AA-01 Name', 'A-100 Name', 'A-01 ', 'A-01 First\nSecond', 'A-01 ' + 'x'.repeat(196)]) {
    assert.equal(reloaded.setTitle('prime', invalid, event).ok, false, 'invalid title rejected: ' + JSON.stringify(invalid));
  }
  assert.equal(reloaded.setTitle('role:unknown', 'A-01 Unknown', event).ok, false);
  for (const [key, value] of Object.entries({
    prime: 'P-01 Prime Directive', human: 'Q-02 Q Directive', hierarchy: 'H-03 Roster',
    coordination: 'C-04 Coordination', 'role:commander': 'R-05 Commander'
  })) assert.equal(reloaded.setTitle(key, value, event).ok, true, key + ' title saves');
  assert.equal(reloaded.directive(), 'Restored directive.', 'renaming preserves directive content');
  assert.equal(reloaded.hydrate({ ...reloaded.serialize(), qDirective: 'Human directive.',
    roleDirectives: { commander: 'Commander directive.' } }), true);
  const serialized = reloaded.serialize();
  assert.equal(reloaded.hydrate(serialized), true);
  delete require.cache[require.resolve('../frontend/app/qterminal.js')];
  const persisted = require('../frontend/app/qterminal.js');
  assert.deepStrictEqual(persisted.serialize().titles, serialized.titles, 'titles survive station snapshots and local reloads');
  assert.match(persisted.promptClause(), /TITLE: P-01 Prime Directive\nRestored directive\./);
  assert.match(persisted.promptClause(), /TITLE: H-03 Roster\nThe Captain/);
  assert.doesNotMatch(persisted.promptClause({ id: 'agent', name: 'COMMANDER' }), /TITLE: R-05 Commander\nCommander directive\./);
  assert.match(persisted.capture('Q_COORDINATION_REQUEST', 'agent', '', '').text, /TITLE: C-04 Coordination\n/);
  assert.match(persisted.capture('Q_HUMAN_DIRECTIVE_REQUEST', 'agent', '', '').text, /TITLE: Q-02 Q Directive\nHuman directive\./);
  assert.match(persisted.capture('Q_ROLE_DIRECTIVE_REQUEST: Commander', 'agent', '', '').text, /no longer served by Q/);
  const setItem = global.localStorage.setItem;
  global.localStorage.setItem = () => { throw new Error('test storage failure'); };
  const priorError = console.error;
  console.error = () => {};
  try {
    assert.equal(persisted.setTitle('prime', 'P-02 Unsaved', event).ok, false);
    assert.equal(persisted.title('prime'), 'P-01 Prime Directive', 'failed persistence does not change the in-memory title');
  } finally { global.localStorage.setItem = setItem; console.error = priorError; }
  global.Event = priorEvent; global.Element = priorElement;
}

{
  const priorEvent = global.Event, priorElement = global.Element;
  global.Event = class TrustedDraftEvent { constructor(target) { this.isTrusted = true; this.target = target; } };
  global.Element = class DraftControl { closest(selector) { return selector === '[data-q-action="save-draft"]'; } };
  const event = new Event(new Element());
  const activeText = reloaded.directive(), activeTitle = reloaded.title('prime');
  assert.equal(reloaded.saveDraft('prime', 'P-01 Updated', 'Draft text', {}).ok, false);
  assert.equal(reloaded.saveDraft('new', 'P-1 Invalid', 'Draft text', event).ok, false);
  assert.equal(reloaded.saveDraft('hierarchy', '', 'invalid roster', event).ok, false);
  assert.equal(reloaded.saveDraft('coordination', '', 'x'.repeat(6001), event).ok, false);
  assert.equal(reloaded.saveDraft('prime', 'P-01 Updated', 'Draft text', event).ok, true);
  const created = reloaded.saveDraft('new', 'N-01 New directive', 'New draft text', event);
  assert.equal(created.ok, true);
  assert.equal(reloaded.directive(), activeText, 'saving a draft does not activate it');
  assert.equal(reloaded.title('prime'), activeTitle, 'saving a draft does not rename the active directive');
  assert.doesNotMatch(reloaded.promptClause(), /Draft text|New draft text/, 'agents do not receive drafts');
  const state = reloaded.serialize();
  assert.equal(reloaded.hydrate(state), true);
  delete require.cache[require.resolve('../frontend/app/qterminal.js')];
  const persisted = require('../frontend/app/qterminal.js');
  assert.equal(persisted.drafts().prime.text, 'Draft text');
  assert.equal(persisted.drafts()[created.key].text, 'New draft text');
  assert.equal(persisted.directive(), activeText);
  const setItem = global.localStorage.setItem, consoleError = console.error;
  global.localStorage.setItem = () => { throw new Error('disk unavailable'); };
  console.error = () => {};
  try {
    assert.equal(persisted.saveDraft('prime', 'P-01 Updated', 'Unsaved replacement', event).ok, false);
    assert.equal(persisted.drafts().prime.text, 'Draft text', 'failed persistence preserves the previous draft');
  } finally {
    global.localStorage.setItem = setItem;
    console.error = consoleError;
  }
  const consoleWarn = console.warn;
  global.App = { persist: () => false };
  console.warn = () => {};
  try {
    assert.equal(persisted.saveDraft('prime', 'P-01 Updated', 'Station save failed', event).ok, false);
    assert.equal(JSON.parse(saved.get('starnet.q-terminal.v1')).drafts.prime.text, 'Draft text',
      'failed station persistence does not leave a newer local draft that will be overwritten at startup');
  } finally {
    delete global.App;
    console.warn = consoleWarn;
  }
  const collisionState = persisted.serialize();
  collisionState.nextId = 1;
  collisionState.drafts['custom:q1'] = { title: 'C-01 Existing', text: 'Keep me', savedAt: 1 };
  assert.equal(persisted.hydrate(collisionState), true);
  const another = persisted.saveDraft('new', 'C-02 Another', 'Do not overwrite', event);
  assert.equal(another.ok, true);
  assert.notEqual(another.key, 'custom:q1');
  assert.equal(persisted.drafts()['custom:q1'].text, 'Keep me');
  global.Event = priorEvent; global.Element = priorElement;
}

console.log('Q terminal: exact command matching, local persistence, marker capture, deduplication, and replies passed.');
