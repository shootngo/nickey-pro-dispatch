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
   * Extraction schema. Add/rename keys here when sample BOLs show new labels.
   * formId: trip-form control to fill on Apply (null = notes-only).
   * notesPrefix: prepended into Notes when there is no dedicated field.
   */
  var BOL_FIELDS = [
    { key: 'pickupNumber', label: 'Pickup #', formId: 'pki', notesPrefix: null },
    { key: 'pickupDate', label: 'Pickup Date', formId: 'td', notesPrefix: null },
    { key: 'product', label: 'Product / Chemical', formId: null, notesPrefix: 'Product' },
    { key: 'tankerWeight', label: 'Tanker Weight (lb)', formId: 'tw', notesPrefix: null },
    { key: 'shipper', label: 'Shipper', formId: null, notesPrefix: 'Shipper' },
    { key: 'consignee', label: 'Consignee / Customer', formId: 'customerSelect', notesPrefix: null },
    { key: 'trailerNumber', label: 'Trailer #', formId: 'tki', notesPrefix: null },
    { key: 'originCity', label: 'Origin', formId: null, notesPrefix: 'Origin' },
    { key: 'destCity', label: 'Destination', formId: null, notesPrefix: 'Dest' },
    { key: 'notes', label: 'Notes / special instructions', formId: 'nts', notesPrefix: null }
  ];

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
   * BOL dates vary: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YY, MM.DD.YY.
   * Returns YYYY-MM-DD or '' if unparseable.
   */
  function normalizeDate(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var mdy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (mdy) {
      var mm = pad2(mdy[1]);
      var dd = pad2(mdy[2]);
      var yy = mdy[3];
      if (yy.length === 2) yy = '20' + yy;
      if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return '';
      if (parseInt(dd, 10) < 1 || parseInt(dd, 10) > 31) return '';
      return yy + '-' + mm + '-' + dd;
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
    if (key === 'pickupDate') return normalizeDate(value);
    if (key === 'tankerWeight') return normalizeWeight(value);
    if (key === 'pickupNumber') return normalizePickup(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return String(value).trim();
  }

  function parseBolJson(raw) {
    var out = emptyBolFields();
    var text = stripJsonFences(raw);
    if (!text) return out;
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('Gemini returned malformed JSON. Try a clearer photo.'); }
    if (!parsed || typeof parsed !== 'object') return out;
    BOL_FIELDS.forEach(function (f) {
      var v = parsed[f.key];
      if (v == null && f.key === 'consignee' && parsed.customer != null) v = parsed.customer;
      if (v == null && f.key === 'trailerNumber' && parsed.trailer != null) v = parsed.trailer;
      if (v == null && f.key === 'tankerWeight' && parsed.weight != null) v = parsed.weight;
      out[f.key] = coerceFieldValue(f.key, v);
    });
    return out;
  }

  function bolGeminiPrompt() {
    var lines = [
      'You are reading a Bill of Lading (BOL) photo for a chemical tanker truck driver (Nickey / Super D).',
      'Extract every field you can clearly read. Return ONLY valid JSON (no markdown, no explanation).',
      'Use empty string for any field you cannot read. Do not invent values.',
      '',
      'JSON shape:',
      '{',
      '  "pickupNumber": "BOL / pickup / load number (often 8–12 digits, labeled BOL, Bill of Lading, Pickup #, or Load #)",',
      '  "pickupDate": "date on the BOL as YYYY-MM-DD if possible, else the printed date",',
      '  "product": "chemical / product being hauled (e.g. Super D 500, Vigorox, Spectrum 22, hydrogen peroxide, PAA)",',
      '  "tankerWeight": "net or cargo weight in pounds if shown (digits only preferred; include lbs if that is all you see)",',
      '  "shipper": "shipper / origin facility name (NOT the consignee)",',
      '  "consignee": "consignee / delivery customer name (NOT the shipper)",',
      '  "trailerNumber": "trailer or tanker number if printed",',
      '  "originCity": "origin city and state if shown (e.g. Dillon, SC)",',
      '  "destCity": "destination city and state if shown",',
      '  "notes": "hazmat UN numbers, special instructions, or other clear remarks; else empty string"',
      '}',
      '',
      'Rules:',
      '- pickupNumber is the BOL/pickup number, not a PRO, PO, or trailer number.',
      '- product is the commodity / chemical, not the customer name.',
      '- tankerWeight is cargo/net pounds when labeled weight, net wt, or similar — not gallons.',
      '- If both gross and tare are shown, prefer net / cargo weight.'
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
   * Merge shipper/product/origin/dest into the notes box without duplicating
   * lines that are already there. Dedicated form fields are not copied here.
   */
  function composeNotes(existingNotes, fields) {
    var f = fields || {};
    var parts = [];
    var existing = String(existingNotes || '').trim();
    function alreadyHas(prefix, value) {
      if (!value) return true;
      var re = new RegExp('\\b' + prefix + '\\s*[:#]\\s*' + escapeRegExp(value), 'i');
      return re.test(existing) || parts.some(function (p) { return re.test(p); });
    }
    [['Product', f.product], ['Shipper', f.shipper], ['Origin', f.originCity], ['Dest', f.destCity]].forEach(function (pair) {
      var prefix = pair[0];
      var value = String(pair[1] || '').trim();
      if (value && !alreadyHas(prefix, value)) parts.push(prefix + ': ' + value);
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

  function matchCustomer(name, customers) {
    var cn = String(name || '').toLowerCase().trim();
    if (!cn || !customers || !customers.length) return null;
    var exact = customers.find(function (c) {
      return c && String(c.name || '').toLowerCase() === cn;
    });
    if (exact) return exact;
    var words = cn.split(/\s+/).filter(function (w) { return w.length > 3; });
    return customers.find(function (c) {
      var n = String(c.name || '').toLowerCase();
      return words.some(function (w) { return n.indexOf(w) !== -1; });
    }) || null;
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
    if (out.tankerWeight) out.tankerWeight = normalizeWeight(out.tankerWeight) || out.tankerWeight;
    return out;
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
    html += '<div style="font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;color:#ffd700;letter-spacing:1px;margin:10px 0;">REVIEW BOL FIELDS</div>';
    html += '<div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.4;">Edit anything that looks wrong, then Apply. This fills the trip form — it does not Save Record.</div>';
    BOL_FIELDS.forEach(function (meta) {
      var val = f[meta.key] || '';
      var highlight = meta.key === 'pickupNumber' && mismatch;
      html += '<div class="fld">';
      html += '<label>' + escHtml(meta.label) + '</label>';
      if (meta.key === 'notes') {
        html += '<textarea data-bol-key="' + meta.key + '" rows="3" style="width:100%;padding:10px;font-size:15px;background:#2a2a2a;color:#eee;border:1.8px solid ' +
          (highlight ? '#ffd700' : '#555') + ';border-radius:8px;">' + escHtml(val) + '</textarea>';
      } else {
        html += '<input data-bol-key="' + meta.key + '" type="text" value="' + escHtml(val) +
          '" style="width:100%;padding:12px;font-size:16px;background:#2a2a2a;color:#eee;border:1.8px solid ' +
          (highlight ? '#cc0000' : '#555') + ';border-radius:8px;' +
          (highlight ? 'box-shadow:0 0 0 2px rgba(204,0,0,0.35);' : '') + '">';
      }
      html += '</div>';
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
    emptyBolFields: emptyBolFields,
    fieldByKey: fieldByKey,
    getGeminiKey: getGeminiKey,
    setGeminiKey: setGeminiKey,
    normalizePickup: normalizePickup,
    pickupMismatch: pickupMismatch,
    normalizeDate: normalizeDate,
    normalizeWeight: normalizeWeight,
    parseBolJson: parseBolJson,
    bolGeminiPrompt: bolGeminiPrompt,
    extractBolFromImage: extractBolFromImage,
    composeNotes: composeNotes,
    matchCustomer: matchCustomer,
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
