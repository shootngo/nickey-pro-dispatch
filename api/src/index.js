/* =============================================================================
 * Nickey Bot API — Cloudflare Worker
 * KV binding: NICKEY_TRIPS
 * Auth: Authorization: Bearer <BOT_API_KEY> or X-Api-Key  (all /v1/*)
 * Public: GET /  (docs)  and  GET /health
 *
 * v1 is KV + API key only. Do not add a Drive service-account OAuth path.
 * The phone pulls via GET /v1/inbox; ndsync (user Google sign-in) may sync
 * after the PWA writes nickeySavedRecords locally.
 * ============================================================================= */

import { parseDispatchTextFull } from './parse-dispatch.js';
import {
  memoryKv,
  normalizeIncoming,
  dispatchToRecordFields,
  upsertTrip,
  patchTrip,
  getTrip,
  listTrips,
  listInbox,
  ackTrip,
  tripPublic
} from './store.js';

export const API_VERSION = '1.0.0';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
  'Access-Control-Max-Age': '86400'
};

export function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS_HEADERS)
  });
}

export function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS_HEADERS)
  });
}

export function readApiKey(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.length >= 7 && auth.slice(0, 7).toLowerCase() === 'bearer ') {
    return auth.slice(7).trim();
  }
  return (request.headers.get('X-Api-Key') || '').trim();
}

