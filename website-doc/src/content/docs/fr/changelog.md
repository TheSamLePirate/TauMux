---
title: Journal des modifications
description: Changements notables — les plus récents en haut.
sidebar:
  order: 1
---

Cette page résume les changements visibles par les utilisateurs. Le journal complet des commits est sur [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main), et le projet livre désormais un `CHANGELOG.md` généré à la racine du dépôt qui regroupe les commits par type conventional-commit (ajouté en 0.3.145).

## 0.9.0 — Le panneau Claude Code, aligné sur le système de design τ-mux

Le panneau ressemble et se comporte désormais comme une surface d'agent native de τ-mux, plus comme une application invitée.

- **Identité agent ambre (§7).** Une session Claude est la session d'un robot : le panneau porte donc le même signal **ambre** que le panneau d'agent pi — point d'identité, bordure du panneau focalisé, carte de la barre latérale et entrée de la barre d'état. D'un coup d'œil, vous distinguez un panneau d'agent de vos shells cyan. (Il s'affichait auparavant en cyan « humain », avec une palette Catppuccin héritée du pont v1.)
- **Alignement complet palette/formes/mouvement.** Chaque couleur vient d'un token TAU, les rayons suivent l'échelle du système, la télémétrie est en monospace à chiffres tabulaires, et les animations se limitent aux keyframes canoniques de τ-mux. Une nouvelle suite de tests de conformité verrouille l'ensemble pour éviter toute dérive.
- **Barre de contrôle groupée.** Identité + badge d'état + modèle + mode de permission à gauche ; compteurs tokens/coût/durée et New · Sessions · Stop à droite. La phase est désormais écrite en toutes lettres (`idle`, `working`, `approval needed`, `ended`) au lieu d'être encodée seulement par une couleur.
- **Répertoire de travail partout.** Le panneau affiche son cwd dès l'ouverture — dans l'en-tête et via la même pastille cwd que les panneaux terminal — et il alimente la carte de la barre latérale : fini le « resolving… » sur un panneau Claude.
- **Retour visuel sur la file d'attente.** Envoyer pendant un tour en cours marque le message comme mis en file et affiche une pastille en pied de panneau, au lieu de sembler ne rien faire.
- **Bouton copier** sur les messages terminés de l'assistant (au survol), en plus des boutons de copie sur l'entrée/sortie des outils.
- **`ht claude pane`** — ouvrez un panneau Claude Code depuis le CLI ou un script (`--cwd`, `--split`, `--direction`, `--resume`), à l'image de `agent.create` pour le panneau pi. Également exposé en `claude.pane` via JSON-RPC et dans le SDK d'extensions.

## 0.8.0 — Le panneau Claude Code, complet

Le [panneau natif](/fr/features/claude-code-pane/) passe d'un v1 fonctionnel à la surface phare :

- **Transcript markdown** avec streaming O(N), blocs de code, code inline, titres et listes ; **blocs de réflexion** streamés dans un bloc replié pulsant.
- **Cartes d'outils v2** — point d'état (en cours → ok/échec), résumés d'une ligne, **entrée et sortie appariées** dépliables (`tool_use_id`) avec boutons copier.
- **Sessions sur place** — *New* démarre une session neuve dans le même panneau ; *Sessions* reprend (ou **forke**) une session précédente avec son transcript rejoué sous un séparateur. Le panneau rebranche son flux SDK ; l'emplacement de disposition ne change jamais.
- **Sélecteur de modèle** (en cours de session, via le SDK) à côté du sélecteur de mode ; `bypassPermissions` surligné en rouge.
- **Statut d'approbation en ligne** — « Waiting for approval: Bash » apparaît dans le transcript pendant que la modale τ-mux / Telegram est ouverte ; refus et expirations laissent une trace rouge.
- **Compteurs + état** — pastilles tokens / coût / durée, point d'état pulsant, autoscroll intelligent avec pastille ↓ latest, un vrai état vide, et héritage du cwd : les nouveaux panneaux démarrent dans le dossier du panneau focalisé.
- Composeur : zone de texte auto-extensible ; **envoyer en cours de tour met en file**.

