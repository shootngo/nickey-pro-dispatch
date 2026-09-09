# Rosa's Ledger

Pay-verification companion for bookkeeper **Rosa**. Frank pushes trip estimates from Nickey into Firestore `trips`; Rosa enters actuals off the pay sheet; the ledger compares them inside an adjustable tolerance band and flags only the large misses.

This folder is a **self-contained static app**. It ships next to Nickey Professional Dispatch on GitHub Pages:

`https://<user>.github.io/nickey-pro-dispatch/rosas-ledger/`

The repo-root `index.html` is still Frank's dispatch app. Do not route `/` here.

## Install as two separate apps (Frank's phone)

Nickey and Rosa's Ledger share the GitHub Pages origin, so Chrome can collapse them into **one** home-screen shortcut if an old install used a wide scope. After this update they are distinct PWAs (`id`, `name`, `start_url`, Rosa-only `scope` + service worker). The home-screen icon for Rosa is the rose + eighteen-wheeler art in `assets/`.

**Reinstall on Android Chrome** so the phone actually creates two icons:

1. Long-press the confused shortcut (the one that sometimes opens the wrong app) → **Remove** / **Delete**. Also remove any extra Nickey or Rosa icon left on the home screen or in the app drawer.
2. Chrome → menu (⋮) → **Settings** → **Site settings** (or **Privacy** → **Clear browsing data**) for `shootngo.github.io` if an old WebAPK still hijacks opens — optional but helps if step 1 is not enough.
3. Open **Nickey** at `https://shootngo.github.io/nickey-pro-dispatch/` → ⋮ → **Add to Home screen** / **Install app**. Confirm the name is Nickey Dispatch and the icon is the Night run navy highway truck.
4. Open **Rosa's Ledger** at `https://shootngo.github.io/nickey-pro-dispatch/rosas-ledger/` → ⋮ → **Add to Home screen** / **Install app**. Confirm the name is Rosa's Ledger and the icon is the rose + eighteen-wheeler.
5. Voice / home should now open each icon's own app. Do not install Rosa from inside the Nickey window; use the Rosa URL in a Chrome tab.

iPhone (Safari): **Share → Add to Home Screen** from each URL separately. Delete the old icon first.

## Demo / offline (no Firebase)

Open `rosas-ledger/` and tap **Continue in demo mode**. Sample trips load from `js/demo-data.js` into `localStorage` so you can:

1. Land on the **month calendar** (Sun–Sat pay weeks, alternate-week shading, trip dots, flagged days).
2. Tap a day → **whole pay week**, with that day highlighted and a running weekly total. Scroll **older weeks**.
3. Open a trip → Frank's estimates vs Rosa's actuals + deductions. Lease and truck wash **prefill from the last entry** and show an **Edited** chip when changed.
4. **Save actuals** — variance and flag recompute against the tolerance band.
5. **Budget / P&L** charts (money in vs out) and **year CSV / XLSX** export.
6. **SimplyWise** is a stub: it accepts a file and does not parse it yet.

Reset sample trips from **More**.

Local preview (required for ES modules):

```bash
python3 -m http.server 8080
# open http://localhost:8080/rosas-ledger/
```

## Stack

- Pure static HTML / CSS / ES modules — no bundler
- Firebase **Email/Password** auth (not Google OAuth)
- Cloud Firestore collection `trips`
- Demo mode is still available from the login screen ("Continue in demo mode")

## Firebase setup (Frank's Google Cloud project)

