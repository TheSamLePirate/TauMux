---
title: Variantes de disposition
description: Trois dispositions de chrome — Bridge, Cockpit et Atlas — commutables depuis un seul réglage. Atlas remplace la barre latérale par une topologie vivante de tout ce que τ-mux exécute, et ⌘G ouvre CHRONO, les 90 dernières secondes sous forme de champ temporel.
sidebar:
  order: 15
---

τ-mux propose trois **dispositions de chrome**. Elles remodèlent l'enveloppe de la fenêtre — ce qu'est la colonne de gauche, si les panneaux portent une bande HUD, ce qu'affiche la barre du bas — et rien d'autre. Le moteur d'arbre de panneaux, vos espaces de travail, vos shells en cours et tous vos raccourcis restent exactement où ils étaient : changer de variante est gratuit et réversible.

Choisissez-en une dans **Réglages → Layout**, ou définissez [`layoutVariant`](/fr/configuration/settings/) directement. Le choix persiste au redémarrage.

| Variante | Colonne de gauche | Idéale pour |
|---|---|---|
| **Bridge** (défaut) | La barre latérale complète — cartes d'espace de travail, explorateur de fichiers, panneau plan, notifications | Le travail quotidien |
| **Cockpit** | Un rail d'icônes de 52 px, plus une bande HUD de 22 px sur chaque panneau | Les sessions denses à plusieurs panneaux, quand vous voulez la télémétrie par panneau en ligne |
| **Atlas** | Un graphe vivant de tout ce qui tourne, avec un inspecteur | Faire tourner plusieurs agents à la fois et voir où l'on a besoin de vous |

## Bridge

La disposition par défaut, et un raffinement de la disposition classique. Barre latérale redimensionnable, cartes d'espace de travail avec cwd / branche / stats / panneaux / manifestes, l'[explorateur de fichiers](/fr/features/file-explorer-and-editor/), le [panneau plan](/fr/features/plan-panel/) et la liste des notifications. Les panneaux reçoivent 6 px de marge interne.

## Cockpit

La barre latérale se réduit à un rail d'icônes de 52 px : une marque τ, puis un bouton par espace de travail, qui s'illumine dans l'accent de cet espace, avec un point ambre pulsé sur tout espace faisant tourner un agent.

En échange, chaque panneau gagne une bande HUD de 22 px entre son en-tête et son corps :

```
AGENT · sonnet-4.5 · ● running          142 tok/s   $0.81   Δ +34 −18
```

À gauche l'identité du panneau dans sa couleur d'identité (`AGENT` ambre, `HUMAN` cyan), puis le modèle, puis un point d'état codé par couleur. Le bloc de droite porte les métriques : `tok/s` n'apparaît jamais pour un panneau humain, `$` est toujours à deux décimales, `Δ` donne les ajouts en vert et les suppressions en rouge.

