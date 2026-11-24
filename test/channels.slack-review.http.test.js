'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { makeChannelStore } = require('../sidecar/channels/store.js');
const { enable } = require('../scripts/enable-strict-finance.cjs');

(async () => {
  const host = SidecarFixture.create({ env: { STARNET_LIVE_PRICES: '0', STARNET_AUX_BUDGET: '0' } });
  const root = path.join(host.workspace, 'channels');
  fs.mkdirSync(root, { recursive: true });
  const store = makeChannelStore({ fs, pathMod: path, root, clock: { now: () => 1000 } });
  const held = { chatId: 'D1', text: 'held instruction password=synthetic-secret', messageId: '1' };
  store.pushInbox({ id: 'slack|D1|1', channel: 'slack', message: held });
  const reply = store.pushOutbox({ channel: 'slack', chatId: 'D1', text: 'AAAABBBB', reason: 'done' });
  store.pauseOutbox(reply.id, 'AAAABBBB', 'AAAA', 'BBBB');
  const legacy = store.pushOutbox({ channel: 'slack', chatId: 'D2', text: 'legacy', paused: true, reason: 'done' });
  const prompt = store.pushOutbox({ channel: 'slack', chatId: 'D3', text: 'prompt', paused: true, reason: 'prompt' });
  store.pushOutbox({ channel: 'telegram', chatId: 'T', text: 'other channel' });
  const inboxFile = path.join(root, 'inbox.json'), outboxFile = path.join(root, 'outbox.json');
  const recoveredInbox = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
  recoveredInbox.items[0].recoveryHeld = true;
  fs.writeFileSync(inboxFile, JSON.stringify(recoveredInbox));
  const recoveredOutbox = JSON.parse(fs.readFileSync(outboxFile, 'utf8'));
  recoveredOutbox.items.find(item => item.id === reply.id).recoveryHeld = true;
  fs.writeFileSync(outboxFile, JSON.stringify(recoveredOutbox));
  enable(host.workspace, ['qwen3.5:4b']);
  const get = () => host.json('GET', '/api/channels/slack/review');
  const act = (item, action, confirm = true) => host.json('POST', '/api/channels/slack/review', {
    id: item.id, revision: item.revision, action, confirm
  });
  try {
    await host.start();
    assert.equal((await host.request('/api/channels/slack/review', { headers: { 'X-StarNet-Token': '' } })).status, 403);
    assert.equal((await host.json('POST', '/api/halt', {})).status, 200);
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: true, confirm: false })).status, 400);
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: true, confirm: true })).status, 200);
    assert.equal((await host.json('GET', '/api/channels/status')).body.slack.financeAuthorized, true);
    assert.equal((await host.json('POST', '/api/channels/slack/connect', {})).status, 409, 'authorization does not resume E-STOP');
    let review = await get();
    assert.equal(review.status, 200, 'local review remains available under Strict Finance and E-STOP');
    assert.equal(review.body.inbox.length, 1);
    assert.equal(review.body.replies.length, 3);
    const inbox = review.body.inbox[0];
    const first = review.body.replies.find(x => x.id === reply.id);
    const old = review.body.replies.find(x => x.id === legacy.id);
    const ephemeral = review.body.replies.find(x => x.id === prompt.id);
    assert.equal(inbox.text, 'held instruction password=[redacted-secret]');
    assert.equal(store.loadInbox('slack')[0].message.text, held.text, 'review redaction does not alter the journal');
    assert.equal(first.attemptText, 'AAAA');
    assert.equal(first.afterAttemptChars, 4);
    assert.equal((await act(first, 'confirm-chunk', false)).status, 400, 'decisions require explicit confirmation');
    assert.equal((await act({ ...first, revision: 'stale' }, 'discard-reply')).status, 409);
    assert.equal((await act(old, 'confirm-chunk')).status, 409, 'legacy entries lack a proven chunk boundary');
    assert.equal((await act(ephemeral, 'retry-reply')).status, 409, 'expired prompts cannot be replayed');
    assert.equal((await act(first, 'confirm-chunk')).status, 200);
    const audit = JSON.parse(fs.readFileSync(path.join(host.workspace, 'finance-audit.json'), 'utf8'));
    assert.ok(audit.recent.some(entry => entry.surface === 'channel-review'
      && entry.operation === 'confirm-chunk:' + first.revision.slice(0, 16)));
    let remaining = store.loadOutbox('slack').find(x => x.id === reply.id);
    assert.equal(remaining.text, 'BBBB');
    assert.equal(remaining.paused, false);
    assert.equal(remaining.attemptText, undefined);
    assert.equal(remaining.recoveryHeld, undefined, 'confirming a recovered chunk releases its hold');
    assert.equal((await act(first, 'discard-reply')).status, 409, 'stale review cannot remove a changed item');
    assert.equal((await act(inbox, 'dismiss-inbox')).status, 200);
    assert.equal(store.loadInbox('slack')[0].completed, true, 'dismissal retains a deduplication receipt');
    assert.equal(store.loadInbox('slack')[0].recoveryHeld, undefined, 'dismissing recovered inbox work releases its hold');
    assert.equal((await act(old, 'retry-reply')).status, 200);
    assert.equal(store.loadOutbox('slack').find(x => x.id === legacy.id).paused, false);
    assert.equal((await act(ephemeral, 'discard-reply')).status, 200);
    assert.equal(store.loadOutbox('telegram').length, 1, 'other channel data is untouched');
    assert.equal((await host.json('GET', '/api/halt')).body.subsystems.slack.halted, true, 'review never resumes E-STOP');
    await host.restart();
    assert.equal((await host.json('GET', '/api/channels/status')).body.slack.financeAuthorized, true, 'authorization persists across restart');
    assert.equal((await host.json('POST', '/api/channels/slack/authorization', { authorized: false, confirm: true })).status, 200);
    assert.equal((await host.json('GET', '/api/channels/status')).body.slack.financeAuthorized, false);
    review = await get();
    assert.equal(review.body.inbox.length, 0);
    assert.equal(review.body.replies.length, 0);
    assert.equal(store.loadOutbox('slack').length, 2, 'queued work survives restart without sending');
  } finally { await host.dispose(); }
  const damaged = SidecarFixture.create({ env: { STARNET_LIVE_PRICES: '0', STARNET_AUX_BUDGET: '0' } });
  try {
    const damagedStore = makeChannelStore({ fs, pathMod: path, root: path.join(damaged.workspace, 'channels'), clock: { now: () => 1000 } });
    const item = damagedStore.pushOutbox({ channel: 'slack', chatId: 'D1', text: 'held reply', paused: true });
    enable(damaged.workspace, ['qwen3.5:4b']);
    fs.writeFileSync(path.join(damaged.workspace, 'finance-audit.json'), '{invalid');
    await damaged.start();
    assert.equal((await damaged.json('POST', '/api/channels/slack/authorization', { authorized: true, confirm: true })).status, 423);
    assert.equal(fs.existsSync(path.join(damaged.workspace, 'slack-finance-authorization.json')), false,
      'authorization cannot be granted without a durable audit record');
    const review = await damaged.json('GET', '/api/channels/slack/review');
    assert.equal(review.status, 200);
    const heldReply = review.body.replies.find(entry => entry.id === item.id);
    const refused = await damaged.json('POST', '/api/channels/slack/review', {
      id: item.id, revision: heldReply.revision, action: 'discard-reply', confirm: true
    });
    assert.equal(refused.status, 423, 'unavailable audit refuses the decision');
    assert.deepEqual(damagedStore.loadOutbox('slack').find(entry => entry.id === item.id), item,
      'audit failure leaves the held reply unchanged');
  } finally { await damaged.dispose(); }
  console.log('PASS Slack review: confirmation, redaction, audit failure, chunk progress and restart');
})().catch(error => { console.error(error); process.exitCode = 1; });
