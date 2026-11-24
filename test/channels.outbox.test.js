/* node test/channels.outbox.test.js — the durable outbound-retry seam (store outbox + hub queue/flush).
   Proves: a FAILED reply is queued (only the undelivered remainder, never a /command reply), the queue is
   bounded + survives via the same atomic store, an adapter 'up' status redelivers it, a mid-session healthy
   send drains the backlog, and prolonged outages retain replies instead of silently giving up. */
'use strict';
const A = require('./_assert.js');
const pathMod = require('path');
const { makeChannelStore } = require('../sidecar/channels/store.js');
const { makeChannelHub } = require('../sidecar/channels/hub.js');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function memFs() {
  const files = new Map();
  return {
    files,
    readFileSync(p) { if (!files.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; } return files.get(p); },
    writeFileSync(p, data) { files.set(p, String(data)); },
    renameSync(a, b) { if (!files.has(a)) { const e = new Error('ENOENT: ' + a); e.code = 'ENOENT'; throw e; } files.set(b, files.get(a)); files.delete(a); },
    mkdirSync() {}
  };
}

let clk = 1000;
const clock = { now: () => clk };
const ROOT = '/ws/channels';
const mkStore = (fs, outboxLimits) => makeChannelStore({ fs: fs || memFs(), pathMod, root: ROOT, clock, outboxLimits });

// a hub over a controllable send + real store; runOnce streams one token so a real reply exists.
function mkHub(store, sendImpl, events) {
  return makeChannelHub({
    channel: 'telegram',
    runOnce: async (o) => { o.emit('agent.run.start', { runId: o.runId }); o.emit('agent.token', { delta: 'the result' }); o.emit('agent.run.end', { reason: 'done' }); },
    store,
    send: sendImpl,
    secrets: () => ({ key: 'k', model: 'm', configured: true }),
    emit: (name, payload) => events.push([name, payload]),
    newId: (() => { let n = 0; return () => 'run-' + (++n); })(),
    sleep: () => Promise.resolve(), outboxRetryMs: 5
  });
}

