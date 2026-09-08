import { strict as assert } from "node:assert";
import {
  addDays, applyVariance, endOfPayWeek, estTotal, exportRows, fromNickeyRecord,
  hasActuals, isFlagged, lastDeduction, money, num, parseISODate, startOfPayWeek,
  toCsv, toISODate, varianceOf, weekShade
} from "../js/core.js";
import { getDemoTrips } from "../js/demo-data.js";
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

test("money formatting", () => {
  assert.equal(money(1240), "$1,240.00");
  assert.equal(money(-35, { signed: true }), "-$35.00");
  assert.equal(money(10, { signed: true }), "+$10.00");
  assert.equal(num("$1,240.50"), 1240.5);
});

console.log("\n" + passed + " tests passed");
