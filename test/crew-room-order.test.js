'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');
const qPresenceStatus = Function(A.fnBody(source, 'function qPresenceStatus(') + '; return qPresenceStatus;')();
A.eq(['OFFLINE', 'BUSY', 'ONLINE', 'ONLINE', 'AWAY'], [
  qPresenceStatus(5000, 0, null, false),
  qPresenceStatus(10000, 0, 0, true),
  qPresenceStatus(10001, 0, 0, true),
  qPresenceStatus(90000, 0, null, true),
  qPresenceStatus(90001, 0, null, true)
], 'Q presence follows connection, 10-second BUSY, and 90-second AWAY thresholds');
A.ok(/pointerdown', humanActivity[\s\S]*keydown', humanActivity[\s\S]*input', humanActivity/.test(source),
  'Q BUSY state tracks trusted pointer, keyboard, and text input activity');
A.ok(/online', refresh[\s\S]*offline', refresh[\s\S]*visibilitychange', refresh[\s\S]*setInterval\(crewTick, 1000\)/.test(source),
  'Q presence refreshes on frontend connection changes and its idle thresholds');
let presenceNow = 10000, lastInteractionAt = 0, lastBusyAt = 0, frontendConnected = true;
const presenceLabel = { textContent: '', dataset: {} };
const presenceRow = { hidden: false, querySelector: () => presenceLabel };
const presenceList = { querySelector: selector => selector === '[data-q-terminal]' ? presenceRow : null };
const presenceContext = vm.createContext({
  present: [], crewPortals: [], runningAgents: new Map(), runSeenAt: new Map(),
  activity: () => '', App: { currentAgent: () => null }, agentLive: () => false,
  crewQuery: '', lineTestOnly: () => false, LINE_TEST_TIP: '', lastStageSummary: '',
  qLastInteractionAt: lastInteractionAt, qLastBusyAt: lastBusyAt, qFrontendConnected: () => frontendConnected,
  qPresenceStatus, Date: { now: () => presenceNow },
  $: selector => selector === '#crew' ? presenceList : null
});
const presenceTick = vm.runInContext('(' + A.fnBody(source, 'function crewTick()') + ')', presenceContext);
presenceTick();
A.eq(presenceLabel.textContent, 'BUSY', 'crew tick paints the active Q presence state');
presenceNow = 10001; presenceTick();
A.eq(presenceLabel.textContent, 'ONLINE', 'crew tick transitions Q to ONLINE after the busy window');
presenceNow = 90001; presenceTick();
A.eq(presenceLabel.textContent, 'AWAY', 'crew tick transitions Q to AWAY after 90 seconds');
frontendConnected = false; presenceTick();
A.eq(presenceLabel.textContent, 'OFFLINE', 'crew tick reports Q offline when the frontend disconnects');
const levels = { 'Tactical Officer': 2, 'Treasurer': 2, 'Chief Engineer': 3 };
const roles = { 'Tactical Officer': 'Chief Security Officer', Treasurer: 'The Treasurer', 'Chief Engineer': 'Chief Engineer' };
const QTerminalStore = {
  authorityFor: agent => ({
    level: Object.prototype.hasOwnProperty.call(levels, agent.name) ? levels[agent.name] : null,
    role: roles[agent.name] || ''
  })
};
const order = Function('QTerminalStore', A.fnBody(source, 'function crewManifestOrder(') + '; return crewManifestOrder;')(QTerminalStore);
const rooms = {
  bridge: { id: 'bridge', name: 'THE BRIDGE', kind: 'bridge' },
  etsy: { id: 'etsy', name: 'ETSY', kind: 'hab' },
  fiverr: { id: 'fiverr', name: 'FIVERR', kind: 'bridge' }
};
const roster = [
  { id: 'z', name: 'Zoologist' }, { id: 'b', name: 'Tactical Officer' },
  { id: 'a', name: 'Chief Engineer' }, { id: 'e', name: 'Accountant' },
  { id: 'f', name: 'Artist' }, { id: 'u', name: 'Adviser' }
];
const props = [
  { agentId: 'z', t: 'pc', x: 'etsy' },
  { agentId: 'b', t: 'pc', x: 'bridge' },
  { agentId: 'a', t: 'pc', x: 'bridge' },
  { agentId: 'f', t: 'pc', x: 'fiverr' }
];
const station = {
  props: () => props, capForProp: t => t === 'pc' ? 'computer' : null,
  roomAt: x => x, roomById: id => rooms[id],
  agentRoomId: id => id === 'e' ? 'etsy' : id === 'a' ? 'fiverr' : null
};
const before = JSON.stringify(roster);
const rows = order(roster, station);
A.eq(rows.map(r => r.a.id), ['b', 'a', 'e', 'z', 'f', 'u'], 'assigned hierarchy levels sort first, then existing Bridge/room order breaks ties');
A.eq(rows.map(r => r.i), [1, 2, 3, 0, 4, 5], 'original dossier indices survive display sorting');
A.eq(rows.map(r => r.roomName), ['THE BRIDGE', 'THE BRIDGE', 'ETSY', 'ETSY', 'FIVERR', 'UNASSIGNED'], 'room labels reflect dedicated computer then bay fallback');
A.eq(rows.map(r => r.authorityLevel), [2, 3, null, null, null, null], 'unlisted agents receive no assigned hierarchy level');
A.eq(JSON.stringify(roster), before, 'display sorting does not mutate roster');
A.eq(order([{ id: 'portal-treasurer', name: 'Treasurer' }, ...roster], {
  ...station,
  props: () => [...props, { agentId: 'portal-treasurer', t: 'pc', x: 'bridge' }]
}).filter(r => r.roomName === 'THE BRIDGE').map(r => r.a.id), ['b', 'portal-treasurer', 'a'], 'authority level sorts before shared room/title ordering');
rooms.bridge.name = 'Bridge';
A.eq(order(roster, station)[0].a.id, 'b', 'rank order remains primary when the room is renamed');
props[2].x = 'etsy';
A.eq(order(roster, station).map(r => r.a.id), ['b', 'a', 'e', 'z', 'f', 'u'], 'desk moves update assignment and tie-break order');
rooms.etsy.name = 'Workshop';
A.eq(order(roster, station).map(r => r.a.id), ['b', 'a', 'f', 'e', 'z', 'u'], 'room renames update room sorting within each rank');
A.eq(order([{ id: 'b', name: 'alpha' }, { id: 'a', name: 'Alpha' }], null).map(r => r.a.id), ['a', 'b'], 'unlisted agents have deterministic title and ID tie-break');
A.ok(order(roster, null).every(r => r.roomName === 'UNASSIGNED'), 'missing station reports unassigned truthfully');
A.ok(source.includes('<div class="crew-eyebrow" title="'), 'room eyebrow rendered above title');
A.ok(source.includes("row.dataset.roomName || ''"), 'crew search includes room names');
delete rooms.fiverr;
A.eq(order(roster, station).find(r => r.a.id === 'f').roomName, 'UNASSIGNED', 'deleted rooms do not leave stale assignments');
const qEvents = {};
const interfaceEvents = {};
const qPortrait = {};
const qPresence = { textContent: '', dataset: {} };
const qInterface = { addEventListener: (type, handler) => { interfaceEvents[type] = handler; } };
const qRow = {
  addEventListener: (type, handler) => { qEvents[type] = handler; },
  querySelector: selector => selector === '.crew-portrait img' ? qPortrait
    : selector === '.crew-interface' ? qInterface : selector === '[data-q-presence]' ? qPresence : null
};
const ul = {
  innerHTML: '',
  querySelectorAll: selector => selector === '.crew-row[data-q-terminal]' ? [qRow] : []
};
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const crewNameForRole = Function(A.fnBody(source, 'function crewNameForRole(') + '; return crewNameForRole;')();
for (const [role, label] of [
  ['The Commander', 'CMNDR'], ['The First Officer', 'FIRST OFF.'], ['Chief Security Officer', 'CHF. SEC.'],
  ['The Treasurer', 'BANKER'], ['The Ambassador', 'AMBSDR'], ['Chief Engineer', 'CHF. ENG.'],
  ['Chief Comm Officer', 'CHF. COMM.'], ['Chief Med Officer', 'CHF. MED.'],
  ['Chief Helm Officer', 'CHF. HELM'], ['Chief Science Officer', 'CHF. SCI.']
]) A.eq(crewNameForRole({ name: 'Role Agent' }, role), label, role + ' uses its requested crew-list abbreviation');
A.eq(crewNameForRole({ name: 'NOVA' }, ''), 'NOVA', 'unassigned agents keep their chosen name');
const openedTerms = [];
const paintedQPortraits = [];
const render = Function('crewManifestOrder', 'wireCrewLive', '$', 'present', 'crewPortals', 'App', 'esc', 'crewPortrait', 'crewNameForRole', 'duplicateAgentName', 'crewTick', 'openTerm', 'sfx', 'AgentPortraits',
  A.fnBody(source, 'function crewRender(') + '; return crewRender;')(
  order, () => {}, () => ul, roster, [], { station: () => station }, escapeHTML, () => '', crewNameForRole, () => '', () => {}, name => openedTerms.push(name), () => {},
  { paint: (img, agent) => paintedQPortraits.push([img, agent]) });
