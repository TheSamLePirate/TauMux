---
title: Journal des modifications
description: Changements notables — les plus récents en haut.
sidebar:
  order: 1
---

Cette page résume les changements visibles par les utilisateurs. Le journal complet des commits est sur [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main), et le projet livre désormais un `CHANGELOG.md` généré à la racine du dépôt qui regroupe les commits par type conventional-commit (ajouté en 0.3.145).

## 0.3.172 — Revue de sécurité & durcissement de l'architecture

Une revue de code complète (`doc/full_app_review_2026-05.md`) a déclenché une vague de correctifs de sécurité bloquants, de nettoyages de dépendances/outillage et une décomposition de l'architecture. Du plus récent au plus ancien.

### Sécurité (0.3.161 → 0.3.167)

- **Le miroir web respecte votre bind + jeton d'authentification au démarrage automatique (0.3.161).** Auparavant, le jeton (`webMirrorAuthToken`) et le bind `127.0.0.1` n'étaient appliqués que via le bouton manuel des Réglages ; lors du démarrage automatique du miroir (ou d'un changement de port), il se liait silencieusement à `0.0.0.0` **sans authentification**. Corrigé — votre jeton / bind loopback configuré prennent désormais effet au démarrage automatique.
- **La liste d'autorisation Telegram est vide par défaut et fonctionne en mode fermé (0.3.161).** `telegramAllowedUserIds` n'embarque plus d'identifiant codé en dur, et une liste vide **rejette désormais tous** les messages entrants + appuis sur les boutons de notification (auparavant : tout le monde était accepté). Saisissez votre identifiant Telegram numérique dans **Réglages → Telegram** pour activer le contrôle à distance.
- **Le HTML/SVG sideband est mis en bac à sable dans le miroir web (0.3.161).** Le balisage `meta.data` inline des panneaux s'affiche désormais dans le même `<iframe>` en bac à sable (CSP `script-src 'none'`) que les trames binaires, fermant une faille XSS sur le réseau local.
- **Rotation du jeton d'authentification à chaud (0.3.162).** Modifier le jeton / le bind du miroir dans les Réglages prend désormais effet sans redémarrage ; la rotation du jeton réinitialise aussi le verrou anti-force-brute.
- **`ht browser navigate` rejette `file://` (0.3.162).** Empêche la lecture de fichiers locaux arbitraires via un panneau au travers du socket ; `http(s)://`, `about:`, `data:`, `chrome-extension://` fonctionnent toujours. `browser.eval` / `addscript` / `addstyle` partagent désormais un plafond de charge utile de 256 Kio.
- **Durcissement supplémentaire (0.3.162).** Limiteur anti-force-brute indexé sur l'IP réelle du pair (et non un en-tête falsifiable) ; les fichiers de réglages + cookies sont créés en `0600` dès le premier octet (+ `fsync` pour la durabilité en cas de coupure) ; le journal sur disque masque les jetons Telegram / d'authentification.
- **Jeton de socket RPC optionnel (0.3.163, désactivé par défaut).** **Réglages → Réseau → « Exiger un jeton de socket RPC »** protège les commandes `ht` modifiant l'état (saisie dans les panneaux, arrêt de processus) derrière un jeton généré à chaque démarrage ; les diagnostics en lecture seule restent ouverts. Défense en profondeur contre les processus opportunistes du même utilisateur — pas une frontière dure. Nouvelle variable `HT_RPC_TOKEN_PATH`.
- **Toutes les vulnérabilités de l'audit de dépendances corrigées (0.3.167).** `bun audit` est passé de 7 à 0 via des `overrides` ciblés (ws, ip-address, brace-expansion, basic-ftp).

### Architecture & outillage (0.3.164 → 0.3.172)

- **Migration de xterm vers `@xterm/xterm@6` (0.3.164).** Le cœur de la webview est désormais aligné avec les addons + headless v6 qu'elle utilisait déjà (l'ancien `xterm@5.3.0` non scopé et déprécié a disparu). Aucun changement visible.
- **Le modal ask-user obtient un style Haut Contraste (0.3.164).** L'invite de confirmation « This will execute on your machine » retombait auparavant sur le style par défaut en Haut Contraste Windows / `prefers-contrast` (le CSS visait une classe que le modal n'émet jamais). Corrigé.
- **Versionnement du schéma de réglages (0.3.165).** `settings.json` porte désormais un `__schemaVersion` + un moteur de migrations ordonnées, afin qu'un futur renommage/suppression de champ ne perde pas silencieusement vos données.
- **Hygiène de la chaîne d'approvisionnement (0.3.166).** Une configuration Renovate + un scan de vulnérabilités de dépendances non bloquant (`bun audit`) dans la CI.
- **eslint corrigé + intégré à la CI (0.3.168).** Une configuration eslint plate limitée au TypeScript écrit par le projet (la précédente parcourait les arbres de travail git `.claude/` → ~22 k erreurs fictives et n'était jamais exécutée).
- **Décomposition de `SurfaceManager` (0.3.169 → 0.3.171).** Les responsabilités des surfaces navigateur / Telegram / éditeur / agent ont été extraites dans des contrôleurs dédiés — ~285 lignes nettes en moins du module de 2 700 lignes. Refactorisation interne pure ; aucun changement de comportement.
- **Consolidation de la marque (0.3.172).** Identifiants de marque centralisés dans un seul module ; la CLI `ht` affiche désormais « τ-mux » au lieu de « HyperTerm Canvas ». (Le dossier de config, l'identifiant de bundle et le nom du socket restent pour la rétrocompatibilité.)
- **Garde-fous CI / release.** Le workflow de release exécute désormais typecheck + tests avant de publier les binaires ; la CI relance les specs e2e fonctionnelles (non-pixel) de sécurité du miroir web et le lint à chaque push.

### 0.3.x antérieur (0.3.150 → 0.3.160)

- **Complétude de la palette de commandes (0.3.150).** ~30 verbes supplémentaires accessibles via ⌘⇧P — opérations d'espace de travail, de panneau, de navigateur, de thème et d'éditeur.
- **Verbes de renommage CLI à détection automatique (0.3.151).** `ht rename-workspace NOM` / `ht rename-surface NOM` résolvent la cible depuis `HT_SURFACE` lorsqu'ils sont lancés dans un panneau (pas besoin de `--workspace`).
- **Positionnement des candidats IME (0.3.153).** Le terminal natif + le miroir web ne forcent plus le textarea auxiliaire de xterm hors écran, donc les fenêtres de candidats IME apparaissent au curseur.
- **Opacité des invites ask/plan + fiabilité du premier plan (0.3.154 → 0.3.158).** Les invites s'affichent en superpositions bloquantes globales avec une feuille + un voile opaques ; cause racine : la webview native ne chargeait pas la feuille de tokens de design `--ht-*` (désormais liée dans `index.html`).
- **Parité de dimensionnement du terminal du miroir web (0.3.160).** Le calcul des cellules web/natif est aligné (marge des panneaux, plomberie de redimensionnement, epsilon sous-pixel) pour que `clear` ne fasse plus apparaître un `%` parasite et que les longues lignes ne soient plus coupées d'une colonne.

## 0.3.x — Polissage Triple-A (Phases 6 → 9)

La série 0.3 a déroulé une vague de polissage multi-phases en notant chaque fonctionnalité selon une grille S/A/B/C et en relevant des manques concrets à chaque session. Le travail est suivi dans `doc/feature_grades.json` + `doc/feature_grades.md` + les fichiers `doc/tracking_feature_upgrade_to_AAA_phase*.md` du dépôt.

### 0.3.146 → 0.3.148 — Suivi Phase 9 (fermeture de trois manques classés B)

- **Espaces de travail — validateur strict de `layout.json`.** `src/shared/layout-persistence.ts` exporte `validatePersistedLayout` + `parsePersistedLayout` (fonctions pures). Parcourt la forme complète : `activeWorkspaceIndex` (entier dans `[-1, len]`), `sidebarVisible` (booléen), `workspaces` (tableau non vide), les champs obligatoires + optionnels de chaque workspace, chaque sous-arbre `PaneNode` (`leaf` avec `surfaceId` valide + `SurfaceKind` optionnel, ou `split` avec `direction` valide + `ratio` dans `[0,1]` + exactement 2 enfants valides). `loadLayout` dans `src/bun/index.ts` appelle désormais `parsePersistedLayout`. Un `layout.json` tronqué (fsync interrompu, disque plein, panique noyau en pleine écriture, restauration partielle par rsync) démarre désormais sur table rase au lieu de lever une exception en aval dans `collectLeafIds` / `remapPaneNode`. **26 nouveaux tests** couvrent les cas heureux + chaque mode d'échec de parsing + chaque incohérence de forme.
- **Registre de panneaux — limite par-surface de 256 avec éviction du plus ancien.** Le constructeur `PanelRegistry` prend un paramètre optionnel `maxPanelsPerSurface` (256 par défaut, exporté sous `DEFAULT_MAX_PANELS_PER_SURFACE`). Quand un nouvel id arrive et que la map par-surface est à la limite, l'entrée la plus ancienne (`createdAt` le plus petit) est évincée avant insertion. Les mises à jour d'ids existants ne déclenchent jamais la limite. La limite est bornée à ≥ 1 pour qu'un argument fautif `0` / négatif dégrade en douceur. Un script emballé qui forge un nouvel id à chaque tick ne peut plus faire fuiter le registre. **13 nouveaux tests.**
- **Explorateur de fichiers sidebar — protection contre les boucles de liens symboliques.** `SidebarFileExplorerEntry` gagne deux champs optionnels : `linkTarget: string | null` (realpath résolu du lien, null pour les liens cassés) et `cycle: true` (positionné quand le realpath est égal au répertoire listé ou à un de ses ancêtres). Le nouveau helper `isAncestorOrSelf(candidate, root)` s'ancre correctement sur le séparateur de chemin pour que `/foo` ne soit PAS faussement traité comme ancêtre de `/foobar`. La webview peut désormais refuser la navigation dans une boucle avec une indication claire « ceci créerait une boucle » au lieu de laisser l'utilisateur s'enfoncer dans le cycle. **9 nouveaux tests.**

### 0.3.145 — Première salve Phase 9 (observabilité)

- **Garde-fou de couverture en CI.** `.github/workflows/ci.yml` gagne un job `coverage-gate` qui lance `bun run test:coverage` puis `bun run report:coverage:check` sur macOS-14, en parallèle du job typecheck-and-unit existant. Une régression par-fichier du ratio lignes-couvertes au-delà de la tolérance de 0,5 pp face à la baseline `tests/baselines/coverage-baseline.lcov` fait échouer le build. Pour abaisser le plancher : `bun run baseline:coverage` en local puis commit de la nouvelle baseline (review obligatoire). 4 tests source-grep dans `tests/ci-coverage-gate.test.ts` verrouillent la déclaration du job.
- **Rotation par taille du logger (logging A → S).** `src/bun/logger.ts` rote désormais par taille en plus de la date. Quand le fichier actif dépasse `HT_LOG_MAX_BYTES` (50 Mio par défaut, ≤ 0 désactive) il est renommé `app-DATE.<n>.log` et un nouveau `app-DATE.log` est ouvert. `tail -f app-DATE.log` suit toujours le morceau le plus récent ; les morceaux numérotés forment l'archive. `bytesInActive` est amorcé via `fstatSync` à l'ouverture pour qu'un redémarrage le même jour reprenne là où on en était. Le motif de purge à 14 jours couvre aussi les variantes numérotées.
- **`CHANGELOG.md` du projet renseigné.** `bun scripts/bump-version.ts patch --changelog` a été exécuté sur le dépôt réel pour amorcer `CHANGELOG.md` à la racine avec 312 commits depuis v0.2.30, groupés par type conventional-commit. Les futurs bumps via `--changelog` préfixeront les nouvelles sections.

### 0.3.143 → 0.3.144 — Phase 8 (outillage de release)

- **`scripts/bump-version.ts` C → A.** Cinq nouveaux flags + rollback à deux étages :
  - `--commit` — crée un commit `chore(release): vX.Y.Z` en ne stageant que les sept fichiers à version. Refuse les arbres de travail sales sauf `--allow-dirty`.
  - `--tag` — tag annoté `vX.Y.Z` à HEAD (implique `--commit`) ; refuse d'écraser un tag existant.
  - `--changelog` — génère / étend `CHANGELOG.md` avec une section groupée par conventional-commit (feat / fix / perf / refactor / docs / test / chore / other). Sections vides ignorées. Plage = `$(prev-tag)..HEAD`.
  - `--allow-dirty` — contourne la vérification d'arbre de travail propre.
  - `--dry-run` — affiche tout sans rien écrire ni toucher à git.
  - **Rollback à deux étages.** Snapshots de fichiers restaurés sur tout throw en phase d'écriture (CHANGELOG.md supprimé s'il n'existait pas avant). Pile LIFO d'annulation git qui défait le commit si `--tag` échoue ensuite.
  - **Override d'env `BUMP_VERSION_ROOT`** pour permettre aux tests de sandboxer le script dans un tmpdir sans mock. 12 nouveaux tests.
- **`scripts/post-package.ts` multi-plateforme.** Sortait précédemment en erreur sur tout autre OS que macOS. Branche maintenant en trois : `macos` (pipeline complet — patch Info.plist via PlistBuddy, reconstruction `.tar.zst`, reconstruction DMG via hdiutil), `linux` (saute Info.plist + DMG ; réutilise la même pipeline `tar | zstd` avec `APP_DIR_NAME` plat `tau-mux/` au lieu de `tau-mux.app/`), `other` (Windows, BSD, … garde l'ancien comportement de skip avec message). 9 nouveaux tests.
- **`tau-focus-audit` C → A.** Câblé dans `bun test` via une suite happy-dom (`tests/tau-focus-audit.test.ts`, 10 tests). Une fuite de halo chromatique sur le chrome CSS fait désormais échouer le build au lieu d'attendre qu'on ouvre DevTools.

### 0.3.4 → 0.3.142 — Clôture Phase 7 (Cluster H + F.10)

La poussée Phase 7 a fait 43 sessions plus une finale, fermant les deux items structurels que le masterplan suivait depuis longtemps.

- **Cluster H — `audit:theming` propre pour la première fois sur les deux fichiers CSS.** Les ~1013 littéraux de couleur en dur dans `src/views/terminal/index.css` et `src/web-client/client.css` sont à zéro — chaque littéral est derrière une propriété personnalisée CSS `--ht-*`. Le vocabulaire totalise **200+ tokens** groupés par famille :
  - `--ht-vnext-*` (palette du redesign post-Phase-6 — 20+ tokens couvrant l'échelle de texte, le chrome surface, les couleurs de statut, les coquilles de feuille).
  - `--ht-agent-*` (panneau pi-agent — 35 tokens couvrant toolbar, badges, dropdowns, états code/think/tool-call, bulles de message, menu slash, dialogue de confirmation, barre d'entrée, chips de statut).
  - `--ht-window-*` (coquille du thème window — titlebar / sidebar / surface / overlay / toast).
  - `--ht-sidebar-v2-*` (palette sidebar v2 — logs / stats / pulsation script / point serveur).
  - `--ht-telegram-*` (chrome du panneau telegram).
  - `--ht-web-*` (exclusif au miroir web — 39 tokens pour halos de statut, tiroir sidebar, overlays WM, extras telegram, trio de halos tau-meter).
  - `--ht-contrast-*` (augmentations de bordures sous `@media (prefers-contrast: more)`).
- **Cluster F.10 — extraction des handlers webview.** Le bloc inline `bunMessageHandlers` de 82 méthodes / 671 lignes dans `src/bun/index.ts` est extrait en 13 modules par-domaine sous `src/bun/webview-handlers/` (clipboard, viewport, surface, reply, workspace, notification, system, browser, agent, telegram, editor, ask-user + `types.ts` + agrégateur `index.ts`). L'exhaustivité `satisfies BunMessageHandlers` est préservée via `BunMessageHandlerSlice<K> = Pick<BunMessageHandlers, K>` + un pattern de liaison tardive à base de getters. `src/bun/index.ts` rétrécit de 3471 → 2860 lignes. Aucun changement de comportement. 2823 / 2823 tests passent.
- **Suite de tests de tokens de thème.** Passée de 0 → 619 tests source-grep affirmant les migrations par région vers le vocabulaire de tokens.

### 0.3.0 → 0.3.3 — Parité miroir web (M11 → M18, bump mineur à M17)

Le plan M11 → M17 a amené le miroir web à parité fonctionnelle avec la sidebar native ; la série M18 a poursuivi la queue de dimensionnement multi-pane jusqu'à zéro dérive.

- **M17 (0.3.0) — panneau de plan + polissage des logs (parité fonctionnelle complète).** Le panneau de plan est désormais une quatrième zone persistante de la sidebar (premier ordre : `[plan, notif, main, log]`) appartenant à `createSidebarView`. Le dispatcher route les envelopes `plansSnapshot` + `autoContinueAudit` via `sidebarView.setPlans` / `setAutoContinueAudit`. L'audit auto-continue se cache quand l'utilisateur désactive auto-continue côté natif. Zone de logs avec badge de niveau par ligne (info / warning / error / success) + timestamp `HH:MM:SS` + libellé de source + corps, avec clic-pour-copier.
- **M16 (0.2.90) — chips du chrome de pane + `paneGap` depuis les settings.** Le DOM de pane du miroir web est renommé de `.pane-bar*` / `.pane-chip*` en `.surface-bar*` / `.surface-chip*`, miroir du natif. `renderSurfaceChips` partagé extrait dans `src/shared/pane-chips.ts`. `paneGap` flue depuis les settings à chaque passe de layout. L'anneau de focus suit le token `--ht-border-focus`.
- **M15 (0.2.89) — overlay flottant de notifications.** Quand une notification arrive avec un `surfaceId`, le miroir navigateur ancre une pile de cartes à l'intérieur de ce pane (haut-droite) — même DOM + auto-dismiss + pause au survol + pastille de débordement +N qu'en natif. Jusqu'à 3 cartes visibles par surface ; les plus anciennes se replient dans la pastille de débordement. Piloté par la diffusion settings M11 (`notificationOverlayEnabled`, `notificationOverlayMs`).
- **M14 (0.2.88) — cartes manifest (npm + Cargo).** Les cartes `package.json` et `Cargo.toml` se rendent dans la carte workspace du miroir web via `renderManifestCard` partagé. En-tête avec icône + nom + version + chip de type ; le corps déplié affiche description + chips `bin` + lignes d'action par script avec points d'état. La carte Cargo dérive automatiquement les sous-commandes par défaut (`build`/`run`/`test`/`check`/`clippy`/`fmt`). L'état déplié/replié par manifest persiste en localStorage. `runScript` reporté pour le miroir web v1 (les clics déclenchent une Web Notification + dispatchent l'event window `ht-run-script` que la sidebar native utilise ; le vrai spawn de surface est suivi sous M14-1).
- **M13 (0.2.87) — cartes workspace riches en sidebar.** Chaque carte workspace rend la même forme que le natif : bande latérale colorée de 3 px, en-tête avec point + nom + badge de compte de panes, chips commande + ports d'écoute (+N de débordement après 3), stats CPU + RAM agrégées avec sparkline glissante, ligne de chips de CWD épinglés, liste de panes pliable, pastilles de statut via `renderStatusEntry` partagé, barre de progression OSC 9;4. Projection sidebar partagée `buildSidebarWorkspaces` dans `src/shared/sidebar-state.ts`. Nouvel envelope `selectWorkspaceCwd` (client → serveur) quand l'utilisateur épingle un CWD ; v1 stocke en localStorage et le hook côté serveur est null-safe, ce qui permet de reporter le câblage bun sans casser le contrat protocolaire.
- **M12 (0.2.86) — barre de statut inférieure.** Barre fixe de 26 px au bas du miroir navigateur qui exécute le même registre de `renderStatusKey` data-driven que la barre native — identité workspace, jauges CPU/mem, fg / cwd / branche focalisés, plus les clés-pont `ht set-status`. Trois zones (identité / jauges / focus) reprennent la séparation native. `src/views/terminal/status-renderers.ts` + `status-keys.ts` déplacés dans `src/shared/` ; `Meter` extrait dans `src/shared/tau-meter.ts`. `tau-primitives.ts` ré-exporte pour rétro-compat.
- **M11 (0.2.85) — diffusion thème + settings.** Nouvelles envelopes `settingsSnapshot` et `htKeysSeen` sur le protocole v2 transportent le preset de thème + palette ANSI + police + densité + ordre des clés de la barre de statut + liste de découverte `ht set-status` vers chaque client web connecté. Les champs sensibles (token d'auth, token bot telegram, ids utilisateurs autorisés) sont volontairement dropés par `pickWebSettings` et n'atteignent jamais le réseau. Le miroir navigateur change de palette sans rechargement quand l'utilisateur choisit un autre thème côté natif.
- **M18 (0.3.3) — dimensionnement multi-pane des terminaux.** Nouveau `src/shared/xterm-fit.ts` porte le `fitSurfaceTerminal` natif : bail sur dimensions parent nulles, lit les métriques de cellule depuis le render service, appelle `_renderService.clear()` avant `term.resize` pour que de fraîches métriques remplacent les anciennes en cache, soustrait le padding CSS `.xterm` du calcul. `applyLayout` écrit les rects inline → force un flush de layout CSS via `void termEl.offsetHeight` → appelle `fitTerminal` par pane dans le même tick. La passe rAF différée disparaît. `applySettings` re-fit sur changement de `fontSize` / `fontFamily` / `lineHeight`.
- **Correctif de taille 0.3.1.** `fit()` par pane refait correspondre chaque pane à son conteneur (avant le correctif, tous les panes étaient forcés à la taille faisant autorité du SERVEUR). La barre de statut ne tronque plus la dernière rangée du terminal.

### Explorateur de fichiers CWD sidebar (natif)

- **Les cartes workspace affichent toujours le CWD.** La sidebar webview rend une ligne CWD pour chaque carte workspace, y compris pour les cartes mono-CWD et les états « métadonnées indisponibles ».
- **Explorateur de fichiers natif uniquement.** Explorateur pliable enraciné sur le CWD du workspace sélectionné, avec listing paresseux par répertoire, refresh, contrôles Settings pour les dotfiles + max-entries. Natif uniquement — le miroir HTTP n'est pas câblé (pour l'instant).
- **Polissage AAA.** Résumés filtrés (affichés / cachés / ignorés), en-tête de chemin racine, métadonnées de fichier plus riches (taille + date de modif), sémantique accessible `role="tree"` / `role="treeitem"`, états de focus renforcés, action « Nouveau fichier » qui ouvre un split CodeMirror en mode création.

### Panneau d'éditeur CodeMirror

- **Surface d'éditeur (`editor:*`).** Une surface d'éditeur native uniquement webview adossée à CodeMirror 6. Les fichiers s'ouvrent depuis l'explorateur sidebar ou via `ht edit` / `ht editor ...`. Édition en split, sauvegarde avec `⌘S`, rechargement, fermeture, restauration à travers la persistance de layout.
- **RPC fichier d'éditeur.** Bun fait les lectures de texte locales et les sauvegardes atomiques avec garde-fous binaires / gros-fichier et détection de conflit par mtime. Le miroir HTTP n'est pas câblé pour les panneaux d'éditeur dans cette itération.

### Disponibilité du pane pour `ht run-in-split`

- **Attendre la nouvelle pane avant de taper.** L'extension `ht-bridge` pour pi snapshotte `surface.list`, gère les réponses `surface.split` qui ne renvoient que `"OK"`, sonde jusqu'à ce que la nouvelle surface apparaisse, et n'envoie la commande qu'après confirmation de `surface.wait_ready` que les métadonnées du nouveau terminal sont observables. Sortie propre en cas de timeout sans perte d'input.
- **`surface.split` renvoie l'id de la surface créée quand disponible.** Le dispatch interne fait suivre la surface source / CWD demandés et renvoie `{ id }` pour la création synchrone, en conservant `"OK"` comme repli de compatibilité.

## 0.2.82

- pi-extensions/ht-bridge : les résumés label-actif et `agent_end` suivent désormais le modèle vivant de la session pi (auth + base URL synchronisés). Passer pi de Haiku à Sonnet redirige aussi le résumeur sans édition de config. Nouveau flag `useSessionModel` (par défaut `true`) + override d'env `PI_HT_BRIDGE_USE_SESSION_MODEL` ; la paire `provider` / `modelId` existante devient le chemin de repli (fallback).
- claude-integration : nouvelle skill Claude Code `tau-mux` à `claude-integration/skills/tau-mux/SKILL.md`. Reflète le côté *actif* / outils LLM-appelables de `pi-extensions/ht-bridge` (plans → `.claude/plans/<name>.md` revue-gatée via `ht ask choice` puis `ht plan set`, `ht ask {yesno|choice|text|confirm-command}` pour les questions structurées, `ht notify` aux jalons, `ht new-split` + `ht send` pour les processus longs, `ht browser` pour la vérification, `ht screenshot` pour les preuves, `ht set-status` / `ht set-progress` pour les signaux en cours, garde bash-safety). Le pont de hooks d'exécution conserve la responsabilité des pastilles passives (label actif, téléscripteur de coût, idle/permission). `install.sh` installe maintenant les deux pièces ; `SKIP_HOOKS=1` / `SKIP_SKILL=1` pour des installations partielles.

## 0.2.x

- Pont Telegram : panneau de chat, service bot en long-poll, journal SQLite, CLI `ht telegram`, transfert optionnel des notifications.
- Sharebin : déposer-et-partager des fichiers servis par le miroir web.
- Améliorations du panneau navigateur : plus de 40 commandes `ht browser`, barre d'adresse avec détection d'URL intelligente, mode sombre forcé, interception des liens du terminal.
- Gestionnaire de processus : repli/déploiement par surface, puces de port à l'intérieur des lignes, en-tête récapitulatif.
- Métadonnées de processus en direct : état git (branche, ahead/behind, compteurs « dirty ») ajouté à la charge utile par surface, mis en cache avec TTL.
- Miroir web : enveloppes du protocole v2, reprise à la reconnexion via un buffer circulaire de 2 Mo, rejeu d'instantané `@xterm/headless`, comparaison des jetons en temps constant.
- Carte du `package.json` de l'espace de travail avec lancement de script en un clic et points d'état vert/rouge/gris.

## 0.1.x

- Première préversion publique.
- Espaces de travail, splits en mosaïque, séparateurs glissables.
- xterm.js + PTYs `Bun.spawn`.
- Protocole sideband (fd 3/4/5) avec clients Python + TypeScript clients.
- Panneaux canvas flottants.
- CLI `ht` pour le contrôle via socket.
- Miroir web v1.