`js/config.js` already has the live web keys for project **rosa-s-ledger** (Email/Password, not Google OAuth), so **Sign in** is enabled on Pages. From [Firebase Console](https://console.firebase.google.com/):

1. Authentication → Sign-in method → enable **Email/Password** only. Do **not** turn on Google for this app.
2. Authentication → Users → add `frank@…` and `rosa@…` (or share one bookkeeper login).
3. Firestore Database → create in production (or test) mode, then paste the rules from `firestore.rules.example`.
4. Publish this folder to GitHub Pages. Add the Pages URL (and `http://localhost:8080`) to Authentication → Settings → **Authorized domains**.

After that, **Sign in** (email/password) — not "Continue in demo mode". Demo sample trips are local only; Nickey pushes never appear there. A **Live** pill in the header means the calendar is bound to Firestore `trips`.

On boot, a saved Firebase session waits for Auth, then listens to `trips` (and falls back to a one-shot `getDocs` if the live listener hangs or errors). If you previously used demo mode, open **More → Sign in to live ledger**.

Frank's Nickey **Push to Rosa** writes the same `trips` documents (document id = pickup digits, `merge: true`).

## Trip document contract

```
trip {
  id, tripDate, payWeek,   // payWeek = Sunday ISO date of tripDate (Sun–Sat week)
  pushedAt,
  shipper, consignee, originCity, destCity,
  estLinehaul, estDetention, estExtraPay, estReeferFuel,
  odometerIn, odometerOut, miles, costPerMile,
  actualPay, actualDetention, actualExtra, actualReefer,
  deductFuel, deductInsurance, deductLease, deductTruckWash,
  flagged, variance,
  notes: [{ text, author: "Frank"|"Rosa", timestamp }]
}
```

- `tripDate` / `payWeek` / `pushedAt` are ISO strings (`YYYY-MM-DD` or full timestamps).
- Money fields are numbers. Actuals and deductions use `null` until Rosa enters them (`0` is a real zero).
- `variance` = (actualPay + actualDetention + actualExtra + actualReefer) − (estLinehaul + estDetention + estExtraPay + estReeferFuel).
- `flagged` is true only when actuals exist **and** `abs(variance) > tolerance` (default **$25**, adjustable in More).
- Rosa's Ledger never overwrites Frank's estimate fields when she saves actuals. Nickey must not clobber Rosa's actuals / deductions / notes on push (merge estimates only).

## Expected Nickey → Rosa push shape

A later Nickey PR may add **Push to Rosa**. Until then, this is the merge contract.

Nickey `saveRecord()` today (chemical tanker form) maps:

| Nickey `saveRecord` | Rosa `trip` |
| --- | --- |
| `id` | `id` (stable; do not mint a new id on re-push) |
| `date` | `tripDate` → derive `payWeek` = Sunday of that date |
| `timestamp` / now | `pushedAt` |
| `customer` | `consignee` |
| `basePay` | `estLinehaul` |
| `notes` (string) | append `{ text, author: "Frank", timestamp }` if non-empty |

Nickey should **start sending** these estimate fields when Push to Rosa lands (they already exist on the ledger):

```json
{
  "id": "REC-… or TRP-…",
  "tripDate": "2026-09-08",
  "shipper": "Cargill Meat Solutions",
  "consignee": "Kroger DC",
  "originCity": "Chicago, IL",
  "destCity": "Indianapolis, IN",
  "estLinehaul": 1240,
  "estDetention": 80,
  "estExtraPay": 0,
  "estReeferFuel": 45,
  "odometerIn": 439560,
  "odometerOut": 439972,
  "miles": 412,
  "costPerMile": 3.01,
  "notes": [{ "text": "Pushed from Nickey.", "author": "Frank", "timestamp": "2026-09-08T10:22:00.000Z" }]
}
```

**Merge rule for Nickey:** `set`/`merge` only the estimate + identity fields above. Leave `actual*`, `deduct*`, `flagged`, `variance`, and Rosa's notes untouched. Rosa's Ledger recomputes `flagged` / `variance` when she saves actuals.

Helper: `fromNickeyRecord()` in `js/core.js`.

## Firestore security rules

See `firestore.rules.example`. Paste this into Firebase Console → Firestore → Rules and **Publish**:

```
match /trips/{tripId} {
  allow read, write: if request.auth != null;
}
```

Signed-in users may read/write `trips/{id}` and `settings/rosa`. There is no public access. Tighten to Frank/Rosa UIDs before a real payroll dataset lives here.

If the ledger header shows **Live** but a red banner says the listen failed, the rules (or missing Auth) are blocking `list` on `trips`. Auth can succeed while Firestore still denies the snapshot — the app now surfaces that instead of keeping demo rows.

## Tolerance, P&L, export, SimplyWise

- **Tolerance** lives in `localStorage` (`rosasLedger.settings`) so Rosa can tighten the band on her phone without a deploy.
- **P&L** money in = booked actual totals; money out = fuel + insurance + lease + truck wash. Charts are monthly bars for the selected year.
- **Export** writes every contract field for that year. CSV is UTF-8. XLSX is a real Office Open XML zip (no CDN).
- **SimplyWise** is intentionally a stub — file picker + message only.

## Icons

- Vector mark: `assets/icon.svg` (rose + eighteen-wheeler)
- Raster splash / PWA: `assets/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `icon.jpg`, `splash.jpg`
- Adaptive (maskable) home-screen: `assets/icon-maskable-192.png`, `icon-maskable-512.png` (same rose + truck, padded for Android's crop)

## Tests

```bash
node rosas-ledger/test/run.mjs
```
