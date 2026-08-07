---
title: audit.*
description: list, run, fix — the built-in self-audits.
---

τ-mux runs a small set of environment canaries at startup (locale is UTF-8,
`bun` is on `PATH`, `$SHELL` exists, `git user.name` matches the expected
value). Results feed [`system.health`](/api/system/) and the sidebar.

| Method | Params | Result |
|---|---|---|
| `audit.list` | `{}` | `AuditResult[]` — every audit with its last result |
| `audit.run` | `{ id? }` | the refreshed `AuditResult` (or all of them without `id`) |
| `audit.fix` | `{ id }` | the `AuditResult` after attempting the audit's fix |

Not every audit is fixable; `audit.fix` on one that isn't returns its
unchanged result. The expected git user name is configured by
[`auditsGitUserNameExpected`](/configuration/settings/#audits) (`null`
disables that check).

See [`ht audit`](/cli/system/).
