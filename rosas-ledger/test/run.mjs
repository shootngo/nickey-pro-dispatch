import { strict as assert } from "node:assert";
import {
  addDays, applyVariance, endOfPayWeek, estTotal, exportRows, fromNickeyRecord,
  hasActuals, isFlagged, lastDeduction, migrateTripDeductions, money, normalizeTrip, num, parseISODate,
  pnlForYear, prefillWeeklyDraft, startOfPayWeek, toCsv, toISODate, tripsInWeek, tripsOnDay, varianceOf,
  weekPaySheet, weekRunningTotal, weekShade, weeklyFieldEdited
} from "../js/core.js";
import { getDemoTrips, getDemoWeeklyTotals } from "../js/demo-data.js";
import { buildXlsx } from "../js/xlsx-lite.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok", name);
}

test("pay week is Sunday–Saturday of tripDate", () => {
  // Tuesday 8 Sep 2026 → Sunday 6 Sep 2026 through Saturday 12 Sep 2026
  assert.equal(startOfPayWeek("2026-09-08"), "2026-09-06");
  assert.equal(endOfPayWeek("2026-09-06"), "2026-09-12");
  assert.equal(startOfPayWeek("2026-09-06"), "2026-09-06");
  assert.equal(startOfPayWeek("2026-09-12"), "2026-09-06");
});

test("pay week can span two calendar months", () => {
  // Tuesday 1 Sep 2026 → week of Sun Aug 30 – Sat Sep 5
  assert.equal(startOfPayWeek("2026-09-01"), "2026-08-30");
  assert.equal(endOfPayWeek("2026-08-30"), "2026-09-05");
});

test("addDays and ISO round-trip stay local (no UTC shift)", () => {
  assert.equal(addDays("2026-09-08", 1), "2026-09-09");
  const d = parseISODate("2026-09-08");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 8);
  assert.equal(toISODate(d), "2026-09-08");
});

test("adjacent weeks alternate shade keys", () => {
  const a = weekShade("2026-09-06");
  const b = weekShade("2026-09-13");
  assert.equal(a === 0 || a === 1, true);
  assert.equal(b, a ^ 1);
});

test("variance flags only amounts outside the band", () => {
  const t = {
    estLinehaul: 1000, estDetention: 50, estExtraPay: 0, estReeferFuel: 0,
    actualPay: 1000, actualDetention: 60, actualExtra: 0, actualReefer: 0
  };
  assert.equal(estTotal(t), 1050);
  assert.equal(varianceOf(t), 10);
  assert.equal(isFlagged(t, 25), false);
  const wide = applyVariance({ ...t, actualPay: 900 }, 25);
  assert.equal(wide.variance, -90);
  assert.equal(wide.flagged, true);
  assert.equal(hasActuals({ actualPay: null }), false);
  assert.equal(isFlagged({ ...t, actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null }, 25), false);
});

test("lease / truck wash prefill from last earlier entry", () => {
  const trips = [
    { id: "a", tripDate: "2026-09-01", deductLease: 450, deductTruckWash: 35, pushedAt: "1" },
    { id: "b", tripDate: "2026-09-04", deductLease: 475, deductTruckWash: 50, pushedAt: "2" },
    { id: "c", tripDate: "2026-09-08", deductLease: null, deductTruckWash: null, pushedAt: "3" }
  ];
  assert.equal(lastDeduction(trips, "deductLease", "2026-09-08", "c").value, 475);
  assert.equal(lastDeduction(trips, "deductTruckWash", "2026-09-08", "c").fromTripId, "b");
  assert.equal(lastDeduction(trips, "deductLease", "2026-09-01", "a").value, null);
});

test("Nickey saveRecord maps onto the Rosa estimate contract", () => {
  const t = fromNickeyRecord({
    id: "REC-1",
    date: "2026-09-08",
    customer: "Kroger DC",
    basePay: 1240,
    notes: "Pushed from Nickey",
    timestamp: "2026-09-08T10:22:00.000Z",
    estDetention: 80,
    originCity: "Chicago, IL",
    destCity: "Indianapolis, IN"
  });
  assert.equal(t.tripDate, "2026-09-08");
  assert.equal(t.payWeek, "2026-09-06");
  assert.equal(t.consignee, "Kroger DC");
  assert.equal(t.estLinehaul, 1240);
  assert.equal(t.estDetention, 80);
  assert.equal(t.notes[0].author, "Frank");
  assert.equal(t.actualPay, null);
});

