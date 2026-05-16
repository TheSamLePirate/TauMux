# Phase 6 — Lifecycle regression tests

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase6.md`
**Status:** In progress — started 2026-05-17.
**Owner:** platform.
**Engineer-weeks:** ~1.0 (high confidence).
**Lifts:** Pi agent already at A from Phase 3 (covers L1's typing); this phase adds the runtime regression. ht CLI A → S, Settings persistence B+ → A (per the existing master-plan lifts).

---

## Discovery

Phase 0 shipped 15 regression tests covering L1..L14 (per `phase0_audit_matrix.md`). Most are source-grep tests pinning the fix shape. The master-plan intent for P6 is **behavioural** tests: spawn the failure mode, assert the fix prevents it, prove a revert breaks the test.

The biggest remaining gap is the rank-1 outstanding top-blocker: **L1 — verify `PiAgentManager._managerExit` cleanup under crash**. The Phase 0 unit test asserts the `_managerExit` field exists and that `addInstance` wires it up; it doesn't drive a real subprocess crash and observe the cleanup.

P6's job: close that gap + catalogue every L# fix in a single index doc so a reviewer can audit the lifecycle leg in one pass.

---

## Steps

### Step 1 — L1 forced-crash regression test

Spawn a fake pi process that exits with non-zero after a short delay. Assert:
- `_managerExit` fires with the right surfaceId.
- The instance is removed from `PiAgentManager.instances` (subsequent `getAgent(id)` returns null).
- The `agentSurfaceCrashed` RPC is sent.

Uses a controlled stub for `Bun.spawn` so no real `pi` binary is required.

### Step 2 — L3+L5 behavioural test upgrade

Phase 0's `tests/web-ws-heartbeat.test.ts` is source-grep only. Upgrade with:
- A stub for `Math.random` that returns 0.0 and 1.0 across calls; assert the jitter distribution covers the documented ±25 % range.
- A behavioural test that calls the `connect()` → `onclose` → reconnect-scheduling code path and observes the delay computed against the stub.

### Step 3 — `tests/regressions/README.md` catalogue

A single index doc that lists every L# / S# / U# / A# / T# fix with:
- The triple-A id
- A one-line summary
- file:line where the fix lives
- The test file:test-name that catches regressions

Plus a `tests/regressions/catalogue.test.ts` that parses the README and asserts each test name exists in the suite. Without that gate the doc could drift; with it, removing a test deletes its catalogue row.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | A pi process spawned via stub Bun.spawn that exits 1 triggers manager.removeAgent + agentSurfaceCrashed. Reverting `_managerExit` breaks the test. |
| 2 | Jitter distribution test runs against deterministic Math.random; both ±25 % bounds asserted. |
| 3 | `tests/regressions/README.md` catalogues ≥ 20 fixes; `tests/regressions/catalogue.test.ts` parses it and asserts every named test exists. |

---

## Lifts to track in `feature_grades.json`

- `pi-agent` stays at A (already lifted in Phase 3 with the composing-module tests; this phase makes the L1 invariant behaviourally tested).
- `ht-cli` A → S (all lifecycle items it depends on — buffer cap, heartbeat, jitter, shutdown — now behaviourally tested).
- `settings-persistence` B+ → A (atomic-write + mode + corrupt-file recovery all tested).

---

## Open questions

1. **Stubbing `Bun.spawn`** — the cleanest path is dependency injection (`PiAgentManager` takes a `spawn` opt). Today it imports Bun directly. Refactor in this phase or stub via module patching?
   - Decision: minimal refactor — add an opt parameter for the spawn function, default to `Bun.spawn`. Tests inject a stub.

2. **L3+L5 behavioural test scope** — the actual WS heartbeat involves real network. We test the *math* deterministically; the network half (server-side `idleTimeout`) is pinned via source-grep (already done in Phase 0).

---

## Exit criteria

- L1 forced-crash regression test passes; reverting the fix makes it fail.
- L3+L5 behavioural jitter test passes deterministically.
- `tests/regressions/README.md` exists and `tests/regressions/catalogue.test.ts` passes.
- `bun test` green; `bun run report:feature-grades:check` green.
