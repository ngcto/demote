# Verification — Demote 0.2.0

## Implementation

Bun request/completion hooks read the loopback per-attempt trace and use authenticated web management APIs. Credential tiers are available (0), soft (1), hard (2); default HTTP codes are soft `[429]`, hard `[401,402,403]`. Hard dominates overlapping codes and cannot be weakened by a subsequent soft failure. Persisted tier intent is written atomically before remote changes; exact credential order and enabled flags are read back.

## Executed checks

- `npm test`: 27 passed, 0 failed.
- `bun test test/*.test.mjs`: 27 passed, 0 failed (Bun 1.4.4).
- Controller regressions cover both soft/hard observation orders, multiple failures, repeated failures, upgrades/no-downgrade, persisted restart, custom code overlap, legacy migration, disk failure, corrupt state, removed/single credentials, scope, disabled credentials, readback and cancellation/concurrency.
- State store exercised with actual files: round-trip after fresh store construction, mode 0600, atomic replacement without temporary residue, corrupt JSON error.
- Settings page JavaScript exercised with DOM/bridge fixtures: separate defaults, save validation, legacy migration. Visual GUI rendering not tested.
- Real released Magpie CLI 0.1.1910, Linux arm64: isolated HOME, fake credentials, loopback mock upstream, authenticated `serve --web`.
- First request: fixture-dead returns 401, fixture-soft succeeds. Saved order becomes `[fixture-soft, fixture-good, fixture-dead]`; hard tier persisted.
- Restarted the actual gateway and plugin host. fixture-soft then returns 429, fixture-good succeeds. Exact saved order readback: `[fixture-good, fixture-soft, fixture-dead]`, tiers `[1,2]`, routing `order`, state file mode 0600.
- Actual plugin host loads final hooks/page without errors. No production credentials or vendor requests used; live subscription switching is untested.

## Remaining constraints

Requires authenticated local web management. Trace/callback delivery is best effort and bounded; no reliable per-attempt public SDK. Saved order may be overridden by affinity/pins/groups or by retaining non-order routing. Subscription arrangement can switch primary sign-ins. Tiers never auto-recover; manual reset documented. Old 0.1 demotions cannot be retroactively classified. Local state is intended for one gateway/plugin host; multiple concurrent processes sharing the config file have no interprocess CAS/lock. Host account arrangement also has no CAS against external edits.

Not published to npm or a public marketplace. GitHub source installation is supported.
