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

/** Fixed costs live on the pay week, not on each trip. */
export const WEEKLY_MONEY_FIELDS = ["truckLease", "insurance", "ifta", "fuel", "truckWash", "otherDeduction"];

const TRIP_DEDUCT_MAP = [
  ["deductFuel", "fuel"],
  ["deductInsurance", "insurance"],
  ["deductLease", "truckLease"],
  ["deductTruckWash", "truckWash"]
];

export function emptyWeeklyTotals(payWeek = "") {
  return {
    payWeek: payWeek || "",
    truckLease: null,
    insurance: null,
    ifta: null,
    fuel: null,
    truckWash: null,
    otherDeduction: null,
    otherLabel: "",
    entered: false,
    prefilledFrom: "",
    prefill: null,
    migratedFromTrips: false,
    tripDeductionsFolded: false,
    updatedAt: ""
  };
}

function moneyOrNull(v) {
  if (v == null || v === "") return null;
  return round2(v);
}

export function normalizeWeeklyTotals(raw) {
  const w = { ...emptyWeeklyTotals(), ...(raw || {}) };
  w.payWeek = String(w.payWeek || "");
  for (const f of WEEKLY_MONEY_FIELDS) w[f] = moneyOrNull(w[f]);
  w.otherLabel = String(w.otherLabel || "");
  w.entered = Boolean(w.entered);
  w.prefilledFrom = w.prefilledFrom || "";
  w.migratedFromTrips = Boolean(w.migratedFromTrips);
  w.tripDeductionsFolded = Boolean(w.tripDeductionsFolded);
  w.updatedAt = w.updatedAt || "";
  if (w.prefill && typeof w.prefill === "object") {
    const p = { otherLabel: String(w.prefill.otherLabel || "") };
    for (const f of WEEKLY_MONEY_FIELDS) p[f] = moneyOrNull(w.prefill[f]);
    w.prefill = p;
  } else {
    w.prefill = null;
  }
  return w;
}

export function weeklyDeductTotal(w) {
  if (!w) return 0;
  return round2(WEEKLY_MONEY_FIELDS.reduce((sum, key) => sum + num(w[key]), 0));
}

export function findWeeklyTotals(weeklyTotals, sundayISO) {
  return (weeklyTotals || []).find((w) => w && w.payWeek === sundayISO) || null;
}

/** Most recent entered pay week strictly before `sundayISO`. */
export function previousWeeklyTotals(weeklyTotals, sundayISO) {
  const prior = (weeklyTotals || [])
    .filter((w) => w && w.entered && w.payWeek && w.payWeek < sundayISO)
    .sort((a, b) => b.payWeek.localeCompare(a.payWeek));
  return prior[0] || null;
}

export function prefillSnapshot(week) {
  if (!week) return null;
  const snap = { otherLabel: week.otherLabel || "" };
  for (const f of WEEKLY_MONEY_FIELDS) snap[f] = week[f] == null || week[f] === "" ? null : round2(week[f]);
  return snap;
}

/** New week starts as a copy of the last entered week. Rosa edits what changed. */
export function prefillWeeklyDraft(weeklyTotals, sundayISO) {
  const prev = previousWeeklyTotals(weeklyTotals, sundayISO);
  if (!prev) return normalizeWeeklyTotals({ payWeek: sundayISO, entered: false });
  const prefill = prefillSnapshot(prev);
  return normalizeWeeklyTotals({
    payWeek: sundayISO,
    ...prefill,
    entered: false,
    prefilledFrom: prev.payWeek,
    prefill
  });
}

export function weeklyFieldEdited(current, prefill, key) {
  if (!prefill) return false;
  if (key === "otherLabel") return String(current ?? "") !== String(prefill.otherLabel ?? "");
  const prev = prefill[key];
  const cur = current == null ? null : current;
  const prevEmpty = prev == null || prev === "";
  const curEmpty = cur == null || cur === "";
  if (prevEmpty && curEmpty) return false;
  if (prevEmpty || curEmpty) return true;
  return num(cur) !== num(prev);
}

/**
 * Gross = booked trip pay for the week (pay + detention + extra + reefer).
 * Deductions = the one weekly totals record.
 * Net = gross − deductions, only after totals are entered.
 * Trips with no weekly totals yet are pending: gross only, no net.
 */
export function weekPaySheet(trips, weeklyTotals, sundayISO) {
  const list = tripsInWeek(trips, sundayISO);
  let gross = 0;
  let booked = 0;
  for (const t of list) {
    if (!hasActuals(t)) continue;
    gross += actualTotal(t);
    booked += 1;
  }
  gross = round2(gross);
  const totals = findWeeklyTotals(weeklyTotals, sundayISO);
  const entered = Boolean(totals && totals.entered);
  const pending = list.length > 0 && !entered;
  const deductions = entered ? weeklyDeductTotal(totals) : null;
  const net = entered ? round2(gross - deductions) : null;
  return {
    gross,
    deductions,
    net,
    pending,
    entered,
    booked,
    tripCount: list.length,
    totals: totals || null
  };
}

export function tripHasStoredDeductions(t) {
  if (!t) return false;
  return TRIP_DEDUCT_MAP.some(([src]) => t[src] != null && t[src] !== "");
}

function addMoney(current, value) {
  if (value == null || value === "") return current == null || current === "" ? null : round2(current);
  return round2(num(current) + num(value));
}

/**
 * Move fixed costs off old trips onto one weekly totals record per pay week.
 * Sums whatever was stored (does not drop a number). Clears the trip fields.
 * Idempotent once trip deduction fields are null. Returns a backup of the
 * pre-migration payload when anything moved.
 */