export function isAuthorized(request, env) {
  const expected = env && env.BOT_API_KEY;
  if (!expected) return false;
  const got = readApiKey(request);
  return !!got && got === expected;
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

async function readJson(request) {
  const text = await request.text();
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

function docsPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nickey Bot API</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.5}
  h1{color:#ffd700;font-size:1.6rem}
  code,pre{background:#1a1a1a;border:1px solid #333;border-radius:6px}
  code{padding:2px 6px}
  pre{padding:12px;overflow:auto}
  a{color:#7ab8ff}
  .muted{color:#888}
</style>
</head>
<body>
<h1>Nickey Bot API</h1>
<p class="muted">v${API_VERSION} — Cloudflare Worker + KV inbox. No Drive service-account OAuth.</p>
<p>Public: <code>GET /</code> (this page) and <code>GET /health</code>.</p>
<p>All <code>/v1/*</code> routes require <code>Authorization: Bearer &lt;BOT_API_KEY&gt;</code> or <code>X-Api-Key</code>.</p>
<ul>
  <li><code>POST /v1/trips</code> — structured create / upsert</li>
  <li><code>PATCH /v1/trips/:id</code></li>
  <li><code>GET /v1/trips?status=open</code></li>
  <li><code>POST /v1/trips/from-dispatch-text</code> — body <code>{"text":"...","source":"daniel_sms"}</code> (<code>rawText</code> alias)</li>
  <li><code>POST /v1/trips/from-bol</code></li>
  <li><code>GET /v1/inbox</code> — pending trips for the phone</li>
  <li><code>POST /v1/inbox/:id/ack</code> — mark applied</li>
</ul>
<p>See <code>docs/bot-api.md</code> in the Nickey Dispatch repo for deploy steps and curl samples.</p>
</body>
</html>`;
}

function requireKv(env) {
  if (env && env.NICKEY_TRIPS) return env.NICKEY_TRIPS;
  const err = new Error('NICKEY_TRIPS KV binding is not configured');
  err.status = 503;
  throw err;
}

async function handleFromDispatch(request, env) {
  const body = await readJson(request);
  const text = (body.text || body.rawText || '').trim();
  if (!text) return json({ ok: false, error: 'text_required', message: 'Provide text or rawText' }, 400);
  const source = body.source || 'dispatch_text';
  const parsed = await parseDispatchTextFull(text, {
    geminiApiKey: env && env.GEMINI_API_KEY,
    fetch: globalThis.fetch
  });
  const fields = dispatchToRecordFields(parsed.dispatch);
  const incoming = normalizeIncoming(Object.assign({}, body, fields, {
    notes: fields.notes || body.notes || ''
  }));
  const result = await upsertTrip(requireKv(env), incoming, {
    source,
    rawText: text,
    parser: parsed.parser
  });
  return json({
    ok: true,
    created: result.created,
    idempotent: result.idempotent,
    parser: parsed.parser,
    geminiError: parsed.geminiError || undefined,
    dispatch: parsed.dispatch,
    trip: tripPublic(result.trip)
  }, result.created ? 201 : 200);
}

async function handleFromBol(request, env) {
  const body = await readJson(request);
  const incoming = normalizeIncoming(body);
  if (!incoming.pickup) {
    return json({ ok: false, error: 'pickup_required', message: 'Provide bolNumber or pickupNumber' }, 400);
  }
  const result = await upsertTrip(requireKv(env), incoming, {
    source: body.source || 'bol'
  });
  return json({
    ok: true,
    created: result.created,
    idempotent: result.idempotent,
    trip: tripPublic(result.trip)
  }, result.created ? 201 : 200);
}

async function handleCreateTrip(request, env) {
  const body = await readJson(request);
  const incoming = normalizeIncoming(body);
  if (!incoming.pickup && !incoming.id) {
    return json({ ok: false, error: 'pickup_required', message: 'Provide pickup / pickupNumber or id' }, 400);
  }
  const result = await upsertTrip(requireKv(env), incoming, {
    source: body.source || 'structured'
  });
  return json({
    ok: true,
    created: result.created,
    idempotent: result.idempotent,
    trip: tripPublic(result.trip)
  }, result.created ? 201 : 200);
}

async function handlePatchTrip(id, request, env) {
  const body = await readJson(request);
  const trip = await patchTrip(requireKv(env), id, body);
  if (!trip) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, trip: tripPublic(trip) });
}

async function handleGetTrips(url, env) {
  const status = url.searchParams.get('status') || '';
  const trips = await listTrips(requireKv(env), status || null);
  return json({ ok: true, trips: trips.map(tripPublic) });
}

async function handleInbox(env) {
  const trips = await listInbox(requireKv(env));
  return json({ ok: true, trips: trips.map(tripPublic) });
}

async function handleAck(id, env) {
  const trip = await ackTrip(requireKv(env), id);
  if (!trip) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, trip: tripPublic(trip) });
}

export async function handleRequest(request, env) {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === 'GET' && path === '/') return html(docsPage());
    if (request.method === 'GET' && path === '/health') {
      return json({
        ok: true,
        service: 'nickey-bot-api',
        version: API_VERSION,
        kv: !!(env && env.NICKEY_TRIPS)
      });
    }

    if (!path.startsWith('/v1')) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    if (!isAuthorized(request, env)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    if (request.method === 'POST' && path === '/v1/trips/from-dispatch-text') {
      return await handleFromDispatch(request, env);
    }
    if (request.method === 'POST' && path === '/v1/trips/from-bol') {
      return await handleFromBol(request, env);
    }
    if (request.method === 'POST' && path === '/v1/trips') {
      return await handleCreateTrip(request, env);
    }
    if (request.method === 'GET' && path === '/v1/trips') {
      return await handleGetTrips(url, env);
    }

    const tripPatch = path.match(/^\/v1\/trips\/([^/]+)$/);
    if (tripPatch && request.method === 'PATCH') {
      return await handlePatchTrip(decodeURIComponent(tripPatch[1]), request, env);
    }
    if (tripPatch && request.method === 'GET') {
      const trip = await getTrip(requireKv(env), decodeURIComponent(tripPatch[1]));
      if (!trip) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, trip: tripPublic(trip) });
    }

    if (request.method === 'GET' && path === '/v1/inbox') {
      return await handleInbox(env);
    }

    const ack = path.match(/^\/v1\/inbox\/([^/]+)\/ack$/);
    if (ack && request.method === 'POST') {
      return await handleAck(decodeURIComponent(ack[1]), env);
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return json({
      ok: false,
      error: status === 400 ? 'bad_request' : 'server_error',
      message: err && err.message ? err.message : 'Unexpected error'
    }, status);
  }
}

export { memoryKv };

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
