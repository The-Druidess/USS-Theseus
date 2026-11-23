'use strict';

const { makeDomainStore } = require('./domain-store.js');

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RECEIPT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const STATES = new Set(['pending', 'running', 'responded', 'acknowledged', 'uncertain']);
const copy = value => JSON.parse(JSON.stringify(value));

function validate(value) {
  if (!value || !Array.isArray(value.batches)) throw new Error('Invalid crew dispatch state.');
  const requests = new Set();
  const runs = new Set(), receipts = new Set();
  let running = 0;
  for (const batch of value.batches) {
    if (!batch || typeof batch.requestId !== 'string' || !REQUEST_ID.test(batch.requestId)
        || requests.has(batch.requestId) || typeof batch.sender !== 'string' || !ID.test(batch.sender)
        || typeof batch.message !== 'string' || !batch.message.trim() || batch.message.length > 4000
        || !Array.isArray(batch.recipients) || !batch.recipients.length || batch.recipients.length > 100) {
      throw new Error('Invalid crew dispatch state.');
    }
    requests.add(batch.requestId);
    const recipients = new Set();
    for (const recipient of batch.recipients) {
      if (!recipient || typeof recipient.agentId !== 'string' || !ID.test(recipient.agentId)
          || recipient.agentId === batch.sender || recipients.has(recipient.agentId)
          || !STATES.has(recipient.state)) throw new Error('Invalid crew dispatch state.');
      recipients.add(recipient.agentId);
      if (recipient.state === 'pending') {
        if (recipient.runId != null || recipient.receipt != null) throw new Error('Invalid crew dispatch state.');
      } else {
        if (typeof recipient.runId !== 'string' || !RECEIPT_ID.test(recipient.runId) || runs.has(recipient.runId)) {
          throw new Error('Invalid crew dispatch state.');
        }
        runs.add(recipient.runId);
        if (recipient.state === 'running' && ++running > 1) throw new Error('Invalid crew dispatch state.');
        if (recipient.state === 'responded' || recipient.state === 'acknowledged') {
          if (!recipient.receipt || typeof recipient.receipt.id !== 'string' || !RECEIPT_ID.test(recipient.receipt.id)
              || receipts.has(recipient.receipt.id)) {
            throw new Error('Invalid crew dispatch state.');
          }
          receipts.add(recipient.receipt.id);
        } else if (recipient.receipt != null) throw new Error('Invalid crew dispatch state.');
      }
    }
  }
  return value;
}

