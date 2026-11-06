# Merchant API

Base URL: `https://<host>/api`. Interactive reference: `/docs`.

| Method | Path | Scope | What it does |
|---|---|---|---|
| POST | `/auth/token` | none | Client id + secret -> access token (1 hour) |
| GET | `/cards` | Card | Cards of the business, newest first (`page`, `pageSize`, `status`, `mobile`) |
| POST | `/cards` | Card | Issue a card: `{ mobile, name, description? }` |
| GET | `/card/:reference` | Card | The stored card |
| GET | `/card/:reference/details` | Card | Live status and expiry from UnionPay |
| POST | `/card/:reference/details` | Card | Full details step 1: sends a code to your webhooks (`card.details_otp`), answers `202 { challengeId, expiresAt, expiresIn, sentTo }` |
| POST | `/card/:reference/details/verify` | Card | Full details step 2: `{ challengeId, otp }` -> full card number, expiry and CVV (not stored, `no-store`) |
| GET | `/card/:reference/balance` | Card | Live balance |
| GET | `/card/:reference/transactions` | Card | Live transactions (`fromDate`, `toDate`, `count`, `page`) |
| POST | `/card/:reference/status` | Card | `{ action: block \| unblock \| terminate, reason }` |
| POST | `/card/:reference/replace` | Card | `{ reason }` -> the new card |

## Example
```bash
TOKEN=$(curl -s -X POST https://<host>/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"client_id":"<client id>","client_secret":"<client secret>"}' | jq -r .access_token)

curl -s -X POST https://<host>/api/cards \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mobile":"0712345678","name":"Jane Wanjiku"}'
```

## Errors
- `401` missing, invalid or expired token; deactivated credential; wrong client secret
- `403` IP not on the whitelist; business not approved; credential lacks the scope; too many failed token attempts
- `400` validation errors, or UnionPay's own message when it refuses a card call
- `502` UnionPay could not be reached
