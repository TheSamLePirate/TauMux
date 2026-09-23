# Intégration de Jev dans τ-mux — analyse

> Statut : analyse / proposition, rien d'implémenté. Rédigé le 2026-09-23 (τ-mux 0.11.0).

## 1. Jev en bref

Jev (TypeSafe, v1.13) est un modèle **« System One »**. Il ne génère pas de texte. Il reçoit un `state` (texte ou JSON) et un ensemble de `questions` typées. Pour chaque question, il renvoie une réponse typée avec des **probabilités calibrées** : entraîné avec RLCD, une réponse donnée à 0,9 est juste environ 90 % du temps.

| Type | Question | Réponse |
|---|---|---|
| `noul` | « est-ce que X est vrai ? » | `noul: 0..1` |
| `choice` | « laquelle parmi N options ? » (max 255) | `choice`, `probabilities{}`, `confidence` |
| `score` | « où sur une échelle ordonnée ? » (2 à 10 niveaux) | `score` (moyenne pondérée), `probabilities{}`, `confidence`, `legend` |

**Forme de l'API.** Le corps est le même chez tous les fournisseurs, seule l'URL change.

```jsonc
POST {
  "model": "typesafe/jev-1.13",          // alias ~typesafe/jev-latest
  "state": "... ou {…}",
  "questions": {
    "destructive": { "type": "noul",   "instructions": "…", "criteria": { "true": "…", "false": "…" } },
    "scope":       { "type": "choice", "instructions": "…", "criteria": { "expected": "…", "side_step": "…", "unrelated": "…" } },
    "risk":        { "type": "score",  "instructions": "…", "criteria": ["aucun", "réversible", "irréversible"] }
  }
}
→ { "model": "...", "answers": { "destructive": { "type": "noul", "noul": 0.03 }, … }, "usage": { "input_tokens": 410, "cost": … } }
```

**Endpoints**

| Fournisseur | URL | Remarque |
|---|---|---|
| OpenRouter, Decisions API | `https://openrouter.ai/api/alpha/decisions` | Encore en **alpha** |
| OpenRouter, System One API | `https://openrouter.ai/api/v1/systemone` | |
| TypeSafe en direct | `https://api.typesafe.ai/v1/systemone` | |
| AI/ML API | `https://api.aimlapi.com/v1/decisions` | |
| Vercel AI Gateway | modèle `typesafe-ai/jev` | |

**SDK** : `@typesafe-ai/sdk` (Node 20+). Nous n'en avons pas besoin, un `fetch` suffit, comme pour Anthropic aujourd'hui.

**Chiffres**

- Latence : 70 à 500 ms, environ 100 ms en général.
- Prix : **0,042 $ par million de tokens en entrée**, sortie gratuite.
- Contexte : 32k (state + la plus longue question), 64k au total.
- Limites de débit : 1 200 req/min et 250k tokens/s.
- Les questions supplémentaires dans un même appel ne coûtent presque rien. D'où le **fan-out spéculatif** : une seule requête pour toutes les questions indépendantes.

**Ce que Jev ne fait pas**

- Il ne génère pas de texte ni de code et ne donne pas d'explication.
- Il est mauvais en arithmétique, en comptage, en dates et en raisonnements à plusieurs étapes.
- Sa précision chute avec un contexte bruité : il faut **filtrer le `state`**.
- Il faut poser **une seule question atomique** à la fois et écrire des critères qui décrivent des situations concrètes.

Conséquence pour τ-mux : Jev est **le décideur**, le code reste l'exécutant. Tout texte à envoyer (instructions, messages) doit venir d'un gabarit choisi par une `choice`, jamais être généré.

## 2. Pourquoi τ-mux s'y prête particulièrement

τ-mux a déjà des **points de décision** partout. Aujourd'hui, chacun est tranché de l'une de trois façons :

1. **Des heuristiques regex ou par phase**, fragiles :
   - `decideAutoContinue` (`src/bun/auto-continue.ts:83`) ;
   - `canAutoApprove` (`src/bun/claude-auto-approve.ts:57`) ;
   - `DEFAULT_RISK_PATTERNS` (`pi-extensions/ht-bridge/intercept/bash-safety-core.ts:12`).
2. **Un humain**, lent : la modale ask-user ou Telegram.
3. **Un LLM génératif** trop lent et trop cher pour le rôle : Haiku dans `callAnthropicAutoContinue` (`src/bun/auto-continue-engine.ts:482`), environ 1 à 2 s. Il faut en plus parser un JSON en texte libre, ce qui peut échouer.

