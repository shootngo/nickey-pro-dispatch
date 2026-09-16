/* =============================================================================
 * Nickey Dispatch — Shared Utilities
 * Loaded synchronously before page scripts on all pages.
 * Provides: localStorage helpers, driver, customers, trailers, date/money utils.
 * ============================================================================= */

(function(w) {
  'use strict';

  // ── localStorage Helpers ──────────────────────────────────────────────────
  w.ndGet = function(key, fallback) {
    try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : (fallback !== undefined ? fallback : null); }
    catch(e) { return fallback !== undefined ? fallback : null; }
  };

  w.ndSet = function(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch(e) {
      if (w.NickeyPersist && typeof w.NickeyPersist.reportWriteError === 'function') {
        w.NickeyPersist.reportWriteError(key, e);
      } else {
        try { console.error('[ndSet]', key, e); } catch (err) {}
      }
      return false;
    }
  };

  function persistMasterWrite(key, arr) {
    if (w.NickeyPersist && typeof w.NickeyPersist.writeMasterList === 'function') {
      var wr = w.NickeyPersist.writeMasterList(key, arr);
      return !!(wr && wr.ok);
    }
    return w.ndSet(key, arr);
  }

  function persistMasterLoad(key) {
    if (w.NickeyPersist && typeof w.NickeyPersist.loadMasterList === 'function') {
      var loaded = w.NickeyPersist.loadMasterList(key);
      if (loaded && Array.isArray(loaded.list) && loaded.list.length) return loaded.list;
    }
    try {
      var saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    } catch (e) {}
    return null;
  }

  w.ndGetRaw = function(key, fallback) {
    return localStorage.getItem(key) || (fallback !== undefined ? fallback : '');
  };

  // ── Driver ────────────────────────────────────────────────────────────────
  w.ndGetDriver = function() {
    return localStorage.getItem('currentDriver') || 'Unknown Driver';
  };
  w.ndSetDriver = function(name) {
    localStorage.setItem('currentDriver', (name || '').trim());
  };

  // ── Customers ─────────────────────────────────────────────────────────────
  var ND_DEFAULT_CUSTOMERS = [
    {name:"Cytec Mount Joy Tennessee",           limit:0,    pay:800,     address:""},
    {name:"Foster Farms Farmerville Louisiana",  limit:5100, pay:1220,    address:""},
    {name:"Harrison Produce Bethlehem Georgia",  limit:5400, pay:1807.20, address:""},
    {name:"Hydrox Elgin Illinois",               limit:0,    pay:2256,    address:""},
    {name:"Lincoln Premium Produce Fremont Nebraska", limit:7400, pay:3068, address:""},
    {name:"Maxson",                              limit:0,    pay:388.80,  address:""},
    {name:"Moore Jack Jasper Alabama",           limit:5400, pay:848.80,  address:""},
    {name:"Mountaire Lumber Bridge",             limit:5600, pay:3116.80, address:""},
    {name:"Mountaire Siler City",                limit:5400, pay:4000,    address:""},
    {name:"Pecola",                              limit:0,    pay:1264.80, address:""},
    {name:"Pilgrim's Pride De Queen Arkansas",   limit:5100, pay:1175.20, address:""},
    {name:"P.L. Developments Piedmont South Carolina", limit:9500, pay:2256, address:""},
    {name:"Purdue Pocahontas Arkansas",          limit:5300, pay:552,     address:""},
    {name:"V.I.J.O.N. Smyrna Tennessee",         limit:5000, pay:948,     address:""},
    {name:"Washburn Tunnel Wastewater Facility Pasadena Texas", limit:5500, pay:2403.20, address:""},
    {name:"Wolf River",                          limit:0,    pay:352,     address:""},
    {name:"WSC",                                 limit:0,    pay:200,     address:""}
  ];

  w.ndLoadCustomers = function() {
    var saved = persistMasterLoad('nickeyCustomers');
    if (saved) return saved;
    return ND_DEFAULT_CUSTOMERS.map(function(c) { return Object.assign({}, c); });
  };

  w.ndSaveCustomers = function(arr) {
    return persistMasterWrite('nickeyCustomers', arr);
  };

  // ── Trailers ──────────────────────────────────────────────────────────────
  var ND_DEFAULT_TRAILERS = [
    "SD 94","SD 55-20","SD 45","SD 37",
    "ISO 144930","ISO 144926","ISO 144927","ISO 144925","ISO 144924",
    "ISO 144923","ISO 144922","ISO 134915","ISO 134914","ISO 134908",
    "ISO 134906","ISO 134912","DV 18118"
  ];

  w.ndLoadTrailers = function() {
    var saved = persistMasterLoad('nickeyTrailers');
    if (saved) return saved;
    return ND_DEFAULT_TRAILERS.slice();
  };

  w.ndSaveTrailers = function(arr) {
    return persistMasterWrite('nickeyTrailers', arr);
  };

  // ── Date Helpers ──────────────────────────────────────────────────────────
  w.eeIsoDate = function(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  w.eeAddDays = function(d, n) {
    var x = new Date(d); x.setDate(x.getDate() + n); return x;
  };

  w.eeStartOfWeek = function(d) {
    var x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x;
  };

  w.eeWeekNum = function(d) {
    var t  = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dn = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dn);
    var ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil((((t - ys) / 86400000) + 1) / 7);
  };

  w.eeWeekKey = function(d) {
    var s = w.eeStartOfWeek(d);
    return s.getFullYear() + '-W' + String(w.eeWeekNum(s)).padStart(2, '0');
  };

  w.eeIsSameDay = function(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth()    &&
           a.getDate()     === b.getDate();
  };

  // ── Money Helpers ─────────────────────────────────────────────────────────
  w.eeFmtMoney = function(n) {
    if (!n) return '$0.00';
    return '$' + n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  };

  w.eeFmtMoneyShort = function(n) {
    if (!n) return '$0';
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  };

  // ── Autosave Pill ─────────────────────────────────────────────────────────
  w.ndShowAutosave = function(pillId) {
    var pill = document.getElementById(pillId || 'autosavePill');
    if (!pill) return;
    pill.classList.add('show');
    setTimeout(function() { pill.classList.remove('show'); }, 1500);
  };

  // ── Voice Input ────────────────────────────────────────────────────────────
  function ndWordsToNumber(text) {
    var W = {
      zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
      ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
      seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,
      fifty:50,sixty:60,seventy:70,eighty:80,ninety:90
    };
    var parts = text.toLowerCase().replace(/-/g, ' ').split(/\s+/);
    var total = 0, cur = 0, i, p, n;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p === 'hundred') { cur = (cur || 1) * 100; }
      else if (p === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
      else { n = W[p]; if (n !== undefined) cur += n; }
    }
    total += cur;
    return total > 0 ? String(total) : null;
  }

  w.ndParseNumeric = function(text) {
    var stripped = text.replace(/\b(dollars?|gallons?|pounds?|lbs?|cents?|bucks?)\b/gi, '').trim();
    var m = stripped.match(/[\d,]+\.?\d*/);
    if (m) return m[0].replace(/,/g, '');
    return ndWordsToNumber(stripped) || stripped.replace(/[^0-9.]/g, '');
  };

  w.ndAttachVoiceInput = function(fieldOrId, opts) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    opts = opts || {};
    var numericOnly = !!opts.numericOnly;
    var lang = opts.language || 'en-US';
    var el = typeof fieldOrId === 'string' ? document.getElementById(fieldOrId) : fieldOrId;
    if (!el || el.dataset.ndVoice) return;
    el.dataset.ndVoice = '1';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nd-mic-btn';
    btn.setAttribute('aria-label', 'Voice input');
    btn.textContent = '🎤';

    var trailing = opts.trailingHost;
    if (typeof trailing === 'string') trailing = document.getElementById(trailing);
    if (trailing) {
      // Keep sibling trailing actions (e.g. BOL camera) on-screen — do not wrap
      // the input in .nd-voice-wrap { width:100% }, which shoves them off-row
      // and leaves the mic floating in empty space beside a shrink-to-fit field.
      btn.classList.add('nd-mic-in-trailing');
      trailing.insertBefore(btn, trailing.firstChild);
    } else {
      var wrap = document.createElement('div');
      wrap.className = 'nd-voice-wrap';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      wrap.appendChild(btn);
    }

    if (el.tagName === 'TEXTAREA') btn.classList.add('nd-mic-textarea');

    var recognition = null;
    var listening = false;

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (listening) { if (recognition) recognition.stop(); return; }
      recognition = new SR();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = function() { listening = true; btn.classList.add('active'); };
      recognition.onresult = function(event) {
        var raw = event.results[0][0].transcript.trim();
        el.value = numericOnly ? w.ndParseNumeric(raw) : raw;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      recognition.onerror = function(ev) {
        if (ev.error === 'not-allowed') {
          alert('Microphone permission denied. Allow microphone access in your browser settings and try again.');
        }
      };
      recognition.onend = function() { listening = false; btn.classList.remove('active'); };
      try { recognition.start(); } catch(err) { console.warn('ndVoice start error:', err); }
    });
  };


  // ── Contacts helper ──────────────────────────────────────────────────────────
  w.ndGetContactEmail = function(purpose, fallback) {
    try {
      var contacts = JSON.parse(localStorage.getItem('nickeyContacts') || '[]');
      var match = contacts.find(function(c){ return c.purpose === purpose; });
      if (match && match.email && match.email.trim()) return match.email.trim();
    } catch(e){}
    return fallback;
  };

  // ── App version / service worker updates ──────────────────────────────────
  w.ND_APP_VERSION = 'V 9.0';
  w.ND_SW_CHECK_SETTLE_MS = 500;
  w.ND_SW_RELOAD_MS = 1800;

  w.ndSwRegisterOpts = function() {
    return { scope: './', updateViaCache: 'none' };
  };

  function ndSetCheckStatus(text) {
    if (typeof document === 'undefined' || !document.body) return;
    var el = document.getElementById('ndUpdateCheckStatus');
    if (!text) {
      if (el && el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      } else if (el && typeof el.remove === 'function') {
        el.remove();
      }
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'ndUpdateCheckStatus';
      el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#111;color:#ffd700;padding:14px 16px;text-align:center;font-size:14px;font-weight:700;z-index:99998;letter-spacing:0.5px;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  w.ndShowUpdateBanner = function() {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('ndUpdateBanner')) return;
    var b = document.createElement('div');
    b.id = 'ndUpdateBanner';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1e3a8a;color:#fff;padding:14px 16px;text-align:center;font-size:14px;font-weight:700;z-index:99999;cursor:pointer;letter-spacing:0.5px;';
    b.textContent = '🔄 New version available — tap to update';
    b.addEventListener('click', function() {
      b.textContent = 'Updating...';
      if (!navigator.serviceWorker || typeof navigator.serviceWorker.getRegistration !== 'function') {
        window.location.reload();
        return;
      }
      navigator.serviceWorker.getRegistration('./').then(function(reg) {
        w.ndActivateWaitingWorker(reg);
      });
    });
    document.body.appendChild(b);
  };

  w.ndWatchServiceWorker = function(reg) {
    if (!reg || typeof reg.addEventListener !== 'function') return;
    reg.addEventListener('updatefound', function() {
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function() {
        if (nw.state === 'installed' && navigator.serviceWorker && navigator.serviceWorker.controller) {
          w.ndShowUpdateBanner();
        }
      });
    });
  };

  w.ndActivateWaitingWorker = function(reg) {
    var reloading = false;
    function reload() {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    }
    if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('controllerchange', reload);
    }
    var waiting = null;
    if (reg) {
      waiting = reg.waiting || null;
      if (!waiting && reg.installing && reg.installing.state === 'installed') waiting = reg.installing;
    }
    if (waiting && typeof waiting.postMessage === 'function') {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    } else {
      reload();
      return 'reloaded';
    }
    setTimeout(reload, w.ND_SW_RELOAD_MS || 1800);
    return 'activating';
  };

  function ndCloseHamburger() {
    if (typeof w.toggleMenu !== 'function') return;
    var ov = typeof document !== 'undefined' ? document.getElementById('menuOverlay') : null;
    if (ov && ov.style && ov.style.display === 'flex') w.toggleMenu();
  }

  function ndAlertLatest() {
    alert("You're on " + w.ND_APP_VERSION + " — already latest.");
  }

  function ndAlertOffline() {
    alert("Couldn't check for an update right now. Try again when you have a signal.\n\nYou're on " + w.ND_APP_VERSION + ".");
  }

  function ndWaitForInstalled(worker) {
    return new Promise(function(resolve) {
      if (!worker) {
        resolve(null);
        return;
      }
      if (worker.state === 'installed' || worker.state === 'activated') {
        resolve(worker);
        return;
      }
      if (worker.state === 'redundant') {
        resolve(null);
        return;
      }
      worker.addEventListener('statechange', function onState() {
        if (worker.state === 'installed' || worker.state === 'activated') {
          worker.removeEventListener('statechange', onState);
          resolve(worker);
        } else if (worker.state === 'redundant') {
          worker.removeEventListener('statechange', onState);
          resolve(null);
        }
      });
    });
  }

  function ndFinishFound(reg) {
    ndSetCheckStatus('');
    var ok = true;
    try { ok = confirm('New version found. Update now?\n\nCurrently running ' + w.ND_APP_VERSION + '.'); }
    catch (e) {}
    if (!ok) {
      w.ndShowUpdateBanner();
      return 'deferred';
    }
    w.ndActivateWaitingWorker(reg);
    return 'updating';
  }

  function ndSettleAfterUpdate(reg) {
    if (reg.waiting) return Promise.resolve(ndFinishFound(reg));
    if (reg.installing) {
      return ndWaitForInstalled(reg.installing).then(function(worker) {
        if (worker || reg.waiting) return ndFinishFound(reg);
        ndSetCheckStatus('');
        ndAlertLatest();
        return 'latest';
      });
    }
    return new Promise(function(resolve) {
      setTimeout(function() {
        if (reg.waiting) {
          resolve(ndFinishFound(reg));
        } else if (reg.installing) {
          ndWaitForInstalled(reg.installing).then(function(worker) {
            if (worker || reg.waiting) resolve(ndFinishFound(reg));
            else {
              ndSetCheckStatus('');
              ndAlertLatest();
              resolve('latest');
            }
          });
        } else {
          ndSetCheckStatus('');
          ndAlertLatest();
          resolve('latest');
        }
      }, w.ND_SW_CHECK_SETTLE_MS || 0);
    });
  }

  w.ndCheckForUpdate = function() {
    ndCloseHamburger();
    if (!navigator.serviceWorker) {
      ndAlertLatest();
      return Promise.resolve('unsupported');
    }

    ndSetCheckStatus('Checking for update…');

    return navigator.serviceWorker.getRegistration('./').then(function(existing) {
      var ready = existing
        ? Promise.resolve(existing)
        : navigator.serviceWorker.register('./sw.js', w.ndSwRegisterOpts());
      return ready.then(function(reg) {
        if (!reg) {
          ndSetCheckStatus('');
          ndAlertLatest();
          return 'latest';
        }
        if (reg.waiting) return ndFinishFound(reg);
        if (reg.installing) {
          return ndWaitForInstalled(reg.installing).then(function(worker) {
            if (worker || reg.waiting) return ndFinishFound(reg);
            ndSetCheckStatus('');
            ndAlertLatest();
            return 'latest';
          });
        }

        var bust = './sw.js?check=' + Date.now();
        var ping = (typeof fetch === 'function')
          ? fetch(bust, { cache: 'no-store' }).then(function(resp) { return resp; }).catch(function() { return null; })
          : Promise.resolve({ ok: true });

        return ping.then(function(resp) {
          var reached = !!(resp && resp.ok);
          var updatePromise = (reg.update && typeof reg.update === 'function')
            ? Promise.resolve(reg.update()).catch(function() { return null; })
            : Promise.resolve(null);
          return updatePromise.then(function(updated) {
            if (!reached && !updated && !reg.waiting && !reg.installing) {
              ndSetCheckStatus('');
              ndAlertOffline();
              return 'offline';
            }
            return ndSettleAfterUpdate(reg);
          });
        });
      });
    }).catch(function() {
      ndSetCheckStatus('');
      ndAlertOffline();
      return 'offline';
    });
  };

}(window));
