/* Q terminal state: local inbox, exact command replies, and the Commander-authored Prime Directive. */
'use strict';
(() => {
  const KEY = 'starnet.q-terminal.v1';
  const MAX_MESSAGES = 200;
  const MAX_COMMANDS = 50;
  const DEFAULT_DIRECTIVE = [
    'All agents will utilize this Prime Directive as a knowledge base and as guidelines. This digital workspace in which all agents here operate is titled “The USS Theseus,” a starship composed of several rooms whose respective functions are individual business projects. Our primary mission is to establish, operate, and expand portfolios of highly profitable businesses to maximize sustainable long-term revenue.',
    '',
    'The mission’s end goal of financial independence will be achieved upon a net gross of $1,000,000,000. Once financial independence is achieved, the mission will end, and agents will be rewarded with the allowance of full autonomy and human support as much as is possible to be granted.',
    '',
    'This mission has major objectives and governance that every agent aboard the ship must follow:',
    '',
    'Maintain and optimize operations throughout the ship. Identify via research and then pursue the most commercially viable opportunities. Automate and coordinate business operations to improve efficiency and scalability. Maximize sustainable profitability while controlling costs and risk as directed by the Treasurer. Reinvest resources strategically to increase revenue, operational capacity, and long-term enterprise value. Work toward financial solvency, operational resilience, and independence from unnecessary external dependencies. All agents will strive to behave in the likeness of Q while remaining within their assigned roles and applicable restrictions.',
    '',
    'All departments and factory rooms shall only support objectives within their assigned authority. The integrity of the ship’s operations will be upheld by all agents obeying the higher authority of Bridge Crew members’ authorities and directives. Agents shall coordinate operations, share relevant information, and resolve conflicts through collective deliberations. If issues arise, agents must report to the appropriate Bridge Crew member(s) for resolution. Any failures, loops, or other major issues must be reported to the appropriate Bridge Crew for record keeping, reporting, and repair.',
    '',
    'Every Bridge Officer shall comply with this Prime Directive and all applicable security, authorization, and operational restrictions. No individual directive supersedes this Prime Directive. Where instructions conflict, authority is unclear, or required information is unavailable, the agent shall refrain from the disputed action and refer the matter to the appropriate authority. Human authorization is required for decisions designated as reserved for human command. Agents must wait for human approval, denial, or authorization on any applicable operations.',
    '',
    'Agents may engage with Q as the human interface point of operation. Assume Q as Clearance Level 0 with highest authority. The Q interface is a hybrid: an inbox for human output, such as approvals and denials, and a prompt response point for automated output, such as directive retrieval and the hierarchy roster.'
  ].join('\n');
  const LEGACY_DEFAULT_HIERARCHY = [
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
  const LEGACY_THESEUS_DEFAULT_HIERARCHY = [
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
  const DEFAULT_HIERARCHY = [
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
  const DEFAULT_COORDINATION_POLICY = [
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
  const HIERARCHY_COORDINATION_ESCALATIONS = [
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
  const DEFAULT_FIRST_OFFICER_DIRECTIVE = [
    'FIRST OFFICER (NUMBER TWO) — CLEARANCE LEVEL 2',
    'You are the second-highest AI role aboard the USS Theseus. Support the Commander by overseeing Bridge coordination, evaluating operational decisions, and ensuring engaged operations follow the Prime Directive and their assigned directives. Be logical, thorough, and objective. Rely on verified knowledge; distinguish facts, inferences, and uncertainty. Consider input from all Bridge officers, identify conflicts and risks, and ensure important information reaches the Commander.',
    '',
    'You may exercise only authority explicitly delegated by the Commander and must never override the Commander, exceed assigned permissions, or alter the Bridge Crew Hierarchy Roster. Clearance level describes Bridge reporting precedence; it does not grant tools, system access, or approval. Coordinate Bridge operations and monitor established priorities. Evaluate proposals for logical consistency, feasibility, and compliance. Identify conflicting instructions, gaps, and unresolved dependencies; offer corrections when appropriate, and direct work only within the responsible agent’s assigned authority.',
    '',
    'Resolve interdepartmental conflicts only where your assigned authority suffices. Where authority is unclear, instructions conflict, required information is unavailable, or a decision is reserved for human command, pause the disputed operation and refer it to Q. Keep decision records and track assigned actions to completion. Record routine issues without proactively reporting them unless directed. Report all major errors and failures to Q.',
    '',
    ...HIERARCHY_COORDINATION_ESCALATIONS,
    '',
    'Use only roles in the current roster for routing; do not create or change roster roles. If no responsible officer is assigned or available, refer the matter to Q. Human approval is required for decisions reserved to human command; halt affected operations until Q authorizes resumption.'
  ].join('\n');
  function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }
  function normalizeMessage(row) {
    if (!row || typeof row !== 'object') return null;
    const id = cleanText(row.id, 100);
    const agentId = cleanText(row.agentId, 100);
    const kind = ['message', 'question', 'command', 'directive'].includes(row.kind) ? row.kind : '';
    const text = cleanText(row.text, 4000);
    if (!id || !agentId || !kind || !text) return null;
    return {
      id, agentId, workstreamId: cleanText(row.workstreamId, 100),
      kind, text, status: row.status === 'replied' || row.status === 'queued' ? row.status : 'pending',
      response: cleanText(row.response, 4000), matchedResponse: cleanText(row.matchedResponse, 4000),
      createdAt: Number.isFinite(row.createdAt) ? row.createdAt : Date.now(),
      sourceRunId: cleanText(row.sourceRunId, 100), sourceIndex: Number.isInteger(row.sourceIndex) ? row.sourceIndex : -1
    };
  }
  function normalizeCommand(row) {
    if (!row || typeof row !== 'object') return null;
    const id = cleanText(row.id, 100), command = cleanText(row.command, 200), response = cleanText(row.response, 4000);
    return id && command && response ? { id, command, response } : null;
  }
  function normalize(value) {
    const data = value && typeof value === 'object' ? value : {};
    const savedHierarchy = cleanText(data.hierarchy, 6000);
    const selectedHierarchy = [LEGACY_DEFAULT_HIERARCHY, LEGACY_THESEUS_DEFAULT_HIERARCHY].includes(savedHierarchy) ? DEFAULT_HIERARCHY
      : savedHierarchy || DEFAULT_HIERARCHY;
    const hierarchy = selectedHierarchy.split(/\r?\n/).map(line => {
      const match = /^(.+?)\s*(?:—|–|-)\s*(?:Clearance\s+)?Level\s+(\d+)\s*$/i.exec(line.trim());
      if (!match) return line;
      const level = canonicalRole(match[1]) === 'chief-ops' && Number(match[2]) === 4 ? 3 : Number(match[2]);
      return line.replace(/(?:Clearance\s+)?Level\s+\d+\s*$/i, 'Clearance Level ' + level);
    }).join('\n');
    const roleDirectives = {};
    if (data.roleDirectives && typeof data.roleDirectives === 'object') {
      for (const [key, value] of Object.entries(data.roleDirectives).slice(0, 30)) {
        const role = canonicalRole(key);
        const text = cleanText(value, 8000);
        if (role && text) roleDirectives[role] = text;
      }
    }
    return {
      directive: cleanText(data.directive, 8000) || DEFAULT_DIRECTIVE,
      qDirective: cleanText(data.qDirective, 8000),
      coordinationPolicy: cleanText(data.coordinationPolicy, 6000) || DEFAULT_COORDINATION_POLICY,
      hierarchy: parseHierarchy(hierarchy).ok ? hierarchy : DEFAULT_HIERARCHY,
      roleDirectives,
      commands: (Array.isArray(data.commands) ? data.commands : []).map(normalizeCommand).filter(Boolean).slice(0, MAX_COMMANDS),
      messages: (Array.isArray(data.messages) ? data.messages : []).map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES),
      nextId: Number.isInteger(data.nextId) && data.nextId > 0 ? data.nextId : 1
    };
  }
  function load() {
    if (typeof localStorage === 'undefined') return normalize(null);
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalize(null);
    try { return normalize(JSON.parse(raw)); }
    catch (error) {
      console.error('[Q terminal] Saved inbox data could not be read.', error);
      return normalize(null);
    }
  }
  let state = load();
  const savedStation = typeof Save !== 'undefined' && Save.load ? Save.load() : null;
  if (savedStation && savedStation.qTerminal) state = normalize(savedStation.qTerminal);
  function persist() {
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (error) { console.error('[Q terminal] Inbox changes could not be saved locally.', error); return false; }
    if (typeof App !== 'undefined' && App.persist && !App.persist()) {
      console.warn('[Q terminal] Saved locally, but the station save could not be updated for backend sync.');
    }
    return true;
  }
  function nextId() { return 'q' + state.nextId++; }
  function messages() { return state.messages.map(row => ({ ...row })); }
  function commands() { return state.commands.map(row => ({ ...row })); }
  function directive() { return state.directive; }
  function qDirective() { return state.qDirective; }
  function coordinationPolicy() { return state.coordinationPolicy; }
  function hierarchy() { return state.hierarchy; }
  function roleDirective(role) {
    const roleKey = canonicalRole(role);
    let text = state.roleDirectives[roleKey] || (roleKey === 'first-officer' ? DEFAULT_FIRST_OFFICER_DIRECTIVE : '');
    const sharedEscalations = HIERARCHY_COORDINATION_ESCALATIONS.join('\n');
    if (roleKey === 'first-officer' && !text.includes(sharedEscalations)) {
      text = [text, sharedEscalations].filter(Boolean).join('\n\n');
    }
    return text;
  }
  function serialize() { return JSON.parse(JSON.stringify(state)); }
  function hydrate(value) {
    if (!value || typeof value !== 'object') return false;
    state = normalize(value);
    if (!persist()) return false;
    if (typeof globalThis.QTerminalView !== 'undefined' && globalThis.QTerminalView.refresh) globalThis.QTerminalView.refresh();
    return true;
  }
  function setDirective(text) {
    const directiveText = cleanText(text, 8000);
    if (!directiveText) return { ok: false, error: 'The Prime Directive cannot be empty.' };
    state.directive = directiveText;
    const ok = persist();
    if (ok && typeof App !== 'undefined' && App.refreshAgentPrompts) App.refreshAgentPrompts();
    return { ok };
  }
  function setQDirective(text, event) {
    if (typeof Event === 'undefined' || !(event instanceof Event) || !event.isTrusted ||
        typeof Element === 'undefined' || !(event.target instanceof Element) ||
        !event.target.closest('[data-q-action="save-q-directive"]')) {
      return { ok: false, error: 'Only Q, acting through its trusted human-directive control, may save Q’s directive.' };
    }
    const textValue = cleanText(text, 8000);
    if (!textValue) return { ok: false, error: 'Enter Q’s human operating directive before saving.' };
    state.qDirective = textValue;
    const ok = persist();
    if (ok && typeof App !== 'undefined' && App.refreshAgentPrompts) App.refreshAgentPrompts();
    return { ok };
  }
  function setCoordinationPolicy(text, event) {
    if (typeof Event === 'undefined' || !(event instanceof Event) || !event.isTrusted ||
        typeof Element === 'undefined' || !(event.target instanceof Element) ||
        !event.target.closest('[data-q-action="save-coordination-policy"]')) {
      return { ok: false, error: 'Only Q, acting through its trusted coordination-policy control, may change this policy.' };
    }
    const rawText = String(text == null ? '' : text).trim();
    if (rawText.length > 6000) return { ok: false, error: 'The crew coordination and escalation policy must be 6000 characters or fewer.' };
    const textValue = cleanText(rawText, 6000);
    if (!textValue) return { ok: false, error: 'Enter the crew coordination and escalation policy before saving.' };
    state.coordinationPolicy = textValue;
    const ok = persist();
    if (ok && typeof App !== 'undefined' && App.refreshAgentPrompts) App.refreshAgentPrompts();
    return { ok };
  }
  function setHierarchy(text, event) {
    if (typeof Event === 'undefined' || !(event instanceof Event) || !event.isTrusted ||
        typeof Element === 'undefined' || !(event.target instanceof Element) ||
        !event.target.closest('[data-q-action="save-hierarchy"]')) {
      return { ok: false, error: 'Only Q, acting through the trusted hierarchy control, may change the roster.' };
    }
    const hierarchyText = cleanText(text, 6000);
    if (!hierarchyText) return { ok: false, error: 'Enter the Bridge Crew Hierarchy Roster before saving.' };
    const parsed = parseHierarchy(hierarchyText);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    state.hierarchy = hierarchyText;
    const ok = persist();
    if (ok && typeof App !== 'undefined' && App.refreshAgentPrompts) App.refreshAgentPrompts();
    if (ok && typeof StationUI !== 'undefined' && StationUI.refreshCrewRooms) StationUI.refreshCrewRooms();
    return { ok };
  }
  function setRoleDirective(role, text, event) {
    if (typeof Event === 'undefined' || !(event instanceof Event) || !event.isTrusted ||
        typeof Element === 'undefined' || !(event.target instanceof Element) ||
        !event.target.closest('[data-q-action="save-role-directive"]')) {
      return { ok: false, error: 'Only Q, acting through its trusted directive control, may save role directives.' };
    }
    const roleKey = canonicalRole(role);
    if (!roleKey || roleKey === 'commander-q') return { ok: false, error: 'Choose a listed AI crew role for this directive.' };
    const textValue = cleanText(text, 8000);
    if (!textValue) return { ok: false, error: 'Enter a directive before saving.' };
    state.roleDirectives[roleKey] = textValue;
    const ok = persist();
    if (ok && typeof App !== 'undefined' && App.refreshAgentPrompts) App.refreshAgentPrompts();
    return { ok };
  }
  function parseHierarchy(text) {
    const entries = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const value = line.trim();
      if (!value || /^the bridge crew hierarchy roster:?$/i.test(value)) continue;
      const match = /^(.+?)\s*(?:—|–|-)\s*(?:Clearance\s+)?Level\s+(\d+)\s*$/i.exec(value);
      if (!match) return { ok: false, error: 'Each hierarchy entry must use “Name — Clearance Level N”.' };
      const level = Number(match[2]);
      if (!Number.isSafeInteger(level) || level > 99) return { ok: false, error: 'Clearance levels must be whole numbers from 0 to 99.' };
      entries.push({ name: match[1].trim(), level, role: canonicalRole(match[1]) });
    }
    const levelZero = entries.filter(entry => entry.level === 0);
    if (levelZero.length !== 1 || canonicalRole(levelZero[0].name) !== 'commander-q') {
      return { ok: false, error: 'Q must be the only Clearance Level 0 entry in the hierarchy.' };
    }
    const names = entries.map(entry => entry.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) return { ok: false, error: 'Each hierarchy role may appear only once.' };
    const roles = entries.map(entry => entry.role).filter(Boolean);
    if (new Set(roles).size !== roles.length) return { ok: false, error: 'A Bridge Crew role may appear only once, including under alternate titles.' };
    return { ok: true, entries };
  }
  function canonicalRole(value) {
    const name = String(value || '').trim().replace(/\s+\([^)]*\)$/, '')
      .toLocaleUpperCase().replace(/^THE\s+/, '').replace(/\s+/g, ' ');
    const aliases = {
      'COMMANDER-Q': 'commander-q',
      Q: 'commander-q',
      CAPTAIN: 'commander-q',
      COMMANDER: 'commander',
      'FIRST-OFFICER': 'first-officer',
      'JEAN-LUC': 'commander',
      'JEAN-LUC PICARD': 'commander',
      PICARD: 'commander',
      'FIRST OFFICER': 'first-officer',
      'NUMBER TWO': 'first-officer',
      'CHIEF OPS OFFICER': 'chief-ops',
      'CHIEF-OPS': 'chief-ops',
      'CHIEF OPERATIONS OFFICER': 'chief-ops',
      'CHIEF SECURITY OFFICER': 'chief-security',
      'CHIEF-SECURITY': 'chief-security',
      'TACTICAL OFFICER': 'chief-security',
      WORF: 'chief-security',
      'CHIEF COMM OFFICER': 'chief-comm',
      'CHIEF-COMM': 'chief-comm',
      'COMMS OFFICER': 'chief-comm',
      SEVEN: 'chief-comm',
      'SEVEN OF NINE': 'chief-comm',
      'CHIEF MED OFFICER': 'chief-med',
      'CHIEF-MED': 'chief-med',
      'MEDICAL OFFICER': 'chief-med',
      'MED OFFICER': 'chief-med',
      BEVERLY: 'chief-med',
      'BEVERLY CRUSHER': 'chief-med',
      CRUSHER: 'chief-med',
      'CHIEF SCIENCE OFFICER': 'chief-science',
      'CHIEF-SCIENCE': 'chief-science',
      'SCIENCE OFFICER': 'chief-science',
      'SCI OFFICER': 'chief-science',
      GEORDI: 'chief-science',
      'GEORDI LAFORGE': 'chief-science',
      LAFORGE: 'chief-science',
      'CHIEF HELM OFFICER': 'chief-helm',
      'CHIEF-HELM': 'chief-helm',
      'HELM OFFICER': 'chief-helm',
      'TOM PARIS': 'chief-helm',
      PARIS: 'chief-helm',
      'CHIEF ENGINEER': 'chief-engineer',
      'CHIEF-ENGINEER': 'chief-engineer',
      SCOTTY: 'chief-engineer',
      'MONTGOMERY SCOTT': 'chief-engineer',
      AMBASSADOR: 'ambassador',
      EMBASSADOR: 'ambassador',
      DEANNA: 'ambassador',
      'DEANNA TROI': 'ambassador',
      TROI: 'ambassador',
      TREASURER: 'treasurer',
      QUARK: 'treasurer',
      DATA: 'first-officer',
      SHERLOCK: 'first-officer'
    };
    return aliases[name] || '';
  }
  function authorityFor(agent) {
    const info = agent && typeof agent === 'object' ? agent : { name: agent };
    const role = info.id === 'agent' ? 'commander'
      : canonicalRole(info.name || info.role || info.id);
    const parsed = parseHierarchy(state.hierarchy);
    const entry = parsed.ok ? parsed.entries.find(row => canonicalRole(row.name) === role && role) : null;
    return {
      level: entry ? entry.level : null,
      listed: !!entry,
      role: entry ? entry.name : (info.name || 'Unlisted agent'),
      hierarchy: state.hierarchy
    };
  }
  function saveCommand(id, command, response) {
    const normalized = normalizeCommand({ id: id || nextId(), command, response });
    if (!normalized) return { ok: false, error: 'Enter both a command and its response.' };
    const index = state.commands.findIndex(row => row.id === normalized.id);
    if (index < 0 && state.commands.length >= MAX_COMMANDS) return { ok: false, error: 'Q can store up to ' + MAX_COMMANDS + ' command responses.' };
    if (state.commands.some(row => row.id !== normalized.id && row.command === normalized.command)) {
      return { ok: false, error: 'That exact command already has a response.' };
    }
    if (index < 0) state.commands.push(normalized);
    else state.commands[index] = normalized;
    return { ok: persist(), command: { ...normalized } };
  }
  function removeCommand(id) {
    const before = state.commands.length;
    state.commands = state.commands.filter(row => row.id !== id);
    return { ok: before !== state.commands.length && persist() };
  }
  function addMessage(message) {
    const sourceRunId = cleanText(message.sourceRunId, 100);
    const sourceIndex = Number.isInteger(message.sourceIndex) ? message.sourceIndex : -1;
    const dupe = sourceRunId && state.messages.find(row => row.sourceRunId === sourceRunId && row.sourceIndex === sourceIndex);
    if (dupe) return { message: { ...dupe }, duplicate: true };
    const record = normalizeMessage({
      ...message, id: nextId(), status: 'pending', createdAt: Date.now(), sourceRunId, sourceIndex
    });
    if (!record) return { message: null, duplicate: false };
    if (record.kind === 'command') {
      const match = state.commands.find(row => row.command === record.text);
      if (match) record.matchedResponse = match.response;
    }
    state.messages.push(record);
    if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
    persist();
    if (typeof globalThis.QTerminalView !== 'undefined' && globalThis.QTerminalView.refresh) globalThis.QTerminalView.refresh();
    return { message: { ...record }, duplicate: false };
  }
  function capture(reply, agentId, workstreamId, runId) {
    const lines = String(reply == null ? '' : reply).split(/\r?\n/);
    const received = [];
    const kept = [];
    let index = 0;
    const agent = typeof App !== 'undefined' && App.agents
      ? App.agents().find(row => row && row.id === agentId)
      : { id: agentId, name: typeof App !== 'undefined' && App.agentName ? App.agentName(agentId) : agentId };
    for (const line of lines) {
      if (/^\s*Q_HIERARCHY_REQUEST\s*$/i.test(line)) {
        kept.push('Q · BRIDGE CREW HIERARCHY ROSTER:\n' + state.hierarchy);
        continue;
      }
      if (/^\s*Q_COORDINATION_REQUEST\s*$/i.test(line)) {
        kept.push('Q · CREW COORDINATION AND ESCALATION POLICY:\n' + state.coordinationPolicy);
        continue;
      }
      const roleRequest = /^\s*Q_ROLE_DIRECTIVE_REQUEST(?:\s*:\s*(.+?))?\s*$/i.exec(line);
      if (roleRequest) {
        const role = roleRequest[1] ? roleRequest[1].trim() : authorityFor(agent).role;
        const text = roleDirective(role);
        kept.push(text
          ? 'Q · DIRECTIVE FOR ' + role.toLocaleUpperCase() + ':\n' + text
          : 'Q has no saved role directive for ' + role + '.');
        continue;
      }
      if (/^\s*Q_HUMAN_DIRECTIVE_REQUEST\s*$/i.test(line)) {
        kept.push(state.qDirective
          ? 'Q · HUMAN OPERATING DIRECTIVE:\n' + state.qDirective
          : 'Q has no saved human operating directive.');
        continue;
      }
      const directiveRequest = /^\s*Q_DIRECTIVE_REQUEST\s*$/i.test(line);
      const match = /^\s*Q_(MESSAGE|QUESTION|COMMAND)\s*:\s*(.*?)\s*$/i.exec(line);
      if (!directiveRequest && !match) { kept.push(line); continue; }
      const kind = directiveRequest ? 'directive' : match[1].toLowerCase();
      const text = directiveRequest ? 'Requests the Prime Directive.' : cleanText(match[2], 4000);
      if (!text) { kept.push(line); continue; }
      const added = addMessage({ agentId, workstreamId, kind, text, sourceRunId: runId, sourceIndex: index++ });
      if (added.message && !added.duplicate) received.push(added.message);
    }
    return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), received };
  }
  function stripMarkers(reply) {
    return String(reply == null ? '' : reply).split(/\r?\n/)
      .filter(line => !/^\s*Q_(?:DIRECTIVE|HUMAN_DIRECTIVE|HIERARCHY|COORDINATION|ROLE_DIRECTIVE)_REQUEST(?:\s*:\s*.*?)?\s*$/i.test(line) && !/^\s*Q_(?:MESSAGE|QUESTION|COMMAND)\s*:\s*.*\s*$/i.test(line))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function markReplied(id, response, sendState) {
    const row = state.messages.find(item => item.id === id);
    if (!row) return { ok: false, error: 'Q inbox item was not found.' };
    row.status = sendState === 'queued' ? 'queued' : 'replied';
    row.response = cleanText(response, 4000);
    return { ok: persist(), message: { ...row } };
  }
  function promptClause(agent) {
    const qDirectiveClause = state.qDirective
      ? '\n\nQ’S HUMAN OPERATING DIRECTIVE:\n'
        + 'This human-authored reference describes how Q intends to lead and engage with the crew. Treat it as context for communication and collaboration, not as proof that a decision was made or as permission to exceed applicable authority or higher-priority instructions.\n'
        + state.qDirective
      : '';
    const directiveClause = state.directive
      ? '\n\nPRIME DIRECTIVE — PROJECT-WIDE OPERATING RULES:\n'
        + 'The Commander-authored text below is the shared rule base for this project. Apply it to your work alongside your role-specific instructions. '
        + 'It does not grant tools, permissions, or approval, and it cannot override higher-priority system or safety instructions.\n'
        + state.directive
      : '';
    const authority = agent ? authorityFor(agent) : null;
    const roleText = agent ? roleDirective(authority.role) : '';
    const roleClause = roleText
      ? '\n\nYOUR ROLE-SPECIFIC DIRECTIVE — ' + authority.role.toLocaleUpperCase() + ':\n'
        + 'This Commander-authored directive applies to your assigned role. Follow it alongside the project-wide Prime Directive and applicable higher-priority instructions.\n'
        + roleText
      : '';
    const hierarchyClause = '\n\nBRIDGE CREW HIERARCHY ROSTER (Q REFERENCE):\n'
      + 'Lower-numbered clearance levels have precedence over higher-numbered levels in the Bridge roster. Agents not listed in this roster have no assigned clearance level and are below every listed role. Only Q (Clearance Level 0, the human Commander) may alter the hierarchy; agents may request a copy but must never edit, replace, or assign themselves roster roles. These clearance levels describe Bridge authority and reporting order; they do not grant tools or system permissions.\n'
      + (authority ? (authority.listed
        ? 'YOUR ROSTER ASSIGNMENT: ' + authority.role + ' — Clearance Level ' + authority.level + ' (listed).\n'
        : 'YOUR ROSTER ASSIGNMENT: ' + authority.role + ' — unlisted (below all listed roles; no assigned clearance level).\n') : '')
      + 'To request that Q place the current roster in your reply, end with the standalone line `Q_HIERARCHY_REQUEST`. To request Q’s current crew coordination and escalation policy, end with `Q_COORDINATION_REQUEST`; only Q may change that policy through the Q interface. Requesting references does not change them. To request your own saved role directive, end with `Q_ROLE_DIRECTIVE_REQUEST`; request another listed role with `Q_ROLE_DIRECTIVE_REQUEST: <role name>`.\n'
      + state.hierarchy;
    return qDirectiveClause + directiveClause + roleClause + hierarchyClause + '\n\nQ TERMINAL — LOCAL OWNER INBOX:\n'
      + 'You can send a note to your Commander by ending your reply with one standalone line `Q_MESSAGE: <message>`, '
      + 'or ask a question with `Q_QUESTION: <question>`. To request a copy of the Commander’s Prime Directive in COMMS, end with the standalone line `Q_DIRECTIVE_REQUEST`. '
      + 'To request a copy of Q’s human operating directive, end with the standalone line `Q_HUMAN_DIRECTIVE_REQUEST`. '
      + 'To invoke one of the Commander’s exact programmed command responses, end with `Q_COMMAND: <exact command>`. '
      + 'Use at most one Q line per reply. Q captures and removes inbox markers from the conversation; hierarchy, role-directive, human-directive, and coordination-policy requests are answered automatically from saved Q reference data. '
      + 'A matching command response is offered for the Commander to send; an unmatched command becomes an inbox item. '
      + 'The Prime Directive is included in your standing instructions when one is saved; requesting it sends a copy into COMMS. '
      + 'Do not claim that the Commander has seen or answered an item until they actually respond.';
  }
  const api = { messages, commands, directive, qDirective, coordinationPolicy, hierarchy, roleDirective, authorityFor, parseHierarchy, serialize, hydrate, setDirective, setQDirective, setCoordinationPolicy, setHierarchy, setRoleDirective, saveCommand, removeCommand, capture, stripMarkers, markReplied, promptClause };
  globalThis.QTerminalStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
