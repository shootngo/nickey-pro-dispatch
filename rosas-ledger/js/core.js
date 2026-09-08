/**
 * Rosa's Ledger — dates, money, variance, and the trip contract helpers.
 * Pay weeks are Sunday–Saturday, keyed by the Sunday ISO date.
 */

export function num(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function money(v, { signed = false } = {}) {
  const n = num(v);
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed) {
    if (n > 0) return "+$" + abs;
    if (n < 0) return "-$" + abs;
    return "$" + abs;
  }
  return (n < 0 ? "-$" : "$") + abs;
}

export function parseISODate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Sunday (inclusive) of the Sun–Sat pay week containing `date`. */
export function startOfPayWeek(date) {
  const d = typeof date === "string" ? parseISODate(date) : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (!d) return null;
  d.setDate(d.getDate() - d.getDay());
  return toISODate(d);
}

export function endOfPayWeek(sundayISO) {
  const d = parseISODate(sundayISO);
  if (!d) return null;
  d.setDate(d.getDate() + 6);
  return toISODate(d);
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function payWeekDays(sundayISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(sundayISO, i));
}

/** 0/1 shading key so adjacent Sun–Sat weeks alternate. */
export function weekShade(sundayISO) {
  const d = parseISODate(sundayISO);
  if (!d) return 0;
  const epoch = parseISODate("2020-01-05"); // a Sunday
  const days = Math.round((d.getTime() - epoch.getTime()) / 86400000);
  return ((Math.floor(days / 7) % 2) + 2) % 2;
}

export function monthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function shortMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "short" });
}

export function formatLongDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

