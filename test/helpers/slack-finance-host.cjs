'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nativeFetch = globalThis.fetch;
const calls = path.join(process.env.STARNET_WORKSPACES, 'slack-test-calls.jsonl');
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://slack.com/api/')) {
    fs.appendFileSync(calls, JSON.stringify({ url, redirect: init.redirect }) + '\n');
    if (url.endsWith('/apps.connections.open'))
      return Response.json({ ok: true, url: 'wss://wss-primary.slack.com/link/?ticket=fake' });
    if (url.endsWith('/chat.postMessage')) return Response.json({ ok: true, ts: '1.1' });
    throw new Error('unexpected Slack request');
  }
  if (url.startsWith('http://127.0.0.1:11434/')) return Response.json({ models: [] });
  return nativeFetch(input, init);
};
globalThis.WebSocket = class {
  constructor(url) {
    fs.appendFileSync(calls, JSON.stringify({ socket: new URL(url).hostname }) + '\n');
    queueMicrotask(() => { if (this.onopen) this.onopen(); });
  }
  send() {}
  close() { if (this.onclose) this.onclose(); }
};
require('../../sidecar/index.js');
