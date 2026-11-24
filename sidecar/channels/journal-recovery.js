'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { makeWorkspaceOwner, makeBootedAt } = require('../workspace-owner.js');
const { writeFileDurable } = require('../durable-write.js');
const { makeChannelStore, _internals: { validateSlackJournal } } = require('./store.js');
const { makeStrictFinance } = require('../strict-finance.js');
const { makeFinanceAudit } = require('../finance-audit.js');

const NAMES = ['inbox.json', 'inbox.json.bak', 'inbox.json.slack-guard',
  'outbox.json', 'outbox.json.bak', 'outbox.json.slack-guard'];
const CONFIRM_REPLACEMENT = 'I-ACCEPT-MISSING-RECEIPTS';
const CONFIRM_ITEM = 'I-REVIEWED-THIS-WORK';

function readOptional(file) {
  try { return fs.readFileSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function withWorkspace(root, work) {
  if (!root || !path.isAbsolute(root)) throw new Error('an absolute workspace path is required');
  const resolved = fs.realpathSync(root);
  const channels = path.join(resolved, 'channels');
  if (!fs.statSync(resolved).isDirectory() || !fs.lstatSync(channels).isDirectory())
    throw new Error('workspace and its channels directory must exist');
  const owner = makeWorkspaceOwner({ fs, path, now: () => Date.now(), bootedAt: makeBootedAt(() => Date.now()) });
  const claim = owner.acquire(resolved);
  if (!claim.ok) throw new Error('workspace ownership unavailable: ' + claim.code + '; stop the station before recovery');
  try { return work(resolved, channels); }
  finally {
    if (!owner.release()) throw new Error('workspace ownership could not be released');
  }
}

function snapshot(channels) {
  const result = {};
  for (const name of NAMES) result[name] = readOptional(path.join(channels, name));
  return result;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function revision(root, kind, files, candidate) {
  return digest([root, kind, NAMES.map(name => [name, files[name] === null ? null : files[name].toString('base64')]),
    candidate === undefined ? null : candidate.toString('base64')]);
}

function sameNonSlackEntry(a, b, kind) {
  const left = { ...a }, right = { ...b };
  delete left.recoveryHeld;
  delete right.recoveryHeld;
  if (kind === 'outbox' && (a.recoveryHeld || b.recoveryHeld)) {
    delete left.paused;
    delete right.paused;
  }
  return isDeepStrictEqual(left, right);
}

function parseCandidate(bytes, kind, files) {
  let candidate;
  try { candidate = JSON.parse(bytes.toString('utf8')); }
  catch (_) { throw new Error('replacement is not valid JSON'); }
  validateSlackJournal(candidate, kind);
  const selected = new Map(candidate.items.map(it => [it.id, it]));
  for (const name of [kind + '.json', kind + '.json.bak']) {
    if (files[name] === null) continue;
    let source;
    try { source = JSON.parse(files[name].toString('utf8')); } catch (_) { continue; }
    if (!source || !Array.isArray(source.items)) continue;
    for (const old of source.items) {
      if (!old || typeof old.id !== 'string' || !old.id) continue;
      const next = selected.get(old.id);
      if (!next || next.channel !== old.channel)
        throw new Error('replacement must retain every identifiable entry from readable journal copies: ' + old.id);
      if (old.channel !== 'slack' && !sameNonSlackEntry(next, old, kind))
        throw new Error('replacement must preserve non-Slack entries exactly; conflicting copies require manual reconciliation: ' + old.id);
      if (old.channel === 'slack' && (kind === 'inbox'
        ? old.message && old.message.chatId !== next.message.chatId
        : old.chatId !== next.chatId))
        throw new Error('replacement must retain Slack entry destinations: ' + old.id);
      if (kind === 'inbox' && old.channel === 'slack' && old.completed === true && next.completed !== true)
        throw new Error('replacement must retain completed Slack receipts');
      if (kind === 'inbox' && old.channel === 'slack' && old.completed !== true && next.completed === true)
        throw new Error('unfinished Slack inbox work must remain held for review');
      if (kind === 'outbox' && old.operationKey
          && (next.operationKey !== old.operationKey || next.operationHash !== old.operationHash
            || next.operationState !== old.operationState))
        throw new Error('replacement must retain Slack direct-operation identities and completed outcomes');
    }
  }
  for (const it of candidate.items) {
    if (kind === 'inbox') {
      if (!(it.channel === 'slack' && it.completed === true)) it.recoveryHeld = true;
      else delete it.recoveryHeld;
    } else if (it.operationState !== 'delivered' && it.operationState !== 'discarded') {
      it.paused = true;
      it.recoveryHeld = true;
    } else {
      delete it.recoveryHeld;
    }
  }
  validateSlackJournal(candidate, kind);
  return candidate;
}

function storeFor(channels) {
  return makeChannelStore({ fs, pathMod: path, root: channels, clock: { now: () => Date.now() }, writeDurable: writeFileDurable });
}

function audit(root, action, rev) {
  const guard = makeStrictFinance({
    read: () => {
      try { return JSON.parse(fs.readFileSync(path.join(root, 'strict-finance.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    audit: makeFinanceAudit({ fs, path, workspace: root, now: () => Date.now(),
      onError: error => console.error('[strict-finance] AUDIT UNAVAILABLE: ' + error.message) }),
    onError: error => console.error('[strict-finance] FAIL CLOSED: ' + error.message)
  });
  guard.assertSlackReviewAction(action, rev);
}

function archive(channels, files, candidate, details) {
  const parent = path.join(channels, 'journal-recovery');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(parent).isDirectory()) throw new Error('invalid recovery archive directory');
  const dir = path.join(parent, crypto.randomBytes(16).toString('hex'));
  fs.mkdirSync(dir, { mode: 0o700 });
  for (const name of NAMES) {
    if (files[name] !== null) writeFileDurable({ fs, path }, path.join(dir, name), files[name]);
  }
  if (candidate !== undefined) writeFileDurable({ fs, path }, path.join(dir, 'reviewed-replacement.json'), candidate);
  writeFileDurable({ fs, path }, path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1, ...details,
    files: NAMES.map(name => ({ name, present: files[name] !== null,
      sha256: files[name] === null ? null : crypto.createHash('sha256').update(files[name]).digest('hex') }))
  }));
  return dir;
}

function checkKind(kind) {
  if (kind !== 'inbox' && kind !== 'outbox') throw new Error('kind must be inbox or outbox');
}

function replacement(root, kind, candidatePath, expectedRevision, confirmation) {
  checkKind(kind);
  if (!candidatePath || !path.isAbsolute(candidatePath)) throw new Error('an absolute replacement path is required');
  return withWorkspace(root, (workspace, channels) => {
    const files = snapshot(channels);
    const bytes = fs.readFileSync(candidatePath);
    const candidate = parseCandidate(bytes, kind, files);
    const rev = revision(workspace, kind, files, bytes);
    const store = storeFor(channels);
    const markerBytes = files[kind + '.json.slack-guard'];
    const mainBytes = files[kind + '.json'];
    let damaged = mainBytes === null
      || (markerBytes !== null && markerBytes.toString('utf8') !== JSON.stringify('slack-journal-v1'));
    if (!damaged) {
      try { validateSlackJournal(JSON.parse(mainBytes.toString('utf8')), kind); }
      catch (_) { damaged = true; }
    }
    if (!damaged) throw new Error('journal is valid; replacement is restricted to damaged or missing journals');
    if (expectedRevision === undefined) return {
      revision: rev, kind, entries: candidate.items.length,
      held: candidate.items.filter(it => it.recoveryHeld).length,
      warning: 'Missing receipts and work may be unknowable. Review both copies and the replacement; all recovered active work will be held.'
    };
    if (confirmation !== CONFIRM_REPLACEMENT || expectedRevision !== rev)
      throw new Error('confirmation or revision is invalid; inspect again before replacing');
    audit(workspace, 'journal-replacement', rev);
    const archived = archive(channels, files, bytes, { action: 'replacement', kind, revision: rev });
    const marker = path.join(channels, kind + '.json.slack-guard');
    if (files[kind + '.json.slack-guard'] === null)
      writeFileDurable({ fs, path }, marker, JSON.stringify('slack-journal-v1'));
    writeFileDurable({ fs, path }, path.join(channels, kind + '.json'), JSON.stringify(candidate));
    writeFileDurable({ fs, path }, marker, JSON.stringify('slack-journal-v1'));
    if (kind === 'inbox') store.assertSlackInboxSafe(); else store.assertSlackOutboxSafe();
    return { ok: true, kind, held: candidate.items.filter(it => it.recoveryHeld).length, archive: archived,
      warning: 'Missing receipts and work may remain unknowable; review held items before resuming them.' };
  });
}

function held(root, kind, id, action, expectedRevision, confirmation) {
  checkKind(kind);
  return withWorkspace(root, (workspace, channels) => {
    const store = storeFor(channels);
    store.assertSlackInboxSafe();
    store.assertSlackOutboxSafe();
    const files = snapshot(channels);
    const rev = revision(workspace, kind, files);
    const raw = files[kind + '.json'];
    const items = (raw === null ? [] : JSON.parse(raw.toString('utf8')).items).filter(it => it.recoveryHeld);
    if (expectedRevision === undefined) return {
      revision: rev, kind, items: items.map(it => ({ id: it.id, channel: it.channel })),
      warning: 'Review the journal locally. Slack items must be resolved in the Messaging panel.'
    };
    if (confirmation !== CONFIRM_ITEM || expectedRevision !== rev)
      throw new Error('confirmation or revision is invalid; inspect held items again');
    const item = items.find(it => it.id === id);
    if (!item || item.channel === 'slack') throw new Error('held non-Slack item not found; use the Messaging panel for Slack');
    if (!['resume', 'discard'].includes(action)) throw new Error('action must be resume or discard');
    if (kind === 'outbox' && action === 'resume' && (item.reason === 'command' || item.reason === 'prompt'))
      throw new Error('expired command and permission prompts cannot be replayed');
    audit(workspace, 'journal-item-' + action, rev);
    const archived = archive(channels, files, undefined, { action, kind, revision: rev, id });
    if (kind === 'inbox') {
      if (action === 'resume') store.releaseRecoveredInbox(id);
      else if (!store.removeInbox(id)) throw new Error('held inbox entry disappeared');
    } else if (action === 'resume') store.resumeOutbox(id, item.text);
    else if (!store.removeOutbox(id)) throw new Error('held outbox entry disappeared');
    return { ok: true, kind, id, action, archive: archived };
  });
}

module.exports = { replacement, held, CONFIRM_REPLACEMENT, CONFIRM_ITEM };