`⌘\` replie entièrement le rail.

## Atlas

Atlas répond à une seule question : **que se passe-t-il en ce moment, et où dois-je intervenir ?**

Il remplace la barre latérale par une topologie vivante de tout ce que τ-mux exécute — espaces de travail, panneaux, sessions Claude Code qu'ils contiennent, leurs processus, ports en écoute, état git et coût — et donne à ce graphe les actions permettant de traiter ce qu'il révèle. Vous repérez une session qui vous attend, vous lisez pourquoi, et vous l'approuvez sans quitter la colonne.

### Bandes

```
┌─ ATLAS ─────── all agents live alert ② ? ⤢ ─┐  en-tête : portée + filtres
│ SPEND $1.73  5H 63% ▬▬  7D 21% ▬            │  jauges : dépense + limites
│ ╭───────────────────────────────────────╮   │  rivière : 90 dernières s
│ ╰───────────────────────────────────────╯   │
│  ▢ τ-mux    3 workspaces · 7 panes · 2 agent│
│  └─▣ crazyShell  4 panes · 1 agent          │
│      main↑2*  102%  885 MB                  │   le graphe
│      ├─● zsh       dev/crazyShell           │
│      ├─⬡ claude-code  needs approval        │
│      │   78% ctx  $1.42  4.2 KB/s           │
│      └─● bun test                           │
│          ▰ 62%  329 KB/s                    │
├─────────────────────────────────────────────┤
│ ⬡ claude-code            NEEDS APPROVAL     │
│ Rebuild the Atlas topology                  │   inspecteur : relevé + actions
│ waiting on   Bash(git push origin main)     │
│ context      ▓▓▓▓▓▓▓░░░  78%                │
│ [Approve]  [Interrupt]                      │
└─────────────────────────────────────────────┘
```

### Lire le graphe

Le graphe est dessiné comme une **colonne vertébrale** : la profondeur est une petite indentation, les frères et sœurs s'empilent verticalement, et les arêtes sont des coudes qui descendent le tronc puis tournent à droite vers leur nœud — le même idiome que `git log --graph` et `pstree`. Les positions sont déterministes : un nœud reste là où vous l'avez vu la dernière fois.

| Ce que vous voyez | Ce que ça veut dire |
|---|---|
| ▢ carré | Un espace de travail (ou τ-mux lui-même, en tête) |
| ● cercle | Un panneau |
| ⬡ hexagone | Un agent — une session Claude Code |
| Marqueur plein | Espace de travail actif / panneau focalisé |
| Arc autour d'un marqueur | CPU — vert, ambre au-delà de 50 %, rouge au-delà de 85 % |
| Second arc, extérieur | Contexte utilisé pour une session ; progression de build pour un panneau |
| Halo pulsé | Travail en cours |
| Anneau pointillé | **Celui-ci vous attend** — approbation, question, erreur, notification non lue |
| Puces de badge | Port `:3000` · branche `main↑2*` · `78% ctx` · `$1.42` · progression `▰ 62%` · débit · pastilles `ht set-status` |
| Crochets d'angle | Le nœud focalisé — un réticule de visée, sur un seul à la fois |
| Halo du marqueur | Proportionnel au CPU : un panneau chaud brûle visiblement |
| Flash de puce | Ce nombre vient de changer (limité en cadence, pour signaler sans clignoter) |

Le CPU agrégé d'un espace de travail ou de τ-mux lui-même est mis à l'échelle sur quatre cœurs, pas un seul, pour qu'un unique processus occupé ne sature pas l'anneau.

### La bande de jauges

Sous les filtres, dès qu'une session Claude publie ses chiffres : la dépense totale des agents, et les murs de limite 5 heures et 7 jours en mini-barres qui passent à l'ambre au-delà de 60 % et au rouge au-delà de 85 %. Les limites sont à l'échelle du compte : la valeur affichée est donc la plus haute qu'une session vivante ait vue — y compris une session sans panneau.

Si rien ne publie, rien ne s'affiche : la bande disparaît au lieu de rester vide.

### La rivière d'activité

Une bande de 34 px montrant les **90 dernières secondes** de sortie, une voie par espace de travail, colorée par son accent. Le graphe dit ce qui est vrai maintenant ; la rivière dit comment on en est arrivé là — un panneau qui a saturé un cœur il y a trois secondes puis s'est tu ressemble en tout point à un panneau qui dort depuis ce matin, jusqu'à ce qu'on voie sa trace.

- Chaque espace de travail garde une voie au repos : un espace silencieux est visiblement silencieux, pas absent.
- Un trou de collecte (l'application était endormie) est dessiné comme un trou, jamais comblé.
- La fenêtre s'adapte à l'historique réellement disponible : au démarrage elle se remplit depuis la gauche au lieu d'afficher trois quarts de bande morte. « Maintenant » est toujours le bord droit.
- Cliquer sur une voie bascule vers cet espace de travail.

### Les fils transportent les octets

Chaque arête s'anime au **débit réel de la sortie standard** du panneau. Un panneau qui exécute `bun test` défile visiblement ; un shell à son invite est un simple filet immobile. Rien d'autre dans τ-mux n'expose le débit du PTY, et cela permet de voir quel panneau parle sans lire la moindre étiquette.

En dessous d'environ 200 o/s, rien ne s'anime du tout — un τ-mux au repos est un graphe complètement immobile, ce qui est aussi la raison pour laquelle l'effet ne coûte rien quand vous ne vous en servez pas.

### Les agents dans le graphe

Une session Claude Code **est dessinée comme son panneau**, pas comme un second nœud à côté : le marqueur devient un hexagone, passe à l'ambre et récupère les badges de la session. Ce que le graphe et l'inspecteur savent d'une session :

- la phase — en travail, vous attend, approbation requise, vous questionne, compactage, erreur ;
- le modèle, le contexte utilisé, le coût, et les jauges de limite de débit 5 heures / 7 jours ;
- le nombre de tours, la durée du tour en cours, les lignes ajoutées et supprimées ;
- le numéro de PR et son état de revue ;
- le texte de ce qui est en attente d'approbation ;
- les **sous-agents actifs**, chacun comme un nœud sous le panneau, avec sa durée d'exécution ;
- la **liste de tâches mirroir sous forme de plan** (voir ci-dessous).

Une session sans panneau vivant — Claude Code lancé dans un shell que τ-mux ne possède pas, ou un panneau fermé sous elle — se rattache à la racine avec le badge `detached`. Elle dépense toujours de l'argent et peut toujours vous attendre : elle reste donc visible.

### `ht` dans le graphe

Atlas masque la barre latérale, ce qui faisait auparavant disparaître le panneau plan et les pastilles de statut dès qu'on choisissait cette disposition. Ils font désormais partie de la topologie :

- **[`ht plan`](/fr/cli/plan/)** — les étapes d'un plan deviennent des nœuds enfants : case pleine pour *done*, pulsée pour *active*, creuse pour *waiting*, rouge pour un échec. Le parent gagne un badge `2/4` et un arc de progression. Un plan qui nomme un agent se rattache au panneau qui l'exécute ; sinon à l'espace de travail. Les panneaux porteurs d'un plan se déplient d'eux-mêmes : le replier ferait perdre ce que la barre latérale montrait gratuitement.
- **[`ht set-status`](/fr/cli/sidebar-and-status/)** — les pastilles deviennent des badges sur le nœud d'espace de travail, dans la couleur choisie par le script qui les publie, et des lignes dans l'inspecteur.
- **[`ht set-progress`](/fr/cli/sidebar-and-status/)** — pilote l'arc du marqueur d'espace de travail et un badge `▰ 41%`. Un plan a la priorité si les deux sont présents.
- **[`ht ask`](/fr/cli/ask-user/)** — une question qui vous attend marque son panneau, en supplantant la phase déclarée par la session, et l'inspecteur affiche l'énoncé et ses choix.

Comme la liste de tâches de Claude Code est reflétée *en* plan, une session qui a les deux n'affiche que le plan — le même travail dessiné deux fois serait du bruit.

### Sparklines

Sélectionner un espace de travail ou un panneau trace ses 90 dernières secondes de CPU dans l'inspecteur, avec le pic en légende. Ce pic est en général la vraie question qu'on se posait en cliquant : non pas « est-il occupé » mais « l'a-t-il été ».

### Filtres

Quatre puces dans l'en-tête : **all**, **agents**, **live**, **alert**. La puce `alert` porte le compte de tout ce qui vous attend actuellement. Un nœud survit à un filtre s'il correspond *ou* si l'un de ses descendants correspond, si bien qu'un filtre n'orpheline jamais une correspondance de son espace de travail.

### Actions de l'inspecteur

L'inspecteur montre ce que vous survolez ou sélectionnez, et propose les actions qui lui appartiennent :

- **Approve** — uniquement pour une demande de permission que Claude Code affiche dans un panneau terminal, là où appuyer sur Entrée est réellement la réponse. Elle n'est délibérément **pas** proposée pour une demande routée vers une fenêtre modale τ-mux ou vers Telegram, ni pour un choix `AskUserQuestion` / `ExitPlanMode` qui vous est adressé : « approuver » y sélectionnerait silencieusement une valeur par défaut.
- **Interrupt** — arrêter un tour en cours.
- **Open :port** — ouvrir dans votre navigateur le port en écoute d'un panneau.
- **Details** — la vue complète d'[informations du panneau](/fr/features/live-process-metadata/).
- **Close pane**.

### CHRONO — `⌘G`

`⌘G` ouvre **CHRONO** : un champ temporel. L'axe horizontal représente les 90 dernières secondes, *maintenant* étant épinglé au bord droit ; chaque panneau est une **voie**, et le **terminal vivant** de chaque voie se trouve à *maintenant*.

Il répond à une question qu'aucune autre vue de τ-mux ne peut traiter : *que s'est-il passé, et qu'est-ce qui a réagi à quoi ?* La colonne dit l'état des choses maintenant ; CHRONO dit la forme de la dernière minute et demie, et vous laisse écrire dans n'importe laquelle.

```
┌ CHRONO ──────────── all agents live alert ②      esc to close ───────┐
│ ◀──── 90s            60s            30s              now ────────────│
│ ▎crazyShell                                                          │
│ ▎ zsh          ·······································  ╭──────────╮ │
│ ▎ :3000 4102                                            │ live      │ │
│ ▎ bun test     ▁▂▅███▇▃▁▁▁▁▂▅████▆▂▁▁▁▁▁▁▂▃▅▇███▆▃▁▁▁▁  ╭──────────╮ │
│ ▎ 74%  4190                                             │ live      │ │
│ ▎ claude-code  ▁▁▁████▁▁▁▁▁▁▁▁███████▁▁▁▁▁▁▁▁▁▁▅███▁▁▁  ╭══════════╗ │
│ ▎ 78% $1.42                                             ║ live      ║ │
│ ▎ plan ▪▪▫                                              ╚══════════╝ │
│                     turn          approval          mark             │
└──────────────────────────────────────────────────────────────────────┘
     gouttière            le passé                 maintenant