## 0.7.1 — Intégration Claude Code (jalons 1–3)

τ-mux devient un harnais de premier rang pour Claude Code — plan : `doc/august-plan.md`. Trois versions en une vague ; voir la page réécrite [Intégration Claude Code](/fr/integrations/claude-code/).

- **Conscience du cycle de vie complet (0.5.0).** Le pont de hooks transmet désormais **quatorze** événements Claude Code (contre quatre) : début/fin de session, prompt/stop, échecs API, sous-agents, compaction, changements de cwd, tâches créées/terminées, notifications idle/permission. Un registre par session suit la phase de chaque session — en cours / en attente / **approbation requise** / compaction / erreur — attribuée au panneau où elle tourne. Les erreurs API ont leur propre état rouge et une notification actionnable (« Rate limited »).
- **`ht claude statusline` (0.5.0).** Une ligne dans `~/.claude/settings.json` donne à Claude Code une statusline au style τ-mux (modèle, effort, dossier, branche git, mode de permission, badge PR, barre de contexte colorée, coût, ±lignes, alertes de rate-limit ≥80 %) **et** alimente le ticker de la barre latérale (`Opus · 42% ctx · $0.31`) en coût / % de contexte / rate limits / titre de session. Ce sont des valeurs calculées par Claude Code lui-même — l'ancienne analyse de transcripts, la table de prix maintenue à la main et le générateur de titres basé sur `pi` sont supprimés ; les pastilles correspondent désormais toujours à `/cost` et `/context`.
- **Approbations à distance, opt-in (0.6.0).** `ht claude install --features approvals` route les demandes de permission de Claude Code vers une [modale ask-user](/fr/features/ask-user/) τ-mux — et vers **Telegram** — avec Allow / Deny / « Answer in terminal ». Fail-safe par construction : tout échec (τ-mux arrêté, expiration, erreur) retombe sur l'invite native de Claude Code ; la porte ne peut qu'*ajouter* un chemin de réponse. Approuvez une commande `Bash` depuis votre téléphone.
- **Miroir de tâches automatique (0.6.0).** La liste de tâches native de Claude Code se projette dans le [panneau de plan](/fr/features/plan-panel/) de façon déterministe (hooks, pas de coopération du modèle), par session, effacée en fin de session, cohabitant avec les plans pi. Avec les notifications de fin de tour, cela branche les sessions Claude Code sur le moteur d'[auto-continue](/fr/features/auto-continue/) existant.
- **Installation en une commande (0.6.0).** [`ht claude install / uninstall / doctor`](/fr/cli/claude/) — sauvegardes horodatées, fusion additive, idempotence, refus en cas d'échec de parse, et un doctor qui nomme exactement ce qui manque.
- **Panneau Claude Code natif (0.7.0).** Une surface de premier rang hébergeant une session via le SDK Agent : réponses en streaming, cartes d'outils, sélecteur de mode de permission, interruption, pastilles de coût, et un **sélecteur de sessions qui reprend les sessions précédentes**. Les permissions d'outils passent par le même chemin modale + Telegram. Voir [Panneau Claude Code](/fr/features/claude-code-pane/).
- **Pastille d'équipes d'agents (0.7.1).** Avec les équipes d'agents expérimentales de Claude Code activées, une pastille passive affiche `3 members · 2/6 tasks` depuis l'état d'équipe sur disque.
- Nouveau [domaine JSON-RPC `claude.*`](/fr/api/claude/) + espace de noms `claude` dans le SDK d'extensions.

## 0.4.12 — Remédiation d'audit

Tout ce qui était actionnable dans l'audit complet de 2026-08 (`doc/full_app_review_2026-08.md`) sauf les défauts du miroir web (reportés).

