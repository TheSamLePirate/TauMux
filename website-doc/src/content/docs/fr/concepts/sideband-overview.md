---
title: Aperçu sideband
description: Comment fd 3, fd 4 et fd 5 permettent aux scripts de rendre des canvas et de recevoir des événements sans perturber le flux texte du terminal.
sidebar:
  order: 4
---

Au-delà de stdin/stdout/stderr, τ-mux ouvre **trois descripteurs de fichiers supplémentaires** pour chaque shell. Les scripts s'exécutant à l'intérieur du terminal peuvent les utiliser pour rendre du contenu structuré (images, SVG, HTML, widgets interactifs) dans des canvas flottants — sans perturber le flux de sortie habituel du terminal.

## Les trois canaux

| fd | Direction | Rôle | Format |
|----|-----------|------|--------|
| **3** | script → terminal | Métadonnées : définitions de panneaux, mises à jour, effacements | JSONL (un objet JSON par ligne) |
| **4** | script → terminal | Données binaires référencées depuis fd 3 (octets PNG, etc.) | octets bruts, préfixés par la longueur via `byteLength` |
| **5** | terminal → script | Événements : clics, glissers, redimensionnements, erreurs système | JSONL |

La disposition des canaux est publiée dans la variable d'environnement `HYPERTERM_CHANNELS` au format JSON, afin que les scripts puissent s'adapter si la disposition change un jour.

## Pourquoi des fds et pas des séquences OSC ?

Les séquences OSC (la méthode iTerm2) sont simples mais étroitement liées au flux texte du terminal — elles volent les codes d'échappement, sont limitées en longueur dans de nombreux shells, et cassent si quoi que ce soit d'autre lit le stdout (par exemple `tee`, des pipes). Les fds sideband :

- Ne sont pas en concurrence avec stdout.
- Ont un support binaire natif (pas d'aller-retour base64).
- Disposent d'un canal de retour (fd 5) permettant au terminal de parler au script.
- Survivent aux pipes — seul l'enfant d'origine voit les fds ; les commandes pipées ne les voient pas.

Le compromis est le support multi-plateforme : seuls les programmes s'exécutant directement à l'intérieur de τ-mux peuvent utiliser les canaux. Tout ce qui est lancé via SSH ou à l'intérieur de Docker ne les voit pas — et les bibliothèques clientes deviennent gracieusement des no-op dans ce cas.

## Aperçu rapide

Python :

```python
from hyperterm import ht

ht.show_image('photo.png', x=100, y=50, draggable=True)
ht.show_html('<button onclick="alert(1)">Click me</button>', interactive=True)

for event in ht.events():
    print("got:", event)
```

TypeScript :

```ts
import { ht } from "./hyperterm";

const id = ht.showSvg('<svg width="200" height="200">…</svg>', { x: 100, y: 50 });
ht.update(id, { x: 200 });
ht.onEvent((e) => console.log(e));
```

Les deux bibliothèques sont des no-op sûrs lorsqu'elles ne tournent pas à l'intérieur de τ-mux — la détection est une simple vérification de la variable d'environnement `HYPERTERM_PROTOCOL_VERSION`.

## En savoir plus

- [Aperçu du protocole sideband](/fr/sideband/overview/) — spécification complète du framing.
- [Métadonnées (fd 3)](/fr/sideband/metadata-fd3/) — définitions de panneaux, options, opérations.
- [Données binaires (fd 4)](/fr/sideband/data-fd4/) — framing par byteLength, canaux nommés.
- [Événements (fd 5)](/fr/sideband/events-fd5/) — drag, resize, click, erreurs système.
- [Client Python](/fr/sideband/python-client/) et [client TypeScript](/fr/sideband/typescript-client/).
