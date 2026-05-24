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

}(window));
