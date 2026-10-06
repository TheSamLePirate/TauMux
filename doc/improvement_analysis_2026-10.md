# τ-mux — Analyse d'amélioration (2026-10)

**Version auditée :** 0.23.1 · **Branche :** main · **Méthode :** sondes manuelles
vérifiées file:line (les subagents étaient indisponibles dans cette installation de pi).
Chaque constat ci-dessous a été vérifié dans le code au moment de l'écriture.

**Relation à l'analyse précédente** (`improvement_analysis_2026-08.md`, v0.10.8) :
709 commits ont été livrés depuis. Cette analyse mesure d'abord ce qui a été corrigé,
puis ce qui reste cassé, puis ce que le nouveau code (ATLAS, CHRONO, blocks OSC 133,
clickable paths) ajoute ou casse.

---

## Verdict

La machine qualité interne tourne toujours (ratchet module-size vert, 306 fichiers de
tests, audits theming/emoji/animations). Le nouveau code vedette — CHRONO — est un
**modèle de discipline** : RAF dirty-flag, aucun timer quand la vue est idle
(`chrono.ts:520-545` : *"an idle τ-mux is completely still"*), event log borné
(TTL + cap, `event-log.ts:19-28`), pattern `disposers[]` avec `close()` qui libère tout,
9 fichiers de tests.

**Mais le constat central est ailleurs : la liste "Week 1 — stop the bleeding" de
l'analyse d'août n'a presque pas été exécutée.** Les findings CRITICAL/HIGH d'il y a
deux mois sont toujours dans le code, pendant que 709 commits de features (ATLAS,
CHRONO, IDE host, clickable paths) ont été livrés. Le problème du projet n'est pas de
trouver des améliorations — c'est que les petits fixes de haute sévérité perdent
systématiquement contre le travail de features.

Le deuxième constat : la doc `system-osc-sequences.md` est maintenant fausse **dans
l'autre sens** — elle décrit l'état pré-v0.11 alors que le code a livré OSC 52 et
OSC 133. La dérive documentaire pointe des deux côtés.

---

## 1. Toujours cassé — vérifié à l'instant (STILL BROKEN)

### 1.1 CRITICAL — `new TelegramDatabase()` non gardé peut briquer le boot

`src/bun/index.ts:393` : construction au top-level du module, hors de tout try/catch.
Le try/catch de `:396` ne protège que les *prunes*, pas le constructeur (qui ouvre le
fichier SQLite, exécute PRAGMAs + DDL — tous susceptibles de throw sur WAL corrompu).
`socketServer.start()` est ~2 300 lignes plus bas : un throw à `:393` = pas de socket
(`ht` mort), pas de notifications, pas de fenêtre. C'était §1.1 de l'analyse d'août —
*le bug rapporté par l'utilisateur* ("when telegram crash, notification dont work and
ht dont work anymore") — et il est intact.

** aggravé par :** tout le bootstrap est une séquence de constructions top-level non
gardées — `SettingsManager` (:323), `SessionManager` (:325), `PiAgentManager` (:326),
`BrowserHistoryStore` (:339), `CookieStore` (:340), `ExtensionManager` (:374) — sans
fonction `main()` enveloppante. Un throw n'importe où avant `:749` (`new BrowserWindow`)
est silencieusement avalé par `uncaughtException`.

**Fix (S) :** envelopper tout le bootstrap dans un `main()` avec catch explicite ;
pour la DB telegram : rename `telegram.db.corrupt-<ts>` + retry + fallback null DB +
`health.set("telegram", "error")`. Test de régression : booter avec une DB poubelle
et vérifier que le socket bind.

### 1.2 HIGH — Miroir web non authentifié par défaut

Inchangé : `webMirrorBind: "0.0.0.0"` + `webMirrorAuthToken: ""` par défaut
(`src/shared/settings.ts:812-813`), et `if (!this.authToken) return true`
(`src/bun/web/server.ts:233`). Le chemin `stdin` du miroir écrit dans un vrai PTY.
Le seul rempart est `autoStartWebMirror: false` — un toggle à un clic qui ne demande
jamais de token. Sur un Wi-Fi partagé = shell distant en tant que vous.

