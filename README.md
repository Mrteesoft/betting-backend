# One-Tap Engine (OTP) Backend

High-concurrency Fastify + Redis service for mass market application across many matches with idempotency, locking, and context-map validation.

The One For All board is now hydrated from Highlightly football live and upcoming match data. The backend maps supported bookmaker odds into the internal selection model used by the frontend and sync engine.

This backend is standalone inside the `backend/` directory.

## Quick Start
- Install deps: `npm install`
- Copy `.env` (optional) or set vars: `PORT=3000`, `REDIS_URL=redis://localhost:6379`, `API_KEYS=local-dev-key`, `HIGHLIGHTLY_FOOTBALL_KEY=your-key`
- Dev server: `npm run dev`
- Tests: `npm test`
- Prod build: `npm run build && npm start`

## Docker
```
docker-compose up --build
```
App listens on `localhost:3000`, Redis on `localhost:6379`.

## Environment Variables
- `PORT` (default 3000)
- `REDIS_URL` (e.g., `redis://redis:6379`)
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

## Endpoints
All requests require header `x-api-key`.

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
Response includes `applied`, `skipped_locked`, `skipped_missing`, `updates`, and `server_state_version`. Requests with the same `idempotency_key` return the stored response (Redis key `otp:idem:{userId}:{key}`, TTL 10 minutes). Concurrent identical calls are guarded with `SET NX`.

For standard markets, the backend now resolves the exact `selection_id` from the ingested `available_markets` catalog instead of only swapping `market_id`.

For the proprietary football special, seed the context map with a market such as `OTS_BTIO_OVER_1_5`. The backend will combine `HOME_TOTAL_OVER_1_5` and `AWAY_TOTAL_OVER_1_5` from the ingested market catalog and return the synthetic special selection with its `combined_odds`.

### POST /v1/otp/dev/bootstrap
Hydrates the One For All board from Highlightly football data and mirrors the result into Redis for the selected `user_id`.

This endpoint currently populates football fixtures only. It preserves any previously synced selection for a match if that market is still available in the latest provider payload.

### POST /v1/otp/selections/ingest
Ingest selection snapshots into Redis hash `otp:user:{userId}:selections`. Body:
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

## Data Model (Redis)
- `otp:user:{userId}:selections` (hash) field=`matchId` value=`SelectionSnapshot JSON`
- `otp:user:{userId}:selection-index` (hash) field=`selection_id` value=`matchId`
- `otp:user:{userId}:locks` (set) members=`selection_id`
- `otp:context-map` (hash) field=`{sportId}:{action}` value=`market_id`
- `otp:idem:{userId}:{idempotencyKey}` (string) value=response JSON, TTL 10m

## Seeding Context-Map
```
redis-cli -u $REDIS_URL HSET otp:context-map "football:SAFE_PLAY" "OVER_1_5"
redis-cli -u $REDIS_URL HSET otp:context-map "basketball:FAST_PLAY" "OVER_200"
```
Cache refreshes automatically every 60s; restart is not required.

## Example cURL
```
curl -X POST http://localhost:3000/v1/otp/sync-selections \
  -H "x-api-key: local-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u1","sport_id":"football","action":"SAFE_PLAY","target_market":"OVER_1_5","match_ids":["m1","m2"],"client_state_version":"v1","idempotency_key":"idem-123"}'
```

## Performance Notes
- Redis pipelines for batch reads/writes (selections + locks).
- HMGET/HSET plus a Redis selection index for O(1) match and lock resolution.
- LRU cache for context-map (O(1) lookup after warm).
- Idempotency uses `SET NX` to avoid double-processing and stores full response.
- Optional Node cluster for multi-core scaling (`CLUSTER_ENABLED=true`).
- Simple Redis-backed per-API-key rate limiting.

## Observability & Safety
- Correlation/request IDs via `x-request-id` or generated UUID.
- Pino logging (no request bodies logged).
- API key auth + per-key rate limiting.
- Rejects large batches (`match_ids` > 500) with 413.
# betting-backend