- **Sécurité — jeton du socket RPC activé par défaut.** `rpcSocketRequireToken` vaut désormais `true` : les appels socket mutateurs exigent le jeton par démarrage. Chaque client interne (le `ht` embarqué, le pont pi, le SDK d'extensions, le pont Claude) le lit automatiquement — rien ne change à l'usage ; les diagnostics en lecture seule restent ouverts pour que `ht doctor` fonctionne. Voir [auth & durcissement](/fr/web-mirror/auth-and-hardening/).
- **Sécurité — frontière de confiance des extensions.** Le repli réseau `bun x` des serveurs dev est supprimé ; le drapeau `enabled` est réellement appliqué (une extension désactivée refuse de s'ouvrir — elle se lançait silencieusement avant) ; nouveaux verbes [`ht extension enable / disable`](/fr/cli/extensions/) ; les backends ont une vraie escalade SIGTERM→SIGKILL. Le modèle de confiance est désormais énoncé clairement : **les extensions sont du code totalement de confiance — n'installez que ce que vous enverriez dans un shell.**
- **Correction.** L'élagage des échantillons CPU s'exécute vraiment (un garde le rendait inopérant — la table ne rétrécissait jamais) ; le libellé du bascule GPU dans la palette n'est plus inversé avant le chargement des réglages ; `system.identify` renvoie `null` au lieu d'un chemin de socket plausible mais faux ; les ports des serveurs dev d'extensions sont alloués par instance (deux extensions sans devPort — ou n'importe quel projet Vite sur 5173 — pouvaient charger la mauvaise UI dans un panneau).
- **Corrigé pour de bon — panneaux GPU vides.** La 0.4.11 avait remis `dom` par défaut, mais quiconque avait lancé la 0.4.9/0.4.10 avait `webgl` *persisté* dans ses réglages : panneaux vides sur deux versions. Une migration unique (schéma v1 → v2) remet un `webgl` persisté sur `dom` ; le réactiver ensuite tient. Le rendu GPU reste expérimental, et le panneau de réglages affiche désormais un indice « running on DOM — <raison> » quand le rendu GPU est retombé.
- **Performance.** Le tick 1 Hz de la barre de statut du webview est sauté quand la fenêtre est cachée (il reconstruisait tout le sous-arbre chaque seconde même occulté).
- **Outillage.** La porte de couverture signale désormais les fichiers qu'elle ne mesure pas (elle était aveugle à ~2 000 LOC de nouveaux fichiers depuis mai) ; un nouveau cliquet de taille de modules fait échouer la CI quand un module déjà trop gros grossit encore.

## 0.4.11 — Performance du bureau

La vague `doc/desktop-perf-plan.md` (v0.4.8 → v0.4.11).

- **Poller de métadonnées réécrit sur FFI libSystem (0.4.8).** `ps` + deux `lsof` par tick 1 Hz (~200 ms de CPU sous-processus chaque seconde) remplacés par des appels directs `sysctl(KERN_PROC_ALL)` + `proc_pidinfo` / `proc_pidfdinfo` : mesuré **135,8 ms → 2,42 ms par tick (56×)** ; le CPU du processus principal au repos passe de 7–10 % à ~1 %. Le module auto-valide ses offsets de structures noyau au démarrage et retombe proprement sur `ps`/`lsof` en cas d'écart ou hors macOS.
- **CPU% plus précis (0.4.8).** Chips, gestionnaire de processus et barre latérale dérivent le CPU des deltas de temps CPU cumulés au lieu de la moyenne décroissante de `ps` — un processus qui vient de finir une rafale ne traîne plus à une valeur élevée.
- **Coalescence stdout adaptative (0.4.10).** L'écho des frappes sur un terminal calme n'attend plus la fenêtre de regroupement ; le regroupement ne s'engage que sous flux soutenu.
- **Rendu GPU optionnel du terminal (0.4.9, opt-in depuis 0.4.11).** Nouveau réglage `terminalRenderer` (`dom` par défaut, `webgl` opt-in) plus une bascule dans la palette. **Expérimental** — livré activé en 0.4.9, il rendait des panneaux vides sur certaines configurations ; voir la note 0.4.12 ci-dessus pour la migration du réglage persisté.

## 0.4.7 — Nebula, la surface SDK complète & correctifs de la plateforme d'extensions

La première vague de durcissement de la plateforme d'extensions, plus un exemple vitrine.

- **Nebula — un explorateur d'API HTTP en 3D (0.4.4).** Une extension vitrine : un client HTTP complet à la Postman rendu comme une scène three.js vivante avec un HUD en glassmorphisme. Elle **découvre les serveurs de dev qui tournent dans vos terminaux** (via les ports en écoute des métadonnées de processus) et transforme chacun en endpoint orbital cliquable, fait transiter les requêtes à travers la scène (anneaux de réponse colorés selon le statut, animation calée sur la latence), et pilote τ-mux depuis votre flux de travail API — ouvrir une URL dans un panneau navigateur, envoyer la requête en `curl` dans un nouveau split de terminal, sparkline de latence en direct dans la barre latérale, notifications en cas d'échec. `ht extension install …/examples/extensions/nebula`. Voir [Applications d'extension](/fr/features/extensions/#exemples-embarqués).
- **`@tau-mux/sdk` type désormais la surface de contrôle complète (0.4.7).** La façade typée est passée de 6 espaces de noms triés sur le volet à **l'ensemble des 17 domaines RPC (~120 méthodes)** — y compris le pilote navigateur complet (click / type / eval / snapshot / cookies / console), les agents (dont les modales `askUser`), telegram, les panneaux éditeur, les plans, l'auto-continue, les audits, les captures d'écran et la plateforme d'extensions elle-même — à l'identique depuis le backend Bun et le frontend Vite. Un test de couverture bidirectionnel maintient le SDK et le registre de l'hôte en parfaite synchronisation. (Corrigé au passage : `sidebar.setStatus` visait jusque-là un nom inexistant sur le fil — il appelle désormais correctement `sidebar.set_status`.)
- **Les extensions s'installent n'importe où (0.4.6).** Le SDK est vendoré dans chaque exemple fourni (`file:./vendor/tau-mux-sdk`), donc `bun install` se résout hors ligne dans les builds dev, installées et packagées — auparavant, un chemin relatif au dépôt se cassait dès que l'extension était copiée dans le répertoire de config, laissant le panneau vide.
- **Correctifs du panneau d'extension (0.4.2 – 0.4.5).** Le bouton de fermeture du panneau arrête désormais le backend + le serveur de dev de l'extension (plus de fuite de processus) ; la pastille de statut passe à « running » quand l'iframe se charge réellement ; le mode dev attend que le serveur Vite écoute avant d'y pointer l'iframe ; et une régression à l'initialisation de la webview qui désactivait la palette de commandes + le double-clic sur la barre de titre (un throw TDZ pendant l'init du module) a été corrigée, avec un test de régression structurel.

## 0.4.0 — Applications d'extension

Un nouveau type de surface : les **applications d'extension**. Une extension est un **backend Bun** (un véritable processus enfant qui peut faire `bun install` de ses propres dépendances) + un **frontend Vite** rendu dans une `<iframe>` (rechargement à chaud des modules pendant l'édition, statique compilé une fois installé) + un **`@tau-mux/sdk`** typé qui pilote chaque surface de contrôle de τ-mux — créer des panneaux, ouvrir des surfaces navigateur, envoyer des notifications, définir le statut de la barre latérale, et plus encore. Les extensions sont sauvegardées sur disque, restaurées avec votre disposition, et créées / éditées / supprimées depuis l'intérieur de l'app.

- **Surface `extension` (0.4.0).** Ouvrez-en une dans un panneau comme n'importe quelle autre surface. Chaque surface en cours d'exécution obtient son propre backend Bun (démarré à neuf, arrêté à la fermeture) et une iframe pointée vers l'URL de dev Vite (HMR) ou un bundle compilé servi par un minuscule hôte en boucle locale. Sauvegardée avec l'espace de travail par id d'extension ; au redémarrage, la surface + un backend neuf sont restaurés (l'extension recharge son propre `state.json`), ou l'emplacement se dégrade en terminal si l'extension a été désinstallée. Voir [Applications d'extension](/fr/features/extensions/).
- **`@tau-mux/sdk` (0.4.0).** Une seule surface typée depuis les deux moitiés d'une extension — `notification`, `sidebar`, `surface`, `workspace`, `browser`, `system`, plus un `call(method, params)` brut pour atteindre n'importe quelle [méthode JSON-RPC](/fr/api/overview/). Le backend dialogue via la socket unix ; le frontend via un pont `postMessage` que l'hôte route via la même RPC qu'utilise la CLI.
- **CLI `ht extension` + API `extension.*` (0.4.0).** `list`, `templates`, `open`, `split`, `new`, `install`, `remove`, `reload`, `stop`. Voir [`ht extension`](/fr/cli/extensions/) et l'[API `extension.*`](/fr/api/extensions/).
- **Exemples embarqués (0.4.0).** `hello` (app statique sans dépendance — la façon la plus rapide de voir le pont), `three-demo` (Vite + three.js avec HMR ; le backend pilote la barre latérale + les notifications), et `http-client` (un constructeur de requêtes à la Postman dont le backend exécute `fetch` sans CORS et persiste l'historique). Ils servent aussi de templates d'échafaudage.
- **Éditeur intégré (0.4.1).** La palette de commandes (`⌘⇧P`, « Extensions ») propose désormais, par extension installée, **Open**, **Edit** (ouvre sa source backend — ou `manifest.json` — dans la [surface éditeur](/fr/features/file-explorer-and-editor/), la boucle live édition → HMR) et **Remove**, plus **New Extension…** pour échafauder à partir d'un template.

Les extensions sont **entièrement de confiance** — il n'y a pas de bac à sable ; les `permissions` du manifeste sont indicatives. N'installez que ce dont vous avez confiance, exactement comme vous le feriez pour un script shell.

## 0.3.188 — Polish UI : rendu sans scintillement, redimensionnement fluide & réglages instantanés

Une passe de qualité ciblée sur le churn de rendu, la mémoire des sessions longues, la résilience des services et le panneau Réglages — plus dix nouveaux utilitaires shareBin.

### Rendu & scintillement

- **Graphiques de status-keys repensés + sans scintillement (0.3.184 – 0.3.185).** Les rendus de graphiques de `ht set-status` ont eu droit à une refonte visuelle (courbes ligne/aire lissées avec remplissages en dégradé, grille de référence + dernière valeur en gros titre, jauges centrées sur la valeur, barres et cellules de heatmap arrondies), et les grilles de statut réconcilient désormais le DOM **a minima, en place** — un tick `set-status` à 1 Hz ne repeint que les entrées dont la valeur a réellement changé, en natif comme sur le miroir web. `shareBin/demo_status_keys --live` en est une bonne vitrine.
- **Cartes d'espace de travail sans scintillement dans la barre latérale (0.3.187).** La barre CPU, les puces % / RAM / processus et la sparkline se mettent à jour en place à chaque tick de métadonnées ; le remplissage de la barre CPU conserve son identité de nœud, donc sa transition s'anime au lieu de sauter. Les cartes se rafraîchissent désormais aussi sur les mouvements CPU/MEM en direct, tandis qu'un espace de travail vraiment inactif ne coûte toujours rien.
- **Plus de stroboscope sur la pile de notifications (0.3.187).** La pile de notifications sur le terminal se réconcilie en place : les cartes existantes conservent leur état d'entrée en glissement et leur compte à rebours d'auto-fermeture quand de nouvelles arrivent.
- **Les panneaux sideband ne restent plus bloqués transparents (0.3.187).** Les panneaux créés pendant que la fenêtre était en arrière-plan ne dépendent plus d'un rAF que WKWebView peut suspendre — l'opacité de repos est posée de façon synchrone, avec un fondu d'entrée CSS auto-réparateur.

### Sensations & résilience

- **Redimensionnement fluide de la barre latérale (0.3.187).** Faire glisser le séparateur de la barre latérale ne fait que repositionner les panneaux pendant le glissement ; le refit de terminal faisant autorité s'exécute une seule fois au relâchement — fini le reflow saccadé à chaque frame.
- **Le terminal ne saute plus au redimensionnement (0.3.187).** Les refits (redimensionnement de la barre latérale ou d'un panneau, déclencheurs des panneaux sideband) préservent votre position dans le scrollback ; les TUIs en écran alternatif (vim, htop) ne sont pas touchés.
- **Moins de CPU et de mémoire au repos (0.3.187).** Barre de statut du miroir web coalescée en rAF, bandeaux de logs/stats de la barre latérale mis à jour en place, le polling de métadonnées ralentit quand la fenêtre perd le focus, et plusieurs fuites de session longue ont été colmatées (observers/timers par panneau du miroir web, timer de retry du panneau navigateur, état par surface de l'auto-continue, statut d'espace de travail mort dans le store web, le cache de titres ask-user).
- **Des services plus résilients (0.3.187).** Un crash dans un gestionnaire Telegram ne peut plus rétrograder la boucle de long-poll ; un spawn d'agent raté affiche une bannière `agent_exit` au lieu d'un panneau inerte ; et le pipeline stdout du PTY est protégé contre un sink de sortie défaillant.
- **Des Réglages instantanés et fluides (0.3.188).** Faire glisser un curseur ne cale plus à chaque pas — détection de changement par valeur, application coalescée en rAF, persistance débouncée, et `applySettings` saute le travail de refit/layout par panneau quand les champs modifiés ne l'exigent pas. Les réglages s'appliquent instantanément, sans bouton Apply.

### CLI & shareBin

- **`ht` fonctionne depuis n'importe quel shell (0.3.187).** Le chemin de socket par défaut de la CLI est désormais le vrai socket du répertoire de config de l'app (`~/Library/Application Support/hyperterm-canvas/hyperterm.sock`) au lieu de l'ancien `/tmp/hyperterm.sock` — `ht` se connecte depuis des terminaux que l'app n'a pas lancés, sans export `HT_SOCKET_PATH` (il reste prioritaire ; `ht doctor` diagnostique les divergences).
- **Dix nouveaux utilitaires shareBin (0.3.186).** `show_logs` (visionneuse de logs en direct), `show_csv_profile` (profilage CSV/TSV), `show_http` (inspecteur de réponses HTTP), `show_mermaid` (diagrammes Mermaid — la première version rend via un bundle CDN), `show_env` (diagnostics d'environnement), `show_sqlite` (navigateur SQLite en lecture seule), `show_ports` (tableau de bord en direct des ports en écoute), `show_proc` (arbre de processus en direct), `show_image_diff` (comparaison d'images), `show_openapi` (explorateur OpenAPI/Swagger). Voir [shareBin](/fr/features/sharebin/).

## 0.3.183 — Captures d'écran d'espace de travail

- **`ht screenshot workspace` (0.3.183).** La CLI de capture saisit désormais tout un **espace de travail** — la boîte englobante de tous les panneaux visibles — en plus des cibles existantes panneau unique (par défaut) et fenêtre entière (`window` / `--full-window`). `ht screenshot workspace [id]` ou `--workspace [id]` cible l'espace actif (ou un espace précis). Une cible masquée/en arrière-plan retombe désormais sur la capture de la fenêtre entière au lieu d'un rognage vide. Voir [Surfaces & E/S](/fr/cli/surfaces-and-io/#screenshot).

## 0.3.182 — Fiabilité, performance & durcissement de la CLI

Une seconde passe sur la revue de code (`doc/full_app_review_2026-05.md`) a clos les dernières anomalies critiques/élevées — perte de données à la fermeture, CPU au repos, emballement des coûts d'agent, une faille XSS sideband côté natif — plus des nettoyages internes. Du plus récent au plus ancien.

### Sécurité

- **Le HTML/SVG sideband est désormais isolé côté natif (0.3.181).** Le contenu de panneau `html` / `svg` en affichage seul (inline `meta.data` ou trames fd 4) est rendu dans une `<iframe sandbox>` à CSP stricte sur l'application native aussi — plus seulement le miroir web — afin qu'un producteur sideband négligent ou compromis ne puisse pas exécuter de script avec tous les privilèges IPC de l'application. Un panneau qui doit transmettre des événements DOM bascule explicitement sur le rendu direct via `interactive`. Voir [Données binaires (fd 4)](/fr/sideband/data-fd4/).

### Performance & fiabilité

- **Plus de perte de données silencieuse à la fermeture (0.3.174).** Fermer la fenêtre, ⌘Q, quitter depuis le Dock ou la sortie de la dernière surface persiste désormais de façon fiable votre disposition, vos réglages, vos cookies et l'historique du navigateur. (Les fermetures GUI macOS contournent les signaux Unix sur lesquels reposait l'ancien chemin de sauvegarde, qui était donc ignoré sur les sorties courantes.)
- **Le CPU au repos chute nettement (0.3.179).** Le sondeur de métadonnées de processus (1 Hz) ralentit désormais (1s → 2s → 4s, plafonné à 5s) lorsqu'un terminal est inactif et inchangé, et revient à 1s dès qu'une sortie, l'ouverture/fermeture d'un panneau ou le focus de la fenêtre change. Un terminal inactif mais au premier plan passe de ~6–9 % d'un cœur à un filet ; un terminal actif est inchangé.
- **Les effets cessent de brûler des cycles au repos (0.3.173).** Le bloom WebGL ne se re-rend plus à chaque clignotement du curseur et se met en pause pour les espaces de travail en arrière-plan (non visibles) ; les colonnes CPU / RSS du gestionnaire de processus ne se figent plus.
- **L'auto-continuation ne peut plus faire grimper la facture (0.3.175).** Le moteur d'auto-continuation applique désormais ses garde-fous de refroidissement et d'emballement *avant* de consulter le modèle ; un agent bavard ou en boucle ne déclenche donc plus d'appel payant à chaque notification de fin de tour ; l'avis « agent en boucle » n'est journalisé qu'une fois par épisode.
- **Les panneaux d'agent plantés sont récupérables (0.3.176).** Quand un sous-processus d'agent pi se termine, son panneau désactive désormais la saisie, affiche « Agent process exited (code N) » et propose un bouton **Restart agent** en un clic — auparavant la saisie restait active et avalait silencieusement tout ce que vous tapiez, sans moyen de récupérer.
- **Correctif de parité de la barre latérale du miroir web (0.3.180).** Le cwd raccourci et la valeur de RAM de la carte d'espace de travail correspondent désormais exactement à la barre latérale native (le miroir affichait auparavant une forme de chemin différente et rendait tout processus de moins d'1 Mo comme un `0M` erroné).

### Architecture & outillage

- **Découpage des internes de la CLI `ht` (0.3.182).** Le point d'entrée de 2 361 lignes a été scindé en un `bin/ht` mince plus des modules `src/cli/` testables (drapeaux, transport RPC, mappage des commandes). Aucun changement de commande, de drapeau ou de sortie.
- **Suppression de code mort dans le gestionnaire d'agents pi (0.3.177).** ~200 lignes d'un chemin IPC d'agent à Promesses inutilisé ont été retirées ; le chemin actif « envoyer sans attendre » est inchangé.
- **Couverture de tests du sondeur de métadonnées (0.3.178).** L'orchestration 1 Hz, jusque-là non testée, a gagné 11 tests via des exécuteurs de sous-processus injectables. Durcissement interne pur.

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
