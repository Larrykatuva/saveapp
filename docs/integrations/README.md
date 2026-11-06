# Integrations

The merchant API and its portal pages. Code: `src/modules/integrations`.

## In the merchant portal
Workspace > **Integrations** (laid out like Settings) and Workspace > **Cards**, both open once the business is approved.

- **Credentials**: create API keys (client id + secret), choose what each can do (Cards today; Wallet as a service later), set the IP whitelist, rotate the secret, deactivate. The id and secret are shown once; both are stored as HMAC-SHA256 with `PRIVATE_KEY`.
- **Webhooks**: endpoints that receive card events from UnionPay, each with its own signing secret. Send a test event from the list.
- **Event logs**: every delivery to every endpoint (event, endpoint, outcome, duration, payload, the endpoint's error), filterable by outcome, event and endpoint. One-time codes are masked in the log. Logs older than a month are deleted by `WebhookLogService` every night at 03:00 Nairobi time and on start.
- **Cards**: every card the business issued, with a drawer that checks status, balance and recent transactions live with UnionPay.

Permissions: `merchant.cards.view`, `merchant.credentials.view`, `merchant.credentials.manage` (Owner only by default), `merchant.webhooks.manage`.

## How a call is checked
1. `POST /api/auth/token` with `client_id` and `client_secret` returns a one-hour HS256 token signed with `PRIVATE_KEY` (as scripay-wallet does). Five wrong secrets lock the client id for 15 minutes.
2. Every API call: Bearer token valid, credential still active, business Approved, caller IP on the credential's whitelist, credential has the route's scope (`CredentialGuard`).
3. In production (`ENV=PROD`) a credential without an IP whitelist is refused. Outside production an empty whitelist allows any address.

## Cards and UnionPay
Cards are issued through Terraka (`src/modules/unionpay`). `POST /api/cards` registers the mobile number as a cardholder on first use, then creates the card. SaveApp stores the masked number (first 6 and last 4 digits), reference, status and expiry; the full number and CVV are never stored. They can be fetched live through a two-step check: `POST /api/card/:reference/details` sends a 6-digit code to the business's webhook endpoints (`card.details_otp`, 5 minutes, single use, 5 tries, 20 requests per credential per 15 minutes; `CardChallenge` keeps only a hash), and `POST /api/card/:reference/details/verify` with `{ challengeId, otp }` returns the full number, expiry and CVV from UnionPay (`Cache-Control: no-store`). Both steps are logged on the card without the values, and the code is masked in the event log.

## Webhooks from Terraka
Terraka posts to:
- `POST /api/webhooks/terraka/cards/feed` (card transactions) -> forwarded as `card.transaction`
- `POST /api/webhooks/terraka/cards/otp` (one-time codes) -> forwarded as `card.otp`

Each event is logged on the card and posted to the business's active endpoints with `X-SaveApp-Event`, `X-SaveApp-Delivery`, `X-SaveApp-Timestamp` and `X-SaveApp-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`. Delivery is fire-and-forget (no retries yet); every attempt is kept in the event log for a month and the latest outcome shows on the endpoint. All endpoints receiving the same event get the same event id. Set `TERRAKA_WEBHOOK_IPS` to accept Terraka's addresses only.

## Public pages
- `/` landing page (signed-in people go straight to their portal) and `/developers`, the integration guide: credentials, tokens, every card endpoint, webhooks with signature checks in Node.js, Python and PHP, errors and a going-live checklist. Code: `src/modules/site`.
- `/docs` is the generated API reference (Swagger).
