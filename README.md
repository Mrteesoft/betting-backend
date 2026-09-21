# One-Tap Engine (OTP) Backend

High-concurrency Fastify service with in-memory state for mass market application across many matches with idempotency, locking, and context-map validation.

The default board is populated by the backend with 26 mock fixtures across football, basketball and tennis, 8 leagues and 290 market prices. Dates are generated relative to the bootstrap request. A separate `provider: "live"` bootstrap option retains the existing Highlightly integration.

Bets use the simulated `qaxiom-prototype` adapter. No money is deposited or wagered.

## Quick Start
- Install deps: `npm install`
- Copy `.env.example` to `.env`, or set `PORT=3000` and `API_KEYS=local-dev-key`. Mock mode requires no provider credentials.
- Dev server: `npm run dev`
- Tests: `npm test`
- Prod build: `npm run build && npm start`

## Docker
```
docker-compose up --build
```
App listens on `localhost:3000`.

## Environment Variables
- `PORT` (default 3000)
- `API_KEYS` comma-separated list of allowed API keys
- `RATE_LIMIT_PER_MINUTE` per API key (default 120)
- `CONTEXT_CACHE_TTL_MS` LRU cache TTL for context-map (default 60000)
- `IDEMPOTENCY_TTL_SEC` TTL for stored idempotent responses (default 600)
- `CLUSTER_ENABLED` set to `true` to enable Node cluster workers
- `ANCHOR_PARTNER_API_KEY` optional API key that is allowed to use the proprietary One Tap Special
- `OTS_EXCLUSIVE_TO_ANCHOR` set to `true` to restrict One Tap Special usage to `ANCHOR_PARTNER_API_KEY`
- `HIGHLIGHTLY_FOOTBALL_KEY` required to load live football matches and odds
- `HIGHLIGHTLY_FOOTBALL_BASE_URL` defaults to `https://soccer.highlightly.net`
- `HIGHLIGHTLY_FOOTBALL_TIMEZONE` timezone used for match lookups (default `Etc/UTC`)
- `HIGHLIGHTLY_FOOTBALL_CACHE_TTL_MS` in-memory cache TTL for external board data (default `180000`)
- `HIGHLIGHTLY_FOOTBALL_FIXTURE_LIMIT` max matches hydrated into the board (default `18`)
- `HIGHLIGHTLY_FOOTBALL_LOOKAHEAD_DAYS` number of calendar days, starting from today, to scan for live/upcoming matches (default `1`)
- `HIGHLIGHTLY_FOOTBALL_BOOKMAKER_ID` optional preferred bookmaker id for odds
- `HIGHLIGHTLY_FOOTBALL_ODDS_ENABLED` set to `true` only when your Highlightly plan includes the `odds` endpoint; default `false`
- `HIGHLIGHTLY_FOOTBALL_TIMEOUT_MS` outbound request timeout in milliseconds (default `15000`)
- Legacy `API_FOOTBALL_*` variables are still accepted as fallbacks.

## Render Deployment
- The backend no longer requires Redis to boot on Render.
- Runtime state is stored in memory, so selections, locks, rate limits, and idempotency entries reset when the process restarts or a new instance is created.
- `GET /health` is intentionally public so Render health checks can succeed without an API key.

## Endpoints
All application requests require header `x-api-key`. `GET /health` is public for platform health checks.

### POST /v1/otp/sync-selections
Apply a single market to many matches, respecting locks and context-map.
```json
{
  "user_id": "u_123",
  "sport_id": "football",
  "action": "SAFE_PLAY",
  "target_market": "OVER_1_5",
  "match_ids": ["m1","m2"],
  "client_state_version": "v10291",
  "idempotency_key": "uuid-123"
}
```
Response includes `applied`, `skipped_locked`, `skipped_missing`, `updates`, and `server_state_version`. Requests with the same `idempotency_key` return the stored response under `otp:idem:{userId}:{key}` with a 10 minute TTL. Concurrent identical calls are guarded with `SET NX`-style semantics.

For standard markets, the backend now resolves the exact `selection_id` from the ingested `available_markets` catalog instead of only swapping `market_id`.

For the proprietary football special, seed the context map with a market such as `OTS_BTIO_OVER_1_5`. The backend will combine `HOME_TOTAL_OVER_1_5` and `AWAY_TOTAL_OVER_1_5` from the ingested market catalog and return the synthetic special selection with its `combined_odds`.

### POST /v1/otp/dev/bootstrap
Hydrates the One For All board from Highlightly football data and mirrors the result into the in-memory backend store for the selected `user_id`.

This endpoint currently populates football fixtures only. It preserves any previously synced selection for a match if that market is still available in the latest provider payload.

### POST /v1/otp/selections/ingest
Ingest selection snapshots into the in-memory selection store. Body:
```json
{ "user_id": "u1", "selections": [ { "selection_id": "s1", "match_id": "m1", "sport_id": "football", "market_id": "OVER_1_5", "event_timestamp": 1700000000, "odds": 1.2, "isLocked": false, "updated_at": "2024-01-01T00:00:00Z" } ] }
```
Returns `{ ok: true, written: <count> }`.

Each selection can also include:
- `available_markets`: record keyed by `market_id`, used for O(1) market-to-selection resolution during bulk sync
- `score`: `{ home, away }` for settlement/validation helpers
- `time_bucket`: auto-derived as `TODAY`, `WEEKLY`, or `MONTHLY` if not supplied

