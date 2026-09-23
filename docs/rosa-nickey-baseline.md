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

- **Rosa writes** on: Save actuals with **Set as Frank’s baseline** (that trip’s line haul / `actualPay` only), or More → a typed line haul.
- **Nickey reads** on load, pageshow, `storage` events (other tab), and after Drive pull.
- `amount` is one trip’s line haul. Detention, extra, and reefer stay on the trip and are not added in. Week gross stays on the pay sheet and is never the baseline.
- A leftover `kind: "week"` record is not a Nickey baseline. On read, the shared module rewrites it to an empty amount and stamps a newer Drive time so the week gross cannot come back from localStorage or sync. Replace it by opening one trip and saving actuals with **Set as Frank’s baseline**. New publishes are `kind: "trip"` or `kind: "manual"` only.
- Drive timestamp key: `ndsync_ts_nickeyRosa.baseline` (stamped on write so last-write-wins works even though Rosa’s PWA does not load `ndsync.js`).

## Frank / Rosa on the same phone

1. Rosa opens `/rosas-ledger/`, enters actuals, saves with **Set as Frank’s baseline**.
2. Frank opens Nickey (same origin). Dashboard shows **Current Baseline: $X**.
3. On a load, estimated base pay is compared to that trip’s line haul.

Two phones / two browsers: localStorage will not cross devices until Frank’s Nickey Drive-syncs after the value is on a signed-in Nickey device. **Follow-up:** pull latest `actual*` from the existing Firestore `trips` collection (reverse of Push to Rosa) so Rosa’s bookkeeping phone can update Frank’s truck without sharing a browser.

## Files

| File | Role |
| --- | --- |
| `nickey-rosa-baseline.js` | Shared read/write/compare |
| Rosa trip save / More typed amount | Write path (one trip only) |
| Nickey dashboard + load views | Read + compare UI |
| `ndsync.js` / `nickey-persist.js` | Drive + backup |
