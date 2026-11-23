'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:11434/')) {
    const body = init?.body ? JSON.parse(init.body) : {};
    const system = Array.isArray(body.messages) ? body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n') : '';
    fs.appendFileSync(path.join(process.env.STARNET_WORKSPACES, 'inference-calls.jsonl'), JSON.stringify({ url, model: body.model, system }) + '\n');
    if (url.endsWith('/api/chat')) return new Response(JSON.stringify({
      model: body.model, message: { role: 'assistant', content: 'Local finance check complete.' },
      done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 4,
    }) + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    if (url.endsWith('/api/show')) return Response.json({ model_info: { 'general.architecture': 'qwen3' }, capabilities: ['completion'] });
    return Response.json({ models: [{ name: 'qwen3.5:4b' }] });
  }
  return nativeFetch(input, init);
};
require('../../sidecar/index.js');
