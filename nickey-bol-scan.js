/* =============================================================================
 * Nickey Dispatch — BOL photo scanner
 *
 * Reuses the same Google Gemini 2.5 Flash multimodal API already used by
 * Paste Dispatch (text) and fuel-receipt / settlement photo scans.
 * There is no separate Google Lens / Cloud Vision SDK in this app.
 *
 * Field list (BOL_FIELDS) is the tuning knob when Frank sends sample photos.
 * ============================================================================= */

(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.NickeyBolScan = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (w) {
  'use strict';

  var GEMINI_KEY_STORAGE = 'geminiApiKey';
  var GEMINI_MODEL = 'gemini-2.5-flash';
  var GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent?key=';

  var MISSING_KEY_MESSAGE =
    'Gemini API key not set — BOL scan uses the same Google Gemini key as Paste Dispatch. ' +
    'Enter it to continue (stored only on this device, sent only to Google).';

  /**
   * Golden example: Evonik Short Form ORIGINAL – NOT NEGOTIABLE
   * (Frank, Sep 2026 — Delivery no. 3012865610 → VI-JON Smyrna).
   *
   * Pickup # = Delivery no. NEVER Shipment no. / Order no. / PO no.
   * Tanker weight = Net LB, never Gross / Tare / 100%-basis adjusted wt.
   * Cont. ID is not a trailer number.
   */
  var BOL_FIELD_GROUPS = [
    { id: 'pickup', title: 'Pickup' },
    { id: 'load', title: 'Product & weight' },
    { id: 'parties', title: 'Shipper / Ship-to' },
    { id: 'ids', title: 'BOL numbers' },
    { id: 'extra', title: 'Other' }
  ];

  var BOL_FIELDS = [
    { key: 'pickupNumber', label: 'Pickup # (Delivery no.)', formId: 'pki', group: 'pickup', hint: 'Evonik Delivery no. — not Shipment no. (40…)' },
    { key: 'pickupDate', label: 'Ship date', formId: 'td', group: 'pickup', hint: 'Ship date, not Printed on' },
    { key: 'deliveryDate', label: 'Delivery date', formId: null, notesPrefix: 'Delivery date', group: 'pickup' },
    { key: 'product', label: 'Product / Chemical', formId: null, notesPrefix: 'Product', group: 'load' },
    { key: 'hazmat', label: 'Hazmat / UN line', formId: null, notesPrefix: 'Hazmat', group: 'load' },
    { key: 'hmFlag', label: 'HM flag', formId: null, notesPrefix: 'HM', group: 'load' },
    { key: 'tankerWeight', label: 'Net weight (lb)', formId: 'tw', group: 'load', hint: 'Net LB → tanker weight. Not Gross or Tare.' },
    { key: 'grossWeight', label: 'Gross (lb)', formId: null, notesPrefix: 'Gross lb', group: 'load' },
    { key: 'tareWeight', label: 'Tare (lb)', formId: null, notesPrefix: 'Tare lb', group: 'load' },
    { key: 'shipper', label: 'Shipper', formId: null, notesPrefix: 'Shipper', group: 'parties' },
    { key: 'consignee', label: 'Ship-to / Customer', formId: 'customerSelect', group: 'parties' },
    { key: 'originCity', label: 'Origin', formId: null, notesPrefix: 'Origin', group: 'parties' },
    { key: 'destCity', label: 'Destination', formId: null, notesPrefix: 'Dest', group: 'parties' },
    { key: 'trailerNumber', label: 'Trailer #', formId: 'tki', group: 'ids', hint: 'Not Cont. ID' },
    { key: 'shipmentNumber', label: 'Shipment no.', formId: null, notesPrefix: 'Shipment no.', group: 'ids' },
    { key: 'orderNumber', label: 'Order no.', formId: null, notesPrefix: 'Order no.', group: 'ids' },
    { key: 'poNumber', label: 'PO no.', formId: null, notesPrefix: 'PO no.', group: 'ids' },
    { key: 'materialNo', label: 'Material no.', formId: null, notesPrefix: 'Material no.', group: 'ids' },
    { key: 'batch', label: 'Batch', formId: null, notesPrefix: 'Batch', group: 'ids' },
    { key: 'customerMaterialNo', label: 'Customer material no.', formId: null, notesPrefix: 'Customer material no.', group: 'ids' },
    { key: 'containerId', label: 'Cont. ID', formId: null, notesPrefix: 'Cont. ID', group: 'ids' },
    { key: 'seals', label: 'Seals', formId: null, notesPrefix: 'Seals', group: 'ids' },
    { key: 'notes', label: 'Special instructions', formId: 'nts', group: 'extra' }
  ];

  var WEIGHT_KEYS = { tankerWeight: 1, grossWeight: 1, tareWeight: 1 };
  var DATE_KEYS = { pickupDate: 1, deliveryDate: 1 };

  function emptyBolFields() {
    var out = {};
    BOL_FIELDS.forEach(function (f) { out[f.key] = ''; });
    return out;
  }

  function fieldByKey(key) {
    for (var i = 0; i < BOL_FIELDS.length; i++) {
      if (BOL_FIELDS[i].key === key) return BOL_FIELDS[i];
    }
    return null;
  }

  function log(msg, data) {
    if (data !== undefined) console.log('[NickeyBolScan]', msg, data);
    else console.log('[NickeyBolScan]', msg);
  }

  function getGeminiKey() {
    try {
      if (w && w.localStorage) return (w.localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
    } catch (e) { /* ignore */ }
    return '';
  }

  function setGeminiKey(key) {
    try {
      if (w && w.localStorage) w.localStorage.setItem(GEMINI_KEY_STORAGE, String(key || '').trim());
    } catch (e) { /* ignore */ }
  }

  function normalizePickup(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  /**
   * True when both sides have digits and they are not the same number.
   * Empty typed pickup is not a mismatch (Frank hasn't entered one yet).
   */
  function pickupMismatch(typed, extracted) {
    var a = normalizePickup(typed);
    var b = normalizePickup(extracted);
    if (!a || !b) return false;
    return a !== b;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * BOL dates vary: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YY, "Sep 8, 2026".
   * Returns YYYY-MM-DD or '' if unparseable.
   */
  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12
  };

  function isoFromParts(year, month, day) {
    var y = String(year);
    if (y.length === 2) y = '20' + y;
    var mm = parseInt(month, 10);
    var dd = parseInt(day, 10);
    if (!Number.isFinite(mm) || !Number.isFinite(dd)) return '';
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return y + '-' + pad2(mm) + '-' + pad2(dd);
  }

  function normalizeDate(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var mdy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (mdy) return isoFromParts(mdy[3], mdy[1], mdy[2]);
    var named = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{2,4})$/);
    if (named) {
      var m = MONTHS[named[1].toLowerCase()];
      if (m) return isoFromParts(named[3], m, named[2]);
    }
    var dmon = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
    if (dmon) {
      var m2 = MONTHS[dmon[2].toLowerCase()];
      if (m2) return isoFromParts(dmon[3], m2, dmon[1]);
    }
    return '';
  }

  /**
   * Strip lbs / commas. Returns a digit string or ''.
   */
  function normalizeWeight(raw) {
    if (raw == null || raw === '') return '';
    var s = String(raw).replace(/,/g, '').replace(/[^\d.]/g, '');
    if (!s) return '';
    var n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) return '';
    return String(Math.round(n));
  }

  function stripJsonFences(text) {
    return String(text || '')
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  function coerceFieldValue(key, value) {
    if (value == null) return '';
    if (DATE_KEYS[key]) return normalizeDate(value) || String(value).trim();
    if (WEIGHT_KEYS[key]) return normalizeWeight(value);
    if (key === 'pickupNumber' || key === 'shipmentNumber' || key === 'orderNumber' || key === 'poNumber') {
      return normalizePickup(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return String(value).trim();
  }

  function firstPresent(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && String(v).trim() !== '') return v;
    }
    return null;
  }

  /**
   * Pickup # is Delivery no. Never Shipment / Order / PO.
   */
  function resolvePickupNumber(parsed) {
    var delivery = normalizePickup(firstPresent(parsed, [
      'deliveryNumber', 'deliveryNo', 'delivery_no', 'delivery'
    ]));
    var pickup = normalizePickup(firstPresent(parsed, ['pickupNumber', 'pickup']));
    var shipment = normalizePickup(firstPresent(parsed, ['shipmentNumber', 'shipmentNo', 'shipment']));
    var order = normalizePickup(firstPresent(parsed, ['orderNumber', 'orderNo', 'order']));
    var po = normalizePickup(firstPresent(parsed, ['poNumber', 'poNo', 'po', 'purchaseOrder']));
    if (delivery) return delivery;
    if (pickup && pickup !== shipment && pickup !== order && pickup !== po) return pickup;
    return '';
  }

  function parseBolJson(raw) {
    var out = emptyBolFields();
    var text = stripJsonFences(raw);
    if (!text) return out;
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('Gemini returned malformed JSON. Try a clearer photo.'); }
    if (!parsed || typeof parsed !== 'object') return out;

    var aliases = {
      consignee: ['consignee', 'shipTo', 'ship_to', 'customer'],
      trailerNumber: ['trailerNumber', 'trailer'],
      tankerWeight: ['tankerWeight', 'netWeightLb', 'netWeight', 'net_lb', 'net'],
      grossWeight: ['grossWeight', 'grossWeightLb', 'gross'],
      tareWeight: ['tareWeight', 'tareWeightLb', 'tare'],
      hazmat: ['hazmat', 'unNumber', 'unLine', 'hazmatLine'],
      hmFlag: ['hmFlag', 'hm', 'hazmatFlag'],
      shipmentNumber: ['shipmentNumber', 'shipmentNo', 'shipment'],
      orderNumber: ['orderNumber', 'orderNo', 'order'],
      poNumber: ['poNumber', 'poNo', 'po', 'purchaseOrder'],
      materialNo: ['materialNo', 'materialNumber', 'material'],
      customerMaterialNo: ['customerMaterialNo', 'customerMaterial', 'custMaterial'],
      containerId: ['containerId', 'contId', 'contID', 'container'],
      pickupDate: ['pickupDate', 'shipDate', 'ship_date'],
      deliveryDate: ['deliveryDate', 'delivDate']
    };

    BOL_FIELDS.forEach(function (f) {
      if (f.key === 'pickupNumber') return;
      var keys = aliases[f.key] ? aliases[f.key] : [f.key];
      var v = firstPresent(parsed, keys);
      out[f.key] = coerceFieldValue(f.key, v);
    });

    out.pickupNumber = resolvePickupNumber(parsed);

    // Generic "weight" only if net was missing and it is not the gross figure.
    if (!out.tankerWeight && parsed.weight != null) {
      var wgt = normalizeWeight(parsed.weight);
      if (wgt && wgt !== out.grossWeight) out.tankerWeight = wgt;
    }
    return out;
  }

  function bolGeminiPrompt() {
    var lines = [
      'You are reading a Bill of Lading photo for Nickey chemical tanker dispatch (Super D / Evonik).',
      'Golden example: Evonik "Short Form - ORIGINAL - NOT NEGOTIABLE".',
      'Extract every field you can clearly read. Return ONLY valid JSON. Empty string if unread. Do not invent values.',
      '',
      'JSON shape:',
      '{',
      '  "deliveryNumber": "Delivery no. — THIS is Nickey Pickup # (e.g. 3012865610)",',
      '  "pickupNumber": "same as deliveryNumber (Delivery no.)",',
      '  "shipmentNumber": "Shipment no. (e.g. 4007091890) — NOT the pickup number",',
      '  "orderNumber": "Order no. (e.g. 2007702185)",',
      '  "poNumber": "PO no. (e.g. 4500629294)",',
      '  "pickupDate": "Ship date as YYYY-MM-DD (e.g. Sep 8, 2026 → 2026-09-08). NOT Printed on.",',
      '  "deliveryDate": "Delivery date as YYYY-MM-DD if shown",',
      '  "product": "commodity line (e.g. PERSYNT 500 Super D BULK)",',
      '  "hazmat": "full UN / hazmat line (e.g. UN 2014, Hydrogen peroxide, aqueous solutions, 5.1 (8), II)",',
      '  "hmFlag": "X if HM column is marked, else empty",',
      '  "tankerWeight": "NET weight in pounds only (e.g. 43120). NEVER Gross, NEVER Tare, NEVER 100% basis adjusted wt.",',
      '  "grossWeight": "Gross weight pounds",',
      '  "tareWeight": "Tare weight pounds",',
      '  "shipper": "Shipper name (e.g. Evonik Corporation) — NOT ship-to",',
      '  "consignee": "Ship-to / consignee name (e.g. VI-JON, INC.) — NOT the shipper",',
      '  "trailerNumber": "trailer or tanker number if printed. Cont. ID is NOT a trailer number.",',
      '  "originCity": "shipper city and state (e.g. Memphis, TN)",',
      '  "destCity": "ship-to city and state (e.g. Smyrna, TN)",',
      '  "containerId": "Cont. ID (e.g. 77)",',
      '  "seals": "seal numbers as printed",',
      '  "materialNo": "Material no.",',
      '  "batch": "Batch",',
      '  "customerMaterialNo": "Customer material no.",',
      '  "notes": "special instructions only (e.g. Protect from thermal radiation, COA MUST BE WITH SHIPMENT)"',
      '}',
      '',
      'Rules:',
      '- pickupNumber / deliveryNumber = Delivery no. NEVER Shipment no., Order no., or PO no.',
      '- tankerWeight = Net LB. On Evonik Short Form that is the Net Weight row (43,120 LB), not Gross 74,240 or Tare 31,120.',
      '- product is the chemical (PERSYNT 500 Super D BULK), not the customer.',
      '- Keep shipmentNumber, orderNumber, poNumber, materialNo, batch, customerMaterialNo, containerId, seals as their own fields.'
    ];
    return lines.join('\n');
  }

  async function extractBolFromImage(b64, mimeType, apiKey, fetchFn) {
    var fetchImpl = fetchFn || (w && w.fetch) || globalThis.fetch;
    if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
    if (!fetchImpl) throw new Error('Network is not available.');
    var mime = mimeType || 'image/jpeg';
    var url = GEMINI_URL + encodeURIComponent(apiKey);
    var res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: bolGeminiPrompt() },
            { inlineData: { mimeType: mime, data: b64 } }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 }
      })
    });
    if (!res.ok) {
      var msg = 'Gemini API error (' + res.status + ')';
      try {
        var err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (e) { /* ignore */ }
      if (res.status === 403) msg = 'API key denied — check that Gemini API is enabled for this key.';
      if (res.status === 429) msg = 'Rate limit exceeded — wait a moment and try again.';
      throw new Error(msg);
    }
    var data = await res.json();
    var raw = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!raw) throw new Error('Gemini returned an empty response. Try a clearer photo.');
    return parseBolJson(raw);
  }

  /**
   * Merge product / UN / IDs into Notes without duplicating lines.
   * Pickup # and net tanker weight stay on the form, not here.
   */
  function composeNotes(existingNotes, fields) {
    var f = fields || {};
    var parts = [];
    var existing = String(existingNotes || '').trim();
    function alreadyHas(prefix, value) {
      if (!value) return true;
      var re = new RegExp('\\b' + escapeRegExp(prefix) + '\\s*[:#]\\s*' + escapeRegExp(value), 'i');
      return re.test(existing) || parts.some(function (p) { return re.test(p); });
    }
    BOL_FIELDS.forEach(function (meta) {
      if (!meta.notesPrefix) return;
      var value = String(f[meta.key] || '').trim();
      if (value && !alreadyHas(meta.notesPrefix, value)) {
        parts.push(meta.notesPrefix + ': ' + value);
      }
    });
    var extra = String(f.notes || '').trim();
    if (extra && existing.indexOf(extra) === -1 && parts.indexOf(extra) === -1) {
      parts.push(extra);
    }
    if (!existing) return parts.join('\n');
    if (!parts.length) return existing;
    return existing + '\n' + parts.join('\n');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function foldName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/\b(incorporated|inc|llc|corp|corporation|company|co|ltd)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Match Ship-to onto nickeyCustomers.
   * Folds punctuation so "VI-JON, INC." hits "V.I.J.O.N. Smyrna Tennessee".
   * destCity (e.g. Smyrna, TN) is a fallback when the name is thin.
   */
  function matchCustomer(name, customers, destCity) {
    var list = customers || [];
    if (!list.length) return null;
    var folded = foldName(name);
    if (folded.length >= 4) {
      var hit = list.find(function (c) {
        var n = foldName(c && c.name);
        return n === folded || n.indexOf(folded) !== -1 || folded.indexOf(n) !== -1;
      });
      if (hit) return hit;
    }
    var words = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
      return w.length > 3 && w !== 'incorporated';
    });
    var wordHit = list.find(function (c) {
      var n = String(c && c.name || '').toLowerCase();
      return words.some(function (w) { return n.indexOf(w) !== -1; });
    });
    if (wordHit) return wordHit;
    var city = foldName(String(destCity || '').split(',')[0]);
    if (city.length >= 5) {
      return list.find(function (c) { return foldName(c && c.name).indexOf(city) !== -1; }) || null;
    }
    return null;
  }

  function formPatchFromBol(fields, customers, existingNotes) {
    var f = Object.assign(emptyBolFields(), fields || {});
    var match = matchCustomer(f.consignee, customers, f.destCity);
    return {
      pickupNumber: f.pickupNumber || '',
      pickupDate: f.pickupDate || '',
      tankerWeight: f.tankerWeight || '',
      customer: match ? match.name : '',
      trailerNumber: f.trailerNumber || '',
      notes: composeNotes(existingNotes, f)
    };
  }

  function matchTrailer(trailerNumber, options) {
    var want = String(trailerNumber || '').trim();
    if (!want || !options) return '';
    var i;
    for (i = 0; i < options.length; i++) {
      var v = options[i];
      if (!v) continue;
      if (v === want || v.indexOf(want) !== -1 || want.indexOf(v) !== -1) return v;
    }
    return '';
  }

  /**
   * Hardware zoom when MediaTrackCapabilities.zoom exists; otherwise CSS scale.
   */
  function resolveZoomSupport(capabilities) {
    var caps = capabilities || {};
    var z = caps.zoom;
    if (z && typeof z === 'object') {
      var min = z.min != null ? Number(z.min) : 1;
      var max = z.max != null ? Number(z.max) : 1;
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        return {
          mode: 'hardware',
          min: min,
          max: max,
          step: z.step != null && Number(z.step) > 0 ? Number(z.step) : 0.1
        };
      }
    }
    return { mode: 'css', min: 1, max: 3, step: 0.25 };
  }

  function clampZoom(support, value) {
    var v = Number(value);
    if (!Number.isFinite(v)) v = support.min;
    if (v < support.min) return support.min;
    if (v > support.max) return support.max;
    return v;
  }

  async function applyTrackZoom(track, zoom) {
    if (!track || typeof track.applyConstraints !== 'function') return false;
    try {
      await track.applyConstraints({ advanced: [{ zoom: zoom }] });
      return true;
    } catch (e1) {
      try {
        await track.applyConstraints({ zoom: zoom });
        return true;
      } catch (e2) {
        log('hardware zoom not applied', e2 && e2.message);
        return false;
      }
    }
  }

  function applyCssZoom(el, zoom) {
    if (!el) return;
    el.style.transform = 'scale(' + zoom + ')';
    el.style.transformOrigin = 'center center';
  }

  function captureVideoFrame(video, cssZoom, maxEdge) {
    var vw = video && video.videoWidth;
    var vh = video && video.videoHeight;
    if (!vw || !vh) throw new Error('Camera is not ready yet.');
    var zoom = Number(cssZoom) > 1 ? Number(cssZoom) : 1;
    var cropW = vw / zoom;
    var cropH = vh / zoom;
    var sx = (vw - cropW) / 2;
    var sy = (vh - cropH) / 2;
    var cap = document.createElement('canvas');
    var edge = maxEdge || 1600;
    var scale = Math.min(1, edge / Math.max(cropW, cropH));
    cap.width = Math.max(1, Math.round(cropW * scale));
    cap.height = Math.max(1, Math.round(cropH * scale));
    var ctx = cap.getContext('2d');
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cap.width, cap.height);
    return cap.toDataURL('image/jpeg', 0.85);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read that photo.')); };
      r.readAsDataURL(file);
    });
  }

  function dataUrlParts(dataUrl) {
    var s = String(dataUrl || '');
    var m = s.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return { mime: 'image/jpeg', b64: s };
    return { mime: m[1], b64: m[2] };
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readReviewFields(container) {
    var out = emptyBolFields();
    if (!container) return out;
    BOL_FIELDS.forEach(function (f) {
      var el = container.querySelector('[data-bol-key="' + f.key + '"]');
      out[f.key] = el ? String(el.value || '').trim() : '';
    });
    if (out.pickupDate) out.pickupDate = normalizeDate(out.pickupDate) || out.pickupDate;
    if (out.deliveryDate) out.deliveryDate = normalizeDate(out.deliveryDate) || out.deliveryDate;
    ['tankerWeight', 'grossWeight', 'tareWeight'].forEach(function (k) {
      if (out[k]) out[k] = normalizeWeight(out[k]) || out[k];
    });
    if (out.pickupNumber) out.pickupNumber = normalizePickup(out.pickupNumber);
    return out;
  }

  function renderFieldInput(meta, value, highlight) {
    var hint = meta.hint
      ? '<div style="font-size:11px;color:#888;margin:-4px 0 6px;line-height:1.3;">' + escHtml(meta.hint) + '</div>'
      : '';
    var border = highlight ? '#cc0000' : '#555';
    var html = '<div class="fld">';
    html += '<label>' + escHtml(meta.label) + '</label>';
    html += hint;
    if (meta.key === 'notes' || meta.key === 'hazmat') {
      html += '<textarea data-bol-key="' + meta.key + '" rows="' + (meta.key === 'notes' ? '3' : '2') +
        '" style="width:100%;padding:10px;font-size:15px;background:#2a2a2a;color:#eee;border:1.8px solid #555;border-radius:8px;">' +
        escHtml(value) + '</textarea>';
    } else {
      html += '<input data-bol-key="' + meta.key + '" type="text" value="' + escHtml(value) +
        '" style="width:100%;padding:12px;font-size:16px;background:#2a2a2a;color:#eee;border:1.8px solid ' +
        border + ';border-radius:8px;' +
        (highlight ? 'box-shadow:0 0 0 2px rgba(204,0,0,0.35);' : '') + '">';
    }
    html += '</div>';
    return html;
  }

  function renderReviewHtml(fields, typedPickup) {
    var f = Object.assign(emptyBolFields(), fields || {});
    var mismatch = pickupMismatch(typedPickup, f.pickupNumber);
    var html = '';
    if (mismatch) {
      html += '<div class="bol-mismatch" id="bolMismatchBanner">' +
        '⚠ Pickup # on the BOL (<strong>' + escHtml(normalizePickup(f.pickupNumber)) +
        '</strong>) does not match what you typed (<strong>' +
        escHtml(normalizePickup(typedPickup)) + '</strong>). Correct below before Apply.' +
        '</div>';
    } else {
      html += '<div class="bol-mismatch" id="bolMismatchBanner" style="display:none"></div>';
    }
    html += '<div style="font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;color:#ffd700;letter-spacing:1px;margin:10px 0;">REVIEW BOL</div>';
    html += '<div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.4;">Evonik Short Form: Pickup # is <strong style="color:#ccc;">Delivery no.</strong>, tanker weight is <strong style="color:#ccc;">Net LB</strong>. Apply fills the form — it does not Save Record.</div>';
    BOL_FIELD_GROUPS.forEach(function (group) {
      var inGroup = BOL_FIELDS.filter(function (meta) { return meta.group === group.id; });
      if (!inGroup.length) return;
      html += '<div style="font-size:12px;color:#ffd700;letter-spacing:1px;text-transform:uppercase;margin:14px 0 8px;border-bottom:1px solid #333;padding-bottom:4px;">' +
        escHtml(group.title) + '</div>';
      inGroup.forEach(function (meta) {
        html += renderFieldInput(meta, f[meta.key] || '', meta.key === 'pickupNumber' && mismatch);
      });
    });
    return html;
  }

  function updateMismatchBanner(container, typedPickup) {
    if (!container) return false;
    var input = container.querySelector('[data-bol-key="pickupNumber"]');
    var banner = container.querySelector('#bolMismatchBanner');
    var extracted = input ? input.value : '';
    var mismatch = pickupMismatch(typedPickup, extracted);
    if (banner) {
      if (mismatch) {
        banner.style.display = 'block';
        banner.innerHTML = '⚠ Pickup # on the BOL (<strong>' + escHtml(normalizePickup(extracted)) +
          '</strong>) does not match what you typed (<strong>' +
          escHtml(normalizePickup(typedPickup)) + '</strong>). Correct below before Apply.';
      } else {
        banner.style.display = 'none';
      }
    }
    if (input) {
      input.style.borderColor = mismatch ? '#cc0000' : '#555';
      input.style.boxShadow = mismatch ? '0 0 0 2px rgba(204,0,0,0.35)' : 'none';
    }
    return mismatch;
  }

  function stopStream(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) { /* ignore */ }
  }

  return {
    GEMINI_KEY_STORAGE: GEMINI_KEY_STORAGE,
    GEMINI_MODEL: GEMINI_MODEL,
    MISSING_KEY_MESSAGE: MISSING_KEY_MESSAGE,
    BOL_FIELDS: BOL_FIELDS,
    BOL_FIELD_GROUPS: BOL_FIELD_GROUPS,
    emptyBolFields: emptyBolFields,
    fieldByKey: fieldByKey,
    getGeminiKey: getGeminiKey,
    setGeminiKey: setGeminiKey,
    normalizePickup: normalizePickup,
    pickupMismatch: pickupMismatch,
    normalizeDate: normalizeDate,
    normalizeWeight: normalizeWeight,
    resolvePickupNumber: resolvePickupNumber,
    parseBolJson: parseBolJson,
    bolGeminiPrompt: bolGeminiPrompt,
    extractBolFromImage: extractBolFromImage,
    composeNotes: composeNotes,
    foldName: foldName,
    matchCustomer: matchCustomer,
    formPatchFromBol: formPatchFromBol,
    matchTrailer: matchTrailer,
    resolveZoomSupport: resolveZoomSupport,
    clampZoom: clampZoom,
    applyTrackZoom: applyTrackZoom,
    applyCssZoom: applyCssZoom,
    captureVideoFrame: captureVideoFrame,
    fileToDataUrl: fileToDataUrl,
    dataUrlParts: dataUrlParts,
    renderReviewHtml: renderReviewHtml,
    readReviewFields: readReviewFields,
    updateMismatchBanner: updateMismatchBanner,
    stopStream: stopStream,
    escHtml: escHtml
  };
}));
