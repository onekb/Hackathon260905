# InferPool Router

The Router authenticates buyers and independent mock providers, reserves each request on the configured chain, meters simulated Unicode tokens, and settles the final four usage categories. Inference and responsibility decisions are centralized. `anvil` and `monad-testnet` adapters use real chain receipts. `memory` is an explicit unit-test helper and creates no transactions.

## Asset and migration boundary

Current source uses native test MON: market `0x142a4904307244Bed0cECD72dE8329A253333182`, 18-decimal wei, with a separate `TOKENS_PER_MILLION = 1_000_000` billing divisor. The new contract is deployed and verified; public 0a82030 uses this native market, with live config/models verified and one native API/SSE/settlement request and browser login/account reads verified; independent buyer B has subsequently completed MON deposit/grant and normal/failure browser requests with fixed-block RPC verification; browser frame-by-frame streaming was not captured. See [deployment evidence](../contracts/deployments/inferpool-mon-native-testnet.json) and [live progress](../docs/progress.md).

Buyers call payable `deposit()` with MON value, then separately `authorizeRouter(limit, expiresAt)`; no ERC-20 approve is required. Withdrawal is a native transfer; settlement credits the seller's internal withdrawable balance. Existing dUSD and its spending grants do not become MON or authorize the new market.

Current orders and `/config` identify the native `market_address`, `asset_symbol=MON` and `asset_decimals=18`. D17 removes legacy asset configuration and read compatibility. Before cutover, reconcile/stop the old writer and retain its full ledger privately; initialize a MON-only active ledger without old orders, API keys, sessions, idempotency mappings or cache. That migration retained buyer + createdAt attempt history. D19 now requires removing demo quotas while keeping that field as history; do not clear orders, credentials or the ledger to remove limits. The cancellation release 0a82030 is deployed; source/configuration checks confirmed removal while preserving the full ledger.

Old platform credentials are not migrated; the Para wallet stays the same, but users may need a new wallet-signature login and a new MON Key under a valid MON grant. Wallet-session request/cancel mutations also require `X-InferPool-Market` to exactly match the current market; missing or stale values return HTTP 409. The product has no legacy balance/withdraw/reclaim controls. Old chain records remain immutable historical evidence; this migration does not redeem, burn or withdraw those assets. MON-only cleanup and public cutover are complete; API/SSE/browser acceptance is recorded separately in progress.

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

## Demo limits removal and remaining safeguards

The user explicitly requested removing daily and cumulative request limits and the additional per-wallet/global demo concurrency gates, then committing and updating the live service. This is [D19](../docs/requirements-and-decisions.md#d19--取消演示次数与额外并发限制), superseding D14's engineering defaults. Implementation, local regression and deployment are complete; 0a82030 is live. The staged Linux request-guards/native-ledger suites passed 18/18, and the running source hashes and absence of the retired settings were verified.

The new interface removes `DemoAdmission`, `DEMO_LIMITS`, the fourth `Engine` constructor argument and parsing of `DEMO_ADMISSION_ENABLED`, `DEMO_ADMISSION_START_UTC` and `DEMO_NEW_ORDERS_ENABLED`. No replacement pause switch is added. Old variables have no meaning in the new code; deployment has removed them from the live environment. The retired one-time `deploy/switch-native.py` migration refuses execution and must not be used for routine releases.

Per-request budgets, available escrow, unexpired wallet spending grants and actual seller capacity still apply. Authentication, idempotency and order-state rules remain in place. Existing orders, credentials and `admissionHistory` are retained; historical attempts will no longer count toward admission. This does not grant unlimited funds, make requests free or create more seller capacity. Root tests 97/97, root and new-test type checks pass. Ten [request-guard tests](test/request-guards.test.ts) replace the old demo-quota suite: 15 history records do not block three concurrent same-wallet/four total requests, or a thirteenth request after twelve and a restart. Real resource and funding guards remain tested; no real requests were issued in this release, and final live status is recorded in [progress](../docs/progress.md).

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

`provider_id` optionally selects a seller. Otherwise matching uses the predicted total cost, including the requested output limit. `cache:true` enables buyer/seller/model/context-isolated simulated cache; a cache write is recorded only after success. `max_spend` and every rate use MON decimal strings with at most 18 decimal places. Rates are per million simulated tokens; combine all four products before rounding up once to one wei. Archived dUSD records are outside the active MON product.

SSE sends OpenAI-shaped text `data` chunks and additional `event: request` snapshots. A snapshot contains the complete current output, so consumers must either replace from snapshots or append text deltas; doing both duplicates the display. The last snapshot includes settlement status, followed by `[DONE]`. Closing an SSE stream never cancels the request. Query `GET /v1/requests/:id`, list `GET /v1/requests`, or explicitly `POST /v1/requests/:id/cancel` with the same buyer's credential. Current-market `Idempotency-Key` retries return the same order; changed arguments return HTTP 409. D17 does not import old credentials or idempotency mappings, so an old client cannot reuse its old authentication to create a MON charge.

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

Unit tests cover settlement races, duplicate chunks, budget precision, chain authorization, cache isolation, authentication, late reservation reconciliation, restart recovery, idempotent replay, trusted-proxy authentication limits, and optional static export routing with shared-port WebSocket/SSE. The root integration suite exercises the HTTP and provider protocol against actual local contracts.
