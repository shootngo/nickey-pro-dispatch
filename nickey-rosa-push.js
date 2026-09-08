/* =============================================================================
 * Nickey Dispatch — Rosa's Ledger push
 *
 * Maps the current trip (form / saveRecord) onto a Firestore `trips` document
 * and writes it with Firebase email/password auth. Google OAuth is intentionally
 * not used here (ndsync already owns Google sign-in; a second GIS prompt would
 * re-prompt Frank).
 *
 * Config and credentials stay on this device (not Drive-synced).
 * ============================================================================= */

(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.NickeyRosa = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (w) {
  'use strict';

  var CONFIG_KEY = 'nickeyRosaFirebaseConfig';
  var EMAIL_KEY  = 'nickeyRosaAuthEmail';
  var PLACEHOLDER_API_KEY = 'YOUR_API_KEY';

  var PLACEHOLDER_CONFIG = {
    apiKey: PLACEHOLDER_API_KEY,
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
  };

  var US_STATES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
    massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
    missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
    wyoming: 'WY'
  };

  var TWO_WORD_CITIES = [
    'siler city', 'lumber bridge', 'mount joy', 'de queen'
  ];

  function log(msg, data) {
    if (data !== undefined) console.log('[NickeyRosa]', msg, data);
    else console.log('[NickeyRosa]', msg);
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function round1(n) {
    return Math.round((Number(n) || 0) * 10) / 10;
  }

  function num(v) {
    if (v == null || v === '') return 0;
    var n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
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

  /**
   * Sunday (local) of the Sun–Sat week that contains tripDate (YYYY-MM-DD).
   */
  function payWeekOf(tripDate) {
    var d = parseISODateLocal(tripDate);
    if (!d) return '';
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return toIsoDate(d);
  }

  function milesFromOdo(odometerIn, odometerOut) {
    var inn = num(odometerIn);
    var out = num(odometerOut);
    if (inn <= 0 || out <= 0 || out < inn) return 0;
    return round1(out - inn);
  }

  function costPerMile(basePay, miles) {
    var pay = num(basePay);
    var m = num(miles);
    if (m <= 0) return 0;
    return round2(pay / m);
  }

  /**
   * Same rule as index.html calculateDetention: first 2 hours free, then $75/hr.
   */
  function detentionCharge(arrivalDate, arrivalTime, departureDate, departureTime) {
    if (!arrivalDate || !arrivalTime || !departureDate || !departureTime) return 0;
    var arrival = new Date(arrivalDate + 'T' + arrivalTime);
    var departure = new Date(departureDate + 'T' + departureTime);
    if (!(arrival instanceof Date) || !(departure instanceof Date)) return 0;
    if (isNaN(arrival.getTime()) || isNaN(departure.getTime())) return 0;
    if (departure < arrival) return 0;
    var totalHours = (departure - arrival) / (1000 * 60 * 60);
    if (totalHours <= 2) return 0;
    return round2((totalHours - 2) * 75);
  }

  function classifyReimbursements(list) {
    var estReeferFuel = 0;
    var estExtraPay = 0;
    (list || []).forEach(function (r) {
      if (!r) return;
      var amt = num(r.amount != null ? r.amount : r.amt);
      if (!amt) return;
      var desc = String(r.desc || r.description || '');
      if (/\breefer\b/i.test(desc)) estReeferFuel += amt;
      else estExtraPay += amt;
    });
    return { estReeferFuel: round2(estReeferFuel), estExtraPay: round2(estExtraPay) };
  }

  function titleCaseCity(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .map(function (word) {
        if (!word) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  function extractCityState(text) {
    var m = String(text || '').match(/\b([A-Za-z][A-Za-z .'-]+),\s*([A-Za-z]{2})\b/);
    if (!m) return '';
    return titleCaseCity(m[1]) + ', ' + m[2].toUpperCase();
  }

  function destCityFromCustomer(name, address) {
    var fromAddr = extractCityState(address);
    if (fromAddr) return fromAddr;
    var fromNameCsv = extractCityState(name);
    if (fromNameCsv) return fromNameCsv;
    var s = String(name || '').trim();
    if (!s) return '';
    var lower = s.toLowerCase();
    var stateName;
    var names = Object.keys(US_STATES).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      stateName = names[i];
      if (lower.endsWith(' ' + stateName)) {
        var without = s.slice(0, s.length - stateName.length).trim();
        var words = without.split(/\s+/);
        if (!words.length) return '';
        var lastTwo = words.slice(-2).join(' ').toLowerCase();
        var city = TWO_WORD_CITIES.indexOf(lastTwo) !== -1
          ? words.slice(-2).join(' ')
          : words[words.length - 1];
        return titleCaseCity(city) + ', ' + US_STATES[stateName];
      }
    }
    return '';
  }

  function shipperFromNotes(notes) {
    var m = String(notes || '').match(/\bshipper\s*[:#]\s*(.+?)(?:\s+[—\-]\s*|$)/im);
    return m ? m[1].trim() : '';
  }

  function originCityFromNotes(notes, destCity) {
    var city = extractCityState(notes);
    if (!city) return '';
    if (destCity && city.toLowerCase() === String(destCity).toLowerCase()) return '';
    return city;
  }

  function frankNotes(text, timestamp, author) {
    var t = String(text || '').trim();
    if (!t) return [];
    return [{
      text: t,
      author: author || 'Frank',
      timestamp: timestamp || new Date().toISOString()
    }];
  }

  function pickupDigits(pickup) {
    return String(pickup || '').replace(/\D/g, '');
  }

  /**
   * Build the Frank-side Firestore trip document.
   * Rosa actuals / deductions are omitted (not written as null) so a merge
   * update cannot wipe values Rosa already entered.
   */
  function buildTripDoc(input, nowIso) {
    var src = input || {};
    var now = nowIso || new Date().toISOString();
    var tripDate = src.date || src.tripDate || '';
    var miles = src.miles != null && src.miles !== ''
      ? num(src.miles)
      : milesFromOdo(src.odometerIn, src.odometerOut);
    var linehaul = num(src.estLinehaul != null ? src.estLinehaul : src.basePay);
    var destCity = destCityFromCustomer(src.customer || src.consignee, src.customerAddress || src.address);
    var notesText = src.notes;
    if (Array.isArray(notesText)) notesText = (notesText[0] && notesText[0].text) || '';
    var shipper = src.shipper || shipperFromNotes(notesText);
    var originCity = src.originCity || originCityFromNotes(notesText, destCity);
    var reimb = classifyReimbursements(src.reimbursements);
    var detention = src.estDetention != null && src.estDetention !== ''
      ? num(src.estDetention)
      : detentionCharge(src.arrivalDate, src.arrivalTime, src.departureDate, src.departureTime);

    var doc = {
      tripDate: tripDate,
      payWeek: payWeekOf(tripDate),
      pushedAt: now,
      pickup: pickupDigits(src.pickup || src.pickupNumber) || String(src.pickup || ''),
      driverName: src.driverName || 'Frank Mulkey',
      trailer: src.trailer || '',
      shipper: shipper || '',
      consignee: src.consignee || src.customer || '',
      originCity: originCity || '',
      destCity: destCity || '',
      estLinehaul: round2(linehaul),
      estDetention: round2(detention),
      estExtraPay: src.estExtraPay != null && src.estExtraPay !== '' ? round2(src.estExtraPay) : reimb.estExtraPay,
      estReeferFuel: src.estReeferFuel != null && src.estReeferFuel !== '' ? round2(src.estReeferFuel) : reimb.estReeferFuel,
      odometerIn: num(src.odometerIn) || 0,
      odometerOut: num(src.odometerOut) || 0,
      miles: miles,
      costPerMile: costPerMile(linehaul, miles),
      notes: frankNotes(notesText, now, 'Frank'),
      source: 'nickey',
      nickeyRecordId: src.id || src.nickeyRecordId || ''
    };
    return doc;
  }

  function isPlaceholderConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return true;
    var key = String(cfg.apiKey || '');
    return !key || key === PLACEHOLDER_API_KEY || key.indexOf('YOUR_') === 0;
  }

  function parseConfigPaste(text) {
    var raw = String(text || '').trim();
    if (!raw) throw new Error('Config is empty.');
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No { ... } object found in the paste.');
    var obj = raw.slice(start, end + 1);
    try { return JSON.parse(obj); } catch (e) { /* JS object literal */ }
    var quoted = obj
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([,{]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"');
    try { return JSON.parse(quoted); }
    catch (e2) { throw new Error('Could not parse Firebase config. Paste the firebaseConfig object from the Firebase console.'); }
  }

  function loadConfig() {
    try {
      if (w && w.localStorage) {
        var raw = w.localStorage.getItem(CONFIG_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.apiKey) return parsed;
        }
      }
    } catch (e) { /* ignore */ }
    return Object.assign({}, PLACEHOLDER_CONFIG);
  }

  function saveConfig(cfg) {
    if (!w || !w.localStorage) return false;
    w.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return true;
  }

  function isConfigured() {
    return !isPlaceholderConfig(loadConfig());
  }

  function getFirebase() {
    var fb = (w && w.firebase) || (typeof firebase !== 'undefined' ? firebase : null);
    if (!fb) throw new Error('Firebase SDK did not load. Check the network and reopen the app.');
    var cfg = loadConfig();
    if (isPlaceholderConfig(cfg)) {
      throw new Error('Paste the Firebase web config in Settings → Rosa first. See docs/rosa-push.md.');
    }
    if (!fb.apps || !fb.apps.length) fb.initializeApp(cfg);
    return fb;
  }

  function currentUser() {
    try {
      var fb = (w && w.firebase) || (typeof firebase !== 'undefined' ? firebase : null);
      if (!fb || !fb.apps || !fb.apps.length) return null;
      return fb.auth().currentUser;
    } catch (e) {
      return null;
    }
  }

  function signIn(email, password) {
    var fb = getFirebase();
    var auth = fb.auth();
    // LOCAL persistence (default on web) keeps Frank signed in across visits
    // without a Google account chooser.
    var persist = Promise.resolve();
    if (auth.setPersistence && fb.auth.Auth && fb.auth.Auth.Persistence) {
      persist = auth.setPersistence(fb.auth.Auth.Persistence.LOCAL);
    }
    return persist.then(function () {
      return auth.signInWithEmailAndPassword(email, password);
    }).then(function (cred) {
      if (w && w.localStorage && email) w.localStorage.setItem(EMAIL_KEY, email);
      log('Signed in', cred && cred.user && cred.user.email);
      return cred;
    });
  }

  function signOut() {
    var fb = (w && w.firebase) || (typeof firebase !== 'undefined' ? firebase : null);
    if (!fb || !fb.apps || !fb.apps.length) return Promise.resolve();
    return fb.auth().signOut();
  }

  function tripDocId(doc) {
    var pu = pickupDigits(doc && doc.pickup);
    return pu || null;
  }

  /**
   * Write (merge) the trip. Merge so Rosa's later actuals are not clobbered
   * when Frank re-pushes estimates.
   */
  function pushTrip(doc, firestoreOverride) {
    var payload = doc || {};
    if (firestoreOverride) {
      var id = tripDocId(payload);
      if (id) return firestoreOverride.collection('trips').doc(id).set(payload, { merge: true }).then(function () { return id; });
      return firestoreOverride.collection('trips').add(payload).then(function (ref) { return ref.id; });
    }
    var fb = getFirebase();
    var user = fb.auth().currentUser;
    if (!user) {
      throw new Error('Sign in under Settings → Rosa (email / password) before pushing.');
    }
    var db = fb.firestore();
    var docId = tripDocId(payload);
    if (docId) {
      return db.collection('trips').doc(docId).set(payload, { merge: true }).then(function () { return docId; });
    }
    return db.collection('trips').add(payload).then(function (ref) { return ref.id; });
  }

  return {
    PLACEHOLDER_CONFIG: PLACEHOLDER_CONFIG,
    CONFIG_KEY: CONFIG_KEY,
    EMAIL_KEY: EMAIL_KEY,
    payWeekOf: payWeekOf,
    milesFromOdo: milesFromOdo,
    costPerMile: costPerMile,
    detentionCharge: detentionCharge,
    classifyReimbursements: classifyReimbursements,
    destCityFromCustomer: destCityFromCustomer,
    extractCityState: extractCityState,
    shipperFromNotes: shipperFromNotes,
    originCityFromNotes: originCityFromNotes,
    frankNotes: frankNotes,
    pickupDigits: pickupDigits,
    buildTripDoc: buildTripDoc,
    parseConfigPaste: parseConfigPaste,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    isConfigured: isConfigured,
    isPlaceholderConfig: isPlaceholderConfig,
    getFirebase: getFirebase,
    currentUser: currentUser,
    signIn: signIn,
    signOut: signOut,
    tripDocId: tripDocId,
    pushTrip: pushTrip
  };
}));