```

#### La tête est le vrai terminal

La tête d'une voie n'est ni une capture d'écran ni une copie. C'est le terminal du panneau lui-même, déplacé dans la voie le temps que CHRONO reste ouvert, et rendu tel quel à la fermeture. Y écrire écrit dans le panneau.

Le terminal n'est jamais redimensionné — la voie est une *fenêtre* posée dessus. Sa **dernière ligne est ancrée au bord inférieur de la voie** : un contenu plus court que la voie repose sur cette ligne de base, un contenu plus long défile vers le haut au-delà du bord supérieur. La dernière ligne de chaque voie tombe donc sur le même bord, ce qui permet à une colonne d'écrans de hauteurs différentes de se lire comme un seul instrument.

La hauteur d'une voie suit ce que son terminal a à montrer : un build qui imprime quarante lignes obtient une bande plus haute qu'un shell inactif.

#### La gouttière est à CHRONO, la tête est au panneau

Une seule règle décide à qui appartient le clavier :

- Cliquez sur la **bande de canal** d'une voie (ou utilisez `↑` / `↓`) pour la sélectionner. CHRONO garde le clavier : `Esc` referme, les flèches continuent de se déplacer.
- Cliquez sur sa **tête** pour entrer dans ce panneau. Le terminal détient alors le clavier — `Esc` compris, car la moitié des programmes qu'on y lance en ont besoin. L'en-tête indique lequel est actif, et `⌘G` referme toujours.

#### Traces et frappes

La trace de chaque voie est dessinée à partir de son débit de sortie réel avec une rémanence de phosphore : le bord d'attaque s'illumine en presque blanc et chaque échantillon décroît vers la couleur d'identité de la voie en vieillissant vers la gauche. Un panneau silencieux dessine un filet plat ; un panneau exécutant `bun test` dessine une silhouette de gratte-ciel.

Les événements — une frontière de tour d'agent, une approbation, une erreur, une notification, un [`ht atlas mark`](/fr/cli/atlas/) — **frappent verticalement à travers toutes les voies à la fois**, à l'instant où ils se sont produits. Comme toutes les voies partagent un même axe x, une approbation qui survient à t−40 s est une seule règle traversant toutes les traces, et l'on voit quels panneaux se sont tus et lesquels se sont réveillés à ce moment-là. Leurs noms sont imprimés sur l'axe sous le champ.

#### Les panneaux qui ne peuvent pas bouger

Les panneaux navigateur et extension sont respectivement une vue web native et une iframe ; ni l'un ni l'autre ne survit à un changement de parent. Leurs voies dessinent une trace comme les autres et affichent une **carte de veille** avec le titre du panneau, son URL et une action *aller au panneau*. Les surcouches navigateur sont masquées pendant que CHRONO est ouvert et restaurées à la fermeture.

#### Clavier

| Touche | Action |
|---|---|
| `↑` / `↓` | Se déplacer entre les voies |
| `Home` / `End` | Première / dernière voie |
| `Enter` | Aller au panneau sélectionné et refermer |
| `Esc` | Refermer — sauf si vous êtes entré dans une tête, où elle appartient au terminal |
| `⌘G` | Refermer, toujours |

Les quatre filtres (`all` / `agents` / `live` / `alert`) fonctionnent exactement comme dans la colonne.

#### Mouvement

CHRONO ne se redessine que si l'image change réellement. La trace d'un système silencieux est une ligne plate dont le décalage est indiscernable d'elle-même : rien n'est repeint. Tant qu'une silhouette défile encore hors de la fenêtre, il la suit ; quatre-vingt-dix secondes après le dernier octet, le champ est complètement immobile et ne coûte rien par seconde.
### Rail replié — `⌘\`

`⌘\` replie la colonne en un rail de 44 px de glyphes d'espaces de travail, avec un point ambre sur tout espace portant une notification non lue. Cliquer sur l'un d'eux y bascule. Le rail *est* l'état replié du graphe, pas un second élément de chrome posé à côté.

### Clavier

Le graphe est un vrai widget arborescent, pas une image :

| Touche | Action |
|---|---|
| `↑` / `↓` | Se déplacer entre les lignes visibles |
| `→` | Déplier un nœud replié, puis descendre |
| `←` | Replier un nœud ouvert, puis remonter |
| `Entrée` / `Espace` | Aller à cet espace de travail ou à ce panneau |
| `Home` / `End` | Première / dernière ligne |

Le bouton `?` de l'en-tête affiche une légende de l'encodage.

### L'esthétique

Atlas est la variante délibérément radicale, et le seul endroit où la retenue du système de design est relâchée volontairement. Elle se lit comme un instrument à phosphore : un voile de lignes de balayage sur le fond du graphe, une lueur d'horizon derrière la tête de la colonne vertébrale, de fins crochets d'angle encadrant chaque bande, et un halo de marqueur proportionnel à la charge plutôt qu'appliqué uniformément.

La seule ligne non arborescente est le **rappel** — un arc allant de τ-mux lui-même vers ce qui vous bloque. Il n'est tracé que pour ce qu'une de vos frappes résout (approbation, question, erreur), jamais pour un état purement informatif, et plafonné à deux.

### Animation

Chaque animation d'Atlas porte un état — aucune n'est décorative. Sous `prefers-reduced-motion: reduce`, le flux d'octets, les halos, la pulsation d'attention, le rappel et le flash de puce s'arrêtent tous ; les arcs, les couleurs et les anneaux pointillés disent la même chose sans bouger.

## Fichiers source

- `src/views/terminal/variants/controller.ts` — possède la variante active ; transitions `enter()` / `exit()`.
- `src/views/terminal/variants/{bridge,cockpit,atlas}.ts` — un handle par variante.
- `src/views/terminal/atlas/` — le panneau Atlas : `snapshot` collecte, `layout` place, `view` dessine, `inspector` explique, `filter` restreint.
- `src/views/terminal/throughput-meter.ts` — le débit par panneau derrière les fils.
- `src/views/terminal/metrics-history.ts` — les anneaux de 90 s derrière les sparklines et la rivière.
- `src/views/terminal/atlas/river.ts` — la rivière d'activité.

## Pour aller plus loin

- [Réglages](/fr/configuration/settings/) — `layoutVariant`, `sidebarWidth`, `paneGap`
- [Raccourcis clavier](/fr/configuration/keyboard-shortcuts/)
- [Métadonnées de processus en direct](/fr/features/live-process-metadata/) — d'où viennent le CPU, les ports et l'état git
- [Intégration Claude Code](/fr/integrations/claude-code/) — d'où vient l'état des sessions
