# Google Drive bot inbox

**Preferred path for Frank.** Grok’s Drive connector can create files but must not PATCH `nickey-dispatch-data.json` (that file can be newer on the phone than in Drive). Instead Grok writes a sibling inbox file. The phone merges it locally; **ndsync** then pushes the main file as usual.

The Cloudflare Worker inbox from [bot-api.md](bot-api.md) is still in the app. Leave it configured if you use it. Drive inbox does not require Cloudflare.

## Files in Drive

Folder (same as Cloud Sync): **`Nickey Dispatch Data`**

| File | Who writes it | Purpose |
| --- | --- | --- |
| `nickey-dispatch-data.json` | Phone **ndsync only** | Live sync file (merge-safe). Never written by bots. |
| `nickey-backup-YYYY-MM-DDTHHMMSSZ.json` | Phone **ndsync** (POST only, never overwritten) | Immutable snapshot of saved records after each successful push, plus manual **Backup to Drive now**. |
| `nickey-bot-inbox.json` | **Grok** creates/updates; phone clears applied trips | Pending trips for the phone |

**Safety:** bots must never overwrite `nickey-dispatch-data.json` or snapshot files. The phone inbox client never reads or writes those files.

### Snapshot retention

Snapshots live in **Nickey Dispatch Data** next to the live file. Each one is a **new** Drive file (never PATCHed). The phone trashes extras using this union:

- keep the **30 newest**, **or**
- keep anything **newer than 14 days**, **or**
- always keep the **largest-ever** snapshot (by trip count, then file size)

A shrink of the live file (local trip count drops the remote by more than 10% or more than 5 trips) first snapshots the current remote, then **refuses to overwrite** until you confirm in Cloud Sync (“Remote has N trips, local has M — continue?”).

## Main sync file (`nickey-dispatch-data.json`)

The phone is the only writer. On pull it **merges** `nickeySavedRecords` by trip id / pickup number (union). A newer Drive copy with fewer trips cannot wipe trips that still exist on the phone. After a merge the phone pushes the combined set back. Deletes sync via `nickeyDeletedRecordIds` so a deleted trip is not resurrected. Weekly deductions and similar maps are union-merged; simple scalars (driver name, API key) stay last-write-wins.

On app update the service worker only refreshes cached HTML/JS. It does not clear `localStorage` or IndexedDB. Opening a new version migrates older record shapes (`fuel` → `fuelEntries`, `pickupNumber` → `pickup`, missing `id`) and legacy keys such as `nickeyDraftLoad`.

## Inbox file shape

```json
{
  "version": 1,
  "updatedAt": "2026-09-06T12:00:00.000Z",
  "trips": [
    {
      "pickup": "3012874535",
      "basePay": 4385,
      "notes": "Dillon SC Friday 9am — dispatcher Daniel Kline",
      "inboxStatus": "pending",
      "source": "grok_bot"
    }
  ]
}
```

`inboxStatus` defaults to `pending` if omitted. After a successful merge the phone rewrites the file with those trips **removed** (empty `trips: []`) so the inbox stays small. `inboxStatus: "acked"` is also treated as already applied.

## How Grok writes the file

1. Open Frank’s Drive folder **Nickey Dispatch Data** (create it only if Cloud Sync has never run; normally the phone already created it).
2. Create or update **`nickey-bot-inbox.json`** with the JSON above.
3. Append new trips to `trips`. Do not delete trips the phone has not pulled yet unless you are replacing a draft of the same pickup number.
4. Do **not** open or PATCH `nickey-dispatch-data.json`.

Prefer `saveRecord()` field names. Paste Dispatch aliases work too.

## Field map

| Grok / dispatch | Phone `saveRecord()` |
| --- | --- |
| `pickup` or `pickupNumber` | `pickup` |
| `date` or `pickupDate` | `date` |
| `trailer` or `trailerNumber` | `trailer` |
| `customer` | `customer` |
| `basePay` | `basePay` |
| `highLimit` | `highLimit` |
| `notes` | `notes` |
| `driverName` | `driverName` |
| `inboxStatus` | `pending` until the phone applies it |
| `source` | `grok_bot` |

Other `saveRecord()` fields (`fuelEntries`, `reimbursements`, arrival/departure, …) are accepted if present.

## What the phone does

`nickey-bot-drive-inbox.js` (loaded after `ndsync.js`):

1. Uses the **same OAuth token** as Cloud Sync (no second sign-in).
2. On load (after `ndsync:ready`), on window focus, and via Settings → Bot → **Pull bot trips**.
3. Finds the folder and `nickey-bot-inbox.json`, downloads it, merges `pending` trips into `nickeySavedRecords` / in-memory `savedRecords`.
4. **Idempotent by pickup digits** (e.g. `3012874535`). Existing records are not replaced wholesale.
5. Does **not** wipe fuel, reimbursements, `actualPay`, or `bookkeepingComplete` on a record that already has them.
6. Toasts how many **new** trips were added.
7. Writes the inbox back with applied trips removed. If write-back fails, those pickup numbers are remembered locally so they are not re-added.
8. A later ndsync debounce push updates `nickey-dispatch-data.json` from the phone — the only supported way that file changes.

Cloud Sync → **Pull bot trips** is the same action.

## Google scope note

ndsync already used `drive.file` (files this app created). Grok’s connector creates the inbox under a different app, so ndsync now also requests `https://www.googleapis.com/auth/drive` in order to **read and clear** that sibling file. The next Cloud Sync sign-in may show an extra Drive permission. Add that scope on the OAuth consent screen if Google rejects it.

If the inbox file is not visible, confirm it lives in **Nickey Dispatch Data** and that Cloud Sync is signed in as the same Google account Grok wrote to.

## Example (already on Frank’s Drive)

Pickup `3012874535`, `basePay` `4385`, notes mentioning Dillon SC Friday 9am and dispatcher Daniel Kline. With Cloud Sync signed in, opening the app should merge that trip into Saved Records.