// Host callbacks own sender authentication, consent, live provider checks, and durable receipt verification.
// This module is not a transport: a host must wire and test those boundaries before starting it.
function makeCrewDispatchQueue({ fs, path, file, roster, authorizeStage, authorizeDelivery, authorizeResume, deliver, verifyReceipt, halted, newId }) {
  if (!roster || typeof roster.has !== 'function'
      || [authorizeStage, authorizeDelivery, authorizeResume, deliver, verifyReceipt, halted, newId].some(fn => typeof fn !== 'function')) {
    throw new Error('Crew dispatch requires host safety adapters.');
  }
  const store = makeDomainStore({ fs, path, file, defaults: () => ({ batches: [] }), normalize: validate });
  const loaded = store.load();
  if (!['absent', 'ok', 'recovered'].includes(loaded.status)) {
    throw new Error('Crew dispatch storage unavailable: ' + loaded.status);
  }
  let state = loaded.value;
  let persisted = loaded.status !== 'absent';
  let fault = loaded.status === 'recovered' ? 'Recovered backup may be stale; manual reconciliation is required.' : null;
  let busy = false, generation = 0, active = null, runController = null, stopped = false;

  function status() {
    return { batches: copy(state.batches), storageFault: fault, busy, halted: stopped || halted() !== false };
  }
  function checkCurrent() {
    if (fault) throw new Error('Crew dispatch is locked: ' + fault);
    const current = store.load();
    if (!((current.status === 'absent' && !persisted)
        || (current.status === 'ok' && persisted && JSON.stringify(current.value) === JSON.stringify(state)))) {
      fault = 'Storage changed or became unavailable; manual reconciliation is required.';
      throw new Error('Crew dispatch is locked: ' + fault);
    }
  }
  function save(next) {
    checkCurrent();
    try { store.save(next); }
    catch (error) {
      fault = 'A storage write could not be confirmed; manual reconciliation is required.';
      throw error;
    }
    state = next;
    persisted = true;
  }
  function replaceRecipient(requestId, agentId, replacement) {
    const next = copy(state);
    const batch = next.batches.find(row => row.requestId === requestId);
    if (!batch) throw new Error('Crew dispatch batch disappeared.');
    const index = batch.recipients.findIndex(row => row.agentId === agentId);
    if (index < 0) throw new Error('Crew dispatch recipient disappeared.');
    batch.recipients[index] = replacement;
    save(next);
  }
  if (!fault && state.batches.some(b => b.recipients.some(r => r.state === 'running'))) {
    const next = copy(state);
    for (const batch of next.batches) {
      for (const recipient of batch.recipients) {
        if (recipient.state === 'running') recipient.state = 'uncertain';
      }
    }
    save(next);
  }

  function stage(input, authority) {
    if (stopped || halted() !== false) throw new Error('Crew dispatch is halted.');
    if (!input || typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)
        || typeof input.sender !== 'string' || !ID.test(input.sender) || !roster.has(input.sender)
        || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000
        || !Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 100
        || input.recipients.some(id => typeof id !== 'string' || !ID.test(id) || id === input.sender || !roster.has(id))
        || new Set(input.recipients).size !== input.recipients.length) {
      throw new Error('Invalid crew dispatch request.');
    }
    const batch = { requestId: input.requestId, sender: input.sender, message: input.message.trim(),
      recipients: input.recipients.map(agentId => ({ agentId, state: 'pending' })) };
    if (authorizeStage(authority, copy(batch)) !== true) throw new Error('Crew dispatch request lacks host authorization.');
    checkCurrent();
    const existing = state.batches.find(row => row.requestId === batch.requestId);
    if (existing) {
      if (existing.sender !== batch.sender || existing.message !== batch.message
          || JSON.stringify(existing.recipients.map(r => r.agentId)) !== JSON.stringify(input.recipients)) {
        throw new Error('Request ID already belongs to a different message.');
      }
      return status();
    }
    if (state.batches.some(row => row.sender === batch.sender && row.message === batch.message
        && row.recipients.some(r => input.recipients.includes(r.agentId)))) {
      throw new Error('A matching message already exists for at least one recipient.');
    }
    save({ batches: state.batches.concat([batch]) });
    return status();
  }

  function stop() {
    stopped = true;
    generation++;
    if (runController) runController.abort();
    if (active) {
      const { requestId, agentId, runId } = active;
      const batch = state.batches.find(row => row.requestId === requestId);
      const recipient = batch && batch.recipients.find(row => row.agentId === agentId);
      if (recipient && recipient.state === 'running' && recipient.runId === runId) {
        replaceRecipient(requestId, agentId, { agentId, state: 'uncertain', runId });
      }
    }
  }

  function resume(authority) {
    if (authorizeResume(authority) !== true) throw new Error('Crew dispatch resume lacks host authorization.');
    checkCurrent();
    if (busy) throw new Error('Crew dispatch is still stopping.');
    if (halted() !== false) throw new Error('Crew dispatch is halted.');
    stopped = false;
    return status();
  }

  async function run() {
    checkCurrent();
    if (busy) throw new Error('Crew dispatch is already running.');
    if (stopped || halted() !== false) throw new Error('Crew dispatch is halted.');
    if (state.batches.some(b => b.recipients.some(r => r.state === 'running' || r.state === 'uncertain'))) {
      throw new Error('Crew dispatch has an uncertain delivery requiring review.');
    }
    busy = true;
    const startedGeneration = generation;
    const controller = new AbortController();
    runController = controller;
    try {
      for (;;) {
        if (generation !== startedGeneration || halted() !== false || controller.signal.aborted) break;
        const batch = state.batches.find(b => b.recipients.some(r => r.state === 'pending'));
        if (!batch) break;
        const recipient = batch.recipients.find(r => r.state === 'pending');
        if (!roster.has(batch.sender) || !roster.has(recipient.agentId)) throw new Error('Crew dispatch roster changed; delivery is paused.');
        const request = { requestId: batch.requestId, sender: batch.sender, message: batch.message, recipient: recipient.agentId };
        const allowed = await authorizeDelivery(copy(request), controller.signal);
        if (generation !== startedGeneration || halted() !== false || controller.signal.aborted) break;
        if (allowed !== true) throw new Error('Crew dispatch authorization or provider check failed; delivery is paused.');
        if (!roster.has(batch.sender) || !roster.has(recipient.agentId)) throw new Error('Crew dispatch roster changed; delivery is paused.');
        const runId = newId();
        if (typeof runId !== 'string' || !RECEIPT_ID.test(runId)) throw new Error('Invalid crew dispatch run ID.');
        if (state.batches.some(b => b.recipients.some(r => r.runId === runId))) throw new Error('Crew dispatch run ID was already used.');
        replaceRecipient(batch.requestId, recipient.agentId, { agentId: recipient.agentId, state: 'running', runId });
        active = { requestId: batch.requestId, agentId: recipient.agentId, runId };
        try {
          const receipt = await deliver(Object.assign({}, copy(request), { runId }), controller.signal);
          if (generation !== startedGeneration || halted() !== false || controller.signal.aborted) {
            replaceRecipient(batch.requestId, recipient.agentId, { agentId: recipient.agentId, state: 'uncertain', runId });
            break;
          }
          if (!receipt || !['responded', 'acknowledged'].includes(receipt.state)
              || typeof receipt.id !== 'string' || !RECEIPT_ID.test(receipt.id)
              || state.batches.some(b => b.recipients.some(r => r.receipt && r.receipt.id === receipt.id))
              || await verifyReceipt(Object.assign({}, copy(request), { runId }), copy(receipt)) !== true) {
            throw new Error('Crew dispatch receipt could not be verified.');
          }
          if (generation !== startedGeneration || halted() !== false || controller.signal.aborted) {
            replaceRecipient(batch.requestId, recipient.agentId, { agentId: recipient.agentId, state: 'uncertain', runId });
            break;
          }
          replaceRecipient(batch.requestId, recipient.agentId, {
            agentId: recipient.agentId, state: receipt.state, runId, receipt: { id: receipt.id }
          });
        } catch (error) {
          if (!fault) replaceRecipient(batch.requestId, recipient.agentId, { agentId: recipient.agentId, state: 'uncertain', runId });
          throw error;
        } finally { active = null; }
      }
    } finally { runController = null; busy = false; }
    return status();
  }
  return { stage, run, stop, resume, status };
}

module.exports = { makeCrewDispatchQueue };
