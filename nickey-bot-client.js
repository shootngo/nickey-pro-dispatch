/* =============================================================================
 * Nickey Dispatch — Bot inbox client
 * Pulls pending trips from the Nickey Bot Worker into nickeySavedRecords.
 * Settings live in localStorage (device only — not an ndsync key):
 *   nickeyBotApiUrl, nickeyBotApiKey
 * ============================================================================= */

(function (w) {
  'use strict';

  var URL_KEY = 'nickeyBotApiUrl';
  var KEY_KEY = 'nickeyBotApiKey';

  function log(msg, data) {
    if (data !== undefined) console.log('[NickeyBot]', msg, data);
    else console.log('[NickeyBot]', msg);
  }

  function getSettings() {
    return {
      url: (w.localStorage.getItem(URL_KEY) || '').trim().replace(/\/+$/, ''),
      key: (w.localStorage.getItem(KEY_KEY) || '').trim()
    };
  }

  function saveSettings(url, key) {
    if (url != null) w.localStorage.setItem(URL_KEY, String(url).trim().replace(/\/+$/, ''));
    if (key != null) w.localStorage.setItem(KEY_KEY, String(key).trim());
    return getSettings();
  }

  function configured() {
    var s = getSettings();
    return !!(s.url && s.key);
  }

  function authHeaders() {
    var s = getSettings();
    return {
      'Authorization': 'Bearer ' + s.key,
      'Content-Type': 'application/json'
    };
  }

  function api(path, options) {
    var s = getSettings();
    if (!s.url || !s.key) return Promise.reject(new Error('Bot API URL and key are not set'));
    var opts = options || {};
    var headers = Object.assign({}, authHeaders(), opts.headers || {});
    return fetch(s.url + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
        if (!res.ok) {
          var msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  function normalizePickup(value) {
    if (value == null) return '';
    return String(value).replace(/\D/g, '');
  }

  function isEmpty(value) {
    return value == null || value === '' || value === 0;
  }

  function loadRecords() {
    try {
      var raw = w.localStorage.getItem('nickeySavedRecords');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function persistRecords(records) {
    w.localStorage.setItem('nickeySavedRecords', JSON.stringify(records));
    try {
      if (typeof savedRecords !== 'undefined') savedRecords = records;
    } catch (e) { /* ignore */ }
    try {
      if (typeof loadSavedRecords === 'function') loadSavedRecords();
    } catch (e) { /* ignore */ }
    try {
      document.dispatchEvent(new Event('nickeybot:pulled'));
    } catch (e) { /* ignore */ }
  }

  function tripToRecord(trip) {
    var now = new Date().toISOString();
    return {
      id: trip.id || ('REC-' + Date.now()),
      driverName: trip.driverName || (typeof currentDriver === 'string' ? currentDriver : '') || '',
      date: trip.date || trip.pickupDate || '',
      pickup: trip.pickup || trip.pickupNumber || '',
      customer: trip.customer || '',
      basePay: typeof trip.basePay === 'number' ? trip.basePay : (parseFloat(trip.basePay) || 0),
      highLimit: trip.highLimit == null ? '' : String(trip.highLimit),
      trailer: trip.trailer || trip.trailerNumber || '',
      arrivalDate: trip.arrivalDate || '',
      arrivalTime: trip.arrivalTime || '',
      departureDate: trip.departureDate || '',
      departureTime: trip.departureTime || '',
      tankerWeight: trip.tankerWeight || '',
      arrivalGallons: trip.arrivalGallons || '',
      departureLoad: trip.departureLoad || '',
      totalGallons: trip.totalGallons || '',
      notes: trip.notes || '',
      reimbursements: Array.isArray(trip.reimbursements) ? trip.reimbursements : [],
      fuelEntries: Array.isArray(trip.fuelEntries) ? trip.fuelEntries : [],
      actualPay: trip.actualPay !== undefined ? trip.actualPay : null,
      bookkeepingComplete: !!trip.bookkeepingComplete,
      timestamp: trip.timestamp || now,
      updatedAt: trip.updatedAt || now,
      source: trip.source || 'nickey-bot'
    };
  }

  function mergeRecord(local, incoming) {
    var out = Object.assign({}, local);
    var fields = ['driverName', 'date', 'pickup', 'customer', 'highLimit', 'trailer',
      'arrivalDate', 'arrivalTime', 'departureDate', 'departureTime',
      'tankerWeight', 'arrivalGallons', 'departureLoad', 'totalGallons', 'notes'];
    fields.forEach(function (k) {
      if (isEmpty(out[k]) && !isEmpty(incoming[k])) out[k] = incoming[k];
    });
    if ((!out.basePay || out.basePay === 0) && incoming.basePay) out.basePay = incoming.basePay;
    if (incoming.notes && out.notes && incoming.notes !== out.notes) {
      if (out.notes.indexOf(incoming.notes) === -1) out.notes = out.notes + ' — ' + incoming.notes;
    }
    if ((!out.reimbursements || !out.reimbursements.length) && incoming.reimbursements && incoming.reimbursements.length) {
      out.reimbursements = incoming.reimbursements;
    }
    if ((!out.fuelEntries || !out.fuelEntries.length) && incoming.fuelEntries && incoming.fuelEntries.length) {
      out.fuelEntries = incoming.fuelEntries;
    }
    if (!out.driverName && typeof currentDriver === 'string') out.driverName = currentDriver;
    out.updatedAt = new Date().toISOString();
    return out;
  }

  function findLocalIndex(records, trip) {
    var pu = normalizePickup(trip.pickup || trip.pickupNumber);
    var date = trip.date || trip.pickupDate || '';
    var i;
    if (trip.id) {
      for (i = 0; i < records.length; i++) {
        if (records[i] && records[i].id === trip.id) return i;
      }
    }
    if (!pu) return -1;
    for (i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r) continue;
      if (normalizePickup(r.pickup) !== pu) continue;
      if (date && r.date && r.date !== date) continue;
      return i;
    }
    return -1;
  }

  function applyInboxTrips(trips) {
    var records = loadRecords();
    var applied = [];
    var i;
    for (i = 0; i < trips.length; i++) {
      var incoming = tripToRecord(trips[i]);
      var idx = findLocalIndex(records, trips[i]);
      if (idx === -1) {
        records.push(incoming);
        applied.push(trips[i]);
      } else {
        records[idx] = mergeRecord(records[idx], incoming);
        applied.push(trips[i]);
      }
    }
    if (applied.length) persistRecords(records);
    return applied;
  }

  function toast(msg) {
    var el = document.getElementById('nickeyBotToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nickeyBotToast';
      el.style.cssText = 'position:fixed;bottom:56px;right:14px;z-index:9997;' +
        'background:rgba(0,0,0,0.92);border:1px solid #4caf50;color:#c8e6c9;' +
        'font-size:12px;padding:8px 12px;border-radius:10px;max-width:70%;' +
        'display:none;line-height:1.35;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 4500);
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('botStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#ff8888' : '#a5d6a7';
  }

  function hydrateSettingsForm() {
    var s = getSettings();
    var urlEl = document.getElementById('botApiUrl');
    var keyEl = document.getElementById('botApiKey');
    if (urlEl) urlEl.value = s.url;
    if (keyEl) keyEl.value = s.key;
    if (s.url && s.key) setStatus('Configured — pulls on open and when this tab is focused.');
    else setStatus('Not configured yet.', false);
  }

  function saveSettingsFromForm() {
    var urlEl = document.getElementById('botApiUrl');
    var keyEl = document.getElementById('botApiKey');
    var url = urlEl ? urlEl.value : '';
    var key = keyEl ? keyEl.value : '';
    saveSettings(url, key);
    setStatus('Saved on this device.');
    toast('Bot settings saved');
    return pullInbox({ silent: false });
  }

  function promptBotSettings() {
    var s = getSettings();
    var url = w.prompt('Nickey Bot API URL (Cloudflare Worker):', s.url || 'https://');
    if (url == null) return;
    var key = w.prompt('Bot API key:', s.key || '');
    if (key == null) return;
    saveSettings(url, key);
    hydrateSettingsForm();
    return pullInbox({ silent: false });
  }

  function ackTrip(id) {
    return api('/v1/inbox/' + encodeURIComponent(id) + '/ack', {
      method: 'POST',
      body: '{}'
    });
  }

  function pullInbox(opts) {
    var options = opts || {};
    var silent = options.silent !== false;
    if (!configured()) {
      if (!silent) setStatus('Set the Worker URL and API key first.', true);
      return Promise.resolve({ applied: 0, skipped: true });
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!silent) setStatus('Offline — will pull when you reopen.', true);
      return Promise.resolve({ applied: 0, offline: true });
    }
    return api('/v1/inbox').then(function (data) {
      var trips = (data && data.trips) || [];
      if (!trips.length) {
        if (!silent) {
          setStatus('Inbox empty — no new trips.');
          toast('No new bot trips');
        }
        return { applied: 0, trips: [] };
      }
      var applied = applyInboxTrips(trips);
      var acks = applied.map(function (t) {
        return ackTrip(t.id).catch(function (err) {
          log('ack failed', err && err.message);
        });
      });
      return Promise.all(acks).then(function () {
        var msg = applied.length === 1
          ? '1 trip from Nickey Bot — see Saved Records'
          : applied.length + ' trips from Nickey Bot — see Saved Records';
        toast(msg);
        setStatus(msg);
        log('applied inbox trips', applied.length);
        return { applied: applied.length, trips: applied };
      });
    }).catch(function (err) {
      log('pull failed', err && err.message);
      if (!silent) {
        setStatus(err && err.message ? err.message : 'Pull failed', true);
        toast('Bot pull failed');
      }
      return { applied: 0, error: err };
    });
  }

  function pullNow() {
    setStatus('Pulling…');
    return pullInbox({ silent: false });
  }

  function boot() {
    hydrateSettingsForm();
    pullInbox({ silent: true });
  }

  w.NickeyBot = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    saveSettingsFromForm: saveSettingsFromForm,
    hydrateSettingsForm: hydrateSettingsForm,
    promptBotSettings: promptBotSettings,
    pullNow: pullNow,
    pullInbox: pullInbox
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  w.addEventListener('focus', function () {
    pullInbox({ silent: true });
  });
})(window);
