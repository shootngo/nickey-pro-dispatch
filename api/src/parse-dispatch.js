/* =============================================================================
 * Nickey Bot — dispatch-text parser
 * Heuristic first (Daniel Kline SMS and similar). Optional Gemini fill-in
 * when GEMINI_API_KEY is set. JSON shape matches Paste Dispatch in index.html:
 *   pickupDate, pickupNumber, customer, basePay, trailerNumber, highLimit, notes
 * ============================================================================= */

export const DISPATCH_KEYS = [
  'pickupDate',
  'pickupNumber',
  'customer',
  'basePay',
  'trailerNumber',
  'highLimit',
  'notes'
];

export const DANIEL_SMS_SAMPLE = [
  'Dillon, SC',
  'pu# 3012874535',
  'Friday at 9am',
  'Pays you around. 4385.00'
].join('\n');

export const DANIEL_SMS_ORIGINAL = [
  'Dillon, sc pu# 3012874535.',
  'Delivers Friday at 9am.',
  '',
  'Pays you around. 4385.00'
].join('\n');

const WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

export function emptyDispatch() {
  return {
    pickupDate: '',
    pickupNumber: '',
    customer: '',
    basePay: null,
    trailerNumber: '',
    highLimit: null,
    notes: ''
  };
}

export function isEmptyField(value) {
  if (value == null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && !Number.isFinite(value)) return true;
  return false;
}

export function normalizePickup(value) {
  if (value == null) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits;
}

export function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[$,]/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function titleCaseCity(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .map(function (w) {
      if (!w) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Heuristic parser for Daniel-style SMS and common dispatch snippets.
 * Does not invent a calendar date from weekday-only text ("Friday at 9am")
 * — that goes into notes.
 */
export function parseDispatchText(text) {
  const result = emptyDispatch();
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return result;

  const pu =
    raw.match(/\bpu(?:ckup)?\s*#?\s*[:#]?\s*(\d{6,12})\b/i) ||
    raw.match(/\b(?:pickup|bol|load)\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d{6,12})\b/i) ||
    raw.match(/\b(\d{10})\b/);
  if (pu) result.pickupNumber = pu[1];

  const pay =
    raw.match(/pays?\s+(?:you\s+)?(?:around\.?\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    raw.match(/\b(?:pay|rate|base\s*pay)\s*[:#]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    raw.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (pay) result.basePay = parseMoney(pay[1]);

  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const us = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (iso) {
    result.pickupDate = iso[1];
  } else if (us) {
    result.pickupDate = us[3] + '-' + pad2(us[1]) + '-' + pad2(us[2]);
  }

  const loc = raw.match(/\b([A-Za-z][A-Za-z .'-]+),\s*([A-Za-z]{2})\b/);
  const delivers = raw.match(/delivers?\s+([^\n.]+)/i);
  const weekdayTime = raw.match(
    new RegExp('\\b(' + WEEKDAYS + ')\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?', 'i')
  );

  const trailer = raw.match(
    /\b(?:trailer|tanker)\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{0,20})/i
  );
  if (trailer) result.trailerNumber = trailer[1].trim();

  const high = raw.match(/\b(?:high\s*limit|tank\s*limit)\s*[:#]?\s*(\d{3,5})\b/i);
  if (high) result.highLimit = parseInt(high[1], 10);

  const customer = raw.match(/^\s*customer\s*[:#]\s*(.+)$/im);
  if (customer) result.customer = customer[1].trim();

  const noteParts = [];
  if (loc) {
    noteParts.push(titleCaseCity(loc[1]) + ', ' + loc[2].toUpperCase());
  }
  if (delivers) {
    noteParts.push('Delivers ' + delivers[1].trim());
  } else if (weekdayTime) {
    noteParts.push(weekdayTime[0].replace(/\s+/g, ' ').trim());
  }

  const extra = raw.match(/^\s*notes?\s*[:#]\s*(.+)$/im);
  if (extra) noteParts.push(extra[1].trim());

  result.notes = noteParts.join(' — ');
  return result;
}

export function mergeDispatch(base, extra) {
  const out = Object.assign(emptyDispatch(), base || {});
  const add = extra || {};
  DISPATCH_KEYS.forEach(function (key) {
    if (isEmptyField(out[key]) && !isEmptyField(add[key])) {
      out[key] = add[key];
    }
  });
  if (out.basePay != null) out.basePay = parseMoney(out.basePay);
  if (out.highLimit != null && out.highLimit !== '') {
    const hl = parseFloat(out.highLimit);
    out.highLimit = Number.isFinite(hl) ? hl : null;
  }
  if (out.pickupNumber) out.pickupNumber = String(out.pickupNumber).trim();
  return out;
}

const GEMINI_PROMPT_PREFIX =
  'You are extracting dispatch data for a chemical tanker truck driver. ' +
  'Extract fields from this dispatch text and return JSON only.\n\nDispatch text:\n';

const GEMINI_PROMPT_SUFFIX =
  '\n\nReturn this exact JSON:\n' +
  '{\n' +
  '  "pickupDate": "YYYY-MM-DD or empty string",\n' +
  '  "pickupNumber": "BOL or load/pickup number (usually 10 digits)",\n' +
  '  "customer": "delivery destination name only — NOT the shipper or origin facility",\n' +
  '  "basePay": number or null,\n' +
  '  "trailerNumber": "tanker or trailer number if present",\n' +
  '  "highLimit": number or null,\n' +
  '  "notes": "special instructions or empty string"\n' +
  '}\nReturn only valid JSON.';

export function geminiDispatchPrompt(text) {
  return GEMINI_PROMPT_PREFIX + text + GEMINI_PROMPT_SUFFIX;
}

export async function parseWithGemini(text, apiKey, fetchFn) {
  const fetchImpl = fetchFn || globalThis.fetch;
  if (!apiKey || !fetchImpl) return null;
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
    encodeURIComponent(apiKey);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: geminiDispatchPrompt(text) }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) {
    let detail = 'API error ' + res.status;
    try {
      const err = await res.json();
      if (err && err.error && err.error.message) detail = err.error.message;
    } catch (e) { /* ignore */ }
    throw new Error(detail);
  }
  const data = await res.json();
  const raw = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!raw) throw new Error('No response from AI.');
  const parsed = JSON.parse(raw);
  return mergeDispatch(emptyDispatch(), parsed);
}

/**
 * Run heuristic always. If apiKey is set, try Gemini and fill empty fields.
 * Gemini failures do not fail the request — heuristic result is kept.
 */
export async function parseDispatchTextFull(text, options) {
  const opts = options || {};
  const heuristic = parseDispatchText(text);
  let gemini = null;
  let geminiError = null;
  if (opts.geminiApiKey) {
    try {
      gemini = await parseWithGemini(text, opts.geminiApiKey, opts.fetch);
    } catch (err) {
      geminiError = err && err.message ? err.message : String(err);
    }
  }
  const dispatch = gemini ? mergeDispatch(heuristic, gemini) : heuristic;
  let parser = 'heuristic';
  if (gemini) parser = 'heuristic+gemini';
  return { dispatch, heuristic, gemini, parser, geminiError };
}
