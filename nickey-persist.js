/* =============================================================================
 * Nickey Dispatch — Saved-record persistence
 *
 * Canonical key: nickeySavedRecords
 * On load: migrate older keys/shapes, restore from .bak / IndexedDB if needed.
 * On save: write localStorage, keep a .bak copy, snapshot IndexedDB.
 * Drive sync (ndsync) must MERGE record lists — never replace the whole array
 * with a smaller remote copy. Deletes sync via nickeyDeletedRecordIds tombstones.
 * ============================================================================= */

(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.NickeyPersist = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (w) {
  'use strict';

  var RECORDS_KEY = 'nickeySavedRecords';
  var BAK_KEY = 'nickeySavedRecords.bak';
  var TOMBSTONE_KEY = 'nickeyDeletedRecordIds';
  var SCHEMA_KEY = 'nickeyPersistSchema';
  var SCHEMA_VERSION = 2;
  var IDB_NAME = 'nickey-persist';
  var IDB_STORE = 'snapshots';

  // Historical / alias keys that may still hold trips after a version bump.
  var LEGACY_RECORD_KEYS = [
    'nickeyDraftLoad',
    'savedRecords',
    'nickeyRecords',
    'nickeySavedLoads',
    'dispatchSavedRecords'
  ];

  var lastWriteError = null;

  function isoNow() {
    return new Date().toISOString();
  }

  function getStorage(explicit) {
    if (explicit) return explicit;
    if (w && w.localStorage) return w.localStorage;
    return null;
  }

  function safeGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(storage, key, value) {
    storage.setItem(key, value);
  }

  function isEmpty(value) {
    return value == null || value === '' || value === 0;
  }

  function normalizePickup(value) {
    if (value == null) return '';
    return String(value).replace(/\D/g, '');
  }

  function recordTime(r) {
    if (!r) return '';
    return r.updatedAt || r.timestamp || '';
  }

  function writeErrorMessage(err, key) {
    var name = err && err.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'Storage is full — could not save' + (key ? ' ' + key : '') +
        '. Delete unused trips or free space, then try again.';
    }
    return 'Could not save' + (key ? ' ' + key : '') + ': ' +
      ((err && err.message) ? err.message : String(err || 'unknown error'));
  }

  function reportWriteError(key, err) {
    lastWriteError = writeErrorMessage(err, key);
    try { console.error('[NickeyPersist]', lastWriteError, err); } catch (e) {}
    showToast(lastWriteError, true);
    return lastWriteError;
  }

  function showToast(msg, isError) {
    if (!w || !w.document || !w.document.body) return;
    var el = w.document.getElementById('nickeyPersistToast');
    if (!el) {
      el = w.document.createElement('div');
      el.id = 'nickeyPersistToast';
      el.style.cssText = 'position:fixed;bottom:56px;left:14px;right:14px;z-index:100000;' +
        'background:rgba(0,0,0,0.94);border:1px solid #444;color:#ddd;' +
        'font-size:13px;padding:10px 14px;border-radius:10px;max-width:520px;' +
        'margin:0 auto;line-height:1.4;display:none;';
      w.document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    el.style.borderColor = isError ? '#cc0000' : '#4caf50';
    el.style.color = isError ? '#ff8888' : '#c8e6c9';
    setTimeout(function () { el.style.display = 'none'; }, isError ? 8000 : 2800);
  }

  function migrateRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    var out = {};
    var k;
    for (k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k];
    }
    if (!out.pickup && out.pickupNumber) out.pickup = out.pickupNumber;
    if (!out.date && (out.pickupDate || out.loadDate)) out.date = out.pickupDate || out.loadDate;
    if (!out.trailer && out.trailerNumber) out.trailer = out.trailerNumber;
    if (!out.customer && out.consignee) out.customer = out.consignee;
    if (!out.fuelEntries) {
      out.fuelEntries = (out.fuel && (out.fuel.amount || out.fuel.station)) ? [out.fuel] : [];
    }
    if (!Array.isArray(out.fuelEntries)) out.fuelEntries = [];
    if (!Array.isArray(out.reimbursements)) out.reimbursements = [];
    if (out.actualPay === undefined) out.actualPay = null;
    if (out.bookkeepingComplete === undefined) out.bookkeepingComplete = false;
    if (out.odometerIn === undefined) out.odometerIn = '';
    if (out.odometerOut === undefined) out.odometerOut = '';
    if (out.miles === undefined) out.miles = 0;
    if (out.costPerMile === undefined) out.costPerMile = 0;
    if (!out.timestamp) out.timestamp = out.updatedAt || isoNow();
    if (!out.id) {
      out.id = 'REC-' + (out.timestamp || out.pickup || Date.now());
    }
    return out;
  }

  function parseRecordsValue(raw) {
    if (raw == null || raw === '') return [];
    var v;
    try {
      v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
    if (Array.isArray(v)) return v.map(migrateRecord).filter(Boolean);
    if (v && Array.isArray(v.records)) return v.records.map(migrateRecord).filter(Boolean);
    if (v && Array.isArray(v.nickeySavedRecords)) {
      return v.nickeySavedRecords.map(migrateRecord).filter(Boolean);
    }
    if (v && Array.isArray(v.trips)) return v.trips.map(migrateRecord).filter(Boolean);
    if (v && typeof v === 'object' && (v.pickup || v.pickupNumber || v.id || v.customer)) {
      var one = migrateRecord(v);
      return one ? [one] : [];
    }
    return [];
  }

  function parseTombstones(raw) {
    if (!raw) return [];
    try {
      var v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(v)) return [];
      return v.map(function (t) {
        if (!t) return null;
        if (typeof t === 'string') return { id: t, pickup: '', deletedAt: '' };
        return {
          id: t.id || '',
          pickup: normalizePickup(t.pickup),
          deletedAt: t.deletedAt || ''
        };
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function mergeTombstones(a, b) {
    var map = {};
    function add(t) {
      if (!t) return;
      var key = t.id ? 'id:' + t.id : (t.pickup ? 'pu:' + t.pickup : '');
      if (!key) return;
      var prev = map[key];
      if (!prev || (t.deletedAt && t.deletedAt > (prev.deletedAt || ''))) map[key] = t;
    }
    (a || []).forEach(add);
    (b || []).forEach(add);
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function isTombstoned(r, tombs) {
    if (!r || !tombs || !tombs.length) return false;
    var pu = normalizePickup(r.pickup);
    var rt = recordTime(r);
    var i, t;
    for (i = 0; i < tombs.length; i++) {
      t = tombs[i];
      if (!t) continue;
      var match = (t.id && r.id && t.id === r.id) ||
        (t.pickup && pu && t.pickup === pu);
      if (!match) continue;
      if (!t.deletedAt || !rt || t.deletedAt >= rt) return true;
    }
    return false;
  }

  function applyTombstones(records, tombs) {
    if (!tombs || !tombs.length) return records || [];
    return (records || []).filter(function (r) { return !isTombstoned(r, tombs); });
  }

  function findRecordIndex(records, incoming) {
    var i, r;
    if (incoming && incoming.id) {
      for (i = 0; i < records.length; i++) {
        r = records[i];
        if (r && r.id === incoming.id) return i;
      }
    }
    var pu = normalizePickup(incoming && incoming.pickup);
    if (!pu) return -1;
    var date = (incoming && incoming.date) || '';
    var pickupOnly = -1;
    for (i = 0; i < records.length; i++) {
      r = records[i];
      if (!r) continue;
      if (normalizePickup(r.pickup) !== pu) continue;
      if (date && r.date && r.date === date) return i;
      if (pickupOnly === -1) pickupOnly = i;
    }
    return date ? pickupOnly : pickupOnly;
  }

  function mergeRecordPair(a, b) {
    var aT = recordTime(a);
    var bT = recordTime(b);
    var newer = (bT && bT > aT) ? b : a;
    var older = newer === b ? a : b;
    var out = {};
    var k;
    for (k in older) {
      if (Object.prototype.hasOwnProperty.call(older, k)) out[k] = older[k];
    }
    for (k in newer) {
      if (!Object.prototype.hasOwnProperty.call(newer, k)) continue;
      if (!isEmpty(newer[k])) out[k] = newer[k];
      else if (out[k] === undefined) out[k] = newer[k];
    }
    if ((!out.reimbursements || !out.reimbursements.length) && older.reimbursements && older.reimbursements.length) {
      out.reimbursements = older.reimbursements;
    }
    if ((!out.fuelEntries || !out.fuelEntries.length) && older.fuelEntries && older.fuelEntries.length) {
      out.fuelEntries = older.fuelEntries;
    }
    if (out.actualPay == null && older.actualPay != null) out.actualPay = older.actualPay;
    if (!out.bookkeepingComplete && older.bookkeepingComplete) out.bookkeepingComplete = true;
    if (newer.rosaPushedAt || older.rosaPushedAt) {
      out.rosaPushedAt = newer.rosaPushedAt || older.rosaPushedAt;
    }
    if (a.id && b.id && a.id !== b.id) {
      out.id = newer.id || a.id;
    } else {
      out.id = a.id || b.id;
    }
    var notesA = a.notes || '';
    var notesB = b.notes || '';
    if (notesA && notesB && notesA !== notesB && notesA.indexOf(notesB) === -1 && notesB.indexOf(notesA) === -1) {
      out.notes = notesA + ' — ' + notesB;
    }
    out.updatedAt = (bT > aT ? bT : aT) || isoNow();
    return migrateRecord(out);
  }

  function mergeRecordLists(localArr, remoteArr, tombs) {
    var out = [];
    var used = {};
    function take(r) {
      var rec = migrateRecord(r);
      if (!rec) return;
      var idx = findRecordIndex(out, rec);
      if (idx === -1) {
        out.push(rec);
        used[rec.id] = out.length - 1;
      } else {
        out[idx] = mergeRecordPair(out[idx], rec);
      }
    }
    (localArr || []).forEach(take);
    (remoteArr || []).forEach(take);
    return applyTombstones(out, tombs || []);
  }

  function parseObject(raw) {
    if (raw == null || raw === '') return {};
    try {
      var v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) {
      return null;
    }
  }

  function parseArray(raw) {
    if (raw == null || raw === '') return [];
    try {
      var v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return null;
    }
  }

  function mergeObjectsUnion(localRaw, remoteRaw) {
    var a = parseObject(localRaw);
    var b = parseObject(remoteRaw);
    if (a == null) a = {};
    if (b == null) return { value: JSON.stringify(a), parseFailed: remoteRaw != null };
    var out = {};
    var k;
    for (k in a) {
      if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    }
    for (k in b) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
      if (out[k] == null) {
        out[k] = b[k];
      } else if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) &&
                 b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
        var inner = {};
        var ik;
        for (ik in b[k]) {
          if (Object.prototype.hasOwnProperty.call(b[k], ik)) inner[ik] = b[k][ik];
        }
        for (ik in out[k]) {
          if (Object.prototype.hasOwnProperty.call(out[k], ik)) inner[ik] = out[k][ik];
        }
        out[k] = inner;
      }
    }
    return { value: JSON.stringify(out) };
  }

  function identityOfHistoryItem(item) {
    if (!item || typeof item !== 'object') return JSON.stringify(item);
    return item.id || item.timestamp || item.savedAt || item.date || JSON.stringify(item);
  }

  function mergeArrayUnion(localRaw, remoteRaw) {
    var a = parseArray(localRaw);
    var b = parseArray(remoteRaw);
    if (a == null) a = [];
    if (b == null) return { value: JSON.stringify(a) };
    var seen = {};
    var out = [];
    function add(item) {
      var id = identityOfHistoryItem(item);
      if (seen[id]) return;
      seen[id] = true;
      out.push(item);
    }
    a.forEach(add);
    b.forEach(add);
    return { value: JSON.stringify(out) };
  }

  function mergeNamedArray(localRaw, remoteRaw, nameKey) {
    nameKey = nameKey || 'name';
    var a = parseArray(localRaw);
    var b = parseArray(remoteRaw);
    if (a == null) a = [];
    if (b == null) return { value: JSON.stringify(a) };
    var map = {};
    var order = [];
    function add(item) {
      if (!item || typeof item !== 'object') return;
      var name = item[nameKey];
      if (name == null || name === '') {
        order.push(item);
        return;
      }
      var key = String(name);
      if (!map[key]) {
        map[key] = item;
        order.push({ _ref: key });
      } else {
        map[key] = Object.assign({}, map[key], item);
      }
    }
    a.forEach(add);
    b.forEach(add);
    var out = order.map(function (item) {
      return item && item._ref ? map[item._ref] : item;
    });
    return { value: JSON.stringify(out) };
  }

  var OBJECT_UNION_KEYS = {
    weeklyDeductions: true,
    fuelStations: true
  };
  var ARRAY_UNION_KEYS = {
    nickeyInspectionHistory: true,
    nickeyIntermodalHistory: true,
    nickeyCustomSDS: true,
    nickeyContacts: true
  };
  var NAMED_ARRAY_KEYS = {
    nickeyCustomers: 'name'
  };

  function mergeSyncKey(key, localVal, localTs, remoteVal, remoteTs, ctx) {
    ctx = ctx || {};
    localTs = localTs || '';
    remoteTs = remoteTs || '';
    if (remoteVal == null) {
      return { value: localVal, ts: localTs, changed: false };
    }
    if (key === RECORDS_KEY) {
      var localRecs = parseRecordsValue(localVal);
      var remoteRecs = parseRecordsValue(remoteVal);
      if (localRecs == null) localRecs = [];
      if (remoteRecs == null) {
        return { value: localVal, ts: localTs, changed: false, skippedCorrupt: true };
      }
      var tombs = mergeTombstones(ctx.localTombs || [], ctx.remoteTombs || []);
      var merged = mergeRecordLists(localRecs, remoteRecs, tombs);
      var json = JSON.stringify(merged);
      var changed = json !== (localVal == null ? '[]' : localVal);
      var ts = localTs > remoteTs ? localTs : remoteTs;
      if (changed) ts = isoNow();
      return { value: json, ts: ts, changed: changed, tombstones: tombs, count: merged.length };
    }
    if (key === TOMBSTONE_KEY) {
      var mergedTombs = mergeTombstones(parseTombstones(localVal), parseTombstones(remoteVal));
      var tjson = JSON.stringify(mergedTombs);
      return {
        value: tjson,
        ts: localTs > remoteTs ? localTs : remoteTs,
        changed: tjson !== (localVal || '[]')
      };
    }
    if (OBJECT_UNION_KEYS[key]) {
      var obj = mergeObjectsUnion(localVal, remoteVal);
      return {
        value: obj.value,
        ts: localTs > remoteTs ? localTs : remoteTs,
        changed: obj.value !== (localVal || '{}')
      };
    }
    if (ARRAY_UNION_KEYS[key]) {
      var arr = mergeArrayUnion(localVal, remoteVal);
      return {
        value: arr.value,
        ts: localTs > remoteTs ? localTs : remoteTs,
        changed: arr.value !== (localVal || '[]')
      };
    }
    if (NAMED_ARRAY_KEYS[key]) {
      var named = mergeNamedArray(localVal, remoteVal, NAMED_ARRAY_KEYS[key]);
      return {
        value: named.value,
        ts: localTs > remoteTs ? localTs : remoteTs,
        changed: named.value !== (localVal || '[]')
      };
    }
    if (remoteTs > localTs) {
      return { value: remoteVal, ts: remoteTs, changed: remoteVal !== localVal };
    }
    return { value: localVal, ts: localTs, changed: false };
  }

  function collectLegacyRecords(storage) {
    var extra = [];
    var i, raw, parsed;
    for (i = 0; i < LEGACY_RECORD_KEYS.length; i++) {
      raw = safeGet(storage, LEGACY_RECORD_KEYS[i]);
      parsed = parseRecordsValue(raw);
      if (parsed && parsed.length) extra = extra.concat(parsed);
    }
    return extra;
  }

  function loadTombstones(storage) {
    storage = getStorage(storage);
    if (!storage) return [];
    return parseTombstones(safeGet(storage, TOMBSTONE_KEY));
  }

  function saveTombstones(tombs, storage) {
    storage = getStorage(storage);
    if (!storage) return { ok: false, error: 'No storage' };
    try {
      safeSet(storage, TOMBSTONE_KEY, JSON.stringify(tombs || []));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: reportWriteError(TOMBSTONE_KEY, e) };
    }
  }

  function idbAvailable() {
    return !!(w && w.indexedDB);
  }

  function idbPut(payload) {
    if (!idbAvailable()) return;
    try {
      var req = w.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(payload, 'records');
        } catch (err) { /* ignore */ }
      };
      req.onerror = function () { /* ignore */ };
    } catch (e) { /* ignore */ }
  }

  function idbGet(cb) {
    if (!idbAvailable()) {
      cb(null);
      return;
    }
    try {
      var req = w.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var get = tx.objectStore(IDB_STORE).get('records');
          get.onsuccess = function () { cb(get.result || null); };
          get.onerror = function () { cb(null); };
        } catch (err) { cb(null); }
      };
      req.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  function snapshotIdb(records, tombs) {
    idbPut({
      records: records || [],
      tombstones: tombs || [],
      savedAt: isoNow(),
      schema: SCHEMA_VERSION
    });
  }

  function writeRecords(records, opts) {
    opts = opts || {};
    var storage = getStorage(opts.storage);
    if (!storage) return { ok: false, error: 'localStorage is not available' };
    var tombs = opts.tombstones || loadTombstones(storage);
    var list = applyTombstones((records || []).map(migrateRecord).filter(Boolean), tombs);

    var existingRaw = safeGet(storage, RECORDS_KEY);
    var existing = parseRecordsValue(existingRaw);
    if (existing == null) existing = [];

    if (!opts.replace) {
      list = mergeRecordLists(existing, list, tombs);
    }

    if (!list.length && existing.length && !opts.allowEmpty) {
      var err = 'Refusing to overwrite ' + existing.length + ' saved records with an empty list.';
      lastWriteError = err;
      showToast(err, true);
      return { ok: false, error: err, records: existing, blockedEmpty: true };
    }

    var json = JSON.stringify(list);
    try {
      if (existingRaw && existingRaw !== json) {
        try { safeSet(storage, BAK_KEY, existingRaw); } catch (bakErr) { /* quota on bak is non-fatal */ }
      }
      safeSet(storage, RECORDS_KEY, json);
      try { safeSet(storage, SCHEMA_KEY, String(SCHEMA_VERSION)); } catch (e) {}
    } catch (e) {
      return { ok: false, error: reportWriteError(RECORDS_KEY, e), records: list };
    }
    lastWriteError = null;
    snapshotIdb(list, tombs);
    return { ok: true, records: list, count: list.length };
  }

  function loadRecords(opts) {
    opts = opts || {};
    var storage = getStorage(opts.storage);
    var empty = { records: [], parseFailed: false, migrated: false, recovered: false };
    if (!storage) return empty;

    var raw = safeGet(storage, RECORDS_KEY);
    var parsed = parseRecordsValue(raw);
    var parseFailed = parsed === null;
    var fromMain = parseFailed ? [] : parsed;
    var recovered = false;

    if (parseFailed) {
      var bak = parseRecordsValue(safeGet(storage, BAK_KEY));
      if (bak && bak.length) {
        fromMain = bak;
        recovered = true;
      }
    }

    var legacy = collectLegacyRecords(storage);
    var tombs = loadTombstones(storage);
    var merged = mergeRecordLists(fromMain, legacy, tombs);
    var migrated = !!(legacy.length || recovered || parseFailed);
    try {
      if (Number(safeGet(storage, SCHEMA_KEY) || '0') < SCHEMA_VERSION) migrated = true;
    } catch (e) {}

    if (migrated && merged.length) {
      writeRecords(merged, { storage: storage, tombstones: tombs, replace: true });
    } else if (recovered && !merged.length) {
      // keep empty after failed parse with empty bak
    }

    return {
      records: merged,
      parseFailed: parseFailed,
      migrated: migrated,
      recovered: recovered,
      tombstones: tombs
    };
  }

  function upsertRecord(record, opts) {
    opts = opts || {};
    var storage = getStorage(opts.storage);
    var loaded = loadRecords({ storage: storage });
    var records = loaded.records.slice();
    var incoming = migrateRecord(record);
    if (!incoming) return { ok: false, error: 'Invalid record', records: records };
    var idx = -1;
    if (typeof opts.matchIndex === 'number' && opts.matchIndex >= 0 && opts.matchIndex < records.length) {
      idx = opts.matchIndex;
      incoming.id = records[idx].id;
      incoming.timestamp = records[idx].timestamp || incoming.timestamp;
      incoming.actualPay = incoming.actualPay != null ? incoming.actualPay : records[idx].actualPay;
      incoming.bookkeepingComplete = incoming.bookkeepingComplete || records[idx].bookkeepingComplete;
      incoming.rosaPushedAt = incoming.rosaPushedAt || records[idx].rosaPushedAt;
    } else if (opts.matchExisting) {
      idx = findRecordIndex(records, incoming);
    }
    if (idx === -1) {
      incoming.updatedAt = incoming.updatedAt || isoNow();
      records.push(incoming);
      idx = records.length - 1;
    } else {
      incoming.updatedAt = isoNow();
      records[idx] = mergeRecordPair(records[idx], incoming);
    }
    var wr = writeRecords(records, { storage: storage, tombstones: loaded.tombstones });
    wr.index = idx;
    wr.record = wr.ok ? wr.records[idx] : incoming;
    return wr;
  }

  function deleteRecordAt(index, opts) {
    opts = opts || {};
    var storage = getStorage(opts.storage);
    var loaded = loadRecords({ storage: storage });
    var records = loaded.records.slice();
    if (index < 0 || index >= records.length) {
      return { ok: false, error: 'Record not found', records: records };
    }
    var removed = records.splice(index, 1)[0];
    var tombs = mergeTombstones(loaded.tombstones, [{
      id: removed && removed.id,
      pickup: normalizePickup(removed && removed.pickup),
      deletedAt: isoNow()
    }]);
    var ts = saveTombstones(tombs, storage);
    if (!ts.ok) return { ok: false, error: ts.error, records: loaded.records };
    var wr = writeRecords(records, {
      storage: storage,
      tombstones: tombs,
      allowEmpty: true
    });
    wr.deleted = removed;
    return wr;
  }

  function hydrateFromIndexedDB(cb) {
    cb = cb || function () {};
    idbGet(function (snap) {
      if (!snap || !Array.isArray(snap.records) || !snap.records.length) {
        cb({ merged: false, records: loadRecords().records });
        return;
      }
      var loaded = loadRecords();
      var tombs = mergeTombstones(loaded.tombstones || [], snap.tombstones || []);
      var merged = mergeRecordLists(loaded.records, snap.records, tombs);
      if (merged.length > loaded.records.length) {
        saveTombstones(tombs);
        writeRecords(merged, { tombstones: tombs });
        showToast('Restored ' + (merged.length - loaded.records.length) + ' trip(s) from backup', false);
        cb({ merged: true, records: merged });
        return;
      }
      cb({ merged: false, records: loaded.records });
    });
  }

  return {
    RECORDS_KEY: RECORDS_KEY,
    BAK_KEY: BAK_KEY,
    TOMBSTONE_KEY: TOMBSTONE_KEY,
    SCHEMA_KEY: SCHEMA_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    LEGACY_RECORD_KEYS: LEGACY_RECORD_KEYS,
    migrateRecord: migrateRecord,
    parseRecordsValue: parseRecordsValue,
    parseTombstones: parseTombstones,
    mergeTombstones: mergeTombstones,
    mergeRecordLists: mergeRecordLists,
    mergeRecordPair: mergeRecordPair,
    mergeSyncKey: mergeSyncKey,
    findRecordIndex: findRecordIndex,
    normalizePickup: normalizePickup,
    loadRecords: loadRecords,
    writeRecords: writeRecords,
    upsertRecord: upsertRecord,
    deleteRecordAt: deleteRecordAt,
    loadTombstones: loadTombstones,
    hydrateFromIndexedDB: hydrateFromIndexedDB,
    reportWriteError: reportWriteError,
    showToast: showToast,
    getLastWriteError: function () { return lastWriteError; },
    memoryStorage: function (map) {
      map = map || {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
        setItem: function (k, v) { map[k] = String(v); },
        removeItem: function (k) { delete map[k]; }
      };
    }
  };
}));
