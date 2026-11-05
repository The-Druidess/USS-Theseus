'use strict';
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');

const saved = new Map();
saved.set('starnet.q-terminal.v1', JSON.stringify({ directive: '' }));
global.localStorage = {
  getItem: key => saved.has(key) ? saved.get(key) : null,
  setItem: (key, value) => saved.set(key, value)
};
const Q = require('../frontend/app/qterminal.js');
const qWindowSource = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/q.js'), 'utf8');
assert.ok(qWindowSource.includes('id="q-coordination-policy"') &&
  qWindowSource.includes('data-q-action="save-coordination-policy"'),
  'Q has a dedicated editable coordination-policy control');
assert.ok(/setCoordinationPolicy\(body\.querySelector\('#q-coordination-policy'\)\.value, event\)/.test(qWindowSource),
  'Q interface save uses the trusted event-gated policy setter');

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
assert.match(Q.promptClause({ id: 'chief', name: 'FIRST OFFICER' }), /YOUR ROLE-SPECIFIC DIRECTIVE — THE FIRST OFFICER:[\s\S]*FIRST OFFICER \(NUMBER TWO\) — CLEARANCE LEVEL 2/);
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
assert.match(reloaded.promptClause({ id: 'agent', name: 'COMMANDER' }), /YOUR ROLE-SPECIFIC DIRECTIVE — THE COMMANDER:[\s\S]*Commander role directive fixture\./);
global.App = { agents: () => [{ id: 'agent', name: 'COMMANDER' }] };
const qDirectiveReply = reloaded.capture('Q_HUMAN_DIRECTIVE_REQUEST', 'agent', 'workstream-1', 'run-4');
assert.strictEqual(qDirectiveReply.text, 'Q · HUMAN OPERATING DIRECTIVE:\nQ will lead predictably and fairly.');
const roleReply = reloaded.capture('Q_ROLE_DIRECTIVE_REQUEST', 'agent', 'workstream-1', 'run-2');
assert.strictEqual(roleReply.text, 'Q · DIRECTIVE FOR THE COMMANDER:\n' + commanderDirective);
const otherRoleReply = reloaded.capture('Q_ROLE_DIRECTIVE_REQUEST: First Officer', 'agent', 'workstream-1', 'run-3');
assert.strictEqual(otherRoleReply.text, 'Q · DIRECTIVE FOR FIRST OFFICER:\n' + reloaded.roleDirective('First Officer'));
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

console.log('Q terminal: exact command matching, local persistence, marker capture, deduplication, and replies passed.');