test("CSV escapes commas and quotes", () => {
  const csv = toCsv(exportRows([{
    id: 'TRP-1', tripDate: '2026-09-08', payWeek: '2026-09-06', pushedAt: '',
    shipper: 'A, Inc', consignee: 'B', originCity: '', destCity: '',
    estLinehaul: 1, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
    odometerIn: null, odometerOut: null, miles: 0, costPerMile: 0,
    actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null,
    deductFuel: null, deductInsurance: null, deductLease: null, deductTruckWash: null,
    flagged: false, variance: null,
    notes: [{ text: 'He said "short pay"', author: "Rosa", timestamp: "t" }]
  }]));
  assert.equal(csv.includes('"A, Inc"'), true);
  assert.equal(csv.includes('""short pay""'), true);
  assert.equal(csv.startsWith("id,tripDate,payWeek"), true);
});

test("demo trips include flagged rows and open actuals for Sep 8 2026", () => {
  const trips = getDemoTrips(25);
  const today = trips.find((t) => t.id === "TRP-20260908-001");
  assert.ok(today);
  assert.equal(today.payWeek, "2026-09-06");
  assert.equal(hasActuals(today), false);
  const flagged = trips.filter((t) => t.flagged);
  assert.ok(flagged.length >= 2, "expected sample flagged trips");
  assert.ok(trips.some((t) => t.tripDate.startsWith("2025-")), "year export needs a prior year");
});

