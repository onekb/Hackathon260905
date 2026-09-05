# InferPool Router

The Router authenticates buyers and independent mock providers, reserves each request on the configured chain, meters simulated Unicode tokens, and settles the final four usage categories. Inference and responsibility decisions are centralized. `anvil` and `monad-testnet` adapters use real chain receipts. `memory` is an explicit unit-test helper and creates no transactions.

## Asset and migration boundary

Current source uses native test MON: market `0x142a4904307244Bed0cECD72dE8329A253333182`, 18-decimal wei, with a separate `TOKENS_PER_MILLION = 1_000_000` billing divisor. The new contract is deployed and verified; the public service has not yet switched from legacy dUSD. See [deployment evidence](../contracts/deployments/inferpool-mon-native-testnet.json) and [live progress](../docs/progress.md).

Buyers call payable `deposit()` with MON value, then separately `authorizeRouter(limit, expiresAt)`; no ERC-20 approve is required. Withdrawal is a native transfer; settlement credits the seller's internal withdrawable balance. Existing dUSD and its spending grants do not become MON or authorize the new market.

Every order and `/config` identify `market_address`, `asset_symbol` and `asset_decimals`. Bind the store before recovery. Migration requires the exact paired `LEGACY_MARKET_ADDRESS` and `LEGACY_TOKEN_ADDRESS`, no unresolved legacy reservation/settlement, and the original orders/idempotency/createdAt retained. Unknown or inconsistent identities fail startup rather than relabeling money. Cache is cleared on market switch; historical attempts still count toward the unchanged admission epoch. Use a backed-up, controlled migration to a market-specific state file; an empty replacement file would reset history and quotas.

A POST retry with an old dUSD `Idempotency-Key` returns 409 plus its original request ID; it never becomes a new MON charge. Query the old order, and use a new key only for an intentionally new MON request. Current-market recovery/cancel/provider-event handling cannot act on legacy orders. Legacy funds remain withdrawable/reclaimable through their original contract and separate Web controls.

## Run

After deploying the market and publishing provider quotes:

```sh
CHAIN_MODE=anvil \
RPC_URL=http://127.0.0.1:8545 \
MARKET_ADDRESS=0x... \
ROUTER_ADDRESS=0x... \
ROUTER_PUBLIC_URL=http://localhost:8787 \
npm run start --workspace @inferpool/server
```

`ROUTER_STATE_PATH` defaults to `.local/router-state.json`, relative to the process working directory. Use an explicit absolute path in deployment so restarting from another directory cannot select a different store. The single-process JSON store atomically replaces its file with owner-only permissions. It contains response bodies, order metadata, API-key hashes and session hashes; never commit it or serve its directory. One Router process owns one store. Horizontal workers need a transactional shared database before production.

For a public deployment, terminate HTTPS/WSS in front of this process and set `ROUTER_PUBLIC_URL` to the externally reachable URL. Set `ALLOWED_ORIGINS` to comma-separated exact buyer-app origins. The default bind address is `127.0.0.1`; `HOST` changes it deliberately. Provider authentication binds signatures to the public URL host. The root EVM adapter requires an authorized Alchemy session for Monad signing; it does not import a wallet private key.

## Optional Web on the same HTTP port

Set `WEB_STATIC_DIR` to the **absolute** directory of a completed Next static export, for example `/srv/inferpool/releases/current/web/out`. It is disabled when unset. An empty, relative, missing or invalid export directory fails startup before chain initialization and recovery; the directory must contain an actual `index.html` within it. Keep this dedicated public build directory read-only to the service user, separate from the private ledger and Alchemy configuration.

With `HOST=127.0.0.1`, `PORT=8788` and `WEB_STATIC_DIR` configured, one HTTP endpoint serves `/`, `/provider-connect/`, exported assets, all existing API routes, SSE, and the `/provider` WebSocket upgrade. API routes take precedence. Unknown API paths return JSON 404 even if an exported file has that name; unknown pages never fall back to the home page. Dotfiles, path traversal and symlinks escaping the export directory are rejected. Static files preserve the Router's `no-store` response policy.

