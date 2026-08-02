---
title: Panneau Claude Code
description: Une session Claude Code native comme panneau de premier rang — chat markdown, cartes d'outils dépliables avec résultats en direct, blocs de réflexion, changement de session sur place, sélecteurs de modèle et de permissions, statut d'approbation en ligne.
---

Depuis la 0.7.0 (complet depuis la 0.8.0), Claude Code peut tourner
comme **panneau natif** — une surface de premier rang aux côtés des
terminaux, navigateurs et du panneau d'agent pi. Le panneau héberge une
vraie session Claude Code via le SDK Agent officiel, avec **votre
propre installation et connexion `claude`** (le CLI embarqué du SDK sert
de repli). Les nouveaux panneaux héritent du **cwd du panneau focalisé**,
donc les sessions démarrent là où vous travaillez.

Il complète — sans remplacer — `claude` dans un panneau terminal :
l'[intégration hooks/statusline](/fr/integrations/claude-code/) couvre
les sessions terminal ; le panneau est là quand vous voulez une surface
de type chat avec des affordances structurées.

## Ouvrir un panneau

Palette (`⌘⇧P`) : **New Claude Code Pane**, ou **Split Claude Code
Right / Down** à côté du panneau focalisé.

## Le transcript

- **Réponses en markdown**, streamées avec un curseur — blocs de code
  avec étiquette de langage, code inline, titres, listes. Le streaming
  est O(N) (le motif « live element » du panneau pi) : les longues
  réponses restent fluides.
- **Blocs de réflexion** — la réflexion étendue streame dans un bloc
  « Thinking » replié (pulsant en direct) ; cliquez pour déplier.
- **Cartes d'outils** — chaque appel d'outil est une carte avec un point
  d'état (en cours → vert ok / rouge échec), le nom de l'outil et un
  résumé d'une ligne (`Bash` montre la commande exacte, les outils
  fichiers le chemin, `Task` le brief du sous-agent). Cliquez pour
  déplier : l'**entrée** complète et la **sortie appariée** (par
  `tool_use_id`), chacune avec un bouton copier. La sortie est plafonnée
  à 4 000 caractères, longueur réelle indiquée.
- **Statut d'approbation en ligne** — pendant qu'un outil attend la
  [modale ask-user](/fr/features/ask-user/) (ou Telegram), le transcript
  affiche *« Waiting for approval: Bash »* ; un refus ou une expiration
  laisse une trace rouge.
- **Lignes de fin de tour** — durée · coût · tokens après chaque tour ;
  les échecs API s'affichent en erreur.
- **Autoscroll intelligent** — la vue colle au bas jusqu'à ce que vous
  remontiez ; une pastille **↓ latest** vous y ramène.

## L'en-tête

De gauche à droite : un **point d'état** (repos / pulsant pendant le
travail / ambre en attente d'approbation), un **sélecteur de modèle**
(default · Opus · Sonnet · Haiku — appliqué en cours de session ; le
modèle réel de la session s'ajoute automatiquement à la liste), le
**sélecteur de mode de permission** (`bypassPermissions` surligné en
rouge), le **cwd** de la session, les pastilles **tokens / coût /
durée** en direct, et **New · Sessions · Stop**.

## Sessions — sur place

**Sessions** liste vos sessions Claude Code récentes (titre, branche,
dernière activité). En choisir une **la reprend dans ce panneau** : le
transcript persisté est rejoué sous un séparateur *« resumed session »*
et la conversation continue avec tout son contexte. **fork** reprend
dans un nouvel id de session, sans toucher l'original. **New** démarre
une session neuve dans le panneau. (Sous le capot, le panneau rebranche
son flux SDK — l'id de surface, la position du split et l'emplacement de
disposition ne changent jamais.)

## Le composeur

`Entrée` envoie, `Maj+Entrée` insère un saut de ligne, `Échap`
interrompt. La zone de texte grandit avec le contenu. **Envoyer en
cours de tour met en file** — le SDK délivre le message à la fin du
tour courant.

## Permissions

Les permissions d'outils passent par la **même modale ask-user** (et le
relais Telegram) que les approbations à distance des hooks : Allow /
Deny, avec l'entrée exacte de l'outil affichée. Pas de réponse avant
l'expiration → l'outil est refusé avec un message « timed out ». Aucun
contournement n'existe sauf si vous passez vous-même le panneau en
`bypassPermissions`.

## Cycle de vie

Fermer le panneau interrompt le tour et arrête proprement la session —
aucun processus orphelin. La restauration d'une disposition remonte les
panneaux Claude comme sessions neuves (reprenez via **Sessions**). Le
focus clavier suit la règle de l'app : le composeur est une surface de
saisie comme celui du panneau pi, et les frappes du terminal ne sont
jamais volées par un panneau non focalisé.