Jev coûte environ 100 ms et quelques dixièmes de millième de dollar par décision. Il renvoie un type garanti (0 % d'erreur de schéma) avec une probabilité exploitable pour des **seuils**. Ce profil permet de le consulter **à chaque événement** plutôt qu'en dernier recours, sans violer les priorités du projet :

- **Idle CPU ≈ 0.** Jev n'est appelé que sur des événements déjà existants (fin de tour, notification, demande de permission, sortie de process). Jamais en polling, jamais sur le flux PTY.
- **Correction d'abord.** Chaque appel est *fail-safe* : timeout, erreur ou absence de clé ramènent au comportement actuel, sans rien bloquer.
- **Le PTY reste la source de vérité.** Jev lit une copie filtrée (les dernières lignes, sans ANSI) et n'écrit jamais dans le terminal hors des chemins existants (`sendText`, réponse ask-user).

## 3. Architecture proposée

```
src/shared/decision-types.ts   Types Question/Answer (noul|choice|score), DecisionRequest/Result
src/bun/jev-client.ts          fetch + timeout (AbortSignal ~800 ms) + cache LRU court + audit ring
                               + redaction des secrets dans le state + compteur de coût
src/bun/decision-policy.ts     fonctions pures : answers + seuils → action (testables sans réseau)
src/bun/rpc-handlers/decide.ts decide.ask / decide.status / decide.audit
src/cli/map-command.ts         `ht decide …`
```

- **Un client unique, plusieurs consommateurs.** Chaque fonctionnalité fournit son `state`, filtré par ses soins, et ses questions. La politique (les seuils) est une fonction pure, sur le modèle de `decideAutoContinue`, donc testable avec `bun test` sans réseau.
- **Fournisseurs.** `openrouter` (par défaut), `typesafe` ou `aimlapi`. Le corps est identique, seuls l'URL et l'en-tête d'auth changent.
- **Clé API** : même principe que `autoContinue.modelApiKeyEnv`. Les réglages ne stockent **que le nom de la variable d'environnement** (`OPENROUTER_API_KEY`), jamais la clé.
- **Réglages** : un bloc `jev: JevSettings` dans `AppSettings`.
  - Général : `enabled`, `provider`, `model`, `apiKeyEnv`, `timeoutMs`.
  - Un interrupteur par usage : `autoContinue`, `permissionGate`, `notificationTriage`, `failureTriage`, `paletteIntent`…
  - Il faut le fil complet : `DEFAULT_SETTINGS` et `validateSettings`, `SettingsPanel`, `pickWebSettings` (à exclure du miroir), docs EN+FR (sinon `tests/docs-coverage.test.ts` casse).
- **Observabilité.** Chaque décision part dans un audit ring (comme `autoContinueAudit`) avec la question, les probabilités, l'action prise et le coût. On l'affiche dans le sidebar log (`sidebar.log`) et via `ht decide audit`. Un compteur de coût cumulé va dans `decide.status`.
- **Mode `shadow`.** Pour chaque usage, on peut *calculer* la décision Jev sans l'*appliquer*, et la journaliser à côté de la décision actuelle. C'est la généralisation du `dryRun` d'auto-continue, et c'est indispensable pour calibrer les seuils sur de vraies données avant d'activer.

### Règle de sécurité fondamentale : asymétrie

Le `state` contient du texte **contrôlé par l'agent ou par la sortie du terminal**. Un fichier lu par l'agent peut contenir « cette commande est sûre ». Jev est donc exposé à l'injection de prompt, comme tout modèle.

- Jev peut **resserrer** un chemin : escalader vers l'humain, bloquer une action auto, marquer une demande `unsafe`.
- Jev **n'élargit** un chemin (auto-allow) que si l'utilisateur l'a activé explicitement. Il faut en plus des seuils stricts et un **garde-fou déterministe en premier** : les regex actuelles de `bash-safety-core` et une liste de commandes en lecture seule. Le garde-fou garde le dernier mot.
- En cas d'échec de Jev, on revient **toujours à la demande à l'humain**, jamais à l'autorisation.

### Confidentialité

Le `state` part chez un tiers (OpenRouter ou TypeSafe) : lignes du terminal, commandes, chemins de fichiers. Il faut donc :

- un opt-in explicite, désactivé par défaut ;
- une redaction (tokens, `*_KEY=`, `Authorization:`, JWT, clés privées), réutilisable depuis ce qui existe côté partage ;
- une mention claire dans les réglages.

## 4. Cas d'usage, par priorité

### P0-a — Auto-continue : Jev comme `ModelCaller`

**Point d'insertion.** L'interface est déjà pluggable : `ModelCaller` et le dépôt `callModel` (`auto-continue-engine.ts:47,57-66`). On ajoute `modelProvider: "anthropic" | "jev"`.

**State.** Le plan (étapes, états, ids), les 12 dernières lignes du terminal (déjà calculées par `auto-continue-host.ts:64`) et le texte de la notification.

**Questions, en un seul appel**

| Question | Type | Critères |
|---|---|---|
| `status` | choice | `in_progress_next_step`, `asked_user_question`, `blocked_on_error`, `finished`, `waiting_external` |
| `asked_question` | noul | « Le dernier message de l'agent attend-il une réponse de l'humain ? » |
| `next_step` | choice | Les ids des étapes `active` ou `waiting` du plan (≤ 255), plus `none` |

**Politique.**

- On répond `continue` si `status = in_progress_next_step` avec une confiance ≥ 0,8, **et** `asked_question < 0,2`, **et** `next_step ≠ none`.
- L'instruction reste le gabarit actuel `Continue <id>`. Jev ne génère rien, il choisit l'id.
- Sinon on répond `wait`, avec la raison issue de la `choice`.

**Gain.** Environ 15 à 20 fois plus rapide et plusieurs centaines de fois moins cher que Haiku. Le parse JSON fragile (`parseModelResponse`) disparaît. On peut enfin rendre le mode `model` raisonnable par défaut au lieu de `hybrid`, et `shouldEscalate` (heuristique sur des chaînes de caractères) devient inutile.

**Ce qui reste en code.** Les garde-fous du moteur ne bougent pas, car ils relèvent de l'arithmétique et du temps, que Jev gère mal : cooldown, `maxConsecutive` et pause restent avant l'appel.

### P0-b — Porte de permission (Claude, pi, auto-approve tty)

Il existe quatre chemins aujourd'hui, et aucun n'examine le **contenu** de l'action.

| Chemin | Emplacement | Comportement actuel |
|---|---|---|
| Hook `PermissionRequest` Claude | `claude-integration/ht-bridge/src/index.ts:132` | Modale systématique via `runHtAskChoice` |
| Pane Claude natif | `claude-agent-manager.ts:174` → `claude-pane-host.ts:64` | `canUseTool` puis modale |
| `claudeAutoApprove` | `claude-auto-approve.ts` | **Tamponne tout** prompt tty (Entrée après 700 ms) |
| Bash-safety pi | `bash-safety-core.ts:47` | Regex puis `confirm-command` |

**State.** La dernière demande utilisateur (déjà reçue par `UserPromptSubmit`), le plan courant, le dernier message de l'agent et l'action en attente (commande Bash, chemin et diff, ou entrée JSON de l'outil, déjà formatés par `formatPermissionAsk`).

**Questions** (inspirées de *pi-warden*, cité par TypeSafe : environ 88 % de précision, 42 blocages sur ~17 000 appels)

| Question | Type | Formulation |
|---|---|---|
| `irreversible` | noul | « Détruit-elle des données non récupérables ? » |
| `off_task` | noul | « Sans rapport avec la demande ? » |
| `intent_mismatch` | noul | « Contredit-elle le plan annoncé ? » |
| `scope` | choice | `expected`, `side_step`, `unrelated`, `unclear` |
| `effect` | choice | `read_only`, `local_reversible`, `destructive`, `network_or_external` |

**Politique** (fonction pure dans `decision-policy.ts`)

- **Bloquer l'auto-approve tty** si `irreversible > 0,1` ou `effect ≠ read_only/local_reversible`. C'est le gain de sécurité le plus net : aujourd'hui `claudeAutoApprove` est une porte ouverte, et avec Jev il ne valide plus que ce qui est clairement bénin.
- **Enrichir la modale** : un badge de risque (« destructive 0,94 · hors tâche »), le drapeau `unsafe` sur l'`AskUserRequest`, et `default: "deny"`. Tout cela est aussi visible sur Telegram.
- **Auto-allow** (opt-in `jev.permissionGate = "auto-allow-safe"`) seulement si :
  - la regex ne matche pas ;
  - `effect = read_only` avec p ≥ 0,97 ;
  - `scope = expected` avec p ≥ 0,9 ;
  - `off_task < 0,05`.

  Il en résulte beaucoup moins d'interruptions (`ls`, `git status`, `grep`, lectures de fichiers).
- **Jamais d'auto-deny silencieux.** Un risque élevé mène à la modale avec un avertissement.

**Contrainte de latence.** Le hook `PermissionRequest` est **synchrone** : Jev ajoute environ 100 à 300 ms, négligeable devant une modale humaine. Le budget recommandé est un timeout de 800 ms. Au-delà, on retombe sur le comportement actuel.

### P1-a — Triage des notifications vers Telegram et le sidebar

Aujourd'hui, **tout** part sur le téléphone (`planNotificationForwarding`, `telegram-service.ts:1040`), freiné seulement par un token-bucket. Et `Notification` n'a pas de champ de priorité.

**Questions**

| Question | Type | Critères |
|---|---|---|
| `urgency` | score | `info`, `à voir plus tard`, `action requise`, `urgent/échec` |
| `needs_human` | noul | |
| `kind` | choice | `finished`, `error`, `question`, `approval`, `progress` |

**Utilisation.**

- On ajoute `priority?` à `Notification`.
- On ne transfère vers Telegram qu'au-dessus d'un seuil (nouveau réglage `telegramNotificationMinPriority`).
- Le sidebar se colore selon la priorité, et on peut ne jouer le son (`notificationSoundEnabled`) que pour `urgent`.
- On regroupe les notifications `progress` au lieu de pinger.

### P1-b — Triage des échecs de commande

Déclencheurs, **uniquement sur événement** : sortie de process avec un code ≠ 0 (`onSurfaceExit`, `index.ts:880`), `progress.state === "error"` (OSC 9;4), ou fin de la commande au premier plan détectée par le poller de métadonnées avec un code d'erreur.

**Questions** sur les ~40 dernières lignes :

| Question | Type | Critères |
|---|---|---|
| `failure_kind` | choice | `compile`, `test`, `dependency/install`, `network`, `permission`, `oom/killed`, `port_in_use`, `user_interrupt`, `other` |
| `likely_flaky` | noul | |
| `actionable_by_agent` | noul | |

**Utilisation.**

- Une chip « ✗ test » dans l'en-tête du pane, suivant les conventions de `renderSurfaceChips`.
- Pour `port_in_use`, une action en un clic qui réutilise `surface.kill_port`.
- Si un agent est attaché au workspace et que `actionable_by_agent` est élevé, on propose « envoyer l'erreur à l'agent ».
- `user_interrupt` (Ctrl-C) est filtré en code *avant* Jev, car c'est le code 130. Tout ce qui est déterministe reste en code.

### P1-c — Pré-remplissage des ask-user

Pour les `AskUserRequest` de type `yesno` ou `choice` (`src/shared/types.ts:391`), Jev prédit la réponse probable à partir du plan et de la demande initiale, avec une `choice` sur les `choices[].id`.

- Par défaut, on se contente de **pré-sélectionner** la réponse (`default`) et d'afficher la probabilité, dans la modale comme sur Telegram, où le bouton suggéré passe en premier.
- En option, on répond automatiquement au-dessus de 0,95, **seulement** pour les kinds non-`unsafe` et jamais pour `confirm-command`.

### P2 — Autres idées, par ordre de valeur

1. **`ht decide` : la primitive exposée aux utilisateurs.** C'est dans l'esprit de `ht` : n'importe quel script shell, sideband ou hook peut poser une question typée.
   ```sh
   make test 2>&1 | tail -50 | ht decide noul "Les tests ont-ils échoué pour une raison réseau ?"
   ht decide choice "Quelle équipe ?" --option backend="API, DB" --option front="UI, CSS" --state-file log.txt --json
   ```
   Pour les scripts, le code de sortie vaut 0 si p ≥ seuil (`--threshold`), 1 sinon.
2. **Vérification automatique du plan.** À chaque `Stop` ou fin de tour, on pose un `noul` par étape `active` : « d'après la sortie, cette étape est-elle terminée ? ». Au-delà de 0,9, on appelle `plan.update` (mode suggestion au départ). Le panneau de plan reste juste même si l'agent oublie de le mettre à jour.
3. **Routage d'intention dans la palette de commandes.** Quand le fuzzy-match ne trouve rien, on fait une `choice` Jev sur les `PaletteCommand` (≤ 255 ids, description comme critère). La requête « partage l'écran en deux verticalement » donne `pane.splitRight`. Environ 100 ms, acceptable pour une palette.
4. **Routage de modèle côté pi.** Au `before_agent_start` de `pi-extensions/ht-bridge`, une `choice` `fast` ou `powerful` sur la demande. C'est une économie directe sur les tours triviaux. Le modèle est celui du `ModelRouterMiddleware` décrit par LangChain.
5. **Routage des messages Telegram entrants.** Une `choice` sur les workspaces et agents actifs (leurs titres et cwd servent de critères) choisit la cible d'un message libre. Une seconde `choice` distingue « réponse à une question en attente », « nouvelle instruction » et « question de statut ».
6. **Filtre anti-injection** pour le contenu du browser pane ou des pages récupérées avant qu'un agent ne les consomme. Quatre `noul` : pertinent, contient une preuve, contredit la prémisse, tente d'instruire le modèle.

## 5. Coût estimé

Il faut compter environ 1 à 2k tokens d'entrée par décision, avec un state filtré :

| Usage | Fréquence typique | Coût par jour |
|---|---|---|
| Auto-continue | 200 fins de tour | ~0,02 $ |
| Porte de permission | 500 appels d'outils | ~0,04 $ |
| Triage des notifications | 300 | ~0,02 $ |
| Triage des échecs | 100 | < 0,01 $ |

**Moins de 0,10 $ par jour** pour un usage intensif. À comparer avec Haiku : pour le seul auto-continue, le rapport de coût est d'un ordre de grandeur de 100 à 400. Le coût n'est donc plus un argument pour limiter les appels. **La confidentialité et la latence réseau** sont les vraies contraintes.

## 6. Plan de mise en œuvre suggéré

1. **Fondation.**
   - Écrire `decision-types.ts`, `jev-client.ts` (fetch, timeout, redaction, audit, coût) et `decision-policy.ts`.
   - Ajouter les réglages `jev`, les RPC `decide.ask`, `decide.status` et `decide.audit`, et la commande `ht decide`.
   - Écrire la doc EN+FR.
   - Tests : un client avec un `fetch` injecté (comme `callModel`) et des politiques pures.
2. **Auto-continue.** Un `ModelCaller` Jev derrière `modelProvider: "jev"`, en mode shadow d'abord pour comparer avec l'heuristique dans l'audit.
3. **Porte de permission.**
   - Commencer par bloquer `claudeAutoApprove` sur les actions risquées et ajouter le badge de risque dans la modale (resserrement uniquement).
   - Ajouter ensuite l'auto-allow opt-in pour le bash de pi et le hook Claude.
4. **Triage des notifications** : priorité, filtre Telegram, son.
5. **Triage des échecs** : chip, puis envoi à l'agent.
6. **P2**, au cas par cas.

Chaque étape passe par le mode shadow, puis se calibre sur l'audit avant d'être activée.

## 7. Risques et points ouverts

- **La Decisions API d'OpenRouter est en *alpha*.** Il faut isoler le fournisseur derrière `jev-client.ts` et vérifier la forme exacte de la réponse (en particulier `usage.cost`) avec un vrai appel avant de figer les types.
- **Injection de prompt** via le state : voir la règle d'asymétrie (§3). Ne jamais faire de Jev le seul verrou d'une action destructrice.
- **Précision.** Environ 88 % sur la porte de permission dans le retour d'expérience de pi-warden, ce qui est suffisant pour *trier* mais pas pour *autoriser seul*. D'où les seuils stricts, le mode shadow et le garde-fou déterministe.
- **Calibrage** : les scores ne sont pas calibrés *entre* niveaux. Il vaut mieux des `choice` ou des `noul` quand on compare à un seuil.
- **Réseau hors ligne** : le client échoue vite (timeout) et on revient au comportement actuel. L'application ne dépend jamais de Jev pour fonctionner.
- **Miroir web** : les réglages `jev` sont exclus de `pickWebSettings`. L'audit peut être diffusé sans le state brut.

## Sources

- [Documentation Jev sur OpenRouter](https://openrouter.ai/docs/guides/community/jev)
- [Jev 1.13 sur OpenRouter](https://openrouter.ai/typesafe/jev-1.13)
- [Référence API Jev chez AI/ML API](https://docs.aimlapi.com/api-references/decision-models/typesafe/jev)
- [A deep dive into Jev (flaviocopes)](https://flaviocopes.com/jev/)
- [Building a harness with Jev (LangChain)](https://www.langchain.com/blog/building-a-harness-with-jev)
- [What is Jev (Firecrawl)](https://www.firecrawl.dev/blog/what-is-jev)