The application provides HTTP only. The server owner can proxy this single port through their existing HTTPS endpoint, preserving WebSocket upgrades and unbuffered SSE. Build the Web with its final public `NEXT_PUBLIC_ROUTER_URL`; set `ROUTER_PUBLIC_URL` and the exact frontend `ALLOWED_ORIGINS` consistently. Serving static files does not rewrite the Web's build-time Router URL or change wallet-domain authentication. No additional Next.js runtime or static-service dependency is required.

Before exposing it, check the deployed port with `GET /`, `GET /provider-connect/`, an actual `/_next/static/` asset, `GET /health` and `GET /v1/models`; verify `GET /v1/unknown` returns JSON 404 and unknown pages remain 404. After the owner's HTTPS proxy is ready, verify browser login, seller WSS authentication and incremental SSE through that public origin. The static tests use temporary local ports and MemoryChain; they do not establish production proxy or wallet readiness.

## Bounded public demo

The local default has no extra demo admission policy. Explicitly enable it before opening the inference API to public traffic:

```sh
DEMO_ADMISSION_ENABLED=true
DEMO_ADMISSION_START_UTC='<fixed ISO UTC start, such as 2026-09-05T05:45:00.000Z>'
DEMO_NEW_ORDERS_ENABLED=true
ROUTER_TRUST_PROXY=loopback
```

Replace the start placeholder with the actual fixed beginning of this demonstration, at or before startup. Accepted timestamps end in `Z` and include seconds, with optional three-digit milliseconds. Keep this exact value and the same absolute `ROUTER_STATE_PATH` across restarts; do not generate a new start time in a launch command. Advancing it intentionally starts a different quota window and must be treated as a new demonstration budget, not ordinary restart configuration. Invalid booleans, missing/invalid/future start times, and unsupported proxy settings fail startup before chain initialization or recovery. If admission is disabled or unset, the other `DEMO_*` settings must be absent, so a misspelled or ineffective pause cannot silently leave new requests enabled.

Enabled limits are fixed: one unsettled request per wallet, six new attempts per wallet per UTC day within this demo, two unsettled requests globally, and ten total new attempts since the configured start. An attempt is consumed when its order is persisted immediately before `chain.lock`; a failed or uncertain lock still counts. Invalid parameters, insufficient balance/authorization, unavailable sellers, and admission rejections create no order and use no attempt. Quota rejection occurs before chain submission and charges no dUSD. Counts derive from all persisted orders, not API keys or the last 100 orders returned by the listing API. An idempotency hit returns its original order before the new-order checks, so replay does not use another attempt.

Concurrency includes locking, running, uncertain reservations, and pending/failed settlements—even orders created before this demo's start. A settled or conclusively absent failed lock releases its concurrent slot, but never restores its consumed attempt. Checks and order persistence use the existing serialized creation path, preventing competing requests from exceeding the last slot. Public demo quotas bound newly admitted work; they do not promise a precise MON gas cost or stop settlement/reconciliation for already admitted work.

Set `DEMO_NEW_ORDERS_ENABLED=false` while keeping admission enabled and the same start to pause new orders with HTTP 503. Limits return HTTP 429. These settings are read at startup, with no HTTP endpoint for increasing limits; apply a manual pause through controlled restart, preferably after current requests have settled. The existing restart-recovery behavior still applies. Queries, exact idempotency replay, cancellation, settlement retries and recovery remain available while paused or exhausted. A cancellation during unconfirmed locking retains its existing HTTP 409 behavior; the admission policy does not change order-state rules.

`ROUTER_TRUST_PROXY` accepts only `none` (default) or `loopback`. Authentication limits use Express's resolved `req.ip`; without trust, client-supplied `X-Forwarded-For` cannot create a fresh limit bucket. In loopback mode, only loopback proxy hops are trusted. The reverse proxy must overwrite incoming `X-Forwarded-For` with the verified client address (not retain an untrusted supplied chain), and the Router must remain reachable only through that proxy. This mode is for a local reverse proxy, not arbitrary remote proxy addresses. CORS is not a spending quota: non-browser API clients can omit `Origin`.

## Buyer API

