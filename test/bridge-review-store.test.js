'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = new Map();
global.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value)
};
const QTerminalStore = require('../frontend/app/qterminal.js');
let persistCount = 0;
let promptRefreshCount = 0;
global.App = {
  persist: () => { persistCount++; return true; },
  refreshAgentPrompts: () => { promptRefreshCount++; persistCount++; return true; }
};
const Store = require('../frontend/app/bridge-review-store.js');

assert.deepStrictEqual(Store.categories().map(category => category.id), [
  'communications', 'security', 'science', 'treasury', 'operations'
]);
assert.deepStrictEqual(Store.categories().map(category => category.ownerRole), [
  'Chief Comm Officer', 'Chief Security Officer', 'Chief Science Officer', 'The Treasurer', 'Chief Ops Officer'
]);
assert.strictEqual(Store.list('communications').length, 0, 'empty logs do not invent review records');
assert.strictEqual(Store.add('communications', { title: '', details: 'details' }).ok, false);
assert.strictEqual(Store.add('communications', {
  title: 'Repair suggestion', details: 'Review the affected relay.', recommendation: 'Replace the damaged module.'
}).ok, false, 'recommendations require an evidence source');

const added = Store.add('communications', {
  title: 'Relay interruption', details: 'Two open communications report a relay interruption.',
  source: 'Pinned comms log entry 18', recommendation: 'Inspect the affected relay.', urgent: true
});
assert.strictEqual(added.ok, true);
assert.strictEqual(added.item.urgent, true);
assert.deepStrictEqual(Store.approvalAuthority(added.item.id, 'chief-comm'), {
  ok: false, error: 'Only Q can approve a Bridge recommendation.'
});
assert.strictEqual(Store.approvalAuthority(added.item.id, 'Q').ok, true);
const officerBriefing = Store.promptClause({ id: 'science-officer', name: 'Chief Science Officer' });
assert.match(officerBriefing, /Relay interruption/);
assert.match(officerBriefing, /Inspect the affected relay/);
assert.match(officerBriefing, /Evidence \/ source:|Pinned comms log entry 18/);
assert.match(officerBriefing, /"urgent":true/);
assert.strictEqual(Store.promptClause({ id: 'unlisted', name: 'Unlisted Agent' }), '',
  'only listed Bridge officers receive shared review records in their briefings');
assert.strictEqual(Store.setStatus(added.item.id, 'resolved').ok, true);
assert.strictEqual(Store.approvalAuthority(added.item.id, 'Q').ok, false, 'resolved pins cannot be approved');
assert.strictEqual(Store.setStatus(added.item.id, 'open').ok, true);
assert.strictEqual(Store.approve(added.item.id, 'Q').ok, true);
assert.deepStrictEqual(Store.get(added.item.id).approval, {
  by: 'Q', level: 0, at: Store.get(added.item.id).approval.at, scope: 'Inspect the affected relay.'
});
assert.ok(Number.isFinite(Store.get(added.item.id).approval.at), 'approval receipt records its scoped authorization time');
assert.strictEqual(Store.markDispatched(added.item.id, 'stream-1').ok, false, 'dispatch requires a persisted one-time reservation');
assert.strictEqual(Store.claimDispatch(added.item.id, 'stream-1').ok, true);
assert.strictEqual(Store.claimDispatch(added.item.id, 'stream-1').ok, false, 'a one-time approval cannot be dispatched twice');
assert.strictEqual(Store.markDispatched(added.item.id, 'stream-1').ok, true);
assert.strictEqual(Store.get(added.item.id).workstreamId, 'stream-1');
const pending = Store.add('security', {
  title: 'Firewall review', details: 'Review the flagged configuration.',
  source: 'Pinned security finding', recommendation: 'Apply the approved firewall rule.'
});
assert.strictEqual(pending.ok, true);
assert.strictEqual(Store.approve(pending.item.id, 'Q').ok, true);
assert.strictEqual(Store.claimDispatch(pending.item.id, 'security-stream').ok, true);
assert.strictEqual(Store.hydrate(Store.serialize()), true);
assert.strictEqual(Store.claimDispatch(pending.item.id, 'security-stream').ok, false, 'pending one-time reservations survive reloads');
assert.strictEqual(Store.releaseDispatch(pending.item.id).ok, true, 'explicitly declined sends may release an unused reservation');
assert.ok(promptRefreshCount >= 3, 'pin, approval, and dispatch changes refresh the Bridge crew briefings');
assert.ok(persistCount >= 3, 'pinning, approval, and dispatch update the station save');
assert.ok(storage.has('starnet.bridge-review.v1'), 'review state is also cached locally');

const saved = Store.serialize();
const altered = JSON.parse(JSON.stringify(saved));
altered.items[0].recommendation = 'Inspect the relay repeatedly.';
assert.strictEqual(Store.hydrate(altered), true);
assert.strictEqual(Store.get(added.item.id).approval, null, 'an approval cannot authorize changed recommendation text');
assert.ok(Store.get(added.item.id).dispatchedAt, 'historical dispatch receipts remain visible after scope changes');
assert.strictEqual(Store.hydrate(saved), true);
assert.strictEqual(Store.list('communications')[0].dispatchedAt > 0, true, 'dispatch receipts survive hydration');
assert.strictEqual(Store.add('unknown', { title: 'x', details: 'y' }).ok, false);
assert.strictEqual(Store.setStatus(added.item.id, 'invalid').ok, false);

const props = fs.readFileSync(path.join(__dirname, '../frontend/app/propsprites.js'), 'utf8');
for (const id of ['commswall', 'ticker', 'chartwall', 'research_trendpillar', 'calwall', 'bridge_dispatch_pylon', 'pub_mailpod']) {
  assert.match(props, new RegExp('\\{ id: "' + id + '".*tier: "functional"'), id + ' is catalogued as functional');
}
const world = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
assert.match(world, /if \(surface && onBridgeSurface\) \{ onBridgeSurface\(surface\); return; \}/, 'bridge surfaces route from physical clicks');
const app = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
for (const id of ['commswall', 'ticker', 'chartwall', 'research_trendpillar', 'calwall', 'bridge_dispatch_pylon', 'pub_mailpod']) {
  assert.ok(app.includes(id + ':'), id + ' has an app window route');
}
assert.match(app, /bridgeReviews,? \}/, 'Bridge review state is included in station saves');
assert.match(app, /BridgeReviewStore\.hydrate\(saved\.bridgeReviews\)/, 'saved Bridge review state is restored');
assert.match(app, /BridgeReviewStore\.promptClause\(a\)/, 'shared review records are composed into agent briefings');
const reviewWindow = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/bridge-reviews.js'), 'utf8');
assert.match(reviewWindow, /granted permission for this specific operation for one execution/);
assert.match(reviewWindow, /Continuing or recurring execution is permitted only if Q explicitly specifies that scope/);
delete global.App;
