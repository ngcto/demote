# Demote

Magpie plugin `demote`, display name **Demote**. Moves a failing credential to the end of its provider’s **persisted** credential order. Defaults to every provider, including ones added later. Supports API-key providers, built-in subscription accounts, and provider-plugin accounts through Magpie’s account-arrangement API.

## Install

Install directly from GitHub:

```sh
magpie plugin add github:ngcto/demote
```

Or clone/download this repository and install its folder:

```sh
magpie plugin add /absolute/path/to/demote
```

Enable **Settings → Network and sharing → Browser access**, preferably local-only. Demote reads the existing local management configuration; it does **not** enable Browser access itself. The management key grants broad settings access: install only trusted code.

For terminal/server use, run `magpie serve --web` with `MAGPIE_WEB_KEY` supplied securely in the process environment. Demote inherits that key. Alternatively use `DEMOTE_WEB_KEY`. Never put the management key in plugin options. Set `webPort` if the web port is not 3430; `gatewayUrl` can specify a nondefault gateway origin. Only plain HTTP loopback origins are accepted; credential-bearing redirects are refused.

Open the **Demote** page to edit provider scope, error codes and ordering behavior, or:

```sh
magpie plugin options demote '{"providers":"*","errorCodes":[401,402,403,429],"enforceOrder":true}'
magpie plugin options demote '{"providers":["openai","my-relay"],"errorCodes":[401,402,429],"enforceOrder":true}'
```

No per-provider setup is needed. A provider is changed only after a matching observed failure.

## Defaults

- `providers: "*"`: all providers. An array selects exact provider IDs; `[]` selects none.
- `errorCodes: [401,402,403,429]`: refused authentication, billing/quota, forbidden access, rate limit. Custom arrays **replace** defaults; `[]` disables matching.
- `enforceOrder: true`: after a qualifying failure, set that provider’s routing to `order`, so the demoted credential is tried last. `false` keeps its routing but smart/rotation/weight/usage policies can override the saved credential order.
- `webPort`: auto-detect an enabled desktop Browser access port, otherwise 3430.
- `gatewayUrl`: use `MAGPIE_ADDR`, otherwise `http://127.0.0.1:3425`.

400/404/422 often mean a request or model problem, not a dead account. Transient 5xx errors are not included. 403 can also mean model-specific permission, and 429 can be temporary; remove them if that is undesirable for your providers. Only HTTP status matching is supported—not arbitrary vendor JSON error codes.

## Behavior and side effects

Demote reads finished attempts from Magpie’s local routing trace before routing a request and after completion. That includes a dead credential that failed **even when a later credential succeeded**. Magpie’s `onUsage` hook alone misses those common failover failures, so it is not used.

Changes are serialized and verified by exact provider readback. Other credentials retain relative order where possible; disabled credentials remain disabled and are never promoted. A lone credential, an ambiguous identity, a removed/off provider, or a provider with no enabled alternative is left alone. No keys are fetched/revealed, deleted, or disabled. No conversations, traces or secrets are written to disk or logged by this plugin.

Demotions are durable. They do not expire or auto-promote on success. Manually arrange accounts to restore priority. Turning the plugin off stops future changes but **does not restore** saved order or routing.

**Subscription account promotion may switch the agent’s actual primary sign-in**, as Magpie’s own Make first operation does. Set Magpie’s **Keep login** policy first if that should remain unchanged. The plugin does not alter Keep login, affinity, groups, quotas or credential eligibility.

## Limits

Tested against Magpie **0.1.1910**. Uses source-backed local management/trace endpoints, not a stable public demotion SDK. Browser access is required. With it unavailable, Magpie fails open and requests continue; hook diagnostics report the error.

Observation is best-effort: the trace retains a bounded recent history, completion hooks can be dropped, and there is no persistent polling worker. Reconciliation occurs at the next request if completion observation was missed. Bootstrap/reload ignores already-finished historical attempts. Errors inside a provider’s own internal retries, requests bypassing Magpie, pinned/strict-affinity routing, or attempts evicted before observation are not guaranteed. Changes do not rewrite a request’s already-built candidate list. There is no CAS on arrangement: concurrent external management edits remain a host limitation.

## Verification

```sh
npm test
bun test test/controller.test.mjs
# Disposable sandbox only; MAGPIE_TEST_BIN must name an installed CLI:
MAGPIE_TEST_BIN=/path/to/magpie MAGPIE_TEST_HOME=/path/to/disposable/sandbox \
  MAGPIE_TEST_BUN=/path/to/actual/bun python3 test/live-smoke.py
```

The smoke script creates fake keys and a loopback upstream in the disposable HOME, starts/stops a real gateway with its authenticated web API, verifies successful failover, then reads back the promoted good key, demoted bad key, and `order` routing. It never uses production credentials. Node/Bun tests cover account identity, scopes, defaults, custom codes, snapshots, readback, cancellation and concurrency. See `VERIFICATION.md`.

The archive is source-installable; it has not been published to npm or submitted to the community registry. `registry-entry.json` provides the requested marketplace display name if published later.
