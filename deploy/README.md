# Public deployment and HTTPS handoff

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

These files are templates plus a deployment progress record, **not evidence of a running public Demo**. The owner selected `demo.example.com` and will configure HTTPS. The application will expose one HTTP endpoint, `127.0.0.1:8788`, to the existing same-host OpenResty proxy. No certificate, nginx or 1Panel setting has been changed by the application deployment work.

On 2026-09-05, remote DNS resolved the selected domain to the intended host. Node.js v22.23.2 and `@alchemy/cli@0.24.0` were independently installed; Linux `npm ci` completed with 775 packages and the CLI installation added 178 packages. The selected release is `/srv/inferpool/releases/319c6b9`, linked from `/srv/inferpool/current`, with the matching ABI and Web export built for `https://demo.example.com`. Release files are root-owned and read-only to the service user. The shared-port code passed review, 82 tests and type checks; commit `319c6b9` has been pushed to `origin/main` over SSH.

Both service units and private environment files are installed. `systemd-analyze verify` exited 0, with compatibility warnings concerning existing host units and no new-unit errors; those existing units were not changed. `daemon-reload` completed, but neither new unit has been started or enabled. The configured fixed admission epoch is `2026-09-05T06:22:02Z`. New-device login completed successfully. A new `inferpool-router-linux` wallet-session request is awaiting the owner’s approval; no valid remote wallet session exists yet. The old local Router remains running and the 14-order ledger has not moved. Package installation, unit validation and public artifact checks do not establish signer or service readiness; exact hashes and checks are in [docs/progress.md](../docs/progress.md).

A read-only check run as the actual Linux service user exited 0: static export path, fixed admission epoch, loopback proxy mode, Monad chain 10143 and the contract's fixed Router address all matched. `router.env` is mode 600. Router gas was `0.992516012 MON` at block `59833890`. No signing or broadcast occurred; this snapshot does not establish wallet-session approval or future gas sufficiency.

## Runtime choice

The Web is exported as static files. The Express 5 Router requires one long-running Node.js 22+ process, an authorized Alchemy CLI session, and a persistent private ledger directory. With `WEB_STATIC_DIR` it serves Web, HTTP APIs, SSE and WebSocket together. No Next.js server is needed. Keep one Router for the existing deployed Router identity and ledger; do not launch a second copy while the local instance can still accept orders.

The selected layout uses **one upstream for every path**: the owner's HTTPS proxy forwards to `http://127.0.0.1:8788`. The existing OpenResty instance has been checked to use host networking, so its loopback reaches the application on this host. A proxy in a different container network would need a different, explicitly checked upstream; do not generalize this loopback address to every proxy installation. A temporary tunnel alone does not satisfy the competition's long-term availability requirement.

Cloudflare Quick Tunnels do not support the SSE stream this app uses. Render Free cannot persist the Router's local ledger across restarts. Those services require a different arrangement before they can host this backend safely. See [Cloudflare Tunnel documentation](https://developers.cloudflare.com/tunnel/setup/) and [Render Free limitations](https://render.com/docs/free).

## Build the frontend

Set the real public Router HTTPS origin and the existing **frontend** Para key in the ignored `web/.env.local` (or your build environment). Do not use a secret Para key, Alchemy session, RPC credential or wallet key in any `NEXT_PUBLIC_` variable.

```sh
INFERPOOL_STATIC_EXPORT=true INFERPOOL_PUBLIC_BUILD=true npm run build --workspace web -- --webpack
```

This writes only deployable Web assets to `web/out/`; it does not export the Router or private ledger. The public-build check requires a multi-label HTTPS DNS origin and the Para frontend key; it rejects IP literals (including mapped IPv6), local names, credentials and URL paths. It does not verify DNS resolution or service reachability; check those separately. Changing `NEXT_PUBLIC_ROUTER_URL` requires another build. Regular `npm run dev:web` / `npm run build:web` retain the existing Next.js behavior when these flags are absent.

The explicit webpack path was used for local export validation because this machine's Turbopack CSS helper could not bind its compilation port. The Para package emits warnings for optional account-abstraction integrations that this app does not enable; the build still completes. Public wallet and API checks remain required after the actual public origin is configured.

The two routes are `/` and `/provider-connect/`. Serve real exported files and route directories; do not rewrite API errors to `index.html`. Check the new frontend origin in the Para project configuration and verify wallet login after deployment.

## Prepare the application service

1. Choose the permanent public origin and persistent service directory. Install Node dependencies and the Alchemy CLI in the service user's environment. The Router also reads `contracts/out/InferenceMarket.sol/InferenceMarket.json`, which is ignored by Git and is **not** generated by `npm ci`. On the build host, install Foundry, run `npm run setup:contracts` and `forge build --root contracts`, then include that matching public ABI artifact at the same relative path in the release (or compile it on the server). Authorize the same intended Router identity through the supported session flow; never put a session token into a public image, repository or command transcript.
2. Before moving the existing service, stop admission of new orders and reconcile every in-flight/uncertain order. Stop the old Router, take a private backup, and move its ledger with owner-only permissions. Do not start the target with an empty replacement ledger.
3. Use `/srv/inferpool/current` to select the final release. Copy `router.env.example` to `/srv/inferpool/state/router.env`, with owner `inferpool` and mode 0600. Set the real fixed `DEMO_ADMISSION_START_UTC` once and retain it on restarts. `WEB_STATIC_DIR=/srv/inferpool/current/web/out` must refer to a valid public export; keep it separate from the private state. Exact admission rules are in [Router README](../server/README.md).
4. Start **one** service from the repository root with its authorized Alchemy session available on `PATH`:

   ```sh
   /opt/inferpool/node/bin/node --env-file=/srv/inferpool/state/router.env --import tsx server/src/index.ts
   ```