**Fix (S) :** refuser de démarrer sur `0.0.0.0` avec token vide ou <16 chars —
générer `randomBytes(24).toString("base64url")` et l'afficher, ou retomber sur
`127.0.0.1`.

### 1.3 HIGH — La webview ne peut toujours pas rapporter ses propres pannes

- `surface-manager.ts` : **0 `try {` sur 2 936 lignes** (recompté).
- Aucun `window.addEventListener("error" | "unhandledrejection")` dans
  `src/views/terminal/` (seuls `browser-pane.ts:131,139` — dans une string injectée
  aux pages invitées) ni dans `src/web-client/`.
- `src/shared/event-bus.ts:64-77` invoque toujours chaque subscriber non protégé.

Le côté bun a `attributeFault` + `FAULT_BUDGET` + health rows ; la couche qui tient
100 % de l'UI n'a rien. Chaque "sidebar froze" reste irreproductible par construction.

**Fix (S) :** listeners `error`/`unhandledrejection` dans le bootstrap `index.ts` →
`rpc.send("webviewFault", …)` → bun log + health row. try/catch dans le `wrapped`
d'`EventBus.on`.

### 1.4 MED — Le bug scroll-to-top n'est pas corrigé

`src/shared/xterm-fit.ts:113-116` : toujours
`Math.max(0, Math.min(after.baseY, after.baseY - distFromBottom))` — le clamp à 0 qui
slam le viewport en haut du scrollback quand `baseY` diminue après resize.
Et le miroir (`src/web-client/main.ts:448`) appelle toujours `ref.term.resize()` **à
nu**, sans passer par l'helper partagé.

**Fix (S) :** `if (after.baseY <= 0) return; const dist = Math.min(distFromBottom,
after.baseY); const target = after.baseY - dist;` + router le miroir par le même
helper.

### 1.5 MED — Panels transparents quand le terminal perd le focus

