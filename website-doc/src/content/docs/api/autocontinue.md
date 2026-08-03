---
title: autocontinue.*
description: status, set, fire, pause, resume, audit — the auto-continue engine.
---

The [auto-continue](/features/auto-continue/) engine decides whether to nudge a
paused agent forward. Every decision is recorded in a rolling audit ring.

| Method | Params | Result |
|---|---|---|
| `autocontinue.status` | `{}` | current settings + engine state |
| `autocontinue.set` | `{ engine?, dryRun?, cooldownMs?, maxConsecutive?, modelName?, modelApiKeyEnv? }` | `{ autoContinue: AutoContinueSettings }` |
| `autocontinue.fire` | `{ surface_id?, notification_text? }` | `{ outcome }` — run one decision now |
| `autocontinue.pause` | `{ reason? }` | paused state |
| `autocontinue.resume` | `{}` | resumed state |
| `autocontinue.audit` | `{ limit? }` | `{ audit: AutoContinueAuditEntry[] }` (limit 1–50, default 20) |

**Safety defaults.** `engine` is `"off"` and `dryRun` is `true` out of the box,
so nothing is ever typed into a pane until you deliberately enable it. Each
field is validated against its own schema; unknown or wrongly-typed values are
ignored rather than applied.

See [`ht autocontinue`](/cli/autocontinue/) and the
[settings reference](/configuration/settings/#auto-continue).
