#!/usr/bin/env bash
# Sample curl calls for the Nickey Bot API.
# Usage:
#   BOT_API_URL=https://nickey-bot-api.example.workers.dev \
#   BOT_API_KEY=your-secret \
#   ./sample-curl.sh
set -euo pipefail

URL="${BOT_API_URL:-http://127.0.0.1:8787}"
URL="${URL%/}"
KEY="${BOT_API_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "Set BOT_API_KEY (and optionally BOT_API_URL)." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json")

echo "== GET /health (public) =="
curl -sS "${URL}/health"
echo
echo

echo "== POST /v1/trips/from-dispatch-text (Daniel SMS) =="
CREATE=$(curl -sS -X POST "${URL}/v1/trips/from-dispatch-text" "${auth[@]}" -d '{
  "source": "daniel_sms",
  "text": "Dillon, SC\npu# 3012874535\nFriday at 9am\nPays you around. 4385.00"
}')
echo "$CREATE"
echo
ID=$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(d.trip && d.trip.id || '')" "$CREATE")

echo "== GET /v1/inbox =="
curl -sS "${URL}/v1/inbox" "${auth[@]}"
echo
echo

echo "== GET /v1/trips?status=open =="
curl -sS "${URL}/v1/trips?status=open" "${auth[@]}"
echo
echo

if [[ -n "$ID" ]]; then
  echo "== POST /v1/inbox/${ID}/ack =="
  curl -sS -X POST "${URL}/v1/inbox/${ID}/ack" "${auth[@]}" -d '{}'
  echo
  echo
fi

echo "== POST /v1/trips (structured) =="
curl -sS -X POST "${URL}/v1/trips" "${auth[@]}" -d '{
  "pickupNumber": "3012874535",
  "pickupDate": "2026-09-06",
  "customer": "",
  "basePay": 4385,
  "notes": "Dillon, SC — Friday at 9am",
  "source": "grok"
}'
echo
echo

echo "Done. Configure the phone: Settings → Bot → API URL + key, then reopen the app."
