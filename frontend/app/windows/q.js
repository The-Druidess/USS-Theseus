/* STARNET — windows/q.js: Q's directive editor and the mail pod. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const H = StationUI.h;
  const esc = H.esc;
  const store = () => (typeof QTerminalStore !== 'undefined' ? QTerminalStore : null);
  const agentName = id => {
    const agent = (Array.isArray(H.present) ? H.present.find(row => row && row.id === id) : null);
    return agent ? (agent.name || id) : id;
  };
  const timeLabel = timestamp => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'time unknown' : date.toLocaleString();
  };
  const titleControl = (Q, key, draft) =>
    '<label class="q-label">DIRECTIVE TITLE<input class="q-input" data-q-title="' + esc(key) +
    '" maxlength="200" value="' + esc(draft ? draft.title : Q.title(key)) + '" placeholder="A-01 Title text"></label>';
  const draftStatus = (Q, draft) => {
    if (!draft) return 'No saved draft.';
    const readyAt = Q.draftReadyAt(draft);
    const date = readyAt && new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Phoenix', year: 'numeric', month: 'short', day: 'numeric'
    }).format(new Date(readyAt));
    return 'Draft saved locally. ' + (date ? 'Earliest handoff: 00:00 America/Phoenix on ' + date + '. ' : '') +
      'Automatic handoff and activation are not available yet.';
  };
  const customMarkup = (Q, key, draft) =>
    '<section class="q-settings"><h4>' + esc(draft.title) + '</h4>' +
    titleControl(Q, key, draft) +
    '<textarea class="q-textarea" data-q-editor maxlength="8000">' + esc(draft.text) + '</textarea>' +
    '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="' + esc(key) + '">SAVE DIRECTIVE</button>' +
    '<p class="q-help" data-q-draft-status>' + draftStatus(Q, draft) + '</p></section>';
  let selectedId = '';

  function buildQ(body, mode) {
    const mail = mode === 'mail';
    if (mail) globalThis.QTerminalView = { refresh: () => { if (body.isConnected) { selectedId = ''; buildQ(body, mode); } } };
    const Q = store();
    if (!Q) { body.innerHTML = '<p class="dim">Q terminal storage is unavailable.</p>'; return; }
    const savedDrafts = Q.drafts();
    const rows = Q.messages().sort((a, b) => b.createdAt - a.createdAt);
    if (!rows.some(row => row.id === selectedId)) selectedId = rows[0] ? rows[0].id : '';
    const selected = rows.find(row => row.id === selectedId) || null;
    const inbox = rows.length ? rows.map(row =>
      '<button type="button" class="q-inbox-row' + (row.id === selectedId ? ' selected' : '') + '" data-q-select="' + esc(row.id) + '">' +
        '<span class="q-inbox-meta"><b>' + esc(agentName(row.agentId)) + '</b><span>' + esc(row.kind.toUpperCase()) + ' · ' + esc(timeLabel(row.createdAt)) + '</span></span>' +
        '<span class="q-inbox-preview">' + esc(row.text) + '</span><span class="q-inbox-status">' + (row.status === 'replied' ? 'REPLIED' : row.status === 'queued' ? 'QUEUED TO COMMS' : 'AWAITING YOU') + '</span>' +
      '</button>').join('') : '<p class="q-empty">No agent messages yet. Questions and notes sent with Q will appear here.</p>';
    const selectedMarkup = selected
      ? '<section class="q-message-detail"><h4>' + esc(agentName(selected.agentId)) + ' · ' + esc(selected.kind.toUpperCase()) + '</h4>' +
          '<p class="q-message-body">' + esc(selected.text) + '</p>' +
          (selected.kind === 'command' && selected.matchedResponse ? '<div class="q-command-match"><b>EXACT RESPONSE MATCH</b><p>' + esc(selected.matchedResponse) + '</p><button type="button" class="bb sm" data-q-action="send-match"' + (selected.status !== 'pending' ? ' disabled' : '') + '>SEND MATCHED RESPONSE</button></div>' : '') +
          (selected.kind === 'directive' ? '<div class="q-command-match"><b>PRIME DIRECTIVE REQUEST</b><button type="button" class="bb sm" data-q-action="open-dispatch">OPEN DISPATCH PYLON</button></div>' : '') +
          (selected.status === 'replied' ? '<p class="q-replied">Sent: ' + esc(selected.response || 'response sent') + '</p>' :
            selected.status === 'queued' ? '<p class="q-replied">Queued in COMMS: ' + esc(selected.response || 'response queued') + '</p>' :
            selected.kind === 'directive' ? '<p class="q-help">Directive reports must use the dispatch pylon.</p>' :
            '<label class="q-label" for="q-reply">REPLY TO ' + esc(agentName(selected.agentId)).toUpperCase() + '</label><textarea id="q-reply" class="q-textarea" maxlength="4000" placeholder="Write a reply or answer their question…"></textarea><button type="button" class="bb sm" data-q-action="send-reply">SEND REPLY</button> ' +
            '<button type="button" class="bb sm" data-q-action="open-agent">OPEN AGENT COMMS</button>') +
        '</section>'
      : '<section class="q-message-detail"><p class="q-empty">Select an inbox item to review it.</p></section>';
    const sentRows = rows.filter(row => row.status === 'replied' || row.status === 'queued');
    const outbox = sentRows.length ? sentRows.map(row =>
      '<button type="button" class="q-inbox-row" data-q-select="' + esc(row.id) + '">' +
        '<span class="q-inbox-meta"><b>TO ' + esc(agentName(row.agentId)) + '</b><span>' + (row.status === 'queued' ? 'QUEUED TO COMMS' : 'SENT') + '</span></span>' +
        '<span class="q-inbox-preview">' + esc(row.response || 'response unavailable') + '</span></button>').join('')
      : '<p class="q-empty">No sent or queued replies yet.</p>';
    const commandMarkup = Q.commands().map(command =>
      '<div class="q-command-row" data-q-command="' + esc(command.id) + '">' +
        '<label>EXACT COMMAND<input class="q-input" data-q-field="command" maxlength="200" value="' + esc(command.command) + '"></label>' +
        '<label>RESPONSE<textarea class="q-textarea" data-q-field="response" maxlength="4000">' + esc(command.response) + '</textarea></label>' +
        '<button type="button" class="bb xs" data-q-action="save-command">SAVE</button> <button type="button" class="bb xs danger" data-q-action="delete-command">REMOVE</button>' +
      '</div>').join('');
    body.innerHTML =
      '<div class="q-terminal">' +
        (mail
          ? '<header class="q-header"><div><span class="q-kicker">COMMANDER’S LOCAL INBOX</span><h3>MAIL POD · INBOX &amp; OUTBOX</h3></div><span class="q-count">' + rows.filter(row => row.status === 'pending').length + ' AWAITING</span></header>' +
            '<p class="q-intro">Review agent messages and send replies through their existing COMMS channels. Messages and programmed responses are saved locally.</p>' +
            '<div class="q-inbox-layout"><div class="q-inbox-list" aria-label="Q inbox">' + inbox + '</div>' + selectedMarkup + '</div>' +
            '<section class="q-settings"><h4>OUTBOX · SENT &amp; QUEUED REPLIES</h4><div class="q-inbox-list" aria-label="Q outbox">' + outbox + '</div></section>' +
            '<section class="q-settings"><h4>PROGRAMMED COMMAND RESPONSES</h4><p class="q-help">Responses match the command text exactly (case-sensitive). Q offers a match for you to send.</p>' +
              '<div class="q-command-list">' + commandMarkup + '</div>' +
              '<div class="q-command-row q-command-new"><label>EXACT COMMAND<input class="q-input" id="q-new-command" maxlength="200" placeholder="e.g. request status"></label>' +
              '<label>RESPONSE<textarea class="q-textarea" id="q-new-response" maxlength="4000" placeholder="The exact response Q should offer…"></textarea></label>' +
              '<button type="button" class="bb sm" data-q-action="add-command">ADD RESPONSE</button></div>' +
            '</section>'
          : '<header class="q-header"><div><span class="q-kicker">COMMANDER’S DIRECTIVES</span><h3>Q · DIRECTIVE EDITOR</h3></div></header>' +
        '<p class="q-intro">Saving stores a draft and does not change active instructions. Automatic midnight handoff and activation are not available yet; drafts will remain pending. New titles use A-01 Title text. This interface is not authenticated or protected from agents or other local users with access to the underlying data.</p>' +
        '<section class="q-settings"><h4>ADD A NEW DIRECTIVE</h4>' + titleControl(Q, 'new', null) +
          '<textarea class="q-textarea" data-q-editor maxlength="8000" placeholder="Write the new directive…"></textarea>' +
          '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="new">SAVE DIRECTIVE</button>' +
          '<p class="q-help" data-q-draft-status>No saved draft.</p></section>' +
        '<div data-q-custom-directives>' + Object.entries(savedDrafts).filter(([key]) => key.startsWith('custom:')).map(([key, draft]) => customMarkup(Q, key, draft)).join('') + '</div>' +
        '<section class="q-settings"><h4>' + esc((savedDrafts.prime && savedDrafts.prime.title) || Q.title('prime') || 'PRIME DIRECTIVE · PROJECT-WIDE RULE BASE') + '</h4>' + titleControl(Q, 'prime', savedDrafts.prime) + '<p class="q-help">The active Prime Directive is included in every agent’s standing instructions; a saved draft does not change it.</p>' +
          '<textarea id="q-directive" class="q-textarea" data-q-editor maxlength="8000" placeholder="Write the shared goals and rules agents should follow across this project…">' + esc(savedDrafts.prime ? savedDrafts.prime.text : Q.directive()) + '</textarea>' +
          '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="prime">SAVE DIRECTIVE</button><p class="q-help" data-q-draft-status>' + draftStatus(Q, savedDrafts.prime) + '</p>' +
        '</section>' +
        '<section class="q-settings"><h4>' + esc((savedDrafts.human && savedDrafts.human.title) || Q.title('human') || 'Q · HUMAN OPERATING DIRECTIVE') + '</h4>' + titleControl(Q, 'human', savedDrafts.human) + '<p class="q-help">The active Q directive is included in every agent’s standing instructions as context. Agents can request it with Q_HUMAN_DIRECTIVE_REQUEST.</p>' +
          '<textarea id="q-human-directive" class="q-textarea" data-q-editor maxlength="8000" placeholder="Describe how Q will lead and engage with the crew…">' + esc(savedDrafts.human ? savedDrafts.human.text : Q.qDirective()) + '</textarea>' +
          '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="human">SAVE DIRECTIVE</button><p class="q-help" data-q-draft-status>' + draftStatus(Q, savedDrafts.human) + '</p>' +
        '</section>' +
        '<section class="q-settings"><h4>' + esc((savedDrafts.hierarchy && savedDrafts.hierarchy.title) || Q.title('hierarchy') || 'BRIDGE CREW HIERARCHY ROSTER') + '</h4>' + titleControl(Q, 'hierarchy', savedDrafts.hierarchy) + '<p class="q-help">The active roster defines Bridge reporting order, not system permissions. Agents can request it with Q_HIERARCHY_REQUEST.</p>' +
          '<textarea id="q-hierarchy" class="q-textarea" data-q-editor maxlength="6000">' + esc(savedDrafts.hierarchy ? savedDrafts.hierarchy.text : Q.hierarchy()) + '</textarea>' +
          '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="hierarchy">SAVE DIRECTIVE</button><p class="q-help" data-q-draft-status>' + draftStatus(Q, savedDrafts.hierarchy) + '</p>' +
        '</section>' +
        '<section class="q-settings"><h4>' + esc((savedDrafts.coordination && savedDrafts.coordination.title) || Q.title('coordination') || 'CREW COORDINATION & ESCALATION POLICY') + '</h4>' + titleControl(Q, 'coordination', savedDrafts.coordination) + '<p class="q-help">The active policy is returned to agents on Q_COORDINATION_REQUEST and does not grant tools, permissions, or approval.</p>' +
          '<textarea id="q-coordination-policy" class="q-textarea" data-q-editor maxlength="6000">' + esc(savedDrafts.coordination ? savedDrafts.coordination.text : Q.coordinationPolicy()) + '</textarea>' +
          '<button type="button" class="bb sm" data-q-action="save-draft" data-q-key="coordination">SAVE DIRECTIVE</button><p class="q-help" data-q-draft-status>' + draftStatus(Q, savedDrafts.coordination) + '</p>' +
        '</section>') +
      '</div>';
    body.onclick = event => {
      const select = event.target.closest('[data-q-select]');
      if (select) { selectedId = select.dataset.qSelect; buildQ(body, mode); return; }
      const button = event.target.closest('[data-q-action]');
      if (!button) return;
      const action = button.dataset.qAction;
      const selectedNow = Q.messages().find(row => row.id === selectedId);
      try {
        if (action === 'save-draft') {
          const section = button.closest('.q-settings');
          const input = section.querySelector('[data-q-title]');
          const text = section.querySelector('[data-q-editor]');
          if (!input) throw new Error('This roster role is not recognized and cannot have a directive draft.');
          const result = Q.saveDraft(button.dataset.qKey, input.value, text.value, event);
          if (!result.ok) throw new Error(result.error || 'Could not save the directive draft.');
          section.querySelector('[data-q-draft-status]').textContent = draftStatus(Q, result.draft);
          if (button.dataset.qKey === 'new') {
            body.querySelector('[data-q-custom-directives]').insertAdjacentHTML('beforeend', customMarkup(Q, result.key, result.draft));
            input.value = ''; text.value = '';
          } else if (result.draft.title) section.querySelector('h4').textContent = result.draft.title;
          H.notify('Draft saved locally; automatic handoff is not available yet.', 'warn');
        } else if (action === 'open-dispatch') {
          StationUI.openTerm('bridge-dispatch');
        } else if (action === 'add-command') {
          const result = Q.saveCommand('', body.querySelector('#q-new-command').value, body.querySelector('#q-new-response').value);
          if (!result.ok) throw new Error(result.error || 'Could not save that command response.');
          buildQ(body, mode);
        } else if (action === 'save-command' || action === 'delete-command') {
          const row = button.closest('[data-q-command]');
          if (action === 'delete-command') Q.removeCommand(row.dataset.qCommand);
          else {
            const result = Q.saveCommand(row.dataset.qCommand, row.querySelector('[data-q-field="command"]').value, row.querySelector('[data-q-field="response"]').value);
            if (!result.ok) throw new Error(result.error || 'Could not save that command response.');
          }
          buildQ(body, mode);
        } else if (action === 'open-agent') {
          if (!selectedNow || !App.selectAgent(selectedNow.agentId)) throw new Error('That agent’s conversation is unavailable.');
        } else if (action === 'send-reply' || action === 'send-match') {
          if (!selectedNow) throw new Error('Select an inbox item first.');
          const text = action === 'send-match' ? selectedNow.matchedResponse : body.querySelector('#q-reply').value.trim();
          if (!text) throw new Error('Enter a reply first.');
          if (!App.selectAgent(selectedNow.agentId)) throw new Error('That agent’s conversation is unavailable.');
          const sent = Chat.sendOrQueue(text);
          if (!sent.ok) throw new Error('Q could not send the response (' + sent.state + ').');
          const saved = Q.markReplied(selectedNow.id, text, sent.state);
          if (!saved.ok) throw new Error('The message was sent, but Q could not save its replied status.');
          H.notify((sent.state === 'queued' ? 'Reply queued for ' : 'Reply sent to ') + agentName(selectedNow.agentId) + '.', 'gold');
          buildQ(body, mode);
        }
      } catch (error) {
        H.notify(error && error.message ? error.message : 'Q could not complete that action.', 'warn');
      }
    };
  }
  StationUI.registerWindow('q', 'Q · DIRECTIVE EDITOR', body => buildQ(body, 'directives'), { console: true, className: 'q-terminal-win' });
  StationUI.registerWindow('q-mail', 'MAIL POD · INBOX & OUTBOX', body => buildQ(body, 'mail'), { console: true, className: 'q-terminal-win' });
})();
