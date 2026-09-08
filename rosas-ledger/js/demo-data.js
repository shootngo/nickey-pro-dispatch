import { normalizeTrip, startOfPayWeek } from "./core.js";

function note(text, author, timestamp) {
  return { text, author, timestamp };
}

/**
 * Sample trips so the UI is reviewable without Firebase.
 * Clustered around Aug–Sep 2026 with a few older weeks for scroll,
 * plus a 2025 row so year export has a second bucket.
 */
export function getDemoTrips(tolerance = 25) {
  const rows = [
    {
      id: "TRP-20251216-001",
      tripDate: "2025-12-16",
      pushedAt: "2025-12-16T18:12:00.000Z",
      shipper: "Cargill",
      consignee: "Tyson Foods",
      originCity: "Dayton, OH",
      destCity: "Springdale, AR",
      estLinehaul: 2180, estDetention: 0, estExtraPay: 75, estReeferFuel: 110,
      odometerIn: 412200, odometerOut: 413050, miles: 850, costPerMile: 2.56,
      actualPay: 2180, actualDetention: 0, actualExtra: 75, actualReefer: 110,
      deductFuel: 420, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: [note("Year-end haul — keep for 2025 export check.", "Frank", "2025-12-16T18:12:00.000Z")]
    },
    {
      id: "TRP-20260612-001",
      tripDate: "2026-06-12",
      pushedAt: "2026-06-12T14:02:00.000Z",
      shipper: "JBS",
      consignee: "Sysco",
      originCity: "Greeley, CO",
      destCity: "Kansas City, KS",
      estLinehaul: 1640, estDetention: 150, estExtraPay: 0, estReeferFuel: 88,
      odometerIn: 428110, odometerOut: 428792, miles: 682, costPerMile: 2.40,
      actualPay: 1640, actualDetention: 150, actualExtra: 0, actualReefer: 88,
      deductFuel: 310, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: [note("Detention paid as estimated.", "Rosa", "2026-06-18T11:00:00.000Z")]
    },
    {
      id: "TRP-20260618-001",
      tripDate: "2026-06-18",
      pushedAt: "2026-06-18T09:40:00.000Z",
      shipper: "Smithfield",
      consignee: "Kroger DC",
      originCity: "Tar Heel, NC",
      destCity: "Delaware, OH",
      estLinehaul: 1890, estDetention: 0, estExtraPay: 50, estReeferFuel: 95,
      odometerIn: 428792, odometerOut: 429540, miles: 748, costPerMile: 2.53,
      actualPay: 1890, actualDetention: 0, actualExtra: 50, actualReefer: 95,
      deductFuel: 355, deductInsurance: 85, deductLease: 450, deductTruckWash: 40,
      notes: []
    },
    {
      id: "TRP-20260714-001",
      tripDate: "2026-07-14",
      pushedAt: "2026-07-14T13:10:00.000Z",
      shipper: "Cargill Meat",
      consignee: "Walmart DC",
      originCity: "Wichita, KS",
      destCity: "Bentonville, AR",
      estLinehaul: 980, estDetention: 75, estExtraPay: 0, estReeferFuel: 42,
      odometerIn: 431002, odometerOut: 431348, miles: 346, costPerMile: 2.83,
      actualPay: 820, actualDetention: 0, actualExtra: 0, actualReefer: 42,
      deductFuel: 160, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: [
        note("Estimate includes 2 hrs detention at Walmart.", "Frank", "2026-07-14T13:10:00.000Z"),
        note("Pay sheet dropped detention and cut linehaul $160 — flagged.", "Rosa", "2026-07-22T16:40:00.000Z")
      ]
    },
    {
      id: "TRP-20260716-001",
      tripDate: "2026-07-16",
      pushedAt: "2026-07-16T11:22:00.000Z",
      shipper: "Tyson",
      consignee: "Sysco Lincoln",
      originCity: "Springdale, AR",
      destCity: "Lincoln, NE",
      estLinehaul: 1425, estDetention: 0, estExtraPay: 0, estReeferFuel: 70,
      odometerIn: 431348, odometerOut: 431970, miles: 622, costPerMile: 2.29,
      actualPay: 1425, actualDetention: 0, actualExtra: 0, actualReefer: 70,
      deductFuel: 280, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260722-001",
      tripDate: "2026-07-22",
      pushedAt: "2026-07-22T15:05:00.000Z",
      shipper: "JBS Swift",
      consignee: "H-E-B",
      originCity: "Cactus, TX",
      destCity: "San Antonio, TX",
      estLinehaul: 760, estDetention: 200, estExtraPay: 0, estReeferFuel: 38,
      odometerIn: 432100, odometerOut: 432512, miles: 412, costPerMile: 1.84,
      actualPay: 760, actualDetention: 225, actualExtra: 0, actualReefer: 38,
      deductFuel: 145, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: [note("Detention came in $25 over estimate — within band.", "Rosa", "2026-07-29T10:12:00.000Z")]
    },
    {
      id: "TRP-20260728-001",
      tripDate: "2026-07-28",
      pushedAt: "2026-07-28T08:55:00.000Z",
      shipper: "National Beef",
      consignee: "US Foods",
      originCity: "Liberal, KS",
      destCity: "Dallas, TX",
      estLinehaul: 1180, estDetention: 50, estExtraPay: 25, estReeferFuel: 55,
      odometerIn: 432512, odometerOut: 433005, miles: 493, costPerMile: 2.39,
      actualPay: 1180, actualDetention: 50, actualExtra: 25, actualReefer: 55,
      deductFuel: 210, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260803-001",
      tripDate: "2026-08-03",
      pushedAt: "2026-08-03T12:18:00.000Z",
      shipper: "Cargill",
      consignee: "Kroger",
      originCity: "Schuyler, NE",
      destCity: "Indianapolis, IN",
      estLinehaul: 1550, estDetention: 0, estExtraPay: 0, estReeferFuel: 80,
      odometerIn: 433120, odometerOut: 433868, miles: 748, costPerMile: 2.07,
      actualPay: 1550, actualDetention: 0, actualExtra: 0, actualReefer: 80,
      deductFuel: 340, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260805-001",
      tripDate: "2026-08-05",
      pushedAt: "2026-08-05T16:44:00.000Z",
      shipper: "Tyson Prepared",
      consignee: "Sysco Cincinnati",
      originCity: "Chicago, IL",
      destCity: "Cincinnati, OH",
      estLinehaul: 620, estDetention: 100, estExtraPay: 0, estReeferFuel: 28,
      odometerIn: 433868, odometerOut: 434162, miles: 294, costPerMile: 2.11,
      actualPay: 620, actualDetention: 100, actualExtra: 0, actualReefer: 28,
      deductFuel: 95, deductInsurance: 85, deductLease: 450, deductTruckWash: 0,
      notes: [note("Skipped wash — going back out tonight.", "Frank", "2026-08-05T16:44:00.000Z")]
    },
    {
      id: "TRP-20260811-001",
      tripDate: "2026-08-11",
      pushedAt: "2026-08-11T10:07:00.000Z",
      shipper: "JBS",
      consignee: "Walmart DC",
      originCity: "Grand Island, NE",
      destCity: "Mount Pleasant, IA",
      estLinehaul: 890, estDetention: 0, estExtraPay: 40, estReeferFuel: 36,
      odometerIn: 434400, odometerOut: 434812, miles: 412, costPerMile: 2.16,
      actualPay: 890, actualDetention: 0, actualExtra: 40, actualReefer: 36,
      deductFuel: 155, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260812-001",
      tripDate: "2026-08-12",
      pushedAt: "2026-08-12T19:30:00.000Z",
      shipper: "Smithfield",
      consignee: "Kroger DC",
      originCity: "Monmouth, IL",
      destCity: "Columbus, OH",
      estLinehaul: 1040, estDetention: 80, estExtraPay: 0, estReeferFuel: 48,
      odometerIn: 434812, odometerOut: 435290, miles: 478, costPerMile: 2.18,
      actualPay: 990, actualDetention: 80, actualExtra: 0, actualReefer: 48,
      deductFuel: 190, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: [
        note("Layover pay not on this one — linehaul only.", "Frank", "2026-08-12T19:30:00.000Z"),
        note("Sheet is $50 light on linehaul. Inside a $25 band? No — flagged.", "Rosa", "2026-08-19T09:20:00.000Z")
      ]
    },
    {
      id: "TRP-20260818-001",
      tripDate: "2026-08-18",
      pushedAt: "2026-08-18T11:15:00.000Z",
      shipper: "Cargill",
      consignee: "Sysco",
      originCity: "Fort Morgan, CO",
      destCity: "Denver, CO",
      estLinehaul: 410, estDetention: 125, estExtraPay: 0, estReeferFuel: 18,
      odometerIn: 435500, odometerOut: 435612, miles: 112, costPerMile: 3.66,
      actualPay: 410, actualDetention: 125, actualExtra: 0, actualReefer: 18,
      deductFuel: 48, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260820-001",
      tripDate: "2026-08-20",
      pushedAt: "2026-08-20T14:50:00.000Z",
      shipper: "National Beef",
      consignee: "H-E-B",
      originCity: "Dodge City, KS",
      destCity: "Houston, TX",
      estLinehaul: 1720, estDetention: 0, estExtraPay: 100, estReeferFuel: 92,
      odometerIn: 435612, odometerOut: 436390, miles: 778, costPerMile: 2.21,
      actualPay: 1720, actualDetention: 0, actualExtra: 100, actualReefer: 92,
      deductFuel: 380, deductInsurance: 85, deductLease: 450, deductTruckWash: 45,
      notes: [note("Team extra on this lane.", "Frank", "2026-08-20T14:50:00.000Z")]
    },
    {
      id: "TRP-20260821-001",
      tripDate: "2026-08-21",
      pushedAt: "2026-08-21T08:12:00.000Z",
      shipper: "Tyson",
      consignee: "US Foods",
      originCity: "Amarillo, TX",
      destCity: "Oklahoma City, OK",
      estLinehaul: 540, estDetention: 60, estExtraPay: 0, estReeferFuel: 24,
      odometerIn: 436390, odometerOut: 436650, miles: 260, costPerMile: 2.08,
      actualPay: 540, actualDetention: 60, actualExtra: 0, actualReefer: 24,
      deductFuel: 88, deductInsurance: 85, deductLease: 450, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260825-001",
      tripDate: "2026-08-25",
      pushedAt: "2026-08-25T13:33:00.000Z",
      shipper: "JBS",
      consignee: "Kroger",
      originCity: "Greeley, CO",
      destCity: "Salt Lake City, UT",
      estLinehaul: 1280, estDetention: 0, estExtraPay: 0, estReeferFuel: 64,
      odometerIn: 436800, odometerOut: 437310, miles: 510, costPerMile: 2.51,
      actualPay: 1280, actualDetention: 0, actualExtra: 0, actualReefer: 64,
      deductFuel: 240, deductInsurance: 85, deductLease: 475, deductTruckWash: 35,
      notes: [note("Lease bumped $25 this week — new schedule.", "Rosa", "2026-09-01T12:00:00.000Z")]
    },
    {
      id: "TRP-20260827-001",
      tripDate: "2026-08-27",
      pushedAt: "2026-08-27T17:05:00.000Z",
      shipper: "Cargill",
      consignee: "Walmart DC",
      originCity: "Schuyler, NE",
      destCity: "Grandview, MO",
      estLinehaul: 720, estDetention: 90, estExtraPay: 0, estReeferFuel: 32,
      odometerIn: 437310, odometerOut: 437598, miles: 288, costPerMile: 2.50,
      actualPay: 720, actualDetention: 90, actualExtra: 0, actualReefer: 32,
      deductFuel: 110, deductInsurance: 85, deductLease: 475, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260831-001",
      tripDate: "2026-08-31",
      pushedAt: "2026-08-31T09:20:00.000Z",
      shipper: "Smithfield",
      consignee: "Sysco",
      originCity: "Clinton, NC",
      destCity: "Atlanta, GA",
      estLinehaul: 860, estDetention: 0, estExtraPay: 0, estReeferFuel: 40,
      odometerIn: 437700, odometerOut: 438110, miles: 410, costPerMile: 2.10,
      actualPay: 860, actualDetention: 0, actualExtra: 0, actualReefer: 40,
      deductFuel: 165, deductInsurance: 85, deductLease: 475, deductTruckWash: 35,
      notes: []
    },
    {
      id: "TRP-20260902-001",
      tripDate: "2026-09-02",
      pushedAt: "2026-09-02T15:48:00.000Z",
      shipper: "Tyson",
      consignee: "Publix",
      originCity: "Dawson, GA",
      destCity: "Lakeland, FL",
      estLinehaul: 980, estDetention: 110, estExtraPay: 0, estReeferFuel: 52,
      odometerIn: 438110, odometerOut: 438522, miles: 412, costPerMile: 2.38,
      actualPay: 980, actualDetention: 75, actualExtra: 0, actualReefer: 52,
      deductFuel: 170, deductInsurance: 85, deductLease: 475, deductTruckWash: 35,
      notes: [note("Detention short $35 vs estimate — still inside $25? Check band.", "Rosa", "2026-09-05T08:10:00.000Z")]
    },
    {
      id: "TRP-20260904-001",
      tripDate: "2026-09-04",
      pushedAt: "2026-09-04T12:00:00.000Z",
      shipper: "JBS",
      consignee: "Sysco Tampa",
      originCity: "Souderton, PA",
      destCity: "Tampa, FL",
      estLinehaul: 1960, estDetention: 0, estExtraPay: 75, estReeferFuel: 105,
      odometerIn: 438522, odometerOut: 439560, miles: 1038, costPerMile: 1.89,
      actualPay: 1960, actualDetention: 0, actualExtra: 75, actualReefer: 105,
      deductFuel: 490, deductInsurance: 85, deductLease: 475, deductTruckWash: 50,
      notes: [note("Long east-coast run. Wash was $50 at the TA.", "Frank", "2026-09-04T12:00:00.000Z")]
    },
    {
      id: "TRP-20260908-001",
      tripDate: "2026-09-08",
      pushedAt: "2026-09-08T10:22:00.000Z",
      shipper: "Cargill Meat Solutions",
      consignee: "Kroger DC",
      originCity: "Chicago, IL",
      destCity: "Indianapolis, IN",
      estLinehaul: 1240, estDetention: 80, estExtraPay: 0, estReeferFuel: 45,
      odometerIn: 439560, odometerOut: 439972, miles: 412, costPerMile: 3.01,
      actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null,
      deductFuel: null, deductInsurance: 85, deductLease: null, deductTruckWash: null,
      notes: [note("Pushed from Nickey. Insurance is weekly — Rosa to confirm actuals off the sheet.", "Frank", "2026-09-08T10:22:00.000Z")]
    },
    {
      id: "TRP-20260909-001",
      tripDate: "2026-09-09",
      pushedAt: "2026-09-08T16:05:00.000Z",
      shipper: "Tyson Fresh",
      consignee: "Sysco Indianapolis",
      originCity: "Logansport, IN",
      destCity: "Indianapolis, IN",
      estLinehaul: 380, estDetention: 50, estExtraPay: 0, estReeferFuel: 16,
      odometerIn: 439972, odometerOut: 440090, miles: 118, costPerMile: 3.22,
      actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null,
      deductFuel: null, deductInsurance: null, deductLease: null, deductTruckWash: null,
      notes: [note("Short hop tomorrow morning.", "Frank", "2026-09-08T16:05:00.000Z")]
    },
    {
      id: "TRP-20260911-001",
      tripDate: "2026-09-11",
      pushedAt: "2026-09-08T16:40:00.000Z",
      shipper: "National Beef",
      consignee: "Walmart DC",
      originCity: "Dodge City, KS",
      destCity: "Johnstown, OH",
      estLinehaul: 1680, estDetention: 0, estExtraPay: 60, estReeferFuel: 86,
      odometerIn: 440090, odometerOut: 441000, miles: 910, costPerMile: 1.85,
      actualPay: null, actualDetention: null, actualExtra: null, actualReefer: null,
      deductFuel: null, deductInsurance: null, deductLease: null, deductTruckWash: null,
      notes: [note("Friday delivery — extra for layover.", "Frank", "2026-09-08T16:40:00.000Z")]
    }
  ];

  return rows.map((r) => {
    r.payWeek = startOfPayWeek(r.tripDate);
    return normalizeTrip(r, tolerance);
  });
}

export const DEMO_SEED_VERSION = 1;
