# InferPool Router

The Router authenticates buyers and independent mock providers, reserves each request on the configured chain, meters simulated Unicode tokens, and settles the final four usage categories. Inference and responsibility decisions are centralized. `anvil` and `monad-testnet` adapters use real chain receipts. `memory` is an explicit unit-test helper and creates no transactions.

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

## Buyer API

- `POST /auth/challenge` with `{ "wallet": "0x..." }` returns a five-minute, one-use message.
- Sign that exact message with the buyer wallet, then `POST /auth/verify` with `{ "wallet", "nonce", "signature" }`. Its `token` is a one-day bearer session.
- Deposit tokens and establish a spending grant with the wallet through the market contract. The Router has no withdrawal or grant endpoint.
- `GET /account` reads the chain's currently available balance and remaining authorized spend.
- `POST /api-keys` with a wallet session and `{ "name": "demo" }` returns a `token` shown only once. Keys require an active spending grant and cannot manage other credentials or withdraw money.
- `GET /api-keys` and `DELETE /api-keys/:id` require a wallet session.
- `GET /v1/models` lists currently authenticated mock sellers and on-chain quotes.

```sh
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer $INFERPOOL_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: unique-example-001' \
  -d '{"model":"mock-reasoner","messages":[{"role":"user","content":"Hello"}],"max_tokens":200,"max_spend":"0.10","stream":true,"cache":true}'
```

`provider_id` optionally selects a seller. Otherwise matching uses the predicted total cost, including the requested output limit. `cache:true` enables buyer/seller/model/context-isolated simulated cache; a cache write is recorded only after success. `max_spend` and every rate use decimal strings with at most six decimal places.

SSE sends OpenAI-shaped text `data` chunks and additional `event: request` snapshots. A snapshot contains the complete current output, so consumers must either replace from snapshots or append text deltas; doing both duplicates the display. The last snapshot includes settlement status, followed by `[DONE]`. Closing an SSE stream never cancels the request. Query `GET /v1/requests/:id`, list `GET /v1/requests`, or explicitly `POST /v1/requests/:id/cancel` with the same buyer's credential. `Idempotency-Key` retries return the same order; changed arguments under the same key return HTTP 409.

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

Unit tests cover settlement races, duplicate chunks, budget precision, chain authorization, cache isolation, authentication, late reservation reconciliation and restart recovery. The root integration suite exercises the HTTP and provider protocol against actual local contracts.