export function migrateTripDeductions(trips, weeklyTotals, nowIso = new Date().toISOString()) {
  const list = Array.isArray(trips) ? trips : [];
  const needs = list.filter(tripHasStoredDeductions);
  if (!needs.length) {
    return { changed: false, trips: list, weeklyTotals: weeklyTotals || [], backup: null };
  }
  const backup = {
    at: nowIso,
    reason: "Move per-trip fixed deductions onto weekly totals",
    trips: JSON.parse(JSON.stringify(list)),
    weeklyTotals: JSON.parse(JSON.stringify(weeklyTotals || []))
  };
  const sums = new Map();
  for (const t of needs) {
    const week = t.payWeek || startOfPayWeek(t.tripDate);
    if (!week) continue;
    if (!sums.has(week)) sums.set(week, { fuel: null, insurance: null, truckLease: null, truckWash: null });
    const row = sums.get(week);
    for (const [src, dest] of TRIP_DEDUCT_MAP) {
      if (t[src] != null && t[src] !== "") row[dest] = addMoney(row[dest], t[src]);
    }
  }
  const byWeek = new Map((weeklyTotals || []).map((w) => [w.payWeek, { ...w }]));
  for (const [week, sum] of sums) {
    const existing = byWeek.get(week);
    if (existing && existing.tripDeductionsFolded) continue;
    if (existing && existing.entered) {
      const folded = {
        ...existing,
        tripDeductionsFolded: true,
        updatedAt: nowIso
      };
      for (const key of ["fuel", "insurance", "truckLease", "truckWash"]) {
        if (sum[key] == null) continue;
        folded[key] = addMoney(existing[key], sum[key]);
      }
      byWeek.set(week, folded);
    } else {
      byWeek.set(week, {
        ...emptyWeeklyTotals(week),
        fuel: sum.fuel,
        insurance: sum.insurance,
        truckLease: sum.truckLease,
        truckWash: sum.truckWash,
        ifta: existing && existing.ifta != null ? existing.ifta : null,
        otherDeduction: existing && existing.otherDeduction != null ? existing.otherDeduction : null,
        otherLabel: existing ? (existing.otherLabel || "") : "",
        entered: true,
        migratedFromTrips: true,
        tripDeductionsFolded: true,
        updatedAt: nowIso
      });
    }
  }
  const nextTrips = list.map((t) => {
    if (!tripHasStoredDeductions(t)) return t;
    return {
      ...t,
      deductFuel: null,
      deductInsurance: null,
      deductLease: null,
      deductTruckWash: null
    };
  });
  const nextWeeks = [...byWeek.values()].sort((a, b) => String(a.payWeek).localeCompare(String(b.payWeek)));
  return { changed: true, trips: nextTrips, weeklyTotals: nextWeeks, backup };
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
  let running = 0;
  let actualCount = 0;
  for (const t of list) {
    const e = estTotal(t);
    est += e;
    if (hasActuals(t)) {
      const a = actualTotal(t);
      actual += a;
      running += a;
      actualCount += 1;
    } else {
      running += e;
    }
  }
  return {
    est: round2(est),
    actual: round2(actual),
    running: round2(running),
    actualCount,
    tripCount: list.length
  };
}

/** Weekly totals whose Sunday falls in `year` (money-out is dated by pay week, not trip). */
export function weeklyTotalsInYear(weeklyTotals, year) {
  const y = Number(year);
  return (weeklyTotals || []).filter((w) => {
    if (!w || !w.payWeek) return false;
    const d = parseISODate(w.payWeek);
    return Boolean(d) && d.getFullYear() === y;
  });
}

export function pnlForYear(trips, year, weeklyTotals = []) {
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
  }
  for (const w of weeklyTotalsInYear(weeklyTotals, year)) {
    if (!w.entered) continue;
    const d = parseISODate(w.payWeek);
    if (!d) continue;
    months[d.getMonth()].moneyOut += weeklyDeductTotal(w);
  }
  const ytdIn = round2(months.reduce((s, m) => s + m.moneyIn, 0));
  const ytdOut = round2(months.reduce((s, m) => s + m.moneyOut, 0));
  const ytdEst = round2(months.reduce((s, m) => s + m.estIn, 0));
  return { months, ytdIn, ytdOut, ytdEst, net: round2(ytdIn - ytdOut), tripCount: list.length };
}

export function weeklyExportRows(weeklyTotals) {
  const header = [
    "payWeek", "weekEnding", "truckLease", "insurance", "ifta", "fuel", "truckWash",
    "otherLabel", "otherDeduction", "deductions", "entered"
  ];
  const rows = [header];
  const sorted = [...(weeklyTotals || [])]
    .filter((w) => w && w.payWeek)
    .sort((a, b) => a.payWeek.localeCompare(b.payWeek));
  for (const raw of sorted) {
    const w = normalizeWeeklyTotals(raw);
    rows.push([
      w.payWeek,
      endOfPayWeek(w.payWeek) || "",
      w.truckLease ?? "",
      w.insurance ?? "",
      w.ifta ?? "",
      w.fuel ?? "",
      w.truckWash ?? "",
      w.otherLabel || "",
      w.otherDeduction ?? "",
      w.entered ? weeklyDeductTotal(w) : "",
      w.entered ? "Y" : "N"
    ]);
  }
  return rows;
}

export function exportRows(trips, weeklyTotals) {
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
  if (weeklyTotals) {
    rows.push([]);
    rows.push(["Weekly totals"]);
    for (const line of weeklyExportRows(weeklyTotals)) rows.push(line);
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