### GET /v1/otp/selections?user_id=u1&limit=200
Returns all selections for the user. If the count exceeds `limit`, returns only `match_ids` to allow batched fetches.

### POST /v1/otp/locks
```json
{ "user_id": "u1", "selection_id": "s1", "locked": true }
```
Updates lock set `otp:user:{userId}:locks` and mirrors `isLocked` on the snapshot.

### POST /v1/otp/odds/combined
Minimal demo using the worker thread (`odds.worker`) to compute `combinedOdds = homeOdds * awayOdds`.

### Health & Metrics
- `GET /health` -> `{ ok: true }`
- `GET /metrics` -> basic counters.

## Data Model (In Memory)
- `otp:user:{userId}:selections` (hash) field=`matchId` value=`SelectionSnapshot JSON`
- `otp:user:{userId}:selection-index` (hash) field=`selection_id` value=`matchId`
- `otp:user:{userId}:locks` (set) members=`selection_id`
- `otp:context-map` (hash) field=`{sportId}:{action}` value=`market_id`
- `otp:idem:{userId}:{idempotencyKey}` (string) value=response JSON, TTL 10m

## Example cURL
```
curl -X POST http://localhost:3000/v1/otp/sync-selections \
  -H "x-api-key: local-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","sport_id":"football","action":"SAFE_PLAY","target_market":"OVER_1_5","match_ids":["m1","m2"],"client_state_version":"v1","idempotency_key":"idem-123"}'
```

## Performance Notes
- In-memory pipelines for batch reads/writes (selections + locks).
- HMGET/HSET-style helpers plus an in-memory selection index for O(1) match and lock resolution.
- LRU cache for context-map (O(1) lookup after warm).
- Idempotency uses `SET NX`-style semantics to avoid double-processing and stores full response.
- Optional Node cluster for multi-core scaling (`CLUSTER_ENABLED=true`).
- Simple in-memory per-API-key rate limiting.

## Observability & Safety
- Correlation/request IDs via `x-request-id` or generated UUID.
- Pino logging (no request bodies logged).
- API key auth + per-key rate limiting.
- Rejects large batches (`match_ids` > 500) with 413.
# betting-backend

## Mock betting API

All routes below require `x-api-key`. `user_id` identifies a demo profile; this is a prototype API rather than an end-user bearer-auth wallet.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/v1/otp/dev/bootstrap` | Seed or refresh a board; body: `{ "user_id": "demo-user", "provider": "prototype" }` |
| GET | `/v1/otp/events?user_id=demo-user` | Current event snapshots |
| POST | `/v1/otp/auto-market` | Recommend markets within an odds range |
| POST | `/v1/otp/bets` | Validate and place a simulated bet |
| GET | `/v1/otp/bets?user_id=demo-user` | Receipts scoped to the demo user |
| POST | `/v1/otp/auto-bet` | Select markets and place immediately |
| POST | `/v1/otp/auto-bet/rules` | Arm a target-odds instruction |
| GET | `/v1/otp/auto-bet/rules?user_id=demo-user` | Inspect rules |
| DELETE | `/v1/otp/auto-bet/rules/:id?user_id=demo-user` | Cancel an armed rule |
| GET | `/v1/otp/realtime/odds?user_id=demo-user&api_key=local-dev-key` | User-scoped SSE updates |
| POST | `/v1/otp/odds/publish` | Publish a mock market update and evaluate rules |

Placement body:

```json
{
  "user_id": "demo-user",
  "sportsbook": "qaxiom-prototype",
  "match_ids": ["match-ars-che"],
  "stake": 1000,
  "currency": "NGN",
  "bet_type": "multiple",
  "idempotency_key": "unique-request-001"
}
```

`bet_type` is `single`, `multiple` or `system`. Single divides the total stake across selections. System requires at least three matches and divides total stake across all doubles (2/N). Multiple is an accumulator. Placement rejects missing or duplicate matches, locked selections, invalid stake and odds beyond the configured request limit. Concurrent idempotency replays return the same receipt within one process.

Auto Bet rules accept `user_id`, `match_ids`, `stake`, `target_combined_odds`, and `valid_hours` (1–168). They bind to the selected markets and execute at most once when the combined odds reach the target. Expiry and cancellation prevent subsequent execution. Saved selection snapshots allow pending rules to resume after process restart.

Mock prices move within six percent of seed prices every eight seconds for recently bootstrapped users and users with armed rules. Set `OTP_MOCK_ODDS_ENABLED=false` for deterministic manual testing. Publish a price with `user_id`, `match_id`, `selection_id`, `odds` and optional `suspended`.

Receipts and placement idempotency are stored in `OTP_DATA_FILE` (default `data/qaxiom-state.json`). Rules use `OTP_AUTO_BET_FILE` (default `data/auto-bet-rules.json`). These files are ignored by Git. Use a writable persistent directory and one process (`CLUSTER_ENABLED=false`) for this file-backed demo. Board selections and locks remain in memory; pending rules retain their saved snapshots. A shared transactional store is required before running multiple instances against these files.

Validation: `npm run build`, `npm run lint`, and `npm test`. The integration tests cover all-sport bootstrap, market edits, locks, distinct bet pricing, concurrent retries, scoped history, target execution and cancellation.
