# Demote

Magpie plugin `demote`, display name **Demote**. Keeps each provider’s **persisted** credential order in three tiers: **available → soft-demoted → hard-demoted**. Defaults to every provider, including ones added later. Supports API-key providers, built-in subscription accounts, and provider-plugin accounts through Magpie’s account-arrangement API.

## Install

Install directly from GitHub:

```sh
magpie plugin add github:ngcto/demote
```

Or clone/download this repository and install its folder:

```sh
magpie plugin add /absolute/path/to/demote
```

In the **native desktop app**, enable **Settings → Network and sharing → Browser access**, preferably local-only. The web UI intentionally hides that setting: browser access is already running there. Demote reads the existing local management configuration; it does **not** enable Browser access itself. The management key grants broad settings access: install only trusted code.

For terminal/server use, run `magpie serve --web` with `MAGPIE_WEB_KEY` supplied securely in the process environment. Demote inherits that key. Alternatively use `DEMOTE_WEB_KEY`. Never put the management key in plugin options. Set `webPort` if the web port is not 3430; `gatewayUrl` can specify a nondefault gateway origin. Only plain HTTP loopback origins are accepted; credential-bearing redirects are refused.

Open the **Demote** page to edit provider scope, error codes and ordering behavior, or:

```sh
magpie plugin options demote '{"providers":"*","softErrorCodes":[429],"hardErrorCodes":[401,402,403],"enforceOrder":true}'
magpie plugin options demote '{"providers":["openai","my-relay"],"softErrorCodes":[429],"hardErrorCodes":[401,402],"enforceOrder":true}'
```

No per-provider setup is needed. A provider is changed only after a matching observed failure.

## Defaults

- `providers: "*"`: all providers. An array selects exact provider IDs; `[]` selects none.
- `softErrorCodes: [429]`: rate limits move a credential below available credentials but above hard-demoted credentials.
- `hardErrorCodes: [401,402,403]`: refused authentication, billing/quota and forbidden access move a credential to the lowest tier.
- Each array **replaces** its own defaults; `[]` disables that tier’s matching. If a code appears in both lists, **hard wins**. A later soft error never downgrades a hard demotion. A later hard error upgrades a soft demotion.
- Within a tier, other credentials retain their order and the newly/repeatedly failing credential moves to the end of its tier.
- `enforceOrder: true`: after a qualifying failure, set that provider’s routing to `order`, so available credentials go before soft, and soft before hard. `false` keeps its routing but smart/rotation/weight/usage policies can override the saved credential order.
- `webPort`: auto-detect an enabled desktop Browser access port, otherwise 3430.
- `gatewayUrl`: use `MAGPIE_ADDR`, otherwise `http://127.0.0.1:3425`.

400/404/422 often mean a request or model problem, not a dead account. Transient 5xx errors are not included. 403 can also mean model-specific permission, and 429 can be temporary; remove them if that is undesirable for your providers. Only HTTP status matching is supported—not arbitrary vendor JSON error codes.

## Behavior and side effects

Demote reads finished attempts from Magpie’s local routing trace before routing a request and after completion. That includes a dead credential that failed **even when a later credential succeeded**. Magpie’s `onUsage` hook alone misses those common failover failures, so it is not used.

Changes are serialized and verified by exact provider readback. Other credentials retain relative order where possible; disabled credentials remain disabled and are never promoted. A lone credential or a provider with no enabled alternative has its tier remembered but its order is left alone; ambiguous identities and removed/off providers are skipped. No keys are fetched/revealed, deleted, or disabled. No conversations, traces or secrets are written to disk or logged. Tier metadata is stored atomically in `demote-state.json` in Magpie’s config directory, mode `0600`. It contains provider IDs, credential fingerprints or subscription user identifiers, and tiers—not API keys or tokens.

Orders and tier classifications survive restarts. They do not expire or auto-promote on success. To reset classifications, stop Magpie, delete `demote-state.json` in its config directory, then manually restore the desired credential order before restarting. Changing status-code options does not clear existing tiers. Corrupt/unwritable tier state stops demotion changes rather than silently forgetting hard classifications. Turning the plugin off stops future changes but **does not restore** saved order or routing.

**Subscription account promotion may switch the agent’s actual primary sign-in**, as Magpie’s own Make first operation does. Set Magpie’s **Keep login** policy first if that should remain unchanged. The plugin does not alter Keep login, affinity, groups, quotas or credential eligibility.

## Upgrading from 0.1

Legacy `errorCodes` subsets remain supported when neither new tier array is set: 429 maps to soft, every other legacy code maps to hard. Saving in the settings page replaces the legacy field with the two new fields. Earlier physical demotions cannot be classified retroactively because 0.1 did not store error identities; tiers start with newly observed failures.

## Limits

Tested against Magpie **0.1.1910**. Uses source-backed local management/trace endpoints, not a stable public demotion SDK. Browser access is required. With it unavailable, Magpie fails open and requests continue; hook diagnostics report the error.

Observation is best-effort: the trace retains a bounded recent history, completion hooks can be dropped, and there is no persistent polling worker. Reconciliation occurs at the next request if completion observation was missed. Bootstrap/reload ignores already-finished historical attempts. Errors inside a provider’s own internal retries, requests bypassing Magpie, pinned/strict-affinity routing, or attempts evicted before observation are not guaranteed. Changes do not rewrite a request’s already-built candidate list. There is no CAS on arrangement: concurrent external management edits remain a host limitation.

## Verification

```sh
npm test
bun test test/*.test.mjs
# Disposable sandbox only; MAGPIE_TEST_BIN must name an installed CLI:
MAGPIE_TEST_BIN=/path/to/magpie MAGPIE_TEST_HOME=/path/to/disposable/sandbox \
  MAGPIE_TEST_BUN=/path/to/actual/bun python3 test/live-smoke.py
```

The smoke script creates fake keys and a loopback upstream in the disposable HOME, starts/stops a real gateway with its authenticated web API, verifies a 401 hard demotion, restarts the real gateway, then verifies a 429 soft demotion stays above the hard credential and below the available credential. It reads back saved order, tier state, private state permissions, and `order` routing. It never uses production credentials. Node/Bun tests cover account identity, scopes, defaults, custom codes, snapshots, readback, cancellation and concurrency. See `VERIFICATION.md`.

The archive is source-installable; it has not been published to npm or submitted to the community registry. `registry-entry.json` provides the requested marketplace display name if published later.
