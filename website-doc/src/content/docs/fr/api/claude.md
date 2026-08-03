---
title: claude.*
description: event, statusline, sessions — ingestion et observabilité des sessions Claude Code.
---

Ingestion + lecture pour l'[intégration Claude
Code](/fr/integrations/claude-code/) (0.5.0). Les producteurs sont le
pont de hooks et `ht claude statusline` ; la lecture alimente `ht claude
sessions`, les diagnostics, et l'UI future. Aussi accessible via
l'espace de noms `claude` du SDK d'extensions.

## claude.pane

```json
{ "method": "claude.pane",
  "params": { "cwd": "/repo", "split": true, "direction": "right" } }
→ "OK"
```

Ouvre un [panneau Claude Code natif](/fr/features/claude-code-pane/) — le même
point d'entrée que la palette. `resume` rouvre un id de session précédent. Sans
`cwd`, le panneau hérite du dossier du panneau focalisé.

## claude.auto_approve

```json
{ "method": "claude.auto_approve", "params": {} }
→ { "ok": true, "enabled": false, "delayMs": 700 }

{ "method": "claude.auto_approve", "params": { "enabled": true, "delay_ms": 500 } }
→ { "ok": true, "enabled": true, "delayMs": 500 }
```

Lit (sans params) ou bascule l'acceptation automatique des invites de
permission de Claude Code dans les panneaux **terminal**. Les écritures passent
par le gestionnaire de réglages : le changement est persisté et appliqué
immédiatement — sans redémarrage ni édition de `settings.json`. Adossé à
[`claudeAutoApprove`](/fr/configuration/settings/).

Voir [`ht claude auto-approve`](/fr/cli/claude/).

## claude.approve

```json
{ "method": "claude.approve", "params": { "surface_id": "surface:3" } }
→ { "ok": true, "surfaceId": "surface:3" }
→ { "ok": false, "reason": "no Claude Code terminal prompt is waiting" }
```

Accepte l'invite de permission affichée par Claude Code dans un panneau
**terminal** en envoyant Entrée. Sans `surface_id`, répond à la session qui
attend depuis le plus longtemps. Refuse si rien n'attend, si l'approbation a
été routée vers la modale τ-mux (il n'y a alors pas d'invite terminal), ou s'il
s'agit d'un panneau Claude Code.

## claude.event

```json
{ "method": "claude.event", "params": { "event": {
  "type": "prompt", "sessionId": "abc123",
  "surfaceId": "surface:4", "cwd": "/repo",
  "prompt": "Corriger le bug de login", "ts": 1754000000000
} } }
→ "OK"
```

Un événement de hook normalisé. `type` est l'un de `session-start`,
`session-end`, `prompt`, `stop`, `stop-failure`, `subagent-start`,
`subagent-stop`, `pre-compact`, `post-compact`, `cwd-changed`,
`notify-idle`, `notify-permission`, `permission-request`,
`permission-resolved`, `task-created`, `task-completed`. Tous les champs
sauf `type`/`sessionId` sont optionnels — le registre tolère l'absence
par conception (les charges utiles varient selon les versions de Claude
Code). Une charge malformée renvoie une chaîne `"ERR: …"` plutôt qu'une
exception (les producteurs sont des hooks fire-and-forget qui ne lisent
jamais la réponse).

## claude.statusline

```json
{ "method": "claude.statusline", "params": { "data": {
  "sessionId": "abc123", "sessionName": "Fix auth flow",
  "modelDisplayName": "Opus", "costUsd": 0.31,
  "contextUsedPct": 42, "rateLimits": { "fiveHourPct": 84 }
} } }
→ "OK"
```

Le plan de données : le sous-ensemble parsé du JSON statusline de Claude
Code (coût, % de contexte, rate limits, titre de session, modèle, mode
de permission, effort, état de PR). La phase n'est jamais modifiée par
cette méthode — c'est le rôle du plan événementiel.

## claude.sessions

```json
{ "method": "claude.sessions", "params": { "all": false } }
→ { "sessions": [ { "sessionId": "abc123", "phase": "working",
    "surfaceId": "surface:4", "sessionName": "Fix auth flow",
    "modelDisplayName": "Opus", "costUsd": 0.31, "contextUsedPct": 42,
    "turnCount": 3, "tasks": [ … ], "subagents": [ … ], … } ] }
```

Sessions actives, la plus récemment active en premier. `all: true`
inclut les sessions terminées récemment (conservées ~5 minutes pour le
démontage de l'UI). Les sessions sans événement depuis 24 h sont
purgées ; le registre plafonne à 200 sessions.
