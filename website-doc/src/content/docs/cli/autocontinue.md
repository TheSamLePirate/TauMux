---
title: Auto-continue
description: ht autocontinue — drive the auto-continue engine. Inspect status, view the audit log, set the engine mode, fire / pause / resume per surface.
sidebar:
  order: 12
---

`ht autocontinue` controls the [auto-continue engine](/features/auto-continue/) — the piece that decides whether to auto-send `Continue` to an agent on every turn-end notification. The CLI exposes everything the Settings panel exposes plus per-surface controls (manual fire, pause, resume) that the UI doesn't have.

## autocontinue status

```bash
ht autocontinue status
# engine          heuristic
# dryRun          false
# cooldownMs      3000
# maxConsecutive  5
# model           anthropic/claude-haiku-4-5-20251001
# apiKeyEnv       ANTHROPIC_API_KEY
# paused          (none)

ht autocontinue status --json
```

Snapshot the engine config and the current paused-surface list. Cheap; no I/O.

## autocontinue audit

```bash
ht autocontinue audit
# 14:02:11  fired      surface:1  next plan step: M3
# 14:02:18  skipped    surface:1  cooldown — 1842ms remaining
# 14:02:33  paused     surface:1  manual pause via ht/UI
# 14:02:55  resumed    surface:1  manual resume via ht/UI

ht autocontinue audit --limit 5
ht autocontinue audit --json
```

Print recent decisions from the in-memory audit ring (cap 50). Default 20 entries; `--limit N` (1–50) tightens it. Each row is `<time> <outcome> <surface> <reason>`. `(model)` suffix marks decisions where the LLM was consulted.

| Outcome | Meaning |
|---|---|
| `fired` | Engine sent `Continue` (or the model's instruction) into the surface. |
| `dry-run` | Engine *would have* fired but `dryRun` is on — instruction logged, no text sent. |
| `skipped` | Heuristic / cooldown / runaway gate said wait. The reason carries which. |
| `paused` | Administrative event from `pause` (CLI or UI). |
| `resumed` | Administrative event from `resume`. |

## autocontinue set

```bash
ht autocontinue set --engine heuristic
ht autocontinue set --engine hybrid --dry-run false --cooldown 5000
ht autocontinue set --max 10 --model claude-sonnet-4-6
ht autocontinue set --api-key-env MY_CLAUDE_KEY
```

Persist a partial settings update. At least one flag is required:

| Flag | Setting | Validation |
|---|---|---|
| `--engine <X>` | `engine` | `off` · `heuristic` · `model` · `hybrid` |
| `--dry-run <bool>` | `dryRun` | `true` / `false` / `1` / `0` / `yes` / `no` |
| `--cooldown <ms>` | `cooldownMs` | clamped to 0–60000 |
| `--max <n>` | `maxConsecutive` | clamped to 1–50 |
| `--model <name>` | `modelName` | any non-empty string |
| `--api-key-env <var>` | `modelApiKeyEnv` | any non-empty string |

Returns a one-line echo of the new state:

```
ok — engine=hybrid dryRun=false cooldown=5000ms max=5
```

The Settings UI re-renders next time it's opened; the engine reads its config fresh on every dispatch, so changes take effect immediately for the next turn-end.

## autocontinue fire

```bash
ht autocontinue fire surface:1
# fired  next plan step: M3

ht autocontinue fire surface:2
# skipped  no plan published
```

Force a dispatch on `<surface>` using the same lookup pipeline used for turn-end notifications (most-recently-updated plan in the owning workspace, last 12 lines of the surface tail). Useful when:

- Testing a heuristic / model decision without waiting for an agent to fire a real notification.
- Driving the engine from a script that knows the agent finished but hasn't emitted an `ht notify`.

The output `<kind> <reason>` matches the audit ring shape so you can read the decision in one line. Note that `fire` still respects every gate: cooldown, runaway, paused, dry-run, engine=off all apply.

## autocontinue pause

```bash
ht autocontinue pause surface:1
# ok — paused: surface:1
```

Stop auto-continue for a specific surface. Subsequent dispatches return `paused` until you `resume` (or until the user types into that terminal — `notifyHumanInput` from a real keystroke does **not** clear a manual pause). Useful for:

- Pinning an agent that's about to do something destructive.
- Pausing one surface while leaving the rest of the workspace responsive.

The pause is per-surface; the engine setting (`engine: heuristic`) stays on for everything else.

## autocontinue resume

```bash
ht autocontinue resume surface:1
# ok — no surfaces paused
```

Clear the pause on `<surface>`. Side-effect: also resets the runaway counter for that surface, so a surface that was paused after hitting `maxConsecutive` can fire again immediately.

## Recipes

### Enable in dry-run, then go live

```bash
ht autocontinue set --engine heuristic --dry-run true
# … exercise some agent turns, watch `ht autocontinue audit` …
ht autocontinue set --dry-run false
```

### Pause everything during a long-running build

```bash
for s in $(ht list-surfaces --json | jq -r '.[].id'); do
  ht autocontinue pause "$s"
done

# … long build …

for s in $(ht list-surfaces --json | jq -r '.[].id'); do
  ht autocontinue resume "$s"
done
```

### Watch the engine react to a forced fire

```bash
ht autocontinue set --engine heuristic --dry-run true
ht autocontinue fire surface:1
ht autocontinue audit --limit 1
```

## Read more

- [Auto-continue feature overview](/features/auto-continue/) — engine modes, dry-run, the LLM provider, settings.
- [`ht plan`](/cli/plan/) — publishing the plan that the engine reads.
- [Plan panel feature overview](/features/plan-panel/) — the sidebar widget that surfaces plans + the audit ring.