5. Install and verify the supplied service units after preparing their configuration, but keep them stopped until the remote signer is approved and the original ledger has been migrated. Validate the installed units on Linux with `systemd-analyze verify` before `daemon-reload`. This target has completed verification and reload; start/enable have not been performed. Existing-host compatibility warnings were left untouched and no new-unit errors were reported.
6. Hand the single HTTP endpoint to the owner for the HTTPS configuration below. After HTTPS works, update each seller's `--router` to `wss://demo.example.com/provider`. The public domain is part of the challenge, so fresh seller authentication is required. A loopback `ws://` URL fails the seller's exact domain check and cannot substitute for this step. The browser-wallet seller's `--wallet-ui` must use a Web build pointing to the same Router origin. Keep seller consoles on loopback, outside the proxy.

| Template / path | Purpose |
| --- | --- |
| [inferpool-router.service.example](inferpool-router.service.example) | Router unit, runtime user `inferpool`, selected release `/srv/inferpool/current` |
| [inferpool-provider.service.example](inferpool-provider.service.example) | Seller A using `--alchemy-session`; requires working public WSS, console only on loopback 8793 |
| [router.env.example](router.env.example) / [provider.env.example](provider.env.example) | Separate owner-only environment files; both use the same new Linux signing session |
| `/srv/inferpool/state` | Mode 0700 private directory; ledger `router-state.json`, signer config `alchemy/config.json`, environment files mode 0600 |
| `/opt/inferpool/node/bin/node` / `/opt/inferpool/tools/bin/alchemy` | Independent Node runtime and Alchemy CLI 0.24.0 tooling paths; verify installed versions before use |

Both units run as `inferpool`; sharing that user and state access is not process-level credential isolation. Plan restarts by pausing new admission and allowing orders to settle. Router shutdown has a 240-second grace period and Provider 20 seconds, but these values do not replace ledger reconciliation. Never start with an empty ledger as a shortcut.

## HTTPS proxy handoff to the owner

The owner handles TLS and the existing proxy configuration. The application team provides the following values; the endpoint still needs its actual service/readiness check before it is declared usable.

| Setting | Value / requirement |
| --- | --- |
| Public origin | `https://demo.example.com` |
| HTTP upstream | `http://127.0.0.1:8788` on the same host |
| Paths | Forward the entire site without stripping paths: Web pages, `/_next/` assets, APIs and `/provider` all share this upstream |
| WebSocket | Preserve HTTP/1.1 Upgrade/Connection handling for `/provider` |
| SSE | Disable response buffering/caching and permit a long upstream read interval; do not automatically retry write requests |
| Forwarded identity | Preserve the public host/protocol and overwrite `X-Forwarded-For` with the verified client address; do not trust a client-supplied chain |
| Router reachability | Keep 8788 bound to loopback; `ROUTER_TRUST_PROXY=loopback` assumes the checked same-host proxy, not arbitrary remote forwarding |

`nginx.conf.example` remains an uninstalled reference for a split static/API layout. Do not apply it unchanged to this selected whole-site single-upstream layout or overwrite the owner's existing sites. There have been no TLS/1Panel changes. The owner's proxy validation and HTTPS readiness are separate from the application tests.

The owner’s proxy should disable response buffering and retrying writes, preserve WebSocket upgrade headers, and allow at least 240 seconds without upstream data. This includes the initial on-chain reservation wait before SSE headers are sent. See [nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) and [proxy module documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

### A separate authorized signing session on the server

Use the official [Alchemy headless login flow](https://www.alchemy.com/docs/alchemy-cli#headless-and-remote-environments) with the service user's private configuration directory. The owner completes login and wallet-session approval in their browser. The installed local CLI version verified for these commands is `@alchemy/cli@0.24.0`.

```sh
ALCHEMY_CONFIG=/srv/inferpool/state/alchemy/config.json alchemy auth login --device-code
ALCHEMY_CONFIG=/srv/inferpool/state/alchemy/config.json alchemy wallet connect --mode session --instance-name inferpool-router-linux
ALCHEMY_CONFIG=/srv/inferpool/state/alchemy/config.json alchemy --json --no-interactive wallet status --verify
```

Run these as the same service user, not through a different home/configuration. Do not add `--force`. Verify the approved wallet is exactly the existing Router address `0xAc801eEC099C65A605B809b98A09A62674614A08`, the session is valid and permits `evm.signTransaction`, and record only its non-secret expiry. The contract fixes the Router identity; changing an environment variable to another wallet does not replace it. `ALCHEMY_AUTH_TOKEN` alone is not a delegated wallet session.

The session expires (CLI default request: seven days; the approved expiry is authoritative), so persistent hosting still requires renewal and monitoring. Do not copy the Mac's authentication files to the server as a shortcut. The CLI installation and new-device login are complete; the login token is retained only in the private server configuration. The separate wallet-session request is still awaiting approval, so login has not established signing readiness. No remote wallet-session approval or verified signing readiness is claimed. Device codes and credential-bearing approval URLs must not enter these documents.

## Verify before sharing

Check the public Web on a device outside the host: assets and `/provider-connect/`, `/config` with Monad chain ID 10143 and the expected contracts, online offers, wallet login, and seller WSS authentication. Then make one bounded inference request and confirm incremental SSE output and its chain receipt. Repeat the same idempotency key to confirm no second order, and check that request limits reject new attempts without consuming funds. Existing testnet evidence does not prove these public proxy paths work.

Record the actual URLs, deployment time, host lifetime, verified checks and limitations in `docs/progress.md`. Keep the private ledger, raw authentication data and local console addresses out of public artifacts.
