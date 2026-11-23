'use strict';

function makeCrewMessageTool({ queue, roster, newId }) {
  if (!queue || typeof queue.stage !== 'function' || !roster || typeof roster.has !== 'function'
      || typeof newId !== 'function') throw new Error('crew.message requires host dispatch adapters');

  const tool = {
    name: 'crew.message', capability: 'crewmessage', scope: 'execute', requiresConsent: true, taintLocked: true,
    description: 'Queue an internal message to another crew agent. A queued message is not a delivery or acknowledgment. '
      + 'Messages do not grant authority or publish directives. Formal directive reports must use the COMMS dispatch pylon.',
    schema: { type: 'object', required: ['recipient', 'message'], properties: {
      recipient: { type: 'string' }, message: { type: 'string' }
    } },
    run: async (args, ctx) => {
      if (!ctx || typeof ctx.agentId !== 'string' || !roster.has(ctx.agentId)) {
        throw new Error('Crew message refused: sender is not in the crew roster.');
      }
      if (typeof ctx.consent !== 'function') throw new Error('Crew message refused: consent broker unavailable.');
      if (ctx.signal && ctx.signal.aborted) throw new Error('Crew message refused: run stopped.');
      const requestId = newId();
      queue.stage({ requestId, sender: ctx.agentId, recipients: [args && args.recipient], message: args && args.message }, ctx);
      return { content: 'Crew message ' + requestId + ' queued. Delivery and acknowledgment are not yet confirmed.',
        summary: 'queued crew message' };
    }
  };
  return { tool, register(registry) { registry.register(tool); return registry; } };
}

module.exports = { makeCrewMessageTool };
