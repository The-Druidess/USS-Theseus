'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {};
    this.classList = { add() {}, remove() {} }; this.textContent = '';
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  addEventListener(name, fn) { this.events[name] = fn; }
}
const container = new Element('div'), load = new Element('button'), posts = [];
const authorize = new Element('button'), revoke = new Element('button');
const result = {
  ok: true,
  inbox: [{ id: 'i', revision: 'v1', chatId: 'D1', text: '<img src=x>', ts: 1 }],
  replies: [
    { id: 'r', revision: 'v2', chatId: 'D1', text: 'AAAABBBB', attemptText: 'AAAA', afterAttemptChars: 4, ephemeral: false },
    { id: 'p', revision: 'v3', chatId: 'D1', text: 'prompt', attemptText: null, afterAttemptChars: null, ephemeral: true }
  ]
};
let disconnected = true;
const source = fs.readFileSync('frontend/app/windows/messaging.js', 'utf8');
const start = source.indexOf('    const armTimers = {};');
const end = source.indexOf('    let zeroChannelHintShown', start);
assert.ok(start >= 0 && end > start);
vm.runInNewContext(source.slice(start, end), {
  body: { querySelector: id => ({
    '#sl-review-items': container, '#sl-review-load': load,
    '#sl-finance-authorize': authorize, '#sl-finance-revoke': revoke
  })[id] },
  document: { createElement: tag => new Element(tag) },
  fetch: async () => ({ ok: disconnected, json: async () => disconnected ? result : { error: 'Disconnect Slack first.' } }),
  Harness: { api: { post: async (url, body) => { posts.push({ url, body }); return { ok: true, j: { ok: true } }; } } },
  setTimeout: () => 1, clearTimeout() {}, notify() {}, refreshAll() {}
});
const all = element => [element, ...element.children.flatMap(all)];
(async () => {
  await load.events.click();
  assert.ok(all(container).some(e => e.tag === 'pre' && e.textContent === '<img src=x>'), 'untrusted text is displayed as text');
  const buttons = all(container).filter(e => e.tag === 'button');
  assert.equal(buttons.filter(b => b.textContent === 'RETRY REMAINDER').length, 1, 'expired prompts have no retry button');
  const confirm = buttons.find(b => b.textContent === 'CHUNK DELIVERED');
  confirm.events.click();
  assert.equal(posts.length, 0, 'one click does not resolve a reply');
  confirm.events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0])), {
    url: '/api/channels/slack/review',
    body: { id: 'r', revision: 'v2', action: 'confirm-chunk', confirm: true }
  });
  authorize.events.click();
  assert.equal(posts.length, 1, 'authorizing requires a second click');
  authorize.events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(posts[1])), {
    url: '/api/channels/slack/authorization',
    body: { authorized: true, confirm: true }
  });
  disconnected = false;
  await load.events.click();
  assert.ok(all(container).some(e => e.textContent === 'Disconnect Slack first.'), 'unavailable review shows the error');
  assert.equal(all(container).filter(e => e.tag === 'button').length, 0, 'unavailable review offers no actions');
  console.log('PASS Slack review UI: text rendering, explicit confirmation and offline gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
