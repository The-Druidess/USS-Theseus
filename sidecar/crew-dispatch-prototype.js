'use strict';

// This staging-only prototype is deliberately disconnected from the run host.
// It has no runner or resume operation until E-STOP and receipt integration are proven.
const { makeDomainStore } = require('./domain-store.js');

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;

function validate(value) {
  if (!value || !Array.isArray(value.batches)) throw new Error('Invalid crew dispatch prototype state.');
  const requests = new Set();
  for (const batch of value.batches) {
    if (!batch || typeof batch.requestId !== 'string' || !REQUEST_ID.test(batch.requestId) || requests.has(batch.requestId)
        || batch.sender !== 'bridge-comms' || typeof batch.message !== 'string'
        || !batch.message.trim() || batch.message.length > 4000
        || !Array.isArray(batch.recipients) || !batch.recipients.length || batch.recipients.length > 100
        || batch.recipients.some(id => typeof id !== 'string' || !ID.test(id) || id === batch.sender)
        || new Set(batch.recipients).size !== batch.recipients.length) {
      throw new Error('Invalid crew dispatch prototype state.');
    }
    requests.add(batch.requestId);
  }
  return value;
}

function makeCrewDispatchPrototype({ fs, path, file, authorize, roster }) {
  if (typeof authorize !== 'function' || !roster || typeof roster.has !== 'function') {
    throw new Error('Crew dispatch prototype requires host authorization and a roster.');
  }
  const store = makeDomainStore({ fs, path, file, defaults: () => ({ batches: [] }), normalize: validate });
  const loaded = store.load();
  if (!['absent', 'ok', 'recovered'].includes(loaded.status)) {
    throw new Error('Crew dispatch prototype storage unavailable: ' + loaded.status);
  }
  let state = loaded.value;
  let persisted = loaded.status !== 'absent';
  let fault = loaded.status === 'recovered'
    ? 'Recovered backup may be stale; manual reconciliation is required.' : null;

  function status() {
    return { paused: true, reason: 'E-STOP and delivery receipts are not integrated.',
      storageFault: fault, batches: JSON.parse(JSON.stringify(state.batches)) };
  }

  function stage(input, authority) {
    if (fault) throw new Error('Crew dispatch prototype is locked: ' + fault);
    if (!input || input.sender !== 'bridge-comms' || typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)
        || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000
        || !Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 100
        || input.recipients.some(id => typeof id !== 'string' || !ID.test(id) || id === input.sender || !roster.has(id))
        || new Set(input.recipients).size !== input.recipients.length) {
      throw new Error('Invalid crew dispatch request.');
    }
    const batch = { requestId: input.requestId, sender: input.sender, message: input.message.trim(),
      recipients: input.recipients.slice() };
    if (authorize(authority, JSON.parse(JSON.stringify(batch))) !== true) {
      throw new Error('Crew dispatch request lacks host authorization.');
    }
    const current = store.load();
    if (!((current.status === 'absent' && !persisted)
        || (current.status === 'ok' && persisted && JSON.stringify(current.value) === JSON.stringify(state)))) {
      fault = 'Storage changed or became unavailable; manual reconciliation is required.';
      throw new Error('Crew dispatch prototype is locked: ' + fault);
    }
    const existing = state.batches.find(row => row.requestId === batch.requestId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(batch)) throw new Error('Request ID already belongs to a different report.');
      return status();
    }
    if (state.batches.some(row => row.message === batch.message && row.recipients.some(id => batch.recipients.includes(id)))) {
      throw new Error('A matching report is already staged for at least one recipient.');
    }
    const next = { batches: state.batches.concat([batch]) };
    try { store.save(next); }
    catch (error) {
      fault = 'A storage write could not be confirmed; manual reconciliation is required.';
      throw error;
    }
    state = next;
    persisted = true;
    return status();
  }

  return { status, stage };
}

module.exports = { makeCrewDispatchPrototype };
