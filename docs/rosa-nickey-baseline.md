# Rosa → Nickey actual-pay baseline (MVP)

Rosa books **actual pay** in Rosa's Ledger. Nickey reads that number as Frank's **Current Baseline** and compares load estimates against it.

This is **not** a new cloud backend. Both apps sit on the same GitHub Pages origin, so they share `localStorage`. Nickey also includes the key in Drive sync (`ndsync`) and backup export (`NickeyPersist`).

## Shared record (`nickeyRosa.baseline`)

```
{
  version: 1,
  amount: 388.80,               // dollars — that trip's line haul (actualPay) only
  currency: "USD",
  kind: "trip" | "manual",      // leftover "week" is invalid and cleared on read
  payWeek: "2026-09-06",        // Sunday of the Sun–Sat week
  tripDate: "2026-09-08",       // when kind is trip
  tripId, pickup, consignee,
  label: "Kroger DC · Sep 8 · line haul",
  savedAt: "<ISO>",
  source: "rosa",
  lastActuals: [{ amount, tripId, pickup, consignee, tripDate, payWeek, savedAt }]
}
```

- **Rosa writes** on every successful **Save actuals** when that trip has a line haul (`actualPay`). The save overwrites Current Baseline with that trip’s line haul. There is no checkbox and no separate send button.
- **Nickey reads** on load, pageshow, `storage` events (other tab), and after Drive pull.
- `amount` is one trip’s line haul. Detention, extra, and reefer stay on the trip and are not added in. Week gross stays on the pay sheet and is never the baseline.
- A leftover `kind: "week"` record is not a Nickey baseline. On read, the shared module rewrites it to an empty amount and stamps a newer Drive time so the week gross cannot come back from localStorage or sync. Replace it by opening one trip and saving actuals with a line haul. New publishes from a trip are `kind: "trip"`. `publishManual` remains on the shared module for a typed amount, and Rosa’s screens do not expose it.
- Drive timestamp key: `ndsync_ts_nickeyRosa.baseline` (stamped on write so last-write-wins works even though Rosa’s PWA does not load `ndsync.js`).

## Frank / Rosa on the same phone

After this update is on the phone: Rosa and Frank each tap **Check for update**. Rosa opens a trip, enters the line haul, and taps **Save actuals**. That writes the trip’s line haul into shared `localStorage` (and Nickey Drive sync on the next signed-in push). Nickey Current Baseline shows that amount. The trip page does not show a Nickey baseline card.

1. Rosa opens `/rosas-ledger/`, enters the trip’s **line haul** (`actualPay`), and taps **Save actuals**.
2. Frank opens Nickey (same origin). Dashboard shows **Current Baseline** as that line haul.
3. On a load, estimated base pay is compared to that trip’s line haul. The week page in Rosa still shows week gross and weekly totals, plus one current-baseline readout.

Two phones / two browsers: localStorage will not cross devices until Frank’s Nickey Drive-syncs after the value is on a signed-in Nickey device. **Follow-up:** pull latest `actual*` from the existing Firestore `trips` collection (reverse of Push to Rosa) so Rosa’s bookkeeping phone can update Frank’s truck without sharing a browser.

## Files

| File | Role |
| --- | --- |
| `nickey-rosa-baseline.js` | Shared read/write/compare |
| Rosa Save actuals | Write path (that trip’s line haul only) |
| Nickey dashboard + load views | Read + compare UI |
| `ndsync.js` / `nickey-persist.js` | Drive + backup |