(async () => {
  {
    const fs = memFs(), store = mkStore(fs), sent = [];
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const makeHub = s => makeChannelHub({
      channel: 'slack', store: s, runOnce: async () => {}, emit: () => {}, directHash: digest,
      send: async (_chat, text) => { sent.push(text); return pending; }
    });
    const hub = makeHub(store), options = { idempotencyKey: digest('operation-1') };
    const first = hub.sendDirect('D', 'message', options);
    A.ok((await hub.sendDirect('D', 'message', options)).ok === false, 'concurrent direct retry cannot send again');
    A.eq(sent, ['message'], 'one request is in flight');
    finish({ ok: true, messageId: '1' });
    A.ok((await first).ok, 'direct send reports confirmed success');
    hub.close();
    const restarted = makeHub(mkStore(fs));
    A.ok((await restarted.sendDirect('D', 'message', options)).alreadyDelivered, 'a successful direct send is deduplicated after restart');
    A.ok(!(await restarted.sendDirect('D', 'different', options)).ok, 'an operation key cannot be reused with different text');
    A.eq(sent, ['message'], 'completed direct send is never repeated');
    restarted.close();
  }
  {
    const store = mkStore(), sent = [];
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, directHash: digest,
      send: async (_chat, text) => { sent.push(text); return { ok: false, deliveryUnknown: true }; }
    });
    const options = { idempotencyKey: digest('operation-unknown') };
    A.ok((await hub.sendDirect('D', 'uncertain', options)).deliveryUnknown, 'uncertain direct send is reported');
    A.ok((await hub.sendDirect('D', 'uncertain', options)).deliveryUnknown, 'uncertain retry remains held');
    const item = store.loadOutbox('slack')[0];
    store.removeOutbox(item.id);
    A.ok(!(await hub.sendDirect('D', 'uncertain', options)).ok, 'discarding preserves the operation tombstone');
    A.eq(sent, ['uncertain'], 'discarded or uncertain operations cannot send again');
    hub.close();
  }
  {
    const store = mkStore(), sent = [];
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, directHash: digest,
      outboxRetryMs: 60000,
      send: async (_chat, text) => {
        sent.push(text);
        return sent.length === 1 ? { ok: false, deliveryUnknown: false } : { ok: true, messageId: '1' };
      }
    });
    const options = { idempotencyKey: digest('operation-queued') };
    const first = await hub.sendDirect('D', 'queued', options);
    A.ok(!first.ok && /queued/.test(first.error), 'a known failure is reported as queued, not sent');
    A.ok(!(await hub.sendDirect('D', 'queued', options)).ok, 'caller retry does not duplicate a queued operation');
    A.eq(sent, ['queued'], 'only the outbox may retry the queued send');
    await hub._internals.flushOutbox();
    A.ok((await hub.sendDirect('D', 'queued', options)).alreadyDelivered, 'caller retry sees confirmed outbox completion');
    A.eq(sent, ['queued', 'queued'], 'outbox performs the only retry');
    hub.close();
  }

  // ---- A. store outbox CRUD: push/load/remove/bump round-trip; missing/corrupt -> [] ----
  {
    const s = mkStore();
    A.eq(s.loadOutbox(), [], 'missing outbox -> []');
    clk = 2000;
    const it = s.pushOutbox({ channel: 'telegram', chatId: '77', text: 'queued reply', runId: 'r1', agentId: 'ag', reason: 'done' });
    A.ok(it.id && it.tries === 0 && it.ts === 2000, 'pushed item is stamped from the injected clock');
    A.eq(s.loadOutbox('telegram').length, 1, 'loadOutbox(channel) finds it');
    A.eq(s.loadOutbox('discord'), [], 'another channel sees nothing');
    const b = s.bumpOutboxTry(it.id);
    A.eq(b.tries, 1, 'bump counts a failed attempt');
    A.eq(s.loadOutbox()[0].tries, 1, 'the bump persisted');
    A.eq(s.removeOutbox(it.id), true, 'remove drops it');
    A.eq(s.loadOutbox(), [], 'outbox empty after remove');
    A.eq(s.removeOutbox('nope'), false, 'removing a missing id is a safe no-op');
  }

  // ---- A2. durable ids remain unique when a restarted process sees the same clock tick ----
  {
    const store = mkStore(), sent = [];
    const text = '```js\n' + 'x'.repeat(45) + '\n```';
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, maxMessageLength: 20,
      send: async (chatId, chunk) => {
        sent.push(chunk);
        return sent.length === 1 ? { ok: true } : { ok: false, deliveryUnknown: true };
      }
    });
    await hub._internals.deliver('D1', text, 'fenced', 'done');
    const item = store.loadOutbox('slack')[0];
    A.eq(item.attemptText, sent[1], 'review retains the exact fenced chunk sent on the wire');
    A.ok(item.afterAttemptText.length > 0 && item.text.endsWith(item.afterAttemptText), 'review preserves the following unsent raw text');
    hub.close();
  }

  {
    const store = mkStore();
    let runs = 0;
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => { runs++; }, emit: () => {},
      send: async () => ({ ok: true }), secrets: () => ({ key: 'k', model: 'm', configured: true })
    });
    const processing = hub.onInbound({ chatId: 'D0', chatType: 'dm', userId: 'U', text: 'work', messageId: '1' });
    hub.close();
    let stopped = false;
    try { await processing; } catch (_) { stopped = true; }
    A.ok(stopped, 'closing Slack prevents accepted intake from starting on a later microtask');
    A.eq(runs, 0, 'no agent run begins after the hub closes');
    A.eq(store.loadInbox('slack').length, 1, 'halted intake stays held for review');
    A.ok(hub.quiescent(), 'halted intake becomes quiescent after it settles');
  }

  {
    const fs = memFs();
    clk = 2100;
    const firstStore = mkStore(fs);
    const first = firstStore.pushOutbox({ channel: 'telegram', chatId: 'one', text: 'first reply' });
    const restartedStore = mkStore(fs);
    const second = restartedStore.pushOutbox({ channel: 'telegram', chatId: 'two', text: 'second reply' });
    A.ok(first.id !== second.id, 'restart cannot reuse an existing durable outbox id at the same clock tick');
    A.eq(restartedStore.removeOutbox(first.id), true, 'acknowledging the first reply succeeds');
    A.eq(restartedStore.loadOutbox().map(x => x.chatId), ['two'], 'acknowledging one id preserves the other reply');
  }

  // ---- B. bounds: saturation refuses new work instead of evicting old replies; text stays bounded ----
  {
    const s = mkStore(memFs(), { maxOutbox: 3, maxOutboxChars: 20 });
    const big = s.pushOutbox({ channel: 'telegram', chatId: '1', text: 'x'.repeat(100) });
    A.ok(big.text.length < 100 && /truncated/.test(big.text), 'oversized reply is truncated with an honest marker');
    s.pushOutbox({ channel: 'telegram', chatId: '2', text: 't2' });
    s.pushOutbox({ channel: 'telegram', chatId: '3', text: 't3' });
    A.throws(() => s.pushOutbox({ channel: 'telegram', chatId: '4', text: 't4' }), 'full outbox refuses to discard an undelivered reply');
    const items = s.loadOutbox();
    A.eq(items.length, 3, 'outbox is bounded');
    A.eq(items.map(x => x.chatId), ['1', '2', '3'], 'every previously queued reply remains intact');
  }

  // ---- B2. durable inbox is idempotent, bounded, and survives a new store instance ----
  {
    const fs = memFs();
    const s = makeChannelStore({ fs, pathMod, root: ROOT, clock, inboxLimits: { maxInbox: 2 } });
    const msg = { chatId: '77', chatType: 'dm', userId: 'u', text: 'work', messageId: '9' };
    s.pushInbox({ id: 'telegram|77|9', channel: 'telegram', message: msg });
    s.pushInbox({ id: 'telegram|77|9', channel: 'telegram', message: msg });
    A.eq(s.loadInbox('telegram').length, 1, 'duplicate delivery creates one durable intake receipt');
    const restarted = makeChannelStore({ fs, pathMod, root: ROOT, clock, inboxLimits: { maxInbox: 2 } });
    A.eq(restarted.loadInbox('telegram')[0].message.text, 'work', 'unfinished intake survives a store restart');
    restarted.pushInbox({ id: 'telegram|78|10', channel: 'telegram', message: Object.assign({}, msg, { chatId: '78', messageId: '10' }) });
    A.throws(() => restarted.pushInbox({ id: 'telegram|79|11', channel: 'telegram', message: Object.assign({}, msg, { chatId: '79', messageId: '11' }) }), 'a full inbox refuses acknowledgement instead of dropping oldest work');
    A.eq(restarted.removeInbox('telegram|77|9'), true, 'completion removes exactly its receipt');
  }

  // ---- B3. hub claims before returning, clears after completion, and replays a crash survivor on poll-up ----
  {
    const store = mkStore();
    const sends = [], events = [];
    const hub = mkHub(store, async (chatId, text) => { sends.push({ chatId, text }); return { ok: true }; }, events);
    const msg = { chatId: '80', chatType: 'dm', userId: 'u', text: 'normal work', messageId: '30', ts: 1 };
    const running = hub.onInbound(msg);
    A.eq(store.loadInbox('telegram').length, 1, 'admitted message is durable synchronously before processing runs');
    await running;
    A.eq(store.loadInbox('telegram'), [], 'completed reply removes its durable intake receipt');
    hub.close();

    const crashed = { chatId: '81', chatType: 'dm', userId: 'u', text: 'survived crash', messageId: '31', ts: 2 };
    store.pushInbox({ id: 'telegram|81|31', channel: 'telegram', message: crashed });
    const restartedHub = mkHub(store, async (chatId, text) => { sends.push({ chatId, text }); return { ok: true }; }, events);
    restartedHub.onStatus({ state: 'up' });
    for (let i = 0; i < 10 && store.loadInbox('telegram').length; i++) await new Promise(r => setTimeout(r, 0));
    A.eq(store.loadInbox('telegram'), [], 'poll-up replays and completes unfinished durable intake');
    A.ok(sends.some(s => s.chatId === '81' && /the result/.test(s.text)), 'recovered intake produces its real reply');
    restartedHub.close();
  }

  // ---- C. hub queues ONLY the undelivered remainder of a failed reply ----
  {
    const events = [];
    const store = mkStore();
    // chunk limit 12 → 'the result' fits one chunk; make send fail
    let sendOk = false;
    const hub = mkHub(store, async () => (sendOk ? { ok: true } : { ok: false, error: 'net down' }), events);
    await hub.onInbound({ chatId: '55', chatType: 'dm', userId: 'u1', text: 'do the thing', messageId: 'm1', ts: 1 });
    const q = store.loadOutbox('telegram');
    A.eq(q.length, 1, 'the failed reply was queued');
    A.ok(/the result/.test(q[0].text), 'queued text carries the undelivered reply');
    A.ok(/delayed reply/.test(q[0].text), 'queued text is marked as delayed (honesty when it lands late)');
    A.eq(q[0].chatId, '55', 'queued under the right chat');
    const del = events.filter(e => e[0] === 'channel.delivery');
    A.eq(del.length, 1, 'the original failure still emitted its delivery event');
    A.eq(del[0][1].ok, false, '…as ok:false (no lie)');

    // ---- D. the adapter's next 'up' status redelivers it ----
    sendOk = true;
    hub.onStatus({ state: 'up' });
    await new Promise(r => setTimeout(r, 0));
    A.eq(store.loadOutbox('telegram'), [], 'outbox drained on the up status');
    const redeliver = events.filter(e => e[0] === 'channel.delivery' && e[1].reason === 'redelivered');
    A.eq(redeliver.length, 1, 'redelivery emitted an honest ok:true event');
    A.eq(redeliver[0][1].chatId, '55', 'redelivered to the right chat');
  }

  // ---- E. a successful NEW delivery also drains the backlog (mid-session failure, status never dropped) ----
  {
    const events = [];
    const store = mkStore();
    store.pushOutbox({ channel: 'telegram', chatId: '88', text: 'stranded earlier', runId: 'r0' });
    const hub = mkHub(store, async () => ({ ok: true }), events);
    await hub.onInbound({ chatId: '99', chatType: 'dm', userId: 'u1', text: 'hi again', messageId: 'm2', ts: 2 });
    await new Promise(r => setTimeout(r, 0));
    A.eq(store.loadOutbox('telegram'), [], 'backlog drained after a healthy send');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'redelivered' && e[1].chatId === '88'), 'the stranded reply reached its chat');
  }

  // ---- F. /command replies are never queued (ephemeral by design) ----
  {
    const events = [];
    const store = mkStore();
    const hub = mkHub(store, async () => ({ ok: false, error: 'down' }), events);
    await hub.onInbound({ chatId: '11', chatType: 'dm', userId: 'u1', text: '/help', messageId: 'm3', ts: 3 });
    A.eq(store.loadOutbox('telegram'), [], 'a failed /command reply is not queued');
  }

  // ---- F2. outbound-only recovery retries itself; no new inbound or poll reconnect is required ----
  {
    const events = [];
    const store = mkStore();
    let sendOk = false;
    const hub = mkHub(store, async () => (sendOk ? { ok: true } : { ok: false, error: 'outbound only' }), events);
    await hub.onInbound({ chatId: '12', chatType: 'dm', userId: 'u1', text: 'finish this', messageId: 'm4', ts: 4 });
    A.eq(store.loadOutbox('telegram').length, 1, 'outbound-only failure is queued');
    sendOk = true;
    await new Promise(r => setTimeout(r, 20));
    A.eq(store.loadOutbox('telegram'), [], 'scheduled retry drains it without a new message or poll transition');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'redelivered'), 'scheduled recovery emits the proven redelivery');
    hub.close();
  }

  // ---- G. prolonged outage: escalation is visible, but the reply remains queued until recovery ----
  {
    const events = [];
    const store = mkStore();
    store.pushOutbox({ channel: 'telegram', chatId: '13', text: 'doomed', runId: 'rX' });
    const hub = mkHub(store, async () => ({ ok: false, error: 'still down' }), events);
    const tries = hub._internals.OUTBOX_ESCALATE_TRIES;
    for (let i = 0; i < tries; i++) await hub._internals.flushOutbox();
    A.eq(store.loadOutbox('telegram').length, 1, 'the delayed reply is retained after ' + tries + ' attempts');
    const delayed = events.filter(e => e[0] === 'channel.delivery' && e[1].reason === 'redelivery-delayed');
    A.eq(delayed.length, 1, 'the prolonged delay emitted one honest escalation event');
    A.eq(delayed[0][1].ok, false, '…as ok:false');
    hub.close();
  }

  // ---- H. saturation backpressures durable intake, then replays it when old replies drain ----
  {
    const events = [];
    const store = mkStore(memFs(), { maxOutbox: 1 });
    store.pushOutbox({ channel: 'telegram', chatId: 'old', text: 'older delayed answer', runId: 'old-run' });
    let sendOk = false;
    const sends = [];
    const hub = mkHub(store, async (chatId, text) => { sends.push({ chatId, text }); return sendOk ? { ok: true } : { ok: false, error: 'down' }; }, events);
    let rejected = false;
    try { await hub.onInbound({ chatId: 'new', chatType: 'dm', userId: 'u1', text: 'new work', messageId: 'm5', ts: 5 }); }
    catch (_) { rejected = true; }
    A.ok(rejected, 'a reply that cannot enter the full outbox does not claim processing complete');
    A.eq(store.loadOutbox('telegram').map(x => x.chatId), ['old'], 'saturation preserves the older queued reply');
    A.eq(store.loadInbox('telegram').map(x => x.message.chatId), ['new'], 'the newer message remains durably pending');

    sendOk = true;
    await hub._internals.flushOutbox();
    for (let i = 0; i < 20 && store.loadInbox('telegram').length; i++) await new Promise(r => setTimeout(r, 0));
    A.eq(store.loadOutbox('telegram'), [], 'old queued reply drains after recovery');
    A.eq(store.loadInbox('telegram'), [], 'capacity recovery replays and completes the pending intake');
    A.ok(sends.some(x => x.chatId === 'new' && /the result/.test(x.text)), 'the backpressured message ultimately receives its answer');
    hub.close();
  }

  // ---- G. a FAILED merged text batch keeps EVERY bubble's durable inbox receipt, not just the winner's ----
  // The debounce loser used to `return rec.done`, which resolved even when processing threw — its receipt
  // was removed as "handled" while the merged work had actually failed, so recovery replayed only the
  // winning bubble and the rest of the thought was permanently lost.
  {
    const events = [];
    const store = mkStore(memFs(), { maxOutbox: 1 });
    store.pushOutbox({ channel: 'telegram', chatId: 'old', text: 'older delayed answer', runId: 'old-run' });
    let sendOk = false;
    const sends = [];
    const hub = makeChannelHub({
      channel: 'telegram',
      runOnce: async (o) => { o.emit('agent.run.start', { runId: o.runId }); o.emit('agent.token', { delta: 'the result' }); o.emit('agent.run.end', { reason: 'done' }); },
      store,
      send: async (chatId, text) => { sends.push({ chatId, text }); return sendOk ? { ok: true } : { ok: false, error: 'down' }; },
      secrets: () => ({ key: 'k', model: 'm', configured: true }),
      emit: (name, payload) => events.push([name, payload]),
      newId: (() => { let n = 0; return () => 'grun-' + (++n); })(),
      sleep: () => new Promise(r => setTimeout(r, 0)), outboxRetryMs: 5, textBatchWaitMs: 1
    });
    const bubble = (text, mid) => ({ chatId: '91', chatType: 'dm', userId: 'u1', text, messageId: mid, ts: 6 });
    const outcomes = await Promise.allSettled([hub.onInbound(bubble('check the deploy', 'b1')), hub.onInbound(bubble('and the logs', 'b2'))]);
    A.eq(outcomes.map(o => o.status), ['rejected', 'rejected'], 'the batch failure reaches every merged bubble, loser included');
    A.eq(store.loadInbox('telegram').map(x => x.id).sort(), ['telegram|91|b1', 'telegram|91|b2'], 'BOTH bubbles remain durably pending after the merged processing failed');

    sendOk = true;
    await hub._internals.flushOutbox();
    for (let i = 0; i < 40 && store.loadInbox('telegram').length; i++) await new Promise(r => setTimeout(r, 0));
    A.eq(store.loadInbox('telegram'), [], 'capacity recovery replays and completes every pending bubble');
    hub.close();
  }

  // ---- H. PARTIAL redelivery persists its progress: already-received chunks are never re-sent ----
  // A 3-chunk queued reply whose 3rd chunk hit a blip used to stay in the outbox WHOLE, so every retry
  // pass replayed chunks 1-2 at the member before failing again — the first two-thirds of the answer
  // over and over, the end never arriving until the transport healed for one full pass.
  {
    const events = [];
    const store = mkStore(memFs());
    store.pushOutbox({ channel: 'telegram', chatId: 'pp', text: 'AAAABBBBCCCC', runId: 'r-pp' });
    const sends = []; let calls = 0;
    const hub = makeChannelHub({
      channel: 'telegram',
      runOnce: async () => {},
      store,
      send: async (chatId, text) => { calls++; sends.push(text); return calls === 3 ? { ok: false, error: 'blip' } : { ok: true }; },
      secrets: () => ({ key: 'k', model: 'm', configured: true }),
      emit: (name, payload) => events.push([name, payload]),
      newId: (() => { let n = 0; return () => 'prun-' + (++n); })(),
      sleep: () => Promise.resolve(), outboxRetryMs: 5, maxMessageLength: 4
    });
    await hub._internals.flushOutbox();
    A.eq(store.loadOutbox('telegram')[0].text, 'CCCC', 'after a mid-item blip the item keeps ONLY the undelivered remainder');
    await hub._internals.flushOutbox();
    A.eq(sends, ['AAAA', 'BBBB', 'CCCC', 'CCCC'], 'the retry sends only the remainder — never the chunks the member already read');
    A.eq(store.loadOutbox('telegram'), [], 'the item completes and drains');
    hub.close();
  }

  // ---- H2. a FENCED partial remainder is rebuilt from RAW splits, and progress never counts as failure ----
  // Joining the fence-doctored send chunks baked reopenFences's synthetic ``` markers into the stored
  // text; the next pass re-fenced them — stray fence lines growing per retry on long code replies. And
  // bumpOutboxTry counted a pass that delivered real chunks toward the escalation ceiling.
  {
    const { chunkTextParts } = require('../sidecar/channels/hub.js');
    const events = [];
    const store = mkStore(memFs());
    const fencedText = 'intro line\n```\ncode a\ncode b\ncode c\ncode d\n```\nclosing prose';
    store.pushOutbox({ channel: 'telegram', chatId: 'fx', text: fencedText, runId: 'r-fx' });
    const parts = chunkTextParts(fencedText, 24);
    A.ok(parts.send.length >= 3 && parts.send.join('') !== fencedText, 'fixture: the fenced text splits and the send view is decorated');
    const sends = []; let calls = 0;
    const hub = makeChannelHub({
      channel: 'telegram', runOnce: async () => {}, store,
      send: async (chatId, text) => { calls++; sends.push(text); return calls === 2 ? { ok: false, error: 'blip' } : { ok: true }; },
      secrets: () => ({ key: 'k', model: 'm', configured: true }),
      emit: (name, payload) => events.push([name, payload]),
      newId: (() => { let n = 0; return () => 'fxrun-' + (++n); })(),
      sleep: () => Promise.resolve(), outboxRetryMs: 5, maxMessageLength: 24
    });
    await hub._internals.flushOutbox();
    const stored = store.loadOutbox('telegram')[0];
    A.eq(stored.text, parts.raw.slice(1).join(''), 'the remainder is the RAW tail of the original text — no synthetic fences baked in');
    A.eq(stored.tries, 0, 'a pass that delivered a real chunk is progress, never a counted failure');
    while (store.loadOutbox('telegram').length && calls < 40) await hub._internals.flushOutbox();
    A.eq(store.loadOutbox('telegram'), [], 'the item completes across retries');
    const fenceLines = (sends.join('\n').match(/^[ \t]{0,3}```/gm) || []).length;
    const perfectLines = (chunkTextParts(fencedText, 24).send.join('\n') + '\n' + chunkTextParts(parts.raw.slice(1).join(''), 24).send.join('\n')).match(/^[ \t]{0,3}```/gm).length;
    A.ok(fenceLines <= perfectLines, 'no fence duplication accumulates across retries (' + fenceLines + ' <= ' + perfectLines + ')');
    hub.close();
  }

  // An ambiguous result must stay paused even after reconnect and store reconstruction.
  {
    const fs = memFs(), store = mkStore(fs), events = [];
    const msg = { chatId: 'D0', chatType: 'dm', userId: 'U1', text: 'work', messageId: '1.2' };
    store.pushInbox({ id: 'slack|D0|1.2', channel: 'slack', message: msg });
    let runs = 0, sends = 0;
    const hub = makeChannelHub({
      channel: 'slack', store: mkStore(fs), runOnce: async () => { runs++; },
      send: async () => { sends++; return { ok: true }; }, emit: (name, payload) => events.push([name, payload])
    });
    await hub._internals.recoverInbox();
    await hub.onInbound(msg);
    A.eq(runs, 0, 'unfinished Slack work is not replayed after a restart or redelivery');
    A.eq(sends, 0, 'unfinished Slack work cannot generate a duplicate reply');
    A.eq(store.loadInbox('slack').length, 1, 'unfinished intake remains available for reconciliation');
    A.eq(store.slackReviewStatus().heldInbox, 1, 'review status counts held inbox work');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'inbox-reconciliation-required'), 'held intake is reported');
    A.throws(() => hub.onInbound(Object.assign({}, msg, { messageId: '' })), 'Slack intake without a stable message id is rejected');
    hub.close();
  }

  {
    const fs = memFs();
    const store = makeChannelStore({ fs, pathMod, root: ROOT, clock });
    const items = Array.from({ length: 10000 }, (_, i) => ({
      id: 'slack|D|' + i, channel: 'slack', message: { chatId: 'D' }, completed: true, ts: 1
    }));
    fs.files.set(store._internals.inboxFile(), JSON.stringify({ version: 1, items }));
    const entry = { id: 'slack|D|10000', channel: 'slack', message: { chatId: 'D', text: 'new work' } };
    store.pushInbox(entry);
    const restarted = makeChannelStore({ fs, pathMod, root: ROOT, clock });
    A.eq(restarted.loadInbox('slack').length, 10001, 'default retention admits work past the old 10,000-receipt limit');
    A.eq(restarted.pushInbox({ ...entry, id: 'slack|D|0' }).completed, true, 'old receipts still deduplicate after restart');
    A.eq(restarted.slackReviewStatus().receiptLimit, null, 'status reports no fixed receipt limit');
    A.throws(() => makeChannelStore({ fs, pathMod, root: ROOT, clock, inboxLimits: { maxSlackReceipts: 0 } }),
      'invalid explicit receipt limits are rejected');
  }

  {
    const fs = memFs(), events = [];
    const store = makeChannelStore({ fs, pathMod, root: ROOT, clock, inboxLimits: { maxInbox: 1, maxSlackReceipts: 2 } });
    let runs = 0, sends = 0;
    const makeHub = s => makeChannelHub({
      channel: 'slack', store: s, emit: (name, payload) => events.push([name, payload]),
      runOnce: async o => { runs++; o.emit('agent.token', { delta: 'answer' }); o.emit('agent.run.end', { reason: 'done' }); },
      send: async () => { sends++; return { ok: true }; },
      secrets: () => ({ key: 'k', model: 'm', configured: true })
    });
    const msg = id => ({ chatId: 'D6', chatType: 'dm', userId: 'U1', text: 'work', messageId: id });
    const hub = makeHub(store);
    await hub.onInbound(msg('1'));
    A.eq(store.loadInbox('slack')[0].message, { chatId: 'D6' }, 'completed receipt removes message content');
    A.eq(store.slackReviewStatus(), { heldInbox: 0, pausedReplies: 0, receipts: 1, receiptLimit: 2 }, 'review status counts completed receipts without exposing content');
    hub.close();
    const restarted = makeHub(makeChannelStore({ fs, pathMod, root: ROOT, clock, inboxLimits: { maxInbox: 1, maxSlackReceipts: 2 } }));
    await restarted.onInbound(msg('1'));
    A.eq([runs, sends], [1, 1], 'completed Slack redelivery does not repeat work or a reply');
    await restarted.onInbound(msg('2'));
    A.eq([runs, sends], [2, 2], 'completed receipts do not consume pending inbox capacity');
    A.throws(() => restarted.onInbound(msg('3')), 'a full receipt journal backpressures instead of evicting deduplication');
    restarted.close();
  }

  {
    const store = mkStore(), sent = [];
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, maxMessageLength: 4,
      send: async (chatId, text) => { sent.push(text); return pending; }
    });
    const delivery = hub._internals.deliver('D1', 'AAAABBBB', 'r0', 'done');
    A.eq(sent, ['AAAA'], 'the first Slack chunk is in flight');
    hub.close();
    finish({ ok: true });
    const result = await delivery;
    A.eq(result.ok, false, 'closing the hub interrupts a multi-chunk delivery');
    A.eq(sent, ['AAAA'], 'no further chunk is sent after close');
    A.eq(store.loadOutbox('slack').map(it => ({ text: it.text, paused: it.paused })),
      [{ text: 'BBBB', paused: false }], 'confirmed progress and unsent remainder survive close');
    let refused = false;
    try { await hub._internals.deliver('D1', 'new', 'r1', 'done'); } catch (_) { refused = true; }
    A.ok(refused, 'a closed Slack hub refuses new delivery');
    const restarted = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, maxMessageLength: 4,
      send: async (chatId, text) => { sent.push(text); return { ok: true }; }
    });
    await restarted._internals.flushOutbox();
    A.eq(sent, ['AAAA', 'BBBB'], 'a new hub sends only the unsent remainder');
    A.eq(store.loadOutbox('slack'), [], 'confirmed remainder is removed after reconnect');
    restarted.close();
  }

  {
    const fs = memFs(), store = mkStore(fs), sent = [];
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {}, maxMessageLength: 4,
      send: async (chatId, text) => { sent.push(text); return sent.length === 1 ? { ok: true } : pending; }
    });
    const delivery = hub._internals.deliver('D1', 'AAAABBBB', 'r0', 'done');
    for (let i = 0; i < 10 && sent.length < 2; i++) await new Promise(r => setTimeout(r, 0));
    const saved = mkStore(fs).loadOutbox('slack')[0];
    A.eq({ text: saved.text, paused: saved.paused }, { text: 'BBBB', paused: true }, 'initial delivery records its in-flight chunk after confirmed progress');
    A.eq({ attempt: saved.attemptText, tail: saved.afterAttemptText }, { attempt: 'BBBB', tail: '' }, 'the exact attempted chunk and following remainder are durable');
    const restarted = makeChannelHub({
      channel: 'slack', store: mkStore(fs), runOnce: async () => {}, emit: () => {},
      send: async (chatId, text) => { sent.push(text); return { ok: true }; }
    });
    await restarted._internals.flushOutbox();
    A.eq(sent, ['AAAA', 'BBBB'], 'initial in-flight delivery cannot be resent by a restarted hub');
    restarted.close();
    hub.close();
    A.eq(hub.quiescent(), false, 'a closed hub is not quiescent while a Slack send is in flight');
    finish({ ok: false, deliveryUnknown: true });
    await delivery;
    A.eq(hub.quiescent(), true, 'the hub becomes quiescent after the send settles');
  }

  {
    const store = mkStore(memFs(), { maxOutbox: 1, maxOutboxChars: 4 });
    let sends = 0;
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {},
      send: async () => { sends++; return { ok: true }; }
    });
    let tooLong = false;
    try { await hub._internals.deliver('D1', '12345', 'r', 'done'); } catch (_) { tooLong = true; }
    A.ok(tooLong, 'a reply too large to journal is refused rather than truncated');
    store.pushOutbox({ channel: 'slack', chatId: 'old', text: 'old' });
    let full = false;
    try { await hub._internals.deliver('D1', '1234', 'r', 'done'); } catch (_) { full = true; }
    A.ok(full, 'a full outbox refuses an unjournaled initial send');
    A.eq(sends, 0, 'journal failures cannot send a Slack message');
    hub.close();
  }

  {
    const fs = memFs();
    const store = mkStore(fs);
    const events = [], sent = [];
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {},
      send: async (chatId, text) => { sent.push(text); return { ok: false, deliveryUnknown: true }; },
      emit: (name, payload) => events.push([name, payload]), maxMessageLength: 100
    });
    await hub._internals.deliver('D1', 'uncertain reply', 'r1', 'done');
    A.eq(store.loadOutbox('slack')[0].paused, true, 'unknown initial delivery is stored paused');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'delivery-unknown'), 'unknown delivery is reported');
    hub.close();
    const restarted = makeChannelHub({
      channel: 'slack', store: mkStore(fs), runOnce: async () => {},
      send: async (chatId, text) => { sent.push(text); return { ok: true }; }, emit: () => {}
    });
    await restarted._internals.flushOutbox();
    A.eq(sent, ['uncertain reply'], 'restarted flush does not resend a paused delivery');
    restarted.close();
  }

  {
    const store = mkStore(), hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {},
      send: async () => { throw new Error('transport exception'); }, emit: () => {}
    });
    await hub._internals.deliver('D1', 'reply', 'r2', 'done');
    A.eq(store.loadOutbox('slack')[0].paused, true, 'unexpected Slack send exceptions also pause delivery');
    hub.close();
  }

  {
    const store = mkStore(), hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {},
      send: async () => ({}), emit: () => {}
    });
    await hub._internals.deliver('D1', 'reply', 'r3', 'done');
    A.eq(store.loadOutbox('slack')[0].paused, true, 'a malformed Slack result is not mistaken for success');
    hub.close();
  }

  // A queued reply can become uncertain after some chunks were confirmed.
  {
    const fs = memFs(), store = mkStore(fs), sent = [], events = [];
    store.pushOutbox({ channel: 'slack', chatId: 'D2', text: 'AAAABBBBCCCC' });
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, maxMessageLength: 4,
      send: async (chatId, text) => {
        sent.push(text);
        return sent.length === 2 ? { ok: false, deliveryUnknown: true } : { ok: true };
      },
      emit: (name, payload) => events.push([name, payload])
    });
    await hub._internals.flushOutbox();
    const item = mkStore(fs).loadOutbox('slack')[0];
    A.eq(item.text, 'BBBBCCCC', 'paused remainder excludes confirmed chunks');
    A.eq(item.paused, true, 'uncertain queued delivery is durably paused');
    A.eq(store.slackReviewStatus().pausedReplies, 1, 'review status counts paused replies');
    await hub._internals.flushOutbox();
    A.eq(sent, ['AAAA', 'BBBB'], 'another flush cannot resend the uncertain chunk');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'delivery-unknown'), 'paused retry emits a delivery warning');
    hub.close();
  }

  // A crash during a retry must leave the currently attempted chunk paused on disk.
  {
    const fs = memFs(), store = mkStore(fs), sent = [];
    store.pushOutbox({ channel: 'slack', chatId: 'D3', text: 'AAAABBBB' });
    let finish;
    const inFlight = new Promise(resolve => { finish = resolve; });
    const options = {
      channel: 'slack', store, runOnce: async () => {}, maxMessageLength: 4, emit: () => {},
      send: async (chatId, text) => { sent.push(text); return sent.length === 1 ? { ok: true } : inFlight; }
    };
    const hub = makeChannelHub(options);
    const flushing = hub._internals.flushOutbox();
    for (let i = 0; i < 10 && sent.length < 2; i++) await new Promise(r => setTimeout(r, 0));
    const persisted = mkStore(fs).loadOutbox('slack')[0];
    A.eq(sent, ['AAAA', 'BBBB'], 'the second chunk is in flight after the first is confirmed');
    A.eq({ text: persisted.text, paused: persisted.paused }, { text: 'BBBB', paused: true }, 'attempt and confirmed progress were saved before sending');
    const restarted = makeChannelHub(Object.assign({}, options, {
      store: mkStore(fs),
      send: async (chatId, text) => { sent.push(text); return { ok: true }; }
    }));
    await restarted._internals.flushOutbox();
    A.eq(sent, ['AAAA', 'BBBB'], 'a reconstructed hub cannot resend an in-flight chunk');
    restarted.close();
    finish({ ok: false, deliveryUnknown: true });
    await flushing;
    hub.close();
  }

  {
    const store = mkStore();
    store.pushOutbox({ channel: 'slack', chatId: 'D4', text: 'reply' });
    store.pauseOutbox = () => { throw new Error('disk unavailable'); };
    let sends = 0;
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {},
      send: async () => { sends++; return { ok: true }; }
    });
    await hub._internals.flushOutbox();
    await hub._internals.flushOutbox();
    A.eq(sends, 0, 'a failed attempt journal write prevents Slack sends');
    hub.close();
  }

  {
    const store = mkStore(), sent = [];
    store.pushOutbox({ channel: 'slack', chatId: 'D5', text: 'AAAABBBB' });
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, maxMessageLength: 4, emit: () => {},
      send: async (chatId, text) => {
        sent.push(text);
        return sent.length === 2 ? { ok: false, error: 'ratelimited' } : { ok: true };
      }
    });
    await hub._internals.flushOutbox();
    A.eq({ text: store.loadOutbox('slack')[0].text, paused: store.loadOutbox('slack')[0].paused },
      { text: 'BBBB', paused: false }, 'a definite rejection leaves only the remaining chunk retryable');
    await hub._internals.flushOutbox();
    A.eq(sent, ['AAAA', 'BBBB', 'BBBB'], 'a definite failure retries without repeating confirmed chunks');
    A.eq(store.loadOutbox('slack'), [], 'a confirmed retry clears the queued reply');
    hub.close();
  }

  {
    for (const kind of ['inbox', 'outbox']) {
      const fs = memFs(), store = mkStore(fs);
      const file = kind === 'inbox' ? store._internals.inboxFile() : store._internals.outboxFile();
      if (kind === 'inbox') {
        store.pushInbox({ id: 'slack|D|1', channel: 'slack', message: { chatId: 'D', text: 'work' } });
        store.completeSlackInbox('slack|D|1');
      } else {
        const it = store.pushOutbox({ channel: 'slack', chatId: 'D', text: 'answer' });
        store.pauseOutbox(it.id, 'answer');
      }
      const backup = fs.files.get(file + '.bak');
      fs.files.set(file, '{corrupt');
      const otherWrite = () => kind === 'inbox'
        ? store.pushInbox({ id: 'telegram|T|1', channel: 'telegram', message: { chatId: 'T' } })
        : store.pushOutbox({ channel: 'telegram', chatId: 'T', text: 'other' });
      A.throws(otherWrite, kind + ': another channel cannot rewrite a stale Slack backup');
      A.eq(fs.files.get(file), '{corrupt', kind + ': corrupt main is preserved for reconciliation');
      A.eq(fs.files.get(file + '.bak'), backup, kind + ': stale backup is not modified');
      fs.files.delete(file);
      fs.files.delete(file + '.bak');
      A.throws(otherWrite, kind + ': guard blocks writes when both journal copies are missing');
      A.ok(!fs.files.has(file), kind + ': missing journal is not recreated by another channel');
    }
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const file = store._internals.outboxFile();
    const slack = { id: 'old', channel: 'slack', chatId: 'D', text: 'old reply', paused: true };
    fs.files.set(file, JSON.stringify({ version: 1, items: [slack] }));
    A.eq(store.loadOutbox('telegram'), [], 'a legacy shared journal remains readable');
    A.ok(fs.files.has(file + '.slack-guard'), 'reading legacy Slack data creates a durable guard');
    fs.files.set(file, '{corrupt');
    A.throws(() => store.loadOutbox('telegram'), 'the migrated guard blocks other channels from stale recovery');
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const file = store._internals.outboxFile();
    fs.files.set(file, '{corrupt');
    fs.files.set(file + '.bak', JSON.stringify({ version: 1, items: [{ id: 'old', channel: 'slack', chatId: 'D', text: 'old' }] }));
    A.throws(() => store.pushOutbox({ channel: 'telegram', chatId: 'T', text: 'other' }),
      'a legacy backup containing Slack cannot be recovered over a corrupt main');
    A.eq(fs.files.get(file), '{corrupt', 'legacy corrupt main remains untouched');
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const file = store._internals.outboxFile();
    const item = store.pushOutbox({ channel: 'telegram', chatId: 'T', text: 'reply' });
    store.bumpOutboxTry(item.id);
    fs.files.set(file, '{corrupt');
    A.eq(store.loadOutbox('telegram')[0].tries, 0, 'a Telegram-only journal retains its existing backup recovery');
    A.ok(!fs.files.has(file + '.slack-guard'), 'Telegram-only recovery does not create a Slack guard');
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = (p, value) => {
      if (p.indexOf('.slack-guard.') !== -1) throw new Error('guard storage unavailable');
      originalWrite(p, value);
    };
    A.throws(() => store.pushOutbox({ channel: 'slack', chatId: 'D', text: 'reply' }),
      'Slack refuses to journal if its guard cannot be persisted');
    A.ok(!fs.files.has(store._internals.outboxFile()), 'failed guard creation does not create a journal');
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const file = store._internals.inboxFile();
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = (p, value) => {
      if (p.indexOf(file + '.') === 0 && p.indexOf('.slack-guard.') === -1) throw new Error('journal storage unavailable');
      originalWrite(p, value);
    };
    A.throws(() => store.pushInbox({ id: 'slack|D|1', channel: 'slack', message: { chatId: 'D' } }),
      'interrupted first Slack journal initialization fails');
    fs.writeFileSync = originalWrite;
    A.ok(fs.files.has(file + '.slack-guard'), 'guard survives interrupted initialization');
    A.throws(() => mkStore(fs).pushInbox({ id: 'telegram|T|1', channel: 'telegram', message: { chatId: 'T' } }),
      'another channel cannot initialize over the interrupted journal after restart');
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const item = store.pushOutbox({ channel: 'slack', chatId: 'D7', text: 'reply' });
    store.pauseOutbox(item.id, 'reply');
    fs.files.set(store._internals.outboxFile(), '{corrupt');
    A.throws(() => store.slackReviewStatus(), 'review status refuses corrupt journal rather than reporting stale counts');
    let sends = 0, rejected = false;
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: () => {},
      send: async () => { sends++; return { ok: true }; }
    });
    try { await hub._internals.flushOutbox(); } catch (_) { rejected = true; }
    A.ok(rejected, 'corrupt Slack outbox refuses to use its stale backup');
    A.eq(sends, 0, 'corrupt outbox cannot resend from stale state');
    hub.close();
  }

  {
    const fs = memFs(), store = mkStore(fs), events = [];
    let sends = 0;
    const hub = makeChannelHub({
      channel: 'slack', store, runOnce: async () => {}, emit: (name, payload) => events.push([name, payload]),
      send: async () => { sends++; fs.files.set(store._internals.outboxFile(), '{corrupt'); return { ok: true }; }
    });
    const result = await hub._internals.deliver('D7', 'reply', 'r7', 'done');
    A.eq(result.ok, false, 'confirmed delivery is not reported as durable when its journal became corrupt');
    A.ok(events.some(e => e[0] === 'channel.delivery' && e[1].reason === 'delivery-unknown'), 'journal corruption after a send is visible');
    let rejected = false;
    try { await hub._internals.flushOutbox(); } catch (_) { rejected = true; }
    A.ok(rejected, 'corrupt journal blocks further automatic delivery');
    A.eq(sends, 1, 'a successful send is not repeated using an old backup');
    hub.close();
  }

  {
    const fs = memFs(), store = mkStore(fs);
    const msg = { chatId: 'D8', chatType: 'dm', userId: 'U1', text: 'work', messageId: '8' };
    store.pushInbox({ id: 'slack|D8|8', channel: 'slack', message: msg });
    store.completeSlackInbox('slack|D8|8');
    fs.files.delete(store._internals.inboxFile());
    const hub = makeChannelHub({ channel: 'slack', store, runOnce: async () => {}, send: async () => ({ ok: true }), emit: () => {} });
    A.throws(() => hub.onInbound(msg), 'missing Slack inbox with a backup refuses a stale deduplication state');
    hub.close();
  }

  A.report('channels.outbox.test');
})().catch(e => { console.error(e); process.exit(1); });