`clearTypingFocusMode()` est appelé par `mousemove` (`index.ts:2717`), `mousedown`
(:2725), et quelques overlays — mais **pas** par les handlers `blur` /
`visibilitychange` (:2840, qui n'appellent que `hideSurfaceContextMenu()`). Taper une
commande puis Cmd-Tab sans bouger la souris = tous les panels restent à 30 % d'opacité
indéfiniment (`body.terminal-typing .panel { opacity: 0.3 }`). C'est le symptôme
rapporté dans `issues_now.md`.

**Fix (S) :** ajouter `clearTypingFocusMode()` aux deux handlers existants + idle
timeout ~1.2 s sur keydown.

### 1.6 MED — Le mémo de render de la sidebar est structurellement mort

`pushCpuSample` est toujours appelé depuis `buildOneWorkspace`
(`src/shared/sidebar-state.ts:255`) — le payload s'auto-mute à chaque appel, donc
`stableWorkspacesSignature` diffère à chaque tick : on paie le `JSON.stringify`
complet **et** le render. L'early-out "Phase 2B perf pass" est du code mort depuis sa
création.

**Fix (S) :** pousser le sample CPU uniquement depuis le chemin 1 Hz metadata ;
exclure `cpuHistory` de la signature.

### 1.7 MED — Miroir : 2/7 surface kinds, drift natif/miroir confirmé

- `src/shared/web-protocol.ts:341,357` ne définit toujours que `surfaceCreated` et
  `telegramSurfaceCreated`.
- `openEditorSurface` (`src/bun/index.ts:1066-1087`) : **aucun
  `app.webServer?.broadcast`** — editor, extension, agent et claude panes n'existent
  pas sur le miroir.
- La carte workspace du miroir (`src/web-client/sidebar/workspace-card.ts`) a toujours
  **0 occurrence de `show.`** vs 7 côté natif : la config des sections de carte est
  silencieusement ignorée sur le miroir.
- Pas d'UI de déconnexion : `transport.ts:171-179` dispatche bien
  `connection/status: disconnected`, mais **rien ne le rend** (0 hit "disconnected"
  dans `main.ts`/`sidebar.ts`/`client.css`) — un téléphone endormi affiche un terminal
  gelé sans explication.
- `visualViewport` : toujours 0 hit dans `src/` — sur iOS le clavier recouvre la
  barre d'accessoires et les dernières lignes.

**Fix (M) :** envelope générique `nonPtySurfaceCreated` + `Broadcaster.emit` unique ;
bannière de déconnexion ; support `visualViewport`.

### 1.8 MED — `index.css` : 15 553 lignes et le ratchet regarde ailleurs

`scripts/audit-module-size.ts:65` exclut toujours `.css` (`INCLUDE_EXT = .ts/.tsx`).
Le fichier a gonflé de 13 457 → 15 553 lignes (+16 %) en deux mois pendant que le
ratchet `.ts` passait au vert (`[module-size] OK`, les 3 fichiers baselinés ont même
légèrement *rétréci*). Les 53 fichiers `tests/theme-tokens-*.test.ts` pinnent le
texte du fichier, verrouillant toute tentative de split.

**Fix (S) :** ajouter `.css` à `INCLUDE_EXT` + baseline ; helper `loadNativeCss()`
pour les tests theme-token.

### 1.9 MED — Auto-approve : le garde-fou volume tient, le contenu n'est jamais lu

Le fix `approvalSeq` a tenu (`claude-auto-approve.ts:123-124`), le burst guard et le
check `awaitingUserChoice` sont en place dans `decidePermission` (:183-208). Mais il
n'existe toujours **aucune inspection du contenu** : pas de deny-list sur
`approvalMessage`, aucune distinction entre "lire un fichier" et "rm -rf". Le rate
limit borne le volume, pas le blast radius.

**Fix (S/M) :** deny-list regex (`\brm\s+-rf`, `sudo`, `--force`, `curl|wget .*\|\s*(ba)?sh`,
chemins de credentials) qui refuse dur + notifie.

### 1.10 LOW — divers, tous revérifiés

- **Kitty keyboard protocol** : `@xterm/xterm` toujours en `^6.0.0` — pas de CSI u.
- **GL contexts** : `terminal-effects.ts` crée toujours le contexte WebGL au
  constructeur, jamais `loseContext()` (le default `terminalBloom: false` paie quand
  même un contexte par pane).
- **panel-manager.ts:44** : toujours un `setInterval` 30 s par pane.
- **Toggle mort** : `browserInterceptTerminalLinks` déclaré/défaut/validé/rendu/
  documenté — toujours 0 consommateur.
- **`bun install` sans `--ignore-scripts`** dans extension-manager : toujours là.
- **Pas d'onboarding** (0 hit `onboarding|firstRun` dans src/) ; **pas de recherche
  settings** ; **`ht log` vs `ht logs`** : collision de nommage inchangée.

---

## 2. Corrigé depuis août — crédit où il est dû

| Finding d'août | État |
|---|---|
| §4.2(1) `macOptionIsMeta` | ✅ v0.11.1 (`terminal-key-encoding.ts` documente le mapping ⌥Enter → `ESC CR`) |
| §4.4 OSC 52 + Unicode 11 | ✅ v0.11.2 (`terminal-clipboard.ts` importe les deux addons) |
| §4.3 OSC 133 + `ht blocks` | ✅ v0.12.0 — le pari structurel a été fait (`shell-integration.ts`, `rpc-handlers/blocks.ts`, tests `command-blocks.test.ts` + `shell-integration.test.ts`) |
| §1.3 auto-approve `seq` | ✅ `claude-auto-approve.ts:123-124` |
| Retract du modal auto-approve | ✅ v0.14.1 |
| Clickable paths (v0.13/v0.16) | ✅ avec tests (`file-reference.test.ts`, `wrapped-file-reference.test.ts`) |
| §2.4 sidebar resize transition | ✅ `body.sidebar-resizing` désactive les transitions pendant le drag (`index.css:704`) |
| Socket hardcodé `/tmp/hyperterm.sock` | ✅ resté corrigé |

**CHRONO/ATLAS (le nouveau code, 7 757 lignes)** : sondé pour les pièges classiques —
aucun RAF perpétuel, aucun timer quand idle, event log borné, disposers systématiques,
9 fichiers de tests dédiés. C'est le code le mieux discipliné du webview. Rien de
critique n'a survécu à la vérification de ce côté-là.

---

## 3. Dérive documentaire et de distribution — le vrai nouveau problème

### 3.1 `doc/system-osc-sequences.md` est maintenant faux à l'envers

Le tableau affirme : OSC 52 → "xterm gates clipboard write", **τ-mux side effect :
None** ; OSC 133 → "markers visible via xterm itself", **side effect : None**. Or
v0.11.2 a livré OSC 52 via `@xterm/addon-clipboard` et v0.12.0 a livré les command
blocks OSC 133 avec `ht blocks` — deux features *τ-mux* majeures que la doc prétend
inexistantes. En août la doc promettait trop ; elle promet maintenant trop peu. Le
tests/docs-coverage gate couvre RPC/settings/commands mais pas ce fichier.

**Fix (S) :** réécrire le tableau ; ajouter OSC 133/52 à la couverture docs si possible.

### 3.2 Distribution : trois systèmes de version qui ne se parlent plus

- `package.json` : **0.23.1** (le bump script tourne).
- `CHANGELOG.md` : s'arrête à **v0.3.145, 2026-05-18** — 20 versions de travail sans
  entrée changelog (l'option `--changelog` de `bump-version.ts` existe mais n'est pas
  utilisée).
- `git tag` : s'arrête à **v0.2.30** — aucune release GitHub ne contient ATLAS, CHRONO,
  l'IDE host Claude, les blocks, les clickable paths. `.github/workflows/release.yml`
  existe et n'a jamais été déclenché sur ces versions.

**Fix (S) :** tagger v0.23.1 et pousser ; rendre `--changelog --tag --commit` le défaut
du rituel de bump (ou l'automatiser).

### 3.3 Dette de fichiers à la racine

`output.txt` (64 KB), `start.txt`, `panels.json` (vide), `claude-terminal-changes.md`,
`code_reviews/`, `.design-artifacts/` traînent à la racine. `doc/` contient ~20
`tracking_*.md` dont plusieurs soldés. `doc/issues_now.md` mélange items résolus et
ouverts — il induit activement en erreur.

**Fix (S) :** gitignore ou purge ; convertir `issues_now.md` en convention tracking-doc.

---

## 4. Séquence suggérée

**Semaine 1 — stop the bleeding, take two (tout est S, tout est revérifié) :**
§1.1 guard bootstrap + `main()` · §1.2 token miroir · §1.3 error listeners webview ·
§1.4 clamp xterm-fit (natif + miroir) · §1.5 `clearTypingFocusMode` sur blur ·
§1.10 `--ignore-scripts` + file modes 0o600 · §3.1 doc OSC · §3.2 tag v0.23.1.

**Semaine 2 — fiabilité :**
§1.9 deny-list auto-approve · §1.6 mémo sidebar · §1.7 bannière déconnexion miroir ·
§1.8 ratchet CSS · toggle mort : implémenter ou supprimer.

**Semaine 3-4 — structurel :**
§1.7 envelope `nonPtySurfaceCreated` + broadcaster unique (ferme la classe de bugs
natif/miroir qui a déjà mordu 5 fois) · onboarding overlay (toujours absent : 102
commandes palette, 83 commandes `ht`, 0 annonce) · recherche settings · GL lazy.

**Puis :** bump xterm 6.1.0-beta (Kitty keyboard) — la dernière ligne droite pour que
le PTY soit à la hauteur de l'intégration agent ; les deux paris différenciants d'août
restent valides et non pris : **MCP Apps host** (le sandbox sideband est déjà la
machinerie exacte) et **client ACP**.

---

## Note de méthode

L'analyse d'août notait : *"the quality machine measures what it can already see"*.
Deux mois plus tard la observation tient toujours — le ratchet est vert pendant que
`index.css` prend +2 100 lignes — et s'enrichit d'un corollaire : **une liste de fixes
priorisés n'a aucune valeur si le rituel du projet ne réserve pas de capacité aux
non-features.** Recommandation concrète : instaurer une règle "chaque version mineure
ferme au moins un item STILL BROKEN", ou geler une version complète (0.24.0) sur la
semaine 1 ci-dessus.
