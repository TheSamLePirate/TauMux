---
title: Claude Code
description: Intégration profonde avec Claude Code — hooks couvrant tout le cycle de vie, flux de données statusline, approbations de permissions à distance, miroir automatique de la liste de tâches, et un panneau Claude Code natif.
sidebar:
  order: 1
---

Depuis la 0.5.0, τ-mux s'intègre à Claude Code sur **trois plans**, plus
un [panneau Claude Code natif](/fr/features/claude-code-pane/) (0.7.0).
Chaque pièce se dégrade indépendamment — n'importe quel sous-ensemble
fonctionne, et rien ne peut casser le terminal (le PTY ne dépend jamais
de l'intégration).

## Les trois plans

### Plan événementiel — les hooks

Quatorze hooks shell de Claude Code (début/fin de session, prompt/stop,
échecs API, sous-agents, compaction, changements de cwd, tâches
créées/terminées, notifications idle/permission) exécutent un petit pont
qui transmet un événement JSON normalisé à l'app (`ht claude event`). Un
registre par session suit la **phase** de chaque session Claude Code —
en cours / en attente d'entrée / approbation requise / compaction /
erreur — et l'attribue au panneau où elle tourne (`HT_SURFACE`).

Concrètement :

- la **pastille `Claude`** — titre de session pendant le travail, jaune
  *Waiting for input*, rouge *Approval needed*, discret *Compacting…*,
  texte d'erreur rouge sur échec API (rate limit, surcharge) ;
- une **notification de fin de tour** (prompt + durée + coût), une
  notification d'erreur sur échec API ;
- le **panneau de plan** qui reflète la liste de tâches native de Claude
  Code — voir ci-dessous.

### Plan de données — la statusline

```json title="~/.claude/settings.json"
{ "statusLine": { "type": "command", "command": "ht claude statusline" } }
```

Claude Code envoie un instantané JSON à sa commande statusline à chaque
message de l'assistant. `ht claude statusline` rend une ligne de statut
au style τ-mux dans Claude Code — modèle, effort, dossier, branche git,
mode de permission, badge PR, barre de contexte colorée, coût de session,
±lignes, et alertes de rate-limit dès 80 % — **et** reverse les données
dans la barre latérale : le **ticker `cc`** devient
`Opus · 42% ctx · $0.31`.

Coût, % de contexte, rate limits et titre de session sont des **valeurs
calculées par Claude Code lui-même** — elles correspondent toujours à
`/cost` et `/context`. (Les versions précédentes analysaient les
transcripts avec une table de prix maintenue à la main ; cette machinerie
a disparu.)

### Plan de décision — approbations à distance (opt-in)

Avec la fonctionnalité `approvals` installée, les demandes de permission
de Claude Code sont routées vers une **[modale
ask-user](/fr/features/ask-user/)** de τ-mux — et vers **Telegram** quand
le [pont](/fr/features/telegram-bridge/) est configuré — avec trois
réponses : **Allow**, **Deny**, **Answer in terminal**. La modale montre
l'outil et son entrée exacts (vérité brute, jamais un résumé).

**Fail-safe par construction :** si τ-mux ne tourne pas, si la modale
expire, si vous choisissez « Answer in terminal », ou si quoi que ce soit
échoue, le pont n'imprime rien et Claude Code affiche sa propre invite
exactement comme avant. La porte ne peut qu'*ajouter* un chemin de
réponse. Coupe-circuit sans désinstaller : `HT_CLAUDE_APPROVALS=0`.

## Accepter les invites du terminal

Quand Claude Code tourne dans un **panneau terminal** et demande la
permission d'exécuter une commande, τ-mux peut appuyer sur Entrée pour
vous (la réponse par défaut de l'invite est *Yes*) :

- **Manuellement**, toujours disponible — palette de commandes →
  *« Approve Claude Code permission prompt »*, ou
  [`ht claude approve`](/fr/cli/claude/) (répond à la session qui attend
  depuis le plus longtemps, ou `--surface`).
- **Automatiquement** — Réglages → *Auto-approve Claude Code prompts*
  (**désactivé par défaut**), ou
  [`ht claude auto-approve on|off|status`](/fr/cli/claude/). Chaque
  approbation est inscrite dans le journal de la barre latérale du
  panneau : il reste une trace de ce qui a été accepté sans surveillance.

C'est volontairement restreint. Cela ne se déclenche que lorsque Claude
Code affiche **sa propre invite dans le terminal du panneau** ; jamais
pour la [modale d'approbation τ-mux](/fr/integrations/claude-code/) (il
n'y a alors aucune invite terminal à répondre) et jamais dans le
[panneau Claude Code](/fr/features/claude-code-pane/). Le système
revérifie que l'invite est toujours à l'écran après le délai configuré :
pas d'Entrée parasite dans un panneau où vous avez déjà répondu. Et
au-delà de huit invites en une minute, il se met en pause et vous
notifie — une rafale d'invites ne se tamponne pas à l'aveugle.

### Les questions qui vous sont adressées ne sont jamais auto-répondues

Claude Code déclenche **le même** hook d'invite de permission pour une
fenêtre **AskUserQuestion** ou **ExitPlanMode** que pour « puis-je
exécuter cette commande », avec le même message générique — sur le flux
de hooks seul, les deux sont indiscernables. Deux hooks limités à
`AskUserQuestion|ExitPlanMode` signalent à τ-mux qu'une fenêtre de choix
est ouverte, et **l'auto-approbation comme le `ht claude approve` manuel
refusent d'agir tant qu'elle l'est** : appuyer sur Entrée sur une fenêtre
de choix sélectionne son option par défaut, ce qui n'est pas ce que
« approuver » signifie.

À la fermeture de la fenêtre, τ-mux retire l'annonce d'approbation qu'il
avait levée — une question répondue cesse donc d'afficher une pastille
d'approbation en attente, et un `ht claude approve` ultérieur ne peut pas
taper Entrée dans un panneau sans invite à l'écran. Une véritable invite
d'outil n'est pas touchée.

Une notification qui arrive pendant qu'une fenêtre est ouverte lui est
attribuée. En cas d'erreur, le résultat est une auto-approbation
*manquée* — vous appuyez sur Entrée vous-même — jamais une frappe
parasite.

:::note
Ces deux hooks nécessitent [`ht claude install`](/fr/cli/claude/) puis un
redémarrage des sessions Claude Code en cours. `ht claude doctor` les
signale comme manquants jusque-là.
:::

Un tour qui demande la permission plusieurs fois voit **toutes** ses
invites traitées, pas seulement la première — τ-mux compte les annonces
d'invite plutôt que les transitions d'état, car Claude Code ne fournit
aucun hook « invite résolue ».

L'auto-approbation donne à un agent un consentement non surveillé pour
les commandes qu'il demande à exécuter. Activez-la quand vous supervisez
le panneau, pas comme réglage permanent.

## Miroir de la liste de tâches

La liste de tâches native de Claude Code (TaskCreate / TaskCompleted) est
reflétée automatiquement dans le [panneau de plan](/fr/features/plan-panel/),
par session — aucune coopération du modèle requise. Les tâches terminées
apparaissent « done », la première tâche ouverte « active » ; le miroir
est effacé à la fin de la session, et cohabite avec les plans pi (chaque
agent a son propre emplacement).

Le miroir survit à un redémarrage de l'application : l'état de session
(identité, cwd, titre, liste de tâches, dépense) est persisté dans
`claude-sessions.json` du dossier de config et rechargé au lancement.
L'état *vivant* n'est délibérément **pas** restauré — une session
restaurée revient au repos, sans tour en cours ni approbation en attente,
et le prochain événement de hook corrige le reste. Sans cela, un
redémarrage laissait une session encore active avec un panneau de plan
vide en permanence : les hooks ne rapportent que des *transitions*, rien
ne réannonce les tâches déjà créées.

Comme le plan miroité et la notification de fin de tour alimentent le
moteur d'[auto-continue](/fr/features/auto-continue/) existant, la
continuation ancrée sur plan fonctionne pour les sessions Claude Code
sous les mêmes garde-fous. Le moteur s'exécutant à chaque fin de tour, un
espace sans plan publié enregistre un « skip » — les skips identiques
consécutifs sont regroupés en une seule ligne avec un compteur `×N` au
lieu de remplir le panneau d'audit.

## Installation

```bash
# une fois : mettre en place le pont + la skill (depuis le dépôt τ-mux)
./claude-integration/install.sh

# câbler le tout dans ~/.claude/settings.json (géré, réversible)
ht claude install                          # lifecycle + tasks + statusline
ht claude install --features approvals     # opt-in : approbations à distance
ht claude install --dry-run                # prévisualiser le diff
ht claude uninstall                        # retirer chaque entrée gérée
```

L'installateur fait une **sauvegarde horodatée**, fusionne
**additivement** (vos hooks existants sont intacts), est **idempotent**,
refuse de réécrire un fichier de réglages qu'il ne peut pas parser, et
n'écrase jamais une statusline définie par l'utilisateur (il la signale
comme conservée). Voir [`ht claude`](/fr/cli/claude/).

## Diagnostics

```bash
ht claude doctor      # binaire + version, hooks câblés/manquants,
                      # approbations, statusline, skill, joignabilité
ht claude sessions    # sessions observées (phase, titre, coût)
HT_CLAUDE_DEBUG=1     # erreurs du pont sur stderr
```

## La skill `tau-mux`

La skill (v2) enseigne à Claude Code les surfaces **interactives** —
`ht ask` pour les décisions, les splits pour les processus longs,
`ht browser` / `ht screenshot` pour la vérification, la porte
`confirm-command` pour le bash destructif. Tout ce que les hooks
automatisent (pastilles, ticker, notifications, miroir de plan,
approbations) n'est explicitement *pas* le travail du modèle — la skill
le dit, ce qui la garde courte et fiable.

## Équipes d'agents

Quand les équipes d'agents expérimentales de Claude Code sont activées,
τ-mux affiche une **pastille `team`** passive (« 3 members · 2/6
tasks ») lue depuis l'état d'équipe sur disque. Lecture seule et
défensive sur le schéma — la fonctionnalité amont est expérimentale.

## Architecture

Le pont et la skill vivent dans `claude-integration/` du dépôt ; l'état
côté app vit dans un registre de sessions avec des modules
presenter / mirror / watcher. La conception complète — y compris le
modèle de confiance — est documentée dans
`doc/system-claude-integration.md`.
