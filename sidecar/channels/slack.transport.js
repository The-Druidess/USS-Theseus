/* sidecar/channels/slack.transport.js — the ONLY network-touching piece of the Slack channel.

   Slack differs from Telegram the same way Discord does: inbound messages arrive over a push socket, not an
   HTTP long-poll. Slack's local-first path is SOCKET MODE — no public webhook URL needed: an app-level token
   (xapp-…) opens a WebSocket via apps.connections.open, event envelopes arrive over it (acknowledged by
   envelope_id after intake), and sends are plain REST chat.postMessage calls with the bot token (xoxb-…).

   We bridge that push to the adapter's getUpdates()/send() seam exactly like discord.transport.js: the socket
   fills an internal BUFFER, getUpdates() drains it (parking briefly when empty), and a dropped socket simply
   reopens lazily on the next poll (the poll cadence IS the backoff). A fatal auth failure (invalid_auth /
   not_allowed_token_type on apps.connections.open) is remembered and THROWN from the next getUpdates with
   `.fatal=true`, so the adapter's loop stops for good with an honest error status.

     makeSlackTransport({ fetch, botToken, appToken, WebSocketImpl, apiBase?, sleep?, parkMs? }) ->
       { getUpdates({ signal }) -> raw[], send(channelId, text, opts?) -> SendResult, connect(), disconnect() }

   Both tokens live in closure and appear only in Authorization headers to slack.com — never on an event, the
   bus, or a log. `fetch` + `WebSocketImpl` are INJECTED (index.js passes the globals; tests pass fakes), so this
   module touches no real network under test and stays deterministic (no clock/rng/Date). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.channels = root.SK.channels || {}; root.SK.channels.slackTransport = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const API = 'https://slack.com/api';
  const DEFAULT_PARK_MS = 800;   // how long getUpdates parks when the buffer is empty before returning []
  const FATAL_OPEN_ERRORS = ['invalid_auth', 'not_allowed_token_type', 'forbidden', 'account_inactive', 'token_revoked'];

  function makeSlackTransport(opts) {
    const o = opts || {};
    const fetchImpl = o.fetch;
    const botToken = String(o.botToken || '');
    const appToken = String(o.appToken || '');
    const WebSocketImpl = o.WebSocketImpl;
    const apiBase = o.apiBase || API;
    const parkMs = (typeof o.parkMs === 'number') ? o.parkMs : DEFAULT_PARK_MS;
    const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    if (typeof fetchImpl !== 'function') throw new Error('makeSlackTransport: an injected fetch is required');
    if (!botToken) throw new Error('makeSlackTransport: a bot token (xoxb-…) is required');
    if (!appToken) throw new Error('makeSlackTransport: an app-level token (xapp-…) is required');
    if (typeof WebSocketImpl !== 'function') throw new Error('makeSlackTransport: WebSocket is unavailable (Node >= 21, or inject WebSocketImpl)');

    const buffer = [];      // raw Slack event payloads (envelope.payload.event), oldest-first
    const pendingAcks = new WeakMap();
    let ws = null;          // the live socket, if open
    let socketOpen = false;
    let opening = false;    // an apps.connections.open round-trip is in flight
    let stopped = false;    // caller asked us to shut down for good
    let fatalError = null;  // a non-recoverable auth failure — thrown from the next getUpdates
    let everOpened = false; // has apps.connections.open EVER succeeded (real transport proof)? — honest connect gate

    function closeSocket() { try { if (ws && typeof ws.close === 'function') ws.close(); } catch (_) {} ws = null; socketOpen = false; }

    async function openGateway(signal) {
      if (ws || opening || stopped || fatalError || (signal && signal.aborted)) return;
      opening = true;
      try {
        const res = await fetchImpl(apiBase + '/apps.connections.open', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + appToken, 'content-type': 'application/x-www-form-urlencoded' },
          signal
        });
        if (stopped || (signal && signal.aborted)) return;
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (stopped || (signal && signal.aborted)) return;
        if (!res || !res.ok || !data || data.ok !== true || !data.url) {
          const why = (data && data.error) || ('http ' + ((res && res.status) || 0));
          if (data && FATAL_OPEN_ERRORS.indexOf(String(data.error)) >= 0) {
            const err = new Error('slack socket-mode open refused: ' + why + ' — check the app-level token (xapp-…) has connections:write');
            err.fatal = true;
            fatalError = err;
          }
          return;   // transient open failure -> next poll retries (poll cadence is the backoff)
        }
        if (typeof o.authorizeSocket === 'function') o.authorizeSocket(data.url);
        const sock = new WebSocketImpl(data.url);
        sock.onopen = () => { if (!stopped && ws === sock) { socketOpen = true; everOpened = true; } };
        sock.onmessage = (ev) => {
          if (stopped || ws !== sock) return;
          let msg = null;
          try { msg = JSON.parse(String(ev && ev.data)); } catch (e) { return; }
          if (!msg) return;
          const event = msg.type === 'events_api' && msg.payload && msg.payload.event;
          if (event && typeof event === 'object') {
            if (msg.envelope_id) pendingAcks.set(event, { socket: sock, id: msg.envelope_id });
            buffer.push(event);
          } else {
            if (msg.envelope_id) { try { sock.send(JSON.stringify({ envelope_id: msg.envelope_id })); } catch (e) { console.error('[slack] envelope acknowledgement failed:', (e && e.message) || e); } }
            if (msg.type === 'disconnect') { try { sock.close(); } catch (_) {} }
          }
        };
        sock.onclose = () => { if (ws === sock) { ws = null; socketOpen = false; } };
        sock.onerror = () => { try { sock.close(); } catch (_) {} if (ws === sock) { ws = null; socketOpen = false; } };
        ws = sock;
      } catch (e) {
        if (e && e.code === 'strict_finance_blocked') { e.fatal = true; fatalError = e; }
      } finally {
        opening = false;
      }
    }

    return {
      connect() { return openGateway(); },
      disconnect() { stopped = true; closeSocket(); },
      acknowledgeUpdate(event) {
        const ack = event && pendingAcks.get(event);
        if (!ack) return;
        ack.socket.send(JSON.stringify({ envelope_id: ack.id }));
        pendingAcks.delete(event);
      },

      // drain the buffer the socket filled; open the socket lazily on the first poll (mirrors discord.transport).
      async getUpdates(args) {
        const signal = args && args.signal;
        if (signal && signal.aborted) { stopped = true; closeSocket(); return []; }
        if (fatalError) throw fatalError;
        await openGateway(signal);
        if (signal && signal.aborted) { stopped = true; closeSocket(); return []; }
        if (fatalError) throw fatalError;
        // Events the socket buffered before dropping still get delivered — never stranded behind a reconnect.
        if (buffer.length) return buffer.splice(0, buffer.length);
        // HONEST CONNECT + HONEST RECONNECT: an empty poll does NOT prove the channel is up — there may simply be
        // no live socket right now, either because apps.connections.open has never succeeded (bad first open) or
        // because the socket DROPPED and the reopen above failed transiently. Both used to fall through to a
        // "successful" [] return, so the adapter kept the panel CONNECTED on a dead socket forever. Surface a
        // transient (non-fatal) error instead: the adapter reports down/connecting and backs off, and the next
        // poll's openGateway() keeps retrying until the socket is genuinely back.
        if (ws && !socketOpen) await sleep(parkMs);
        if (signal && signal.aborted) { stopped = true; closeSocket(); return []; }
        if (!ws || !socketOpen) throw new Error(everOpened ? 'slack socket lost — reconnecting' : 'slack socket not open yet — retrying');
        if (!buffer.length) { await sleep(parkMs); }
        if (signal && signal.aborted) { stopped = true; closeSocket(); return []; }
        return buffer.splice(0, buffer.length);
      },

      // POST chat.postMessage. Never throws — normalized SendResult for the adapter's bounded resend.
      async send(channelId, text, sendOpts) {
        try {
          const res = await fetchImpl(apiBase + '/chat.postMessage', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + botToken, 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ channel: String(channelId), text: String(text == null ? '' : text) }),
            signal: sendOpts && sendOpts.signal
          });
          let data = null;
          try { data = await res.json(); } catch (e) {}
          if (res && res.ok && data && data.ok === true) return { ok: true, messageId: String((data.ts != null ? data.ts : (data.message && data.message.ts)) || '') };
          const status = res ? res.status : 0;
          const slackErr = (data && data.error) || '';
          let retryAfter; try { retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after')) || undefined; } catch (_) {}
          const deliveryUnknown = status === 0 || status === 408 || status >= 500
            || !data || typeof data.ok !== 'boolean' || slackErr === 'internal_error' || slackErr === 'fatal_error';
          const retryable = !deliveryUnknown && (status === 429 || slackErr === 'ratelimited');
          return { ok: false, error: slackErr || ('slack http ' + status), retryable, retryAfter, deliveryUnknown };
        } catch (e) {
          if (e && (e.name === 'AbortError')) return { ok: false, error: 'aborted', retryable: false, deliveryUnknown: true };
          return { ok: false, error: String((e && e.message) || e), retryable: false, deliveryUnknown: true };
        }
      },

      _internals: { buffer, get ws() { return ws; }, get fatalError() { return fatalError; } }
    };
  }

  return { makeSlackTransport, FATAL_OPEN_ERRORS };
});