- `POST /auth/challenge` with `{ "wallet": "0x..." }` returns a five-minute, one-use message.
- Sign that exact message with the buyer wallet, then `POST /auth/verify` with `{ "wallet", "nonce", "signature" }`. Its `token` is a one-day bearer session.
- Deposit native MON and establish a separate spending grant with the wallet through the market contract. The Router has no withdrawal or grant endpoint.
- `GET /account` reads the chain's currently available balance and remaining authorized spend.
- `POST /api-keys` with a wallet session and `{ "name": "demo" }` returns a `token` shown only once. Keys require an active spending grant and cannot manage other credentials or withdraw money.
- `GET /api-keys` and `DELETE /api-keys/:id` require a wallet session.
- `GET /v1/models` lists currently authenticated mock sellers and on-chain quotes.

```sh
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer $INFERPOOL_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: unique-example-001' \
  -d '{"model":"mock-reasoner","messages":[{"role":"user","content":"Hello"}],"max_tokens":200,"max_spend":"0.001","stream":true,"cache":true}'
```

`provider_id` optionally selects a seller. Otherwise matching uses the predicted total cost, including the requested output limit. `cache:true` enables buyer/seller/model/context-isolated simulated cache; a cache write is recorded only after success. `max_spend` and every rate use MON decimal strings with at most 18 decimal places. Rates are per million simulated tokens; combine all four products before rounding up once to one wei. Historical dUSD order strings keep their six-decimal asset identity.

SSE sends OpenAI-shaped text `data` chunks and additional `event: request` snapshots. A snapshot contains the complete current output, so consumers must either replace from snapshots or append text deltas; doing both duplicates the display. The last snapshot includes settlement status, followed by `[DONE]`. Closing an SSE stream never cancels the request. Query `GET /v1/requests/:id`, list `GET /v1/requests`, or explicitly `POST /v1/requests/:id/cancel` with the same buyer's credential. Current-market `Idempotency-Key` retries return the same order; changed arguments or a legacy-market key return HTTP 409. A legacy-key conflict identifies the old request for lookup and does not create a MON request.

`billConfirmed` is true only after the chain state is confirmed. Before that, `charge` and `released` are expected amounts. `reservation_unknown` means the reservation transaction could not be conclusively observed; no inference request is dispatched, and the Router keeps checking and waives fees if the reservation later appears. After an expired reservation, the buyer can reclaim directly through the contract even when the Router is unavailable.

## Mock provider protocol

Connect to `/provider` using WebSocket. Server sends `{type:"challenge",nonce,message,expiresAt}`. Respond with:

```json
{"type":"auth","address":"0x...","signature":"0x...","mock":true,"provider":{"id":"seller-a","name":"Seller A","modelId":"mock-reasoner","capacity":2,"mode":"normal","pricing":{"input":"1","cacheRead":"0.1","cacheWrite":"1.25","output":"2","minReserve":"0.01"}}}
```

The registered wallet must have an active on-chain quote; self-reported pricing never controls a bill. Send `heartbeat` at least every 10 seconds; 30 seconds without one disconnects the seller. After chain reservation confirmation, the Router sends `request` with `requestId`, `buyer`, `model`, `messages`, `maxTokens`, `cache`, and `usage` (`input`, `cacheRead`, `cacheWrite`, `output`). The seller sends `started`, `chunk`, `completed`, `failed`, or `cancelled`, each with `requestId`. A chunk uses zero-based monotonically increasing `seq` and `text`; completion's optional `seq` is the next sequence number. Output counters supplied by the seller are ignored. The Router counts actual accepted Unicode code points and truncates before any over-budget character. Duplicate chunks are ignored and sequence gaps fail the whole request for zero inference fees.

The Router can send `cancel` with `requestId` and `reason`. Provider disconnection ends in-flight orders; reconnecting requires a new signature and never replays an order.

## Verify

```sh
npm run test --workspace @inferpool/server
npm run typecheck
```

Unit tests cover settlement races, duplicate chunks, budget precision, chain authorization, cache isolation, authentication, late reservation reconciliation, restart recovery, persisted public-demo quotas, pause/replay behavior, trusted-proxy authentication limits, and optional static export routing with shared-port WebSocket/SSE. The root integration suite exercises the HTTP and provider protocol against actual local contracts.
