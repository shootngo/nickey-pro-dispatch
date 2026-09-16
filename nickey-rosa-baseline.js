/* =============================================================================
 * Shared actual-pay baseline — Rosa writes, Nickey reads.
 *
 * Same GitHub Pages origin, so both PWAs share localStorage. Nickey also
 * Drive-syncs this key (ndsync + persist export). No new cloud backend.
 *
 * Shape (version 1):
 * {
 *   version: 1,
 *   amount: 1200,                 // dollars — Frank's Current Baseline
 *   currency: "USD",
 *   kind: "trip" | "week" | "manual",
 *   payWeek: "2026-09-06",        // Sunday ISO of the Sun–Sat week
 *   tripDate: "2026-09-08",       // when kind === "trip"
 *   tripId: "TRP-…",
 *   pickup: "3012874535",
 *   consignee: "Kroger DC",
 *   label: "Kroger DC · Sep 8",
 *   savedAt: "2026-09-16T12:00:00.000Z",
 *   source: "rosa",
 *   lastActuals: [{ amount, tripId, pickup, consignee, tripDate, payWeek, savedAt }]
 * }
 *
 * amount is what Rosa confirmed Frank actually earned (trip actual total,
 * week's booked actuals, or a typed period total). Nickey shows it as
 * "Current Baseline: $X" and compares load estimates against it.
 * ============================================================================= */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.NickeyRosaBaseline = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KEY = 'nickeyRosa.baseline';
  var TS_KEY = 'ndsync_ts_nickeyRosa.baseline';
  var HISTORY_LIMIT = 12;

  function num(v) {
    if (v == null || v === '') return 0;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((num(n) + Number.EPSILON) * 100) / 100;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toIsoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseISODateLocal(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }

  function payWeekOf(tripDate) {
    var d = parseISODateLocal(tripDate);
    if (!d) return '';
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return toIsoDate(d);
  }

  function formatMoney(v) {
    var n = num(v);
    var abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + abs;
  }

  function hasActuals(t) {
    if (!t) return false;
    return t.actualPay != null || t.actualDetention != null || t.actualExtra != null || t.actualReefer != null;
  }

  function actualTotal(t) {
    if (!hasActuals(t)) return null;
    return round2(num(t.actualPay) + num(t.actualDetention) + num(t.actualExtra) + num(t.actualReefer));
  }

  function tripLabel(t) {
    var name = (t && (t.consignee || t.customer)) || '';
    var d = parseISODateLocal(t && t.tripDate);
    var when = d
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : (t && t.tripDate) || '';
    if (name && when) return name + ' · ' + when;
    return name || when || 'Actual pay';
  }

  function weekLabel(sundayISO) {
    var start = parseISODateLocal(sundayISO);
    if (!start) return sundayISO ? ('Week of ' + sundayISO) : 'Pay week';
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    var left = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    var sameMonth = start.getMonth() === end.getMonth();
    var right = end.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return 'Week of ' + left + '–' + right;
  }

  function emptyRecord() {
    return {
      version: 1,
      amount: null,
      currency: 'USD',
      kind: '',
      payWeek: '',
      tripDate: '',
      tripId: '',
      pickup: '',
      consignee: '',
      label: '',
      savedAt: '',
      source: 'rosa',
      lastActuals: []
    };
  }

  function normalizeHistory(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < HISTORY_LIMIT; i++) {
      var row = list[i];
      if (!row) continue;
      var amt = row.amount == null || row.amount === '' ? null : round2(row.amount);
      if (amt == null) continue;
      out.push({
        amount: amt,
        tripId: String(row.tripId || ''),
        pickup: String(row.pickup || ''),
        consignee: String(row.consignee || row.customer || ''),
        tripDate: String(row.tripDate || ''),
        payWeek: String(row.payWeek || ''),
        savedAt: String(row.savedAt || '')
      });
    }
    return out;
  }

  function normalize(raw) {
    var t = emptyRecord();
    if (!raw || typeof raw !== 'object') return t;
    var amount = raw.amount == null || raw.amount === '' ? null : round2(raw.amount);
    t.version = 1;
    t.amount = amount;
    t.currency = raw.currency || 'USD';
    t.kind = raw.kind === 'week' || raw.kind === 'manual' || raw.kind === 'trip' ? raw.kind : (amount != null ? 'trip' : '');
    t.payWeek = String(raw.payWeek || '');
    t.tripDate = String(raw.tripDate || '');
    t.tripId = String(raw.tripId || '');
    t.pickup = String(raw.pickup || '');
    t.consignee = String(raw.consignee || raw.customer || '');
    t.label = String(raw.label || '');
    t.savedAt = String(raw.savedAt || '');
    t.source = String(raw.source || 'rosa');
    t.lastActuals = normalizeHistory(raw.lastActuals);
    return t;
  }

  function getStorage(explicit) {
    if (explicit) return explicit;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* ignore */ }
    return null;
  }

  function read(storage) {
    storage = getStorage(storage);
    if (!storage || typeof storage.getItem !== 'function') return emptyRecord();
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return emptyRecord();
      return normalize(JSON.parse(raw));
    } catch (e) {
      return emptyRecord();
    }
  }

  function write(record, storage, nowIso) {
    storage = getStorage(storage);
    var rec = normalize(record);
    rec.savedAt = rec.savedAt || nowIso || new Date().toISOString();
    rec.version = 1;
    rec.source = rec.source || 'rosa';
    if (!storage || typeof storage.setItem !== 'function') return rec;
    storage.setItem(KEY, JSON.stringify(rec));
    // Stamp Drive merge time so ndsync last-write-wins sees Rosa's write as fresh
    // even when Rosa's PWA does not load ndsync.js.
    try { storage.setItem(TS_KEY, rec.savedAt); } catch (e) { /* ignore */ }
    return rec;
  }

  function clear(storage) {
    storage = getStorage(storage);
    if (!storage) return;
    try { storage.removeItem(KEY); } catch (e) { /* ignore */ }
    try { storage.removeItem(TS_KEY); } catch (e2) { /* ignore */ }
  }

  function hasAmount(rec) {
    return !!(rec && rec.amount != null && Number.isFinite(Number(rec.amount)));
  }

  function prependHistory(existing, row) {
    var list = normalizeHistory(existing);
    var next = [];
    if (row && row.amount != null) {
      next.push({
        amount: round2(row.amount),
        tripId: String(row.tripId || ''),
        pickup: String(row.pickup || ''),
        consignee: String(row.consignee || ''),
        tripDate: String(row.tripDate || ''),
        payWeek: String(row.payWeek || ''),
        savedAt: String(row.savedAt || '')
      });
    }
    list.forEach(function (item) {
      if (next.length >= HISTORY_LIMIT) return;
      var sameId = item.tripId && item.tripId === (row && row.tripId);
      var samePickup = item.pickup && row && row.pickup && item.pickup === row.pickup;
      if (sameId || samePickup) return;
      next.push(item);
    });
    return next;
  }

  function publishFromTrip(trip, nowIso, storage) {
    var t = trip || {};
    var amount = actualTotal(t);
    if (amount == null && t.actualPay != null && t.actualPay !== '') amount = round2(t.actualPay);
    if (amount == null) return read(storage);
    var now = nowIso || new Date().toISOString();
    var prev = read(storage);
    var payWeek = t.payWeek || payWeekOf(t.tripDate);
    var histRow = {
      amount: amount,
      tripId: t.id || t.tripId || '',
      pickup: String(t.pickup || '').replace(/\D/g, ''),
      consignee: t.consignee || t.customer || '',
      tripDate: t.tripDate || '',
      payWeek: payWeek,
      savedAt: now
    };
    return write({
      amount: amount,
      kind: 'trip',
      payWeek: payWeek,
      tripDate: t.tripDate || '',
      tripId: t.id || t.tripId || '',
      pickup: histRow.pickup,
      consignee: histRow.consignee,
      label: tripLabel(t),
      savedAt: now,
      source: 'rosa',
      lastActuals: prependHistory(prev.lastActuals, histRow)
    }, storage, now);
  }

  function publishFromWeek(trips, sundayISO, nowIso, storage) {
    var list = trips || [];
    var sunday = sundayISO || '';
    var total = 0;
    var count = 0;
    list.forEach(function (t) {
      if (!t) return;
      var week = t.payWeek || payWeekOf(t.tripDate);
      if (sunday && week !== sunday) return;
      var amt = actualTotal(t);
      if (amt == null) return;
      total += amt;
      count += 1;
    });
    if (!count) return read(storage);
    var now = nowIso || new Date().toISOString();
    var prev = read(storage);
    return write({
      amount: round2(total),
      kind: 'week',
      payWeek: sunday,
      tripDate: '',
      tripId: '',
      pickup: '',
      consignee: '',
      label: weekLabel(sunday) + ' · ' + count + (count === 1 ? ' trip' : ' trips'),
      savedAt: now,
      source: 'rosa',
      lastActuals: prev.lastActuals
    }, storage, now);
  }

  function publishManual(input, nowIso, storage) {
    var src = input || {};
    var amount = src.amount == null || src.amount === '' ? null : round2(src.amount);
    if (amount == null) return read(storage);
    var now = nowIso || new Date().toISOString();
    var prev = read(storage);
    var payWeek = src.payWeek || '';
    return write({
      amount: amount,
      kind: 'manual',
      payWeek: payWeek,
      tripDate: src.tripDate || '',
      tripId: '',
      pickup: '',
      consignee: '',
      label: src.label || (payWeek ? weekLabel(payWeek) : 'Rosa confirmed'),
      savedAt: now,
      source: 'rosa',
      lastActuals: prev.lastActuals
    }, storage, now);
  }

  /**
   * Compare a load's estimated pay against the current baseline / last actual.
   * delta = estimate − baseline (positive means this load is estimated higher).
   */
  function compareEstimate(estimate, baselineAmount) {
    var est = round2(estimate);
    var base = baselineAmount == null || baselineAmount === '' ? null : round2(baselineAmount);
    if (base == null) {
      return { estimate: est, baseline: null, delta: null, pct: null, tone: 'none' };
    }
    var delta = round2(est - base);
    var pct = base !== 0 ? round2((delta / Math.abs(base)) * 100) : null;
    var tone = 'even';
    if (delta > 0.004) tone = 'over';
    else if (delta < -0.004) tone = 'under';
    return { estimate: est, baseline: base, delta: delta, pct: pct, tone: tone };
  }

  function compareSummary(cmp) {
    if (!cmp || cmp.tone === 'none' || cmp.baseline == null) {
      return 'No baseline yet — Rosa has not sent an actual pay.';
    }
    var est = formatMoney(cmp.estimate);
    var base = formatMoney(cmp.baseline);
    if (cmp.tone === 'even') return 'Est. ' + est + ' matches last actual ' + base;
    var signed = (cmp.delta >= 0 ? '+' : '−') + formatMoney(Math.abs(cmp.delta));
    if (cmp.tone === 'over') return 'Est. ' + est + ' is ' + signed + ' vs last actual ' + base;
    return 'Est. ' + est + ' is ' + signed + ' vs last actual ' + base;
  }

  function lastActualForCustomer(customer, storage) {
    var rec = read(storage);
    var want = String(customer || '').trim().toLowerCase();
    if (!want) return null;
    var list = rec.lastActuals || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].consignee || '').trim().toLowerCase() === want) return list[i];
    }
    if (rec.consignee && String(rec.consignee).trim().toLowerCase() === want && rec.amount != null) {
      return {
        amount: rec.amount,
        tripId: rec.tripId,
        pickup: rec.pickup,
        consignee: rec.consignee,
        tripDate: rec.tripDate,
        payWeek: rec.payWeek,
        savedAt: rec.savedAt
      };
    }
    return null;
  }

  /** True when a trip date is this Sun–Sat week or the previous one. */
  function isRecentPayWeek(tripDate, now) {
    var week = payWeekOf(tripDate);
    if (!week) return false;
    var today = now ? (typeof now === 'string' ? parseISODateLocal(now) : now) : new Date();
    if (!today) return false;
    var current = payWeekOf(toIsoDate(today));
    var prevD = parseISODateLocal(current);
    if (!prevD) return false;
    prevD.setDate(prevD.getDate() - 7);
    var previous = toIsoDate(prevD);
    return week === current || week === previous;
  }

  return {
    KEY: KEY,
    TS_KEY: TS_KEY,
    HISTORY_LIMIT: HISTORY_LIMIT,
    num: num,
    round2: round2,
    payWeekOf: payWeekOf,
    formatMoney: formatMoney,
    hasActuals: hasActuals,
    actualTotal: actualTotal,
    tripLabel: tripLabel,
    weekLabel: weekLabel,
    emptyRecord: emptyRecord,
    normalize: normalize,
    read: read,
    write: write,
    clear: clear,
    hasAmount: hasAmount,
    publishFromTrip: publishFromTrip,
    publishFromWeek: publishFromWeek,
    publishManual: publishManual,
    compareEstimate: compareEstimate,
    compareSummary: compareSummary,
    lastActualForCustomer: lastActualForCustomer,
    isRecentPayWeek: isRecentPayWeek
  };
}));
