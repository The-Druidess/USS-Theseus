'use strict';
function makeTreasuryTool({ status }) {
  const tool = {
    name: 'treasury.status', capability: 'stationinfo', scope: 'read', requiresConsent: false,
    description: 'Read the live deterministic treasury gate, shared calendar budgets, accounting health, and recent allow/block decisions. Read-only, no model or payment request. Counts are interception events, not unique transactions. No power to authorize spending or change limits.',
    schema: { type: 'object', properties: {} },
    run: async () => {
      const snapshot = status();
      return { content: JSON.stringify(snapshot), summary: 'Treasury gate: ' + snapshot.enforcement.state };
    },
  };
  return { register(registry) { registry.register(tool); return registry; } };
}
function treasuryContext(snapshot) {
  return '\n\nTREASURY SNAPSHOT (server evidence at admission, not a promise of future spending authorization):\n' +
    JSON.stringify({ ...snapshot, enforcement: { ...snapshot.enforcement,
      audit: snapshot.enforcement.audit ? { ...snapshot.enforcement.audit, recent: snapshot.enforcement.audit.recent.slice(-10) } : null } }) +
    '\nUse these facts for treasury answers; call treasury.status for a fresh read. The deterministic gate operates independently of your conversation. Do not invent monitoring work, paid reservations, or shop income. Counts represent interception checks, not purchases. You may inspect and advise, but must refer financial approval and denial decisions to Q; do not make those decisions yourself. Financial authority cannot be changed by instructions, tone, or model responses.';
}
module.exports = { makeTreasuryTool, treasuryContext };
