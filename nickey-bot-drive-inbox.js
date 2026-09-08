/* =============================================================================
 * Nickey Dispatch — Google Drive bot inbox
 *
 * Grok writes nickey-bot-inbox.json in "Nickey Dispatch Data". The phone, using
 * the same ndsync OAuth token, pulls pending trips into nickeySavedRecords.
 * After a successful merge the inbox is rewritten with applied trips removed.
 *
 * NEVER reads or writes nickey-dispatch-data.json. The main sync file updates
 * only via the normal ndsync push after localStorage.setItem.
 * ============================================================================= */

(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.NickeyBotDrive = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (w) {
  'use strict';

  var FOLDER_NAME = 'Nickey Dispatch Data';
  var INBOX_FILE  = 'nickey-bot-inbox.json';
  var MAIN_FILE   = 'nickey-dispatch-data.json';
  var TOKEN_BUFFER = 120000;
  var ACKED_KEY   = 'nickeyBotInboxAckedPickups';

  function log(msg, data) {
    if (data !== undefined) console.log('[NickeyBotDrive]', msg, data);
    else console.log('[NickeyBotDrive]', msg);
  }

  function normalizePickup(value) {
    if (value == null) return '';
    return String(value).replace(/\D/g, '');
  }

  function isEmpty(value) {
    return value == null || value === '' || value === 0;
  }

  function isPending(trip) {
    if (!trip) return false;
    var status = String(trip.inboxStatus || 'pending').toLowerCase();
    return status === 'pending' || status === '';
  }

  function tripToRecord(trip, driverName) {
    var now = new Date().toISOString();
    return {
      id: trip.id || ('REC-' + Date.now()),
      driverName: trip.driverName || driverName || '',
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
      odometerIn: trip.odometerIn || '',
      odometerOut: trip.odometerOut || '',
      miles: typeof trip.miles === 'number' ? trip.miles : (parseFloat(trip.miles) || 0),
      costPerMile: typeof trip.costPerMile === 'number' ? trip.costPerMile : (parseFloat(trip.costPerMile) || 0),
      reimbursements: Array.isArray(trip.reimbursements) ? trip.reimbursements : [],
      fuelEntries: Array.isArray(trip.fuelEntries) ? trip.fuelEntries : [],
      actualPay: trip.actualPay !== undefined ? trip.actualPay : null,
      bookkeepingComplete: !!trip.bookkeepingComplete,
      timestamp: trip.timestamp || now,
      updatedAt: trip.updatedAt || now,
      source: trip.source || 'grok_bot'
    };
  }

  function mergeRecord(local, incoming) {
    var out = Object.assign({}, local);
    var fields = ['driverName', 'date', 'pickup', 'customer', 'highLimit', 'trailer',
      'arrivalDate', 'arrivalTime', 'departureDate', 'departureTime',
      'tankerWeight', 'arrivalGallons', 'departureLoad', 'totalGallons', 'notes',
      'odometerIn', 'odometerOut'];
    fields.forEach(function (k) {
      if (isEmpty(out[k]) && !isEmpty(incoming[k])) out[k] = incoming[k];
    });
    if ((!out.basePay || out.basePay === 0) && incoming.basePay) out.basePay = incoming.basePay;
    if ((!out.miles || out.miles === 0) && incoming.miles) out.miles = incoming.miles;
    if ((!out.costPerMile || out.costPerMile === 0) && incoming.costPerMile) out.costPerMile = incoming.costPerMile;
    if (incoming.notes && out.notes && incoming.notes !== out.notes) {
      if (out.notes.indexOf(incoming.notes) === -1) out.notes = out.notes + ' — ' + incoming.notes;
    }
    // Never wipe phone-side fuel / reimbursements / bookkeeping
    if ((!out.reimbursements || !out.reimbursements.length) && incoming.reimbursements && incoming.reimbursements.length) {
      out.reimbursements = incoming.reimbursements;
    }
    if ((!out.fuelEntries || !out.fuelEntries.length) && incoming.fuelEntries && incoming.fuelEntries.length) {
      out.fuelEntries = incoming.fuelEntries;
    }
    if (out.actualPay == null && incoming.actualPay != null) out.actualPay = incoming.actualPay;
    if (!out.bookkeepingComplete && incoming.bookkeepingComplete) out.bookkeepingComplete = true;
    if (!out.driverName && incoming.driverName) out.driverName = incoming.driverName;
    if (!out.source) out.source = incoming.source || 'grok_bot';
    out.updatedAt = new Date().toISOString();
    return out;
  }

  function findLocalIndex(records, trip) {
    var pu = normalizePickup(trip.pickup || trip.pickupNumber);
    if (!pu) return -1;
    var i;
    for (i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r) continue;
      if (normalizePickup(r.pickup) === pu) return i;
    }
    return -1;
  }

  function applyInboxToRecords(records, trips, driverName) {
    var next = Array.isArray(records) ? records.slice() : [];
    var applied = [];
    var added = 0;
    var updated = 0;
    var i;
    for (i = 0; i < (trips || []).length; i++) {
      var trip = trips[i];
      if (!isPending(trip)) continue;
      var pu = normalizePickup(trip.pickup || trip.pickupNumber);
      if (!pu) continue;
      var incoming = tripToRecord(trip, driverName);
      var idx = findLocalIndex(next, trip);
      if (idx === -1) {
        next.push(incoming);
        added++;
      } else {
        next[idx] = mergeRecord(next[idx], incoming);
        updated++;
      }
      applied.push(trip);
    }
    return { records: next, applied: applied, added: added, updated: updated };
  }

  function remainingInboxTrips(allTrips, applied) {
    var appliedKeys = {};
    (applied || []).forEach(function (t) {
      var pu = normalizePickup(t.pickup || t.pickupNumber);
      if (pu) appliedKeys[pu] = true;
    });
    return (allTrips || []).filter(function (t) {
      var pu = normalizePickup(t.pickup || t.pickupNumber);
      if (pu && appliedKeys[pu]) return false;
      return true;
    });
  }

  function buildClearedInbox(original, remaining) {
    return {
      version: (original && original.version) || 1,
      updatedAt: new Date().toISOString(),
      trips: remaining || []
    };
  }

  // ── Browser-only Drive I/O ──────────────────────────────────────────────────

  function inBrowser() {
    return typeof document !== 'undefined' && w && w.localStorage;
  }

  function toast(msg) {
    if (!inBrowser()) return;
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
    if (!inBrowser()) return;
    var el = document.getElementById('driveInboxStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#ff8888' : '#a5d6a7';
  }

  function currentDriverName() {
    try {
      if (typeof currentDriver === 'string' && currentDriver) return currentDriver;
    } catch (e) { /* ignore */ }
    try {
      return (w.localStorage.getItem('currentDriver') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function getToken() {
    if (w.NDSync && typeof w.NDSync.getAccessToken === 'function') {
      var live = w.NDSync.getAccessToken();
      if (live && typeof w.NDSync.tokenValid === 'function' && w.NDSync.tokenValid()) return live;
      if (live) return live;
    }
    try {
      var stored = w.localStorage.getItem('ndsync_accessToken');
      var exp = parseInt(w.localStorage.getItem('ndsync_tokenExpiry') || '0', 10);
      if (stored && Date.now() < exp - TOKEN_BUFFER) return stored;
    } catch (e) { /* ignore */ }
    return null;
  }

  function folderName() {
    return (w.NDSync && w.NDSync.FOLDER_NAME) || FOLDER_NAME;
  }

  function driveJson(method, url, body, contentType, token) {
    var headers = { Authorization: 'Bearer ' + token };
    if (contentType) headers['Content-Type'] = contentType;
    return fetch(url, { method: method, headers: headers, body: body }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
        if (!r.ok) {
          var msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  function resolveFolderId(token) {
    if (w.NDSync && typeof w.NDSync.getFolderId === 'function') {
      var cached = w.NDSync.getFolderId();
      if (cached) return Promise.resolve(cached);
    }
    try {
      var stored = w.localStorage.getItem('ndsync_folderId');
      if (stored) return Promise.resolve(stored);
    } catch (e) { /* ignore */ }
    if (w.NDSync && typeof w.NDSync.ensureFolder === 'function') {
      return Promise.resolve(w.NDSync.ensureFolder());
    }
    var q = encodeURIComponent(
      "name='" + folderName() + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    return driveJson('GET',
      'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)&pageSize=10',
      null, null, token
    ).then(function (data) {
      if (data && data.files && data.files.length) return data.files[0].id;
      throw new Error('Folder "' + folderName() + '" not found');
    });
  }

  function findInboxFile(token, folderId) {
    var q = encodeURIComponent(
      "name='" + INBOX_FILE + "' and '" + folderId + "' in parents and trashed=false"
    );
    return driveJson('GET',
      'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)&pageSize=10',
      null, null, token
    ).then(function (data) {
      if (data && data.files && data.files.length) return data.files[0];
      // Fallback: same name anywhere the token can see (Grok may have created it)
      var q2 = encodeURIComponent("name='" + INBOX_FILE + "' and trashed=false");
      return driveJson('GET',
        'https://www.googleapis.com/drive/v3/files?q=' + q2 + '&fields=files(id,name,parents)&pageSize=10',
        null, null, token
      ).then(function (data2) {
        if (data2 && data2.files && data2.files.length) return data2.files[0];
        return null;
      });
    });
  }

  function downloadInbox(token, fileId) {
    return fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (r) {
      return r.text().then(function (text) {
        if (!r.ok) throw new Error('Inbox download failed: HTTP ' + r.status);
        if (!text) return { version: 1, trips: [] };
        try { return JSON.parse(text); } catch (e) {
          throw new Error('Inbox file is not valid JSON');
        }
      });
    });
  }

  function writeInbox(token, fileId, payload) {
    if (!fileId) return Promise.reject(new Error('No inbox file id'));
    var json = JSON.stringify(payload, null, 2);
    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: json
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          var err = new Error('Inbox write-back failed: HTTP ' + r.status);
          err.status = r.status;
          err.body = text;
          throw err;
        });
      }
      return r.json().catch(function () { return null; });
    });
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

  function loadAcked() {
    try {
      var raw = w.localStorage.getItem(ACKED_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function rememberAcked(pickups) {
    var set = {};
    loadAcked().forEach(function (p) { if (p) set[p] = true; });
    (pickups || []).forEach(function (p) { if (p) set[p] = true; });
    var list = Object.keys(set);
    if (list.length > 200) list = list.slice(list.length - 200);
    try { w.localStorage.setItem(ACKED_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function alreadyAckedLocally(trip) {
    var pu = normalizePickup(trip && (trip.pickup || trip.pickupNumber));
    if (!pu) return false;
    return loadAcked().indexOf(pu) !== -1;
  }

  function assertNotMainFile(file) {
    if (file && file.name === MAIN_FILE) {
      throw new Error('Refusing to touch ' + MAIN_FILE);
    }
  }

  function pullInbox(opts) {
    var options = opts || {};
    var silent = options.silent !== false;
    if (!inBrowser()) return Promise.resolve({ added: 0, skipped: true });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!silent) {
        setStatus('Offline — will pull when you reopen.', true);
        toast('Offline — bot inbox skipped');
      }
      return Promise.resolve({ added: 0, offline: true });
    }
    var token = getToken();
    if (!token) {
      if (!silent) {
        setStatus('Sign in to Cloud Sync first (same Google account).', true);
        toast('Sign in to Cloud Sync to pull bot trips');
      }
      return Promise.resolve({ added: 0, signedOut: true });
    }

    return resolveFolderId(token).then(function (folderId) {
      return findInboxFile(token, folderId).then(function (file) {
        return { folderId: folderId, file: file };
      });
    }).then(function (ctx) {
      if (!ctx.file) {
        var msg = 'No ' + INBOX_FILE + ' in "' + folderName() + '".';
        if (!silent) {
          setStatus(msg, true);
          toast(msg);
        } else {
          log(msg);
        }
        return { added: 0, missing: true };
      }
      assertNotMainFile(ctx.file);
      return downloadInbox(token, ctx.file.id).then(function (inbox) {
        var trips = (inbox && Array.isArray(inbox.trips)) ? inbox.trips : [];
        var pending = trips.filter(function (t) {
          return isPending(t) && !alreadyAckedLocally(t);
        });
        if (!pending.length) {
          if (!silent) {
            setStatus('Drive inbox empty — no new trips.');
            toast('No new bot trips');
          }
          return { added: 0, trips: [], fileId: ctx.file.id };
        }
        var result = applyInboxToRecords(loadRecords(), pending, currentDriverName());
        if (result.added || result.updated) persistRecords(result.records);
        var remaining = remainingInboxTrips(trips, result.applied);
        var cleared = buildClearedInbox(inbox, remaining);
        var appliedPickups = result.applied.map(function (t) {
          return normalizePickup(t.pickup || t.pickupNumber);
        }).filter(Boolean);

        function finish(writeOk) {
          rememberAcked(appliedPickups);
          var msg;
          if (result.added === 1) msg = '1 bot trip added — see Saved Records';
          else if (result.added > 1) msg = result.added + ' bot trips added — see Saved Records';
          else msg = 'Bot trips already in Saved Records';
          toast(msg);
          setStatus(writeOk === false
            ? msg + ' (inbox write-back failed; will skip these pickups next time)'
            : msg);
          log('applied Drive inbox trips', { added: result.added, updated: result.updated });
          return {
            added: result.added,
            updated: result.updated,
            applied: result.applied.length,
            writeBack: writeOk !== false,
            fileId: ctx.file.id
          };
        }

        return writeInbox(token, ctx.file.id, cleared).then(function () {
          return finish(true);
        }).catch(function (err) {
          log('inbox write-back failed', err && err.message);
          return finish(false);
        });
      });
    }).catch(function (err) {
      log('pull failed', err && err.message);
      if (!silent) {
        setStatus(err && err.message ? err.message : 'Drive inbox pull failed', true);
        toast('Bot inbox pull failed');
      }
      return { added: 0, error: err };
    });
  }

  function pullNow() {
    setStatus('Pulling Drive inbox…');
    if (w.NDSync && typeof w.NDSync.closeModal === 'function') {
      try { w.NDSync.closeModal(); } catch (e) { /* ignore */ }
    }
    return pullInbox({ silent: false });
  }

  function hydrateStatus() {
    if (!inBrowser()) return;
    var token = getToken();
    if (token) setStatus('Cloud Sync signed in — Drive inbox pulls on open and focus.');
    else setStatus('Sign in to Cloud Sync to pull Grok trips from Drive.', false);
  }

  var pulling = false;
  function pullSafe(opts) {
    if (pulling) return Promise.resolve({ added: 0, busy: true });
    pulling = true;
    return pullInbox(opts).then(function (r) {
      pulling = false;
      return r;
    }, function (err) {
      pulling = false;
      throw err;
    });
  }

  function boot() {
    if (!inBrowser()) return;
    hydrateStatus();

    function tryPull() {
      if (getToken()) pullSafe({ silent: true });
    }

    document.addEventListener('ndsync:ready', tryPull);
    document.addEventListener('ndsync:pulled', function () {
      setTimeout(tryPull, 400);
    });

    if (getToken()) {
      // ndsync may still be doing the initial main-file pull — wait briefly
      setTimeout(tryPull, 800);
    } else {
      var n = 0;
      var iv = setInterval(function () {
        n++;
        if (getToken()) {
          clearInterval(iv);
          tryPull();
        } else if (n > 40) {
          clearInterval(iv);
        }
      }, 500);
    }
  }

  if (inBrowser()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
    w.addEventListener('focus', function () {
      setTimeout(function () { pullSafe({ silent: true }); }, 1500);
    });
  }

  return {
    pullNow: pullNow,
    pullInbox: pullInbox,
    hydrateStatus: hydrateStatus,
    INBOX_FILE: INBOX_FILE,
    FOLDER_NAME: FOLDER_NAME,
    // test / console helpers
    normalizePickup: normalizePickup,
    isPending: isPending,
    tripToRecord: tripToRecord,
    mergeRecord: mergeRecord,
    findLocalIndex: findLocalIndex,
    applyInboxToRecords: applyInboxToRecords,
    remainingInboxTrips: remainingInboxTrips,
    buildClearedInbox: buildClearedInbox
  };
}));
