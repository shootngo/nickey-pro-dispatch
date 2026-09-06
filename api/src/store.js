/* =============================================================================
 * Nickey Bot — KV trip store (NICKEY_TRIPS)
 * Maps dispatch / BOL / structured bodies onto saveRecord() field names used
 * by index.html: id, driverName, date, pickup, customer, basePay, highLimit,
 * trailer, notes, fuelEntries, reimbursements, etc.
 * ============================================================================= */

import { normalizePickup, parseMoney, isEmptyField, emptyDispatch } from './parse-dispatch.js';

export const TRIP_PREFIX = 'trip:';
export const INBOX_PREFIX = 'inbox:';
export const IDEM_PREFIX = 'idem:';

export function memoryKv() {
  const map = new Map();
  return {
    async get(key, type) {
      const v = map.get(key);
      if (v == null) return null;
      if (type === 'json') {
        try { return JSON.parse(v); } catch (e) { return null; }
      }
      return v;
    },
    async put(key, value) {
      map.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      const keys = [];
      for (const name of map.keys()) {
        if (!prefix || name.startsWith(prefix)) keys.push({ name });
      }
      return { keys, list_complete: true };
    }
  };
}

export async function listKeys(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    if (page && page.keys) {
      for (let i = 0; i < page.keys.length; i++) out.push(page.keys[i].name);
    }
    cursor = page && page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function newTripId() {
  return 'REC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

export function emptySaveRecord() {
  return {
    id: '',
    driverName: '',
    date: '',
    pickup: '',
    customer: '',
    basePay: 0,
    highLimit: '',
    trailer: '',
    arrivalDate: '',
    arrivalTime: '',
    departureDate: '',
    departureTime: '',
    tankerWeight: '',
    arrivalGallons: '',
    departureLoad: '',
    totalGallons: '',
    notes: '',
    reimbursements: [],
    fuelEntries: [],
    actualPay: null,
    bookkeepingComplete: false,
    timestamp: '',
    updatedAt: ''
  };
}

export function dispatchToRecordFields(dispatch) {
  const d = dispatch || emptyDispatch();
  return {
    date: d.pickupDate || '',
    pickup: d.pickupNumber ? String(d.pickupNumber) : '',
    customer: d.customer || '',
    basePay: d.basePay == null ? 0 : (parseMoney(d.basePay) || 0),
    highLimit: d.highLimit == null || d.highLimit === '' ? '' : String(d.highLimit),
    trailer: d.trailerNumber || '',
    notes: d.notes || ''
  };
}

/**
 * Accept saveRecord names, Paste Dispatch names, and common aliases.
 */
export function normalizeIncoming(body) {
  const b = body && typeof body === 'object' ? body : {};
  const pickup = b.pickup || b.pickupNumber || b.bolNumber || b.pu || '';
  const date = b.date || b.pickupDate || '';
  const trailer = b.trailer || b.trailerNumber || '';
  const highLimit = b.highLimit == null || b.highLimit === '' ? '' : String(b.highLimit);
  const basePay = parseMoney(b.basePay) || 0;
  const notes = b.notes || '';

  const record = emptySaveRecord();
  record.id = b.id || '';
  record.driverName = b.driverName || '';
  record.date = date || '';
  record.pickup = pickup ? String(pickup).trim() : '';
  record.customer = b.customer || b.consignee || '';
  record.basePay = basePay;
  record.highLimit = highLimit;
  record.trailer = trailer;
  record.arrivalDate = b.arrivalDate || '';
  record.arrivalTime = b.arrivalTime || '';
  record.departureDate = b.departureDate || '';
  record.departureTime = b.departureTime || '';
  record.tankerWeight = b.tankerWeight || '';
  record.arrivalGallons = b.arrivalGallons || '';
  record.departureLoad = b.departureLoad || '';
  record.totalGallons = b.totalGallons || '';
  record.notes = notes;
  record.reimbursements = Array.isArray(b.reimbursements) ? b.reimbursements : [];
  record.fuelEntries = Array.isArray(b.fuelEntries) ? b.fuelEntries : [];
  if (b.actualPay !== undefined) record.actualPay = b.actualPay;
  if (b.bookkeepingComplete !== undefined) record.bookkeepingComplete = !!b.bookkeepingComplete;

  const extraNotes = [];
  if (b.shipper && !/\bshipper\b/i.test(record.notes)) extraNotes.push('Shipper: ' + b.shipper);
  if (b.product && !String(record.notes).includes(String(b.product))) extraNotes.push('Product: ' + b.product);
  if (b.gallons && !record.notes) extraNotes.push('Gallons: ' + b.gallons);
  if (extraNotes.length) {
    record.notes = record.notes
      ? record.notes + ' — ' + extraNotes.join(' — ')
      : extraNotes.join(' — ');
  }

  return record;
}

export function toPhoneRecord(trip) {
  const r = emptySaveRecord();
  Object.keys(r).forEach(function (k) {
    if (trip[k] !== undefined) r[k] = trip[k];
  });
  r.id = trip.id;
  r.timestamp = trip.timestamp || r.timestamp;
  r.updatedAt = trip.updatedAt || r.updatedAt;
  return r;
}

function idemKey(pickup, date) {
  const p = normalizePickup(pickup);
  if (!p) return null;
  if (date) return IDEM_PREFIX + p + ':' + date;
  return IDEM_PREFIX + p;
}

async function writeIdemKeys(kv, trip) {
  const p = normalizePickup(trip.pickup);
  if (!p) return;
  await kv.put(IDEM_PREFIX + p, trip.id);
  if (trip.date) await kv.put(IDEM_PREFIX + p + ':' + trip.date, trip.id);
}

export async function findExistingId(kv, pickup, date) {
  const p = normalizePickup(pickup);
  if (!p) return null;
  if (date) {
    const byDate = await kv.get(IDEM_PREFIX + p + ':' + date);
    if (byDate) return byDate;
    const byPickup = await kv.get(IDEM_PREFIX + p);
    if (byPickup) {
      const existing = await getTrip(kv, byPickup);
      if (existing && (!existing.date || existing.date === date)) return byPickup;
    }
    return null;
  }
  return await kv.get(IDEM_PREFIX + p);
}

export async function getTrip(kv, id) {
  if (!id) return null;
  return await kv.get(TRIP_PREFIX + id, 'json');
}

export async function putTrip(kv, trip) {
  await kv.put(TRIP_PREFIX + trip.id, JSON.stringify(trip));
  await writeIdemKeys(kv, trip);
  if (trip.inboxStatus === 'pending') {
    await kv.put(INBOX_PREFIX + trip.id, '1');
  } else {
    await kv.delete(INBOX_PREFIX + trip.id);
  }
  return trip;
}

function mergeTrip(existing, incoming) {
  const out = Object.assign({}, existing);
  const skip = {
    id: true,
    timestamp: true,
    reimbursements: true,
    fuelEntries: true,
    actualPay: true,
    bookkeepingComplete: true
  };
  Object.keys(incoming).forEach(function (key) {
    if (skip[key]) return;
    if (key === 'basePay') {
      if ((!existing.basePay || existing.basePay === 0) && incoming.basePay) {
        out.basePay = incoming.basePay;
      }
      return;
    }
    if (isEmptyField(existing[key]) && !isEmptyField(incoming[key])) {
      out[key] = incoming[key];
    }
  });
  if (incoming.notes && existing.notes && incoming.notes !== existing.notes) {
    if (existing.notes.indexOf(incoming.notes) === -1) {
      out.notes = existing.notes + ' — ' + incoming.notes;
    }
  }
  if (Array.isArray(incoming.reimbursements) && incoming.reimbursements.length &&
      (!existing.reimbursements || !existing.reimbursements.length)) {
    out.reimbursements = incoming.reimbursements;
  }
  if (Array.isArray(incoming.fuelEntries) && incoming.fuelEntries.length &&
      (!existing.fuelEntries || !existing.fuelEntries.length)) {
    out.fuelEntries = incoming.fuelEntries;
  }
  return out;
}

export async function upsertTrip(kv, incoming, meta) {
  const info = meta || {};
  const source = info.source || incoming.source || 'structured';
  let existing = null;
  let existingId = incoming.id || null;
  if (existingId) existing = await getTrip(kv, existingId);
  if (!existing) {
    existingId = await findExistingId(kv, incoming.pickup, incoming.date);
    if (existingId) existing = await getTrip(kv, existingId);
  }

  const stamp = nowIso();
  if (existing) {
    const merged = mergeTrip(existing, incoming);
    merged.updatedAt = stamp;
    merged.source = existing.source || source;
    if (info.rawText && !merged.rawText) merged.rawText = info.rawText;
    if (info.parser) merged.parser = info.parser;
    merged.inboxStatus = 'pending';
    merged.status = merged.status || 'open';
    await putTrip(kv, merged);
    return { trip: merged, created: false, idempotent: true };
  }

  const trip = Object.assign(emptySaveRecord(), incoming);
  trip.id = incoming.id || newTripId();
  trip.timestamp = stamp;
  trip.updatedAt = stamp;
  trip.status = incoming.status || 'open';
  trip.inboxStatus = 'pending';
  trip.source = source;
  if (info.rawText) trip.rawText = info.rawText;
  if (info.parser) trip.parser = info.parser;
  if (!trip.pickup && incoming.pickupNumber) trip.pickup = String(incoming.pickupNumber);
  await putTrip(kv, trip);
  return { trip, created: true, idempotent: false };
}

export async function patchTrip(kv, id, patch) {
  const existing = await getTrip(kv, id);
  if (!existing) return null;
  const incoming = normalizeIncoming(patch);
  const out = Object.assign({}, existing);
  Object.keys(patch).forEach(function (key) {
    if (key === 'id') return;
    if (key === 'inboxStatus' || key === 'status' || key === 'source' || key === 'rawText' || key === 'parser') {
      out[key] = patch[key];
      return;
    }
    if (incoming[key] !== undefined && key in emptySaveRecord()) {
      out[key] = incoming[key];
    } else if (patch[key] !== undefined && out[key] !== undefined) {
      out[key] = patch[key];
    }
  });
  if (patch.pickupNumber && !patch.pickup) out.pickup = String(patch.pickupNumber);
  if (patch.pickupDate && !patch.date) out.date = patch.pickupDate;
  if (patch.trailerNumber && !patch.trailer) out.trailer = patch.trailerNumber;
  if (patch.basePay !== undefined) out.basePay = parseMoney(patch.basePay) || 0;
  out.updatedAt = nowIso();
  if (patch.inboxStatus !== 'acked') out.inboxStatus = 'pending';
  await putTrip(kv, out);
  return out;
}

export async function listTrips(kv, status) {
  const keys = await listKeys(kv, TRIP_PREFIX);
  const trips = [];
  for (let i = 0; i < keys.length; i++) {
    const trip = await kv.get(keys[i], 'json');
    if (!trip) continue;
    if (status && trip.status !== status) continue;
    trips.push(trip);
  }
  trips.sort(function (a, b) {
    return String(b.updatedAt || b.timestamp || '').localeCompare(String(a.updatedAt || a.timestamp || ''));
  });
  return trips;
}

export async function listInbox(kv) {
  const keys = await listKeys(kv, INBOX_PREFIX);
  const trips = [];
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i].slice(INBOX_PREFIX.length);
    const trip = await getTrip(kv, id);
    if (trip && trip.inboxStatus === 'pending') trips.push(trip);
  }
  trips.sort(function (a, b) {
    return String(b.updatedAt || b.timestamp || '').localeCompare(String(a.updatedAt || a.timestamp || ''));
  });
  return trips;
}

export async function ackTrip(kv, id) {
  const trip = await getTrip(kv, id);
  if (!trip) return null;
  trip.inboxStatus = 'acked';
  trip.ackedAt = nowIso();
  trip.updatedAt = trip.ackedAt;
  await putTrip(kv, trip);
  return trip;
}

export function tripPublic(trip) {
  if (!trip) return null;
  const phone = toPhoneRecord(trip);
  return Object.assign({}, phone, {
    status: trip.status || 'open',
    inboxStatus: trip.inboxStatus || 'pending',
    source: trip.source || '',
    parser: trip.parser || '',
    pickupNumber: trip.pickup || '',
    pickupDate: trip.date || '',
    trailerNumber: trip.trailer || ''
  });
}
