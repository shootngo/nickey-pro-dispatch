# Push to Rosa (Firestore)

Nickey writes **completed-trip estimates** into the same Firebase project Rosa's Ledger reads. Collection: **`trips`**.

This is separate from Google Drive Cloud Sync. **Do not** add Google sign-in for Firebase — ndsync already uses Google OAuth. A second Google prompt re-asks Frank which account to use. Rosa push uses **email / password** auth only.

Config and the Rosa password stay on this phone (`localStorage`). They are **not** Drive-synced (same idea as the Bot API key).

## One-time setup (Frank)

1. Rosa (or whoever owns the Firebase project) creates a Web app in [Firebase Console](https://console.firebase.google.com/) → Project settings → Your apps → SDK setup.
2. Copy the `firebaseConfig` object. It looks like:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "rosa-ledger.firebaseapp.com",
  projectId: "rosa-ledger",
  storageBucket: "rosa-ledger.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc"
};
```

3. In Nickey: **☰ → Settings → Rosa**.
4. Paste that object (JSON or the `const firebaseConfig = { … }` snippet) and tap **Save config**.
5. Enter the shared email and password for the Frank/Rosa auth user, then **Sign in**.
6. Stay signed in — Firebase keeps the session on this device. You should not see a Google account chooser.

Until a real config is pasted, the app uses placeholders (`YOUR_API_KEY`, `YOUR_PROJECT_ID`, …) and **Push to Rosa** will tell you to fill Settings.

## What Push to Rosa does

Writes (merge) one document to Firestore `trips`:

| Field | Source |
| --- | --- |
| `tripDate` | Pickup date |
| `payWeek` | Sunday of that Sun–Sat week (`YYYY-MM-DD`) |
| `pushedAt` | Now (ISO) |
| `pickup` | Pickup # digits (also used as the document id when present) |
| `shipper` | `Shipper:` line in notes, else `""` |
| `consignee` | Customer |
| `originCity` | City, ST in notes when it is not the dest |
| `destCity` | Customer address, or city/state parsed from the customer name, or notes |
| `estLinehaul` | Base pay (same number Pay Analyzer uses) |
| `estDetention` | On-site time over 2 hours × $75, else `0` |
| `estExtraPay` | Reimbursements that are **not** reefer fuel, else `0` |
| `estReeferFuel` | Reimbursement rows whose description contains “reefer”, else `0` |
| `odometerIn` / `odometerOut` / `miles` | Odometer fields; miles = out − in |
| `costPerMile` | Base pay ÷ miles (same as Pay Analyzer) |
| `notes` | `[{ text, author: "Frank", timestamp }]` from the trip Notes box |

Rosa **actuals and deductions are not written**. Re-push uses `merge: true` and the pickup number as the document id, so Rosa’s later numbers are not overwritten.

## When it runs

- **☰ → Push to Rosa** or the **Push to Rosa** button on the trip form — writes now and tells you ok/fail.
- **☰ → Email Dispatch Report** (the end-of-trip mail to Daniel / the dispatcher contact) — also pushes, then opens the mail app. If Firebase is not configured, email still sends.

Odometer in/out are stored with **Save Record** and restored when you reopen a trip from Saved Records. Pay Analyzer prefills miles from those odometer fields when they are set.

## Firestore rules (Rosa’s project)

The shared email/password user needs permission to create/update `trips`. Example (tighten as you like):

```
match /trips/{tripId} {
  allow read, write: if request.auth != null;
}
```

Do not enable Google as a sign-in provider for this Nickey client.

## Files

| File | Role |
| --- | --- |
| `nickey-rosa-push.js` | Mapping + email/password write |
| Settings → **Rosa** | Paste config, sign in |
| `sw.js` | Precaches `nickey-rosa-push.js`; Firebase hosts stay network-only |
