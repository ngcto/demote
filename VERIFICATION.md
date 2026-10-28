# Verification — Demote 0.1.0

## Final implementation

Bun asynchronous gateway request/completion hooks, loopback per-attempt trace, authenticated Browser access management API. Earlier onUsage/routing-strategy prototype was discarded: ordinary failed attempts during successful failover do not enter the ledger. No gateway strategy is shipped.

## Executed checks

- `npm test`: 14 passed, 0 failed.
- `bun test test/controller.test.mjs test/page.test.mjs`: 14 passed, 0 failed (Bun 1.4.4).
- `node --check demote.hooks.mjs`, `node --check page/app.js`: passed.
- Real released Magpie CLI 0.1.1910, Linux arm64, downloaded from release assets and SHA-256 checked against `/api/latest`: `014894268d62dddd131da888927ed657d1fd7421fdb92d079b1c6d3924f316ef`.
- Real plugin host loaded the final hooks/page package without load errors.
- Isolated HOME with fake credentials + loopback HTTP upstream + authenticated web API: first request tried `fixture-dead` (401), then `fixture-good` (200); second request tried only `fixture-good`.
- Exact persisted provider readback after requests: primary `fixture-good`, final saved key `fixture-dead`, routing `order`.
- Settings page JavaScript exercised under a DOM/bridge fixture: default loading, scope/code save, invalid-code validation passed. Actual GUI visual rendering was not tested.
- Subscription account identity and arrangement tested using contract fixtures, not live vendor accounts. No production sign-ins or generation requests used.
- `npm pack --dry-run`: only expected runtime files, page, README, license and registry entry; no keys, logs, vendor bundles or dependencies.

## Limits

Browser access is a prerequisite. The plugin only reconciles on request/completion callbacks; trace eviction and dropped completion callbacks can miss failures. Uses internal source-backed APIs rather than a stable SDK. Physical arrangement can switch subscription primary sign-ins, and default enforceOrder changes the affected provider routing. Existing affinity/pins/groups can supersede order. Saved changes remain when the plugin is disabled. These are documented in README and the settings page.

Not published to npm or a public marketplace. Source folder installation is the delivered path.
