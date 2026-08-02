---
title: ht claude
description: statusline, sessions, install, uninstall, doctor, event.
---

Les verbes derrière l'[intégration Claude Code](/fr/integrations/claude-code/).
Ajoutés en 0.5.0 (statusline / sessions / event) et 0.6.0 (install /
uninstall / doctor).

## claude statusline

```bash
ht claude statusline
```

Ne s'appelle pas à la main — installez-la comme statusline de Claude
Code :

```json title="~/.claude/settings.json"
{ "statusLine": { "type": "command", "command": "ht claude statusline" } }
```

Lit le JSON que Claude Code envoie sur stdin, imprime une ligne de
statut au style τ-mux (modèle · effort · dossier · branche git · mode de
permission · PR · barre de contexte · coût · ±lignes · alertes de
rate-limit ≥80 %), et reverse les données parsées à l'app
(`claude.statusline`) pour que le ticker de la barre latérale et le
registre de sessions restent exacts. L'impression a toujours lieu et
vient toujours en premier — une app absente ou bloquée ne dégrade jamais
la ligne ; le code de sortie est toujours 0.

## claude sessions

```bash
ht claude sessions          # sessions actives
ht claude sessions --all    # inclut celles terminées récemment
```

Liste les sessions Claude Code observées par l'app : id court, phase
(`working` / `waiting-input` / `waiting-approval` / `compacting` /
`error`), panneau, titre, et `(modèle · ctx% · coût · turn N)`.

## claude install / uninstall

```bash
ht claude install [--features lifecycle,tasks,statusline,approvals]
                  [--dry-run] [--settings-path P] [--bridge-path P]
ht claude uninstall
```

Chirurgie gérée de `~/.claude/settings.json` :

- **sauvegarde horodatée** à côté du fichier avant chaque écriture ;
- **fusion additive** — vos propres entrées ne sont jamais touchées ;
- **idempotent** — une seconde installation affiche des lignes
  `= unchanged` ;
- **refuse** de réécrire un fichier qu'il ne peut pas parser ;
- une `statusLine` définie par l'utilisateur est conservée (signalée,
  pas écrasée).

Fonctionnalités par défaut : `lifecycle,tasks,statusline`.
**`approvals` est opt-in** — elle câble le hook `PermissionRequest` qui
route les demandes de permission vers une modale τ-mux + Telegram (voir
la [page d'intégration](/fr/integrations/claude-code/) pour le contrat
fail-safe). `uninstall` retire exactement les entrées gérées
(identifiées par leur chemin de commande) et garde une sauvegarde.

## claude doctor

```bash
ht claude doctor
```

Bilan de santé en un écran : binaire `claude` + version, état de parse
du fichier de réglages, présence du pont, hooks câblés vs manquants,
état des approbations, statusline (`ht claude statusline` / définie par
l'utilisateur / absente), présence de la skill, et joignabilité de
l'app — y compris le cas précis « joignable mais pré-0.5.0 — redémarrez
τ-mux ».

## claude event

```bash
ht claude event --json '<JSON d'événement du pont>'
```

Interne — le transport du pont de hooks vers `claude.event`. Injecte
`HT_SURFACE` comme attribution de panneau quand la charge utile n'en a
pas.
