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
    catch(e) { return false; }
  };

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
    try {
      var saved = JSON.parse(localStorage.getItem('nickeyCustomers') || 'null');
      if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    } catch(e) {}
    return ND_DEFAULT_CUSTOMERS.map(function(c) { return Object.assign({}, c); });
  };

  w.ndSaveCustomers = function(arr) {
    localStorage.setItem('nickeyCustomers', JSON.stringify(arr));
  };

  // ── Trailers ──────────────────────────────────────────────────────────────
  var ND_DEFAULT_TRAILERS = [
    "SD 94","SD 55-20","SD 45","SD 37",
    "ISO 144930","ISO 144926","ISO 144927","ISO 144925","ISO 144924",
    "ISO 144923","ISO 144922","ISO 134915","ISO 134914","ISO 134908",
    "ISO 134906","ISO 134912","DV 18118"
  ];

  w.ndLoadTrailers = function() {
    try {
      var saved = JSON.parse(localStorage.getItem('nickeyTrailers') || 'null');
      if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    } catch(e) {}
    return ND_DEFAULT_TRAILERS.slice();
  };

  w.ndSaveTrailers = function(arr) {
    localStorage.setItem('nickeyTrailers', JSON.stringify(arr));
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

    var wrap = document.createElement('div');
    wrap.className = 'nd-voice-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    wrap.appendChild(btn);

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

}(window));