rooms.etsy.name = '<Workshop "A">';
render();
A.ok(ul.innerHTML.startsWith('<li class="crew-row crew-q-row"'), 'Q is the first roster entry ahead of all agent levels');
A.ok(ul.innerHTML.includes('data-q-terminal data-authority-level="0"'), 'Q is listed as the human Clearance Level 0 Captain without an agent ID');
A.ok(ul.innerHTML.includes('class="crew-dossier crew-interface"') && ul.innerHTML.includes('>INTERFACE</button>'), 'Q has a dossier-style INTERFACE button');
A.ok(!ul.innerHTML.includes('OPEN Q TERMINAL') && !ul.innerHTML.includes('HUMAN ·'), 'Q row no longer displays the old terminal action or human label');
A.eq(paintedQPortraits[0], [qPortrait, { id: 'human-q', name: 'Q', skin: 'q_judge', color: '#e8c85b' }], 'Q uses the existing Q sprite portrait without creating an agent');
A.eq((ul.innerHTML.match(/<li class="crew-row/g) || []).length, roster.length + 1, 'Q is one visible crew-list row in addition to the current agents');
A.ok(typeof qEvents.click === 'function', 'Q crew entry has a click handler');
qEvents.click();
A.eq(openedTerms, ['q'], 'selecting Q opens the Q communications terminal');
let prevented = false;
qEvents.keydown({ key: 'Enter', preventDefault: () => { prevented = true; } });
A.ok(prevented, 'keyboard selection prevents the default action');
A.eq(openedTerms, ['q', 'q'], 'keyboard activation opens the Q communications terminal');
let stopped = false;
interfaceEvents.click({ stopPropagation: () => { stopped = true; } });
A.ok(stopped, 'the INTERFACE button keeps its action separate from the row click');
A.eq(openedTerms, ['q', 'q', 'q'], 'the INTERFACE button opens the Q communications terminal');
A.ok(ul.innerHTML.includes('&lt;Workshop &quot;A&quot;&gt;'), 'room labels and attributes escape HTML');
A.ok(!ul.innerHTML.includes('<Workshop'), 'room names cannot inject markup');
A.ok(ul.innerHTML.indexOf('crew-eyebrow') < ul.innerHTML.indexOf('crew-name'), 'eyebrow precedes crew title');
A.ok(ul.innerHTML.includes('data-authority-level="2"'), 'crew row retains the assigned authority level');
A.ok(ul.innerHTML.includes('class="crew-title" title="Tactical Officer"'), 'crew names occupy an explicit truncating grid cell with their original title');
A.ok(ul.innerHTML.includes('class="crew-room" title="Assigned Bridge clearance level" aria-label="Clearance Level 2">L2</span>'), 'crew row shows a compact assigned clearance badge with a full accessible label');
A.ok(ul.innerHTML.includes('<span class="crew-title">JUDGE Q</span>'), 'Q uses the requested Judge Q label');
A.ok(ul.innerHTML.includes('title="Assigned Bridge clearance level" aria-label="Clearance Level 0">L0</span>'), 'Q uses the same compact clearance badge');
A.ok(ul.innerHTML.includes('<span class="crew-title" title="Tactical Officer">CHF. SEC.</span>'), 'the selected display abbreviation does not replace the real agent name');
A.ok(!ul.innerHTML.includes('aria-label="Clearance Level null"'), 'unlisted crew receives no visible clearance indicator');
const unlistedRow = /<li class="crew-row"[^>]*data-agent-id="e"[\s\S]*?<\/li>/.exec(ul.innerHTML);
A.ok(unlistedRow && !unlistedRow[0].includes('crew-room'), 'unlisted agents have no clearance indicator in their own row');
roster.splice(0, roster.length,
  { id: 'commander', name: 'Jean-Luc Picard' },
  { id: 'first-officer', name: 'Data (as Sherlock)' },
  { id: 'chief-ops', name: 'Chief Ops Officer' },
  { id: 'chief-security', name: 'Worf' },
  { id: 'chief-comm', name: 'Seven of Nine' },
  { id: 'chief-med', name: 'Beverly Crusher' },
  { id: 'chief-science', name: 'Geordi LaForge' },
  { id: 'chief-helm', name: 'Tom Paris' },
  { id: 'chief-engineer', name: 'Scotty' },
  { id: 'ambassador', name: 'Deanna Troi' },
  { id: 'treasurer', name: 'Quark' }
);
render();
A.eq((ul.innerHTML.match(/<li class="crew-row/g) || []).length, 12, 'Q plus eleven Bridge agents are represented by twelve crew-list entries');
roster.splice(0);
render();
A.eq((ul.innerHTML.match(/<li class="crew-row/g) || []).length, 1, 'Q remains selectable when no AI agents are on station');
const appSource = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
A.ok(A.fnBody(appSource, 'function watchStationSave(').includes('StationUI.refreshCrewRooms()'), 'model changes refresh room labels/order');
const refreshBody = A.fnBody(source, 'function refreshCrewRooms(');
A.ok(refreshBody.includes('ul.scrollTop = scrollTop') && refreshBody.includes('preventScroll: true'), 'room refresh preserves scroll and keyboard focus');
A.ok(refreshBody.includes('dataset.authorityLevel'), 'hierarchy changes trigger a crew-order refresh');
A.ok(/\.crew-name\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(fs.readFileSync(path.join(__dirname, '../frontend/css/style.css'), 'utf8')), 'crew names and clearances use separate fixed grid columns');
A.ok(/\.crew-title\s*\{[^}]*text-overflow:\s*ellipsis/.test(fs.readFileSync(path.join(__dirname, '../frontend/css/style.css'), 'utf8')), 'long crew names truncate before the clearance column');
A.ok(/\.crew-room\s*\{[^}]*grid-column:\s*2[^}]*justify-self:\s*end/.test(fs.readFileSync(path.join(__dirname, '../frontend/css/style.css'), 'utf8')), 'clearance badges occupy the fixed right-hand column');
const interfaceCss = fs.readFileSync(path.join(__dirname, '../frontend/css/interface.css'), 'utf8');
A.ok(/#crew \.crew-q-row \[data-q-presence\]\s*\{[^}]*padding-right:\s*64px/.test(interfaceCss), 'Q reserves interface-button space on its status, not its aligned name row');
A.ok(!/#crew \.crew-q-row \.crew-main\s*\{[^}]*padding-right/.test(interfaceCss), 'Q name grid keeps the same full width as every crew member');
const glassCss = fs.readFileSync(path.join(__dirname, '../frontend/css/crew-glass.css'), 'utf8');
A.ok(/#crew \.crew-name\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(glassCss), 'glass crew rows preserve the two-column alignment');
A.ok(/#crew \.crew-name \.crew-clock\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*1/.test(glassCss), 'live clocks share the right-hand cell without moving the name');
for (const relative of ['app/stationui.js', 'app/app.js', 'css/style.css', 'css/interface.css']) {
  A.ok(fs.readFileSync(path.join(__dirname, '../frontend', relative)).equals(
    fs.readFileSync(path.join(__dirname, '../website/app', relative))), relative + ' mirror matches');
}
A.report('crew-room-order');
