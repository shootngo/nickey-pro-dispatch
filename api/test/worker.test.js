import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, memoryKv } from '../src/index.js';
import { DANIEL_SMS_SAMPLE, DANIEL_SMS_ORIGINAL } from '../src/parse-dispatch.js';

const KEY = 'test-bot-key';

function env() {
  return { BOT_API_KEY: KEY, NICKEY_TRIPS: memoryKv() };
}

function req(method, path, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://nickey-bot.test' + path, init);
}

function authHeaders() {
  return { Authorization: 'Bearer ' + KEY };
}

async function read(res) {
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch (e) { return { status: res.status, text }; }
}

describe('public routes', () => {
  it('GET / and GET /health do not require auth', async () => {
    const e = env();
    const home = await handleRequest(req('GET', '/'), e);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Nickey Bot API/);

    const health = await read(await handleRequest(req('GET', '/health'), e));
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.service, 'nickey-bot-api');
  });

  it('OPTIONS is 204 with CORS', async () => {
    const res = await handleRequest(req('OPTIONS', '/v1/inbox'), env());
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  });
});

describe('auth', () => {
  it('rejects /v1/* without a key', async () => {
    const res = await read(await handleRequest(req('GET', '/v1/inbox'), env()));
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'unauthorized');
  });

  it('accepts X-Api-Key', async () => {
    const res = await read(await handleRequest(
      req('GET', '/v1/inbox', undefined, { 'X-Api-Key': KEY }),
      env()
    ));
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });
});

describe('from-dispatch-text + inbox', () => {
  it('creates a trip from the Daniel sample and phones can pull then ack', async () => {
    const e = env();
    const created = await read(await handleRequest(
      req('POST', '/v1/trips/from-dispatch-text', {
        text: DANIEL_SMS_SAMPLE,
        source: 'daniel_sms'
      }, authHeaders()),
      e
    ));
    assert.equal(created.status, 201);
    assert.equal(created.json.dispatch.pickupNumber, '3012874535');
    assert.equal(created.json.dispatch.basePay, 4385);
    assert.equal(created.json.trip.pickup, '3012874535');
    assert.equal(created.json.trip.basePay, 4385);
    assert.equal(created.json.trip.inboxStatus, 'pending');
    assert.match(created.json.trip.notes, /Dillon/i);

    const inbox = await read(await handleRequest(req('GET', '/v1/inbox', undefined, authHeaders()), e));
    assert.equal(inbox.json.trips.length, 1);
    assert.equal(inbox.json.trips[0].pickup, '3012874535');

    const id = inbox.json.trips[0].id;
    const acked = await read(await handleRequest(
      req('POST', '/v1/inbox/' + id + '/ack', {}, authHeaders()),
      e
    ));
    assert.equal(acked.status, 200);
    assert.equal(acked.json.trip.inboxStatus, 'acked');

    const empty = await read(await handleRequest(req('GET', '/v1/inbox', undefined, authHeaders()), e));
    assert.equal(empty.json.trips.length, 0);
  });

  it('accepts rawText alias and is idempotent on pickupNumber', async () => {
    const e = env();
    const first = await read(await handleRequest(
      req('POST', '/v1/trips/from-dispatch-text', { rawText: DANIEL_SMS_ORIGINAL, source: 'daniel_sms' }, authHeaders()),
      e
    ));
    assert.equal(first.status, 201);
    const second = await read(await handleRequest(
      req('POST', '/v1/trips/from-dispatch-text', { text: DANIEL_SMS_SAMPLE, source: 'daniel_sms' }, authHeaders()),
      e
    ));
    assert.equal(second.json.idempotent, true);
    assert.equal(second.json.trip.id, first.json.trip.id);

    const list = await read(await handleRequest(
      req('GET', '/v1/trips?status=open', undefined, authHeaders()),
      e
    ));
    assert.equal(list.json.trips.length, 1);
  });
});

describe('structured + BOL + PATCH', () => {
  it('upserts structured trips and BOL fields onto saveRecord names', async () => {
    const e = env();
    const created = await read(await handleRequest(
      req('POST', '/v1/trips', {
        pickupNumber: '5556667778',
        pickupDate: '2026-09-06',
        customer: 'Hydrox Elgin Illinois',
        basePay: 2256,
        trailerNumber: 'SD 94',
        highLimit: 5400,
        driverName: 'Frank Mulkey',
        notes: 'Tuesday 7am'
      }, authHeaders()),
      e
    ));
    assert.equal(created.status, 201);
    assert.equal(created.json.trip.pickup, '5556667778');
    assert.equal(created.json.trip.date, '2026-09-06');
    assert.equal(created.json.trip.trailer, 'SD 94');
    assert.equal(created.json.trip.highLimit, '5400');

    const bol = await read(await handleRequest(
      req('POST', '/v1/trips/from-bol', {
        bolNumber: '5556667778',
        pickupDate: '2026-09-06',
        shipper: 'Dillon, SC',
        consignee: 'Hydrox Elgin Illinois'
      }, authHeaders()),
      e
    ));
    assert.equal(bol.json.idempotent, true);
    assert.equal(bol.json.trip.id, created.json.trip.id);
    assert.match(bol.json.trip.notes, /Dillon/i);

    const patched = await read(await handleRequest(
      req('PATCH', '/v1/trips/' + created.json.trip.id, { basePay: 2300, status: 'open' }, authHeaders()),
      e
    ));
    assert.equal(patched.status, 200);
    assert.equal(patched.json.trip.basePay, 2300);
  });
});
