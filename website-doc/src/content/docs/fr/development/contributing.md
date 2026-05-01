---
title: Contribuer
description: Workflow de PR, style de code, et les éléments auxquels le projet tient.
sidebar:
  order: 4
---

τ-mux est une base de code petite et opinionée. Les contributions sont les bienvenues — veuillez parcourir les contraintes ci-dessous avant d'ouvrir une grosse PR.

## Style de code

- **TypeScript partout, modules ES.**
- **Dépendances minimales.** Pas de frameworks dans la webview. xterm.js est la seule dépendance de vue significative.
- **Conception orientée interfaces, héritage de classes minimal.**
- **Parseurs purs.** Tout ce qui transforme une sortie de sous-processus en maps structurées est une fonction pure pour pouvoir être testée unitairement sans lancer de processus.
- **Robustesse aux locales.** Tout sous-processus dont nous parsons la sortie tourne avec `LC_ALL=C, LANG=C`. Les séparateurs décimaux, séparateurs de milliers et formats de date varient selon la locale et nous ont déjà mordus par le passé.
- **Gestion des erreurs.** try/catch avec dégradation gracieuse. Loggez les erreurs, ne lancez pas depuis les callbacks. Le poller de métadonnées ne doit jamais planter le processus principal — tous les runners de sous-processus retournent des maps vides en cas d'échec.
- **Idiomes Bun.** Utilisez `Bun.file(fd).stream()` pour lire les fds, `Bun.write(fd, data)` pour écrire.

## Contraintes non négociables

- **Pas de node-pty.** `Bun.spawn` avec `terminal: true` est la seule API PTY.
- **Pas de React.** TypeScript vanille + DOM dans la webview.
- **Le clavier ne va jamais aux panneaux ni aux puces.** Toutes les touches vont vers xterm.js → stdin. Les panneaux et les puces sont à la souris uniquement (les boutons de puce sont focalisables au clavier).
- **Chaque bloc de contenu est son propre élément DOM.** Des panneaux indépendants avec transformations CSS, pas un canvas partagé.
- **Le PTY est la source de vérité.** Les panneaux canvas et les puces de métadonnées sont des superpositions éphémères — ils n'affectent jamais l'état du terminal.

## Workflow de PR

1. **Branche.** Depuis `main`. Nommez-la `feature/<short>` ou `fix/<short>`.
2. **Vérification de types + tests.**

   ```bash
   bun run typecheck
   bun test
   ```

3. **Tests de bout en bout si le changement touche au miroir web, à la webview ou aux raccourcis.**

   ```bash
   bun run test:e2e        # web mirror
   bun run test:native     # webview
   ```

4. **Bumper la version.** Conformément au CLAUDE.md du projet, exécutez `bun run bump:patch` (ou `:minor` / `:major`) avant de committer. Si vous ne le faites pas, expliquez pourquoi dans la PR.
5. **Ouvrez la PR.** Décrivez le *pourquoi* en 1 ou 2 phrases. Référencez l'issue ou le plan de fonctionnalité si pertinent.

## Revue

- L'agent `crazyShell Reviewer` (`bun run review:agent`) effectue à la demande une revue uniquement sous forme de propositions et écrit des rapports markdown datés dans `code_reviews/`. Utile pour l'auto-revue avant de pousser. Voir `doc/code-review-agent.md` pour le workflow.

## Patterns courants

Voir [Plongée dans l'architecture](/fr/development/architecture/) pour le tableau des patterns :

- Ajouter un champ de paramètre
- Ajouter une commande CLI / socket
- Ajouter un raccourci clavier
- Ajouter une puce de barre de panneau
- Ajouter un type de surface non-PTY

## Logs

```bash
tail -f ~/Library/Logs/tau-mux/app-$(date +%Y-%m-%d).log
```

Les tests redirigent vers `$HT_CONFIG_DIR/logs` pour que le vrai répertoire reste propre.

## Licence

MIT.
