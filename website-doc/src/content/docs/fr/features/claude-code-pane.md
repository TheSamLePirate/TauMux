---
title: Panneau Claude Code
description: Une session Claude Code native comme panneau de premier rang — chat en streaming, cartes d'outils, modes de permission, interruption, pastilles de coût, et un sélecteur de reprise de session.
---

Depuis la 0.7.0, Claude Code peut tourner comme **panneau natif** — une
surface de premier rang aux côtés des terminaux, navigateurs et du
panneau d'agent pi. Le panneau héberge une vraie session Claude Code via
le SDK Agent officiel, en utilisant **votre propre installation et
connexion `claude`** (le CLI embarqué du SDK sert de repli si aucune
n'est trouvée).

Il complète — sans remplacer — l'exécution de `claude` dans un panneau
terminal : l'[intégration hooks/statusline](/fr/integrations/claude-code/)
couvre les sessions terminal ; le panneau est là quand vous voulez une
surface de type chat avec des affordances structurées.

## Ouvrir un panneau

Palette de commandes (`⌘⇧P`) :

- **New Claude Code Pane** — nouvel espace de travail ;
- **Split Claude Code Right / Down** — split à côté du panneau focalisé.

## Dans le panneau

- **Réponses en streaming** — le texte partiel s'accumule en direct dans
  le transcript ; les appels d'outils apparaissent comme des **cartes**
  (`Bash` montre la commande exacte, les outils fichiers montrent le
  chemin).
- **Barre d'outils** — pastille de modèle, **sélecteur de mode de
  permission** (default / acceptEdits / plan / bypassPermissions,
  appliqué en cours de session), pastille de coût, **Stop**
  (interruption — aussi `Échap` depuis le composeur), et **Sessions**.
- **Sélecteur de sessions** — liste vos sessions Claude Code récentes
  (titre, branche, dernière activité) ; en choisir une **la reprend
  dans un nouveau split**.
- **Composeur** — `Entrée` envoie, `Maj+Entrée` insère un saut de ligne.

## Permissions

Les permissions d'outils dans le panneau passent par la **même [modale
ask-user](/fr/features/ask-user/)** (et le relais Telegram) que les
approbations à distance des hooks : Allow / Deny, avec l'entrée exacte
de l'outil affichée. Pas de réponse avant l'expiration → l'outil est
refusé avec un message « timed out » pour le modèle. Aucun contournement
n'existe sauf si vous passez vous-même le panneau en
`bypassPermissions`.

## Cycle de vie

Fermer le panneau interrompt le tour et arrête proprement la session —
aucun processus orphelin. La restauration d'une disposition sauvegardée
remonte les panneaux Claude comme **sessions neuves** (l'ancien flux est
mort avec l'app) ; utilisez le sélecteur de sessions pour reprendre où
vous en étiez. Le focus clavier suit la règle de l'app : le composeur du
panneau est une surface de saisie comme celui du panneau pi, et les
frappes du terminal ne sont jamais volées par un panneau non focalisé.
