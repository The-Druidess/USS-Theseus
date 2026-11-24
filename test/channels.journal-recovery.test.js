'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { replacement, held, CONFIRM_REPLACEMENT, CONFIRM_ITEM } = require('../sidecar/channels/journal-recovery.js');
const { makeWorkspaceOwner } = require('../sidecar/workspace-owner.js');
const { makeChannelStore } = require('../sidecar/channels/store.js');
const { makeChannelHub } = require('../sidecar/channels/hub.js');
const { POLICY } = require('../sidecar/strict-finance.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-journal-recovery-'));
const channels = path.join(root, 'channels');
fs.mkdirSync(channels);
const file = name => path.join(channels, name);
const put = (name, value) => fs.writeFileSync(file(name), typeof value === 'string' ? value : JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const guard = JSON.stringify('slack-journal-v1');
const inbox = { version: 1, items: [
  { id: 'telegram|T|7', channel: 'telegram', message: { chatId: 'T', messageId: '7', text: 'held' } },
  { id: 'slack|D|1', channel: 'slack', message: { chatId: 'D' }, completed: true }
] };
const outbox = { version: 1, items: [
  { id: 'telegram-reply', channel: 'telegram', chatId: 'T', text: 'held reply', paused: false },
  { id: 'telegram-resume', channel: 'telegram', chatId: 'U', text: 'reviewed reply', paused: false },
  { id: 'slack-done', channel: 'slack', chatId: 'D', text: '', paused: false,
    operationKey: hash('key'), operationHash: hash('content'), operationState: 'delivered' },
  { id: 'slack-pending', channel: 'slack', chatId: 'D', text: 'uncertain', paused: false,
    operationKey: hash('key2'), operationHash: hash('content2'), operationState: 'pending' }
] };
const candidateInbox = path.join(root, 'candidate-inbox.json');
const candidateOutbox = path.join(root, 'candidate-outbox.json');

(async () => {
  try {
    put('inbox.json', '{broken');
    put('inbox.json.bak', inbox);
    put('inbox.json.slack-guard', guard);
    put('outbox.json', '{broken too');
    put('outbox.json.bak', outbox);
    put('outbox.json.slack-guard', guard);
    fs.writeFileSync(candidateInbox, JSON.stringify(inbox));
    fs.writeFileSync(candidateOutbox, JSON.stringify(outbox));

    const owner = makeWorkspaceOwner({ fs, path, now: () => Date.now() });
    assert.ok(owner.acquire(root).ok);
    assert.throws(() => replacement(root, 'inbox', candidateInbox), /workspace ownership unavailable/);
    assert.equal(fs.readFileSync(file('inbox.json'), 'utf8'), '{broken');
    assert.ok(owner.release());

    const omitted = { version: 1, items: [inbox.items[1]] };
    fs.writeFileSync(candidateInbox, JSON.stringify(omitted));
    assert.throws(() => replacement(root, 'inbox', candidateInbox), /retain every identifiable entry/);
    const altered = JSON.parse(JSON.stringify(inbox));
    altered.items[0].message.text = 'changed';
    fs.writeFileSync(candidateInbox, JSON.stringify(altered));
    assert.throws(() => replacement(root, 'inbox', candidateInbox), /preserve non-Slack entries exactly/);
    fs.writeFileSync(candidateInbox, JSON.stringify(inbox));
    const review = replacement(root, 'inbox', candidateInbox);
    assert.equal(review.held, 1);
    assert.throws(() => replacement(root, 'inbox', candidateInbox, review.revision, 'yes'), /confirmation/);
    fs.writeFileSync(candidateInbox, JSON.stringify(inbox) + ' ');
    assert.throws(() => replacement(root, 'inbox', candidateInbox, review.revision, CONFIRM_REPLACEMENT), /revision/);
    fs.writeFileSync(candidateInbox, JSON.stringify(inbox));
    put('outbox.json', '{changed');
    assert.throws(() => replacement(root, 'inbox', candidateInbox, review.revision, CONFIRM_REPLACEMENT), /revision/);
    assert.equal(fs.readFileSync(file('inbox.json'), 'utf8'), '{broken');

    fs.writeFileSync(path.join(root, 'strict-finance.json'), '{invalid');
    const auditReview = replacement(root, 'inbox', candidateInbox);
    assert.throws(() => replacement(root, 'inbox', candidateInbox, auditReview.revision, CONFIRM_REPLACEMENT), /policy storage/);
    assert.equal(fs.readFileSync(file('inbox.json'), 'utf8'), '{broken');
    fs.writeFileSync(path.join(root, 'strict-finance.json'), JSON.stringify({
      ...POLICY, version: 1, enabled: true, mode: 'local-only', localModels: ['qwen3.5:4b']
    }));
    fs.writeFileSync(path.join(root, 'finance-audit.json'), '{invalid');
    assert.throws(() => replacement(root, 'inbox', candidateInbox, auditReview.revision, CONFIRM_REPLACEMENT), /audit storage/);
    assert.equal(fs.readFileSync(file('inbox.json'), 'utf8'), '{broken');
    fs.unlinkSync(path.join(root, 'strict-finance.json'));
    fs.unlinkSync(path.join(root, 'finance-audit.json'));

    const applied = replacement(root, 'inbox', candidateInbox, auditReview.revision, CONFIRM_REPLACEMENT);
    assert.equal(fs.readFileSync(path.join(applied.archive, 'inbox.json'), 'utf8'), '{broken');
    assert.deepEqual(fs.readFileSync(path.join(applied.archive, 'inbox.json.bak')), fs.readFileSync(file('inbox.json.bak')));
    assert.deepEqual(fs.readFileSync(path.join(applied.archive, 'reviewed-replacement.json')), fs.readFileSync(candidateInbox));
    assert.throws(() => replacement(root, 'inbox', candidateInbox), /journal is valid/);
    const alteredOutbox = JSON.parse(JSON.stringify(outbox));
    alteredOutbox.items.find(it => it.id === 'slack-done').operationState = 'pending';
    fs.writeFileSync(candidateOutbox, JSON.stringify(alteredOutbox));
    assert.throws(() => replacement(root, 'outbox', candidateOutbox), /direct-operation identities/);
    fs.writeFileSync(candidateOutbox, JSON.stringify(outbox));
    const cli = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'recover-channel-journal.cjs'),
      'inspect', '--workspace', root, '--kind', 'outbox', '--candidate', candidateOutbox
    ], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const cliRevision = JSON.parse(cli.stdout).revision;
    assert.match(cliRevision, /^[a-f0-9]{64}$/);
    const applyCli = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'recover-channel-journal.cjs'),
      'apply', '--workspace', root, '--kind', 'outbox', '--candidate', candidateOutbox,
      '--revision', cliRevision, '--confirm', CONFIRM_REPLACEMENT
    ], { encoding: 'utf8' });
    assert.equal(applyCli.status, 0, applyCli.stderr);
    const outApplied = JSON.parse(applyCli.stdout);
    assert.equal(fs.readFileSync(path.join(outApplied.archive, 'outbox.json'), 'utf8'), '{changed');

    const store = makeChannelStore({ fs, pathMod: path, root: channels, clock: { now: () => 1 } });
    assert.equal(store.loadInbox('telegram')[0].recoveryHeld, true);
    assert.equal(store.loadInbox('slack')[0].completed, true);
    assert.equal(store.loadOutbox('telegram')[0].paused, true);
    assert.equal(store.findSlackDirect(hash('key')).operationState, 'delivered');
    assert.equal(store.loadOutbox('slack')[0].recoveryHeld, true);
    let runs = 0, sends = 0;
    const hub = makeChannelHub({
      channel: 'telegram', store, runOnce: async () => { runs++; },
      send: async () => { sends++; return { ok: true }; }, emit: () => {},
      secrets: () => ({ key: 'k', model: 'm', configured: true })
    });
    await hub._internals.recoverInbox();
    await hub.onInbound({ chatId: 'T', messageId: '7', text: 'held' });
    await hub._internals.flushOutbox();
    hub.onMembership({ chatId: 'T', status: 'left' });
    assert.equal(runs, 0, 'held intake is neither replayed nor executed on redelivery');
    assert.equal(sends, 0, 'held outbox work is never sent');
    assert.equal(store.loadOutbox('telegram').length, 2, 'membership changes cannot discard held work');
    hub.close();

    const list = held(root, 'inbox');
    assert.deepEqual(list.items, [{ id: 'telegram|T|7', channel: 'telegram' }]);
    assert.throws(() => held(root, 'inbox', 'telegram|T|7', 'resume', list.revision, 'yes'), /confirmation/);
    const resolveCli = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'recover-channel-journal.cjs'),
      'resolve', '--workspace', root, '--kind', 'inbox', '--id', 'telegram|T|7',
      '--action', 'resume', '--revision', list.revision, '--confirm', CONFIRM_ITEM
    ], { encoding: 'utf8' });
    assert.equal(resolveCli.status, 0, resolveCli.stderr);
    const resolved = JSON.parse(resolveCli.stdout);
    assert.equal(store.loadInbox('telegram')[0].recoveryHeld, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(resolved.archive, 'inbox.json'), 'utf8')).items[0].recoveryHeld, true);
    assert.throws(() => held(root, 'inbox', 'telegram|T|7', 'resume', list.revision, CONFIRM_ITEM), /revision/);
    let recoveredRuns = 0;
    const recoveredHub = makeChannelHub({
      channel: 'telegram', store,
      runOnce: async o => { recoveredRuns++; o.emit('agent.token', { delta: 'done' }); o.emit('agent.run.end', { reason: 'done' }); },
      send: async () => ({ ok: true }), emit: () => {}, newId: () => 'reviewed-run',
      secrets: () => ({ key: 'k', model: 'm', configured: true })
    });
    await recoveredHub._internals.recoverInbox();
    assert.equal(recoveredRuns, 1, 'explicitly released non-Slack work can run');
    recoveredHub.close();
    const replies = held(root, 'outbox');
    assert.throws(() => held(root, 'outbox', 'slack-pending', 'resume', replies.revision, CONFIRM_ITEM), /Messaging panel/);
    held(root, 'outbox', 'telegram-reply', 'discard', replies.revision, CONFIRM_ITEM);
    const remaining = held(root, 'outbox');
    held(root, 'outbox', 'telegram-resume', 'resume', remaining.revision, CONFIRM_ITEM);
    let resumedSends = 0;
    const sender = makeChannelHub({ channel: 'telegram', store, runOnce: async () => {}, emit: () => {},
      send: async () => { resumedSends++; return { ok: true }; } });
    await sender._internals.flushOutbox();
    assert.equal(resumedSends, 1, 'only explicitly released non-Slack delivery is retried');
    assert.equal(store.loadOutbox('telegram').length, 0);
    sender.close();
    store.resumeOutbox('slack-pending', 'uncertain');
    assert.equal(store.loadOutbox('slack')[0].recoveryHeld, undefined);

    const retryRoot = path.join(root, 'interrupted');
    const retryChannels = path.join(retryRoot, 'channels');
    fs.mkdirSync(retryChannels, { recursive: true });
    const heldCopy = JSON.parse(JSON.stringify(outbox));
    heldCopy.items[0].recoveryHeld = true;
    heldCopy.items[0].paused = true;
    heldCopy.items[1].recoveryHeld = true;
    heldCopy.items[1].paused = true;
    fs.writeFileSync(path.join(retryChannels, 'outbox.json'), JSON.stringify(heldCopy));
    fs.writeFileSync(path.join(retryChannels, 'outbox.json.bak'), JSON.stringify(outbox));
    fs.writeFileSync(path.join(retryChannels, 'outbox.json.slack-guard'), 'invalid');
    const retryCandidate = path.join(retryRoot, 'candidate.json');
    fs.writeFileSync(retryCandidate, JSON.stringify(outbox));
    fs.writeFileSync(path.join(retryRoot, 'strict-finance.json'), JSON.stringify({
      ...POLICY, version: 1, enabled: true, mode: 'local-only', localModels: ['qwen3.5:4b']
    }));
    const interruptedStore = makeChannelStore({ fs, pathMod: path, root: retryChannels, clock: { now: () => 1 } });
    assert.throws(() => interruptedStore.loadOutbox(), /guard/);
    const retry = replacement(retryRoot, 'outbox', retryCandidate);
    replacement(retryRoot, 'outbox', retryCandidate, retry.revision, CONFIRM_REPLACEMENT);
    const auditRows = JSON.parse(fs.readFileSync(path.join(retryRoot, 'finance-audit.json'), 'utf8')).recent;
    assert.ok(auditRows.some(row => row.operation.startsWith('journal-replacement:')), 'strict finance records recovery before replacement');
    assert.equal(interruptedStore.loadOutbox('telegram').filter(it => it.recoveryHeld).length, 2,
      'interrupted replacement remains blocked and can be safely reviewed again');

    const blockedRoot = path.join(root, 'archive-blocked');
    const blockedChannels = path.join(blockedRoot, 'channels');
    fs.mkdirSync(blockedChannels, { recursive: true });
    fs.writeFileSync(path.join(blockedChannels, 'inbox.json'), '{broken');
    fs.writeFileSync(path.join(blockedChannels, 'inbox.json.bak'), JSON.stringify(inbox));
    fs.writeFileSync(path.join(blockedChannels, 'inbox.json.slack-guard'), guard);
    fs.writeFileSync(path.join(blockedChannels, 'journal-recovery'), 'not a directory');
    const blockedCandidate = path.join(blockedRoot, 'candidate.json');
    fs.writeFileSync(blockedCandidate, JSON.stringify(inbox));
    const blocked = replacement(blockedRoot, 'inbox', blockedCandidate);
    assert.throws(() => replacement(blockedRoot, 'inbox', blockedCandidate, blocked.revision, CONFIRM_REPLACEMENT));
    assert.equal(fs.readFileSync(path.join(blockedChannels, 'inbox.json'), 'utf8'), '{broken',
      'an archive failure never replaces the damaged journal');
    console.log('PASS channel journal recovery: ownership, revisions, archives, holds, finance and explicit review');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