export function formatWeekRange(sundayISO) {
  const start = parseISODate(sundayISO);
  const end = parseISODate(endOfPayWeek(sundayISO));
  if (!start || !end) return sundayISO;
  const sameMonth = start.getMonth() === end.getMonth();
  const left = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const right = end.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left}–${right}`;
}

export function weekdayShort(iso) {
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase() : "";
}

export function estTotal(t) {
  return num(t.estLinehaul) + num(t.estDetention) + num(t.estExtraPay) + num(t.estReeferFuel);
}

export function actualTotal(t) {
  if (!hasActuals(t)) return null;
  return num(t.actualPay) + num(t.actualDetention) + num(t.actualExtra) + num(t.actualReefer);
}

export function deductTotal(t) {
  return num(t.deductFuel) + num(t.deductInsurance) + num(t.deductLease) + num(t.deductTruckWash);
}

export function hasActuals(t) {
  return t.actualPay != null || t.actualDetention != null || t.actualExtra != null || t.actualReefer != null;
}

export function varianceOf(t) {
  const actual = actualTotal(t);
  if (actual == null) return null;
  return round2(actual - estTotal(t));
}

export function isFlagged(t, tolerance) {
  const v = varianceOf(t);
  if (v == null) return false;
  return Math.abs(v) > num(tolerance);
}

export function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

export function tripNet(t) {
  const income = actualTotal(t);
  const inAmt = income == null ? estTotal(t) : income;
  return round2(inAmt - deductTotal(t));
}

export function applyVariance(t, tolerance) {
  const variance = varianceOf(t);
  const flagged = isFlagged(t, tolerance);
  return { ...t, variance, flagged };
}

/**
 * Prefill lease / truck wash from the most recent earlier trip that has a value.
 * Returns { value, fromTripId } or { value: null, fromTripId: null }.
 */
export function lastDeduction(trips, field, beforeDate, excludeId) {
  const prior = (trips || [])
    .filter((t) => t && t.id !== excludeId && t.tripDate && t.tripDate <= beforeDate)
    .filter((t) => t[field] != null && t[field] !== "")
    .sort((a, b) => {
      const dc = b.tripDate.localeCompare(a.tripDate);
      if (dc) return dc;
      return String(b.pushedAt || "").localeCompare(String(a.pushedAt || ""));
    });
  if (!prior.length) return { value: null, fromTripId: null };
  return { value: num(prior[0][field]), fromTripId: prior[0].id };
}

export function emptyTrip() {
  return {
    id: "",
    tripDate: "",
    payWeek: "",
    pushedAt: "",
    shipper: "",
    consignee: "",
    originCity: "",
    destCity: "",
    estLinehaul: 0,
    estDetention: 0,
    estExtraPay: 0,
    estReeferFuel: 0,
    odometerIn: null,
    odometerOut: null,
    miles: 0,
    costPerMile: 0,
    actualPay: null,
    actualDetention: null,
    actualExtra: null,
    actualReefer: null,
    deductFuel: null,
    deductInsurance: null,
    deductLease: null,
    deductTruckWash: null,
    flagged: false,
    variance: null,
    notes: []
  };
}

export function normalizeTrip(raw, tolerance = 25) {
  const t = { ...emptyTrip(), ...(raw || {}) };
  t.id = String(t.id || "");
  t.tripDate = t.tripDate || "";
  t.payWeek = t.payWeek || (t.tripDate ? startOfPayWeek(t.tripDate) : "");
  t.notes = Array.isArray(t.notes) ? t.notes : [];
  const miles = num(t.miles);
  if (!t.costPerMile && miles > 0) t.costPerMile = round2(num(t.estLinehaul) / miles);
  if (t.odometerIn != null && t.odometerOut != null && !miles) {
    t.miles = round2(num(t.odometerOut) - num(t.odometerIn));
  }
  return applyVariance(t, tolerance);
}

/** Map a Nickey `saveRecord()` object onto the Rosa trip contract (estimates only). */
export function fromNickeyRecord(rec, now = new Date()) {
  const tripDate = rec.date || rec.pickupDate || rec.tripDate || "";
  const notes = [];
  if (rec.notes && typeof rec.notes === "string" && rec.notes.trim()) {
    notes.push({ text: rec.notes.trim(), author: "Frank", timestamp: rec.timestamp || now.toISOString() });
  }
  if (Array.isArray(rec.rosaNotes)) notes.push(...rec.rosaNotes);
  const miles = num(rec.miles);
  const estLinehaul = rec.estLinehaul != null ? num(rec.estLinehaul) : num(rec.basePay);
  return normalizeTrip({
    id: rec.id || rec.pickup || ("TRP-" + Date.now()),
    tripDate,
    payWeek: tripDate ? startOfPayWeek(tripDate) : "",
    pushedAt: rec.pushedAt || rec.updatedAt || rec.timestamp || now.toISOString(),
    shipper: rec.shipper || "",
    consignee: rec.consignee || rec.customer || "",
    originCity: rec.originCity || "",
    destCity: rec.destCity || "",
    estLinehaul,
    estDetention: rec.estDetention != null ? num(rec.estDetention) : 0,
    estExtraPay: rec.estExtraPay != null ? num(rec.estExtraPay) : 0,
    estReeferFuel: rec.estReeferFuel != null ? num(rec.estReeferFuel) : 0,
    odometerIn: rec.odometerIn != null ? num(rec.odometerIn) : null,
    odometerOut: rec.odometerOut != null ? num(rec.odometerOut) : null,
    miles,
    costPerMile: rec.costPerMile != null ? num(rec.costPerMile) : (miles > 0 ? round2(estLinehaul / miles) : 0),
    notes
  });
}

export function tripsOnDay(trips, iso) {
  return (trips || []).filter((t) => t.tripDate === iso);
}

export function tripsInWeek(trips, sundayISO) {
  return (trips || []).filter((t) => (t.payWeek || startOfPayWeek(t.tripDate)) === sundayISO)
    .sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.id.localeCompare(b.id));
}

export function tripsInMonth(trips, year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return (trips || []).filter((t) => (t.tripDate || "").startsWith(prefix));
}

export function tripsInYear(trips, year) {
  const prefix = String(year) + "-";
  return (trips || []).filter((t) => (t.tripDate || "").startsWith(prefix));
}

export function weekRunningTotal(trips, sundayISO) {
  const list = tripsInWeek(trips, sundayISO);
  let est = 0;
  let actual = 0;
  let actualCount = 0;
  for (const t of list) {
    est += estTotal(t);
    if (hasActuals(t)) {
      actual += actualTotal(t);
      actualCount += 1;
    }
  }
  return { est: round2(est), actual: round2(actual), actualCount, tripCount: list.length };
}

export function pnlForYear(trips, year) {
  const list = tripsInYear(trips, year);
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    moneyIn: 0,
    moneyOut: 0,
    estIn: 0,
    trips: 0,
    flagged: 0
  }));
  for (const t of list) {
    const d = parseISODate(t.tripDate);
    if (!d) continue;
    const row = months[d.getMonth()];
    row.trips += 1;
    if (t.flagged) row.flagged += 1;
    const booked = actualTotal(t);
    row.estIn += estTotal(t);
    row.moneyIn += booked == null ? 0 : booked;
    row.moneyOut += deductTotal(t);
  }
  const ytdIn = round2(months.reduce((s, m) => s + m.moneyIn, 0));
  const ytdOut = round2(months.reduce((s, m) => s + m.moneyOut, 0));
  const ytdEst = round2(months.reduce((s, m) => s + m.estIn, 0));
  return { months, ytdIn, ytdOut, ytdEst, net: round2(ytdIn - ytdOut), tripCount: list.length };
}

export function exportRows(trips) {
  const header = [
    "id", "tripDate", "payWeek", "pushedAt",
    "shipper", "consignee", "originCity", "destCity",
    "estLinehaul", "estDetention", "estExtraPay", "estReeferFuel",
    "odometerIn", "odometerOut", "miles", "costPerMile",
    "actualPay", "actualDetention", "actualExtra", "actualReefer",
    "deductFuel", "deductInsurance", "deductLease", "deductTruckWash",
    "flagged", "variance", "notes"
  ];
  const rows = [header];
  const sorted = [...(trips || [])].sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    rows.push(header.map((key) => {
      if (key === "notes") {
        return (t.notes || []).map((n) => `[${n.author || ""} ${n.timestamp || ""}] ${n.text || ""}`).join(" | ");
      }
      const v = t[key];
      if (v == null) return "";
      if (typeof v === "boolean") return v ? "Y" : "N";
      return v;
    }));
  }
  return rows;
}

export function toCsv(rows) {
  return rows.map((r) => r.map((cell) => {
    const s = String(cell ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",")).join("\r\n");
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function lane(t) {
  const cities = [t.originCity, t.destCity].filter(Boolean).join(" → ");
  const parties = [t.shipper, t.consignee].filter(Boolean).join(" → ");
  return { cities, parties };
}
