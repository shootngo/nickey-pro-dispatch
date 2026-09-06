# Nickey Bot API

Grok (or any bot) creates and updates trips on a **Cloudflare Worker**. The phone PWA pulls a pending **inbox** when the app opens and merges them into `nickeySavedRecords`. After that, existing **ndsync** (user Google sign-in) can copy the local records to Drive.

v1 is **API key + KV only**. Do not add a Drive service-account OAuth path.

Paste Dispatch on the phone is unchanged. `POST /v1/trips/from-dispatch-text` uses the **same JSON field names** as the Gemini prompt in `index.html`.

## Pieces

| Piece | Role |
| --- | --- |
| `api/` | Worker: trips, heuristic SMS parser, optional Gemini, inbox / ack |
| `nickey-bot-client.js` | Phone: pull inbox on load + focus, merge, ack, settings |
| Settings → **Bot** | One-time `nickeyBotApiUrl` + `nickeyBotApiKey` (device only, not Drive-synced) |

## Deploy (once)

From the repo, in `api/`:

```bash
cd api
cp wrangler.toml.example wrangler.toml
npx wrangler kv namespace create NICKEY_TRIPS
```

Paste the printed namespace `id` into `wrangler.toml` under `[[kv_namespaces]]`.

```bash
npx wrangler secret put BOT_API_KEY
# optional — fills empty heuristic fields on from-dispatch-text
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

Note the Worker URL (e.g. `https://nickey-bot-api.<account>.workers.dev`).

After deploy, add that hostname to `NETWORK_ONLY_ORIGINS` in `sw.js` so the service worker never caches API responses. The current service worker already treats requests with `Authorization` / `X-Api-Key` as network-only, and does not cache cross-origin fetches except Google Fonts.

## Phone (once)

1. Open Nickey Dispatch → ☰ → Settings → **Bot**.
2. Paste the Worker URL and `BOT_API_KEY`.
3. Save. Reopen the app (or tap **Pull trips now**).

`NickeyBot.promptBotSettings()` and `NickeyBot.pullNow()` are also available from the console.

## Auth

All `/v1/*` routes:

```
Authorization: Bearer <BOT_API_KEY>
```

or

```
X-Api-Key: <BOT_API_KEY>
```

Public (no key): `GET /` (short HTML docs) and `GET /health`.

## Routes

### `POST /v1/trips`

Structured create / upsert. Accepts `saveRecord()` names (`pickup`, `date`, `trailer`, …) and Paste Dispatch names (`pickupNumber`, `pickupDate`, `trailerNumber`, …).

Idempotent on **pickup number**, plus **pickup date** when both sides have one.

### `PATCH /v1/trips/:id`

Partial update. Re-queues the trip in the inbox unless `inboxStatus` is set to `acked`.

### `GET /v1/trips?status=open`

List trips. `status` is optional (`open` / `closed`).

### `POST /v1/trips/from-dispatch-text`

```json
{ "text": "Dillon, SC\npu# 3012874535\nFriday at 9am\nPays you around. 4385.00", "source": "daniel_sms" }
```

`rawText` is accepted as an alias of `text`.

Heuristic parser (always). If `GEMINI_API_KEY` is set, Gemini fills empty fields only. Returned `dispatch` shape:

```json
{
  "pickupDate": "",
  "pickupNumber": "3012874535",
  "customer": "",
  "basePay": 4385,
  "trailerNumber": "",
  "highLimit": null,
  "notes": "Dillon, SC — Friday at 9am"
}
```

Weekday-only schedule stays in `notes` (no invented calendar date). Origin city is not treated as `customer`.

Stored trip uses `saveRecord()` names: `id`, `driverName`, `date`, `pickup`, `customer`, `basePay`, `highLimit`, `trailer`, `notes`, `fuelEntries`, `reimbursements`, …

### `POST /v1/trips/from-bol`

Structured BOL: `bolNumber` / `pickupNumber`, `pickupDate`, `customer` / `consignee`, `shipper`, `trailerNumber`, `highLimit`, `basePay`, `product`, `gallons`, `notes`.

### `GET /v1/inbox`

Pending trips for the phone (`inboxStatus=pending`).

### `POST /v1/inbox/:id/ack`

Mark applied. The phone client does this after a successful local merge.

## Grok / bot usage

Create or update a trip, then the next time the driver opens the app it appears under Saved Records.

```bash
curl -sS -X POST "$BOT_API_URL/v1/trips/from-dispatch-text" \
  -H "Authorization: Bearer $BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"daniel_sms","text":"Dillon, SC\npu# 3012874535\nFriday at 9am\nPays you around. 4385.00"}'
```

More samples: `api/scripts/sample-curl.sh`.

## Tests

No Cloudflare account required:

```bash
cd api && node --test
```

The suite includes the Daniel Kline SMS heuristic and an in-memory Worker (create → inbox → ack → idempotent upsert).

## Field map

| Dispatch / bot | `saveRecord()` / phone |
| --- | --- |
| `pickupNumber` | `pickup` |
| `pickupDate` | `date` |
| `trailerNumber` | `trailer` |
| `customer` | `customer` |
| `basePay` | `basePay` |
| `highLimit` | `highLimit` |
| `notes` | `notes` |
| `driverName` | `driverName` |

Phone merge is idempotent by pickup digits: empty local fields are filled; fuel, reimbursements, and bookkeeping are not overwritten.
