# Rosa → Nickey actual-pay baseline (MVP)

Rosa books **actual pay** in Rosa's Ledger. Nickey reads that number as Frank's **Current Baseline** and compares load estimates against it.

This is **not** a new cloud backend. Both apps sit on the same GitHub Pages origin, so they share `localStorage`. Nickey also includes the key in Drive sync (`ndsync`) and backup export (`NickeyPersist`).

## Shared record (`nickeyRosa.baseline`)

```
{
  version: 1,
  amount: 1200,                 // dollars — what Frank sees as Current Baseline
  currency: "USD",
  kind: "trip" | "week" | "manual",
  payWeek: "2026-09-06",        // Sunday of the Sun–Sat week
  tripDate: "2026-09-08",       // when kind is trip
  tripId, pickup, consignee,
  label: "Kroger DC · Sep 8",
  savedAt: "<ISO>",
  source: "rosa",
  lastActuals: [{ amount, tripId, pickup, consignee, tripDate, payWeek, savedAt }]
}
```

- **Rosa writes** on: Save actuals (optional “set as Frank’s baseline”), week confirm, or More → typed amount.
- **Nickey reads** on load, pageshow, `storage` events (other tab), and after Drive pull.
- `amount` for a trip is Rosa’s actual total (pay + detention + extra + reefer), same as the ledger variance card.
- Drive timestamp key: `ndsync_ts_nickeyRosa.baseline` (stamped on write so last-write-wins works even though Rosa’s PWA does not load `ndsync.js`).

## Frank / Rosa on the same phone

1. Rosa opens `/rosas-ledger/`, enters actuals, saves with **Set as Frank’s baseline**.
2. Frank opens Nickey (same origin). Dashboard shows **Current Baseline: $X**.
3. On a load, estimated base pay is compared to that last actual.

Two phones / two browsers: localStorage will not cross devices until Frank’s Nickey Drive-syncs after the value is on a signed-in Nickey device. **Follow-up:** pull latest `actual*` from the existing Firestore `trips` collection (reverse of Push to Rosa) so Rosa’s bookkeeping phone can update Frank’s truck without sharing a browser.

## Files

| File | Role |
| --- | --- |
| `nickey-rosa-baseline.js` | Shared read/write/compare |
| Rosa trip / week / More | Write path |
| Nickey dashboard + load views | Read + compare UI |
| `ndsync.js` / `nickey-persist.js` | Drive + backup |
