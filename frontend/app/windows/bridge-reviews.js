/* Bridge room surfaces: manual review pins, Q-approved dispatch, and crew COMMS routing. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const H = StationUI.h;
  const esc = H.esc;
  const STORE = () => (typeof BridgeReviewStore !== 'undefined' ? BridgeReviewStore : null);
  const descriptions = {
    communications: 'Open communications pinned by the crew for review.',
    security: 'Open security risks pinned by the crew for review.',
    science: 'Open scientific discoveries pinned by the crew for review.',
    treasury: 'Open factory financial trends pinned by the Treasurer for review.',
    operations: 'Open operations pinned by the crew for review.'
  };
  let dispatchBusy = false;

  function notify(text, kind) { H.notify(text, kind || 'warn'); }
  function activeCategory() {
    const value = H.consoleSection && H.consoleSection['bridge-reviews'];
    const store = STORE();
    return store && store.categoryFor(value) ? store.categoryFor(value) : store && store.categoryFor('communications');
  }
  function detailMarkup(row, category) {
    const owner = esc(category.ownerRole);
    const approval = row.approval
      ? '<p class="q-replied">Authorized by ' + esc(row.approval.by) + ' · L' + row.approval.level +
        ' · one execution: ' + esc(row.approval.scope) +
        (row.dispatchedAt ? ' · dispatched' : row.dispatchAttemptedAt ? ' · dispatch attempted; check COMMS' : ' · awaiting dispatch') + '</p>'
      : (row.dispatchAttemptedAt ? '<p class="q-replied">Dispatch was attempted; authorization scope is not recorded. Check COMMS before taking further action.</p>'
        : row.dispatchedAt ? '<p class="q-replied">Previously dispatched; authorization scope is not recorded.</p>' : '');
    const recommendation = row.recommendation
      ? '<div class="q-command-match"><b>RECOMMENDATION</b><p>' + esc(row.recommendation) + '</p>' +
        '<p class="q-help">Evidence / source: ' + esc(row.source) + '</p>' +
        '<p class="q-help">Q (L0) approval grants permission to execute only this specific operation for one execution before dispatch to ' + owner +
        '. It does not add tool or system access. The Prime Directive, assigned directives, applicable rules, and escalation requirements remain in force. Continuing or recurring scope must be explicitly directed by Q.</p>' +
        approval +
        (row.status !== 'open' || row.dispatchedAt || row.dispatchAttemptedAt ? '' : '<button type="button" class="bb sm" data-approve="' + esc(row.id) + '">' +
          (row.approval ? 'RETRY DISPATCH' : 'Q · AUTHORIZE SCOPE &amp; DISPATCH') + '</button>') +
        '</div>'
      : '';
    const statusButton = row.status === 'open'
      ? '<button type="button" class="bb xs" data-resolve="' + esc(row.id) + '">MARK RESOLVED</button>'
      : '<button type="button" class="bb xs" data-reopen="' + esc(row.id) + '">REOPEN</button>';
    return '<article class="q-message-detail bridge-review-card' + (row.urgent ? ' bridge-review-urgent' : '') + '">' +
      '<header><h4>' + esc(row.title) + '</h4>' +
      (row.urgent ? '<span class="q-count bridge-review-urgency">URGENT</span>' : '') + '</header>' +
      '<p class="q-message-body">' + esc(row.details) + '</p>' +
      (row.source && !row.recommendation ? '<p class="q-help">Evidence / source: ' + esc(row.source) + '</p>' : '') +
      recommendation + statusButton + '</article>';
  }

  function buildReviews(body) {
    const store = STORE(), category = activeCategory();
    globalThis.BridgeReviewView = { refresh: () => { if (body.isConnected) buildReviews(body); } };
    if (!store || !category) {
      body.innerHTML = '<p class="dim">Bridge review storage is unavailable.</p>';
      return;
    }
    const rows = store.list(category.id);
    const open = rows.filter(row => row.status === 'open');
    const resolved = rows.filter(row => row.status === 'resolved');
    body.innerHTML =
      '<div class="q-terminal bridge-review">' +
        '<header class="q-header"><div><span class="q-kicker">' + esc(category.surface) + ' · ' + esc(category.label) +
          '</span><h3>' + esc(category.label) + ' REVIEW LOG</h3></div><span class="q-count">' + open.length + ' OPEN</span></header>' +
        '<p class="q-intro">' + esc(descriptions[category.id]) +
          ' Pins, urgency, evidence, and recommendations are entered manually; this surface does not invent reports or analysis. ' +
          'Recommendations require explicit Q (L0) approval before they are dispatched to the responsible officer. ' +
          'Roster clearance is reporting precedence, not system permission; all existing access and finance controls remain in force.</p>' +
        '<div class="q-inbox-layout"><section class="q-inbox-list bridge-review-list" aria-label="Open review pins">' +
          (open.length ? open.map(row => detailMarkup(row, category)).join('') : '<p class="q-empty">No open pins. Nothing is being inferred for this log.</p>') +
          '</section></div>' +
        '<section class="q-settings"><h4>PIN AN OPEN ITEM</h4>' +
          '<label class="q-label">TITLE<input class="q-input" data-pin-title maxlength="120" required></label>' +
          '<label class="q-label">DETAILS<textarea class="q-textarea" data-pin-details maxlength="3000" required placeholder="What should be reviewed?"></textarea></label>' +
          '<label class="q-label">EVIDENCE / SOURCE<input class="q-input" data-pin-source maxlength="1000" placeholder="Required when adding a recommendation"></label>' +
          '<label class="q-label">RECOMMENDED IMPROVEMENT<textarea class="q-textarea" data-pin-recommendation maxlength="2000" placeholder="Optional; must be supported by the evidence above"></textarea></label>' +
          '<label class="q-label bridge-review-check"><input type="checkbox" data-pin-urgent> FLAG AS URGENT</label>' +
          '<button type="button" class="bb sm" data-add-pin>PIN FOR REVIEW</button>' +
          '<p class="q-help" data-pin-message aria-live="polite"></p>' +
        '</section>' +
        (resolved.length ? '<section class="q-settings"><h4>RESOLVED · ' + resolved.length + '</h4>' +
          resolved.map(row => detailMarkup(row, category)).join('') + '</section>' : '') +
      '</div>';

    body.onclick = async event => {
      const addButton = event.target.closest('[data-add-pin]');
      if (addButton) {
        const result = store.add(category.id, {
          title: body.querySelector('[data-pin-title]').value,
          details: body.querySelector('[data-pin-details]').value,
          source: body.querySelector('[data-pin-source]').value,
          recommendation: body.querySelector('[data-pin-recommendation]').value,
          urgent: body.querySelector('[data-pin-urgent]').checked
        });
        if (!result.ok) {
          const message = body.querySelector('[data-pin-message]');
          if (message) message.textContent = result.error;
          notify(result.error, 'warn');
          return;
        }
        notify('Pinned ' + category.label.toLocaleLowerCase() + ' item for review.', 'good');
        buildReviews(body);
        return;
      }
      const resolve = event.target.closest('[data-resolve],[data-reopen]');
      if (resolve) {
        const status = resolve.hasAttribute('data-resolve') ? 'resolved' : 'open';
        const result = store.setStatus(resolve.dataset.resolve || resolve.dataset.reopen, status);
        if (!result.ok) { notify(result.error, 'warn'); return; }
        buildReviews(body);
        return;
      }
      const approve = event.target.closest('[data-approve]');
      if (approve) {
        if (!event.isTrusted) { notify('Only Q can approve a recommendation from the review console.', 'warn'); return; }
        if (dispatchBusy) return;
        dispatchBusy = true;
        approve.disabled = true;
        try {
          const result = await approveAndDispatch(store, approve.dataset.approve);
          if (!result.ok) notify(result.error, 'warn');
          else notify(result.queued ? 'Q authorized this specified operation once and queued it to the responsible officer. Existing access controls still apply.' :
            'Q authorized this specified operation once and dispatched it to the responsible officer. Existing access controls still apply.', 'good');
        } catch (error) {
          notify(error && error.message ? error.message : 'The recommendation could not be dispatched.', 'warn');
        } finally {
          dispatchBusy = false;
          buildReviews(body);
        }
      }
    };
  }

  function officerFor(category) {
    if (typeof App === 'undefined' || !App.agents || typeof QTerminalStore === 'undefined' || !QTerminalStore.authorityFor) return null;
    const target = QTerminalStore.authorityFor(category.ownerRole);
    if (!target || !target.listed) return null;
    return App.agents().find(agent => {
      const authority = QTerminalStore.authorityFor(agent);
      return authority && authority.listed && authority.role === target.role;
    }) || null;
  }

  function recommendationPrompt(row, category) {
    return 'Q (Clearance Level 0) has granted permission for this specific operation for one execution.\n' +
      'Category: ' + category.label + '\n' +
      'Review item: ' + row.title + '\n' +
      'Details: ' + row.details + '\n' +
      'Evidence / source: ' + row.source + '\n' +
      'Approved operation and exact scope: ' + row.approval.scope + '\n\n' +
      'Execute only this approved scope once. Do not expand, substitute, or repeat it. Continuing or recurring execution is permitted only if Q explicitly specifies that scope in the approval. ' +
      'This approval does not add tool or system access or override the Prime Directive, your assigned directive, applicable security, legal, finance, or operational rules, higher-priority safety instructions, or escalation requirements. ' +
      'If the scope is unclear, requirements change, required access is unavailable, or another authorization/escalation is required, stop the affected work and refer it to Q.';
  }

  async function approveAndDispatch(store, id) {
    const row = store.get(id);
    if (!row) return { ok: false, error: 'That review pin no longer exists.' };
    if (row.status !== 'open' || !row.recommendation) return { ok: false, error: 'Only an open pin with a recommendation can be dispatched.' };
    const category = store.categoryFor(row.category);
    if (!category) return { ok: false, error: 'The review category is unavailable.' };
    const officer = officerFor(category);
    if (!officer) return { ok: false, error: category.ownerRole + ' is not listed and active on this station; nothing was dispatched.' };
    const authorization = store.approvalAuthority(id, 'Q');
    if (!authorization.ok) return authorization;
    const approval = store.approve(id, 'Q');
    if (!approval.ok) return approval;
    const workstreamId = App.selectAgent(officer.id);
    if (!workstreamId) return { ok: false, error: 'Q approval was recorded, but the responsible officer’s COMMS session could not be opened.' };
    if (typeof Chat === 'undefined' || !Chat.sendOrQueue) return { ok: false, error: 'Q approval was recorded, but COMMS dispatch is unavailable.' };
    const approvedRow = store.get(id);
    if (!approvedRow || !approvedRow.approval || approvedRow.approval.scope !== row.recommendation) {
      return { ok: false, error: 'Q approval could not be tied to the exact recommendation; nothing was dispatched.' };
    }
    const reservation = store.claimDispatch(id, workstreamId);
    if (!reservation.ok) return reservation;
    let sent;
    try { sent = Chat.sendOrQueue(recommendationPrompt(approvedRow, category)); }
    catch (error) {
      return { ok: false, error: 'The dispatch outcome is uncertain; its one-time reservation remains. Check the officer’s COMMS stream before taking further action.' };
    }
    if (!sent || !sent.ok) {
      const released = store.releaseDispatch(id);
      return { ok: false, error: released.ok
        ? 'Q approval was recorded, but COMMS declined the dispatch; the one-time reservation was released.'
        : 'COMMS declined the dispatch, but the one-time reservation could not be released: ' + released.error };
    }
    if (sent.workstreamId && sent.workstreamId !== workstreamId) {
      return { ok: false, error: 'COMMS accepted the message on an unexpected workstream; the one-time reservation remains. Check the recipient streams before taking further action.' };
    }
    const saved = store.markDispatched(id, workstreamId);
    if (!saved.ok) return { ok: false, error: 'The recommendation was dispatched, but its dispatch receipt could not be saved: ' + saved.error };
    return { ok: true, queued: sent.state === 'queued' };
  }

  function buildDispatch(body) {
    const agents = typeof App !== 'undefined' && App.agents ? App.agents() : [];
    const options = agents.map(agent => '<option value="' + esc(agent.id) + '">' + esc(agent.name || agent.id) + '</option>').join('');
    body.innerHTML = '<div class="q-terminal bridge-review">' +
      '<header class="q-header"><div><span class="q-kicker">BRIDGE CREW</span><h3>COMMUNICATIONS DISPATCH</h3></div></header>' +
      '<p class="q-intro">Choose any AI agent on the starship and send through that agent’s normal COMMS session. Existing permissions and consent checks remain in force.</p>' +
      (agents.length ? '<section class="q-settings"><label class="q-label">RECIPIENT<select class="q-input" data-dispatch-agent>' + options + '</select></label>' +
        '<label class="q-label">MESSAGE<textarea class="q-textarea" data-dispatch-message maxlength="4000" required placeholder="Message the selected agent…"></textarea></label>' +
        '<button type="button" class="bb sm" data-send-dispatch>SEND THROUGH COMMS</button><p class="q-help" data-dispatch-message-status aria-live="polite"></p></section>'
        : '<p class="q-empty">No AI agents are currently available to receive a dispatch.</p>') +
      '</div>';
    body.onclick = async event => {
      const button = event.target.closest('[data-send-dispatch]');
      if (!button) return;
      if (!event.isTrusted) { notify('Use the Bridge dispatch interface to send a message.', 'warn'); return; }
      const agentId = body.querySelector('[data-dispatch-agent]').value;
      const message = body.querySelector('[data-dispatch-message]').value.trim();
      const status = body.querySelector('[data-dispatch-message-status]');
      if (!message) { status.textContent = 'Enter a message before sending.'; return; }
      if (dispatchBusy) return;
      dispatchBusy = true;
      button.disabled = true;
      try {
        const workstreamId = App.selectAgent(agentId);
        if (!workstreamId) throw new Error('The selected agent could not be opened in COMMS.');
        if (typeof Chat === 'undefined' || !Chat.sendOrQueue) throw new Error('COMMS dispatch is unavailable.');
        const result = Chat.sendOrQueue(message);
        if (!result || !result.ok) throw new Error('COMMS did not accept the message.');
        status.textContent = result.state === 'queued' ? 'Message queued in COMMS.' : 'Message sent through COMMS.';
        body.querySelector('[data-dispatch-message]').value = '';
        notify(status.textContent, 'good');
      } catch (error) {
        status.textContent = error.message || 'The message could not be sent.';
        notify(status.textContent, 'warn');
      } finally {
        dispatchBusy = false;
        button.disabled = false;
      }
    };
  }

  StationUI.registerWindow('bridge-reviews', 'BRIDGE REVIEW LOG', buildReviews, { console: true, className: 'bridge-review-win' });
  StationUI.registerWindow('bridge-dispatch', 'COMMUNICATIONS DISPATCH', buildDispatch, { console: true, className: 'bridge-dispatch-win' });
})();
