'use strict';

const DIRECTIVE_LANGUAGE = 'DIRECTIVE LANGUAGE: PD = Prime Directive; SD = Security Directive; OD = Operating Directive.';

function makeCrewDirectiveTool({ roster }) {
  if (!roster || typeof roster.get !== 'function') throw new Error('crew.directive requires a roster');
  const tool = {
    name: 'crew.directive', capability: 'crewdirective', scope: 'read', readOnly: true, requiresConsent: false,
    description: 'Request a read-only copy of a crew agent’s saved individual directive and operating manual by agentId. Omit agentId to list crew names and IDs. Available regardless of clearance level. This reads saved records; it does not send a message or grant permission.',
    schema: { type: 'object', properties: { agentId: { type: 'string' } } },
    run: async (args, ctx) => {
      const requester = ctx && ctx.agentId;
      if (!requester || !roster.get(requester)) throw new Error('Directive request refused: requester is not in the crew roster.');
      const id = args && args.agentId;
      if (id === undefined) {
        return { content: JSON.stringify({ agents: [...roster].map(([agentId, agent]) => ({ agentId, name: agent.name || agentId })) }), summary: 'Listed crew for directive requests' };
      }
      if (typeof id !== 'string' || !id.trim()) throw new Error('Directive request requires an agentId.');
      const target = roster.get(id);
      if (!target) throw new Error('Directive request failed: agent not found.');
      if (typeof target.directive !== 'string' || typeof target.directiveManual !== 'string') {
        throw new Error('Directive record unavailable: the crew roster has not yet synced the agent’s dossier.');
      }
      return {
        content: JSON.stringify({ agentId: id, name: target.name || id, directive: target.directive, operatingManual: target.directiveManual }),
        summary: 'Read saved directive for ' + (target.name || id)
      };
    }
  };
  return { register(registry) { registry.register(tool); return registry; } };
}

module.exports = { makeCrewDirectiveTool, DIRECTIVE_LANGUAGE };