test("xlsx builder returns a ZIP (PK) blob", async () => {
  const blob = buildXlsx([{ name: "Trips", rows: [["id", "pay"], ["A", 1]] }]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
  assert.ok(blob.size > 100);
});

test("running weekly total mixes booked actuals with remaining estimates", () => {
  const trips = [
    {
      id: "1", tripDate: "2026-09-08", payWeek: "2026-09-06",
      estLinehaul: 100, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
      actualPay: 110, actualDetention: 0, actualExtra: 0, actualReefer: 0
    },
    {
      id: "2", tripDate: "2026-09-09", payWeek: "2026-09-06",
      estLinehaul: 50, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
      actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null
    }
  ];
  const r = weekRunningTotal(trips, "2026-09-06");
  assert.equal(r.est, 150);
  assert.equal(r.actual, 110);
  assert.equal(r.running, 160);
  assert.equal(r.actualCount, 1);
  assert.equal(r.tripCount, 2);
});

test("money formatting", () => {
  assert.equal(money(1240), "$1,240.00");
  assert.equal(money(-35, { signed: true }), "-$35.00");
  assert.equal(money(10, { signed: true }), "+$10.00");
  assert.equal(num("$1,240.50"), 1240.5);
});

test("Nickey Firestore push docs appear on tripDate / payWeek after normalize", () => {
  const t = normalizeTrip({
    id: "3012865610",
    tripDate: "2026-09-08",
    payWeek: "2026-09-06",
    pickup: "3012865610",
    consignee: "V.I.J.O.N. Smyrna Tennessee",
    destCity: "Smyrna, TN",
    shipper: "Evonik / Harcros, Memphis TN",
    estLinehaul: 0,
    estDetention: 0,
    estExtraPay: 0,
    estReeferFuel: 0,
    odometerIn: 0,
    odometerOut: 0,
    miles: 0,
    costPerMile: 0,
    source: "nickey",
    notes: [{ text: "BOL", author: "Frank", timestamp: "2026-09-08T15:39:13.779Z" }]
  });
  assert.equal(t.id, "3012865610");
  assert.equal(t.tripDate, "2026-09-08");
  assert.equal(t.payWeek, "2026-09-06");
  assert.equal(t.consignee, "V.I.J.O.N. Smyrna Tennessee");
  assert.equal(tripsOnDay([t], "2026-09-08").length, 1);
  assert.equal(tripsInWeek([t], "2026-09-06").length, 1);
  assert.equal(tripsOnDay([t], "2026-09-07").length, 0);
});

test("tolerance band compares per-trip pay only", () => {
  const base = {
    estLinehaul: 1000, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
    actualPay: 1000, actualDetention: 0, actualExtra: 0, actualReefer: 0
  };
  const withDeductions = {
    ...base,
    deductFuel: 500, deductInsurance: 85, deductLease: 450, deductTruckWash: 35
  };
  assert.equal(varianceOf(withDeductions), varianceOf(base));
  assert.equal(varianceOf(withDeductions), 0);
  assert.equal(isFlagged(withDeductions, 25), false);
});

test("three trips in one week: gross, weekly deductions, net", () => {
  // Sun Sep 13 2026 – Sat Sep 19 2026. Saturday stays in this week.
  const trips = [
    { id: "a", tripDate: "2026-09-15", payWeek: "2026-09-13", actualPay: 1000, actualDetention: 50, actualExtra: 0, actualReefer: 25 },
    { id: "b", tripDate: "2026-09-16", payWeek: "2026-09-13", actualPay: 800, actualDetention: 0, actualExtra: 40, actualReefer: 0 },
    { id: "c", tripDate: "2026-09-19", payWeek: "2026-09-13", actualPay: 600, actualDetention: 100, actualExtra: 0, actualReefer: 30 }
  ];
  const weeks = [{
    payWeek: "2026-09-13",
    truckLease: 450, insurance: 85, ifta: 22, fuel: 310, truckWash: 35,
    otherDeduction: 18, otherLabel: "Toll", entered: true
  }];
  assert.equal(startOfPayWeek("2026-09-19"), "2026-09-13");
  const sheet = weekPaySheet(trips, weeks, "2026-09-13");
  assert.equal(sheet.gross, 2645);
  assert.equal(sheet.deductions, 920);
  assert.equal(sheet.net, 1725);
  assert.equal(sheet.pending, false);
  assert.equal(sheet.tripCount, 3);
});

test("week with trips and no totals is pending: gross only, no net", () => {
  const trips = [
    { id: "a", tripDate: "2026-09-15", payWeek: "2026-09-13", actualPay: 1000, actualDetention: 0, actualExtra: 0, actualReefer: 0 }
  ];
  const sheet = weekPaySheet(trips, [], "2026-09-13");
  assert.equal(sheet.pending, true);
  assert.equal(sheet.gross, 1000);
  assert.equal(sheet.deductions, null);
  assert.equal(sheet.net, null);
  const empty = weekPaySheet([], [], "2026-09-13");
  assert.equal(empty.pending, false);
});

test("new weekly totals prefill from the previous entered week and highlight edits", () => {
  const weeks = [
    { payWeek: "2026-09-06", truckLease: 450, insurance: 85, ifta: 22, fuel: 300, truckWash: 35, otherDeduction: 10, otherLabel: "Scales", entered: true },
    { payWeek: "2026-08-30", truckLease: 400, insurance: 80, ifta: 20, fuel: 250, truckWash: 30, otherDeduction: null, otherLabel: "", entered: true }
  ];
  const draft = prefillWeeklyDraft(weeks, "2026-09-13");
  assert.equal(draft.prefilledFrom, "2026-09-06");
  assert.equal(draft.truckLease, 450);
  assert.equal(draft.otherLabel, "Scales");
  assert.equal(draft.entered, false);
  assert.equal(weeklyFieldEdited(draft.truckLease, draft.prefill, "truckLease"), false);
  assert.equal(weeklyFieldEdited(475, draft.prefill, "truckLease"), true);
  assert.equal(weeklyFieldEdited("Toll", draft.prefill, "otherLabel"), true);
});

test("migration sums old per-trip deductions onto the pay week, clears trips, and keeps a backup", () => {
  const trips = [
    { id: "a", tripDate: "2026-09-08", payWeek: "2026-09-06", deductFuel: 100, deductInsurance: 85, deductLease: 450, deductTruckWash: 35, actualPay: 500 },
    { id: "b", tripDate: "2026-09-09", payWeek: "2026-09-06", deductFuel: 50, deductInsurance: 85, deductLease: 450, deductTruckWash: 0, actualPay: 400 },
    { id: "c", tripDate: "2026-09-11", payWeek: "2026-09-06", deductFuel: null, deductInsurance: null, deductLease: null, deductTruckWash: null, actualPay: 300 },
    { id: "d", tripDate: "2026-09-15", payWeek: "2026-09-13", deductFuel: null, deductInsurance: null, deductLease: 475, deductTruckWash: null, actualPay: 200 }
  ];
  const first = migrateTripDeductions(trips, [], "2026-09-22T00:00:00.000Z");
  assert.equal(first.changed, true);
  assert.equal(first.backup.trips[0].deductFuel, 100);
  assert.equal(first.backup.trips.length, 4);
  const week1 = first.weeklyTotals.find((w) => w.payWeek === "2026-09-06");
  const week2 = first.weeklyTotals.find((w) => w.payWeek === "2026-09-13");
  assert.equal(week1.fuel, 150);
  assert.equal(week1.insurance, 170);
  assert.equal(week1.truckLease, 900);
  assert.equal(week1.truckWash, 35);
  assert.equal(week1.entered, true);
  assert.equal(week2.truckLease, 475);
  assert.equal(week2.fuel, null);
  for (const t of first.trips) {
    assert.equal(t.deductFuel, null);
    assert.equal(t.deductInsurance, null);
    assert.equal(t.deductLease, null);
    assert.equal(t.deductTruckWash, null);
  }
  assert.equal(first.trips[0].actualPay, 500);
  const again = migrateTripDeductions(first.trips, first.weeklyTotals, "2026-09-22T01:00:00.000Z");
  assert.equal(again.changed, false);
  const crashed = migrateTripDeductions(trips, first.weeklyTotals, "2026-09-22T02:00:00.000Z");
  const againWeek = crashed.weeklyTotals.find((w) => w.payWeek === "2026-09-06");
  assert.equal(againWeek.truckLease, 900);
  assert.equal(crashed.trips[0].deductLease, null);
});

test("money-out on the year chart comes from weekly totals", () => {
  const trips = [{
    id: "a", tripDate: "2026-09-08", payWeek: "2026-09-06",
    estLinehaul: 100, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
    actualPay: 100, actualDetention: 0, actualExtra: 0, actualReefer: 0,
    deductFuel: 999, deductLease: 999
  }];
  const weeks = [{
    payWeek: "2026-09-06", entered: true,
    truckLease: 10, insurance: 0, ifta: 0, fuel: 30, truckWash: 0, otherDeduction: 0
  }];
  const pnl = pnlForYear(trips, 2026, weeks);
  assert.equal(pnl.months[8].moneyIn, 100);
  assert.equal(pnl.months[8].moneyOut, 40);
  assert.equal(pnl.ytdOut, 40);
  const pending = pnlForYear(trips, 2026, [{ payWeek: "2026-09-06", entered: false, fuel: 30 }]);
  assert.equal(pending.ytdOut, 0);
});

test("year export keeps one row per trip and a weekly totals section", () => {
  const trips = [{
    id: "TRP-1", tripDate: "2026-09-08", payWeek: "2026-09-06",
    shipper: "Cargill", consignee: "Kroger", originCity: "Chicago, IL", destCity: "Indianapolis, IN",
    estLinehaul: 1, estDetention: 0, estExtraPay: 0, estReeferFuel: 0,
    actualPay: 1000, actualDetention: 50, actualExtra: 0, actualReefer: 25,
    deductFuel: null, deductInsurance: null, deductLease: null, deductTruckWash: null,
    flagged: false, variance: 0,
    notes: [{ text: "Checked the sheet", author: "Rosa", timestamp: "2026-09-10T12:00:00.000Z" }]
  }];
  const weeks = [{
    payWeek: "2026-09-06", entered: true,
    truckLease: 450, insurance: 85, ifta: 22, fuel: 310, truckWash: 35,
    otherLabel: "Toll", otherDeduction: 18
  }];
  const csv = toCsv(exportRows(trips, weeks));
  assert.equal(csv.startsWith("id,tripDate,payWeek"), true);
  assert.equal(csv.includes("TRP-1"), true);
  assert.equal(csv.includes("Weekly totals"), true);
  assert.equal(csv.includes("2026-09-06"), true);
  assert.equal(csv.includes("Rosa"), true);
  assert.equal(csv.includes("Toll"), true);
});

test("demo keeps a pending week with gross and a closed week with net", () => {
  const trips = getDemoTrips(25);
  const weeks = getDemoWeeklyTotals();
  assert.equal(trips.every((t) => t.deductLease == null && t.deductFuel == null), true);
  const pending = weekPaySheet(trips, weeks, "2026-08-30");
  assert.equal(pending.pending, true);
  assert.equal(pending.gross, 4147);
  assert.equal(pending.net, null);
  const open = weekPaySheet(trips, weeks, "2026-09-06");
  assert.equal(open.pending, true);
  assert.equal(open.gross, 0);
  const closed = weekPaySheet(trips, weeks, "2026-08-23");
  assert.equal(closed.pending, false);
  assert.equal(closed.gross, 2186);
  assert.ok(closed.deductions > 0);
  assert.equal(closed.net, closed.gross - closed.deductions);
  const draft = prefillWeeklyDraft(weeks, "2026-08-30");
  assert.equal(draft.prefilledFrom, "2026-08-23");
  assert.equal(draft.truckLease, 475);
});

console.log("\n" + passed + " tests passed");
